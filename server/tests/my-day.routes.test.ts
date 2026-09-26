import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import { createMyDayRouter } from "../src/routes/my-day";
import { notFoundHandler, errorHandler } from "../src/middleware/errorHandler";
import { AuthService, serializeSessionCookie } from "../src/services/auth.service";
import { ManagerDeskService } from "../src/services/manager-desk.service";
import { MyDayService } from "../src/services/my-day.service";
import { TaskEventsService } from "../src/services/task-events.service";
import { TaskService } from "../src/services/task.service";
import { TeamTrackerService } from "../src/services/team-tracker.service";
import { todayIsoDate } from "../src/utils/date";
import { IssueService } from "../src/services/issue.service";
import { resetDatabase, db } from "./helpers/db";
import { configTable, developers, issues, teamTrackerDays } from "../src/db/schema";
import { invoke } from "./helpers/http";

const authService = new AuthService();
const trackerService = new TeamTrackerService();
const managerDeskService = new ManagerDeskService(trackerService);
const myDayService = new MyDayService(trackerService);
const eventsService = new TaskEventsService();
const issueService = new IssueService();

async function seedDevelopers() {
  await db.insert(developers).values([
    { accountId: "dev-1", displayName: "Alice Smith", email: "alice@example.com", avatarUrl: null, isActive: 1 },
    { accountId: "dev-2", displayName: "Bob Jones", email: "bob@example.com", avatarUrl: null, isActive: 1 },
  ]);
}

async function seedIssue(jiraKey = "AM-123", assigneeId = "dev-1", assigneeName = "Alice Smith") {
  await db.insert(issues).values({
    jiraKey,
    summary: "Linked Jira task",
    description: null,
    aspenSeverity: null,
    priorityName: "High",
    priorityId: "1",
    statusName: "In Progress",
    statusCategory: "indeterminate",
    assigneeId,
    assigneeName,
    teamScopeState: "in_team",
    syncScopeState: "active",
    reporterName: "Lead",
    component: null,
    labels: JSON.stringify([]),
    dueDate: "2026-03-10",
    developmentDueDate: "2026-03-08",
    flagged: 0,
    createdAt: "2026-03-07T08:00:00.000Z",
    updatedAt: "2026-03-07T08:00:00.000Z",
    syncedAt: "2026-03-07T08:00:00.000Z",
    lastSeenInScopedSyncAt: "2026-03-07T08:00:00.000Z",
    lastReconciledAt: "2026-03-07T08:00:00.000Z",
    scopeChangedAt: null,
    analysisNotes: null,
    excluded: 0,
  });
}

async function loginCookie(username: string, password: string): Promise<string> {
  const { sessionId } = await authService.authenticate(username, password);
  return serializeSessionCookie(sessionId, authService.sessionMaxAgeSeconds);
}

function createTestApp() {
  const app = express();
  app.use("/api/my-day", createMyDayRouter(myDayService, authService, issueService));
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

describe("my day routes", () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-07T08:00:00.000Z"));
    await resetDatabase();
    await seedDevelopers();
    await authService.createUser({
      username: "manager",
      displayName: "Manager",
      password: "secret123",
      role: "manager",
    });
    await authService.createUser({
      username: "alice",
      displayName: "Alice Smith",
      password: "secret123",
      role: "developer",
      developerAccountId: "dev-1",
    });
    await authService.createUser({
      username: "bob",
      displayName: "Bob Jones",
      password: "secret123",
      role: "developer",
      developerAccountId: "dev-2",
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("GET /api/my-day returns the authenticated developer day and omits manager notes", async () => {
    await trackerService.updateDay("dev-1", "2026-03-07", {
      status: "blocked",
      managerNotes: "Private manager note",
    });
    await trackerService.addItem("dev-1", "2026-03-07", {
      title: "Investigate login issue",
    });

    const app = createTestApp();
    const res = await invoke(app, {
      method: "GET",
      url: "/api/my-day?date=2026-03-07",
      headers: {
        cookie: await loginCookie("alice", "secret123"),
      },
    });

    expect(res.status).toBe(200);
    expect(res.body?.developer.accountId).toBe("dev-1");
    expect(res.body?.status).toBe("blocked");
    expect(res.body?.plannedItems).toHaveLength(1);
    expect("managerNotes" in res.body).toBe(false);
  });

  it("GET /api/my-day shows today's live unfinished work without creating today's day row", async () => {
    const item = await trackerService.addItem("dev-1", "2026-03-06", {
      title: "Yesterday follow-up",
    });

    const app = createTestApp();
    const res = await invoke(app, {
      method: "GET",
      url: "/api/my-day?date=2026-03-07",
      headers: {
        cookie: await loginCookie("alice", "secret123"),
      },
    });

    expect(res.status).toBe(200);
    expect(res.body?.viewMode).toBe("live");
    expect(res.body?.isReadOnly).toBe(false);
    expect(res.body?.plannedItems).toEqual([
      expect.objectContaining({
        id: item.id,
        title: "Yesterday follow-up",
        originDate: "2026-03-07",
      }),
    ]);

    const todayRows = await db
      .select()
      .from(teamTrackerDays);
    expect(todayRows.filter((row) => row.date === "2026-03-07" && row.developerAccountId === "dev-1")).toEqual([]);
  });

  it("GET /api/my-day returns past dates as exact read-only history", async () => {
    await trackerService.addItem("dev-1", "2026-03-06", {
      title: "Historical item",
    });
    await trackerService.addItem("dev-1", "2026-03-07", {
      title: "Today item",
    });

    const app = createTestApp();
    const res = await invoke(app, {
      method: "GET",
      url: "/api/my-day?date=2026-03-06",
      headers: {
        cookie: await loginCookie("alice", "secret123"),
      },
    });

    expect(res.status).toBe(200);
    expect(res.body?.viewMode).toBe("history");
    expect(res.body?.readOnlyReason).toBe("history");
    expect(res.body?.isReadOnly).toBe(true);
    expect(res.body?.plannedItems.map((item: { title: string }) => item.title)).toEqual([
      "Historical item",
    ]);
  });

  it("GET /api/my-day returns future dates as exact read-only planning", async () => {
    await trackerService.addItem("dev-1", "2026-03-07", {
      title: "Today item",
    });
    await trackerService.addItem("dev-1", "2026-03-08", {
      title: "Future planned item",
    });

    const app = createTestApp();
    const res = await invoke(app, {
      method: "GET",
      url: "/api/my-day?date=2026-03-08",
      headers: {
        cookie: await loginCookie("alice", "secret123"),
      },
    });

    expect(res.status).toBe(200);
    expect(res.body?.viewMode).toBe("planning");
    expect(res.body?.readOnlyReason).toBe("future");
    expect(res.body?.isReadOnly).toBe(true);
    expect(res.body?.plannedItems.map((item: { title: string }) => item.title)).toEqual([
      "Future planned item",
    ]);
  });

  it("GET /api/my-day includes task notes updated through team tracker", async () => {
    const item = await trackerService.addItem("dev-1", "2026-03-07", {
      title: "Investigate login issue",
    });
    await trackerService.updateItem(item.id, {
      note: "Manager context note",
    });

    const app = createTestApp();
    const res = await invoke(app, {
      method: "GET",
      url: "/api/my-day?date=2026-03-07",
      headers: {
        cookie: await loginCookie("alice", "secret123"),
      },
    });

    expect(res.status).toBe(200);
    expect(res.body?.plannedItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: item.id,
          title: "Investigate login issue",
          note: "Manager context note",
        }),
      ])
    );
  });

  it("GET /api/my-day returns read-only availability metadata while inactive", async () => {
    await trackerService.updateAvailability("dev-1", {
      effectiveDate: "2026-03-07",
      state: "inactive",
      note: "PTO today",
    });

    const app = createTestApp();
    const res = await invoke(app, {
      method: "GET",
      url: "/api/my-day?date=2026-03-07",
      headers: {
        cookie: await loginCookie("alice", "secret123"),
      },
    });

    expect(res.status).toBe(200);
    expect(res.body?.availability).toMatchObject({
      state: "inactive",
      note: "PTO today",
      startDate: "2026-03-07",
    });
    expect(res.body?.isReadOnly).toBe(true);
  });

  it("GET /api/my-day rejects unauthenticated requests", async () => {
    const app = createTestApp();
    const res = await invoke(app, {
      method: "GET",
      url: "/api/my-day?date=2026-03-07",
    });

    expect(res.status).toBe(401);
    expect(res.body?.error).toBe("Authentication required");
  });

  it("PATCH /api/my-day/items/:itemId rejects edits to another developer's item", async () => {
    const otherItem = await trackerService.addItem("dev-2", "2026-03-07", {
      title: "Bob's task",
    });

    const app = createTestApp();
    const res = await invoke(app, {
      method: "PATCH",
      url: `/api/my-day/items/${otherItem.id}`,
      headers: {
        cookie: await loginCookie("alice", "secret123"),
      },
      body: {
        date: "2026-03-07",
        note: "Trying to edit someone else's task",
      },
    });

    expect(res.status).toBe(403);
    expect(res.body?.error).toBe("Item does not belong to authenticated developer");
  });

  it("POST /api/my-day/checkins records developer-authored attribution", async () => {
    const app = createTestApp();
    const res = await invoke(app, {
      method: "POST",
      url: "/api/my-day/checkins",
      headers: {
        cookie: await loginCookie("alice", "secret123"),
      },
      body: {
        date: "2026-03-07",
        summary: "Started work on auth fix",
        status: "on_track",
      },
    });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      summary: "Started work on auth fix",
      authorType: "developer",
      authorAccountId: "dev-1",
    });
  });

  it("POST /api/my-day/checkins without status preserves inherited live risk state", async () => {
    await trackerService.updateDay("dev-1", "2026-03-06", {
      status: "blocked",
    });

    const app = createTestApp();
    const res = await invoke(app, {
      method: "POST",
      url: "/api/my-day/checkins",
      headers: {
        cookie: await loginCookie("alice", "secret123"),
      },
      body: {
        date: "2026-03-07",
        summary: "Still waiting on access",
      },
    });

    expect(res.status).toBe(201);

    const day = await invoke(app, {
      method: "GET",
      url: "/api/my-day?date=2026-03-07",
      headers: {
        cookie: await loginCookie("alice", "secret123"),
      },
    });
    expect(day.body?.status).toBe("blocked");
  });

  it("POST /api/my-day/items supports Jira-linked items for the authenticated developer", async () => {
    await seedIssue();

    const app = createTestApp();
    const res = await invoke(app, {
      method: "POST",
      url: "/api/my-day/items",
      headers: {
        cookie: await loginCookie("alice", "secret123"),
      },
      body: {
        date: "2026-03-07",
        jiraKey: "AM-123",
        title: "Trace the failing login flow",
      },
    });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      itemType: "jira",
      jiraKey: "AM-123",
      jiraPriorityName: "High",
      jiraDueDate: "2026-03-08",
      jiraSummary: "Linked Jira task",
      title: "Trace the failing login flow",
    });
  });

  it("POST /api/my-day/items rejects whitespace-only titles", async () => {
    const app = createTestApp();
    const res = await invoke(app, {
      method: "POST",
      url: "/api/my-day/items",
      headers: {
        cookie: await loginCookie("alice", "secret123"),
      },
      body: {
        date: "2026-03-07",
        title: "   ",
      },
    });

    expect(res.status).toBe(400);
  });

  it("PATCH /api/my-day/items/:itemId rejects empty patch bodies", async () => {
    const item = await trackerService.addItem("dev-1", "2026-03-07", {
      title: "Investigate login issue",
    });

    const app = createTestApp();
    const res = await invoke(app, {
      method: "PATCH",
      url: `/api/my-day/items/${item.id}`,
      headers: {
        cookie: await loginCookie("alice", "secret123"),
      },
      body: {},
    });

    expect(res.status).toBe(400);
  });

  it("PATCH /api/my-day/items/:itemId updates inherited items only from today's live view", async () => {
    const inherited = await trackerService.addItem("dev-1", "2026-03-06", {
      title: "Continue yesterday",
    });

    const app = createTestApp();
    const today = await invoke(app, {
      method: "PATCH",
      url: `/api/my-day/items/${inherited.id}`,
      headers: {
        cookie: await loginCookie("alice", "secret123"),
      },
      body: {
        date: "2026-03-07",
        note: "Live note",
      },
    });

    expect(today.status).toBe(200);
    expect(today.body).toMatchObject({
      id: inherited.id,
      originDate: "2026-03-07",
      note: "Live note",
    });

    const past = await invoke(app, {
      method: "PATCH",
      url: `/api/my-day/items/${inherited.id}`,
      headers: {
        cookie: await loginCookie("alice", "secret123"),
      },
      body: {
        date: "2026-03-06",
        note: "Past edit",
      },
    });
    expect(past.status).toBe(409);
    expect(past.body?.error).toBe("My Day is read-only for past dates");

    const future = await invoke(app, {
      method: "PATCH",
      url: `/api/my-day/items/${inherited.id}`,
      headers: {
        cookie: await loginCookie("alice", "secret123"),
      },
      body: {
        date: "2026-03-08",
        note: "Future edit",
      },
    });
    expect(future.status).toBe(409);
    expect(future.body?.error).toBe("My Day is read-only for future dates");
  });

  it("PATCH /api/my-day/items/:itemId rejects future-owned items from today's live view", async () => {
    const futureItem = await trackerService.addItem("dev-1", "2026-03-08", {
      title: "Tomorrow plan",
    });

    const app = createTestApp();
    const res = await invoke(app, {
      method: "PATCH",
      url: `/api/my-day/items/${futureItem.id}`,
      headers: {
        cookie: await loginCookie("alice", "secret123"),
      },
      body: {
        date: "2026-03-07",
        note: "Should not edit early",
      },
    });

    expect(res.status).toBe(409);
    expect(res.body?.error).toBe("Item is not available in the selected My Day view");
  });

  it("POST /api/my-day/items/:itemId/set-current can activate inherited live work without carrying it forward", async () => {
    const inherited = await trackerService.addItem("dev-1", "2026-03-06", {
      title: "Continue yesterday",
    });

    const app = createTestApp();
    const res = await invoke(app, {
      method: "POST",
      url: `/api/my-day/items/${inherited.id}/set-current`,
      headers: {
        cookie: await loginCookie("alice", "secret123"),
      },
      body: {
        date: "2026-03-07",
      },
    });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: inherited.id,
      state: "in_progress",
      originDate: "2026-03-07",
    });

    const rows = await db
      .select()
      .from(teamTrackerDays);
    expect(rows.filter((row) => row.date === "2026-03-07" && row.developerAccountId === "dev-1")).toEqual([]);
  });

  it("POST /api/my-day/items rejects writes while the developer is inactive", async () => {
    await trackerService.updateAvailability("dev-1", {
      effectiveDate: "2026-03-07",
      state: "inactive",
      note: "PTO today",
    });

    const app = createTestApp();
    const res = await invoke(app, {
      method: "POST",
      url: "/api/my-day/items",
      headers: {
        cookie: await loginCookie("alice", "secret123"),
      },
      body: {
        date: "2026-03-07",
        title: "Should not save",
      },
    });

    expect(res.status).toBe(409);
    expect(res.body?.error).toBe("Developer is inactive on 2026-03-07");
  });

  it("GET /api/my-day/issues returns only Jira issues assigned to the authenticated developer", async () => {
    await seedIssue("AM-123", "dev-1", "Alice Smith");
    await seedIssue("AM-456", "dev-2", "Bob Jones");

    const app = createTestApp();
    const res = await invoke(app, {
      method: "GET",
      url: "/api/my-day/issues",
      headers: {
        cookie: await loginCookie("alice", "secret123"),
      },
    });

    expect(res.status).toBe(200);
    expect(res.body?.issues).toHaveLength(1);
    expect(res.body?.issues[0]).toMatchObject({
      jiraKey: "AM-123",
      assigneeId: "dev-1",
    });
  });

  it("PATCH /api/my-day/items/:itemId rejects title edits for linked delegated tasks", async () => {
    const managerItem = await managerDeskService.createItem("manager-1", {
      date: "2026-03-07",
      title: "Shared delegated task",
      assigneeDeveloperAccountId: "dev-1",
    });
    const linkedItem = (await trackerService.getItemDetailContextForManagerDeskItem(managerItem.id))
      ?.trackerItem;
    expect(linkedItem).toBeDefined();

    const app = createTestApp();
    const res = await invoke(app, {
      method: "PATCH",
      url: `/api/my-day/items/${linkedItem!.id}`,
      headers: {
        cookie: await loginCookie("alice", "secret123"),
      },
      body: {
        date: "2026-03-07",
        title: "Developer rename attempt",
      },
    });

    expect(res.status).toBe(409);
    expect(res.body?.error).toBe("Linked delegated tasks must be renamed from Manager Desk");
  });

  it("DELETE /api/my-day/items/:itemId rejects deletion of linked delegated tasks", async () => {
    const managerItem = await managerDeskService.createItem("manager-1", {
      date: "2026-03-07",
      title: "Shared delegated task",
      assigneeDeveloperAccountId: "dev-1",
    });
    const linkedItem = (await trackerService.getItemDetailContextForManagerDeskItem(managerItem.id))
      ?.trackerItem;
    expect(linkedItem).toBeDefined();

    const app = createTestApp();
    const res = await invoke(app, {
      method: "DELETE",
      url: `/api/my-day/items/${linkedItem!.id}?date=2026-03-07`,
      headers: {
        cookie: await loginCookie("alice", "secret123"),
      },
    });

    expect(res.status).toBe(409);
    expect(res.body?.error).toBe(
      "Linked delegated tasks cannot be deleted; mark them dropped instead"
    );
  });

  it("PATCH /api/my-day/items/:itemId back-syncs delegated execution to Manager Desk detail", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-07T08:00:00.000Z"));

    const managerItem = await managerDeskService.createItem("manager-1", {
      date: "2026-03-07",
      title: "Shared delegated task",
      assigneeDeveloperAccountId: "dev-1",
    });
    const linkedItem = (await trackerService.getItemDetailContextForManagerDeskItem(managerItem.id))
      ?.trackerItem;
    expect(linkedItem).toBeDefined();

    const app = createTestApp();
    const res = await invoke(app, {
      method: "PATCH",
      url: `/api/my-day/items/${linkedItem!.id}`,
      headers: {
        cookie: await loginCookie("alice", "secret123"),
      },
      body: {
        date: "2026-03-07",
        state: "done",
        note: "Fix validated and handed back.",
      },
    });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: linkedItem!.id,
      state: "done",
      note: "Fix validated and handed back.",
    });

    const refreshed = await managerDeskService.getDay("manager-1", "2026-03-07");
    expect(refreshed.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: managerItem.id,
          status: "inbox",
          delegatedExecution: expect.objectContaining({
            trackerItemId: linkedItem!.id,
            state: "done",
            note: "Fix validated and handed back.",
            completedAt: expect.any(String),
          }),
        }),
      ])
    );
  });

  describe("phase 1 task events", () => {
    async function enableTaskKeys() {
      await db.insert(configTable).values({ key: "tasks_phase1_enabled", value: "true" });
    }

    it("GET /api/my-day/tasks/:key/events returns shared events only", async () => {
      await enableTaskKeys();
      const item = await trackerService.addItem("dev-1", "2026-03-07", {
        title: "Alice task",
      });
      const manager = await authService.createUser({
        username: "mgr",
        displayName: "Manager",
        password: "secret123",
        role: "manager",
      });
      await eventsService.append(
        { taskKey: item.taskKey!, type: "instruction", body: "Shared note", meta: { via: "task_drawer" }, visibility: "shared" },
        { type: "manager", accountId: manager.accountId }
      );
      await eventsService.append(
        { taskKey: item.taskKey!, type: "update", body: "Private note", meta: { via: "task_drawer" }, visibility: "private" },
        { type: "manager", accountId: manager.accountId }
      );

      const app = createTestApp();
      const res = await invoke(app, {
        method: "GET",
        url: `/api/my-day/tasks/${item.taskKey}/events`,
        headers: { cookie: await loginCookie("alice", "secret123") },
      });

      expect(res.status).toBe(200);
      const types = res.body.events.map((event: { type: string }) => event.type);
      expect(types).toEqual(["instruction", "created"]);
      expect(res.body.events.every((event: { visibility: string }) => event.visibility === "shared")).toBe(true);
    });

    it("GET /api/my-day/tasks/:key/events returns 404 for a non-owner", async () => {
      await enableTaskKeys();
      const item = await trackerService.addItem("dev-1", "2026-03-07", {
        title: "Alice task",
      });
      const app = createTestApp();

      const res = await invoke(app, {
        method: "GET",
        url: `/api/my-day/tasks/${item.taskKey}/events`,
        headers: { cookie: await loginCookie("bob", "secret123") },
      });

      expect(res.status).toBe(404);
    });

    it("POST /api/my-day/tasks/:key/events rejects writes against history dates", async () => {
      await enableTaskKeys();
      const item = await trackerService.addItem("dev-1", "2026-03-06", {
        title: "Yesterday task",
      });
      const app = createTestApp();

      const res = await invoke(app, {
        method: "POST",
        url: `/api/my-day/tasks/${item.taskKey}/events`,
        headers: { cookie: await loginCookie("alice", "secret123") },
        body: {
          date: "2026-03-06",
          type: "update",
          body: "Retroactive note",
          requestId: randomUUID(),
        },
      });

      expect(res.status).toBe(409);
      expect(res.body?.error).toBe("My Day is read-only for past dates");
    });

    it("POST /api/my-day/checkins enforces ownership for taskKeys", async () => {
      // /checkins is the last route layer in the router, so an error response
      // defers through setImmediate — fake timers must be off for this path.
      vi.useRealTimers();
      const today = todayIsoDate();
      await enableTaskKeys();
      const bobItem = await trackerService.addItem("dev-2", today, {
        title: "Bob's task",
      });
      const app = createTestApp();

      const res = await invoke(app, {
        method: "POST",
        url: "/api/my-day/checkins",
        headers: { cookie: await loginCookie("alice", "secret123") },
        body: {
          date: today,
          summary: "Standup note",
          taskKeys: [bobItem.taskKey],
        },
      });

      expect(res.status).toBe(400);
      expect(res.body?.error).toBe("Unknown or unowned task key");

      const own = await invoke(app, {
        method: "POST",
        url: "/api/my-day/checkins",
        headers: { cookie: await loginCookie("alice", "secret123") },
        body: {
          date: today,
          summary: "Standup note",
        },
      });
      expect(own.status).toBe(201);
    });
  });

  describe("former-owner access (P3-D15)", () => {
    const taskService = new TaskService();
    const today = "2026-03-07";

    async function enableCanonical() {
      await db.insert(configTable).values([
        { key: "tasks_phase1_enabled", value: "true" },
        { key: "tasks_phase2_stage", value: "2c" },
        { key: "tasks_phase3_enabled", value: "true" },
      ]);
    }

    async function seedReassignedTask() {
      const managerPrincipal = { type: "manager" as const, accountId: "mgr-1" };
      const row = await taskService.create({ title: "Reassigned task", ownerType: "developer", ownerId: "dev-1", labels: ["team"] }, managerPrincipal);
      // Alice posts a shared update while she owns the task.
      const app = createTestApp();
      const posted = await invoke(app, {
        method: "POST",
        url: `/api/my-day/tasks/${row.taskKey}/events`,
        headers: { cookie: await loginCookie("alice", "secret123") },
        body: { date: today, type: "update", body: "Alice progress note", requestId: randomUUID() },
      });
      expect(posted.status).toBe(201);
      // Manager-only private note + shared instruction Alice must never see.
      await eventsService.append(
        { taskKey: row.taskKey, type: "instruction", body: "Manager shared note", meta: { via: "task_drawer" }, visibility: "shared" },
        { type: "manager", accountId: "mgr-1" },
      );
      await eventsService.append(
        { taskKey: row.taskKey, type: "instruction", body: "Manager private note", meta: { via: "task_drawer" }, visibility: "private" },
        { type: "manager", accountId: "mgr-1" },
      );
      // Reassign to Bob — Alice becomes a former owner.
      await taskService.update(row.taskKey, { ownerType: "developer", ownerId: "dev-2" }, managerPrincipal);
      return row;
    }

    it("GET /api/my-day/tasks/:key returns the restricted projection for a former owner", async () => {
      await enableCanonical();
      const row = await seedReassignedTask();
      const app = createTestApp();

      const res = await invoke(app, {
        method: "GET",
        url: `/api/my-day/tasks/${row.taskKey}`,
        headers: { cookie: await loginCookie("alice", "secret123") },
      });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        taskKey: row.taskKey,
        title: "Reassigned task",
        status: "open",
        access: "former-owner",
      });
      expect(res.body).not.toHaveProperty("managerDeskItemId");
      expect(res.body).not.toHaveProperty("trackerItemId");
      expect(res.body).not.toHaveProperty("developer");
      expect(res.body).not.toHaveProperty("kind");
    });

    it("GET /api/my-day/tasks/:key/detail returns key/title/status only for a former owner", async () => {
      await enableCanonical();
      const row = await seedReassignedTask();
      const app = createTestApp();

      const res = await invoke(app, {
        method: "GET",
        url: `/api/my-day/tasks/${row.taskKey}/detail`,
        headers: { cookie: await loginCookie("alice", "secret123") },
      });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        taskKey: row.taskKey,
        title: "Reassigned task",
        status: "open",
        access: "former-owner",
      });
      for (const field of ["links", "children", "parent", "labels", "ownerId", "ownerType", "nextAction", "followUpAt", "trackedByManagerId", "id"]) {
        expect(res.body).not.toHaveProperty(field);
      }
    });

    it("GET /api/my-day/tasks/:key/events returns only the former owner's own shared events", async () => {
      await enableCanonical();
      const row = await seedReassignedTask();
      // The new owner's shared event must also be hidden from Alice.
      const app = createTestApp();
      await invoke(app, {
        method: "POST",
        url: `/api/my-day/tasks/${row.taskKey}/events`,
        headers: { cookie: await loginCookie("bob", "secret123") },
        body: { date: today, type: "update", body: "Bob picked this up", requestId: randomUUID() },
      });

      const res = await invoke(app, {
        method: "GET",
        url: `/api/my-day/tasks/${row.taskKey}/events`,
        headers: { cookie: await loginCookie("alice", "secret123") },
      });

      expect(res.status).toBe(200);
      expect(res.body.events).toHaveLength(1);
      expect(res.body.events[0].body).toBe("Alice progress note");
      expect(res.body.events[0].author).toMatchObject({ type: "developer", id: "dev-1" });
    });

    it("the new owner still sees the full shared timeline", async () => {
      await enableCanonical();
      const row = await seedReassignedTask();
      const app = createTestApp();

      const res = await invoke(app, {
        method: "GET",
        url: `/api/my-day/tasks/${row.taskKey}/events`,
        headers: { cookie: await loginCookie("bob", "secret123") },
      });

      expect(res.status).toBe(200);
      const bodies = res.body.events.map((event: { body: string | null }) => event.body);
      expect(bodies).toContain("Alice progress note");
      expect(bodies).toContain("Manager shared note");
      expect(bodies).not.toContain("Manager private note");
    });

    it("rejects former-owner writes with 403", async () => {
      await enableCanonical();
      const row = await seedReassignedTask();
      const app = createTestApp();
      const cookie = await loginCookie("alice", "secret123");

      const patch = await invoke(app, {
        method: "PATCH",
        url: `/api/my-day/tasks/${row.taskKey}`,
        headers: { cookie },
        body: { date: today, status: "done" },
      });
      expect(patch.status).toBe(403);

      const post = await invoke(app, {
        method: "POST",
        url: `/api/my-day/tasks/${row.taskKey}/events`,
        headers: { cookie },
        body: { date: today, type: "update", body: "Sneaky update", requestId: randomUUID() },
      });
      expect(post.status).toBe(403);
    });

    it("returns 404 for a developer who never authored an event", async () => {
      await enableCanonical();
      const row = await seedReassignedTask();
      await db.insert(developers).values({ accountId: "dev-3", displayName: "Carol", email: null, avatarUrl: null, isActive: 1 });
      await authService.createUser({ username: "carol", displayName: "Carol", password: "secret123", role: "developer", developerAccountId: "dev-3" });
      const app = createTestApp();
      const cookie = await loginCookie("carol", "secret123");

      const get = await invoke(app, { method: "GET", url: `/api/my-day/tasks/${row.taskKey}`, headers: { cookie } });
      expect(get.status).toBe(404);
      const events = await invoke(app, { method: "GET", url: `/api/my-day/tasks/${row.taskKey}/events`, headers: { cookie } });
      expect(events.status).toBe(404);
      const detail = await invoke(app, { method: "GET", url: `/api/my-day/tasks/${row.taskKey}/detail`, headers: { cookie } });
      expect(detail.status).toBe(404);
    });

    it("does not list former-owner tasks in My Day", async () => {
      await enableCanonical();
      const row = await seedReassignedTask();
      const app = createTestApp();

      const res = await invoke(app, {
        method: "GET",
        url: `/api/my-day/tasks?date=${today}`,
        headers: { cookie: await loginCookie("alice", "secret123") },
      });

      expect(res.status).toBe(200);
      expect(res.body.tasks.map((task: { taskKey: string }) => task.taskKey)).not.toContain(row.taskKey);
    });

    it("returns 404 for former-owner reads when tasks_phase3_enabled is off (G1)", async () => {
      // Canonical tasks exist (phase 1 + stage 2c) but Phase 3 is off —
      // former-owner access is a Phase 3 feature, so reads must 404 and
      // preserve the Phase 2 owner-only behavior.
      await db.insert(configTable).values([
        { key: "tasks_phase1_enabled", value: "true" },
        { key: "tasks_phase2_stage", value: "2c" },
        { key: "tasks_phase3_enabled", value: "false" },
      ]);
      const row = await seedReassignedTask();
      const app = createTestApp();
      const cookie = await loginCookie("alice", "secret123");

      const get = await invoke(app, { method: "GET", url: `/api/my-day/tasks/${row.taskKey}`, headers: { cookie } });
      expect(get.status).toBe(404);
      const events = await invoke(app, { method: "GET", url: `/api/my-day/tasks/${row.taskKey}/events`, headers: { cookie } });
      expect(events.status).toBe(404);
      const detail = await invoke(app, { method: "GET", url: `/api/my-day/tasks/${row.taskKey}/detail`, headers: { cookie } });
      expect(detail.status).toBe(404);
    });
  });
});
