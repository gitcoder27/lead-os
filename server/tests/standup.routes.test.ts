import { beforeEach, describe, expect, it } from "vitest";
import express from "express";
import { createTeamTrackerRouter } from "../src/routes/team-tracker";
import { TeamTrackerService } from "../src/services/team-tracker.service";
import { TaskService } from "../src/services/task.service";
import { TaskEventsService } from "../src/services/task-events.service";
import { TaskKeysService } from "../src/services/task-keys.service";
import { notFoundHandler, errorHandler } from "../src/middleware/errorHandler";
import { eq } from "drizzle-orm";
import { resetDatabase, db } from "./helpers/db";
import { configTable, developers, standupSessions, tasks, teamTrackerCheckIns, teamTrackerDays } from "../src/db/schema";
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
    const inside = new Date(now - 2 * 60 * 60 * 1000).toISOString();
    const outside = new Date(now - 30 * 60 * 60 * 1000).toISOString();

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
    const isMonday = new Date(`${today}T12:00:00`).getDay() === 1;
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
    expect(second.body.followUps).toEqual([]);
    const sessions = await db.select().from(standupSessions);
    expect(sessions).toHaveLength(1);
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

  it("anchors the next standup feed to the sealed session end", async () => {
    await enablePhase3();
    const task = await createDevTask("active", "Migration");
    await eventsService.append(
      { workspaceId: "default", taskKey: task.taskKey, type: "update", meta: null, body: "before seal", occurredAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString() },
      { type: "developer", accountId: "dev-1" },
    );
    const seal = await invoke("POST", "/api/team-tracker/standup/session", sessionPayload({ flagged: [] }));
    expect(seal.status).toBe(201);
    await eventsService.append(
      { workspaceId: "default", taskKey: task.taskKey, type: "update", meta: null, body: "after seal" },
      { type: "developer", accountId: "dev-1" },
    );

    const response = await invoke("GET", "/api/team-tracker/standup/feed?accountId=dev-1");
    expect(response.status).toBe(200);
    const feed = response.body;
    expect(feed.anchoredToSession).toBe(true);
    expect(feed.windowStart).toBe(seal.body.session.endedAt);
    const bodies = feed.entries.map((entry: { body?: string | null }) => entry.body);
    expect(bodies).toContain("after seal");
    expect(bodies).not.toContain("before seal");
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
