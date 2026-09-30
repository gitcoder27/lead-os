import { beforeEach, describe, expect, it } from "vitest";
import express from "express";
import { db, resetDatabase } from "./helpers/db";
import { invoke } from "./helpers/http";
import { configTable, developers } from "../src/db/schema";
import { errorHandler, notFoundHandler } from "../src/middleware/errorHandler";
import { requireManager } from "../src/middleware/auth";
import { createReviewRouter } from "../src/routes/review";
import { createAuthRouter } from "../src/routes/auth";
import { AuthService, serializeSessionCookie } from "../src/services/auth.service";
import { TaskKeysService } from "../src/services/task-keys.service";
import { TaskService } from "../src/services/task.service";

/** docs/59 §9 (WR-01): GET /api/review/week. */
const auth = new AuthService();
const keys = new TaskKeysService();
const app = express();
app.use(express.json());
app.use("/api/review", requireManager(auth), createReviewRouter(keys));
app.use("/api/auth", createAuthRouter(auth));
app.use(notFoundHandler);
app.use(errorHandler);

async function cookie(name: string): Promise<string> {
  const { sessionId } = await auth.authenticate(name, "secret123");
  return serializeSessionCookie(sessionId, auth.sessionMaxAgeSeconds);
}

async function enablePhase3() {
  await db.insert(configTable).values([
    { key: "tasks_phase1_enabled", value: "true" },
    { key: "tasks_phase2_stage", value: "2c" },
    { key: "tasks_phase3_enabled", value: "true" },
  ]);
}

beforeEach(async () => {
  await resetDatabase();
  await db.insert(developers).values([{ accountId: "dev-1", displayName: "One", isActive: 1 }]);
  await auth.createUser({ username: "manager-a", displayName: "A", password: "secret123", role: "manager" });
  await auth.createUser({ username: "dev-user", displayName: "Dev", password: "secret123", role: "developer", developerAccountId: "dev-1" });
});

describe("GET /api/review/week", () => {
  it("is manager-only: 401 without a session, 403 for a developer", async () => {
    expect((await invoke(app, { method: "GET", url: "/api/review/week" })).status).toBe(401);
    const headers = { cookie: await cookie("dev-user") };
    expect((await invoke(app, { method: "GET", url: "/api/review/week", headers })).status).toBe(403);
  });

  it("404s until the Tasks workspace (Phase 3) is on", async () => {
    const headers = { cookie: await cookie("manager-a") };
    expect((await invoke(app, { method: "GET", url: "/api/review/week", headers })).status).toBe(404);
  });

  it("rejects a malformed or impossible week with 400", async () => {
    await enablePhase3();
    const headers = { cookie: await cookie("manager-a") };
    for (const week of ["nope", "2026-9-1", "2026-13-01", "2026-02-30", ""]) {
      const response = await invoke(app, { method: "GET", url: `/api/review/week?week=${encodeURIComponent(week)}`, headers });
      expect(response.status, week).toBe(400);
    }
  });

  it("returns the week, sections and my tasks, and snaps any day to its Monday", async () => {
    await enablePhase3();
    const headers = { cookie: await cookie("manager-a") };
    const manager = { type: "manager" as const, accountId: (await auth.authenticate("manager-a", "secret123")).user.accountId, workspaceId: "default" };
    await new TaskService().create({ title: "Slipped long ago", ownerType: "manager", ownerId: manager.accountId, scheduledOn: "2020-01-01" } as never, manager);
    const response = await invoke(app, { method: "GET", url: "/api/review/week?week=2026-10-01&tz=UTC", headers });
    expect(response.status).toBe(200);
    expect(response.body.range).toEqual({ start: "2026-09-28", end: "2026-10-04", nextStart: "2026-10-05", nextEnd: "2026-10-11" });
    expect(response.body.timeZone).toBe("UTC");
    const ids = response.body.sections.map((entry: { id: string }) => entry.id);
    expect(ids).toEqual(["closed", "quiet", "slipped", "inbox", "undated", "laterNextWeek", "oneOnOnes", "people"]);
    const slipped = response.body.sections.find((entry: { id: string }) => entry.id === "slipped");
    expect(slipped.rows.map((row: { title: string }) => row.title)).toEqual(["Slipped long ago"]);
    expect(slipped.rows[0].signals.overdue).toBe(true);
  });

  it("falls back to the workspace zone when tz is unknown, without failing", async () => {
    await enablePhase3();
    const headers = { cookie: await cookie("manager-a") };
    const response = await invoke(app, { method: "GET", url: "/api/review/week?week=2026-10-01&tz=Mars%2FOlympus", headers });
    expect(response.status).toBe(200);
    expect(response.body.timeZone).not.toBe("Mars/Olympus");
  });
});
