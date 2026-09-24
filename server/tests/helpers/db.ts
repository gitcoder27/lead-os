import { db, rawDb } from "../../src/db/connection";
import { migrate } from "../../src/db/migrate";

export async function resetDatabase(): Promise<void> {
  // Clear migration markers before migrate() so a p2_backfill marker left by a
  // previous test does not contract task_events.task_id to NOT NULL.
  const hasMigrations = rawDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='data_migrations'").get();
  if (hasMigrations) rawDb.exec("DELETE FROM data_migrations;");
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
    'daily_notes', 'daily_note_captures', 'daily_note_follow_ups', 'task_events', 'assistant_conversations', 'assistant_messages', 'assistant_memories', 'tasks', 'task_links', 'day_focus');
  `);
}

export { db };
