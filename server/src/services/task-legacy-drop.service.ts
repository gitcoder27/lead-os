import { and, eq } from "drizzle-orm";
import { db, rawDb } from "../db/connection";
import { configTable, dataMigrations } from "../db/schema";
import { runInTransaction } from "../db/transaction";
import { HttpError } from "../middleware/errorHandler";
import { BackupService } from "./backup.service";
import { normalizeWorkspaceId } from "./workspace.service";

/** The three Phase 2d archive tables removed by `tasks:drop-legacy` (§8.2). */
export const LEGACY_DROP_TABLES = [
  "legacy_team_tracker_items",
  "legacy_manager_desk_items",
  "legacy_manager_desk_links",
] as const;

/** Originals the archives were renamed from — referenced by older table SQL. */
const LEGACY_ORIGINAL_TABLES = ["team_tracker_items", "manager_desk_items", "manager_desk_links"] as const;

/**
 * Live tables allowed to hold a foreign key into the dropped set —
 * `daily_note_follow_ups.item_id` references `manager_desk_items` (rewritten
 * to `legacy_manager_desk_items` by the contract's rename). Dropping the
 * parent leaves a dangling reference that breaks every insert, so apply
 * rebuilds this table without the dead FK. Anything else found referencing
 * the dropped tables fails the gate.
 */
const REBUILDABLE_DEPENDENTS = ["daily_note_follow_ups"] as const;

const DEPENDENT_REFERENCE = /references\s+"?(?:legacy_)?(?:team_tracker_items|manager_desk_items|manager_desk_links)"?\s*\(/i;

/** Minimum age of `tasks_phase2_contracted_at` before the drop is allowed. */
export const LEGACY_DROP_SOAK_MS = 30 * 24 * 60 * 60 * 1000;

export interface LegacyDropCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface LegacyDropPlan {
  workspaceId: string;
  stage: string | null;
  ok: boolean;
  alreadyApplied: boolean;
  tables: { name: string; exists: boolean }[];
  dependents: string[];
  checks: LegacyDropCheck[];
  actions: string[];
}

export interface LegacyDropResult {
  applied: boolean;
  alreadyApplied: boolean;
  backup?: string;
  plan: LegacyDropPlan;
}

/**
 * Wave 3f (§8.2): permanently drop the `legacy_*` archive tables once the
 * Phase 2 contract has soaked. Dry-run by default via `plan`; `apply` refuses
 * unless every gate holds — stage `2d`, a `p2_contract` data-migration marker,
 * a `tasks_phase2_contracted_at` at least 30 days old, and the three archive
 * tables present in a consistent state. A `pre-legacy-drop` backup is taken
 * before any destructive statement runs, and a `p3_legacy_drop` marker is
 * recorded so repeat invocations report "already applied" instead of
 * re-dropping.
 */
export class TaskLegacyDropService {
  private readonly backups: Pick<BackupService, "createManualBackup">;

  constructor(backups?: Pick<BackupService, "createManualBackup">) {
    this.backups = backups ?? new BackupService();
  }

  private async setting(scope: string, key: string): Promise<string | undefined> {
    return (await db.select().from(configTable).where(and(eq(configTable.workspaceId, scope), eq(configTable.key, key))).limit(1))[0]?.value;
  }

  private tableExists(name: string): boolean {
    return Boolean(rawDb.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
  }

  private async marker(name: string): Promise<boolean> {
    return Boolean((await db.select({ name: dataMigrations.name }).from(dataMigrations).where(eq(dataMigrations.name, name)).limit(1))[0]);
  }

  /** Live tables whose SQL still references a table the drop removes. */
  private dependents(): string[] {
    const rows = rawDb.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table'").all() as { name: string; sql?: string }[];
    return rows
      .filter((row) => !LEGACY_DROP_TABLES.includes(row.name as typeof LEGACY_DROP_TABLES[number])
        && !LEGACY_ORIGINAL_TABLES.includes(row.name as typeof LEGACY_ORIGINAL_TABLES[number])
        && row.sql
        && DEPENDENT_REFERENCE.test(row.sql))
      .map((row) => row.name)
      .sort();
  }

  async plan(workspaceId: string): Promise<LegacyDropPlan> {
    const scope = normalizeWorkspaceId(workspaceId);
    const stage = (await this.setting(scope, "tasks_phase2_stage")) ?? null;
    const markerDropped = await this.marker("p3_legacy_drop");
    const tables = LEGACY_DROP_TABLES.map((name) => ({ name, exists: this.tableExists(name) }));
    const present = tables.filter((table) => table.exists).length;
    const dependents = this.dependents();
    const unknownDependents = dependents.filter((name) => !(REBUILDABLE_DEPENDENTS as readonly string[]).includes(name));
    const checks: LegacyDropCheck[] = [];

    checks.push({
      name: "stage",
      ok: stage === "2d",
      detail: `tasks_phase2_stage=${stage ?? "(unset)"} (need "2d" — run tasks:contract first)`,
    });

    const contracted = await this.marker("p2_contract");
    checks.push({
      name: "contract_marker",
      ok: contracted,
      detail: contracted ? "p2_contract marker recorded" : "p2_contract marker missing — run tasks:contract --apply",
    });

    const contractedAtRaw = await this.setting(scope, "tasks_phase2_contracted_at");
    const contractedAt = contractedAtRaw ? Date.parse(contractedAtRaw) : NaN;
    const soakedMs = Number.isFinite(contractedAt) ? Date.now() - contractedAt : 0;
    const soaked = Number.isFinite(contractedAt) && soakedMs >= LEGACY_DROP_SOAK_MS;
    checks.push({
      name: "contract_soak",
      ok: soaked,
      detail: Number.isFinite(contractedAt)
        ? `${Math.floor(soakedMs / 86400000)}d since contract (need ${LEGACY_DROP_SOAK_MS / 86400000}d)`
        : "tasks_phase2_contracted_at is unset",
    });

    const consistent = markerDropped ? present === 0 : present === LEGACY_DROP_TABLES.length;
    checks.push({
      name: "legacy_tables",
      ok: consistent,
      detail: markerDropped
        ? consistent
          ? "p3_legacy_drop marker recorded and all archive tables are gone"
          : `inconsistent — marker recorded but ${tables.filter((table) => table.exists).map((table) => table.name).join(", ")} still exist`
        : present === LEGACY_DROP_TABLES.length
          ? "all three archive tables present"
          : present === 0
            ? "archive tables already absent without a p3_legacy_drop marker — inspect manually"
            : `inconsistent — missing ${tables.filter((table) => !table.exists).map((table) => table.name).join(", ")}`,
    });

    checks.push({
      name: "dependents",
      ok: unknownDependents.length === 0,
      detail: dependents.length === 0
        ? "no live tables reference the dropped set"
        : unknownDependents.length
          ? `tables still reference dropped parents: ${unknownDependents.join(", ")}`
          : `${dependents.join(", ")} will be rebuilt without the dead foreign key`,
    });

    const actions = [
      "backup: pre-legacy-drop",
      ...dependents.map((name) => `rebuild ${name} without legacy foreign keys`),
      ...LEGACY_DROP_TABLES.map((name) => `DROP TABLE IF EXISTS ${name}`),
      "INSERT INTO data_migrations (name) VALUES ('p3_legacy_drop')",
    ];
    return { workspaceId: scope, stage, ok: checks.every((check) => check.ok), alreadyApplied: markerDropped, tables, dependents, checks, actions };
  }

  /**
   * Rebuild `daily_note_follow_ups` with `item_id` kept as a plain column —
   * the legacy parent is gone, but `task_id` carries the canonical reference.
   */
  private rebuildDailyNoteFollowUps(): void {
    if (!this.tableExists("daily_note_follow_ups")) return;
    const columns = new Set(
      (rawDb.prepare("PRAGMA table_info(daily_note_follow_ups)").all() as { name: string }[]).map((row) => row.name)
    );
    const hasTaskId = columns.has("task_id");
    const all = ["id", "workspace_id", "manager_account_id", "note_id", "item_id", ...(hasTaskId ? ["task_id"] : []), "request_id", "payload_hash", "created_at"];
    const list = all.join(", ");
    rawDb.exec(`
      CREATE TABLE __drop_daily_note_follow_ups (
        id                 INTEGER PRIMARY KEY AUTOINCREMENT,
        workspace_id       TEXT NOT NULL,
        manager_account_id TEXT NOT NULL,
        note_id            INTEGER NOT NULL,
        item_id            INTEGER NOT NULL,
        request_id         TEXT NOT NULL,
        payload_hash       TEXT NOT NULL,
        created_at         TEXT NOT NULL${hasTaskId ? ", task_id INTEGER" : ""},
        FOREIGN KEY (note_id) REFERENCES daily_notes(id) ON DELETE CASCADE${hasTaskId ? ",\n        FOREIGN KEY (task_id) REFERENCES tasks(id)" : ""}
      );
      INSERT INTO __drop_daily_note_follow_ups (${list}) SELECT ${list} FROM daily_note_follow_ups;
      DROP TABLE daily_note_follow_ups;
      ALTER TABLE __drop_daily_note_follow_ups RENAME TO daily_note_follow_ups;
      CREATE UNIQUE INDEX idx_daily_note_follow_ups_item ON daily_note_follow_ups(item_id);
      CREATE UNIQUE INDEX idx_daily_note_follow_ups_owner_request ON daily_note_follow_ups(workspace_id, manager_account_id, request_id);
      CREATE INDEX idx_daily_note_follow_ups_note ON daily_note_follow_ups(note_id);
    `);
  }

  async apply(workspaceId: string): Promise<LegacyDropResult> {
    const scope = normalizeWorkspaceId(workspaceId);
    const plan = await this.plan(scope);
    if (plan.alreadyApplied && plan.ok) {
      return { applied: false, alreadyApplied: true, plan };
    }
    if (!plan.ok) {
      const failed = plan.checks.filter((check) => !check.ok).map((check) => `${check.name}: ${check.detail}`).join("; ");
      throw new HttpError(409, `Legacy table drop prerequisites failed — ${failed}`);
    }
    const backup = await this.backups.createManualBackup("pre-legacy-drop");
    return runInTransaction(async () => {
      if (plan.dependents.includes("daily_note_follow_ups")) {
        this.rebuildDailyNoteFollowUps();
      }
      for (const name of LEGACY_DROP_TABLES) {
        rawDb.exec(`DROP TABLE IF EXISTS ${name}`);
      }
      await db.insert(dataMigrations)
        .values({ name: "p3_legacy_drop", appliedAt: new Date().toISOString(), reportJson: JSON.stringify({ workspaceId: scope, tables: LEGACY_DROP_TABLES, dependentsRebuilt: plan.dependents }) })
        .onConflictDoNothing();
      return { applied: true, alreadyApplied: false, backup: backup.path, plan };
    });
  }
}
