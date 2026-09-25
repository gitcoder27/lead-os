import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createApp } from "../src/app";
import { db, resetDatabase } from "./helpers/db";
import { invoke } from "./helpers/http";
import { checkinTaskRefs, configTable, developers } from "../src/db/schema";
import { AuthService, serializeSessionCookie } from "../src/services/auth.service";
import { IssueService } from "../src/services/issue.service";
import { ManagerDeskService } from "../src/services/manager-desk.service";
import { TaskEventsService } from "../src/services/task-events.service";
import { TeamTrackerService } from "../src/services/team-tracker.service";
import { TodayService } from "../src/services/today.service";

const authService = new AuthService();
const trackerService = new TeamTrackerService();
const managerDeskService = new ManagerDeskService(trackerService);
const eventsService = new TaskEventsService();
const issueService = new IssueService(undefined, undefined, trackerService);
const todayService = new TodayService(issueService, trackerService, managerDeskService, {
  getLastSyncLog: async () => undefined,
  getRuntimeStatus: () => ({ status: "idle" }),
});

function createTestApp() {
  return createApp({
    issueService,
    workloadService: {} as any,
    alertService: {} as any,
    automationService: {} as any,
    syncEngine: {
      getLastSyncLog: async () => undefined,
      getRuntimeStatus: () => ({ status: "idle" }),
    } as any,
    backupService: {} as any,
    tagService: {} as any,
    teamTrackerService: trackerService,
    authService,
    myDayService: {} as any,
    managerDeskService,
    todayService,
    searchService: {} as any,
    workSavedViewsService: {} as any,
  });
}

async function managerSession() {
  const user = await authService.createUser({
    username: "manager",
    displayName: "Manager",
    password: "secret123",
    role: "manager",
  });
  const session = await authService.authenticate("manager", "secret123");
  return {
    cookie: serializeSessionCookie(session.sessionId),
    user,
  };
}

async function managerCookie() {
  return (await managerSession()).cookie;
}

describe("today routes", () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-08T02:30:00.000Z"));
    await resetDatabase();
    todayService.clearTodayCache();
    await db.insert(developers).values({
      accountId: "dev-1",
      displayName: "Alice Smith",
      email: "alice@example.com",
      avatarUrl: null,
      isActive: 1,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("GET /api/today returns a manager-only read model", async () => {
    const cookie = await managerCookie();
    const response = await invoke(createTestApp(), {
      method: "GET",
      url: "/api/today?date=2026-03-08",
      headers: { cookie },
    });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      date: "2026-03-08",
      rhythm: { stage: "morning_plan" },
    });
    expect(response.body.summary).toHaveLength(6);
    expect(response.body.actionItems[0]).toMatchObject({
      target: expect.objectContaining({ view: "team" }),
    });
    expect(response.headers["x-today-cache"]).toBe("miss");
    expect(response.headers["server-timing"]).toContain("today-team;dur=");
  });

  it("rejects invalid dates", async () => {
    const cookie = await managerCookie();
    const response = await invoke(createTestApp(), {
      method: "GET",
      url: "/api/today?date=03-08-2026",
      headers: { cookie },
    });

    expect(response.status).toBe(400);
    expect(response.body?.error).toContain("date must be YYYY-MM-DD");
  });

  it("GET /api/manager-actions returns the header action queue without calm fallback rows", async () => {
    const cookie = await managerCookie();
    const response = await invoke(createTestApp(), {
      method: "GET",
      url: "/api/manager-actions?date=2026-03-08&surface=header&limit=3",
      headers: { cookie },
    });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      date: "2026-03-08",
      surface: "header",
    });
    expect(response.body.actions.length).toBeGreaterThan(0);
    expect(response.body.actions.every((item: { type: string }) => item.type !== "calm")).toBe(true);
    expect(response.body.totalCount).toBeGreaterThanOrEqual(response.body.actions.length);
  });

  it("POST /api/manager-actions/commands executes Manager Desk commands server-side", async () => {
    const { cookie, user } = await managerSession();
    const item = await managerDeskService.createItem(
      user.accountId,
      {
        date: "2026-03-08",
        title: "Follow up with QA",
        kind: "action",
        category: "follow_up",
        status: "planned",
        priority: "medium",
        followUpAt: "2026-03-07T09:00:00.000Z",
      },
      user.workspaceId,
    );

    const response = await invoke(createTestApp(), {
      method: "POST",
      url: "/api/manager-actions/commands",
      headers: { cookie },
      body: {
        date: "2026-03-08",
        command: {
          kind: "mark_done",
          label: "Done",
          target: {
            type: "follow_up",
            view: "follow-ups",
            managerDeskItemId: item.id,
            date: "2026-03-08",
          },
          confirm: true,
        },
      },
    });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      command: "mark_done",
      target: { managerDeskItemId: item.id },
      result: { status: "done" },
    });
  });

  it("POST /api/manager-actions/commands add_check_in writes checkin_task_refs and checkin_ref events", async () => {
    await db.insert(configTable).values({ key: "tasks_phase1_enabled", value: "true" });
    const { cookie, user } = await managerSession();
    const item = await trackerService.addItem("dev-1", "2026-03-08", {
      title: "Standup task",
    });
    expect(item.taskKey).toMatch(/^T-\d+$/);

    const response = await invoke(createTestApp(), {
      method: "POST",
      url: "/api/manager-actions/commands",
      headers: { cookie },
      body: {
        date: "2026-03-08",
        summary: "Walked through the queue",
        taskKeys: [item.taskKey],
        command: {
          kind: "add_check_in",
          label: "Add check-in",
          target: {
            type: "developer",
            view: "team",
            developerAccountId: "dev-1",
            date: "2026-03-08",
          },
          confirm: true,
        },
      },
    });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      command: "add_check_in",
      result: { taskKeys: [item.taskKey] },
    });

    const refs = await db
      .select()
      .from(checkinTaskRefs)
      .where(eq(checkinTaskRefs.taskKey, item.taskKey!));
    expect(refs).toHaveLength(1);

    const events = await eventsService.list(item.taskKey!, {
      kind: "manager",
      accountId: user.accountId,
    });
    const checkinRef = events.events.find((event) => event.type === "checkin_ref");
    expect(checkinRef).toBeDefined();
    expect(checkinRef?.meta).toMatchObject({
      checkInId: response.body.result.id,
      date: "2026-03-08",
      developerAccountId: "dev-1",
    });
  });
});
