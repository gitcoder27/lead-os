import { beforeEach, describe, expect, it } from "vitest";
import express from "express";
import { createTeamTrackerRouter } from "../src/routes/team-tracker";
import { TeamTrackerService } from "../src/services/team-tracker.service";
import { TaskService } from "../src/services/task.service";
import { TaskEventsService } from "../src/services/task-events.service";
import { TaskKeysService } from "../src/services/task-keys.service";
import { notFoundHandler, errorHandler } from "../src/middleware/errorHandler";
import { resetDatabase, db } from "./helpers/db";
import { configTable, developers, teamTrackerCheckIns, teamTrackerDays } from "../src/db/schema";
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
