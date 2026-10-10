import type BetterSqlite3 from "better-sqlite3";
/** Additive and idempotent; existing workspace rows are never changed. */
export function migrateRegistrationInvites(sqlite: BetterSqlite3.Database): void {
  sqlite.exec(`CREATE TABLE IF NOT EXISTS registration_invites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token_hash TEXT NOT NULL UNIQUE,
    note TEXT,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used_at TEXT,
    used_by_user_id INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
    revoked_at TEXT
  )`);
  sqlite.prepare("INSERT INTO data_migrations (name,applied_at,report_json) VALUES ('registration_invites_v1', ?, '{}') ON CONFLICT(name) DO NOTHING").run(new Date().toISOString());
}
