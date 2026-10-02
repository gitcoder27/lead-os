import { beforeEach, describe, expect, it } from "vitest";
import express from "express";
import { db, resetDatabase } from "./helpers/db";
import { invoke } from "./helpers/http";
import { configTable, developers, weeklyReviews } from "../src/db/schema";
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
    await new TaskService().create({ title: "Fresh blocker", ownerType: "manager", ownerId: manager.accountId, status: "blocked" }, manager);
    const response = await invoke(app, { method: "GET", url: "/api/review/week?week=2026-10-01&tz=UTC", headers });
    expect(response.status).toBe(200);
    expect(response.body.range).toEqual({ start: "2026-09-28", end: "2026-10-04", nextStart: "2026-10-05", nextEnd: "2026-10-11" });
    expect(response.body.timeZone).toBe("UTC");
    const ids = response.body.sections.map((entry: { id: string }) => entry.id);
    expect(ids).toEqual(["closed", "quiet", "blocked", "slipped", "inbox", "undated", "laterNextWeek", "plannedNextWeek", "oneOnOnes", "people"]);
    const blocked = response.body.sections.find((entry: { id: string }) => entry.id === "blocked");
    expect(blocked.rows.map((row: { title: string }) => row.title)).toEqual(["Fresh blocker"]);
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

describe("saving a week: PUT /api/review/week/:weekStart, GET /api/review/weeks", () => {
  const WEEK = "2026-09-28";
  const put = async (headers: { cookie: string }, weekStart: string, body: unknown) =>
    invoke(app, { method: "PUT", url: `/api/review/week/${weekStart}`, headers, body });
  const getWeek = async (headers: { cookie: string }, week = WEEK) =>
    invoke(app, { method: "GET", url: `/api/review/week?week=${week}&tz=UTC`, headers });

  it("is manager-only and needs the Tasks workspace", async () => {
    const dev = { cookie: await cookie("dev-user") };
    expect((await put(dev, WEEK, { step: "waiting" })).status).toBe(403);
    expect((await invoke(app, { method: "GET", url: "/api/review/weeks", headers: dev })).status).toBe(403);
    const manager = { cookie: await cookie("manager-a") };
    expect((await put(manager, WEEK, { step: "waiting" })).status).toBe(404);
    expect((await invoke(app, { method: "GET", url: "/api/review/weeks", headers: manager })).status).toBe(404);
  });

  it("rejects a weekStart that is not a Monday, and bad bodies, with 400", async () => {
    await enablePhase3();
    const headers = { cookie: await cookie("manager-a") };
    expect((await put(headers, "2026-09-29", { step: "waiting" })).status).toBe(400);
    expect((await put(headers, "nope", {})).status).toBe(400);
    expect((await put(headers, WEEK, { step: "nowhere" })).status).toBe(400);
    expect((await put(headers, WEEK, { decisions: { "not a key": "done" } })).status).toBe(400);
    expect((await put(headers, WEEK, { decisions: { "T-1": "no spaces allowed" } })).status).toBe(400);
    expect((await put(headers, WEEK, { reportMarkdown: "x".repeat(20_001) })).status).toBe(400);
    expect((await put(headers, WEEK, { surprise: true })).status).toBe(400);
    expect((await put(headers, WEEK, { reportMarkdown: "x".repeat(20_000) })).status).toBe(200);
  });

  it("upserts, merges decisions by task key (null removes), and replaces excluded", async () => {
    await enablePhase3();
    const headers = { cookie: await cookie("manager-a") };
    expect((await getWeek(headers)).body.saved).toBeNull();

    const first = await put(headers, WEEK, { step: "waiting", decisions: { "T-1": "check_monday", "T-2": "drop" }, excluded: ["T-9", "T-9", "jira:summary"] });
    expect(first.status).toBe(200);
    expect(first.body.saved).toMatchObject({ weekStart: WEEK, step: "waiting", decisions: { "T-1": "check_monday", "T-2": "drop" }, excluded: ["T-9", "jira:summary"], completedAt: null, dismissedAt: null });

    const second = await put(headers, WEEK, { decisions: { "T-2": null, "T-3": "monday" } });
    expect(second.body.saved.decisions).toEqual({ "T-1": "check_monday", "T-3": "monday" });
    // Untouched fields survive a partial save.
    expect(second.body.saved.step).toBe("waiting");
    expect(second.body.saved.excluded).toEqual(["T-9", "jira:summary"]);
    expect(second.body.saved.startedAt).toBe(first.body.saved.startedAt);

    const third = await put(headers, WEEK, { excluded: [] });
    expect(third.body.saved.excluded).toEqual([]);
    expect((await getWeek(headers)).body.saved).toEqual(third.body.saved);
  });

  it("completes (keeping the first completion time), reopens, dismisses and lists past weeks newest first", async () => {
    await enablePhase3();
    const headers = { cookie: await cookie("manager-a") };
    const done = await put(headers, WEEK, { completed: true, reportMarkdown: "**Weekly update**\n- Shipped it" });
    expect(done.body.saved.completedAt).toEqual(expect.any(String));
    const again = await put(headers, WEEK, { completed: true });
    expect(again.body.saved.completedAt).toBe(done.body.saved.completedAt);
    await put(headers, "2026-10-05", { completed: true, reportMarkdown: "newer" });
    await put(headers, "2026-10-12", { step: "waiting" });
    await put(headers, "2026-10-19", { dismissed: true });

    const weeks = await invoke(app, { method: "GET", url: "/api/review/weeks?limit=12", headers });
    expect(weeks.body.weeks.map((week: { weekStart: string }) => week.weekStart)).toEqual(["2026-10-05", WEEK]);
    expect(weeks.body.weeks[1].reportMarkdown).toBe("**Weekly update**\n- Shipped it");
    expect((await invoke(app, { method: "GET", url: "/api/review/weeks?limit=1", headers })).body.weeks).toHaveLength(1);
    expect((await invoke(app, { method: "GET", url: "/api/review/weeks?limit=0", headers })).status).toBe(400);

    const reopened = await put(headers, WEEK, { completed: false });
    expect(reopened.body.saved.completedAt).toBeNull();
    expect((await invoke(app, { method: "GET", url: "/api/review/weeks", headers })).body.weeks).toHaveLength(1);
    expect((await put(headers, "2026-10-19", { dismissed: false })).body.saved.dismissedAt).toBeNull();
  });

  it("keeps each manager's record private, even inside one workspace", async () => {
    await enablePhase3();
    await auth.createUser({ username: "manager-b", displayName: "B", password: "secret123", role: "manager", workspaceId: "default" });
    const a = { cookie: await cookie("manager-a") };
    const b = { cookie: await cookie("manager-b") };
    await put(a, WEEK, { step: "send", decisions: { "T-1": "drop" }, completed: true, reportMarkdown: "A's update" });

    // B sees nothing of A's, and B's write makes B's own row.
    expect((await getWeek(b)).body.saved).toBeNull();
    expect((await invoke(app, { method: "GET", url: "/api/review/weeks", headers: b })).body.weeks).toEqual([]);
    await put(b, WEEK, { step: "waiting" });
    expect((await getWeek(a)).body.saved).toMatchObject({ step: "send", decisions: { "T-1": "drop" }, reportMarkdown: "A's update" });
    expect((await getWeek(b)).body.saved).toMatchObject({ step: "waiting", decisions: {}, reportMarkdown: null, completedAt: null });
    const rows = await db.select().from(weeklyReviews);
    expect(rows).toHaveLength(2);
  });
});
