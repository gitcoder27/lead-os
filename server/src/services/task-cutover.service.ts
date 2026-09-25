import { and, eq } from "drizzle-orm";
import { db, rawDb } from "../db/connection";
import { configTable, dataMigrations } from "../db/schema";
import { runInTransaction } from "../db/transaction";
import { HttpError } from "../middleware/errorHandler";
import { PHASE2B_SOAK_MS } from "./task-contract.service";
import { TaskPhase2BackfillService } from "./task-phase2-backfill.service";
import { normalizeWorkspaceId } from "./workspace.service";

export class TaskCutoverService {
  private readonly backfill = new TaskPhase2BackfillService();

  private async setting(workspaceId: string, key: string): Promise<string | undefined> {
    return (await db.select().from(configTable).where(and(eq(configTable.workspaceId, workspaceId), eq(configTable.key, key))).limit(1))[0]?.value;
  }

  async verify(workspaceId: string) {
    return runInTransaction(async () => {
      const scope = normalizeWorkspaceId(workspaceId);
      const stage = await this.setting(scope, "tasks_phase2_stage");
      if (["2b", "2c", "2d"].includes(stage ?? "")) throw new HttpError(409, "Workspace is already cut over");
      const marker = scope === "default" ? "p2_backfill" : `p2_backfill:${scope}`;
      if (!(await db.select().from(dataMigrations).where(eq(dataMigrations.name, marker))).length) throw new HttpError(409, "Apply the approved backfill before verification");
      const hash = await this.backfill.computeInputHash(scope);
      if (hash !== await this.setting(scope, "tasks_phase2_backfill_hash")) throw new HttpError(409, "Legacy writes changed the backfill snapshot; rebuild from a fresh approved snapshot");
      const result = await this.backfill.verify(scope, { strict: true });
      if (!result.ok) throw new HttpError(409, "Strict task parity failed");
      const previous = await this.setting(scope, "tasks_phase2_verified");
      const receipt = previous ? JSON.parse(previous) as { hash: string; count: number } : undefined;
      const count = receipt?.hash === hash ? receipt.count + 1 : 1;
      await db.insert(configTable).values({ workspaceId: scope, key: "tasks_phase2_verified", value: JSON.stringify({ hash, count }) }).onConflictDoUpdate({ target: [configTable.workspaceId, configTable.key], set: { value: JSON.stringify({ hash, count }) } });
      return { ...result, hash, consecutiveCleanRuns: count };
    });
  }

  async cutover(workspaceId: string, apply = false) {
    return runInTransaction(async () => {
      const scope = normalizeWorkspaceId(workspaceId);
      const stage = await this.setting(scope, "tasks_phase2_stage");
      if (["2b", "2c", "2d"].includes(stage ?? "")) return { workspaceId: scope, stage, applied: false, alreadyApplied: true };
      const raw = await this.setting(scope, "tasks_phase2_verified");
      const receipt = raw ? JSON.parse(raw) as { hash: string; count: number } : undefined;
      const hash = await this.backfill.computeInputHash(scope);
      if (!receipt || receipt.count < 2 || receipt.hash !== hash) throw new HttpError(409, "Two clean strict verifications of the current snapshot are required");
      const verified = await this.backfill.verify(scope, { strict: true });
      if (!verified.ok) throw new HttpError(409, "Strict parity failed");
      const seed = (rawDb.prepare("SELECT MAX(value) AS value FROM (SELECT COALESCE(MAX(id),0) AS value FROM team_tracker_items UNION ALL SELECT COALESCE(MAX(id),0) FROM manager_desk_items)").get() as { value: number }).value;
      if (rawDb.prepare("SELECT 1 FROM tasks WHERE workspace_id = ? AND id <= ? LIMIT 1").get(scope, seed)) throw new HttpError(409, "Rebuild the shadow backfill to reserve canonical IDs above legacy IDs");
      if (!apply) return { workspaceId: scope, stage: "2b", applied: false, seed };
      // §2.1.3: unconditional read-only guards; `tasks:export-legacy` drops
      // them physically on rollback.
      for (const table of ["team_tracker_items", "manager_desk_items", "manager_desk_links"] as const) {
        for (const operation of ["INSERT", "UPDATE", "DELETE"] as const) {
          rawDb.exec(`CREATE TRIGGER IF NOT EXISTS legacy_ro_${table}_${operation.toLowerCase()} BEFORE ${operation} ON ${table}
            BEGIN SELECT RAISE(ABORT, 'Legacy task tables are read-only after task cutover'); END`);
        }
      }
      rawDb.prepare("UPDATE sqlite_sequence SET seq = MAX(seq, ?) WHERE name = 'tasks'").run(seed);
      if (!(rawDb.prepare("SELECT 1 FROM sqlite_sequence WHERE name = 'tasks'").get())) rawDb.prepare("INSERT INTO sqlite_sequence(name,seq) VALUES ('tasks',?)").run(seed);
      for (const [key, value] of [["tasks_phase1_enabled", "true"], ["tasks_phase2_id_seed", String(seed)], ["tasks_phase2_stage", "2b"], ["tasks_phase2_cutover_at", new Date().toISOString()]]) {
        await db.insert(configTable).values({ workspaceId: scope, key: key!, value: value! }).onConflictDoUpdate({ target: [configTable.workspaceId, configTable.key], set: { value: value! } });
      }
      return { workspaceId: scope, stage: "2b", applied: true, seed };
    });
  }

  /**
   * Stage transition 2b → 2c (§2.3.2): requires the one-week post-cutover
   * soak so adapter behaviour is exercised before native surfaces ship.
   */
  async advanceTo2c(workspaceId: string, apply = false) {
    return runInTransaction(async () => {
      const scope = normalizeWorkspaceId(workspaceId);
      const stage = await this.setting(scope, "tasks_phase2_stage");
      if (stage === "2c") return { workspaceId: scope, stage: "2c", applied: false, alreadyApplied: true };
      if (stage !== "2b") throw new HttpError(409, `Cannot enter 2c from stage "${stage ?? "unset"}"`);
      const cutoverAt = Date.parse((await this.setting(scope, "tasks_phase2_cutover_at")) ?? "");
      if (!Number.isFinite(cutoverAt)) throw new HttpError(409, "tasks_phase2_cutover_at is unset");
      const elapsed = Date.now() - cutoverAt;
      if (elapsed < PHASE2B_SOAK_MS) {
        throw new HttpError(409, `2b soak incomplete: ${Math.floor(elapsed / 86400000)}d elapsed, ${PHASE2B_SOAK_MS / 86400000}d required`);
      }
      if (!apply) return { workspaceId: scope, stage: "2c", applied: false, soakDays: Math.floor(elapsed / 86400000) };
      const now = new Date().toISOString();
      for (const [key, value] of [["tasks_phase2_stage", "2c"], ["tasks_phase2c_started_at", now]]) {
        await db.insert(configTable).values({ workspaceId: scope, key: key!, value: value! }).onConflictDoUpdate({ target: [configTable.workspaceId, configTable.key], set: { value: value! } });
      }
      return { workspaceId: scope, stage: "2c", applied: true };
    });
  }

  /**
   * Explicit 2c completion marker (§2.3.2 exit criterion: "each surface's
   * tests green; no adapter callers left"). The two-week post-2c soak for the
   * 2d contract is measured from this timestamp.
   */
  async complete2c(workspaceId: string, apply = false) {
    return runInTransaction(async () => {
      const scope = normalizeWorkspaceId(workspaceId);
      const stage = await this.setting(scope, "tasks_phase2_stage");
      if (stage !== "2c") throw new HttpError(409, `Cannot mark 2c complete at stage "${stage ?? "unset"}"`);
      if (await this.setting(scope, "tasks_phase2c_completed_at")) {
        return { workspaceId: scope, stage, applied: false, alreadyApplied: true };
      }
      const now = new Date().toISOString();
      if (!apply) return { workspaceId: scope, stage, applied: false, completedAt: now };
      await db.insert(configTable).values({ workspaceId: scope, key: "tasks_phase2c_completed_at", value: now })
        .onConflictDoUpdate({ target: [configTable.workspaceId, configTable.key], set: { value: now } });
      return { workspaceId: scope, stage, applied: true, completedAt: now };
    });
  }
}