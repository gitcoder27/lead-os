import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import { eq } from "drizzle-orm";
import { createManagerDeskRouter } from "../src/routes/manager-desk";
import { errorHandler, notFoundHandler } from "../src/middleware/errorHandler";
import { AuthService, serializeSessionCookie } from "../src/services/auth.service";
import { ManagerDeskService } from "../src/services/manager-desk.service";
import { TeamTrackerService } from "../src/services/team-tracker.service";
import { resetDatabase, db } from "./helpers/db";
import {
  developers,
  issues,
  managerDeskDays,
  managerDeskItems,
  teamTrackerDays,
  teamTrackerItems,
} from "../src/db/schema";
import { invoke } from "./helpers/http";

const authService = new AuthService();
const trackerService = new TeamTrackerService();
const managerDeskService = new ManagerDeskService(trackerService);

async function seedDevelopers() {
  await db.insert(developers).values([
    {
      accountId: "dev-1",
      displayName: "Alice Smith",
      email: "alice@example.com",
      avatarUrl: null,
      isActive: 1,
    },
    {
      accountId: "dev-2",
      displayName: "Rahul Sharma",
      email: "rahul@example.com",
      avatarUrl: "https://example.com/rahul.png",
      isActive: 1,
    },
  ]);
}

async function seedIssues() {
  await db.insert(issues).values([
    {
      jiraKey: "PROJ-221",
      summary: "Rahul blocker on review flow",
      description: null,
      aspenSeverity: null,
      priorityName: "High",
      priorityId: "1",
      statusName: "In Progress",
      statusCategory: "indeterminate",
      assigneeId: "dev-2",
      assigneeName: "Rahul Sharma",
      teamScopeState: "in_team",
      syncScopeState: "active",
      reporterName: "Lead",
      component: null,
      labels: JSON.stringify([]),
      dueDate: "2026-03-10",
      developmentDueDate: "2026-03-09",
      flagged: 0,
      createdAt: "2026-03-07T08:00:00.000Z",
      updatedAt: "2026-03-07T08:00:00.000Z",
      syncedAt: "2026-03-07T08:00:00.000Z",
      lastSeenInScopedSyncAt: "2026-03-07T08:00:00.000Z",
      lastReconciledAt: "2026-03-07T08:00:00.000Z",
      scopeChangedAt: null,
      analysisNotes: null,
      excluded: 0,
    },
    {
      jiraKey: "PROJ-321",
      summary: "Investigate design gap in review flow",
      description: null,
      aspenSeverity: null,
      priorityName: "Medium",
      priorityId: "2",
      statusName: "To Do",
      statusCategory: "new",
      assigneeId: "dev-1",
      assigneeName: "Alice Smith",
      teamScopeState: "in_team",
      syncScopeState: "active",
      reporterName: "Lead",
      component: null,
      labels: JSON.stringify([]),
      dueDate: "2026-03-12",
      developmentDueDate: null,
      flagged: 0,
      createdAt: "2026-03-07T08:00:00.000Z",
      updatedAt: "2026-03-08T08:00:00.000Z",
      syncedAt: "2026-03-08T08:00:00.000Z",
      lastSeenInScopedSyncAt: "2026-03-08T08:00:00.000Z",
      lastReconciledAt: "2026-03-08T08:00:00.000Z",
      scopeChangedAt: null,
      analysisNotes: null,
      excluded: 0,
    },
  ]);
}

async function loginCookie(username: string, password: string): Promise<string> {
  const { sessionId } = await authService.authenticate(username, password);
  return serializeSessionCookie(sessionId, authService.sessionMaxAgeSeconds);
}

function createTestApp() {
  const app = express();
  app.use(
    "/api/manager-desk",
    createManagerDeskRouter(managerDeskService, authService)
  );
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

describe("manager desk routes", () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-08T08:00:00.000Z"));
    await resetDatabase();
    await seedDevelopers();
    await seedIssues();
    await authService.createUser({
      username: "manager",
      displayName: "Manager One",
      password: "secret123",
      role: "manager",
    });
    await authService.createUser({
      username: "developer",
      displayName: "Developer One",
      password: "secret123",
      role: "developer",
      developerAccountId: "dev-1",
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("GET /api/manager-desk returns an empty manager day for managers", async () => {
    const app = createTestApp();
    const res = await invoke(app, {
      method: "GET",
      url: "/api/manager-desk?date=2026-03-08",
      headers: {
        cookie: await loginCookie("manager", "secret123"),
      },
    });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      date: "2026-03-08",
      viewMode: "live",
      items: [],
      summary: {
        totalOpen: 0,
        inbox: 0,
        planned: 0,
        inProgress: 0,
        waiting: 0,
        overdueFollowUps: 0,
        meetings: 0,
        completed: 0,
      },
    });
  });

  it("GET /api/manager-desk collapses legacy carry-forward chains to the latest live item", async () => {
    vi.setSystemTime(new Date("2026-03-10T08:00:00.000Z"));

    const app = createTestApp();
    const cookie = await loginCookie("manager", "secret123");

    const created = await invoke(app, {
      method: "POST",
      url: "/api/manager-desk/items",
      headers: { cookie },
      body: {
        date: "2026-03-08",
        title: "Legacy chain task",
        status: "planned",
      },
    });

    await db.insert(managerDeskDays).values([
      {
        date: "2026-03-09",
        managerAccountId: "manager",
        createdAt: "2026-03-09T08:00:00.000Z",
        updatedAt: "2026-03-09T08:00:00.000Z",
      },
      {
        date: "2026-03-10",
        managerAccountId: "manager",
        createdAt: "2026-03-10T08:00:00.000Z",
        updatedAt: "2026-03-10T08:00:00.000Z",
      },
    ]);

    const days = await db.select().from(managerDeskDays);
    const day09 = days.find((day) => day.date === "2026-03-09" && day.managerAccountId === "manager");
    const day10 = days.find((day) => day.date === "2026-03-10" && day.managerAccountId === "manager");
    expect(day09).toBeDefined();
    expect(day10).toBeDefined();

    const firstClone = await db
      .insert(managerDeskItems)
      .values({
        dayId: day09!.id,
        sourceItemId: created.body.id,
        assigneeDeveloperAccountId: null,
        title: "Legacy chain task",
        kind: "action",
        category: "other",
        status: "planned",
        priority: "medium",
        participants: null,
        contextNote: null,
        nextAction: null,
        outcome: null,
        plannedStartAt: null,
        plannedEndAt: null,
        followUpAt: null,
        completedAt: null,
        createdAt: "2026-03-09T08:05:00.000Z",
        updatedAt: "2026-03-09T08:05:00.000Z",
      })
      .returning();
    const latestClone = await db
      .insert(managerDeskItems)
      .values({
        dayId: day10!.id,
        sourceItemId: firstClone[0]!.id,
        assigneeDeveloperAccountId: null,
        title: "Legacy chain task",
        kind: "action",
        category: "other",
        status: "planned",
        priority: "medium",
        participants: null,
        contextNote: null,
        nextAction: null,
        outcome: null,
        plannedStartAt: null,
        plannedEndAt: null,
        followUpAt: null,
        completedAt: null,
        createdAt: "2026-03-10T08:10:00.000Z",
        updatedAt: "2026-03-10T08:10:00.000Z",
      })
      .returning();

    const live = await invoke(app, {
      method: "GET",
      url: "/api/manager-desk?date=2026-03-10",
      headers: { cookie },
    });

    expect(live.status).toBe(200);
    expect(live.body?.viewMode).toBe("live");
    expect(live.body?.summary.totalOpen).toBe(1);
    expect(live.body?.items).toEqual([
      expect.objectContaining({
        id: latestClone[0]!.id,
        title: "Legacy chain task",
        originDate: "2026-03-10",
      }),
    ]);
  });

  it("developer-role users receive 403 on manager desk routes", async () => {
    const app = createTestApp();
    const res = await invoke(app, {
      method: "GET",
      url: "/api/manager-desk?date=2026-03-08",
      headers: {
        cookie: await loginCookie("developer", "secret123"),
      },
    });

    expect(res.status).toBe(403);
    expect(res.body?.error).toBe("Manager access required");
  });

  it("GET /api/manager-desk/tracker-items/:trackerItemId/detail returns tracker-only detail without creating manager desk data", async () => {
    const trackerItem = await trackerService.addItem("dev-1", "2026-03-08", {
      jiraKey: "PROJ-221",
      title: "Follow up from tracker",
      note: "Execution detail captured in tracker",
    });
    const app = createTestApp();
    const cookie = await loginCookie("manager", "secret123");

    const first = await invoke(app, {
      method: "GET",
      url: `/api/manager-desk/tracker-items/${trackerItem.id}/detail`,
      headers: { cookie },
    });

    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({
      date: "2026-03-08",
      lifecycle: "tracker_only",
      developer: {
        accountId: "dev-1",
        displayName: "Alice Smith",
      },
      trackerItem: {
        id: trackerItem.id,
        lifecycle: "tracker_only",
        jiraKey: "PROJ-221",
        note: "Execution detail captured in tracker",
      },
    });
    expect("managerDeskItem" in first.body).toBe(false);

    const second = await invoke(app, {
      method: "GET",
      url: `/api/manager-desk/tracker-items/${trackerItem.id}/detail`,
      headers: { cookie },
    });

    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);

    const linkedTrackerRows = await db
      .select()
      .from(teamTrackerItems)
      .where(eq(teamTrackerItems.id, trackerItem.id));
    expect(linkedTrackerRows[0]?.managerDeskItemId).toBeNull();

    const managerDeskRows = await db
      .select()
      .from(managerDeskItems)
      .limit(10);
    expect(managerDeskRows).toHaveLength(0);
  });

  it("POST /api/manager-desk/tracker-items/:trackerItemId/promote explicitly creates a shared manager desk task", async () => {
    const trackerItem = await trackerService.addItem("dev-1", "2026-03-08", {
      jiraKey: "PROJ-221",
      relatedIssueKeys: ["PROJ-321"],
      title: "Follow up from tracker",
      note: "Execution detail captured in tracker",
    });
    const app = createTestApp();
    const cookie = await loginCookie("manager", "secret123");

    const first = await invoke(app, {
      method: "POST",
      url: `/api/manager-desk/tracker-items/${trackerItem.id}/promote`,
      headers: { cookie },
    });

    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({
      date: "2026-03-08",
      lifecycle: "manager_desk_linked",
      developer: {
        accountId: "dev-1",
        displayName: "Alice Smith",
      },
      trackerItem: {
        id: trackerItem.id,
        managerDeskItemId: first.body.managerDeskItem.id,
        lifecycle: "manager_desk_linked",
        jiraKey: "PROJ-221",
        relatedIssueKeys: ["PROJ-321"],
        note: "Execution detail captured in tracker",
      },
      managerDeskItem: {
        title: "Follow up from tracker",
        status: "planned",
        contextNote: "Execution detail captured in tracker",
        assignee: {
          accountId: "dev-1",
          displayName: "Alice Smith",
        },
      },
    });
    expect(first.body.managerDeskItem.links).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          linkType: "issue",
          issueKey: "PROJ-221",
          displayLabel: "PROJ-221",
        }),
        expect.objectContaining({
          linkType: "issue",
          issueKey: "PROJ-321",
          displayLabel: "PROJ-321",
        }),
      ])
    );

    const second = await invoke(app, {
      method: "POST",
      url: `/api/manager-desk/tracker-items/${trackerItem.id}/promote`,
      headers: { cookie },
    });

    expect(second.status).toBe(200);
    expect(second.body?.managerDeskItem?.id).toBe(first.body?.managerDeskItem?.id);

    const detail = await invoke(app, {
      method: "GET",
      url: `/api/manager-desk/tracker-items/${trackerItem.id}/detail`,
      headers: { cookie },
    });

    expect(detail.status).toBe(200);
    expect(detail.body?.lifecycle).toBe("manager_desk_linked");
    expect(detail.body?.managerDeskItem?.id).toBe(first.body?.managerDeskItem?.id);

    const linkedTrackerRows = await db
      .select()
      .from(teamTrackerItems)
      .where(eq(teamTrackerItems.id, trackerItem.id));
    expect(linkedTrackerRows[0]?.managerDeskItemId).toBe(first.body?.managerDeskItem?.id);

    const managerDeskRows = await db
      .select()
      .from(managerDeskItems)
      .where(eq(managerDeskItems.id, first.body?.managerDeskItem?.id));
    expect(managerDeskRows).toHaveLength(1);

    const mirroredTrackerRows = await db
      .select()
      .from(teamTrackerItems)
      .where(eq(teamTrackerItems.managerDeskItemId, first.body?.managerDeskItem?.id));
    expect(mirroredTrackerRows).toHaveLength(1);
    expect(mirroredTrackerRows[0]?.id).toBe(trackerItem.id);
  });

  it("POST /api/manager-desk/items quick-captures an inbox item with defaults", async () => {
    const app = createTestApp();
    const res = await invoke(app, {
      method: "POST",
      url: "/api/manager-desk/items",
      headers: {
        cookie: await loginCookie("manager", "secret123"),
      },
      body: {
        date: "2026-03-08",
        title: " Follow up with Rahul on blocker ",
      },
    });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      title: "Follow up with Rahul on blocker",
      kind: "action",
      category: "other",
      status: "inbox",
      priority: "medium",
      links: [],
    });

    const day = await invoke(app, {
      method: "GET",
      url: "/api/manager-desk?date=2026-03-08",
      headers: {
        cookie: await loginCookie("manager", "secret123"),
      },
    });

    expect(day.body?.summary).toMatchObject({
      totalOpen: 1,
      inbox: 1,
    });
  });

  it("POST /api/manager-desk/items supports structured create with validated links", async () => {
    const app = createTestApp();
    const res = await invoke(app, {
      method: "POST",
      url: "/api/manager-desk/items",
      headers: {
        cookie: await loginCookie("manager", "secret123"),
      },
      body: {
        date: "2026-03-08",
        title: "Prepare discussion points for design sync",
        kind: "meeting",
        category: "design",
        status: "planned",
        priority: "high",
        assigneeDeveloperAccountId: "dev-1",
        participants: "Onshore Design Team",
        contextNote: "Need alignment on API edge cases before implementation starts.",
        nextAction: "Review open assumptions from yesterday.",
        plannedStartAt: "2026-03-08T15:00:00.000Z",
        plannedEndAt: "2026-03-08T15:30:00.000Z",
        followUpAt: "2026-03-08T17:00:00.000Z",
        links: [
          { linkType: "issue", issueKey: "proj-321" },
          { linkType: "developer", developerAccountId: "dev-2" },
        ],
      },
    });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      title: "Prepare discussion points for design sync",
      kind: "meeting",
      category: "design",
      status: "planned",
      priority: "high",
      assignee: {
        accountId: "dev-1",
        displayName: "Alice Smith",
      },
      participants: "Onshore Design Team",
      contextNote: "Need alignment on API edge cases before implementation starts.",
      nextAction: "Review open assumptions from yesterday.",
      plannedStartAt: "2026-03-08T15:00:00.000Z",
      plannedEndAt: "2026-03-08T15:30:00.000Z",
      followUpAt: "2026-03-08T17:00:00.000Z",
      links: [
        expect.objectContaining({
          linkType: "issue",
          issueKey: "PROJ-321",
          displayLabel: "PROJ-321",
        }),
        expect.objectContaining({
          linkType: "developer",
          developerAccountId: "dev-2",
          displayLabel: "Rahul Sharma",
        }),
      ],
    });

    const trackerDayRows = await db
      .select()
      .from(teamTrackerDays)
      .where(eq(teamTrackerDays.developerAccountId, "dev-1"));
    expect(trackerDayRows[0]?.date).toBe("2026-03-08");

    const trackerRows = await db
      .select()
      .from(teamTrackerItems)
      .where(eq(teamTrackerItems.managerDeskItemId, res.body.id));
    expect(trackerRows).toEqual([
      expect.objectContaining({
        dayId: trackerDayRows[0]?.id,
        managerDeskItemId: res.body.id,
        itemType: "jira",
        jiraKey: "PROJ-321",
        title: "Prepare discussion points for design sync",
        state: "planned",
      }),
    ]);
  });

  it("PATCH /api/manager-desk/items/:itemId manages done transitions and clearing optional fields", async () => {
    const app = createTestApp();
    const created = await invoke(app, {
      method: "POST",
      url: "/api/manager-desk/items",
      headers: {
        cookie: await loginCookie("manager", "secret123"),
      },
      body: {
        date: "2026-03-08",
        title: "Analyze PROJ-221 root cause",
        status: "in_progress",
        contextNote: "Initial notes",
      },
    });

    const completed = await invoke(app, {
      method: "PATCH",
      url: `/api/manager-desk/items/${created.body.id}`,
      headers: {
        cookie: await loginCookie("manager", "secret123"),
      },
      body: {
        status: "done",
        outcome: "Shared root cause and next steps.",
      },
    });

    expect(completed.status).toBe(200);
    expect(completed.body?.status).toBe("done");
    expect(completed.body?.completedAt).toBeDefined();
    expect(completed.body?.outcome).toBe("Shared root cause and next steps.");

    const reopened = await invoke(app, {
      method: "PATCH",
      url: `/api/manager-desk/items/${created.body.id}`,
      headers: {
        cookie: await loginCookie("manager", "secret123"),
      },
      body: {
        status: "planned",
        contextNote: null,
      },
    });

    expect(reopened.status).toBe(200);
    expect(reopened.body?.status).toBe("planned");
    expect("completedAt" in reopened.body).toBe(false);
    expect("contextNote" in reopened.body).toBe(false);
  });

  it("keeps items completed after UTC midnight visible on the local desk day", async () => {
    vi.setSystemTime(new Date("2026-03-08T20:45:00.000Z"));

    const app = createTestApp();
    const cookie = await loginCookie("manager", "secret123");
    const created = await invoke(app, {
      method: "POST",
      url: "/api/manager-desk/items",
      headers: { cookie },
      body: {
        date: "2026-03-09",
        title: "Close after local midnight",
        status: "in_progress",
      },
    });

    const completed = await invoke(app, {
      method: "PATCH",
      url: `/api/manager-desk/items/${created.body.id}`,
      headers: { cookie },
      body: {
        status: "done",
      },
    });

    expect(completed.status).toBe(200);
    expect(completed.body?.completedAt).toMatch(/^2026-03-08T/);

    const day = await invoke(app, {
      method: "GET",
      url: "/api/manager-desk?date=2026-03-09",
      headers: { cookie },
    });

    expect(day.status).toBe(200);
    expect(day.body?.summary?.completed).toBe(1);
    expect(day.body?.items).toEqual([
      expect.objectContaining({
        id: created.body.id,
        title: "Close after local midnight",
        status: "done",
      }),
    ]);
  });

  it("PATCH /api/manager-desk/items/:itemId moves manager work to later and brings it back", async () => {
    const app = createTestApp();
    const cookie = await loginCookie("manager", "secret123");

    const created = await invoke(app, {
      method: "POST",
      url: "/api/manager-desk/items",
      headers: { cookie },
      body: {
        date: "2026-03-08",
        title: "Review next quarter planning idea",
        status: "planned",
      },
    });

    const movedLater = await invoke(app, {
      method: "PATCH",
      url: `/api/manager-desk/items/${created.body.id}`,
      headers: { cookie },
      body: {
        status: "backlog",
      },
    });

    expect(movedLater.status).toBe(200);
    expect(movedLater.body).toMatchObject({
      id: created.body.id,
      title: "Review next quarter planning idea",
      status: "backlog",
    });
    expect("completedAt" in movedLater.body).toBe(false);

    const dayWithLater = await invoke(app, {
      method: "GET",
      url: "/api/manager-desk?date=2026-03-08",
      headers: { cookie },
    });

    expect(dayWithLater.status).toBe(200);
    expect(dayWithLater.body?.summary.totalOpen).toBe(0);
    expect(dayWithLater.body?.items).toEqual([
      expect.objectContaining({
        id: created.body.id,
        status: "backlog",
      }),
    ]);

    const broughtBack = await invoke(app, {
      method: "PATCH",
      url: `/api/manager-desk/items/${created.body.id}`,
      headers: { cookie },
      body: {
        status: "inbox",
      },
    });

    expect(broughtBack.status).toBe(200);
    expect(broughtBack.body?.status).toBe("inbox");

    const dayAfterBringBack = await invoke(app, {
      method: "GET",
      url: "/api/manager-desk?date=2026-03-08",
      headers: { cookie },
    });

    expect(dayAfterBringBack.body?.summary.totalOpen).toBe(1);
    expect(dayAfterBringBack.body?.summary.inbox).toBe(1);
  });

  it("surfaces delegated execution state and note from linked tracker work", async () => {
    const app = createTestApp();
    const cookie = await loginCookie("manager", "secret123");

    const created = await invoke(app, {
      method: "POST",
      url: "/api/manager-desk/items",
      headers: { cookie },
      body: {
        date: "2026-03-08",
        title: "Investigate active blocker",
        status: "planned",
        assigneeDeveloperAccountId: "dev-1",
        links: [{ linkType: "issue", issueKey: "PROJ-221" }],
      },
    });

    const trackerRows = await db
      .select()
      .from(teamTrackerItems)
      .where(eq(teamTrackerItems.managerDeskItemId, created.body.id));
    expect(trackerRows).toHaveLength(1);

    await trackerService.updateItem(trackerRows[0]!.id, {
      state: "in_progress",
      note: "Root cause isolated; validating fix scope.",
    });

    const day = await invoke(app, {
      method: "GET",
      url: "/api/manager-desk?date=2026-03-08",
      headers: { cookie },
    });

    expect(day.status).toBe(200);
    expect(day.body?.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: created.body.id,
          status: "planned",
          delegatedExecution: expect.objectContaining({
            trackerItemId: trackerRows[0]!.id,
            state: "in_progress",
            note: "Root cause isolated; validating fix scope.",
          }),
        }),
      ])
    );

    const detail = await invoke(app, {
      method: "GET",
      url: `/api/manager-desk/items/${created.body.id}/detail`,
      headers: { cookie },
    });

    expect(detail.status).toBe(200);
    expect(detail.body?.managerDeskItem).toMatchObject({
      id: created.body.id,
      delegatedExecution: {
        trackerItemId: trackerRows[0]!.id,
        state: "in_progress",
        note: "Root cause isolated; validating fix scope.",
        updatedAt: expect.any(String),
      },
    });
    expect(detail.body?.trackerItem).toMatchObject({
      id: trackerRows[0]!.id,
      state: "in_progress",
      note: "Root cause isolated; validating fix scope.",
    });
  });

  it("DELETE /api/manager-desk/items/:itemId removes only the desk item and preserves linked tracker work", async () => {
    const app = createTestApp();
    const cookie = await loginCookie("manager", "secret123");

    const created = await invoke(app, {
      method: "POST",
      url: "/api/manager-desk/items",
      headers: { cookie },
      body: {
        date: "2026-03-08",
        title: "Investigate active blocker",
        status: "planned",
        assigneeDeveloperAccountId: "dev-1",
        links: [{ linkType: "issue", issueKey: "PROJ-221" }],
      },
    });

    const linkedTrackerRows = await db
      .select()
      .from(teamTrackerItems)
      .where(eq(teamTrackerItems.managerDeskItemId, created.body.id));
    expect(linkedTrackerRows).toHaveLength(1);

    await trackerService.updateItem(linkedTrackerRows[0]!.id, {
      state: "in_progress",
      note: "Active execution note survives desk cleanup.",
    });

    const deleted = await invoke(app, {
      method: "DELETE",
      url: `/api/manager-desk/items/${created.body.id}`,
      headers: { cookie },
    });

    expect(deleted.status).toBe(200);
    expect(deleted.body).toEqual({ deleted: true });

    const managerRows = await db
      .select()
      .from(managerDeskItems)
      .where(eq(managerDeskItems.id, created.body.id));
    expect(managerRows).toHaveLength(0);

    const trackerRows = await db
      .select()
      .from(teamTrackerItems)
      .where(eq(teamTrackerItems.id, linkedTrackerRows[0]!.id));
    expect(trackerRows).toEqual([
      expect.objectContaining({
        id: linkedTrackerRows[0]!.id,
        managerDeskItemId: null,
        title: "Investigate active blocker",
        state: "in_progress",
        note: "Active execution note survives desk cleanup.",
      }),
    ]);
  });

  it("does not mirror closed items and marks tracker work done when an assigned item is marked done", async () => {
    const app = createTestApp();
    const cookie = await loginCookie("manager", "secret123");

    const closed = await invoke(app, {
      method: "POST",
      url: "/api/manager-desk/items",
      headers: { cookie },
      body: {
        date: "2026-03-08",
        title: "Already resolved follow-up",
        status: "done",
        assigneeDeveloperAccountId: "dev-1",
      },
    });

    expect(closed.status).toBe(201);

    const closedTrackerRows = await db
      .select()
      .from(teamTrackerItems)
      .where(eq(teamTrackerItems.managerDeskItemId, closed.body.id));
    expect(closedTrackerRows).toHaveLength(0);

    const created = await invoke(app, {
      method: "POST",
      url: "/api/manager-desk/items",
      headers: { cookie },
      body: {
        date: "2026-03-08",
        title: "Investigate active blocker",
        status: "planned",
        assigneeDeveloperAccountId: "dev-1",
      },
    });

    const originalTrackerRows = await db
      .select()
      .from(teamTrackerItems)
      .where(eq(teamTrackerItems.managerDeskItemId, created.body.id));
    expect(originalTrackerRows).toHaveLength(1);

    const completed = await invoke(app, {
      method: "PATCH",
      url: `/api/manager-desk/items/${created.body.id}`,
      headers: { cookie },
      body: {
        status: "done",
      },
    });

    expect(completed.status).toBe(200);
    expect(completed.body?.status).toBe("done");
    expect(completed.body?.delegatedExecution).toMatchObject({
      trackerItemId: originalTrackerRows[0]!.id,
      state: "done",
    });

    const trackerRows = await db
      .select()
      .from(teamTrackerItems)
      .where(eq(teamTrackerItems.id, originalTrackerRows[0]!.id));
    expect(trackerRows).toEqual([
      expect.objectContaining({
        state: "done",
        completedAt: expect.any(String),
      }),
    ]);
  });

  it("POST /api/manager-desk/items/:itemId/cancel-delegated-task marks linked tracker work dropped and keeps the desk item as cancelled", async () => {
    const app = createTestApp();
    const cookie = await loginCookie("manager", "secret123");

    const created = await invoke(app, {
      method: "POST",
      url: "/api/manager-desk/items",
      headers: { cookie },
      body: {
        date: "2026-03-08",
        title: "Investigate active blocker",
        status: "planned",
        assigneeDeveloperAccountId: "dev-1",
        contextNote: "Manager follow-up should remain visible after cancellation.",
      },
    });

    const linkedTrackerRows = await db
      .select()
      .from(teamTrackerItems)
      .where(eq(teamTrackerItems.managerDeskItemId, created.body.id));
    expect(linkedTrackerRows).toHaveLength(1);

    await db
      .update(teamTrackerItems)
      .set({ note: "Developer progress note" })
      .where(eq(teamTrackerItems.id, linkedTrackerRows[0]!.id));

    const cancelled = await invoke(app, {
      method: "POST",
      url: `/api/manager-desk/items/${created.body.id}/cancel-delegated-task`,
      headers: { cookie },
    });

    expect(cancelled.status).toBe(200);
    expect(cancelled.body).toMatchObject({
      id: created.body.id,
      status: "cancelled",
      contextNote: "Manager follow-up should remain visible after cancellation.",
    });
    expect(cancelled.body?.completedAt).toBeDefined();
    expect(cancelled.body?.delegatedExecution).toMatchObject({
      trackerItemId: linkedTrackerRows[0]!.id,
      state: "dropped",
      note: "Developer progress note",
    });

    const trackerRows = await db
      .select()
      .from(teamTrackerItems)
      .where(eq(teamTrackerItems.id, linkedTrackerRows[0]!.id));
    expect(trackerRows).toEqual([
      expect.objectContaining({
        state: "dropped",
        note: "Developer progress note",
      }),
    ]);
  });

  it("POST /api/manager-desk/items/:itemId/cancel-delegated-task returns 409 when no linked tracker work exists", async () => {
    const app = createTestApp();
    const cookie = await loginCookie("manager", "secret123");

    const created = await invoke(app, {
      method: "POST",
      url: "/api/manager-desk/items",
      headers: { cookie },
      body: {
        date: "2026-03-08",
        title: "Unassigned manager-only follow-up",
      },
    });

    const cancelled = await invoke(app, {
      method: "POST",
      url: `/api/manager-desk/items/${created.body.id}/cancel-delegated-task`,
      headers: { cookie },
    });

    expect(cancelled.status).toBe(409);
    expect(cancelled.body?.error).toBe("Task has no linked delegated work to cancel");
  });

  it("reassigns mirrored tracker work to the new owner and preserves the same tracker row", async () => {
    const app = createTestApp();
    const cookie = await loginCookie("manager", "secret123");

    const created = await invoke(app, {
      method: "POST",
      url: "/api/manager-desk/items",
      headers: { cookie },
      body: {
        date: "2026-03-08",
        title: "Coordinate review follow-up",
        assigneeDeveloperAccountId: "dev-1",
        links: [{ linkType: "issue", issueKey: "PROJ-221" }],
      },
    });

    const originalTracker = await db
      .select()
      .from(teamTrackerItems)
      .where(eq(teamTrackerItems.managerDeskItemId, created.body.id));
    expect(originalTracker[0]).toBeDefined();

    await db
      .update(teamTrackerItems)
      .set({
        state: "in_progress",
        note: "Developer-owned note",
      })
      .where(eq(teamTrackerItems.id, originalTracker[0]!.id));

    const reassigned = await invoke(app, {
      method: "PATCH",
      url: `/api/manager-desk/items/${created.body.id}`,
      headers: { cookie },
      body: {
        assigneeDeveloperAccountId: "dev-2",
      },
    });

    expect(reassigned.status).toBe(200);
    expect(reassigned.body?.assignee).toEqual({
      accountId: "dev-2",
      displayName: "Rahul Sharma",
      avatarUrl: "https://example.com/rahul.png",
    });

    const trackerRows = await db
      .select()
      .from(teamTrackerItems)
      .where(eq(teamTrackerItems.managerDeskItemId, created.body.id));
    expect(trackerRows).toHaveLength(1);
    expect(trackerRows[0]).toMatchObject({
      id: originalTracker[0]!.id,
      managerDeskItemId: created.body.id,
      itemType: "jira",
      jiraKey: "PROJ-221",
      title: "Coordinate review follow-up",
      state: "in_progress",
      note: "Developer-owned note",
    });

    const targetDay = await db
      .select()
      .from(teamTrackerDays)
      .where(eq(teamTrackerDays.id, trackerRows[0]!.dayId));
    expect(targetDay[0]?.developerAccountId).toBe("dev-2");
  });

  it("clears the assignee on linked delegated work and marks the tracker item dropped", async () => {
    const app = createTestApp();
    const cookie = await loginCookie("manager", "secret123");

    const created = await invoke(app, {
      method: "POST",
      url: "/api/manager-desk/items",
      headers: { cookie },
      body: {
        date: "2026-03-08",
        title: "Custom manager follow-up",
        assigneeDeveloperAccountId: "dev-1",
      },
    });

    const linkedBefore = await db
      .select()
      .from(teamTrackerItems)
      .where(eq(teamTrackerItems.managerDeskItemId, created.body.id));
    expect(linkedBefore).toHaveLength(1);

    const cleared = await invoke(app, {
      method: "PATCH",
      url: `/api/manager-desk/items/${created.body.id}`,
      headers: { cookie },
      body: {
        assigneeDeveloperAccountId: null,
      },
    });

    expect(cleared.status).toBe(200);
    expect(cleared.body?.assignee).toBeUndefined();
    expect(cleared.body?.delegatedExecution).toMatchObject({
      trackerItemId: linkedBefore[0]!.id,
      state: "dropped",
    });
    expect(cleared.body?.status).toBe("inbox");

    const trackerRows = await db
      .select()
      .from(teamTrackerItems)
      .where(eq(teamTrackerItems.managerDeskItemId, created.body.id));
    expect(trackerRows).toEqual([
      expect.objectContaining({
        id: linkedBefore[0]!.id,
        state: "dropped",
      }),
    ]);
  });

  it("rejects patching linked delegated work to cancelled without the dedicated cancel action", async () => {
    const app = createTestApp();
    const cookie = await loginCookie("manager", "secret123");

    const created = await invoke(app, {
      method: "POST",
      url: "/api/manager-desk/items",
      headers: { cookie },
      body: {
        date: "2026-03-08",
        title: "Linked delegated item",
        assigneeDeveloperAccountId: "dev-1",
      },
    });

    const res = await invoke(app, {
      method: "PATCH",
      url: `/api/manager-desk/items/${created.body.id}`,
      headers: { cookie },
      body: {
        status: "cancelled",
      },
    });

    expect(res.status).toBe(409);
    expect(res.body?.error).toBe(
      "Linked delegated tasks must be cancelled with the dedicated cancel action"
    );
  });

  it("rejects moving linked delegated work to later", async () => {
    const app = createTestApp();
    const cookie = await loginCookie("manager", "secret123");

    const created = await invoke(app, {
      method: "POST",
      url: "/api/manager-desk/items",
      headers: { cookie },
      body: {
        date: "2026-03-08",
        title: "Linked delegated item",
        assigneeDeveloperAccountId: "dev-1",
      },
    });

    const res = await invoke(app, {
      method: "PATCH",
      url: `/api/manager-desk/items/${created.body.id}`,
      headers: { cookie },
      body: {
        status: "backlog",
      },
    });

    expect(res.status).toBe(409);
    expect(res.body?.error).toBe(
      "Linked delegated tasks must be removed from your desk or cancelled before moving to Later"
    );

    const trackerRows = await db
      .select()
      .from(teamTrackerItems)
      .where(eq(teamTrackerItems.managerDeskItemId, created.body.id));
    expect(trackerRows).toHaveLength(1);
  });

  it("POST /api/manager-desk/items/:itemId/links adds issue, developer, and external links and rejects duplicates", async () => {
    const app = createTestApp();
    const created = await invoke(app, {
      method: "POST",
      url: "/api/manager-desk/items",
      headers: {
        cookie: await loginCookie("manager", "secret123"),
      },
      body: {
        date: "2026-03-08",
        title: "Cross-team follow-up",
      },
    });

    const itemId = created.body.id;

    const issueLink = await invoke(app, {
      method: "POST",
      url: `/api/manager-desk/items/${itemId}/links`,
      headers: {
        cookie: await loginCookie("manager", "secret123"),
      },
      body: {
        linkType: "issue",
        issueKey: "PROJ-221",
      },
    });
    expect(issueLink.status).toBe(201);

    const developerLink = await invoke(app, {
      method: "POST",
      url: `/api/manager-desk/items/${itemId}/links`,
      headers: {
        cookie: await loginCookie("manager", "secret123"),
      },
      body: {
        linkType: "developer",
        developerAccountId: "dev-2",
      },
    });
    expect(developerLink.status).toBe(201);
    expect(developerLink.body?.displayLabel).toBe("Rahul Sharma");

    const externalLink = await invoke(app, {
      method: "POST",
      url: `/api/manager-desk/items/${itemId}/links`,
      headers: {
        cookie: await loginCookie("manager", "secret123"),
      },
      body: {
        linkType: "external_group",
        externalLabel: "Onshore Design Team",
      },
    });
    expect(externalLink.status).toBe(201);
    expect(externalLink.body?.displayLabel).toBe("Onshore Design Team");

    const duplicate = await invoke(app, {
      method: "POST",
      url: `/api/manager-desk/items/${itemId}/links`,
      headers: {
        cookie: await loginCookie("manager", "secret123"),
      },
      body: {
        linkType: "issue",
        issueKey: "PROJ-221",
      },
    });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body?.error).toBe("Identical link already exists for this item");
  });

  it("rejects invalid link payloads", async () => {
    const app = createTestApp();
    const created = await invoke(app, {
      method: "POST",
      url: "/api/manager-desk/items",
      headers: {
        cookie: await loginCookie("manager", "secret123"),
      },
      body: {
        date: "2026-03-08",
        title: "Waiting on response",
      },
    });

    const res = await invoke(app, {
      method: "POST",
      url: `/api/manager-desk/items/${created.body.id}/links`,
      headers: {
        cookie: await loginCookie("manager", "secret123"),
      },
      body: {
        linkType: "developer",
      },
    });

    expect(res.status).toBe(400);
    expect(res.body?.error).toContain("developerAccountId is required for developer links");
  });

  it("lookup endpoints return lightweight issue and developer results", async () => {
    const app = createTestApp();
    const cookie = await loginCookie("manager", "secret123");

    const issueLookup = await invoke(app, {
      method: "GET",
      url: "/api/manager-desk/lookups/issues?q=design",
      headers: {
        cookie,
      },
    });

    expect(issueLookup.status).toBe(200);
    expect(issueLookup.body?.items).toEqual([
      {
        jiraKey: "PROJ-321",
        summary: "Investigate design gap in review flow",
        priorityName: "Medium",
        statusName: "To Do",
        assigneeName: "Alice Smith",
      },
    ]);

    const developerLookup = await invoke(app, {
      method: "GET",
      url: "/api/manager-desk/lookups/developers?q=rahul",
      headers: {
        cookie,
      },
    });

    expect(developerLookup.status).toBe(200);
    expect(developerLookup.body?.items).toEqual([
      {
        accountId: "dev-2",
        displayName: "Rahul Sharma",
        email: "rahul@example.com",
        avatarUrl: "https://example.com/rahul.png",
      },
    ]);
  });

  it("GET /api/manager-desk/lookups/developers filters inactive people when a date is provided", async () => {
    await trackerService.updateAvailability("dev-2", {
      effectiveDate: "2026-03-08",
      state: "inactive",
      note: "PTO today",
    });

    const app = createTestApp();
    const cookie = await loginCookie("manager", "secret123");
    const developerLookup = await invoke(app, {
      method: "GET",
      url: "/api/manager-desk/lookups/developers?q=rahul&date=2026-03-08",
      headers: {
        cookie,
      },
    });

    expect(developerLookup.status).toBe(200);
    expect(developerLookup.body?.items).toEqual([]);
  });

  it("GET /api/manager-desk/lookups/developers can include inactive metadata when requested", async () => {
    await trackerService.updateAvailability("dev-2", {
      effectiveDate: "2026-03-08",
      state: "inactive",
      note: "PTO today",
    });

    const app = createTestApp();
    const cookie = await loginCookie("manager", "secret123");
    const developerLookup = await invoke(app, {
      method: "GET",
      url: "/api/manager-desk/lookups/developers?q=rahul&date=2026-03-08&includeUnavailable=true",
      headers: {
        cookie,
      },
    });

    expect(developerLookup.status).toBe(200);
    expect(developerLookup.body?.items).toEqual([
      {
        accountId: "dev-2",
        displayName: "Rahul Sharma",
        email: "rahul@example.com",
        avatarUrl: "https://example.com/rahul.png",
        availability: {
          state: "inactive",
          note: "PTO today",
          startDate: "2026-03-08",
        },
      },
    ]);
  });

  it("GET /api/manager-desk/lookups/developers supports blank q for quick-capture roster loading", async () => {
    await db.insert(developers).values({
      accountId: "dev-3",
      displayName: "Zara Inactive",
      email: "zara@example.com",
      avatarUrl: null,
      isActive: 0,
    });
    await trackerService.updateAvailability("dev-2", {
      effectiveDate: "2026-03-08",
      state: "inactive",
      note: "PTO today",
    });

    const app = createTestApp();
    const cookie = await loginCookie("manager", "secret123");
    const developerLookup = await invoke(app, {
      method: "GET",
      url: "/api/manager-desk/lookups/developers?q=&date=2026-03-08",
      headers: {
        cookie,
      },
    });

    expect(developerLookup.status).toBe(200);
    expect(developerLookup.body?.items).toEqual([
      {
        accountId: "dev-1",
        displayName: "Alice Smith",
        email: "alice@example.com",
      },
    ]);
  });

  it("GET /api/manager-desk/carry-forward-context finds the nearest earlier carryable day", async () => {
    const app = createTestApp();
    const cookie = await loginCookie("manager", "secret123");

    await invoke(app, {
      method: "POST",
      url: "/api/manager-desk/items",
      headers: { cookie },
      body: {
        date: "2026-03-06",
        title: "Friday follow-up",
        status: "planned",
      },
    });

    const saturday = await invoke(app, {
      method: "POST",
      url: "/api/manager-desk/items",
      headers: { cookie },
      body: {
        date: "2026-03-07",
        title: "Saturday carry source",
        status: "waiting",
      },
    });

    const preview = await invoke(app, {
      method: "GET",
      url: "/api/manager-desk/carry-forward-context?toDate=2026-03-09",
      headers: { cookie },
    });

    expect(preview.status).toBe(200);
    expect(preview.body).toEqual({
      fromDate: "2026-03-07",
      toDate: "2026-03-09",
      carryable: 1,
      overdueOnArrivalCount: 0,
      timeMode: "rebase_to_target_date",
      items: [
        expect.objectContaining({
          item: expect.objectContaining({
            id: saturday.body.id,
            title: "Saturday carry source",
          }),
        }),
      ],
    });
  });

  it("GET /api/manager-desk/carry-forward-preview returns rebased times, warnings, and only still-carryable items", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-09T16:30:00.000Z"));

    const app = createTestApp();
    const cookie = await loginCookie("manager", "secret123");

    const alreadyCarried = await invoke(app, {
      method: "POST",
      url: "/api/manager-desk/items",
      headers: { cookie },
      body: {
        date: "2026-03-08",
        title: "Already moved forward",
        status: "waiting",
        followUpAt: "2026-03-08T12:00:00.000Z",
      },
    });

    const stillCarryable = await invoke(app, {
      method: "POST",
      url: "/api/manager-desk/items",
      headers: { cookie },
      body: {
        date: "2026-03-08",
        title: "Design sync that already ran",
        kind: "meeting",
        status: "planned",
        plannedStartAt: "2026-03-08T15:00:00.000Z",
        plannedEndAt: "2026-03-08T16:00:00.000Z",
        followUpAt: "2026-03-08T15:30:00.000Z",
      },
    });

    await invoke(app, {
      method: "POST",
      url: "/api/manager-desk/items",
      headers: { cookie },
      body: {
        date: "2026-03-08",
        title: "Closed work should not preview",
        status: "done",
      },
    });

    const carriedOnce = await invoke(app, {
      method: "POST",
      url: "/api/manager-desk/carry-forward",
      headers: { cookie },
      body: {
        fromDate: "2026-03-08",
        toDate: "2026-03-09",
        itemIds: [alreadyCarried.body.id],
      },
    });
    expect(carriedOnce.status).toBe(200);
    expect(carriedOnce.body).toEqual({ created: 1 });

    const preview = await invoke(app, {
      method: "GET",
      url: "/api/manager-desk/carry-forward-preview?fromDate=2026-03-08&toDate=2026-03-09",
      headers: { cookie },
    });

    expect(preview.status).toBe(200);
    expect(preview.body).toEqual({
      fromDate: "2026-03-08",
      toDate: "2026-03-09",
      carryable: 1,
      overdueOnArrivalCount: 1,
      timeMode: "rebase_to_target_date",
      items: [
        expect.objectContaining({
          item: expect.objectContaining({
            id: stillCarryable.body.id,
            title: "Design sync that already ran",
            plannedStartAt: "2026-03-08T15:00:00.000Z",
            plannedEndAt: "2026-03-08T16:00:00.000Z",
            followUpAt: "2026-03-08T15:30:00.000Z",
          }),
          rebasedPlannedStartAt: "2026-03-09T15:00:00.000Z",
          rebasedPlannedEndAt: "2026-03-09T16:00:00.000Z",
          rebasedFollowUpAt: "2026-03-09T15:30:00.000Z",
          warningCodes: [
            "follow_up_overdue_on_arrival",
            "planned_end_overdue_on_arrival",
          ],
        }),
      ],
    });
  });

  it("carry-forward moves unfinished items forward without cloning duplicates on repeat runs", async () => {
    const app = createTestApp();
    const cookie = await loginCookie("manager", "secret123");

    const created = await invoke(app, {
      method: "POST",
      url: "/api/manager-desk/items",
      headers: {
        cookie,
      },
      body: {
        date: "2026-03-08",
        title: "Follow up with Rahul on blocker",
        kind: "waiting",
        category: "follow_up",
        status: "waiting",
        priority: "high",
        plannedStartAt: "2026-03-08T14:30:00.000Z",
        plannedEndAt: "2026-03-08T15:15:00.000Z",
        followUpAt: "2026-03-08T15:00:00.000Z",
        links: [
          { linkType: "developer", developerAccountId: "dev-2" },
          { linkType: "issue", issueKey: "PROJ-221" },
        ],
      },
    });

    const active = await invoke(app, {
      method: "POST",
      url: "/api/manager-desk/items",
      headers: {
        cookie,
      },
      body: {
        date: "2026-03-08",
        title: "Continue design review",
        kind: "action",
        category: "design",
        status: "in_progress",
      },
    });

    const carryForward = await invoke(app, {
      method: "POST",
      url: "/api/manager-desk/carry-forward",
      headers: {
        cookie,
      },
      body: {
        fromDate: "2026-03-08",
        toDate: "2026-03-09",
        itemIds: [created.body.id, active.body.id],
      },
    });

    expect(carryForward.status).toBe(200);
    expect(carryForward.body).toEqual({ created: 2 });

    const nextDay = await invoke(app, {
      method: "GET",
      url: "/api/manager-desk?date=2026-03-09",
      headers: {
        cookie,
      },
    });

    expect(nextDay.status).toBe(200);
    expect(nextDay.body?.items).toHaveLength(2);
    expect(nextDay.body?.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: "Follow up with Rahul on blocker",
          status: "waiting",
          plannedStartAt: "2026-03-09T14:30:00.000Z",
          plannedEndAt: "2026-03-09T15:15:00.000Z",
          followUpAt: "2026-03-09T15:00:00.000Z",
          links: expect.arrayContaining([
            expect.objectContaining({
              linkType: "developer",
              developerAccountId: "dev-2",
            }),
            expect.objectContaining({
              linkType: "issue",
              issueKey: "PROJ-221",
            }),
          ]),
        }),
        expect.objectContaining({
          title: "Continue design review",
          status: "in_progress",
          originDate: "2026-03-09",
        }),
      ])
    );

    const managerItemsAfterCarry = await db.select().from(managerDeskItems);
    expect(managerItemsAfterCarry).toHaveLength(2);
    expect(managerItemsAfterCarry.every((item) => item.sourceItemId === null)).toBe(true);

    const repeat = await invoke(app, {
      method: "POST",
      url: "/api/manager-desk/carry-forward",
      headers: {
        cookie,
      },
      body: {
        fromDate: "2026-03-08",
        toDate: "2026-03-09",
        itemIds: [created.body.id, active.body.id],
      },
    });

    expect(repeat.status).toBe(200);
    expect(repeat.body).toEqual({ created: 0 });
  });

  it("carry-forward removes the item from today's live desk until its new day", async () => {
    const app = createTestApp();
    const cookie = await loginCookie("manager", "secret123");

    const created = await invoke(app, {
      method: "POST",
      url: "/api/manager-desk/items",
      headers: { cookie },
      body: {
        date: "2026-03-08",
        title: "Push this to tomorrow",
        status: "planned",
      },
    });

    const before = await invoke(app, {
      method: "GET",
      url: "/api/manager-desk?date=2026-03-08",
      headers: { cookie },
    });
    expect(before.body?.items.some((item: { id: number }) => item.id === created.body.id)).toBe(true);

    const carryForward = await invoke(app, {
      method: "POST",
      url: "/api/manager-desk/carry-forward",
      headers: { cookie },
      body: {
        fromDate: "2026-03-08",
        toDate: "2026-03-09",
        itemIds: [created.body.id],
      },
    });
    expect(carryForward.status).toBe(200);
    expect(carryForward.body).toEqual({ created: 1 });

    const todayAfter = await invoke(app, {
      method: "GET",
      url: "/api/manager-desk?date=2026-03-08",
      headers: { cookie },
    });
    expect(todayAfter.status).toBe(200);
    expect(todayAfter.body?.viewMode).toBe("live");
    expect(todayAfter.body?.items.some((item: { id: number }) => item.id === created.body.id)).toBe(false);

    const nextDay = await invoke(app, {
      method: "GET",
      url: "/api/manager-desk?date=2026-03-09",
      headers: { cookie },
    });
    expect(nextDay.status).toBe(200);
    expect(nextDay.body?.items).toEqual([
      expect.objectContaining({ id: created.body.id, originDate: "2026-03-09" }),
    ]);
  });

  it("carry-forward preserves overnight time spans relative to the target day", async () => {
    const app = createTestApp();
    const cookie = await loginCookie("manager", "secret123");

    const created = await invoke(app, {
      method: "POST",
      url: "/api/manager-desk/items",
      headers: { cookie },
      body: {
        date: "2026-03-08",
        title: "Overnight rollout watch",
        status: "planned",
        plannedStartAt: "2026-03-08T23:00:00.000Z",
        plannedEndAt: "2026-03-09T01:00:00.000Z",
      },
    });

    const carryForward = await invoke(app, {
      method: "POST",
      url: "/api/manager-desk/carry-forward",
      headers: { cookie },
      body: {
        fromDate: "2026-03-08",
        toDate: "2026-03-10",
        itemIds: [created.body.id],
      },
    });

    expect(carryForward.status).toBe(200);
    expect(carryForward.body).toEqual({ created: 1 });

    const nextDay = await invoke(app, {
      method: "GET",
      url: "/api/manager-desk?date=2026-03-10",
      headers: { cookie },
    });

    expect(nextDay.status).toBe(200);
    expect(nextDay.body?.items).toEqual([
      expect.objectContaining({
        id: created.body.id,
        title: "Overnight rollout watch",
        plannedStartAt: "2026-03-10T23:00:00.000Z",
        plannedEndAt: "2026-03-11T01:00:00.000Z",
      }),
    ]);

    const managerItemsAfterCarry = await db.select().from(managerDeskItems);
    expect(managerItemsAfterCarry).toHaveLength(1);
  });

  it("carry-forward preserves tracker notes while moving linked manager desk items forward", async () => {
    const app = createTestApp();
    const cookie = await loginCookie("manager", "secret123");

    const created = await invoke(app, {
      method: "POST",
      url: "/api/manager-desk/items",
      headers: { cookie },
      body: {
        date: "2026-03-08",
        title: "Continue review follow-up",
        status: "in_progress",
        assigneeDeveloperAccountId: "dev-1",
        links: [{ linkType: "issue", issueKey: "PROJ-321" }],
      },
    });

    const sourceTrackerRows = await db
      .select()
      .from(teamTrackerItems)
      .where(eq(teamTrackerItems.managerDeskItemId, created.body.id));
    expect(sourceTrackerRows).toHaveLength(1);

    await db
      .update(teamTrackerItems)
      .set({
        note: "Carry forward after confirming edge-case repro steps.",
      })
      .where(eq(teamTrackerItems.id, sourceTrackerRows[0]!.id));

    const carryForward = await invoke(app, {
      method: "POST",
      url: "/api/manager-desk/carry-forward",
      headers: { cookie },
      body: {
        fromDate: "2026-03-08",
        toDate: "2026-03-09",
        itemIds: [created.body.id],
      },
    });

    expect(carryForward.status).toBe(200);
    expect(carryForward.body).toEqual({ created: 1 });

    const managerItemsAfterCarry = await db.select().from(managerDeskItems);
    expect(managerItemsAfterCarry).toHaveLength(1);

    const targetTrackerDay = await db
      .select()
      .from(teamTrackerDays)
      .where(eq(teamTrackerDays.date, "2026-03-09"));
    expect(targetTrackerDay).toHaveLength(1);

    const carriedTrackerRows = await db
      .select()
      .from(teamTrackerItems)
      .where(eq(teamTrackerItems.dayId, targetTrackerDay[0]!.id));
    expect(carriedTrackerRows).toEqual([
      expect.objectContaining({
        id: sourceTrackerRows[0]!.id,
        managerDeskItemId: created.body.id,
        jiraKey: "PROJ-321",
        note: "Carry forward after confirming edge-case repro steps.",
        state: "planned",
      }),
    ]);
  });

  it("rejects carry-forward to the same day or a past date", async () => {
    const app = createTestApp();
    const cookie = await loginCookie("manager", "secret123");

    const created = await invoke(app, {
      method: "POST",
      url: "/api/manager-desk/items",
      headers: { cookie },
      body: {
        date: "2026-03-08",
        title: "Review open blocker",
        status: "planned",
      },
    });

    const sameDay = await invoke(app, {
      method: "POST",
      url: "/api/manager-desk/carry-forward",
      headers: { cookie },
      body: {
        fromDate: "2026-03-08",
        toDate: "2026-03-08",
        itemIds: [created.body.id],
      },
    });

    expect(sameDay.status).toBe(400);
    expect(sameDay.body?.error).toBe("toDate must be after fromDate");

    const previousDay = await invoke(app, {
      method: "POST",
      url: "/api/manager-desk/carry-forward",
      headers: { cookie },
      body: {
        fromDate: "2026-03-08",
        toDate: "2026-03-07",
        itemIds: [created.body.id],
      },
    });

    expect(previousDay.status).toBe(400);
    expect(previousDay.body?.error).toBe("toDate must be after fromDate");
  });
});
