import { beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { db, rawDb } from "../src/db/connection";
import { migrate } from "../src/db/migrate";
import { configTable } from "../src/db/schema";
import { getPersistedJiraApiToken } from "../src/services/jira-credentials.service";
import { isEncryptedSecret } from "../src/services/secret-crypto";
import { resetDatabase } from "./helpers/db";

describe("database migrations", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("repairs duplicate manager and tracker day rows before adding unique indexes", () => {
    const oldDb = new Database(":memory:");
    try {
      oldDb.exec(`
        CREATE TABLE team_tracker_days (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          date TEXT NOT NULL,
          developer_account_id TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'on_track',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE manager_desk_days (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          date TEXT NOT NULL,
          manager_account_id TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        INSERT INTO team_tracker_days (date, developer_account_id, status, created_at, updated_at)
        VALUES
          ('2026-03-07', 'dev-1', 'on_track', '2026-03-07T08:00:00.000Z', '2026-03-07T08:00:00.000Z'),
          ('2026-03-07', 'dev-1', 'blocked', '2026-03-07T09:00:00.000Z', '2026-03-07T09:00:00.000Z');

        INSERT INTO manager_desk_days (date, manager_account_id, created_at, updated_at)
        VALUES
          ('2026-03-07', 'manager-1', '2026-03-07T08:00:00.000Z', '2026-03-07T08:00:00.000Z'),
          ('2026-03-07', 'manager-1', '2026-03-07T09:00:00.000Z', '2026-03-07T09:00:00.000Z');
      `);

      migrate(oldDb);

      const trackerCount = oldDb
        .prepare("SELECT COUNT(*) AS count FROM team_tracker_days WHERE date = ? AND developer_account_id = ?")
        .get("2026-03-07", "dev-1") as { count: number };
      const deskCount = oldDb
        .prepare("SELECT COUNT(*) AS count FROM manager_desk_days WHERE date = ? AND manager_account_id = ?")
        .get("2026-03-07", "manager-1") as { count: number };

      expect(trackerCount.count).toBe(1);
      expect(deskCount.count).toBe(1);
      expect(() => {
        oldDb
          .prepare(
            "INSERT INTO team_tracker_days (date, developer_account_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
          )
          .run("2026-03-07", "dev-1", "on_track", "2026-03-07T10:00:00.000Z", "2026-03-07T10:00:00.000Z");
      }).toThrow();
    } finally {
      oldDb.close();
    }
  });

  it("encrypts legacy plaintext Jira tokens during idempotent migration", async () => {
    await db.insert(configTable).values({ key: "jira_api_token", value: "legacy-token" });

    migrate(rawDb);

    const row = rawDb.prepare("SELECT value FROM config WHERE key = ?").get("jira_api_token") as { value: string };
    expect(row.value).not.toBe("legacy-token");
    expect(isEncryptedSecret(row.value)).toBe(true);
    expect(await getPersistedJiraApiToken()).toBe("legacy-token");
  });

  it("rebuilds legacy natural keys so duplicate Jira keys can exist in separate workspaces", () => {
    const oldDb = new Database(":memory:");
    try {
      oldDb.exec(`
        CREATE TABLE issues (
          jira_key TEXT PRIMARY KEY,
          summary TEXT NOT NULL,
          description TEXT,
          priority_name TEXT NOT NULL,
          priority_id TEXT NOT NULL,
          status_name TEXT NOT NULL,
          status_category TEXT NOT NULL,
          assignee_id TEXT,
          assignee_name TEXT,
          reporter_name TEXT,
          component TEXT,
          labels TEXT,
          due_date TEXT,
          flagged INTEGER DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          synced_at TEXT NOT NULL
        );
        CREATE TABLE config (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );

        INSERT INTO issues (
          jira_key,
          summary,
          priority_name,
          priority_id,
          status_name,
          status_category,
          created_at,
          updated_at,
          synced_at
        ) VALUES (
          'AM-1',
          'Default workspace issue',
          'High',
          '1',
          'Open',
          'new',
          '2026-03-01T00:00:00.000Z',
          '2026-03-01T00:00:00.000Z',
          '2026-03-01T00:00:00.000Z'
        );
        INSERT INTO config (key, value) VALUES ('jira_project_key', 'AM');
      `);

      migrate(oldDb);

      expect(() => {
        oldDb
          .prepare(
            `INSERT INTO issues (
              workspace_id,
              jira_key,
              summary,
              priority_name,
              priority_id,
              status_name,
              status_category,
              created_at,
              updated_at,
              synced_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            "workspace-b",
            "AM-1",
            "Second workspace issue",
            "Medium",
            "2",
            "Open",
            "new",
            "2026-03-02T00:00:00.000Z",
            "2026-03-02T00:00:00.000Z",
            "2026-03-02T00:00:00.000Z"
          );
      }).not.toThrow();

      expect(() => {
        oldDb
          .prepare("INSERT INTO config (workspace_id, key, value) VALUES (?, ?, ?)")
          .run("workspace-b", "jira_project_key", "AM2");
      }).not.toThrow();

      const count = oldDb.prepare("SELECT COUNT(*) AS count FROM issues WHERE jira_key = ?").get("AM-1") as { count: number };
      expect(count.count).toBe(2);
    } finally {
      oldDb.close();
    }
  });

  it("creates Phase 1 task tables and columns idempotently", () => {
    migrate(rawDb);
    migrate(rawDb);

    const tables = (rawDb.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map(
      (row) => row.name
    );
    for (const name of [
      "task_key_sequences",
      "task_key_aliases",
      "task_events",
      "checkin_task_refs",
      "daily_note_task_refs",
      "data_migrations",
    ]) {
      expect(tables).toContain(name);
    }

    const trackerCols = (rawDb.prepare("PRAGMA table_info(team_tracker_items)").all() as { name: string }[]).map(
      (row) => row.name
    );
    expect(trackerCols).toEqual(expect.arrayContaining(["task_key", "created_by_type", "created_by_id"]));
    const deskCols = (rawDb.prepare("PRAGMA table_info(manager_desk_items)").all() as { name: string }[]).map(
      (row) => row.name
    );
    expect(deskCols).toEqual(expect.arrayContaining(["task_key", "created_by_type", "created_by_id"]));

    const indexes = (rawDb.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all() as { name: string }[]).map(
      (row) => row.name
    );
    expect(indexes).toEqual(
      expect.arrayContaining([
        "idx_task_events_workspace_dedupe",
        "idx_task_events_workspace_key_time",
        "idx_task_events_workspace_author",
      ])
    );
    const sequences = rawDb.prepare("PRAGMA table_info(task_key_sequences)").all() as { name: string; pk: number }[];
    expect(sequences.find((col) => col.name === "workspace_id")?.pk).toBe(1);
  });
});
