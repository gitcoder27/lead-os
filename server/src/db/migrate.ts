import BetterSqlite3 from "better-sqlite3";
import { encryptSecretIfNeeded, isEncryptedSecret } from "../services/secret-crypto";

const DEFAULT_WORKSPACE_ID = "default";

const ddl = `
CREATE TABLE IF NOT EXISTS workspaces (
  id               TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  owner_account_id TEXT,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS issues (
  workspace_id    TEXT NOT NULL DEFAULT 'default',
  jira_key        TEXT NOT NULL,
  summary         TEXT NOT NULL,
  description     TEXT,
  aspen_severity  TEXT,
  priority_name   TEXT NOT NULL,
  priority_id     TEXT NOT NULL,
  status_name     TEXT NOT NULL,
  status_category TEXT NOT NULL,
  assignee_id     TEXT,
  assignee_name   TEXT,
  team_scope_state TEXT NOT NULL DEFAULT 'in_team',
  sync_scope_state TEXT NOT NULL DEFAULT 'active',
  reporter_name   TEXT,
  component       TEXT,
  labels          TEXT,
  due_date        TEXT,
  flagged         INTEGER DEFAULT 0,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  synced_at       TEXT NOT NULL,
  last_seen_in_scoped_sync_at TEXT,
  last_reconciled_at TEXT,
  scope_changed_at TEXT,
  PRIMARY KEY (workspace_id, jira_key)
);

CREATE TABLE IF NOT EXISTS developers (
  workspace_id  TEXT NOT NULL DEFAULT 'default',
  account_id   TEXT NOT NULL,
  display_name TEXT NOT NULL,
  email        TEXT,
  avatar_url   TEXT,
  source       TEXT NOT NULL DEFAULT 'jira',
  jira_account_id TEXT,
  is_active    INTEGER DEFAULT 1,
  PRIMARY KEY (workspace_id, account_id)
);

CREATE TABLE IF NOT EXISTS app_users (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id         TEXT NOT NULL DEFAULT 'default',
  username             TEXT NOT NULL UNIQUE,
  display_name         TEXT NOT NULL,
  password_hash        TEXT NOT NULL,
  role                 TEXT NOT NULL,
  developer_account_id TEXT,
  is_active            INTEGER NOT NULL DEFAULT 1,
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS app_sessions (
  id           TEXT PRIMARY KEY,
  user_id      INTEGER NOT NULL,
  created_at   TEXT NOT NULL,
  expires_at   TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES app_users(id)
);

CREATE TABLE IF NOT EXISTS alert_dismissals (
  workspace_id        TEXT NOT NULL DEFAULT 'default',
  manager_account_id TEXT NOT NULL,
  alert_id           TEXT NOT NULL,
  dismissed_at       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS component_map (
  workspace_id    TEXT NOT NULL DEFAULT 'default',
  component_name TEXT NOT NULL,
  account_id     TEXT NOT NULL,
  fix_count      INTEGER DEFAULT 0,
  PRIMARY KEY (workspace_id, component_name, account_id)
);

CREATE TABLE IF NOT EXISTS sync_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id  TEXT NOT NULL DEFAULT 'default',
  started_at    TEXT NOT NULL,
  completed_at  TEXT,
  status        TEXT NOT NULL,
  issues_synced INTEGER DEFAULT 0,
  error_message TEXT
);

CREATE TABLE IF NOT EXISTS config (
  workspace_id TEXT NOT NULL DEFAULT 'default',
  key          TEXT NOT NULL,
  value        TEXT NOT NULL,
  PRIMARY KEY (workspace_id, key)
);

CREATE INDEX IF NOT EXISTS idx_issues_workspace_assignee ON issues(workspace_id, assignee_id);
CREATE INDEX IF NOT EXISTS idx_issues_workspace_status ON issues(workspace_id, status_category);
CREATE INDEX IF NOT EXISTS idx_issues_workspace_priority ON issues(workspace_id, priority_name);
CREATE INDEX IF NOT EXISTS idx_issues_workspace_due_date ON issues(workspace_id, due_date);
CREATE INDEX IF NOT EXISTS idx_issues_workspace_updated ON issues(workspace_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_issues_workspace_flagged ON issues(workspace_id, flagged);

CREATE TABLE IF NOT EXISTS local_tags (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id TEXT NOT NULL DEFAULT 'default',
  name         TEXT NOT NULL,
  color        TEXT NOT NULL DEFAULT '#6366f1',
  UNIQUE(workspace_id, name)
);

CREATE TABLE IF NOT EXISTS issue_tags (
  workspace_id TEXT NOT NULL DEFAULT 'default',
  jira_key     TEXT NOT NULL,
  tag_id       INTEGER NOT NULL,
  PRIMARY KEY (workspace_id, jira_key, tag_id),
  FOREIGN KEY (tag_id) REFERENCES local_tags(id)
);

CREATE TABLE IF NOT EXISTS issue_scope_history (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id          TEXT NOT NULL DEFAULT 'default',
  jira_key              TEXT NOT NULL,
  observed_at           TEXT NOT NULL,
  change_type           TEXT NOT NULL,
  from_assignee_id      TEXT,
  to_assignee_id        TEXT,
  from_team_scope_state TEXT,
  to_team_scope_state   TEXT,
  from_sync_scope_state TEXT,
  to_sync_scope_state   TEXT,
  from_status_category  TEXT,
  to_status_category    TEXT
);

CREATE TABLE IF NOT EXISTS team_tracker_days (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id          TEXT NOT NULL DEFAULT 'default',
  date                  TEXT NOT NULL,
  developer_account_id  TEXT NOT NULL,
  status                TEXT NOT NULL DEFAULT 'on_track',
  capacity_units        INTEGER,
  manager_notes         TEXT,
  last_check_in_at      TEXT,
  next_follow_up_at     TEXT,
  status_updated_at     TEXT,
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL,
  UNIQUE(workspace_id, date, developer_account_id)
);

CREATE TABLE IF NOT EXISTS developer_availability_periods (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id          TEXT NOT NULL DEFAULT 'default',
  developer_account_id  TEXT NOT NULL,
  start_date            TEXT NOT NULL,
  end_date              TEXT,
  note                  TEXT,
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS team_tracker_items (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id  TEXT NOT NULL DEFAULT 'default',
  day_id        INTEGER NOT NULL,
  manager_desk_item_id INTEGER,
  item_type     TEXT NOT NULL,
  jira_key      TEXT,
  related_jira_keys TEXT,
  title         TEXT NOT NULL,
  state         TEXT NOT NULL DEFAULT 'planned',
  position      INTEGER NOT NULL DEFAULT 0,
  note          TEXT,
  completed_at  TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  FOREIGN KEY (day_id) REFERENCES team_tracker_days(id)
);

CREATE TABLE IF NOT EXISTS team_tracker_checkins (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id TEXT NOT NULL DEFAULT 'default',
  day_id      INTEGER NOT NULL,
  summary     TEXT NOT NULL,
  status      TEXT,
  rationale   TEXT,
  next_follow_up_at TEXT,
  author_type TEXT NOT NULL DEFAULT 'manager',
  author_account_id TEXT,
  created_at  TEXT NOT NULL,
  FOREIGN KEY (day_id) REFERENCES team_tracker_days(id)
);

CREATE TABLE IF NOT EXISTS team_tracker_saved_views (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id       TEXT NOT NULL DEFAULT 'default',
  manager_account_id TEXT NOT NULL,
  name               TEXT NOT NULL,
  search_query       TEXT,
  summary_filter     TEXT NOT NULL,
  sort_by            TEXT NOT NULL,
  group_by           TEXT NOT NULL,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS work_saved_views (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id        TEXT NOT NULL DEFAULT 'default',
  manager_account_id  TEXT NOT NULL,
  name                TEXT NOT NULL,
  filter              TEXT NOT NULL DEFAULT 'all',
  developer_account_id TEXT,
  tag_id              INTEGER,
  no_tags             INTEGER NOT NULL DEFAULT 0,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS manager_desk_days (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id       TEXT NOT NULL DEFAULT 'default',
  date               TEXT NOT NULL,
  manager_account_id TEXT NOT NULL,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL,
  UNIQUE(workspace_id, date, manager_account_id)
);

CREATE TABLE IF NOT EXISTS manager_desk_items (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id     TEXT NOT NULL DEFAULT 'default',
  day_id           INTEGER NOT NULL,
  source_item_id   INTEGER,
  assignee_developer_account_id TEXT,
  title            TEXT NOT NULL,
  kind             TEXT NOT NULL,
  category         TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'inbox',
  priority         TEXT NOT NULL DEFAULT 'medium',
  participants     TEXT,
  context_note     TEXT,
  next_action      TEXT,
  outcome          TEXT,
  planned_start_at TEXT,
  planned_end_at   TEXT,
  follow_up_at     TEXT,
  completed_at     TEXT,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  FOREIGN KEY (day_id) REFERENCES manager_desk_days(id),
  FOREIGN KEY (source_item_id) REFERENCES manager_desk_items(id)
);

CREATE TABLE IF NOT EXISTS manager_desk_links (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id         TEXT NOT NULL DEFAULT 'default',
  item_id              INTEGER NOT NULL,
  link_type            TEXT NOT NULL,
  issue_key            TEXT,
  developer_account_id TEXT,
  external_label       TEXT,
  created_at           TEXT NOT NULL,
  FOREIGN KEY (item_id) REFERENCES manager_desk_items(id)
);

CREATE TABLE IF NOT EXISTS manager_desk_item_history (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id       TEXT NOT NULL DEFAULT 'default',
  item_id            INTEGER NOT NULL,
  manager_account_id TEXT NOT NULL,
  event_type         TEXT NOT NULL,
  snapshot_json      TEXT NOT NULL,
  recorded_at        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS daily_notes (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id       TEXT NOT NULL,
  manager_account_id TEXT NOT NULL,
  date               TEXT NOT NULL,
  body               TEXT NOT NULL,
  revision           INTEGER NOT NULL DEFAULT 1,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS daily_note_captures (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id       TEXT NOT NULL,
  manager_account_id TEXT NOT NULL,
  note_id            INTEGER NOT NULL,
  request_id         TEXT NOT NULL,
  payload_hash       TEXT NOT NULL,
  created_at         TEXT NOT NULL,
  FOREIGN KEY (note_id) REFERENCES daily_notes(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS daily_note_follow_ups (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id       TEXT NOT NULL,
  manager_account_id TEXT NOT NULL,
  note_id            INTEGER NOT NULL,
  item_id            INTEGER NOT NULL,
  request_id         TEXT NOT NULL,
  payload_hash       TEXT NOT NULL,
  created_at         TEXT NOT NULL,
  FOREIGN KEY (note_id) REFERENCES daily_notes(id) ON DELETE CASCADE,
  FOREIGN KEY (item_id) REFERENCES manager_desk_items(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS user_nav_preferences (
  workspace_id       TEXT NOT NULL DEFAULT 'default',
  manager_account_id TEXT NOT NULL,
  top_nav            TEXT NOT NULL,
  more_nav           TEXT NOT NULL,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL,
  PRIMARY KEY (workspace_id, manager_account_id)
);

CREATE TABLE IF NOT EXISTS task_key_sequences (
  workspace_id TEXT PRIMARY KEY,
  next_value INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS task_key_aliases (
  workspace_id TEXT NOT NULL,
  alias_key TEXT NOT NULL,
  task_key TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, alias_key)
);

CREATE TABLE IF NOT EXISTS data_migrations (
  name TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL,
  report_json TEXT
);

CREATE TABLE IF NOT EXISTS task_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id TEXT NOT NULL DEFAULT 'default',
  task_key TEXT NOT NULL,
  type TEXT NOT NULL,
  body TEXT,
  visibility TEXT NOT NULL CHECK (visibility IN ('shared', 'private')),
  author_type TEXT NOT NULL CHECK (author_type IN ('manager', 'developer', 'copilot', 'system')),
  author_id TEXT,
  meta_json TEXT,
  source_table TEXT,
  source_id INTEGER,
  dedupe_key TEXT,
  occurred_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  redacted_at TEXT,
  redacted_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_task_events_workspace_key_time ON task_events(workspace_id, task_key, occurred_at, id);
CREATE INDEX IF NOT EXISTS idx_task_events_workspace_author ON task_events(workspace_id, author_type, author_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_task_events_workspace_dedupe ON task_events(workspace_id, dedupe_key) WHERE dedupe_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS checkin_task_refs (
  workspace_id TEXT NOT NULL DEFAULT 'default',
  checkin_id INTEGER NOT NULL,
  task_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, checkin_id, task_key),
  FOREIGN KEY (checkin_id) REFERENCES team_tracker_checkins(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_checkin_task_refs_key ON checkin_task_refs(workspace_id, task_key);

CREATE TABLE IF NOT EXISTS daily_note_task_refs (
  workspace_id TEXT NOT NULL,
  manager_account_id TEXT NOT NULL,
  note_id INTEGER NOT NULL,
  task_key TEXT NOT NULL,
  relation TEXT NOT NULL,
  request_id TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (note_id, task_key, relation),
  FOREIGN KEY (note_id) REFERENCES daily_notes(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_note_task_refs_request ON daily_note_task_refs(workspace_id, manager_account_id, request_id) WHERE request_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_app_users_username ON app_users(username);
CREATE INDEX IF NOT EXISTS idx_app_users_workspace ON app_users(workspace_id);
CREATE INDEX IF NOT EXISTS idx_app_users_workspace_dev_account ON app_users(workspace_id, developer_account_id);
CREATE INDEX IF NOT EXISTS idx_app_sessions_user ON app_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_app_sessions_expires ON app_sessions(expires_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_alert_dismissals_workspace_manager_alert ON alert_dismissals(workspace_id, manager_account_id, alert_id);
CREATE INDEX IF NOT EXISTS idx_alert_dismissals_workspace_manager ON alert_dismissals(workspace_id, manager_account_id);
CREATE INDEX IF NOT EXISTS idx_tracker_days_workspace_date ON team_tracker_days(workspace_id, date);
CREATE INDEX IF NOT EXISTS idx_tracker_days_workspace_dev ON team_tracker_days(workspace_id, developer_account_id);
CREATE INDEX IF NOT EXISTS idx_tracker_days_workspace_developer_date ON team_tracker_days(workspace_id, developer_account_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_dev_availability_workspace_dev_dates ON developer_availability_periods(workspace_id, developer_account_id, start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_tracker_items_workspace_day ON team_tracker_items(workspace_id, day_id);
CREATE INDEX IF NOT EXISTS idx_tracker_checkins_workspace_day ON team_tracker_checkins(workspace_id, day_id);
CREATE INDEX IF NOT EXISTS idx_tracker_saved_views_workspace_manager ON team_tracker_saved_views(workspace_id, manager_account_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tracker_saved_views_workspace_manager_name ON team_tracker_saved_views(workspace_id, manager_account_id, name);
CREATE INDEX IF NOT EXISTS idx_work_saved_views_workspace_manager ON work_saved_views(workspace_id, manager_account_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_work_saved_views_workspace_manager_name ON work_saved_views(workspace_id, manager_account_id, name);
CREATE INDEX IF NOT EXISTS idx_manager_desk_days_workspace_manager_date ON manager_desk_days(workspace_id, manager_account_id, date);
CREATE INDEX IF NOT EXISTS idx_manager_desk_items_workspace_day ON manager_desk_items(workspace_id, day_id);
CREATE INDEX IF NOT EXISTS idx_manager_desk_items_workspace_status ON manager_desk_items(workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_manager_desk_items_workspace_follow_up_at ON manager_desk_items(workspace_id, follow_up_at);
CREATE INDEX IF NOT EXISTS idx_manager_desk_items_workspace_source_item_id ON manager_desk_items(workspace_id, source_item_id);
CREATE INDEX IF NOT EXISTS idx_manager_desk_links_workspace_item ON manager_desk_links(workspace_id, item_id);
CREATE INDEX IF NOT EXISTS idx_manager_desk_links_workspace_issue_key ON manager_desk_links(workspace_id, issue_key);
CREATE INDEX IF NOT EXISTS idx_manager_desk_links_workspace_developer_account_id ON manager_desk_links(workspace_id, developer_account_id);
CREATE INDEX IF NOT EXISTS idx_manager_desk_item_history_workspace_item_recorded ON manager_desk_item_history(workspace_id, item_id, recorded_at);
CREATE INDEX IF NOT EXISTS idx_manager_desk_item_history_workspace_manager_recorded ON manager_desk_item_history(workspace_id, manager_account_id, recorded_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_notes_owner_date ON daily_notes(workspace_id, manager_account_id, date);
CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_note_captures_owner_request ON daily_note_captures(workspace_id, manager_account_id, request_id);
CREATE INDEX IF NOT EXISTS idx_daily_note_captures_note ON daily_note_captures(note_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_note_follow_ups_item ON daily_note_follow_ups(item_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_note_follow_ups_owner_request ON daily_note_follow_ups(workspace_id, manager_account_id, request_id);
CREATE INDEX IF NOT EXISTS idx_daily_note_follow_ups_note ON daily_note_follow_ups(note_id);

CREATE TABLE IF NOT EXISTS assistant_conversations (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id       TEXT NOT NULL DEFAULT 'default',
  manager_account_id TEXT NOT NULL,
  title              TEXT NOT NULL,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS assistant_messages (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL,
  role            TEXT NOT NULL,
  content         TEXT NOT NULL DEFAULT '',
  tool_calls      TEXT,
  tool_call_id    TEXT,
  created_at      TEXT NOT NULL,
  FOREIGN KEY (conversation_id) REFERENCES assistant_conversations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_assistant_conversations_owner ON assistant_conversations(workspace_id, manager_account_id);
CREATE INDEX IF NOT EXISTS idx_assistant_messages_conversation ON assistant_messages(conversation_id, created_at);

-- Manager-scoped durable memories for Copilot — short facts/preferences the
-- manager confirms saving ("Priya prefers async updates"). Injected into the
-- system prompt's volatile tail so they apply to every answer.
CREATE TABLE IF NOT EXISTS assistant_memories (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id       TEXT NOT NULL DEFAULT 'default',
  manager_account_id TEXT NOT NULL,
  text               TEXT NOT NULL,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_assistant_memories_owner ON assistant_memories(workspace_id, manager_account_id);

-- FTS5 index over note bodies so Copilot search ranks relevance instead of
-- substring-scanning every note. External-content table synced by triggers;
-- the last INSERT backfills rows written before this index existed (and
-- heals it if a table rebuild ever drops the triggers).
CREATE VIRTUAL TABLE IF NOT EXISTS daily_notes_fts USING fts5(date, body, content='daily_notes', content_rowid='id');

CREATE TRIGGER IF NOT EXISTS daily_notes_fts_ai AFTER INSERT ON daily_notes BEGIN
  INSERT INTO daily_notes_fts(rowid, date, body) VALUES (new.id, new.date, new.body);
END;

CREATE TRIGGER IF NOT EXISTS daily_notes_fts_ad AFTER DELETE ON daily_notes BEGIN
  INSERT INTO daily_notes_fts(daily_notes_fts, rowid, date, body) VALUES('delete', old.id, old.date, old.body);
END;

CREATE TRIGGER IF NOT EXISTS daily_notes_fts_au AFTER UPDATE ON daily_notes BEGIN
  INSERT INTO daily_notes_fts(daily_notes_fts, rowid, date, body) VALUES('delete', old.id, old.date, old.body);
  INSERT INTO daily_notes_fts(rowid, date, body) VALUES (new.id, new.date, new.body);
END;

INSERT INTO daily_notes_fts(rowid, date, body)
SELECT id, date, body FROM daily_notes WHERE id NOT IN (SELECT rowid FROM daily_notes_fts);
`;

const alterStatements = [
  "ALTER TABLE issues ADD COLUMN aspen_severity TEXT",
  "ALTER TABLE issues ADD COLUMN development_due_date TEXT",
  "ALTER TABLE issues ADD COLUMN analysis_notes TEXT",
  "ALTER TABLE issues ADD COLUMN team_scope_state TEXT NOT NULL DEFAULT 'in_team'",
  "ALTER TABLE issues ADD COLUMN sync_scope_state TEXT NOT NULL DEFAULT 'active'",
  "ALTER TABLE issues ADD COLUMN last_seen_in_scoped_sync_at TEXT",
  "ALTER TABLE issues ADD COLUMN last_reconciled_at TEXT",
  "ALTER TABLE issues ADD COLUMN scope_changed_at TEXT",
  "CREATE INDEX IF NOT EXISTS idx_issues_team_scope ON issues(team_scope_state)",
  "CREATE INDEX IF NOT EXISTS idx_issues_sync_scope ON issues(sync_scope_state)",
  "CREATE INDEX IF NOT EXISTS idx_issues_workload_scope ON issues(team_scope_state, sync_scope_state, status_category, assignee_id)",
  "CREATE INDEX IF NOT EXISTS idx_issue_scope_history_key_observed ON issue_scope_history(jira_key, observed_at DESC)",
  "CREATE TABLE IF NOT EXISTS alert_dismissals (manager_account_id TEXT NOT NULL, alert_id TEXT NOT NULL, dismissed_at TEXT NOT NULL)",
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_alert_dismissals_manager_alert ON alert_dismissals(manager_account_id, alert_id)",
  "CREATE INDEX IF NOT EXISTS idx_alert_dismissals_manager ON alert_dismissals(manager_account_id)",
  "ALTER TABLE issues ADD COLUMN excluded INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE developers ADD COLUMN source TEXT NOT NULL DEFAULT 'jira'",
  "ALTER TABLE developers ADD COLUMN jira_account_id TEXT",
  "UPDATE developers SET jira_account_id = account_id WHERE (source IS NULL OR source = 'jira') AND (jira_account_id IS NULL OR jira_account_id = '')",
  "CREATE INDEX IF NOT EXISTS idx_developers_jira_account_id ON developers(jira_account_id)",
  "ALTER TABLE team_tracker_days ADD COLUMN capacity_units INTEGER",
  "ALTER TABLE team_tracker_days ADD COLUMN next_follow_up_at TEXT",
  "ALTER TABLE team_tracker_days ADD COLUMN status_updated_at TEXT",
  "CREATE TABLE IF NOT EXISTS developer_availability_periods (id INTEGER PRIMARY KEY AUTOINCREMENT, developer_account_id TEXT NOT NULL, start_date TEXT NOT NULL, end_date TEXT, note TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)",
  "CREATE INDEX IF NOT EXISTS idx_dev_availability_dev_dates ON developer_availability_periods(developer_account_id, start_date, end_date)",
  "ALTER TABLE team_tracker_checkins ADD COLUMN status TEXT",
  "ALTER TABLE team_tracker_checkins ADD COLUMN rationale TEXT",
  "ALTER TABLE team_tracker_checkins ADD COLUMN next_follow_up_at TEXT",
  "ALTER TABLE team_tracker_checkins ADD COLUMN author_type TEXT NOT NULL DEFAULT 'manager'",
  "ALTER TABLE team_tracker_checkins ADD COLUMN author_account_id TEXT",
  "CREATE TABLE IF NOT EXISTS team_tracker_saved_views (id INTEGER PRIMARY KEY AUTOINCREMENT, manager_account_id TEXT NOT NULL, name TEXT NOT NULL, search_query TEXT, summary_filter TEXT NOT NULL DEFAULT 'all', sort_by TEXT NOT NULL DEFAULT 'name', group_by TEXT NOT NULL DEFAULT 'none', created_at TEXT NOT NULL, updated_at TEXT NOT NULL)",
  "CREATE INDEX IF NOT EXISTS idx_tracker_saved_views_manager ON team_tracker_saved_views(manager_account_id)",
  "CREATE INDEX IF NOT EXISTS idx_tracker_days_workspace_developer_date ON team_tracker_days(workspace_id, developer_account_id, date DESC)",
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_tracker_saved_views_manager_name ON team_tracker_saved_views(manager_account_id, name)",
  "ALTER TABLE team_tracker_items ADD COLUMN manager_desk_item_id INTEGER",
  "ALTER TABLE team_tracker_items ADD COLUMN related_jira_keys TEXT",
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_tracker_items_manager_desk_item_id ON team_tracker_items(manager_desk_item_id) WHERE manager_desk_item_id IS NOT NULL",
  "ALTER TABLE manager_desk_items ADD COLUMN source_item_id INTEGER",
  "ALTER TABLE manager_desk_items ADD COLUMN assignee_developer_account_id TEXT",
  "CREATE INDEX IF NOT EXISTS idx_manager_desk_days_manager_date ON manager_desk_days(manager_account_id, date)",
  "CREATE INDEX IF NOT EXISTS idx_manager_desk_items_day ON manager_desk_items(day_id)",
  "CREATE INDEX IF NOT EXISTS idx_manager_desk_items_assignee ON manager_desk_items(assignee_developer_account_id)",
  "CREATE INDEX IF NOT EXISTS idx_manager_desk_items_status ON manager_desk_items(status)",
  "CREATE INDEX IF NOT EXISTS idx_manager_desk_items_follow_up_at ON manager_desk_items(follow_up_at)",
  "CREATE INDEX IF NOT EXISTS idx_manager_desk_items_source_item_id ON manager_desk_items(source_item_id)",
  "CREATE INDEX IF NOT EXISTS idx_manager_desk_links_item ON manager_desk_links(item_id)",
  "CREATE INDEX IF NOT EXISTS idx_manager_desk_links_issue_key ON manager_desk_links(issue_key)",
  "CREATE INDEX IF NOT EXISTS idx_manager_desk_links_developer_account_id ON manager_desk_links(developer_account_id)",
  "CREATE TABLE IF NOT EXISTS manager_desk_item_history (id INTEGER PRIMARY KEY AUTOINCREMENT, item_id INTEGER NOT NULL, manager_account_id TEXT NOT NULL, event_type TEXT NOT NULL, snapshot_json TEXT NOT NULL, recorded_at TEXT NOT NULL)",
  "CREATE INDEX IF NOT EXISTS idx_manager_desk_item_history_item_recorded ON manager_desk_item_history(item_id, recorded_at)",
  "CREATE INDEX IF NOT EXISTS idx_manager_desk_item_history_manager_recorded ON manager_desk_item_history(manager_account_id, recorded_at)",
  "ALTER TABLE team_tracker_items ADD COLUMN task_key TEXT",
  "ALTER TABLE team_tracker_items ADD COLUMN created_by_type TEXT",
  "ALTER TABLE team_tracker_items ADD COLUMN created_by_id TEXT",
  "ALTER TABLE manager_desk_items ADD COLUMN task_key TEXT",
  "ALTER TABLE manager_desk_items ADD COLUMN created_by_type TEXT",
  "ALTER TABLE manager_desk_items ADD COLUMN created_by_id TEXT",
  "CREATE INDEX IF NOT EXISTS idx_tracker_items_workspace_task_key ON team_tracker_items(workspace_id, task_key)",
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_manager_desk_items_workspace_task_key ON manager_desk_items(workspace_id, task_key) WHERE task_key IS NOT NULL",
];

const constraintRepairStatements = [
  "DELETE FROM component_map WHERE account_id IN ('dev-1', 'lead-1')",
  "DELETE FROM developers WHERE account_id IN ('dev-1', 'lead-1')",
  `UPDATE team_tracker_items
   SET day_id = (
     SELECT MIN(keeper.id)
     FROM team_tracker_days keeper
     JOIN team_tracker_days duplicate ON duplicate.date = keeper.date
       AND duplicate.developer_account_id = keeper.developer_account_id
       AND duplicate.workspace_id = keeper.workspace_id
     WHERE duplicate.id = team_tracker_items.day_id
   )
   WHERE day_id IN (
     SELECT duplicate.id
     FROM team_tracker_days duplicate
     WHERE duplicate.id != (
       SELECT MIN(keeper.id)
       FROM team_tracker_days keeper
       WHERE keeper.date = duplicate.date
         AND keeper.developer_account_id = duplicate.developer_account_id
         AND keeper.workspace_id = duplicate.workspace_id
     )
   )`,
  `UPDATE team_tracker_checkins
   SET day_id = (
     SELECT MIN(keeper.id)
     FROM team_tracker_days keeper
     JOIN team_tracker_days duplicate ON duplicate.date = keeper.date
       AND duplicate.developer_account_id = keeper.developer_account_id
       AND duplicate.workspace_id = keeper.workspace_id
     WHERE duplicate.id = team_tracker_checkins.day_id
   )
   WHERE day_id IN (
     SELECT duplicate.id
     FROM team_tracker_days duplicate
     WHERE duplicate.id != (
       SELECT MIN(keeper.id)
       FROM team_tracker_days keeper
       WHERE keeper.date = duplicate.date
         AND keeper.developer_account_id = duplicate.developer_account_id
         AND keeper.workspace_id = duplicate.workspace_id
     )
   )`,
  `DELETE FROM team_tracker_days
   WHERE id != (
     SELECT MIN(keeper.id)
     FROM team_tracker_days keeper
     WHERE keeper.date = team_tracker_days.date
       AND keeper.developer_account_id = team_tracker_days.developer_account_id
       AND keeper.workspace_id = team_tracker_days.workspace_id
   )`,
  `UPDATE manager_desk_items
   SET day_id = (
     SELECT MIN(keeper.id)
     FROM manager_desk_days keeper
     JOIN manager_desk_days duplicate ON duplicate.date = keeper.date
       AND duplicate.manager_account_id = keeper.manager_account_id
       AND duplicate.workspace_id = keeper.workspace_id
     WHERE duplicate.id = manager_desk_items.day_id
   )
   WHERE day_id IN (
     SELECT duplicate.id
     FROM manager_desk_days duplicate
     WHERE duplicate.id != (
       SELECT MIN(keeper.id)
       FROM manager_desk_days keeper
       WHERE keeper.date = duplicate.date
         AND keeper.manager_account_id = duplicate.manager_account_id
         AND keeper.workspace_id = duplicate.workspace_id
     )
   )`,
  `DELETE FROM manager_desk_days
   WHERE id != (
     SELECT MIN(keeper.id)
     FROM manager_desk_days keeper
     WHERE keeper.date = manager_desk_days.date
       AND keeper.manager_account_id = manager_desk_days.manager_account_id
       AND keeper.workspace_id = manager_desk_days.workspace_id
   )`,
  "DROP INDEX IF EXISTS idx_tracker_days_unique_date_developer",
  "DROP INDEX IF EXISTS idx_manager_desk_days_unique_date_manager",
  "DROP INDEX IF EXISTS idx_alert_dismissals_manager_alert",
  "DROP INDEX IF EXISTS idx_alert_dismissals_manager",
  "DROP INDEX IF EXISTS idx_tracker_saved_views_manager_name",
  "DROP INDEX IF EXISTS idx_tracker_saved_views_manager",
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_tracker_days_unique_workspace_date_developer ON team_tracker_days(workspace_id, date, developer_account_id)",
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_manager_desk_days_unique_workspace_date_manager ON manager_desk_days(workspace_id, date, manager_account_id)",
];

function runConstraintRepairStatements(sqlite: BetterSqlite3.Database, tolerateMissingTables = false): void {
  for (const stmt of constraintRepairStatements) {
    try {
      sqlite.exec(stmt);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (tolerateMissingTables && /no such (table|column)/i.test(message)) {
        continue;
      }
      throw error;
    }
  }
}

function isExpectedMigrationError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /duplicate column name/i.test(message);
}

const workspaceOwnedTables = [
  "issues",
  "developers",
  "app_users",
  "alert_dismissals",
  "component_map",
  "sync_log",
  "config",
  "local_tags",
  "issue_tags",
  "issue_scope_history",
  "team_tracker_days",
  "developer_availability_periods",
  "team_tracker_items",
  "team_tracker_checkins",
  "task_key_sequences",
  "task_key_aliases",
  "task_events",
  "checkin_task_refs",
  "daily_note_task_refs",
  "team_tracker_saved_views",
  "work_saved_views",
  "manager_desk_days",
  "manager_desk_items",
  "manager_desk_links",
  "manager_desk_item_history",
  "daily_notes",
  "daily_note_captures",
  "daily_note_follow_ups",
  "user_nav_preferences",
];

function tableExists(sqlite: BetterSqlite3.Database, tableName: string): boolean {
  const row = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(tableName) as { name?: string } | undefined;
  return Boolean(row?.name);
}

function columnExists(sqlite: BetterSqlite3.Database, tableName: string, columnName: string): boolean {
  const rows = sqlite.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  return rows.some((row) => row.name === columnName);
}

function tableSql(sqlite: BetterSqlite3.Database, tableName: string): string {
  const row = sqlite
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(tableName) as { sql?: string } | undefined;
  return row?.sql ?? "";
}

function quoteIdentifier(identifier: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
    throw new Error(`Unsafe SQLite identifier: ${identifier}`);
  }
  return `"${identifier}"`;
}

function ensureWorkspaceColumns(sqlite: BetterSqlite3.Database): void {
  for (const tableName of workspaceOwnedTables) {
    if (!tableExists(sqlite, tableName) || columnExists(sqlite, tableName, "workspace_id")) {
      continue;
    }

    sqlite.exec(`ALTER TABLE ${tableName} ADD COLUMN workspace_id TEXT NOT NULL DEFAULT '${DEFAULT_WORKSPACE_ID}'`);
  }
}

type RebuildSpec = {
  tableName: string;
  expectedSqlFragment: string;
  blockedSqlFragment?: string;
  columns: string[];
  createSql: (tableName: string) => string;
  defaults?: Record<string, string>;
};

const workspaceKeyRebuilds: RebuildSpec[] = [
  {
    tableName: "issues",
    expectedSqlFragment: "PRIMARY KEY (workspace_id, jira_key)",
    columns: [
      "workspace_id",
      "jira_key",
      "summary",
      "description",
      "aspen_severity",
      "priority_name",
      "priority_id",
      "status_name",
      "status_category",
      "assignee_id",
      "assignee_name",
      "team_scope_state",
      "sync_scope_state",
      "reporter_name",
      "component",
      "labels",
      "due_date",
      "development_due_date",
      "flagged",
      "created_at",
      "updated_at",
      "synced_at",
      "last_seen_in_scoped_sync_at",
      "last_reconciled_at",
      "scope_changed_at",
      "analysis_notes",
      "excluded",
    ],
    defaults: {
      workspace_id: `'${DEFAULT_WORKSPACE_ID}'`,
      summary: "''",
      priority_name: "'Medium'",
      priority_id: "''",
      status_name: "''",
      status_category: "'new'",
      team_scope_state: "'in_team'",
      sync_scope_state: "'active'",
      flagged: "0",
      created_at: "datetime('now')",
      updated_at: "datetime('now')",
      synced_at: "datetime('now')",
      excluded: "0",
    },
    createSql: (tableName) => `
      CREATE TABLE ${quoteIdentifier(tableName)} (
        workspace_id    TEXT NOT NULL DEFAULT '${DEFAULT_WORKSPACE_ID}',
        jira_key        TEXT NOT NULL,
        summary         TEXT NOT NULL,
        description     TEXT,
        aspen_severity  TEXT,
        priority_name   TEXT NOT NULL,
        priority_id     TEXT NOT NULL,
        status_name     TEXT NOT NULL,
        status_category TEXT NOT NULL,
        assignee_id     TEXT,
        assignee_name   TEXT,
        team_scope_state TEXT NOT NULL DEFAULT 'in_team',
        sync_scope_state TEXT NOT NULL DEFAULT 'active',
        reporter_name   TEXT,
        component       TEXT,
        labels          TEXT,
        due_date        TEXT,
        development_due_date TEXT,
        flagged         INTEGER NOT NULL DEFAULT 0,
        created_at      TEXT NOT NULL,
        updated_at      TEXT NOT NULL,
        synced_at       TEXT NOT NULL,
        last_seen_in_scoped_sync_at TEXT,
        last_reconciled_at TEXT,
        scope_changed_at TEXT,
        analysis_notes  TEXT,
        excluded        INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (workspace_id, jira_key)
      )
    `,
  },
  {
    tableName: "developers",
    expectedSqlFragment: "PRIMARY KEY (workspace_id, account_id)",
    columns: ["workspace_id", "account_id", "display_name", "email", "avatar_url", "source", "jira_account_id", "is_active"],
    defaults: {
      workspace_id: `'${DEFAULT_WORKSPACE_ID}'`,
      display_name: "''",
      source: "'jira'",
      is_active: "1",
    },
    createSql: (tableName) => `
      CREATE TABLE ${quoteIdentifier(tableName)} (
        workspace_id  TEXT NOT NULL DEFAULT '${DEFAULT_WORKSPACE_ID}',
        account_id   TEXT NOT NULL,
        display_name TEXT NOT NULL,
        email        TEXT,
        avatar_url   TEXT,
        source       TEXT NOT NULL DEFAULT 'jira',
        jira_account_id TEXT,
        is_active    INTEGER NOT NULL DEFAULT 1,
        PRIMARY KEY (workspace_id, account_id)
      )
    `,
  },
  {
    tableName: "config",
    expectedSqlFragment: "PRIMARY KEY (workspace_id, key)",
    columns: ["workspace_id", "key", "value"],
    defaults: {
      workspace_id: `'${DEFAULT_WORKSPACE_ID}'`,
      value: "''",
    },
    createSql: (tableName) => `
      CREATE TABLE ${quoteIdentifier(tableName)} (
        workspace_id TEXT NOT NULL DEFAULT '${DEFAULT_WORKSPACE_ID}',
        key          TEXT NOT NULL,
        value        TEXT NOT NULL,
        PRIMARY KEY (workspace_id, key)
      )
    `,
  },
  {
    tableName: "component_map",
    expectedSqlFragment: "PRIMARY KEY (workspace_id, component_name, account_id)",
    columns: ["workspace_id", "component_name", "account_id", "fix_count"],
    defaults: {
      workspace_id: `'${DEFAULT_WORKSPACE_ID}'`,
      fix_count: "0",
    },
    createSql: (tableName) => `
      CREATE TABLE ${quoteIdentifier(tableName)} (
        workspace_id    TEXT NOT NULL DEFAULT '${DEFAULT_WORKSPACE_ID}',
        component_name TEXT NOT NULL,
        account_id     TEXT NOT NULL,
        fix_count      INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (workspace_id, component_name, account_id)
      )
    `,
  },
  {
    tableName: "local_tags",
    expectedSqlFragment: "UNIQUE(workspace_id, name)",
    columns: ["id", "workspace_id", "name", "color"],
    defaults: {
      workspace_id: `'${DEFAULT_WORKSPACE_ID}'`,
      color: "'#6366f1'",
    },
    createSql: (tableName) => `
      CREATE TABLE ${quoteIdentifier(tableName)} (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        workspace_id TEXT NOT NULL DEFAULT '${DEFAULT_WORKSPACE_ID}',
        name         TEXT NOT NULL,
        color        TEXT NOT NULL DEFAULT '#6366f1',
        UNIQUE(workspace_id, name)
      )
    `,
  },
  {
    tableName: "issue_tags",
    expectedSqlFragment: "PRIMARY KEY (workspace_id, jira_key, tag_id)",
    columns: ["workspace_id", "jira_key", "tag_id"],
    defaults: {
      workspace_id: `'${DEFAULT_WORKSPACE_ID}'`,
    },
    createSql: (tableName) => `
      CREATE TABLE ${quoteIdentifier(tableName)} (
        workspace_id TEXT NOT NULL DEFAULT '${DEFAULT_WORKSPACE_ID}',
        jira_key     TEXT NOT NULL,
        tag_id       INTEGER NOT NULL,
        PRIMARY KEY (workspace_id, jira_key, tag_id),
        FOREIGN KEY (tag_id) REFERENCES local_tags(id)
      )
    `,
  },
  {
    tableName: "issue_scope_history",
    expectedSqlFragment: "workspace_id",
    blockedSqlFragment: "references issues",
    columns: [
      "id",
      "workspace_id",
      "jira_key",
      "observed_at",
      "change_type",
      "from_assignee_id",
      "to_assignee_id",
      "from_team_scope_state",
      "to_team_scope_state",
      "from_sync_scope_state",
      "to_sync_scope_state",
      "from_status_category",
      "to_status_category",
    ],
    defaults: {
      workspace_id: `'${DEFAULT_WORKSPACE_ID}'`,
      observed_at: "datetime('now')",
      change_type: "'issue_updated'",
    },
    createSql: (tableName) => `
      CREATE TABLE ${quoteIdentifier(tableName)} (
        id                    INTEGER PRIMARY KEY AUTOINCREMENT,
        workspace_id          TEXT NOT NULL DEFAULT '${DEFAULT_WORKSPACE_ID}',
        jira_key              TEXT NOT NULL,
        observed_at           TEXT NOT NULL,
        change_type           TEXT NOT NULL,
        from_assignee_id      TEXT,
        to_assignee_id        TEXT,
        from_team_scope_state TEXT,
        to_team_scope_state   TEXT,
        from_sync_scope_state TEXT,
        to_sync_scope_state   TEXT,
        from_status_category  TEXT,
        to_status_category    TEXT
      )
    `,
  },
  {
    tableName: "team_tracker_days",
    expectedSqlFragment: "UNIQUE(workspace_id, date, developer_account_id)",
    columns: [
      "id",
      "workspace_id",
      "date",
      "developer_account_id",
      "status",
      "capacity_units",
      "manager_notes",
      "last_check_in_at",
      "next_follow_up_at",
      "status_updated_at",
      "created_at",
      "updated_at",
    ],
    defaults: {
      workspace_id: `'${DEFAULT_WORKSPACE_ID}'`,
      status: "'on_track'",
      created_at: "datetime('now')",
      updated_at: "datetime('now')",
    },
    createSql: (tableName) => `
      CREATE TABLE ${quoteIdentifier(tableName)} (
        id                    INTEGER PRIMARY KEY AUTOINCREMENT,
        workspace_id          TEXT NOT NULL DEFAULT '${DEFAULT_WORKSPACE_ID}',
        date                  TEXT NOT NULL,
        developer_account_id  TEXT NOT NULL,
        status                TEXT NOT NULL DEFAULT 'on_track',
        capacity_units        INTEGER,
        manager_notes         TEXT,
        last_check_in_at      TEXT,
        next_follow_up_at     TEXT,
        status_updated_at     TEXT,
        created_at            TEXT NOT NULL,
        updated_at            TEXT NOT NULL,
        UNIQUE(workspace_id, date, developer_account_id)
      )
    `,
  },
  {
    tableName: "team_tracker_saved_views",
    expectedSqlFragment: "UNIQUE(workspace_id, manager_account_id, name)",
    columns: [
      "id",
      "workspace_id",
      "manager_account_id",
      "name",
      "search_query",
      "summary_filter",
      "sort_by",
      "group_by",
      "created_at",
      "updated_at",
    ],
    defaults: {
      workspace_id: `'${DEFAULT_WORKSPACE_ID}'`,
      summary_filter: "'all'",
      sort_by: "'name'",
      group_by: "'none'",
      created_at: "datetime('now')",
      updated_at: "datetime('now')",
    },
    createSql: (tableName) => `
      CREATE TABLE ${quoteIdentifier(tableName)} (
        id                 INTEGER PRIMARY KEY AUTOINCREMENT,
        workspace_id       TEXT NOT NULL DEFAULT '${DEFAULT_WORKSPACE_ID}',
        manager_account_id TEXT NOT NULL,
        name               TEXT NOT NULL,
        search_query       TEXT,
        summary_filter     TEXT NOT NULL DEFAULT 'all',
        sort_by            TEXT NOT NULL DEFAULT 'name',
        group_by           TEXT NOT NULL DEFAULT 'none',
        created_at         TEXT NOT NULL,
        updated_at         TEXT NOT NULL,
        UNIQUE(workspace_id, manager_account_id, name)
      )
    `,
  },
  {
    tableName: "manager_desk_days",
    expectedSqlFragment: "UNIQUE(workspace_id, date, manager_account_id)",
    columns: ["id", "workspace_id", "date", "manager_account_id", "created_at", "updated_at"],
    defaults: {
      workspace_id: `'${DEFAULT_WORKSPACE_ID}'`,
      created_at: "datetime('now')",
      updated_at: "datetime('now')",
    },
    createSql: (tableName) => `
      CREATE TABLE ${quoteIdentifier(tableName)} (
        id                 INTEGER PRIMARY KEY AUTOINCREMENT,
        workspace_id       TEXT NOT NULL DEFAULT '${DEFAULT_WORKSPACE_ID}',
        date               TEXT NOT NULL,
        manager_account_id TEXT NOT NULL,
        created_at         TEXT NOT NULL,
        updated_at         TEXT NOT NULL,
        UNIQUE(workspace_id, date, manager_account_id)
      )
    `,
  },
];

function selectExpressionForColumn(currentColumns: Set<string>, column: string, defaults: Record<string, string>): string {
  if (currentColumns.has(column)) {
    if (defaults[column]) {
      return `COALESCE(${quoteIdentifier(column)}, ${defaults[column]})`;
    }
    return quoteIdentifier(column);
  }

  return defaults[column] ?? "NULL";
}

function rebuildTable(sqlite: BetterSqlite3.Database, spec: RebuildSpec): void {
  if (!tableExists(sqlite, spec.tableName)) {
    return;
  }

  const normalizedSql = tableSql(sqlite, spec.tableName).replace(/\s+/g, " ").toLowerCase();
  const hasExpectedSchema = normalizedSql.includes(spec.expectedSqlFragment.toLowerCase());
  const hasBlockedSchema = spec.blockedSqlFragment
    ? normalizedSql.includes(spec.blockedSqlFragment.toLowerCase())
    : false;
  if (hasExpectedSchema && !hasBlockedSchema) {
    return;
  }

  const tempTableName = `__workspace_migration_${spec.tableName}`;
  const currentColumns = new Set(
    (sqlite.prepare(`PRAGMA table_info(${quoteIdentifier(spec.tableName)})`).all() as Array<{ name: string }>).map((row) => row.name)
  );
  const columns = spec.columns.map(quoteIdentifier).join(", ");
  const selectExpressions = spec.columns
    .map((column) => selectExpressionForColumn(currentColumns, column, spec.defaults ?? {}))
    .join(", ");

  sqlite.exec(`DROP TABLE IF EXISTS ${quoteIdentifier(tempTableName)}`);
  sqlite.exec(spec.createSql(tempTableName));
  sqlite.exec(`INSERT INTO ${quoteIdentifier(tempTableName)} (${columns}) SELECT ${selectExpressions} FROM ${quoteIdentifier(spec.tableName)}`);
  sqlite.exec(`DROP TABLE ${quoteIdentifier(spec.tableName)}`);
  sqlite.exec(`ALTER TABLE ${quoteIdentifier(tempTableName)} RENAME TO ${quoteIdentifier(spec.tableName)}`);
}

function rebuildWorkspaceKeyTables(sqlite: BetterSqlite3.Database): void {
  sqlite.exec("PRAGMA foreign_keys = OFF");
  try {
    for (const spec of workspaceKeyRebuilds) {
      rebuildTable(sqlite, spec);
    }
  } finally {
    sqlite.exec("PRAGMA foreign_keys = ON");
  }
}

function ensureDefaultWorkspace(sqlite: BetterSqlite3.Database): void {
  const now = new Date().toISOString();
  sqlite
    .prepare(
      `INSERT INTO workspaces (id, name, owner_account_id, created_at, updated_at)
       VALUES (?, ?, NULL, ?, ?)
       ON CONFLICT(id) DO NOTHING`
    )
    .run(DEFAULT_WORKSPACE_ID, "Default Workspace", now, now);

  sqlite.exec(`
    UPDATE workspaces
    SET owner_account_id = (
      SELECT username
      FROM app_users
      WHERE role = 'manager' AND workspace_id = '${DEFAULT_WORKSPACE_ID}' AND is_active = 1
      ORDER BY id
      LIMIT 1
    ),
    updated_at = '${now}'
    WHERE id = '${DEFAULT_WORKSPACE_ID}'
      AND (owner_account_id IS NULL OR owner_account_id = '')
  `);
}

export function migrate(sqlite: BetterSqlite3.Database): void {
  ensureWorkspaceColumns(sqlite);
  runConstraintRepairStatements(sqlite, true);
  rebuildWorkspaceKeyTables(sqlite);
  sqlite.exec(ddl);
  ensureDefaultWorkspace(sqlite);
  for (const stmt of alterStatements) {
    try {
      sqlite.exec(stmt);
    } catch (error) {
      if (!isExpectedMigrationError(error)) {
        throw error;
      }
    }
  }
  runConstraintRepairStatements(sqlite);
  migrateSecretConfigValues(sqlite);
}

function migrateSecretConfigValues(sqlite: BetterSqlite3.Database): void {
  const row = sqlite
    .prepare("SELECT value FROM config WHERE workspace_id = ? AND key = ?")
    .get(DEFAULT_WORKSPACE_ID, "jira_api_token") as { value?: string } | undefined;
  const value = row?.value;
  if (!value || isEncryptedSecret(value)) {
    return;
  }

  sqlite
    .prepare("UPDATE config SET value = ? WHERE workspace_id = ? AND key = ?")
    .run(encryptSecretIfNeeded(value), DEFAULT_WORKSPACE_ID, "jira_api_token");
}
