import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { migrate } from "../src/db/migrate";

const addUser = (sqlite: Database.Database) =>
  sqlite.prepare("INSERT INTO app_users (id, username, display_name, role, password_hash, created_at, updated_at) VALUES (1, 'dev', 'Dev', 'developer', 'x', 'now', 'now')").run();

/** Plan-date, due-date and priority updates widened task_inbox.kind; an older database keeps its rows. */
function legacyDatabase() {
  const sqlite = new Database(":memory:");
  migrate(sqlite);
  addUser(sqlite);
  sqlite.pragma("foreign_keys = OFF");
  sqlite.exec(`
    DROP TABLE task_inbox;
    CREATE TABLE task_inbox (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id TEXT NOT NULL,
      recipient_user_id INTEGER NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
      event_id INTEGER NOT NULL,
      actor_user_id INTEGER,
      kind TEXT NOT NULL CHECK (kind IN ('assignment', 'instruction', 'reply', 'blocker', 'blocker_cleared')),
      created_at TEXT NOT NULL,
      read_at TEXT
    );
    INSERT INTO task_inbox (workspace_id, recipient_user_id, event_id, actor_user_id, kind, created_at, read_at)
    VALUES ('default', 1, 10, 2, 'instruction', '2026-10-01T09:00:00Z', '2026-10-01T10:00:00Z'),
           ('default', 1, 11, NULL, 'assignment', '2026-10-02T09:00:00Z', NULL);
  `);
  return sqlite;
}

const insert = (sqlite: Database.Database, kind: string, eventId: number) =>
  sqlite.prepare("INSERT INTO task_inbox (workspace_id, recipient_user_id, event_id, kind, created_at) VALUES ('default', 1, ?, ?, 'now')").run(eventId, kind);

describe("task_inbox.kind migration", () => {
  it("widens the CHECK, keeps every delivery with its read state and restores the indexes", () => {
    const sqlite = legacyDatabase();
    expect(() => insert(sqlite, "schedule", 20)).toThrow(/CHECK/);
    migrate(sqlite);

    expect(sqlite.prepare("SELECT id, event_id, kind, read_at FROM task_inbox ORDER BY id").all()).toEqual([
      { id: 1, event_id: 10, kind: "instruction", read_at: "2026-10-01T10:00:00Z" },
      { id: 2, event_id: 11, kind: "assignment", read_at: null },
    ]);
    insert(sqlite, "schedule", 20);
    insert(sqlite, "priority", 21);
    expect(() => insert(sqlite, "gossip", 22)).toThrow(/CHECK/);
    expect(() => insert(sqlite, "reply", 20)).toThrow(/UNIQUE/);
    const indexes = (sqlite.prepare("PRAGMA index_list(task_inbox)").all() as { name: string }[]).map((row) => row.name);
    expect(indexes).toEqual(expect.arrayContaining(["idx_task_inbox_delivery", "idx_task_inbox_unread"]));
  });

  it("is safe to run twice, and a fresh database already allows the new kinds", () => {
    const sqlite = legacyDatabase();
    migrate(sqlite);
    migrate(sqlite);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM task_inbox").get()).toEqual({ n: 2 });
    const fresh = new Database(":memory:");
    migrate(fresh);
    addUser(fresh);
    expect(() => insert(fresh, "priority", 1)).not.toThrow();
  });
});
