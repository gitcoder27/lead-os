import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import express from "express";
import { migrate } from "../src/db/migrate";
import { startCanonicalTasksIfEmpty } from "../src/db/canonical-start";
import { configTable } from "../src/db/schema";
import { requireManager } from "../src/middleware/auth";
import { errorHandler, notFoundHandler } from "../src/middleware/errorHandler";
import { createCaptureRouter } from "../src/routes/capture";
import { createConfigRouter } from "../src/routes/config";
import { AuthService, serializeSessionCookie } from "../src/services/auth.service";
import { CaptureService } from "../src/services/capture.service";
import { TaskKeysService } from "../src/services/task-keys.service";
import { todayIsoDate } from "../src/utils/date";
import { db, resetDatabase } from "./helpers/db";
import { invoke } from "./helpers/http";

/** docs/56 P3-00a: workspaces with nothing to backfill start on the canonical task model. */
const CANONICAL = {
  tasks_phase1_enabled: "true",
  tasks_phase2_id_seed: "0",
  tasks_phase2_stage: "2c",
  tasks_phase3_enabled: "true",
};

let dir: string;
let file: Database.Database | undefined;

function openFresh(): Database.Database {
  file = new Database(path.join(dir, "fresh.db"));
  return file;
}

function config(sqlite: Database.Database, workspaceId: string): Record<string, string> {
  const rows = sqlite.prepare("SELECT key, value FROM config WHERE workspace_id = ? AND key LIKE 'tasks%'").all(workspaceId) as Array<{ key: string; value: string }>;
  return Object.fromEntries(rows.map((row) => [row.key, row.value]));
}

function addWorkspace(sqlite: Database.Database, id: string): void {
  sqlite.prepare("INSERT INTO workspaces (id, name, created_at, updated_at) VALUES (?, ?, '2026-01-01', '2026-01-01')").run(id, id);
}

describe("startCanonicalTasksIfEmpty (docs/56 P3-00a)", () => {
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "lead-os-canonical-start-"));
  });

  afterEach(() => {
    file?.close();
    file = undefined;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("a fresh database starts canonical on first migrate, and a second migrate changes nothing", () => {
    const sqlite = openFresh();
    migrate(sqlite);
    const first = config(sqlite, "default");
    expect(first).toMatchObject(CANONICAL);
    expect(first.tasks_canonical_from_start_at).toBeTruthy();

    migrate(sqlite);
    expect(config(sqlite, "default")).toEqual(first);
  });

  it("leaves workspaces with legacy task data, an explicit stage, or canonical rows untouched", () => {
    const sqlite = openFresh();
    migrate(sqlite);
    sqlite.prepare("DELETE FROM config WHERE workspace_id = 'default' AND key LIKE 'tasks%'").run();
    for (const id of ["legacy_desk", "legacy_tracker", "rolled_back", "has_tasks", "empty"]) addWorkspace(sqlite, id);
    sqlite.pragma("foreign_keys = OFF");
    sqlite.prepare("INSERT INTO manager_desk_items (workspace_id, day_id, title, kind, category, created_at, updated_at) VALUES ('legacy_desk', 1, 't', 'action', 'c', 'x', 'x')").run();
    sqlite.prepare("INSERT INTO manager_desk_items (workspace_id, day_id, title, kind, category, created_at, updated_at) VALUES ('default', 1, 't', 'action', 'c', 'x', 'x')").run();
    const trackerColumns = sqlite.prepare("PRAGMA table_info(team_tracker_items)").all() as Array<{ name: string; notnull: number; dflt_value: unknown; pk: number; type: string }>;
    const required = trackerColumns.filter((column) => column.notnull && column.dflt_value === null && !column.pk && column.name !== "workspace_id");
    sqlite.prepare(`INSERT INTO team_tracker_items (workspace_id, ${required.map((column) => column.name).join(", ")}) VALUES ('legacy_tracker', ${required.map(() => "?").join(", ")})`)
      .run(...required.map((column) => (column.type.toUpperCase().includes("INT") ? 1 : "x")));
    sqlite.prepare("INSERT INTO config (workspace_id, key, value) VALUES ('rolled_back', 'tasks_phase2_stage', 'rolled_back')").run();
    sqlite.prepare("INSERT INTO tasks (workspace_id, task_key, title, created_at, updated_at) VALUES ('has_tasks', 'T-1', 't', 'x', 'x')").run();

    migrate(sqlite);

    expect(config(sqlite, "default")).toEqual({});
    expect(config(sqlite, "legacy_desk")).toEqual({});
    expect(config(sqlite, "legacy_tracker")).toEqual({});
    expect(config(sqlite, "rolled_back")).toEqual({ tasks_phase2_stage: "rolled_back" });
    expect(config(sqlite, "has_tasks")).toEqual({});
    expect(config(sqlite, "empty")).toMatchObject(CANONICAL);
  });

  it("never touches a workspace that already has a stage", () => {
    const sqlite = openFresh();
    migrate(sqlite);
    expect(startCanonicalTasksIfEmpty(sqlite, "default")).toBe(false);
  });
});

describe("new workspaces at runtime (docs/56 P3-00a)", () => {
  const auth = new AuthService();
  const keys = new TaskKeysService();
  const app = express();
  app.use(express.json());
  app.use("/api/capture", requireManager(auth), createCaptureRouter(new CaptureService()));
  app.use("/api/config", requireManager(auth), createConfigRouter());
  app.use(notFoundHandler);
  app.use(errorHandler);

  async function cookie(username: string): Promise<string> {
    const { sessionId } = await auth.authenticate(username, "secret123");
    return serializeSessionCookie(sessionId, auth.sessionMaxAgeSeconds);
  }

  beforeEach(async () => {
    await resetDatabase();
  });

  it("a second manager's new workspace is canonical, and capture works there", async () => {
    await auth.createUser({ username: "owner", displayName: "Owner", password: "secret123", role: "manager" });
    // The default workspace was reset to the legacy model by the test helper and stays that way.
    expect(await keys.phase3Enabled("default")).toBe(false);

    const second = await auth.createUser({ username: "second", displayName: "Second", password: "secret123", role: "manager" });
    expect(second.workspaceId).not.toBe("default");
    expect(await keys.phase3Enabled(second.workspaceId)).toBe(true);

    const res = await invoke(app, {
      method: "POST",
      url: "/api/capture",
      headers: { cookie: await cookie("second") },
      body: { text: "Draft the Q3 plan", clientToday: todayIsoDate() },
    });
    expect(res.status).toBeLessThan(300);
    expect(JSON.stringify(res.body)).toContain("T-1");
  });

  it("Reset configuration keeps the task-model keys", async () => {
    await auth.createUser({ username: "owner", displayName: "Owner", password: "secret123", role: "manager" });
    await db.insert(configTable).values([
      { key: "tasks_phase2_stage", value: "2c" },
      { key: "tasks_phase3_enabled", value: "true" },
      { key: "jira_project_key", value: "AM" },
    ]);

    const res = await invoke(app, {
      method: "POST",
      url: "/api/config/reset",
      headers: { cookie: await cookie("owner") },
      body: { confirmationText: "RESET CONFIGURATION" },
    });
    expect(res.status).toBe(200);

    const rows = await db.select().from(configTable);
    const keysLeft = rows.filter((row) => row.workspaceId === "default").map((row) => row.key).sort();
    expect(keysLeft).toEqual(["tasks_phase2_stage", "tasks_phase3_enabled"]);
    expect(await keys.phase3Enabled("default")).toBe(true);
  });
});
