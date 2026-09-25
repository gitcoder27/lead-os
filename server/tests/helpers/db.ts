import { db, rawDb } from "../../src/db/connection";
import { migrate } from "../../src/db/migrate";

export async function resetDatabase(): Promise<void> {
  // Clear migration markers before migrate() so a p2_backfill marker left by a
  // previous test does not contract task_events.task_id to NOT NULL.
  const hasMigrations = rawDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='data_migrations'").get();
  if (hasMigrations) rawDb.exec("DELETE FROM data_migrations;");
  // Recover from contract tests: drop leftover write-guard triggers and
  // restore legacy_* archive renames before migrate() recreates the tables.
  for (const table of ["team_tracker_items", "manager_desk_items", "manager_desk_links"]) {
    for (const op of ["insert", "update", "delete"]) {
      rawDb.exec(`DROP TRIGGER IF EXISTS legacy_ro_${table}_${op}`);
    }
    if (rawDb.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='legacy_${table}'`).get()) {
      rawDb.exec(`DROP TABLE IF EXISTS ${table}`);
      rawDb.exec(`ALTER TABLE legacy_${table} RENAME TO ${table}`);
    }
  }
  // Recover from drop-legacy tests: after `legacy_*` tables are dropped,
  // daily_note_follow_ups may hold a dangling FK to them, which breaks even
  // plain DELETEs under foreign_keys=ON. Drop it so migrate() recreates a
  // clean copy against the restored originals.
  const followUpSql = rawDb.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='daily_note_follow_ups'").get() as { sql?: string } | undefined;
  const danglingRefs = [...(followUpSql?.sql ?? "").matchAll(/references\s+"?legacy_(team_tracker_items|manager_desk_items|manager_desk_links)"?\s*\(/gi)]
    .map((match) => `legacy_${match[1]}`)
    .filter((name) => !rawDb.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
  const referencesDeskItems = /references\s+"?(?:legacy_)?manager_desk_items"?\s*\(/i.test(followUpSql?.sql ?? "");
  // Drop it when the FK dangles to a dropped archive OR when a drop-legacy
  // rebuild removed the desk-items reference while the table is being
  // restored to its pre-contract shape (migrate() recreates it).
  if (danglingRefs.length || (followUpSql && !referencesDeskItems)) {
    rawDb.exec("DROP TABLE IF EXISTS daily_note_follow_ups");
  }
  // A contract test may leave task_events contracted (task_id NOT NULL);
  // rebuild it back to the pre-2d nullable shape once markers are cleared.
  const taskEventCols = rawDb.prepare("PRAGMA table_info(task_events)").all() as { name: string; notnull: number }[];
  if (taskEventCols.length && taskEventCols.find((c) => c.name === "task_id")?.notnull) {
    rawDb.exec(`
      CREATE TABLE __task_events_expand (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        workspace_id TEXT NOT NULL DEFAULT 'default',
        task_key     TEXT NOT NULL,
        task_id      INTEGER REFERENCES tasks(id),
        type         TEXT NOT NULL,
        body         TEXT,
        visibility   TEXT NOT NULL CHECK (visibility IN ('shared', 'private')),
        author_type  TEXT NOT NULL CHECK (author_type IN ('manager', 'developer', 'copilot', 'system')),
        author_id    TEXT,
        meta_json    TEXT,
        source_table TEXT,
        source_id    INTEGER,
        dedupe_key   TEXT,
        occurred_at  TEXT NOT NULL,
        created_at   TEXT NOT NULL,
        redacted_at  TEXT,
        redacted_by  TEXT
      );
      INSERT INTO __task_events_expand (id, workspace_id, task_key, task_id, type, body, visibility, author_type, author_id, meta_json, source_table, source_id, dedupe_key, occurred_at, created_at, redacted_at, redacted_by)
        SELECT id, workspace_id, task_key, task_id, type, body, visibility, author_type, author_id, meta_json, source_table, source_id, dedupe_key, occurred_at, created_at, redacted_at, redacted_by FROM task_events;
      DROP TABLE task_events;
      ALTER TABLE __task_events_expand RENAME TO task_events;
    `);
  }
  rawDb.exec(`
    DROP TABLE IF EXISTS manager_desk_item_history;
  `);
  migrate(rawDb);
  rawDb.exec(`
    DELETE FROM alert_dismissals;
    DELETE FROM app_sessions;
    DELETE FROM app_users;
    DELETE FROM daily_note_task_refs;
    DELETE FROM checkin_task_refs;
    DELETE FROM task_events;
    DELETE FROM task_key_aliases;
    DELETE FROM task_key_sequences;
    DELETE FROM data_migrations;
    DELETE FROM daily_note_follow_ups;
    DELETE FROM daily_note_captures;
    DELETE FROM daily_notes;
    DELETE FROM task_links;
    DELETE FROM day_focus;
    DELETE FROM task_labels;
    DELETE FROM task_saved_views;
    DELETE FROM task_legacy_map;
    DELETE FROM developer_notes;
    DELETE FROM tasks;
    DELETE FROM user_nav_preferences;
    DELETE FROM manager_desk_item_history;
    DELETE FROM manager_desk_links;
    DELETE FROM manager_desk_items;
    DELETE FROM manager_desk_days;
    DELETE FROM developer_availability_periods;
    DELETE FROM team_tracker_checkins;
    DELETE FROM team_tracker_items;
    DELETE FROM team_tracker_days;
    DELETE FROM team_tracker_saved_views;
    DELETE FROM work_saved_views;
    DELETE FROM issue_scope_history;
    DELETE FROM issue_tags;
    DELETE FROM local_tags;
    DELETE FROM component_map;
    DELETE FROM issues;
    DELETE FROM developers;
    DELETE FROM sync_log;
    DELETE FROM config;
    DELETE FROM workspaces WHERE id <> 'default';
    DELETE FROM assistant_messages;
    DELETE FROM assistant_conversations;
    DELETE FROM assistant_memories;
    DELETE FROM sqlite_sequence WHERE name IN ('app_users', 'local_tags', 'sync_log', 'issue_scope_history', 'team_tracker_days', 'developer_availability_periods', 'team_tracker_items', 'team_tracker_checkins', 'team_tracker_saved_views',
    'work_saved_views', 'manager_desk_days', 'manager_desk_items', 'manager_desk_links', 'manager_desk_item_history',
    'daily_notes', 'daily_note_captures', 'daily_note_follow_ups', 'task_events', 'assistant_conversations', 'assistant_messages', 'assistant_memories', 'tasks', 'task_links', 'day_focus', 'task_labels', 'task_saved_views');
  `);
}

export { db };
