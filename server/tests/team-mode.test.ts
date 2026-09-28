import { beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import express from "express";
import { db, resetDatabase } from "./helpers/db";
import { invoke } from "./helpers/http";
import { appUsers, configTable, developers } from "../src/db/schema";
import { backfillTeamMode, migrate, TEAM_MODE_MIGRATION } from "../src/db/migrate";
import { errorHandler, notFoundHandler } from "../src/middleware/errorHandler";
import { requireManager } from "../src/middleware/auth";
import { createAuthRouter } from "../src/routes/auth";
import { createConfigRouter } from "../src/routes/config";
import { createTeamRouter } from "../src/routes/team";
import { AuthService, serializeSessionCookie } from "../src/services/auth.service";
import { getParticipatingDeveloperIds } from "../src/services/developer-participation.service";
import { IssueService } from "../src/services/issue.service";
import { ManagerDeskService } from "../src/services/manager-desk.service";
import { normalizeTeamMode, SettingsService, TEAM_MODE_KEY } from "../src/services/settings.service";
import { TeamTrackerService } from "../src/services/team-tracker.service";
import { TodayService } from "../src/services/today.service";
import { WorkloadService } from "../src/services/workload.service";

const auth = new AuthService();
const settings = new SettingsService();
const app = express();
app.use(express.json());
app.use("/api/auth", createAuthRouter(auth));
app.use("/api/config", requireManager(auth), createConfigRouter());
app.use("/api/team", requireManager(auth), createTeamRouter(new WorkloadService()));
app.use(notFoundHandler);
app.use(errorHandler);

async function cookie(username: string): Promise<string> {
  const { sessionId } = await auth.authenticate(username, "secret123");
  return serializeSessionCookie(sessionId, auth.sessionMaxAgeSeconds);
}

async function seed(): Promise<void> {
  await db.insert(developers).values([
    { accountId: "dev-1", displayName: "Alice Participant", isActive: 1 },
    { accountId: "dev-2", displayName: "Bob Managed", isActive: 1 },
    { accountId: "dev-3", displayName: "Cara Deactivated", isActive: 1 },
  ]);
  await auth.createUser({ username: "manager-a", displayName: "Manager", password: "secret123", role: "manager" });
  await auth.createUser({ username: "dev-user", displayName: "Alice", password: "secret123", role: "developer", developerAccountId: "dev-1" });
  await auth.createUser({ username: "dev-off", displayName: "Cara", password: "secret123", role: "developer", developerAccountId: "dev-3", isActive: false });
}

beforeEach(async () => {
  await resetDatabase();
  await seed();
});

describe("team_mode migration (docs/56 Decisions #1)", () => {
  function preP101Database(): Database.Database {
    const sqlite = new Database(":memory:");
    migrate(sqlite);
    // Simulate a database last migrated before P1-01 shipped.
    sqlite.prepare("DELETE FROM data_migrations WHERE name = ?").run(TEAM_MODE_MIGRATION);
    sqlite.prepare("DELETE FROM config WHERE key = 'team_mode'").run();
    const now = new Date().toISOString();
    const workspace = sqlite.prepare("INSERT INTO workspaces (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)");
    for (const id of ["ws-dev", "ws-inactive", "ws-manager", "ws-explicit"]) workspace.run(id, id, now, now);
    const user = sqlite.prepare(
      "INSERT INTO app_users (workspace_id, username, display_name, password_hash, role, developer_account_id, is_active, created_at, updated_at) VALUES (?, ?, ?, 'x', ?, ?, ?, ?, ?)"
    );
    user.run("ws-dev", "m1", "M1", "manager", null, 1, now, now);
    user.run("ws-dev", "d1", "D1", "developer", "dev-1", 1, now, now);
    user.run("ws-inactive", "m2", "M2", "manager", null, 1, now, now);
    user.run("ws-inactive", "d2", "D2", "developer", "dev-2", 0, now, now);
    user.run("ws-manager", "m3", "M3", "manager", null, 1, now, now);
    // An explicit value set before the backfill must survive it.
    sqlite.prepare("INSERT INTO config (workspace_id, key, value) VALUES ('ws-explicit', 'team_mode', 'collab')").run();
    return sqlite;
  }

  const modes = (sqlite: Database.Database) => Object.fromEntries(
    (sqlite.prepare("SELECT workspace_id AS id, value FROM config WHERE key = 'team_mode' ORDER BY workspace_id").all() as Array<{ id: string; value: string }>)
      .map((row) => [row.id, row.value])
  );

  it("marks workspaces with an active developer login collab and every other workspace solo", () => {
    const sqlite = preP101Database();
    try {
      migrate(sqlite);
      expect(modes(sqlite)).toEqual({
        default: "solo",
        "ws-dev": "collab",
        "ws-explicit": "collab",
        "ws-inactive": "solo",
        "ws-manager": "solo",
      });
      const marker = sqlite.prepare("SELECT report_json FROM data_migrations WHERE name = ?").get(TEAM_MODE_MIGRATION) as { report_json: string };
      expect(JSON.parse(marker.report_json)).toEqual({ default: "solo", "ws-dev": "collab", "ws-inactive": "solo", "ws-manager": "solo" });
    } finally {
      sqlite.close();
    }
  });

  it("runs once: later developer logins and manual changes are never re-derived", () => {
    const sqlite = preP101Database();
    try {
      migrate(sqlite);
      const now = new Date().toISOString();
      sqlite.prepare(
        "INSERT INTO app_users (workspace_id, username, display_name, password_hash, role, developer_account_id, is_active, created_at, updated_at) VALUES ('ws-manager', 'd3', 'D3', 'x', 'developer', 'dev-3', 1, ?, ?)"
      ).run(now, now);
      sqlite.prepare("UPDATE config SET value = 'solo' WHERE workspace_id = 'ws-dev' AND key = 'team_mode'").run();
      migrate(sqlite);
      backfillTeamMode(sqlite);
      expect(modes(sqlite)).toMatchObject({ "ws-dev": "solo", "ws-manager": "solo" });
    } finally {
      sqlite.close();
    }
  });

  it("starts a brand-new database solo", () => {
    const sqlite = new Database(":memory:");
    try {
      migrate(sqlite);
      expect(modes(sqlite)).toEqual({ default: "solo" });
    } finally {
      sqlite.close();
    }
  });
});

describe("SettingsService team mode", () => {
  it("defaults to solo and normalizes unknown values", async () => {
    expect(await settings.getTeamMode()).toBe("solo");
    await db.insert(configTable).values({ key: TEAM_MODE_KEY, value: "bogus" });
    expect(await settings.getTeamMode()).toBe("solo");
    expect(normalizeTeamMode(" COLLAB ")).toBe("collab");
    expect(normalizeTeamMode(undefined)).toBe("solo");
  });

  it("persists per workspace", async () => {
    expect(await settings.setTeamMode(undefined, "collab")).toBe("collab");
    expect(await settings.getTeamMode("default")).toBe("collab");
    expect(await settings.getTeamMode("other")).toBe("solo");
    await settings.setTeamMode("default", "solo");
    expect(await settings.getTeamMode()).toBe("solo");
  });
});

describe("developer participation", () => {
  it("includes only developers mapped by an active developer login in the same workspace", async () => {
    const now = new Date().toISOString();
    await db.insert(appUsers).values({ workspaceId: "other", username: "dev-other", displayName: "Other", passwordHash: "x", role: "developer", developerAccountId: "dev-2", createdAt: now, updatedAt: now });
    expect([...(await getParticipatingDeveloperIds())]).toEqual(["dev-1"]);
    expect([...(await getParticipatingDeveloperIds("other"))]).toEqual(["dev-2"]);
  });

  it("sets participates on board developers, developer days, and the Today pulse", async () => {
    const tracker = new TeamTrackerService();
    const board = await tracker.getBoard("2026-03-08");
    const byId = new Map(board.developers.map((day) => [day.developer.accountId, day]));
    expect(byId.get("dev-1")).toMatchObject({ participates: true, developer: { participates: true } });
    expect(byId.get("dev-2")).toMatchObject({ participates: false, developer: { participates: false } });
    expect(byId.get("dev-3")).toMatchObject({ participates: false, developer: { participates: false } });
    expect((await tracker.getDeveloperDay("2026-03-08", "dev-1")).participates).toBe(true);

    const today = new TodayService(new IssueService(undefined, undefined, tracker), tracker, new ManagerDeskService(tracker), {
      getLastSyncLog: async () => undefined,
      getRuntimeStatus: () => ({ status: "idle" as const }),
    }, { todayCacheTtlMs: 0 });
    const pulse = new Map((await today.getToday("manager-a", "2026-03-08")).teamPulse.map((item) => [item.accountId, item.participates]));
    expect(pulse.get("dev-1")).toBe(true);
    expect(pulse.get("dev-2")).toBe(false);
  });
});

describe("team mode routes", () => {
  it("lets a manager read and change team mode, and rejects invalid values", async () => {
    const headers = { cookie: await cookie("manager-a") };
    expect((await invoke(app, { method: "GET", url: "/api/config/team-mode", headers })).body).toEqual({ teamMode: "solo" });

    const put = await invoke(app, { method: "PUT", url: "/api/config/team-mode", headers, body: { teamMode: "collab" } });
    expect(put.status).toBe(200);
    expect(put.body).toEqual({ teamMode: "collab" });
    expect(await settings.getTeamMode()).toBe("collab");

    const bad = await invoke(app, { method: "PUT", url: "/api/config/team-mode", headers, body: { teamMode: "team" } });
    expect(bad.status).toBe(400);
    expect(await settings.getTeamMode()).toBe("collab");
  });

  it("is manager-only", async () => {
    const headers = { cookie: await cookie("dev-user") };
    expect((await invoke(app, { method: "GET", url: "/api/config/team-mode", headers })).status).toBe(403);
    expect((await invoke(app, { method: "PUT", url: "/api/config/team-mode", headers, body: { teamMode: "collab" } })).status).toBe(403);
    expect(await settings.getTeamMode()).toBe("solo");
  });

  it("delivers features.teamMode on manager and developer sessions", async () => {
    const managerHeaders = { cookie: await cookie("manager-a") };
    const devHeaders = { cookie: await cookie("dev-user") };
    expect((await invoke(app, { method: "GET", url: "/api/auth/me", headers: managerHeaders })).body.features.teamMode).toBe("solo");
    await invoke(app, { method: "PUT", url: "/api/config/team-mode", headers: managerHeaders, body: { teamMode: "collab" } });
    expect((await invoke(app, { method: "GET", url: "/api/auth/me", headers: managerHeaders })).body.features.teamMode).toBe("collab");
    const devMe = await invoke(app, { method: "GET", url: "/api/auth/me", headers: devHeaders });
    expect(devMe.body.features.teamMode).toBe("collab");
    expect(devMe.body.features).not.toHaveProperty("oneOnOne");
  });

  it("returns participates on the team roster", async () => {
    const headers = { cookie: await cookie("manager-a") };
    const response = await invoke(app, { method: "GET", url: "/api/team/developers", headers });
    expect(response.status).toBe(200);
    const list = (Array.isArray(response.body) ? response.body : response.body.developers) as Array<{ accountId: string; participates: boolean }>;
    expect(Object.fromEntries(list.map((dev) => [dev.accountId, dev.participates]))).toEqual({ "dev-1": true, "dev-2": false, "dev-3": false });

    const manual = await invoke(app, { method: "POST", url: "/api/team/developers/manual", headers, body: { displayName: "New Person" } });
    expect(manual.status).toBeLessThan(300);
    expect(manual.body.developer.participates).toBe(false);
  });
});
