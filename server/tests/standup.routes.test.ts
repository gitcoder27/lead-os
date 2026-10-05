import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import { createTeamTrackerRouter } from "../src/routes/team-tracker";
import { TeamTrackerService } from "../src/services/team-tracker.service";
import { TaskService } from "../src/services/task.service";
import { TaskEventsService } from "../src/services/task-events.service";
import { TaskKeysService } from "../src/services/task-keys.service";
import { notFoundHandler, errorHandler } from "../src/middleware/errorHandler";
import { eq } from "drizzle-orm";
import { resetDatabase, db } from "./helpers/db";
import { enableCollabParticipation } from "./helpers/team-mode";
import { configTable, developers, standupReviews, standupSessions, taskLinks, tasks, teamTrackerCheckIns, teamTrackerDays, todayCheckInAsks } from "../src/db/schema";
import { todayIsoDate } from "../src/utils/date";
import type { TaskStatus } from "shared/types";

const trackerService = new TeamTrackerService();
const taskService = new TaskService();
const keysService = new TaskKeysService();
const eventsService = new TaskEventsService(keysService);

function createTestApp() {
  const app = express();
  app.use((req, _res, next) => {
    req.auth = {
      sessionId: "test-session",
      user: {
        username: "manager",
        accountId: "manager-1",
        displayName: "Manager One",
        role: "manager",
      },
    };
    next();
  });
  app.use("/api/team-tracker", createTeamTrackerRouter(trackerService));
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

const app = createTestApp();
afterEach(() => vi.useRealTimers());

describe("Standup manager clock", () => {
  it("keeps a manager's local today live across UTC midnight", async () => {
    await enablePhase3();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-29T01:00:00Z"));
    const response = await invoke("GET", "/api/team-tracker?date=2026-09-28&tz=America%2FLos_Angeles");
    expect(response.body.viewMode).toBe("live");
    const feed = await trackerService.getStandupFeed("dev-1", "manager-1", "default", "America/Los_Angeles");
    expect(feed.windowHours).toBe(72);
  });
});

describe("Standup person note retries", () => {
  it("returns the same note and rejects a retry for another person", async () => {
    await enablePhase3();
    const body = { date: todayIsoDate(), summary: "Manager context", requestId: crypto.randomUUID() };
    const first = await invoke("POST", "/api/team-tracker/dev-1/checkins", body);
    const second = await invoke("POST", "/api/team-tracker/dev-1/checkins", body);
    expect(first.status).toBe(201);
    expect(second.body.id).toBe(first.body.id);
    expect(await db.select().from(teamTrackerCheckIns)).toHaveLength(1);
    expect((await invoke("POST", "/api/team-tracker/dev-2/checkins", body)).status).toBe(409);
  });
});

async function invoke(method: string, url: string, body?: unknown) {
  const { invoke: call } = await import("./helpers/http");
  return call(app, { method, url, body: body as Record<string, unknown> });
}

async function enablePhase3() {
  await db.insert(configTable).values([
    { key: "tasks_phase2_stage", value: "2c" },
    { key: "tasks_phase3_enabled", value: "true" },
  ]);
}

async function enableCanonical() {
  await db.insert(configTable).values({ key: "tasks_phase2_stage", value: "2c" });
}

async function createDevTask(status: TaskStatus, title = "Blocked work") {
  return taskService.create(
    { title, ownerType: "developer", ownerId: "dev-1", status },
    { type: "manager", accountId: "manager-1", workspaceId: "default" },
  );
}

beforeEach(async () => {
  await resetDatabase();
  await db.insert(configTable).values({ key: "tasks_phase1_enabled", value: "true" });
  await db.insert(developers).values([
    { accountId: "dev-1", displayName: "Alice Smith", isActive: 1 },
    { accountId: "dev-2", displayName: "Bob Jones", isActive: 1 },
  ]);
});

describe("GET /api/team-tracker/standup/feed (P3-D5/D6)", () => {
  it("includes instructions and decisions and discloses truncation", async () => {
    await enablePhase3();
    const task = await createDevTask("active");
    for (let index = 0; index < 121; index += 1) {
      await eventsService.append({ workspaceId: "default", taskKey: task.taskKey, type: index % 2 ? "instruction" : "decision", meta: null, body: `Message ${index}` }, { type: "manager", accountId: "manager-1" });
    }
    const feed = await trackerService.getStandupFeed("dev-1", "manager-1");
    expect(feed.truncated).toBe(true);
    expect(feed.entries).toHaveLength(120);
    expect(feed.entries.some((entry) => entry.type === "instruction")).toBe(true);
    expect(feed.entries.some((entry) => entry.type === "decision")).toBe(true);
    expect(feed.windowEnd).toBeTruthy();
    expect(feed.entries.every((entry) => entry.authorId === "manager-1")).toBe(true);
  });

  it("retains shared changes when a task is reassigned away", async () => {
    await enablePhase3();
    const task = await createDevTask("open");
    await eventsService.append({ workspaceId: "default", taskKey: task.taskKey, type: "update", body: "Before handoff", meta: null }, { type: "developer", accountId: "dev-1" });
    await taskService.update(task.taskKey, { ownerType: "developer", ownerId: "dev-2" }, { type: "manager", accountId: "manager-1" });
    const feed = await trackerService.getStandupFeed("dev-1", "manager-1");
    expect(feed.entries.some((entry) => entry.body === "Before handoff")).toBe(true);
    expect(feed.entries.some((entry) => entry.type === "assign")).toBe(true);
  });

  it("excludes generated check-in administration by metadata, not title", async () => {
    await enablePhase3();
    const generated = await createDevTask("open", "Send a check-in");
    const ordinary = await createDevTask("open", "Send a check-in");
    await db.insert(todayCheckInAsks).values({ managerAccountId: "manager-1", developerAccountId: "dev-1", date: todayIsoDate(), askedAt: new Date().toISOString(), title: generated.title, taskKey: generated.taskKey });
    const board = await trackerService.getBoard(todayIsoDate());
    const person = board.developers.find((entry) => entry.developer.accountId === "dev-1")!;
    expect(person.tasks?.find((task) => task.taskKey === generated.taskKey)?.checkInRequest).toBe(true);
    expect(person.tasks?.find((task) => task.taskKey === ordinary.taskKey)?.checkInRequest).toBeUndefined();
    const feed = await trackerService.getStandupFeed("dev-1", "manager-1");
    expect(feed.entries.some((entry) => entry.taskKey === generated.taskKey)).toBe(false);
    expect(feed.entries.some((entry) => entry.taskKey === ordinary.taskKey)).toBe(true);
  });

  it("does not expose another manager's private person note", async () => {
    await enablePhase3();
    await trackerService.addCheckIn("dev-1", todayIsoDate(), { summary: "Private context", visibility: "private" }, { type: "manager", accountId: "manager-2" });
    const feed = await trackerService.getStandupFeed("dev-1", "manager-1");
    expect(feed.entries.some((entry) => entry.summary === "Private context")).toBe(false);
  });
  it("404s while the Phase 3 flag is off", async () => {
    await enableCanonical();
    const response = await invoke("GET", "/api/team-tracker/standup/feed?accountId=dev-1");
    expect(response.status).toBe(404);
  });

  it("404s for an unknown developer", async () => {
    await enablePhase3();
    const response = await invoke("GET", "/api/team-tracker/standup/feed?accountId=nobody");
    expect(response.status).toBe(404);
  });

  it("returns shared task events and check-ins inside the rolling window", async () => {
    await enablePhase3();
    const task = await createDevTask("active", "Migration");
    const now = Date.now();
    const isMonday = new Date(`${todayIsoDate()}T12:00:00`).getDay() === 1;
    const inside = new Date(now - 2 * 60 * 60 * 1000).toISOString();
    const outside = new Date(now - (isMonday ? 80 : 30) * 60 * 60 * 1000).toISOString();

    await eventsService.append(
      { workspaceId: "default", taskKey: task.taskKey, type: "update", meta: null, body: "inside window", occurredAt: inside },
      { type: "developer", accountId: "dev-1" },
    );
    await eventsService.append(
      { workspaceId: "default", taskKey: task.taskKey, type: "update", meta: null, body: "private note", visibility: "private", occurredAt: inside },
      { type: "manager", accountId: "manager-1" },
    );
    await eventsService.append(
      { workspaceId: "default", taskKey: task.taskKey, type: "update", meta: null, body: "outside window", occurredAt: outside },
      { type: "developer", accountId: "dev-1" },
    );
    const other = await taskService.create(
      { title: "Other owner", ownerType: "developer", ownerId: "dev-2" },
      { type: "manager", accountId: "manager-1", workspaceId: "default" },
    );
    await eventsService.append(
      { workspaceId: "default", taskKey: other.taskKey, type: "update", meta: null, body: "someone else's task", occurredAt: inside },
      { type: "developer", accountId: "dev-2" },
    );

    const today = todayIsoDate();
    const [day] = await db
      .insert(teamTrackerDays)
      .values({ date: today, developerAccountId: "dev-1", status: "on_track", createdAt: inside, updatedAt: inside })
      .returning();
    await db.insert(teamTrackerCheckIns).values({
      dayId: day!.id,
      summary: "Yesterday's wrap",
      authorType: "manager",
      authorAccountId: "manager-1",
      createdAt: inside,
    });

    const response = await invoke("GET", "/api/team-tracker/standup/feed?accountId=dev-1");
    expect(response.status).toBe(200);
    const feed = response.body;
    expect(feed.windowHours).toBe(isMonday ? 72 : 24);
    expect(new Date(feed.windowStart).getTime()).toBeLessThanOrEqual(Date.now() - feed.windowHours * 3600 * 1000 + 1000);

    const bodies = feed.entries.map((entry: { body?: string | null; summary?: string }) => entry.body ?? entry.summary);
    // "created" + the inside update + the check-in; private/old/other-owner excluded.
    expect(bodies).toContain("inside window");
    expect(bodies).toContain("Yesterday's wrap");
    expect(bodies).not.toContain("private note");
    expect(bodies).not.toContain("outside window");
    expect(bodies).not.toContain("someone else's task");

    const ids = feed.entries.map((entry: { id: string }) => entry.id);
    expect(ids.some((id: string) => id.startsWith("event:"))).toBe(true);
    expect(ids.some((id: string) => id.startsWith("checkin:"))).toBe(true);
    const occurred = feed.entries.map((entry: { occurredAt: string }) => entry.occurredAt);
    expect([...occurred].sort().reverse()).toEqual(occurred);
  });

  it("lifts status transitions and blocker actions out of event meta (docs/50 S6)", async () => {
    await enablePhase3();
    const task = await createDevTask("active", "Migration");
    await eventsService.append(
      { workspaceId: "default", taskKey: task.taskKey, type: "blocker", meta: { action: "raised" }, body: "Waiting on DBA" },
      { type: "developer", accountId: "dev-1" },
    );

    const response = await invoke("GET", "/api/team-tracker/standup/feed?accountId=dev-1");
    expect(response.status).toBe(200);
    const entries = response.body.entries as Array<Record<string, unknown>>;
    const status = entries.find((entry) => entry.type === "status");
    expect(status).toMatchObject({ statusFrom: "open", statusTo: "active", statusReason: "user" });
    const blocker = entries.find((entry) => entry.type === "blocker");
    expect(blocker).toMatchObject({ blockerAction: "raised", body: "Waiting on DBA" });
    const created = entries.find((entry) => entry.type === "created");
    expect(created).not.toHaveProperty("statusTo");
  });
});

describe("POST /api/team-tracker/standup/session (docs/50 v2)", () => {
  function sessionPayload(overrides: Record<string, unknown> = {}) {
    return {
      date: todayIsoDate(),
      startedAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
      reviewed: ["dev-1", "dev-2"],
      flagged: ["dev-2"],
      log: [{ accountId: "dev-1", kind: "done", taskKey: "T-1", at: new Date().toISOString() }],
      summary: "Standup — 2/2 reviewed",
      requestId: crypto.randomUUID(),
      ...overrides,
    };
  }

  it("seals the session and creates a real follow-up task per flagged person", async () => {
    await enablePhase3();
    const payload = sessionPayload();
    const response = await invoke("POST", "/api/team-tracker/standup/session", payload);
    expect(response.status).toBe(201);
    expect(response.body.session).toMatchObject({
      date: payload.date,
      startedAt: payload.startedAt,
      reviewed: ["dev-1", "dev-2"],
      flagged: ["dev-2"],
      summary: payload.summary,
    });
    expect(response.body.followUps).toEqual([
      { accountId: "dev-2", taskKey: expect.stringMatching(/^T-\d+$/) },
    ]);
    const [row] = await db.select().from(tasks).where(eq(tasks.taskKey, response.body.followUps[0].taskKey));
    expect(row!.title).toBe("Standup follow-up: Bob Jones");
    expect(row!.ownerType).toBe("manager");
    expect(row!.ownerId).toBe("manager-1");
    expect(row!.followUpAt).toBeTruthy();
    expect(row!.labelsJson).toContain("category:follow_up");
  });

  it("is idempotent on requestId — no duplicate session or tasks", async () => {
    await enablePhase3();
    const payload = sessionPayload();
    const first = await invoke("POST", "/api/team-tracker/standup/session", payload);
    const second = await invoke("POST", "/api/team-tracker/standup/session", payload);
    expect(second.status).toBe(201);
    expect(second.body.session.id).toBe(first.body.session.id);
    expect(second.body.followUps).toEqual(first.body.followUps);
    const sessions = await db.select().from(standupSessions);
    expect(sessions).toHaveLength(1);
  });

  it("serializes concurrent retries and same-day rounds without duplicate follow-ups", async () => {
    await enablePhase3();
    const payload = sessionPayload();
    const [first, retry] = await Promise.all([
      trackerService.recordStandupSession("manager-1", payload),
      trackerService.recordStandupSession("manager-1", payload),
    ]);
    expect(retry).toEqual(first);
    const [second, third] = await Promise.all([
      trackerService.recordStandupSession("manager-1", sessionPayload()),
      trackerService.recordStandupSession("manager-1", sessionPayload()),
    ]);
    expect(second.followUps).toEqual(first.followUps);
    expect(third.followUps).toEqual(first.followUps);
    expect(await db.select().from(standupSessions)).toHaveLength(3);
    expect(await db.select().from(tasks)).toHaveLength(1);
  });

  it("does not reuse unrelated manager follow-ups linked to the same person", async () => {
    await enablePhase3();
    const principal = { type: "manager" as const, accountId: "manager-1" };
    const ordinary = await taskService.create({ title: "Discuss next quarter", scheduledOn: todayIsoDate(), labels: ["category:follow_up"] }, principal);
    await taskService.addLink(ordinary.taskKey, { kind: "person", ref: "dev-1" }, principal);
    const result = await trackerService.recordStandupSession("manager-1", sessionPayload());
    expect(result.followUps[0]?.taskKey).not.toBe(ordinary.taskKey);
  });

  it.each([
    { date: "2026-02-30" },
    { reviewed: [], flagged: [], log: [] },
    { reviewed: ["unknown"] },
    { startedAt: "2999-01-01T00:00:00Z" },
  ])("rejects invalid or empty session input %j", async (overrides) => {
    await enablePhase3();
    expect((await invoke("POST", "/api/team-tracker/standup/session", sessionPayload(overrides))).status).toBe(400);
    expect(await db.select().from(standupSessions)).toHaveLength(0);
  });

  it("keeps mid-round changes and a skipped person's earlier changes in the next feed", async () => {
    await enablePhase3();
    const startedAt = new Date(Date.now() - 3600000).toISOString();
    const task = await createDevTask("open");
    await eventsService.append({ workspaceId: "default", taskKey: task.taskKey, type: "update", body: "Arrived during round", meta: null, occurredAt: new Date(Date.now() - 1800000).toISOString() }, { type: "developer", accountId: "dev-1" });
    await invoke("POST", "/api/team-tracker/standup/session", sessionPayload({ startedAt, reviewed: ["dev-1"], flagged: [], feedSeenThrough: { "dev-1": new Date().toISOString() } }));
    const feed = await trackerService.getStandupFeed("dev-1", "manager-1");
    expect(feed.entries.some((entry) => entry.body === "Arrived during round")).toBe(true);
    const skipped = await trackerService.getStandupFeed("dev-2", "manager-1");
    expect(Date.parse(skipped.windowStart)).toBeLessThanOrEqual(Date.parse(startedAt) - 72 * 3600000);
  });

  it("reuses the open follow-up when the same person is flagged again the same day (docs/51 D6)", async () => {
    await enablePhase3();
    const first = await invoke("POST", "/api/team-tracker/standup/session", sessionPayload());
    expect(first.status).toBe(201);
    const second = await invoke("POST", "/api/team-tracker/standup/session", sessionPayload({ summary: "second round" }));
    expect(second.status).toBe(201);
    expect(second.body.session.id).not.toBe(first.body.session.id);
    // Same person, same day: the response points at the existing open task.
    expect(second.body.followUps).toEqual([{ accountId: "dev-2", taskKey: first.body.followUps[0].taskKey }]);
    const rows = await db.select().from(tasks).where(eq(tasks.title, "Standup follow-up: Bob Jones"));
    expect(rows).toHaveLength(1);

    // A different person still gets their own task.
    const third = await invoke("POST", "/api/team-tracker/standup/session", sessionPayload({ flagged: ["dev-1"], summary: "third" }));
    expect(third.body.followUps).toHaveLength(1);
    expect(third.body.followUps[0].taskKey).not.toBe(first.body.followUps[0].taskKey);

    // Once the follow-up is done, flagging again creates a fresh task.
    await db.update(tasks).set({ status: "done" }).where(eq(tasks.taskKey, first.body.followUps[0].taskKey));
    const fourth = await invoke("POST", "/api/team-tracker/standup/session", sessionPayload({ flagged: ["dev-2"], summary: "fourth" }));
    expect(fourth.body.followUps).toHaveLength(1);
    expect(fourth.body.followUps[0].taskKey).not.toBe(first.body.followUps[0].taskKey);
    const all = await db.select().from(tasks).where(eq(tasks.title, "Standup follow-up: Bob Jones"));
    expect(all).toHaveLength(2);
  });

  it("anchors only a seen person's feed conservatively to the round start", async () => {
    await enablePhase3();
    const task = await createDevTask("active", "Migration");
    await eventsService.append(
      { workspaceId: "default", taskKey: task.taskKey, type: "update", meta: null, body: "before seal", occurredAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString() },
      { type: "developer", accountId: "dev-1" },
    );
    const seal = await invoke("POST", "/api/team-tracker/standup/session", sessionPayload({ reviewed: ["dev-1"], flagged: [], feedSeenThrough: { "dev-1": new Date().toISOString() } }));
    expect(seal.status).toBe(201);
    await eventsService.append(
      { workspaceId: "default", taskKey: task.taskKey, type: "update", meta: null, body: "after seal" },
      { type: "developer", accountId: "dev-1" },
    );

    const response = await invoke("GET", "/api/team-tracker/standup/feed?accountId=dev-1");
    expect(response.status).toBe(200);
    const feed = response.body;
    expect(feed.anchoredToSession).toBe(true);
    expect(feed.windowStart).toBe(seal.body.session.startedAt);
    const bodies = feed.entries.map((entry: { body?: string | null }) => entry.body);
    expect(bodies).toContain("after seal");
    expect(bodies).not.toContain("before seal");
    const skipped = await trackerService.getStandupFeed("dev-2", "manager-1");
    expect(skipped.anchoredToSession).toBe(false);
  });

  it("does not anchor another manager's feed window", async () => {
    await enablePhase3();
    await invoke("POST", "/api/team-tracker/standup/session", sessionPayload());
    // manager-1's session must not leak into a different manager's anchor; the
    // service is keyed by manager_account_id.
    const feed = await trackerService.getStandupFeed("dev-1", "manager-2", "default");
    expect(feed.anchoredToSession).toBe(false);
  });

  it("404s while the Phase 3 flag is off", async () => {
    await enableCanonical();
    const response = await invoke("POST", "/api/team-tracker/standup/session", sessionPayload());
    expect(response.status).toBe(404);
  });

  it("400s on an invalid body", async () => {
    await enablePhase3();
    const response = await invoke("POST", "/api/team-tracker/standup/session", sessionPayload({ requestId: "nope" }));
    expect(response.status).toBe(400);
  });
});

describe("flag reasons and person links on the sealed follow-up (docs/56 P1-07)", () => {
  function sessionPayload(overrides: Record<string, unknown> = {}) {
    return {
      date: todayIsoDate(),
      startedAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
      reviewed: ["dev-1", "dev-2"],
      flagged: ["dev-2"],
      log: [],
      summary: "Standup",
      requestId: crypto.randomUUID(),
      ...overrides,
    };
  }

  async function personLinks(taskKey: string) {
    const [task] = await db.select().from(tasks).where(eq(tasks.taskKey, taskKey));
    return db.select().from(taskLinks).where(eq(taskLinks.taskId, task!.id));
  }

  it("saves a specific manager action and check-by date and reuses it across retries", async () => {
    await enablePhase3();
    const followUpAt = "2026-10-06T03:30:00.000Z";
    const payload = sessionPayload({ followUpPlans: { "dev-2": { title: "Get the API decision from Priya", followUpAt } },
      log: [{ accountId: "dev-2", kind: "done", taskKey: "T-9", taskTitle: "Deployment checks", private: true, at: new Date().toISOString() }],
    });
    const first = await invoke("POST", "/api/team-tracker/standup/session", payload);
    expect(first.status).toBe(201);
    expect((await invoke("POST", "/api/team-tracker/standup/session", payload)).body).toEqual(first.body);
    const [task] = await db.select().from(tasks).where(eq(tasks.taskKey, first.body.followUps[0].taskKey));
    expect(task).toMatchObject({ title: "Get the API decision from Priya", followUpAt, ownerType: "manager", ownerId: "manager-1" });
    expect(await personLinks(task!.taskKey)).toHaveLength(1);
    const latest = await invoke("GET", "/api/team-tracker/standup/session/latest");
    expect(latest.body.session.log[0]).toMatchObject({ taskTitle: "Deployment checks", private: true });
    const second = await invoke("POST", "/api/team-tracker/standup/session", sessionPayload({ followUpPlans: {
      "dev-2": { title: "Send the agreed API decision", followUpAt: "2026-10-07T03:30:00.000Z" },
    } }));
    expect(second.body.followUps).toEqual(first.body.followUps);
    expect(await db.select().from(tasks)).toHaveLength(1);
    expect((await db.select().from(tasks))[0]).toMatchObject({ title: "Send the agreed API decision", followUpAt: "2026-10-07T03:30:00.000Z" });
    const third = await invoke("POST", "/api/team-tracker/standup/session", sessionPayload({ followUpPlans: { "dev-2": { title: "Check the decision now" } } }));
    expect(third.body.followUps).toEqual(first.body.followUps);
    expect((await db.select().from(tasks))[0]!.followUpAt).not.toBe("2026-10-07T03:30:00.000Z");
  });

  it.each([
    { "dev-2": { title: "" } },
    { "dev-2": { title: "Check progress", followUpAt: "tomorrow" } },
    { "dev-1": { title: "Not flagged" } },
  ])("rejects invalid follow-up plans without creating tasks %j", async (followUpPlans) => {
    await enablePhase3();
    expect((await invoke("POST", "/api/team-tracker/standup/session", sessionPayload({ followUpPlans }))).status).toBe(400);
    expect(await db.select().from(tasks)).toHaveLength(0);
    expect(await db.select().from(standupSessions)).toHaveLength(0);
  });

  it("links the follow-up to the developer, with or without a reason", async () => {
    await enablePhase3();
    const response = await invoke("POST", "/api/team-tracker/standup/session", sessionPayload({ flagged: ["dev-1", "dev-2"] }));
    expect(response.status).toBe(201);
    for (const followUp of response.body.followUps as Array<{ accountId: string; taskKey: string }>) {
      const links = await personLinks(followUp.taskKey);
      expect(links.map((link) => [link.kind, link.ref])).toEqual([["person", followUp.accountId]]);
    }
    const [row] = await db.select().from(tasks).where(eq(tasks.taskKey, response.body.followUps[0].taskKey));
    expect(row!.details).toBeNull();
    expect(response.body.session.flagReasons).toBeUndefined();
  });

  it("puts the one-line reason on the task and the session record; the title stays stable", async () => {
    await enablePhase3();
    const response = await invoke("POST", "/api/team-tracker/standup/session", sessionPayload({
      flagReasons: { "dev-2": "  Waiting on   design\nreview  ", "dev-1": "not flagged, ignored" },
    }));
    expect(response.status).toBe(201);
    expect(response.body.session.flagReasons).toEqual({ "dev-2": "Waiting on design review" });
    const [row] = await db.select().from(tasks).where(eq(tasks.taskKey, response.body.followUps[0].taskKey));
    expect(row!.title).toBe("Standup follow-up: Bob Jones");
    expect(row!.details).toContain("Flagged in standup: Waiting on design review");
    const latest = await invoke("GET", "/api/team-tracker/standup/session/latest");
    expect(latest.body.session.flagReasons).toEqual({ "dev-2": "Waiting on design review" });
  });

  it("caps a reason at 200 characters", async () => {
    await enablePhase3();
    const response = await invoke("POST", "/api/team-tracker/standup/session", sessionPayload({ flagReasons: { "dev-2": "x".repeat(400) } }));
    expect(response.status).toBe(201);
    expect(response.body.session.flagReasons["dev-2"]).toHaveLength(200);
  });

  it("appends a new reason to the reused same-day follow-up, once", async () => {
    await enablePhase3();
    const first = await invoke("POST", "/api/team-tracker/standup/session", sessionPayload({ flagReasons: { "dev-2": "Design review" } }));
    const taskKey = first.body.followUps[0].taskKey;
    await invoke("POST", "/api/team-tracker/standup/session", sessionPayload({ flagReasons: { "dev-2": "Design review" } }));
    await invoke("POST", "/api/team-tracker/standup/session", sessionPayload({ flagReasons: { "dev-2": "Still blocked on QA" } }));
    const [row] = await db.select().from(tasks).where(eq(tasks.taskKey, taskKey));
    expect(row!.details).toBe("Flagged in standup: Design review\nFlagged in standup: Still blocked on QA");
    expect(await personLinks(taskKey)).toHaveLength(1);
  });

  it("does not guess person identity from an unlinked legacy title", async () => {
    await enablePhase3();
    const legacy = await taskService.create(
      { title: "Standup follow-up: Bob Jones", scheduledOn: todayIsoDate(), labels: ["category:follow_up"] },
      { type: "manager", accountId: "manager-1", workspaceId: "default" },
    );
    expect(await personLinks(legacy.taskKey)).toHaveLength(0);
    const response = await invoke("POST", "/api/team-tracker/standup/session", sessionPayload());
    expect(response.body.followUps[0].taskKey).not.toBe(legacy.taskKey);
    expect(await personLinks(legacy.taskKey)).toHaveLength(0);
  });

  it("keeps same-named people separate and reuses links after people or tasks are renamed", async () => {
    await enablePhase3();
    await db.update(developers).set({ displayName: "Same Name" });
    const first = await invoke("POST", "/api/team-tracker/standup/session", sessionPayload({ flagged: ["dev-1", "dev-2"] }));
    expect(new Set(first.body.followUps.map((entry: { taskKey: string }) => entry.taskKey)).size).toBe(2);
    await db.update(developers).set({ displayName: "Renamed Person" }).where(eq(developers.accountId, "dev-2"));
    await db.update(tasks).set({ title: "Renamed follow-up" });
    const second = await invoke("POST", "/api/team-tracker/standup/session", sessionPayload({ flagged: ["dev-1", "dev-2"] }));
    expect(second.body.followUps).toEqual(first.body.followUps);
  });

  it("400s on a reason that is not a string", async () => {
    await enablePhase3();
    const response = await invoke("POST", "/api/team-tracker/standup/session", sessionPayload({ flagReasons: { "dev-2": 5 } }));
    expect(response.status).toBe(400);
  });
});

describe("POST /api/team-tracker/standup/reviews (docs/56 P1-07)", () => {
  const body = (overrides: Record<string, unknown> = {}) => ({ date: todayIsoDate(), accountIds: ["dev-1"], ...overrides });
  const touchOf = async (accountId: string) =>
    (await trackerService.getBoard(todayIsoDate())).developers.find((day) => day.developer.accountId === accountId)!.signals.freshness;

  it("records the review as a manager touch without sealing the round", async () => {
    await enablePhase3();
    const before = await touchOf("dev-1");
    expect(before.clock).toBe("manager_touch");
    expect(before.lastManagerTouchAt).toBeUndefined();

    const response = await invoke("POST", "/api/team-tracker/standup/reviews", body({ accountIds: ["dev-1"] }));
    expect(response.status).toBe(201);
    expect(response.body).toEqual({ recorded: ["dev-1"] });
    expect(await db.select().from(standupSessions)).toHaveLength(0);

    const [row] = await db.select().from(standupReviews);
    expect(row).toMatchObject({ managerAccountId: "manager-1", developerAccountId: "dev-1", date: todayIsoDate() });
    const after = await touchOf("dev-1");
    expect(after.lastManagerTouchAt).toBe(row!.reviewedAt);
    // Only the reviewed person is touched.
    expect((await touchOf("dev-2")).lastManagerTouchAt).toBeUndefined();
  });

  it("is idempotent per person and day, and skips unknown accounts", async () => {
    await enablePhase3();
    const first = await invoke("POST", "/api/team-tracker/standup/reviews", body({ accountIds: ["dev-1", "ghost", "dev-1"] }));
    expect(first.body).toEqual({ recorded: ["dev-1"] });
    const second = await invoke("POST", "/api/team-tracker/standup/reviews", body());
    expect(second.status).toBe(201);
    expect(await db.select().from(standupReviews)).toHaveLength(1);
    const empty = await invoke("POST", "/api/team-tracker/standup/reviews", body({ accountIds: [] }));
    expect(empty.body).toEqual({ recorded: [] });
  });

  it.each([1, 5 * 60 * 1000])("acknowledges visits when the browser clock is %i ms ahead", async (skewMs) => {
    await enablePhase3();
    const now = "2026-10-05T06:00:00.000Z";
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(now));
    const reviewedAt = new Date(Date.parse(now) + skewMs).toISOString();

    const response = await invoke("POST", "/api/team-tracker/standup/reviews", body({
      reviewedAt: { "dev-1": reviewedAt },
    }));
    expect(response.status).toBe(201);
    expect(response.body).toEqual({ recorded: ["dev-1"] });
    const [row] = await db.select().from(standupReviews);
    expect(row!.reviewedAt).toBe(now);
    expect((await touchOf("dev-1")).lastManagerTouchAt).toBe(now);
  });

  it("preserves the actual visit time on a delayed retry and normalizes timestamp offsets", async () => {
    await enablePhase3();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-05T06:00:00.000Z"));
    const payload = body({ reviewedAt: { "dev-1": "2026-10-05T11:00:00+05:30" } });
    expect((await invoke("POST", "/api/team-tracker/standup/reviews", payload)).status).toBe(201);
    vi.setSystemTime(new Date("2026-10-05T07:00:00.000Z"));
    expect((await invoke("POST", "/api/team-tracker/standup/reviews", payload)).status).toBe(201);
    expect((await db.select().from(standupReviews))[0]!.reviewedAt).toBe("2026-10-05T05:30:00.000Z");

    // An older retry must never replace a newer acknowledged visit.
    await invoke("POST", "/api/team-tracker/standup/reviews", body({ reviewedAt: { "dev-1": "2026-10-05T05:00:00.000Z" } }));
    expect((await db.select().from(standupReviews))[0]!.reviewedAt).toBe("2026-10-05T05:30:00.000Z");
  });

  it("still rejects malformed visit times in the route and service", async () => {
    await enablePhase3();
    const payload = body({ reviewedAt: { "dev-1": "not-a-time" } });
    expect((await invoke("POST", "/api/team-tracker/standup/reviews", payload)).status).toBe(400);
    await expect(trackerService.recordStandupReviews("manager-1", {
      date: todayIsoDate(), accountIds: ["dev-1"], reviewedAt: { "dev-1": "not-a-time" },
    })).rejects.toThrow("Invalid review time");
    expect(await db.select().from(standupReviews)).toHaveLength(0);
  });

  it("does not count for a developer who checks in (their clock is the check-in)", async () => {
    await enablePhase3();
    await enableCollabParticipation(["dev-1"]);
    await invoke("POST", "/api/team-tracker/standup/reviews", body());
    const freshness = await touchOf("dev-1");
    expect(freshness.clock).toBe("check_in");
    expect(freshness.lastManagerTouchAt).toBeUndefined();
  });

  it("404s while the Phase 3 flag is off and 400s on a bad body", async () => {
    await enableCanonical();
    expect((await invoke("POST", "/api/team-tracker/standup/reviews", body())).status).toBe(404);
    await db.delete(configTable);
    await db.insert(configTable).values([
      { key: "tasks_phase2_stage", value: "2c" },
      { key: "tasks_phase3_enabled", value: "true" },
    ]);
    expect((await invoke("POST", "/api/team-tracker/standup/reviews", body({ date: "yesterday" }))).status).toBe(400);
    expect((await invoke("POST", "/api/team-tracker/standup/reviews", { date: todayIsoDate() })).status).toBe(400);
  });
});

describe("GET /api/team-tracker/standup/session/latest (docs/50 v2)", () => {
  function sessionPayload(overrides: Record<string, unknown> = {}) {
    return {
      date: todayIsoDate(),
      startedAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
      reviewed: ["dev-1"],
      flagged: ["dev-2"],
      log: [{ accountId: "dev-1", kind: "done", taskKey: "T-1", at: new Date().toISOString() }],
      summary: "Standup — 1/2 reviewed",
      requestId: crypto.randomUUID(),
      ...overrides,
    };
  }

  it("returns null before any session is sealed", async () => {
    await enablePhase3();
    const response = await invoke("GET", "/api/team-tracker/standup/session/latest");
    expect(response.status).toBe(200);
    expect(response.body.session).toBeNull();
  });

  it("returns the latest sealed session with its parsed log", async () => {
    await enablePhase3();
    const payload = sessionPayload();
    await invoke("POST", "/api/team-tracker/standup/session", payload);
    await invoke("POST", "/api/team-tracker/standup/session", sessionPayload({ summary: "newer round" }));

    const response = await invoke("GET", "/api/team-tracker/standup/session/latest");
    expect(response.status).toBe(200);
    expect(response.body.session.summary).toBe("newer round");
    expect(response.body.session.log).toEqual([
      expect.objectContaining({ accountId: "dev-1", kind: "done", taskKey: "T-1" }),
    ]);
    expect(response.body.session.flagged).toEqual(["dev-2"]);
  });
});

describe("statusSuggestion on the board (P3-D11)", () => {
  it("suggests blocked when an owned task is blocked and the day status is not", async () => {
    await enablePhase3();
    await createDevTask("blocked", "Stuck migration");
    const response = await invoke("GET", `/api/team-tracker?date=${todayIsoDate()}`);
    expect(response.status).toBe(200);
    const dev = response.body.developers.find((entry: { developer: { accountId: string } }) => entry.developer.accountId === "dev-1");
    expect(dev.statusSuggestion).toEqual({
      status: "blocked",
      reasonTaskKey: expect.stringMatching(/^T-\d+$/),
      reasonTaskTitle: "Stuck migration",
    });
  });

  it("omits the suggestion when the day is already blocked or tasks are fine", async () => {
    await enablePhase3();
    const task = await createDevTask("blocked");
    const today = todayIsoDate();
    await db.insert(teamTrackerDays).values({
      date: today,
      developerAccountId: "dev-1",
      status: "blocked",
      createdAt: `${today}T08:00:00.000Z`,
      updatedAt: `${today}T08:00:00.000Z`,
    });
    const response = await invoke("GET", `/api/team-tracker?date=${today}`);
    const dev = response.body.developers.find((entry: { developer: { accountId: string } }) => entry.developer.accountId === "dev-1");
    expect(dev.statusSuggestion).toBeUndefined();
    expect(task.taskKey).toMatch(/^T-\d+$/);
  });

  it("omits the suggestion while the Phase 3 flag is off (canonical stage only)", async () => {
    await enableCanonical();
    await createDevTask("blocked");
    const response = await invoke("GET", `/api/team-tracker?date=${todayIsoDate()}`);
    expect(response.status).toBe(200);
    const dev = response.body.developers.find((entry: { developer: { accountId: string } }) => entry.developer.accountId === "dev-1");
    expect(dev.statusSuggestion).toBeUndefined();
  });
});
