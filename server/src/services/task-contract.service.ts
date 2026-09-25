import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { db, rawDb } from "../db/connection";
import { maybeContractTaskEventsTable } from "../db/migrate";
import { configTable, dataMigrations } from "../db/schema";
import { runInTransaction } from "../db/transaction";
import { HttpError } from "../middleware/errorHandler";
import { TaskPhase2BackfillService } from "./task-phase2-backfill.service";
import { normalizeWorkspaceId } from "./workspace.service";

export const PHASE2B_SOAK_MS = 7 * 24 * 60 * 60 * 1000;
export const PHASE2C_SOAK_MS = 14 * 24 * 60 * 60 * 1000;

/** Frozen-at-2b legacy task tables, renamed to legacy_* archives at 2d. */
export const LEGACY_ARCHIVE_TABLES = [
  ["team_tracker_items", "legacy_team_tracker_items"],
  ["manager_desk_items", "legacy_manager_desk_items"],
  ["manager_desk_links", "legacy_manager_desk_links"],
] as const;

/** Write-guard trigger names created by `tasks:cutover --apply` (§2.1.3). */
export const LEGACY_GUARD_TRIGGERS = LEGACY_ARCHIVE_TABLES.flatMap(([table]) =>
  ["insert", "update", "delete"].map((op) => `legacy_ro_${table}_${op}`)
);

export interface ContractCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface ContractPlan {
  workspaceId: string;
  stage: string | null;
  ok: boolean;
  checks: ContractCheck[];
  actions: string[];
}

function walkTypeScript(dir: string, files: string[] = []): string[] {
  if (!existsSync(dir)) return files;
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (entry !== "node_modules" && !entry.startsWith(".")) walkTypeScript(full, files);
    } else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) {
      files.push(full);
    }
  }
  return files;
}

/**
 * Stage-2d contract: rename the frozen legacy task tables to `legacy_*`
 * archives, drop the read-only guard triggers, contract
 * `task_events.task_id` to NOT NULL, and record the `p2_contract` marker plus
 * per-workspace `tasks_phase2_stage = "2d"` — all in one transaction.
 *
 * Dry-run by default (`plan`); `apply` refuses while any gate fails: the
 * workspace must be at stage 2c with a completed two-week soak, the
 * structural invariants must be clean (no unmapped rows, no unrepointed
 * events, no unfilled references, no multi-active violations), and the
 * source tree must hold no compatibility-adapter callers or routes that read
 * the legacy task tables directly.
 */
export class TaskContractService {
  private readonly backfill = new TaskPhase2BackfillService();

  private async setting(scope: string, key: string): Promise<string | undefined> {
    return (await db.select().from(configTable).where(and(eq(configTable.workspaceId, scope), eq(configTable.key, key))).limit(1))[0]?.value;
  }

  private async setConfig(scope: string, key: string, value: string): Promise<void> {
    await db.insert(configTable).values({ workspaceId: scope, key, value })
      .onConflictDoUpdate({ target: [configTable.workspaceId, configTable.key], set: { value } });
  }

  private tableExists(name: string): boolean {
    return Boolean(rawDb.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
  }

  private triggerExists(name: string): boolean {
    return Boolean(rawDb.prepare("SELECT 1 FROM sqlite_master WHERE type = 'trigger' AND name = ?").get(name));
  }

  /**
   * Source scan for retired-adapter callers (compatibility service imports)
   * and routes that still read the legacy task tables directly. These are
   * code-level gates the runtime cannot observe on its own.
   */
  findBlockingCallers(serverSrcDir: string): { adapterCallers: string[]; legacyConsumers: string[] } {
    const adapterCallers: string[] = [];
    const legacyConsumers: string[] = [];
    const routesDir = path.join(serverSrcDir, "routes");
    for (const file of walkTypeScript(serverSrcDir)) {
      const text = readFileSync(file, "utf8");
      if (/task-compatibility\.service/.test(text)) adapterCallers.push(path.relative(serverSrcDir, file));
      if (file.startsWith(routesDir) && /\b(teamTrackerItems|managerDeskItems|managerDeskLinks)\b/.test(text)) {
        legacyConsumers.push(path.relative(serverSrcDir, file));
      }
    }
    return { adapterCallers, legacyConsumers };
  }

  async plan(workspaceId: string, opts: { serverSrcDir?: string } = {}): Promise<ContractPlan> {
    const scope = normalizeWorkspaceId(workspaceId);
    const stage = (await this.setting(scope, "tasks_phase2_stage")) ?? null;
    const checks: ContractCheck[] = [];

    checks.push({
      name: "stage",
      ok: stage === "2c" || stage === "2d",
      detail: `tasks_phase2_stage=${stage ?? "(unset)"} (need "2c"; "2d" means already contracted)`,
    });

    const completedAtRaw = await this.setting(scope, "tasks_phase2c_completed_at");
    const completedAt = completedAtRaw ? Date.parse(completedAtRaw) : NaN;
    const marked = Number.isFinite(completedAt);
    const soakedMs = marked ? Date.now() - completedAt : 0;
    const soaked = marked && soakedMs >= PHASE2C_SOAK_MS;
    checks.push({
      name: "2c_completion",
      ok: marked,
      detail: marked ? `2c completed at ${completedAtRaw}` : "tasks_phase2c_completed_at is unset — run tasks:stage --complete 2c",
    });
    checks.push({
      name: "2c_soak",
      ok: soaked,
      detail: marked ? `${Math.floor(soakedMs / 86400000)}d elapsed (need ${PHASE2C_SOAK_MS / 86400000}d)` : "no completion timestamp",
    });

    const alreadyContracted = stage === "2d";
    if (alreadyContracted) {
      // The archived tables are renamed away, so the legacy structural probe
      // cannot run — it is only meaningful pre-contract.
      checks.push({ name: "structure", ok: true, detail: "skipped — workspace already contracted" });
    } else {
      const structure = await this.backfill.verifyStructure(scope);
      checks.push({
        name: "structure",
        ok: structure.ok,
        detail: [
          `unmapped rows: ${structure.missingLegacyMap.length}`,
          `unrepointed events: ${structure.unrepointedEvents}`,
          `unfilled refs: checkin=${structure.unfilledRefs.checkin} note=${structure.unfilledRefs.noteTask} followUp=${structure.unfilledRefs.noteFollowUp}`,
          `multi-active: ${structure.multiActiveViolations.length}`,
        ].join("; "),
      });
    }

    const archiveState = LEGACY_ARCHIVE_TABLES.map(([from, to]) => ({
      from, to, fromExists: this.tableExists(from), toExists: this.tableExists(to),
    }));
    const archiveConsistent = archiveState.every((pair) => pair.fromExists !== pair.toExists);
    checks.push({
      name: "archive_tables",
      ok: archiveConsistent,
      detail: archiveConsistent
        ? archiveState.every((pair) => pair.toExists)
          ? "legacy task tables already archived"
          : "legacy task tables ready to archive"
        : archiveState.filter((pair) => pair.fromExists === pair.toExists).map((pair) => `${pair.from}/${pair.to}`).join(", ") + " in inconsistent state",
    });

    const { adapterCallers, legacyConsumers } = this.findBlockingCallers(
      opts.serverSrcDir ?? path.resolve(__dirname, "..")
    );
    checks.push({
      name: "adapter_callers",
      ok: adapterCallers.length === 0,
      detail: adapterCallers.length ? adapterCallers.join(", ") : "no compatibility-adapter imports",
    });
    checks.push({
      name: "legacy_consumers",
      ok: legacyConsumers.length === 0,
      detail: legacyConsumers.length ? legacyConsumers.join(", ") : "no routes read legacy task tables directly",
    });

    const guardTriggers = LEGACY_GUARD_TRIGGERS.filter((name) => this.triggerExists(name));
    checks.push({
      name: "guard_triggers",
      ok: true,
      detail: guardTriggers.length ? `${guardTriggers.length} read-only triggers will be dropped` : "no read-only triggers present",
    });

    const actions = [
      ...LEGACY_GUARD_TRIGGERS.map((name) => `DROP TRIGGER IF EXISTS ${name}`),
      ...LEGACY_ARCHIVE_TABLES.map(([from, to]) => `ALTER TABLE ${from} RENAME TO ${to}`),
      "INSERT INTO data_migrations (name) VALUES ('p2_contract')",
      "config tasks_phase2_stage = '2d'",
      "config tasks_phase2_contracted_at = <now>",
      "rebuild task_events with task_id NOT NULL",
    ];
    return { workspaceId: scope, stage, ok: checks.every((check) => check.ok), checks, actions };
  }

  async apply(workspaceId: string, opts: { serverSrcDir?: string } = {}): Promise<{ applied: boolean; plan: ContractPlan; taskEventsContracted: boolean }> {
    const scope = normalizeWorkspaceId(workspaceId);
    const stage = await this.setting(scope, "tasks_phase2_stage");
    if (stage === "2d") {
      const plan = await this.plan(scope, opts);
      return { applied: false, plan, taskEventsContracted: this.taskEventsContracted() };
    }
    const plan = await this.plan(scope, opts);
    if (!plan.ok) {
      const failed = plan.checks.filter((check) => !check.ok).map((check) => `${check.name}: ${check.detail}`).join("; ");
      throw new HttpError(409, `Phase 2d contract prerequisites failed — ${failed}`);
    }
    return runInTransaction(async () => {
      for (const name of LEGACY_GUARD_TRIGGERS) {
        rawDb.exec(`DROP TRIGGER IF EXISTS ${name}`);
      }
      for (const [from, to] of LEGACY_ARCHIVE_TABLES) {
        rawDb.exec(`ALTER TABLE ${from} RENAME TO ${to}`);
      }
      const now = new Date().toISOString();
      await db.insert(dataMigrations).values({ name: "p2_contract", appliedAt: now, reportJson: JSON.stringify(plan) }).onConflictDoNothing();
      await this.setConfig(scope, "tasks_phase2_stage", "2d");
      await this.setConfig(scope, "tasks_phase2_contracted_at", now);
      maybeContractTaskEventsTable(rawDb);
      return { applied: true, plan, taskEventsContracted: this.taskEventsContracted() };
    });
  }

  private taskEventsContracted(): boolean {
    const rows = rawDb.prepare("PRAGMA table_info(task_events)").all() as { name: string; notnull: number }[];
    return Boolean(rows.find((row) => row.name === "task_id")?.notnull);
  }
}
