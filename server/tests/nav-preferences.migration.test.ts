import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { migrate } from "../src/db/migrate";

/** docs/56 P2-04: `hidden` is an additive column; a database that already holds preferences keeps them. */
function legacyDatabase() {
  const sqlite = new Database(":memory:");
  sqlite.exec(`
    CREATE TABLE user_nav_preferences (
      workspace_id       TEXT NOT NULL DEFAULT 'default',
      manager_account_id TEXT NOT NULL,
      top_nav            TEXT NOT NULL,
      more_nav           TEXT NOT NULL,
      created_at         TEXT NOT NULL,
      updated_at         TEXT NOT NULL,
      PRIMARY KEY (workspace_id, manager_account_id)
    );
  `);
  sqlite.prepare("INSERT INTO user_nav_preferences VALUES ('default', 'm1', ?, ?, 'x', 'x')")
    .run(JSON.stringify(["work", "team", "desk"]), JSON.stringify(["follow-ups", "notes", "meetings"]));
  return sqlite;
}

describe("user_nav_preferences.hidden migration", () => {
  it("adds the column with an empty default and leaves stored rows untouched", () => {
    const sqlite = legacyDatabase();
    migrate(sqlite);

    const columns = (sqlite.prepare("PRAGMA table_info(user_nav_preferences)").all() as { name: string; dflt_value: string | null; notnull: number }[]);
    expect(columns.find((column) => column.name === "hidden")).toMatchObject({ dflt_value: "'[]'", notnull: 1 });
    expect(sqlite.prepare("SELECT top_nav, more_nav, hidden FROM user_nav_preferences WHERE manager_account_id = 'm1'").get()).toEqual({
      top_nav: JSON.stringify(["work", "team", "desk"]),
      more_nav: JSON.stringify(["follow-ups", "notes", "meetings"]),
      hidden: "[]",
    });
  });

  it("is safe to run twice, and a fresh database already has the column", () => {
    const sqlite = legacyDatabase();
    migrate(sqlite);
    expect(() => migrate(sqlite)).not.toThrow();

    const fresh = new Database(":memory:");
    migrate(fresh);
    expect((fresh.prepare("PRAGMA table_info(user_nav_preferences)").all() as { name: string }[]).map((column) => column.name)).toContain("hidden");
  });
});
