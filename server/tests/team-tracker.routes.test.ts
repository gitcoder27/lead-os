import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import { eq } from "drizzle-orm";
import { Readable, Writable } from "node:stream";
import { createTeamTrackerRouter } from "../src/routes/team-tracker";
import { ManagerDeskService } from "../src/services/manager-desk.service";
import { TaskEventsService } from "../src/services/task-events.service";
import { TeamTrackerService } from "../src/services/team-tracker.service";
import { notFoundHandler, errorHandler } from "../src/middleware/errorHandler";
import { resetDatabase, db } from "./helpers/db";
import { checkinTaskRefs, configTable, developerAvailabilityPeriods, developers, issues, managerDeskItems, teamTrackerSavedViews } from "../src/db/schema";

const trackerService = new TeamTrackerService();
const managerDeskService = new ManagerDeskService(trackerService);
const eventsService = new TaskEventsService();

async function seedDevelopers() {
  await db.insert(developers).values([
    { accountId: "dev-1", displayName: "Alice Smith", email: null, avatarUrl: null, isActive: 1 },
    { accountId: "dev-2", displayName: "Bob Jones", email: null, avatarUrl: null, isActive: 0 },
  ]);
}

async function seedIssue(
  jiraKey = "AM-123",
  overrides: Partial<typeof issues.$inferInsert> = {}
) {
  await db.insert(issues).values({
    jiraKey,
    summary: "Linked Jira task",
    description: null,
    aspenSeverity: null,
    priorityName: "High",
    priorityId: "1",
    statusName: "In Progress",
    statusCategory: "indeterminate",
    assigneeId: "dev-1",
    assigneeName: "Alice Smith",
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
    ...overrides,
  });
}

function createTestApp(managerAccountId = "manager-1") {
  const app = express();
  app.use((req, _res, next) => {
    req.auth = {
      sessionId: "test-session",
      user: {
        username: "manager",
        accountId: managerAccountId,
        displayName: "Manager One",
        role: "manager",
      },
    };
    next();
  });
  app.use(
    "/api/team-tracker",
    createTeamTrackerRouter(trackerService, managerDeskService)
  );
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

async function invoke(
  app: express.Express,
  options: { method: string; url: string; body?: unknown }
): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = {};
  const chunks: Buffer[] = [];

  const req = new Readable({
    read() {
      this.push(null);
    },
  }) as Readable & {
    url: string;
    method: string;
    headers: Record<string, string>;
    body?: unknown;
    connection: Record<string, never>;
    socket: Record<string, never>;
    httpVersion: string;
    httpVersionMajor: number;
    httpVersionMinor: number;
  };

  req.url = options.url;
  req.method = options.method;
  req.headers = { "content-type": "application/json" };
  req.body = options.body;
  req.connection = {};
  req.socket = {};
  req.httpVersion = "1.1";
  req.httpVersionMajor = 1;
  req.httpVersionMinor = 1;

  return await new Promise((resolve, reject) => {
    const res = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        callback();
      },
    }) as Writable & {
      statusCode: number;
      req?: typeof req;
      setHeader: (name: string, value: string | number | readonly string[]) => void;
      getHeader: (name: string) => string | number | readonly string[] | undefined;
      getHeaders: () => Record<string, string>;
      removeHeader: (name: string) => void;
      writeHead: (statusCode: number, responseHeaders?: Record<string, string>) => typeof res;
      end: (chunk?: unknown) => typeof res;
    };

    res.statusCode = 200;
    res.req = req;
    res.setHeader = (name, value) => {
      headers[name.toLowerCase()] = Array.isArray(value) ? value.join(",") : String(value);
    };
    res.getHeader = (name) => headers[name.toLowerCase()];
    res.getHeaders = () => headers;
    res.removeHeader = (name) => {
      delete headers[name.toLowerCase()];
    };
    res.writeHead = (statusCode, responseHeaders = {}) => {
      res.statusCode = statusCode;
      for (const [name, value] of Object.entries(responseHeaders)) {
        headers[name.toLowerCase()] = value;
      }
      return res;
    };
    res.end = (chunk) => {
      if (chunk !== undefined) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
      }
      const rawBody = Buffer.concat(chunks).toString("utf8");
      resolve({
        status: res.statusCode,
        body: rawBody ? JSON.parse(rawBody) : undefined,
      });
      return res;
    };

    app.handle(req as any, res as any, reject);
  });
}

describe("team tracker routes", () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-07T08:00:00.000Z"));
    await resetDatabase();
    await seedDevelopers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("GET /api/team-tracker returns only active developers", async () => {
    const app = createTestApp();

    const res = await invoke(app, {
      method: "GET",
      url: "/api/team-tracker?date=2026-03-07",
    });

    expect(res.status).toBe(200);
    expect(res.body?.viewMode).toBe("live");
    expect(res.body?.developers).toHaveLength(1);
    expect(res.body?.developers[0]?.developer.accountId).toBe("dev-1");
  });

  it("GET /api/team-tracker keeps unfinished work visible on the live board and preserves past snapshots", async () => {
    await trackerService.addItem("dev-1", "2026-03-06", {
      title: "Friday follow-up",
    });
    await trackerService.addItem("dev-1", "2026-03-07", {
      title: "Saturday planning item",
    });

    const app = createTestApp();
    const liveRes = await invoke(app, {
      method: "GET",
      url: "/api/team-tracker?date=2026-03-07",
    });
    const historyRes = await invoke(app, {
      method: "GET",
      url: "/api/team-tracker?date=2026-03-06",
    });

    expect(liveRes.status).toBe(200);
    expect(liveRes.body?.viewMode).toBe("live");
    expect(
      liveRes.body?.developers[0]?.plannedItems.map((item: any) => item.title)
    ).toEqual(["Friday follow-up", "Saturday planning item"]);

    expect(historyRes.status).toBe(200);
    expect(historyRes.body?.viewMode).toBe("history");
    expect(historyRes.body?.attentionQueue).toEqual([]);
    expect(
      historyRes.body?.developers[0]?.plannedItems.map((item: any) => item.title)
    ).toEqual(["Friday follow-up"]);
  });

  it("GET /api/team-tracker applies search, sort, grouping, and visible summary metadata", async () => {
    await db.insert(developers).values([
      { accountId: "dev-3", displayName: "Cara Diaz", email: null, avatarUrl: null, isActive: 1 },
      { accountId: "dev-4", displayName: "Derek Long", email: null, avatarUrl: null, isActive: 1 },
    ]);
    await trackerService.updateDay("dev-1", "2026-03-07", { status: "blocked" });
    await trackerService.updateDay("dev-3", "2026-03-07", { status: "waiting" });
    await trackerService.addItem("dev-1", "2026-03-07", {
      title: "Investigate login bug",
      note: "Reproduce the login issue",
    });
    await trackerService.addItem("dev-3", "2026-03-07", {
      title: "Investigate dashboard bug",
    });

    const app = createTestApp();
    const res = await invoke(app, {
      method: "GET",
      url: "/api/team-tracker?date=2026-03-07&q=bug&sortBy=blocked_first&groupBy=status",
    });

    expect(res.status).toBe(200);
    expect(res.body?.query).toEqual({
      q: "bug",
      summaryFilter: "all",
      sortBy: "blocked_first",
      groupBy: "status",
    });
    expect(res.body?.summary.total).toBe(3);
    expect(res.body?.visibleSummary.total).toBe(2);
    expect(res.body?.developers.map((day: any) => day.developer.accountId)).toEqual([
      "dev-1",
      "dev-3",
    ]);
    expect(res.body?.groups).toEqual([
      expect.objectContaining({
        key: "blocked",
        count: 1,
      }),
      expect.objectContaining({
        key: "waiting",
        count: 1,
      }),
    ]);
    expect(res.body?.attentionQueue.map((item: any) => item.developer.accountId)).toEqual([
      "dev-1",
      "dev-3",
    ]);
  });

  it("GET /api/team-tracker resolves a saved view and allows explicit query overrides", async () => {
    await trackerService.createSavedView("manager-1", {
      name: "Morning triage",
      q: "alice",
      sortBy: "attention",
      groupBy: "attention_state",
      summaryFilter: "all",
    });

    const app = createTestApp();
    const res = await invoke(app, {
      method: "GET",
      url: "/api/team-tracker?date=2026-03-07&viewId=1&sortBy=name",
    });

    expect(res.status).toBe(200);
    expect(res.body?.query).toEqual({
      viewId: 1,
      q: "alice",
      summaryFilter: "all",
      sortBy: "name",
      groupBy: "attention_state",
    });
    expect(res.body?.developers.map((day: any) => day.developer.accountId)).toEqual(["dev-1"]);
  });

  it("GET /api/team-tracker returns 404 for a saved view owned by another manager", async () => {
    await trackerService.createSavedView("manager-2", {
      name: "Other manager view",
      q: "alice",
    });

    const app = createTestApp();
    const res = await invoke(app, {
      method: "GET",
      url: "/api/team-tracker?date=2026-03-07&viewId=1",
    });

    expect(res.status).toBe(404);
    expect(res.body?.error).toBe("Saved view not found");
  });

  it("GET /api/team-tracker/views lists saved views for the authenticated manager only", async () => {
    await trackerService.createSavedView("manager-1", {
      name: "Morning triage",
      q: "alice",
    });
    await trackerService.createSavedView("manager-2", {
      name: "Other manager view",
      q: "bob",
    });

    const app = createTestApp();
    const res = await invoke(app, {
      method: "GET",
      url: "/api/team-tracker/views",
    });

    expect(res.status).toBe(200);
    expect(res.body?.views).toEqual([
      expect.objectContaining({
        name: "Morning triage",
        q: "alice",
        summaryFilter: "all",
        sortBy: "name",
        groupBy: "none",
      }),
    ]);
  });

  it("POST /api/team-tracker/views creates a saved view", async () => {
    const app = createTestApp();
    const res = await invoke(app, {
      method: "POST",
      url: "/api/team-tracker/views",
      body: {
        name: "Blocked only",
        summaryFilter: "blocked",
        sortBy: "attention",
        groupBy: "status",
      },
    });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      name: "Blocked only",
      q: "",
      summaryFilter: "blocked",
      sortBy: "attention",
      groupBy: "status",
    });
  });

  it("PATCH /api/team-tracker/views/:viewId updates a saved view for its owner", async () => {
    const created = await trackerService.createSavedView("manager-1", {
      name: "Morning triage",
      q: "alice",
    });

    const app = createTestApp();
    const res = await invoke(app, {
      method: "PATCH",
      url: `/api/team-tracker/views/${created.id}`,
      body: {
        name: "Blocked first",
        q: "",
        summaryFilter: "blocked",
        sortBy: "blocked_first",
      },
    });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: created.id,
      name: "Blocked first",
      q: "",
      summaryFilter: "blocked",
      sortBy: "blocked_first",
      groupBy: "none",
    });
  });

  it("DELETE /api/team-tracker/views/:viewId deletes a saved view for its owner", async () => {
    const created = await trackerService.createSavedView("manager-1", {
      name: "Morning triage",
    });

    const app = createTestApp();
    const res = await invoke(app, {
      method: "DELETE",
      url: `/api/team-tracker/views/${created.id}`,
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ deleted: true });

    const rows = await db.select().from(teamTrackerSavedViews);
    expect(rows).toHaveLength(0);
  });

  it("GET /api/team-tracker returns a ranked attention queue", async () => {
    await db.insert(developers).values([
      { accountId: "dev-3", displayName: "Cara Diaz", email: null, avatarUrl: null, isActive: 1 },
      { accountId: "dev-4", displayName: "Derek Long", email: null, avatarUrl: null, isActive: 1 },
      { accountId: "dev-5", displayName: "Evan Park", email: null, avatarUrl: null, isActive: 1 },
      { accountId: "dev-6", displayName: "Fiona West", email: null, avatarUrl: null, isActive: 1 },
    ]);
    await seedIssue("AM-123", {
      developmentDueDate: "2026-03-06",
      dueDate: "2026-03-09",
    });

    await trackerService.updateDay("dev-1", "2026-03-07", { status: "blocked" });
    await trackerService.updateDay("dev-3", "2026-03-07", { status: "at_risk" });
    await trackerService.updateDay("dev-4", "2026-03-07", { status: "waiting" });
    await trackerService.addCheckIn("dev-4", "2026-03-07", { summary: "Waiting on QA handoff" });
    const waitingItem = await trackerService.addItem("dev-4", "2026-03-07", {
      title: "Follow up with QA",
    });
    await trackerService.setCurrentItem(waitingItem.id);
    const overdueItem = await trackerService.addItem("dev-1", "2026-03-07", {
      jiraKey: "AM-123",
      title: "Linked Jira task",
    });
    await trackerService.setCurrentItem(overdueItem.id);
    const noCurrentPlannedItem = await trackerService.addItem("dev-6", "2026-03-07", {
      title: "Pick next bug to investigate",
    });

    await trackerService.addCheckIn("dev-6", "2026-03-07", { summary: "Planning next work" });
    vi.setSystemTime(new Date("2026-03-07T12:00:00.000Z"));

    const app = createTestApp();
    const res = await invoke(app, {
      method: "GET",
      url: "/api/team-tracker?date=2026-03-07",
    });

    expect(res.status).toBe(200);
    expect(res.body?.attentionQueue.map((item: any) => item.developer.accountId)).toEqual([
      "dev-1",
      "dev-3",
      "dev-4",
      "dev-5",
      "dev-6",
    ]);
    expect(res.body?.attentionQueue[0]?.reasons.map((reason: any) => reason.code)).toEqual([
      "blocked",
      "stale_with_open_risk",
      "overdue_linked_work",
      "status_change_without_follow_up",
    ]);
    expect(res.body?.attentionQueue[2]?.reasons.map((reason: any) => reason.code)).toEqual([
      "stale_with_open_risk",
      "waiting",
    ]);
    expect(res.body?.attentionQueue[0]?.signals?.risk?.overdueLinkedWork).toBe(true);
    expect(res.body?.attentionQueue[0]?.availableQuickActions).toEqual([
      "update_status",
      "mark_inactive",
      "capture_follow_up",
    ]);
    expect(res.body?.attentionQueue[0]?.currentItem).toEqual({
      id: overdueItem.id,
      title: "Linked Jira task",
      jiraKey: "AM-123",
      lifecycle: "tracker_only",
    });
    expect(res.body?.attentionQueue[0]?.setCurrentCandidates).toEqual([]);
    expect(res.body?.attentionQueue[4]?.availableQuickActions).toEqual([
      "update_status",
      "mark_inactive",
      "capture_follow_up",
      "set_current",
    ]);
    expect(res.body?.attentionQueue[4]?.setCurrentCandidates).toEqual([
      {
        id: noCurrentPlannedItem.id,
        title: "Pick next bug to investigate",
        jiraKey: undefined,
        lifecycle: "tracker_only",
      },
    ]);
  });

  it("PATCH /api/team-tracker/:accountId/day ignores capacity payloads (removed in Phase 3)", async () => {
    const app = createTestApp();

    const res = await invoke(app, {
      method: "PATCH",
      url: "/api/team-tracker/dev-1/day",
      body: {
        date: "2026-03-07",
        status: "on_track",
        capacityUnits: 4,
      },
    });

    expect(res.status).toBe(200);
    expect(res.body?.capacityUnits).toBeNull();

    const capacityOnly = await invoke(app, {
      method: "PATCH",
      url: "/api/team-tracker/dev-1/day",
      body: { date: "2026-03-07", capacityUnits: 4 },
    });
    expect(capacityOnly.status).toBe(400);
  });

  it("PATCH /api/team-tracker/:accountId/day rejects empty updates", async () => {
    const app = createTestApp();

    const res = await invoke(app, {
      method: "PATCH",
      url: "/api/team-tracker/dev-1/day",
      body: {
        date: "2026-03-07",
      },
    });

    expect(res.status).toBe(400);
  });

  it("POST /api/team-tracker/:accountId/checkins records manager-authored attribution", async () => {
    const app = createTestApp();

    const res = await invoke(app, {
      method: "POST",
      url: "/api/team-tracker/dev-1/checkins",
      body: {
        date: "2026-03-07",
        summary: "Reviewed progress in standup",
        status: "on_track",
      },
    });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      summary: "Reviewed progress in standup",
      authorType: "manager",
      authorAccountId: "manager-1",
      status: "on_track",
    });
  });

  it("POST /api/team-tracker/:accountId/status-update records a unified manager status action", async () => {
    const app = createTestApp();

    const res = await invoke(app, {
      method: "POST",
      url: "/api/team-tracker/dev-1/status-update",
      body: {
        date: "2026-03-07",
        status: "blocked",
        rationale: "Waiting on platform review",
        summary: "Escalated in #backend-help",
        nextFollowUpAt: "2026-03-07T10:30:00.000Z",
      },
    });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      status: "blocked",
      nextFollowUpAt: "2026-03-07T10:30:00.000Z",
      checkIns: [
        expect.objectContaining({
          summary: "Escalated in #backend-help",
          status: "blocked",
          rationale: "Waiting on platform review",
          nextFollowUpAt: "2026-03-07T10:30:00.000Z",
          authorType: "manager",
          authorAccountId: "manager-1",
        }),
      ],
    });
  });

  it("POST /api/team-tracker/:accountId/status-update rejects blocked updates without rationale", async () => {
    const app = createTestApp();

    const res = await invoke(app, {
      method: "POST",
      url: "/api/team-tracker/dev-1/status-update",
      body: {
        date: "2026-03-07",
        status: "blocked",
      },
    });

    expect(res.status).toBe(400);
    expect(res.body?.error).toBe(
      "rationale is required when status is blocked or at_risk"
    );
  });

  it("POST /api/team-tracker/:accountId/items supports unlinked descriptive tasks", async () => {
    const app = createTestApp();

    const res = await invoke(app, {
      method: "POST",
      url: "/api/team-tracker/dev-1/items",
      body: {
        date: "2026-03-07",
        title: "Investigate login regression",
      },
    });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      lifecycle: "tracker_only",
      itemType: "custom",
      title: "Investigate login regression",
    });
  });

  it("POST /api/team-tracker/:accountId/items rejects whitespace-only titles", async () => {
    const app = createTestApp();

    const res = await invoke(app, {
      method: "POST",
      url: "/api/team-tracker/dev-1/items",
      body: {
        date: "2026-03-07",
        title: "   ",
      },
    });

    expect(res.status).toBe(400);
  });

  it("PATCH /api/team-tracker/items/:itemId rejects empty patch bodies", async () => {
    const item = await trackerService.addItem("dev-1", "2026-03-07", {
      title: "Investigate login regression",
    });
    const app = createTestApp();

    const res = await invoke(app, {
      method: "PATCH",
      url: `/api/team-tracker/items/${item.id}`,
      body: {},
    });

    expect(res.status).toBe(400);
  });

  it("PATCH /api/team-tracker/items/:itemId rejects title edits for linked delegated tasks", async () => {
    const managerItem = await managerDeskService.createItem("manager-1", {
      date: "2026-03-07",
      title: "Manager-linked task",
      assigneeDeveloperAccountId: "dev-1",
    });
    const linkedItem = (await trackerService.getItemDetailContextForManagerDeskItem(managerItem.id))
      ?.trackerItem;
    expect(linkedItem).toBeDefined();

    const app = createTestApp();
    const res = await invoke(app, {
      method: "PATCH",
      url: `/api/team-tracker/items/${linkedItem!.id}`,
      body: {
        title: "Manager should rename this",
      },
    });

    expect(res.status).toBe(409);
    expect(res.body?.error).toBe("Linked delegated tasks must be renamed from Manager Desk");
  });

  it("DELETE /api/team-tracker/items/:itemId rejects deletion of linked delegated tasks", async () => {
    const managerItem = await managerDeskService.createItem("manager-1", {
      date: "2026-03-07",
      title: "Manager-linked task",
      assigneeDeveloperAccountId: "dev-1",
    });
    const linkedItem = (await trackerService.getItemDetailContextForManagerDeskItem(managerItem.id))
      ?.trackerItem;
    expect(linkedItem).toBeDefined();

    const app = createTestApp();
    const res = await invoke(app, {
      method: "DELETE",
      url: `/api/team-tracker/items/${linkedItem!.id}`,
    });

    expect(res.status).toBe(409);
    expect(res.body?.error).toBe(
      "Linked delegated tasks cannot be deleted; mark them dropped instead"
    );
  });

  it("PATCH /api/team-tracker/items/:itemId returns 404 when the item is missing", async () => {
    const app = createTestApp();

    const res = await invoke(app, {
      method: "PATCH",
      url: "/api/team-tracker/items/99999",
      body: {
        state: "done",
      },
    });

    expect(res.status).toBe(404);
    expect(res.body?.error).toBe("Item not found");
  });

  it("POST /api/team-tracker/:accountId/items rejects Jira keys missing from synced issues", async () => {
    const app = createTestApp();

    const res = await invoke(app, {
      method: "POST",
      url: "/api/team-tracker/dev-1/items",
      body: {
        date: "2026-03-07",
        jiraKey: "AM-999",
        title: "Linked Jira task",
      },
    });

    expect(res.status).toBe(400);
    expect(res.body?.error).toBe(
      "Jira issue AM-999 is not available in synced issues"
    );
  });

  it("POST /api/team-tracker/:accountId/items allows multiple descriptive tasks for the same Jira issue", async () => {
    await seedIssue();
    await trackerService.addItem("dev-1", "2026-03-07", {
      jiraKey: "AM-123",
      title: "Reproduce the customer report",
    });

    const app = createTestApp();
    const res = await invoke(app, {
      method: "POST",
      url: "/api/team-tracker/dev-1/items",
      body: {
        date: "2026-03-07",
        jiraKey: "AM-123",
        title: "Patch the validation path",
      },
    });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      jiraKey: "AM-123",
      jiraSummary: "Linked Jira task",
      title: "Patch the validation path",
    });
  });

  it("GET /api/team-tracker/issues/:jiraKey/assignment returns active linked tasks", async () => {
    await seedIssue();
    const firstItem = await trackerService.addItem("dev-1", "2026-03-07", {
      jiraKey: "AM-123",
      title: "Reproduce the customer report",
    });
    const secondItem = await trackerService.addItem("dev-1", "2026-03-07", {
      jiraKey: "AM-123",
      title: "Patch the validation path",
    });

    const app = createTestApp();
    const res = await invoke(app, {
      method: "GET",
      url: "/api/team-tracker/issues/AM-123/assignment?date=2026-03-07",
    });

    expect(res.status).toBe(200);
    expect(res.body?.assignments).toEqual([
      {
        date: "2026-03-07",
        jiraKey: "AM-123",
        itemId: firstItem.id,
        title: "Reproduce the customer report",
        state: "planned",
        developer: {
          accountId: "dev-1",
          displayName: "Alice Smith",
          email: undefined,
          avatarUrl: undefined,
          isActive: true,
        },
      },
      {
        date: "2026-03-07",
        jiraKey: "AM-123",
        itemId: secondItem.id,
        title: "Patch the validation path",
        state: "planned",
        developer: {
          accountId: "dev-1",
          displayName: "Alice Smith",
          email: undefined,
          avatarUrl: undefined,
          isActive: true,
        },
      },
    ]);
  });

  it("GET /api/team-tracker/issues/:jiraKey/assignment returns an empty list when no assignment exists", async () => {
    await seedIssue("AM-35627");

    const app = createTestApp();
    const res = await invoke(app, {
      method: "GET",
      url: "/api/team-tracker/issues/AM-35627/assignment?date=2026-03-09",
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ assignments: [] });
  });

  it("GET /api/team-tracker/carry-forward-context finds the nearest earlier carryable day", async () => {
    await trackerService.addItem("dev-1", "2026-03-06", {
      title: "Friday tracker task",
    });
    await trackerService.addItem("dev-1", "2026-03-07", {
      title: "Saturday tracker task",
    });

    const app = createTestApp();
    const res = await invoke(app, {
      method: "GET",
      url: "/api/team-tracker/carry-forward-context?toDate=2026-03-09",
    });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      fromDate: "2026-03-07",
      toDate: "2026-03-09",
      carryable: 1,
      developers: [
        {
          developer: expect.objectContaining({
            accountId: "dev-1",
          }),
          items: [
            expect.objectContaining({
              title: "Saturday tracker task",
            }),
          ],
        },
      ],
    });
  });

  it("GET /api/team-tracker/carry-forward-preview reports remaining carryable items", async () => {
    await seedIssue();
    await trackerService.addItem("dev-1", "2026-03-06", {
      jiraKey: "AM-123",
      title: "Linked Jira task",
    });
    await managerDeskService.createItem("manager-1", {
      date: "2026-03-06",
      title: "Manager follow-up",
      status: "planned",
      assigneeDeveloperAccountId: "dev-1",
    });
    await trackerService.addItem("dev-1", "2026-03-06", {
      title: "Write release notes",
    });
    await trackerService.addItem("dev-1", "2026-03-07", {
      jiraKey: "AM-123",
      title: "Linked Jira task",
    });

    const app = createTestApp();
    const res = await invoke(app, {
      method: "GET",
      url: "/api/team-tracker/carry-forward-preview?fromDate=2026-03-06&toDate=2026-03-07",
    });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      carryable: 2,
      developers: [
        {
          developer: expect.objectContaining({
            accountId: "dev-1",
          }),
          items: [
            expect.objectContaining({
              title: "Manager follow-up",
              lifecycle: "manager_desk_linked",
            }),
            expect.objectContaining({
              title: "Write release notes",
              lifecycle: "tracker_only",
            }),
          ],
        },
      ],
    });
  });

  it("POST /api/team-tracker/carry-forward carries tracker-only and linked work together", async () => {
    await seedIssue();
    const sourceManagerItem = await managerDeskService.createItem("manager-1", {
      date: "2026-03-06",
      title: "Manager follow-up",
      status: "in_progress",
      assigneeDeveloperAccountId: "dev-1",
      links: [{ linkType: "issue", issueKey: "AM-123" }],
    });
    await trackerService.addItem("dev-1", "2026-03-06", {
      title: "Write release notes",
    });

    const app = createTestApp();
    const res = await invoke(app, {
      method: "POST",
      url: "/api/team-tracker/carry-forward",
      body: {
        fromDate: "2026-03-06",
        toDate: "2026-03-07",
      },
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ carried: 2 });

    const board = await trackerService.getBoard("2026-03-07");
    const devDay = board.developers.find(
      (developerDay) => developerDay.developer.accountId === "dev-1"
    )!;
    expect(devDay.plannedItems.map((item) => item.title)).toEqual([
      "Write release notes",
      "Manager follow-up",
    ]);

    const carriedManagerItems = await db
      .select()
      .from(managerDeskItems)
      .where(eq(managerDeskItems.sourceItemId, sourceManagerItem.id));
    expect(carriedManagerItems).toHaveLength(0);

    const targetDeskDay = await managerDeskService.getDay("manager-1", "2026-03-07");
    expect(targetDeskDay.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: sourceManagerItem.id,
          title: "Manager follow-up",
        }),
      ])
    );

    const linkedItem = devDay.plannedItems.find(
      (item) => item.title === "Manager follow-up"
    );
    expect(linkedItem?.lifecycle).toBe("manager_desk_linked");
    expect(linkedItem?.managerDeskItemId).toBe(sourceManagerItem.id);
  });

  it("POST /api/team-tracker/carry-forward moves the linked desk item's day and survives later desk edits", async () => {
    const sourceManagerItem = await managerDeskService.createItem("manager-1", {
      date: "2026-03-06",
      title: "Delegated review",
      status: "planned",
      assigneeDeveloperAccountId: "dev-1",
    });

    const app = createTestApp();
    const res = await invoke(app, {
      method: "POST",
      url: "/api/team-tracker/carry-forward",
      body: {
        fromDate: "2026-03-06",
        toDate: "2026-03-07",
      },
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ carried: 1 });

    const targetDeskDay = await managerDeskService.getDay("manager-1", "2026-03-07");
    const movedItem = targetDeskDay.items.find((item) => item.id === sourceManagerItem.id);
    expect(movedItem?.originDate).toBe("2026-03-07");

    // A later desk edit must not snap the delegated tracker item back to the old date.
    await managerDeskService.updateItem("manager-1", sourceManagerItem.id, {
      title: "Delegated review (renamed)",
    });

    const board = await trackerService.getBoard("2026-03-07");
    const devDay = board.developers.find(
      (developerDay) => developerDay.developer.accountId === "dev-1"
    )!;
    const linkedItem = devDay.plannedItems.find(
      (item) => item.managerDeskItemId === sourceManagerItem.id
    );
    expect(linkedItem?.title).toBe("Delegated review (renamed)");

    const oldBoard = await trackerService.getBoard("2026-03-06");
    const oldDevDay = oldBoard.developers.find(
      (developerDay) => developerDay.developer.accountId === "dev-1"
    );
    const snappedBack = (oldDevDay?.plannedItems ?? []).some(
      (item) => item.managerDeskItemId === sourceManagerItem.id
    ) || oldDevDay?.currentItem?.managerDeskItemId === sourceManagerItem.id;
    expect(snappedBack).toBe(false);
  });

  it("POST /api/team-tracker/carry-forward supports partial selection by tracker item id", async () => {
    await seedIssue();
    const trackerOnly = await trackerService.addItem("dev-1", "2026-03-06", {
      title: "Write release notes",
    });
    const sourceManagerItem = await managerDeskService.createItem("manager-1", {
      date: "2026-03-06",
      title: "Manager follow-up",
      status: "planned",
      assigneeDeveloperAccountId: "dev-1",
      links: [{ linkType: "issue", issueKey: "AM-123" }],
    });
    const preview = await trackerService.previewCarryForward(
      "2026-03-06",
      "2026-03-07"
    );
    const linkedPreviewItem = preview.developers[0]?.items.find(
      (item) => item.managerDeskItemId === sourceManagerItem.id
    );

    const app = createTestApp();
    const res = await invoke(app, {
      method: "POST",
      url: "/api/team-tracker/carry-forward",
      body: {
        fromDate: "2026-03-06",
        toDate: "2026-03-07",
        itemIds: [trackerOnly.id, linkedPreviewItem!.id],
      },
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ carried: 2 });

    const board = await trackerService.getBoard("2026-03-07");
    const devDay = board.developers.find(
      (developerDay) => developerDay.developer.accountId === "dev-1"
    )!;
    expect(devDay.plannedItems.map((item) => item.title)).toEqual([
      "Write release notes",
      "Manager follow-up",
    ]);
  });

  it("POST /api/team-tracker/carry-forward rejects same-day carry-forward", async () => {
    vi.useRealTimers();
    const app = createTestApp();

    const res = await invoke(app, {
      method: "POST",
      url: "/api/team-tracker/carry-forward",
      body: {
        fromDate: "2026-03-07",
        toDate: "2026-03-07",
      },
    });

    expect(res.status).toBe(400);
    expect(res.body?.error).toBe("toDate must be after fromDate");
  });

  describe("phase 1 task surface", () => {
    const managerViewer = { kind: "manager" as const, accountId: "manager-1" };

    async function enableTaskKeys() {
      await db.insert(configTable).values({ key: "tasks_phase1_enabled", value: "true" });
    }

    it("POST /:accountId/checkins records explicit taskKeys, ref rows, and checkin_ref events", async () => {
      await enableTaskKeys();
      const item = await trackerService.addItem("dev-1", "2026-03-07", {
        title: "Review queue",
      });
      expect(item.taskKey).toMatch(/^T-\d+$/);

      const app = createTestApp();
      const res = await invoke(app, {
        method: "POST",
        url: "/api/team-tracker/dev-1/checkins",
        body: {
          date: "2026-03-07",
          summary: "Discussed in standup",
          taskKeys: [item.taskKey],
        },
      });

      expect(res.status).toBe(201);
      expect(res.body.taskKeys).toEqual([item.taskKey]);

      const refs = await db
        .select()
        .from(checkinTaskRefs)
        .where(eq(checkinTaskRefs.checkinId, res.body.id));
      expect(refs.map((ref) => ref.taskKey)).toEqual([item.taskKey]);

      const events = await eventsService.list(item.taskKey!, managerViewer);
      expect(events.events.map((event) => event.type)).toEqual(["checkin_ref", "created"]);
      expect(events.events[0]?.meta).toMatchObject({
        checkInId: res.body.id,
        developerAccountId: "dev-1",
      });
    });

    it("POST /:accountId/checkins parses T-n tokens from the summary", async () => {
      await enableTaskKeys();
      const item = await trackerService.addItem("dev-1", "2026-03-07", {
        title: "Parsed reference",
      });
      const app = createTestApp();

      const res = await invoke(app, {
        method: "POST",
        url: "/api/team-tracker/dev-1/checkins",
        body: {
          date: "2026-03-07",
          summary: `Progress on ${item.taskKey} today`,
        },
      });

      expect(res.status).toBe(201);
      expect(res.body.taskKeys).toEqual([item.taskKey]);
    });

    it("POST /:accountId/checkins rejects unknown explicit task keys with 400", async () => {
      await enableTaskKeys();
      const app = createTestApp();

      const res = await invoke(app, {
        method: "POST",
        url: "/api/team-tracker/dev-1/checkins",
        body: {
          date: "2026-03-07",
          summary: "Standup",
          taskKeys: ["T-999"],
        },
      });

      expect(res.status).toBe(400);
      expect(res.body?.error).toBe("Unknown or unowned task key");
    });

    it("POST /:accountId/checkins silently drops unknown T-n tokens in the summary", async () => {
      await enableTaskKeys();
      const app = createTestApp();

      const res = await invoke(app, {
        method: "POST",
        url: "/api/team-tracker/dev-1/checkins",
        body: {
          date: "2026-03-07",
          summary: "Worked on T-999 today",
        },
      });

      expect(res.status).toBe(201);
      expect(res.body.taskKeys).toEqual([]);
    });

    it("GET /api/team-tracker decorates board items with latestEvent and ageDays", async () => {
      await enableTaskKeys();
      vi.setSystemTime(new Date("2026-03-07T08:00:00.000Z"));
      const item = await trackerService.addItem("dev-1", "2026-03-07", {
        title: "Decorated item",
      });

      const app = createTestApp();
      const res = await invoke(app, {
        method: "GET",
        url: "/api/team-tracker?date=2026-03-07",
      });

      expect(res.status).toBe(200);
      const day = res.body.developers.find(
        (developerDay: { developer: { accountId: string } }) =>
          developerDay.developer.accountId === "dev-1"
      );
      const boardItem = day.plannedItems.find(
        (candidate: { id: number }) => candidate.id === item.id
      );
      expect(boardItem.taskKey).toBe(item.taskKey);
      expect(boardItem.latestEvent).toMatchObject({ type: "created" });
      expect(boardItem.ageDays).toBe(0);
    });

    it("POST /items/:itemId/reassign keeps the same row id and task key", async () => {
      await enableTaskKeys();
      await db.insert(developers).values({
        accountId: "dev-3",
        displayName: "Carol Active",
        email: null,
        avatarUrl: null,
        isActive: 1,
      });
      const item = await trackerService.addItem("dev-1", "2026-03-07", {
        title: "Handoff candidate",
      });
      const app = createTestApp();

      const res = await invoke(app, {
        method: "POST",
        url: `/api/team-tracker/items/${item.id}/reassign`,
        body: {
          toAccountId: "dev-3",
          date: "2026-03-07",
          requestId: randomUUID(),
        },
      });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        id: item.id,
        taskKey: item.taskKey,
      });

      const board = await trackerService.getBoard("2026-03-07");
      const devDay = board.developers.find(
        (developerDay) => developerDay.developer.accountId === "dev-3"
      )!;
      expect(devDay.plannedItems.map((planned) => planned.id)).toContain(item.id);
    });

    it("POST /items/:itemId/reassign rejects delegated tasks with 409", async () => {
      await enableTaskKeys();
      const managerItem = await managerDeskService.createItem("manager-1", {
        date: "2026-03-07",
        title: "Delegated task",
        assigneeDeveloperAccountId: "dev-1",
      });
      const linkedItem = (
        await trackerService.getItemDetailContextForManagerDeskItem(managerItem.id)
      )?.trackerItem;
      expect(linkedItem?.taskKey).toBeDefined();

      const app = createTestApp();
      const res = await invoke(app, {
        method: "POST",
        url: `/api/team-tracker/items/${linkedItem!.id}/reassign`,
        body: {
          toAccountId: "dev-1",
          date: "2026-03-08",
          requestId: randomUUID(),
        },
      });

      expect(res.status).toBe(409);
      expect(res.body?.error).toBe("Reassign delegated tasks from Manager Desk");
    });

    it("POST /items/:itemId/reassign rejects closed tasks with 409", async () => {
      await enableTaskKeys();
      const item = await trackerService.addItem("dev-1", "2026-03-07", {
        title: "Finished work",
      });
      await trackerService.updateItem(item.id, { state: "done" });
      const app = createTestApp();

      const res = await invoke(app, {
        method: "POST",
        url: `/api/team-tracker/items/${item.id}/reassign`,
        body: {
          toAccountId: "dev-1",
          date: "2026-03-08",
          requestId: randomUUID(),
        },
      });

      expect(res.status).toBe(409);
      expect(res.body?.error).toBe("Reopen closed work before reassigning");
    });

    it("POST /items/:itemId/reassign rejects inactive targets", async () => {
      await enableTaskKeys();
      await db.insert(developerAvailabilityPeriods).values({
        developerAccountId: "dev-2",
        startDate: "2026-03-07",
        note: "Out today",
        createdAt: "2026-03-07T08:00:00.000Z",
        updatedAt: "2026-03-07T08:00:00.000Z",
      });
      const item = await trackerService.addItem("dev-1", "2026-03-07", {
        title: "Handoff to inactive dev",
      });
      const app = createTestApp();

      const res = await invoke(app, {
        method: "POST",
        url: `/api/team-tracker/items/${item.id}/reassign`,
        body: {
          toAccountId: "dev-2",
          date: "2026-03-07",
          requestId: randomUUID(),
        },
      });

      expect(res.status).toBe(409);
      expect(res.body?.error).toContain("inactive");
    });

    it("records created_by provenance for manager, developer, and copilot creation paths", async () => {
      await enableTaskKeys();
      const app = createTestApp();

      const viaRoute = await invoke(app, {
        method: "POST",
        url: "/api/team-tracker/dev-1/items",
        body: { date: "2026-03-07", title: "Manager-added item" },
      });
      expect(viaRoute.status).toBe(201);
      expect(viaRoute.body.createdBy).toEqual({ type: "manager", id: "manager-1" });

      const viaDeveloper = await trackerService.addItem("dev-1", "2026-03-07", {
        title: "Developer-added item",
        source: "my_day",
        actor: { type: "developer", accountId: "dev-1" },
      });
      expect(viaDeveloper.createdBy).toEqual({ type: "developer", id: "dev-1" });

      const viaCopilot = await trackerService.addItem("dev-1", "2026-03-07", {
        title: "Copilot-added item",
        source: "copilot",
        actor: { type: "copilot", accountId: "manager-1" },
      });
      expect(viaCopilot.createdBy).toEqual({ type: "copilot", id: "manager-1" });
    });

    it("POST /:accountId/status-update with taskKey emits blocker raised and cleared events", async () => {
      await enableTaskKeys();
      const item = await trackerService.addItem("dev-1", "2026-03-07", {
        title: "Blocked candidate",
      });
      const app = createTestApp();

      const blocked = await invoke(app, {
        method: "POST",
        url: "/api/team-tracker/dev-1/status-update",
        body: {
          date: "2026-03-07",
          status: "blocked",
          rationale: "Waiting on platform review",
          taskKey: item.taskKey,
        },
      });
      expect(blocked.status).toBe(201);

      let events = await eventsService.list(item.taskKey!, managerViewer);
      expect(events.events.map((event) => event.type)).toEqual(
        expect.arrayContaining(["blocker", "checkin_ref", "created"])
      );
      const raised = events.events.find((event) => event.type === "blocker");
      expect(raised?.meta).toMatchObject({ action: "raised", developerDayStatus: "blocked" });
      expect(raised?.body).toBe("Waiting on platform review");

      const cleared = await invoke(app, {
        method: "POST",
        url: "/api/team-tracker/dev-1/status-update",
        body: {
          date: "2026-03-07",
          status: "on_track",
          taskKey: item.taskKey,
        },
      });
      expect(cleared.status).toBe(201);

      events = await eventsService.list(item.taskKey!, managerViewer);
      const clearEvent = events.events.find(
        (event) => event.type === "blocker" && event.meta && typeof event.meta === "object" && "action" in event.meta && event.meta.action === "cleared"
      );
      expect(clearEvent).toBeDefined();
      expect(clearEvent?.body).toBeNull();
    });

    it("POST /:accountId/status-update rejects task keys owned by another developer", async () => {
      await enableTaskKeys();
      await db.insert(developers).values({
        accountId: "dev-3",
        displayName: "Carol Active",
        email: null,
        avatarUrl: null,
        isActive: 1,
      });
      const item = await trackerService.addItem("dev-3", "2026-03-07", {
        title: "Not Alice's task",
      });
      const app = createTestApp();

      const res = await invoke(app, {
        method: "POST",
        url: "/api/team-tracker/dev-1/status-update",
        body: {
          date: "2026-03-07",
          status: "waiting",
          rationale: "Waiting on them",
          taskKey: item.taskKey,
        },
      });

      expect(res.status).toBe(400);
      expect(res.body?.error).toBe("Task is not owned by this developer");
    });
  });
});
