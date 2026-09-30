import type BetterSqlite3 from "better-sqlite3";

/**
 * docs/56 P3-00a: a workspace with nothing to backfill starts on the canonical task model.
 *
 * Only the cutover CLI used to set `tasks_phase2_stage`, so a fresh install (or a new manager's
 * workspace) ran the legacy Desk model, and capture and every Phase 3 surface answered 404. This
 * writes the config a completed cutover leaves behind (stage `2c`, Phase 3 on, id seed `0` so every
 * task id is its own surface id) for a workspace that
 * - has no `tasks_phase2_stage` at all (any stage, including `rolled_back`, is left alone), and
 * - has no rows in `tasks`, `manager_desk_items` or `team_tracker_items` (nothing to backfill).
 * A workspace with legacy task data keeps its stage and still goes through the cutover tooling.
 * Idempotent; returns true when it switched the workspace.
 */
export function startCanonicalTasksIfEmpty(sqlite: BetterSqlite3.Database, workspaceId: string, now = new Date()): boolean {
  const exists = (sql: string, ...params: unknown[]) => Boolean(sqlite.prepare(sql).get(...params));
  if (exists("SELECT 1 FROM config WHERE workspace_id = ? AND key = 'tasks_phase2_stage'", workspaceId)) {
    return false;
  }
  for (const table of ["tasks", "manager_desk_items", "team_tracker_items"]) {
    // After the 2d contract the legacy tables are renamed away; a missing table holds nothing.
    if (!exists("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", table)) continue;
    if (exists(`SELECT 1 FROM ${table} WHERE workspace_id = ? LIMIT 1`, workspaceId)) {
      return false;
    }
  }
  const at = now.toISOString();
  const insert = sqlite.prepare(
    "INSERT INTO config (workspace_id, key, value) VALUES (?, ?, ?) ON CONFLICT(workspace_id, key) DO NOTHING"
  );
  sqlite.transaction(() => {
    for (const [key, value] of [
      ["tasks_phase1_enabled", "true"],
      ["tasks_phase2_id_seed", "0"],
      ["tasks_phase2_cutover_at", at],
      ["tasks_phase2c_started_at", at],
      ["tasks_phase2c_completed_at", at],
      ["tasks_phase3_enabled", "true"],
      ["tasks_canonical_from_start_at", at],
      // Last, so a reader never sees stage 2c without the rest.
      ["tasks_phase2_stage", "2c"],
    ] as const) {
      insert.run(workspaceId, key, value);
    }
  })();
  return true;
}

/** Runs `startCanonicalTasksIfEmpty` for every workspace; returns the ids it switched. */
export function startCanonicalTasksForEmptyWorkspaces(sqlite: BetterSqlite3.Database, now = new Date()): string[] {
  const rows = sqlite.prepare("SELECT id FROM workspaces ORDER BY id").all() as Array<{ id: string }>;
  return rows.filter(({ id }) => startCanonicalTasksIfEmpty(sqlite, id, now)).map(({ id }) => id);
}
