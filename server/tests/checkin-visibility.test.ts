import { beforeEach, describe, expect, it } from "vitest";
import express from "express";
import { eq } from "drizzle-orm";
import { db, resetDatabase } from "./helpers/db";
import { invoke } from "./helpers/http";
import { checkinTaskRefs, configTable, developers, teamTrackerCheckIns } from "../src/db/schema";
import { errorHandler, notFoundHandler } from "../src/middleware/errorHandler";
import { requireManager } from "../src/middleware/auth";
import { createMyDayRouter } from "../src/routes/my-day";
import { createTeamTrackerRouter } from "../src/routes/team-tracker";
import { AuthService, serializeSessionCookie } from "../src/services/auth.service";
import { IssueService } from "../src/services/issue.service";
import { ManagerDeskService } from "../src/services/manager-desk.service";
import { MyDayService } from "../src/services/my-day.service";
import { TeamTrackerService } from "../src/services/team-tracker.service";
import { TaskService } from "../src/services/task.service";
import { addDaysIso } from "../src/services/one-on-one.service";
import { todayIsoDate } from "../src/utils/date";

/**
 * docs/56 P0-S6: what a developer can and cannot see of manager-authored
 * check-ins and status rationales. Shared ones are visible (the manager dialog
 * says so) minus the manager's follow-up schedule; private ones never reach a
 * developer response.
 */
const auth = new AuthService();
const tracker = new TeamTrackerService();
const today = todayIsoDate();
const followUp = "2030-01-15T09:00:00.000Z";

const app = express();
app.use("/api/team-tracker", requireManager(auth), createTeamTrackerRouter(tracker, new ManagerDeskService(tracker)));
app.use("/api/my-day", createMyDayRouter(new MyDayService(tracker), auth, new IssueService()));
app.use(notFoundHandler);
app.use(errorHandler);

async function cookie(name: string): Promise<string> {
  const { sessionId } = await auth.authenticate(name, "secret123");
  return serializeSessionCookie(sessionId, auth.sessionMaxAgeSeconds);
}
const asManager = async (method: string, url: string, body?: unknown) => invoke(app, { method, url, body, headers: { cookie: await cookie("manager-a") } });
const asDeveloper = async (user: string, method: string, url: string, body?: unknown) => invoke(app, { method, url, body, headers: { cookie: await cookie(user) } });

beforeEach(async () => {
  await resetDatabase();
  await db.insert(developers).values([
    { workspaceId: "default", accountId: "dev-1", displayName: "Alice One", email: null, avatarUrl: null, source: "jira", jiraAccountId: "dev-1", isActive: 1 },
    { workspaceId: "default", accountId: "dev-2", displayName: "Bob Two", email: null, avatarUrl: null, source: "jira", jiraAccountId: "dev-2", isActive: 1 },
  ]);
  await auth.createUser({ username: "manager-a", displayName: "A", password: "secret123", role: "manager" });
  await auth.createUser({ username: "alice", displayName: "Alice", password: "secret123", role: "developer", developerAccountId: "dev-1" });
  await auth.createUser({ username: "bob", displayName: "Bob", password: "secret123", role: "developer", developerAccountId: "dev-2" });
  await db.insert(configTable).values([
    { key: "tasks_phase1_enabled", value: "true" },
    { key: "tasks_phase2_stage", value: "2c" },
    { key: "tasks_phase3_enabled", value: "true" },
  ]);
});

const statusUpdate = (body: Record<string, unknown>, date = today) =>
  asManager("POST", "/api/team-tracker/dev-1/status-update", { date, status: "blocked", ...body });

describe("P0-S6: manager status rationale visibility", () => {
  it("shows a shared rationale to the developer but never the manager's follow-up time", async () => {
    const res = await statusUpdate({ rationale: "Vendor contract still unsigned", nextFollowUpAt: followUp });
    expect(res.status).toBe(201);

    const mine = await asDeveloper("alice", "GET", `/api/my-day?date=${today}`);
    expect(mine.status).toBe(200);
    expect(mine.body.status).toBe("blocked");
    expect(mine.body.checkIns).toHaveLength(1);
    expect(mine.body.checkIns[0]).toMatchObject({ rationale: "Vendor contract still unsigned", authorType: "manager" });
    expect(JSON.stringify(mine.body)).not.toContain("2030-01-15");
    expect(mine.body).not.toHaveProperty("nextFollowUpAt");

    // The manager still has the follow-up time.
    const board = await asManager("GET", `/api/team-tracker?date=${today}`);
    expect(JSON.stringify(board.body)).toContain("2030-01-15");
  });

  it("defaults to shared when visibility is omitted", async () => {
    await statusUpdate({ rationale: "No flag given" });
    const row = (await db.select().from(teamTrackerCheckIns))[0]!;
    expect(row.visibility).toBe("shared");
  });

  it("keeps a private rationale, note and follow-up away from the developer, who still sees the status", async () => {
    const res = await statusUpdate({ rationale: "Performance concern, not yet raised with Alice", nextFollowUpAt: followUp, visibility: "private" });
    expect(res.status).toBe(201);

    const mine = await asDeveloper("alice", "GET", `/api/my-day?date=${today}`);
    expect(mine.status).toBe(200);
    expect(mine.body.status).toBe("blocked");
    expect(mine.body.checkIns).toEqual([]);
    const payload = JSON.stringify(mine.body);
    expect(payload).not.toContain("Performance concern");
    expect(payload).not.toContain("2030-01-15");
    const tasks = await asDeveloper("alice", "GET", `/api/my-day/tasks?date=${today}`);
    expect(JSON.stringify(tasks.body)).not.toContain("Performance concern");

    // Manager side is intact: the check-in is stored, flagged private, and readable.
    const row = (await db.select().from(teamTrackerCheckIns))[0]!;
    expect(row.visibility).toBe("private");
    expect(row.rationale).toBe("Performance concern, not yet raised with Alice");
    const board = await asManager("GET", `/api/team-tracker?date=${today}`);
    const alice = board.body.developers.find((entry: { developer: { accountId: string } }) => entry.developer.accountId === "dev-1");
    expect(alice.checkIns.map((c: { visibility: string; rationale: string }) => [c.visibility, c.rationale])).toEqual([["private", "Performance concern, not yet raised with Alice"]]);
  });

  it("filters private check-ins from a developer's history view too", async () => {
    const yesterday = addDaysIso(today, -1);
    expect((await statusUpdate({ rationale: "Old private note", visibility: "private" }, yesterday)).status).toBe(201);
    expect((await statusUpdate({ rationale: "Old shared note" }, yesterday)).status).toBe(201);
    const mine = await asDeveloper("alice", "GET", `/api/my-day?date=${yesterday}`);
    expect(mine.status).toBe(200);
    expect(mine.body.viewMode).not.toBe("live");
    expect(mine.body.checkIns.map((c: { rationale: string }) => c.rationale)).toEqual(["Old shared note"]);
    expect(JSON.stringify(mine.body)).not.toContain("Old private note");
  });

  it("does not leak the rationale through task events when a private update names a task", async () => {
    const task = await new TaskService().create({ title: "Vendor work", ownerType: "developer", ownerId: "dev-1" }, { type: "manager", accountId: "manager-a", workspaceId: "default" });
    // A private status update cannot be linked to a task (its blocker event would be shared).
    expect((await statusUpdate({ rationale: "secret", visibility: "private", taskKey: task.taskKey })).status).toBe(400);
    // A private check-in cannot reference tasks, and a T-key in its text creates no shared checkin_ref event.
    expect((await asManager("POST", "/api/team-tracker/dev-1/checkins", { date: today, summary: "x", visibility: "private", taskKeys: [task.taskKey] })).status).toBe(400);
    const ok = await asManager("POST", "/api/team-tracker/dev-1/checkins", { date: today, summary: `Worried about ${task.taskKey} quality`, visibility: "private" });
    expect(ok.status).toBe(201);
    expect(await db.select().from(checkinTaskRefs)).toEqual([]);
    const events = await asDeveloper("alice", "GET", `/api/my-day/tasks/${task.taskKey}/events`);
    expect(events.status).toBe(200);
    expect(JSON.stringify(events.body)).not.toContain("quality");
    expect(events.body.events.filter((e: { type: string }) => e.type === "checkin_ref")).toEqual([]);

    // Control: the same text as a shared check-in does show up (the dialog warns for this).
    await asManager("POST", "/api/team-tracker/dev-1/checkins", { date: today, summary: `Shared note on ${task.taskKey}` });
    const after = await asDeveloper("alice", "GET", `/api/my-day/tasks/${task.taskKey}/events`);
    expect(after.body.events.filter((e: { type: string }) => e.type === "checkin_ref")).toHaveLength(1);
  });
});

describe("P0-S6: last check-in time", () => {
  it("does not move the developer's last check-in time for a private check-in", async () => {
    const shared = await asManager("POST", "/api/team-tracker/dev-1/checkins", { date: today, summary: "Shared note" });
    expect(shared.status).toBe(201);
    const before = (await asDeveloper("alice", "GET", `/api/my-day?date=${today}`)).body.lastCheckInAt;
    expect(before).toBe(shared.body.createdAt);

    await new Promise((resolve) => setTimeout(resolve, 5));
    expect((await asManager("POST", "/api/team-tracker/dev-1/checkins", { date: today, summary: "Private note", visibility: "private" })).status).toBe(201);

    expect((await asDeveloper("alice", "GET", `/api/my-day?date=${today}`)).body.lastCheckInAt).toBe(before);
    // The manager's clock still counts it.
    const board = await asManager("GET", `/api/team-tracker?date=${today}`);
    const alice = board.body.developers.find((day: { developer: { accountId: string } }) => day.developer.accountId === "dev-1");
    expect(alice.lastCheckInAt > before).toBe(true);
  });

  it("omits the last check-in time when every check-in is private", async () => {
    expect((await asManager("POST", "/api/team-tracker/dev-1/checkins", { date: today, summary: "Private", visibility: "private" })).status).toBe(201);
    const mine = await asDeveloper("alice", "GET", `/api/my-day?date=${today}`);
    expect(mine.body.lastCheckInAt).toBeUndefined();
  });
});

describe("P0-S6: role boundaries", () => {
  it("lets a developer write only shared check-ins, and only through /api/my-day", async () => {
    const own = await asDeveloper("alice", "POST", "/api/my-day/checkins", { date: today, summary: "Trying to hide this", visibility: "private" });
    expect(own.status).toBe(201);
    expect((await db.select().from(teamTrackerCheckIns).where(eq(teamTrackerCheckIns.id, own.body.id)))[0]!.visibility).toBe("shared");
    expect((await asDeveloper("alice", "POST", "/api/team-tracker/dev-1/status-update", { date: today, status: "blocked", rationale: "x", visibility: "private" })).status).toBe(403);
    expect((await asDeveloper("alice", "POST", "/api/team-tracker/dev-1/checkins", { date: today, summary: "x", visibility: "private" })).status).toBe(403);
  });

  it("does not show another developer's private or shared manager check-ins", async () => {
    await statusUpdate({ rationale: "About Alice only" });
    const bob = await asDeveloper("bob", "GET", `/api/my-day?date=${today}`);
    expect(bob.status).toBe(200);
    expect(bob.body.checkIns).toEqual([]);
    expect(JSON.stringify(bob.body)).not.toContain("About Alice");
  });

  it("rejects an unknown visibility value", async () => {
    expect((await statusUpdate({ rationale: "x", visibility: "hidden" })).status).toBe(400);
  });
});
