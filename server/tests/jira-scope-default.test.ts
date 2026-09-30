import { beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { configTable } from "../src/db/schema";
import { JIRA_SCOPE_PIN_MIGRATION, migrate, pinLegacyJiraSyncScope } from "../src/db/migrate";
import {
  DEFAULT_JIRA_SYNC_SCOPE_MODE,
  normalizeJiraSyncScopeMode,
  SettingsService,
} from "../src/services/settings.service";
import { db, resetDatabase } from "./helpers/db";

/** docs/56 P5-01: the default scope includes unassigned issues, but existing workspaces keep what they run today. */
describe("Jira sync scope default (docs/56 P5-01)", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("new workspaces default to team + unassigned", async () => {
    expect(DEFAULT_JIRA_SYNC_SCOPE_MODE).toBe("team_and_unassigned");
    expect(await new SettingsService().getJiraSyncScopeMode()).toBe("team_and_unassigned");
  });

  it("honours every saved mode and falls back to the default for junk", async () => {
    expect(normalizeJiraSyncScopeMode("team_assignees")).toBe("team_assignees");
    expect(normalizeJiraSyncScopeMode("base_query")).toBe("base_query");
    expect(normalizeJiraSyncScopeMode("team_and_unassigned")).toBe("team_and_unassigned");
    expect(normalizeJiraSyncScopeMode("nonsense")).toBe("team_and_unassigned");
    expect(normalizeJiraSyncScopeMode(undefined)).toBe("team_and_unassigned");

    await db.insert(configTable).values({ key: "jira_sync_scope_mode", value: "team_assignees" });
    expect(await new SettingsService().getJiraSyncScopeMode()).toBe("team_assignees");
  });

  describe("migration for existing workspaces", () => {
    function legacyDatabase(): Database.Database {
      const sqlite = new Database(":memory:");
      migrate(sqlite);
      // Simulate a database last migrated before P5-01 shipped.
      sqlite.prepare("DELETE FROM data_migrations WHERE name = ?").run(JIRA_SCOPE_PIN_MIGRATION);
      sqlite.prepare("DELETE FROM config WHERE key = 'jira_sync_scope_mode'").run();
      const now = new Date().toISOString();
      const workspace = sqlite.prepare("INSERT INTO workspaces (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)");
      for (const id of ["ws-synced", "ws-configured", "ws-explicit", "ws-fresh"]) workspace.run(id, id, now, now);
      sqlite
        .prepare(
          `INSERT INTO issues (workspace_id, jira_key, summary, description, priority_name, priority_id, status_name, status_category, created_at, updated_at, synced_at)
           VALUES ('ws-synced', 'AM-1', 's', '', 'High', '1', 'To Do', 'new', ?, ?, ?)`
        )
        .run(now, now, now);
      const config = sqlite.prepare("INSERT INTO config (workspace_id, key, value) VALUES (?, ?, ?)");
      config.run("ws-configured", "jira_project_key", "AM");
      config.run("ws-explicit", "jira_project_key", "AM");
      config.run("ws-explicit", "jira_sync_scope_mode", "base_query");
      return sqlite;
    }

    function scopes(sqlite: Database.Database): Record<string, string> {
      const rows = sqlite
        .prepare("SELECT workspace_id, value FROM config WHERE key = 'jira_sync_scope_mode'")
        .all() as Array<{ workspace_id: string; value: string }>;
      return Object.fromEntries(rows.map((row) => [row.workspace_id, row.value]));
    }

    it("pins workspaces that already sync or saved Jira settings to roster-only, leaves the rest on the default", () => {
      const sqlite = legacyDatabase();
      try {
        migrate(sqlite);
        expect(scopes(sqlite)).toEqual({
          "ws-synced": "team_assignees",
          "ws-configured": "team_assignees",
          "ws-explicit": "base_query",
        });
        const marker = sqlite
          .prepare("SELECT report_json FROM data_migrations WHERE name = ?")
          .get(JIRA_SCOPE_PIN_MIGRATION) as { report_json: string };
        expect((JSON.parse(marker.report_json) as { pinned: string[] }).pinned.sort()).toEqual(["ws-configured", "ws-synced"]);
      } finally {
        sqlite.close();
      }
    });

    it("runs once: a scope changed later is never re-pinned", () => {
      const sqlite = legacyDatabase();
      try {
        migrate(sqlite);
        sqlite
          .prepare("UPDATE config SET value = 'team_and_unassigned' WHERE workspace_id = 'ws-synced' AND key = 'jira_sync_scope_mode'")
          .run();
        sqlite.prepare("DELETE FROM config WHERE workspace_id = 'ws-configured' AND key = 'jira_sync_scope_mode'").run();
        migrate(sqlite);
        pinLegacyJiraSyncScope(sqlite);
        expect(scopes(sqlite)).toEqual({ "ws-synced": "team_and_unassigned", "ws-explicit": "base_query" });
      } finally {
        sqlite.close();
      }
    });

    it("a brand-new database pins nothing", () => {
      const sqlite = new Database(":memory:");
      try {
        migrate(sqlite);
        expect(scopes(sqlite)).toEqual({});
      } finally {
        sqlite.close();
      }
    });
  });
});
