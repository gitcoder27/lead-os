import { beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { createApp } from "../src/app";
import {
  appUsers,
  configTable,
  developers,
  issues,
  localTags,
} from "../src/db/schema";
import { AuthService, serializeSessionCookie } from "../src/services/auth.service";
import { AlertService } from "../src/services/alert.service";
import { AutomationService } from "../src/services/automation.service";
import { IssueService } from "../src/services/issue.service";
import { ManagerDeskService } from "../src/services/manager-desk.service";
import { MyDayService } from "../src/services/my-day.service";
import { SettingsService } from "../src/services/settings.service";
import { TagService } from "../src/services/tag.service";
import { TeamTrackerService } from "../src/services/team-tracker.service";
import { TodayService } from "../src/services/today.service";
import { SearchService } from "../src/services/search.service";
import { WorkSavedViewsService } from "../src/services/work-saved-views.service";
import { WorkloadService } from "../src/services/workload.service";
import { db, resetDatabase } from "./helpers/db";
import { invoke } from "./helpers/http";

function buildApp(authService: AuthService, trackerService: TeamTrackerService, managerDeskService: ManagerDeskService) {
  const settingsService = new SettingsService();
  const workloadService = new WorkloadService();
  const issueService = new IssueService(undefined, settingsService, trackerService);
  const alertService = new AlertService(workloadService, settingsService);
  const syncEngine = {
    getLastSyncLog: async () => undefined,
    getRuntimeStatus: () => ({ status: "idle" }),
    start: async () => undefined,
    syncNow: async () => ({ status: "success", issuesSynced: 0, startedAt: "", completedAt: "" }),
  } as any;

  return createApp({
    issueService,
    workloadService,
    alertService,
    automationService: new AutomationService(workloadService),
    syncEngine,
    backupService: {
      start: async () => undefined,
      createPreResetBackup: async () => null,
    } as any,
    tagService: new TagService(),
    teamTrackerService: trackerService,
    authService,
    myDayService: new MyDayService(trackerService),
    managerDeskService,
    todayService: new TodayService(issueService, trackerService, managerDeskService, syncEngine),
    searchService: new SearchService(),
    workSavedViewsService: new WorkSavedViewsService(),
  });
}

async function seedDeveloper(workspaceId: string, accountId: string, displayName: string) {
  await db.insert(developers).values({
    workspaceId,
    accountId,
    displayName,
    email: `${displayName.toLowerCase().replace(/\s+/g, ".")}@example.com`,
    avatarUrl: null,
    source: "jira",
    jiraAccountId: accountId,
    isActive: 1,
  });
}

async function seedIssue(workspaceId: string, summary: string, dueDate: string) {
  await db.insert(issues).values({
    workspaceId,
    jiraKey: "AM-1",
    summary,
    description: null,
    aspenSeverity: null,
    priorityName: "High",
    priorityId: "1",
    statusName: "In Progress",
    statusCategory: "indeterminate",
    assigneeId: "dev-1",
    assigneeName: summary.includes("A") ? "Alice A" : "Alice B",
    teamScopeState: "in_team",
    syncScopeState: "active",
    reporterName: "Lead",
    component: null,
    labels: JSON.stringify([]),
    dueDate,
    developmentDueDate: null,
    flagged: 0,
    createdAt: "2026-03-07T08:00:00.000Z",
    updatedAt: "2030-03-07T08:00:00.000Z",
    syncedAt: "2030-03-07T08:00:00.000Z",
    lastSeenInScopedSyncAt: "2030-03-07T08:00:00.000Z",
    lastReconciledAt: "2030-03-07T08:00:00.000Z",
    scopeChangedAt: null,
    analysisNotes: null,
    excluded: 0,
  });
}

async function cookieFor(authService: AuthService, username: string) {
  const session = await authService.authenticate(username, "secret123");
  return serializeSessionCookie(session.sessionId, authService.sessionMaxAgeSeconds);
}

describe("multi-workspace API isolation", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("keeps manager, developer, Jira, tracker, desk, tag, alert, user, My Day, and reset data scoped by workspace", async () => {
    const authService = new AuthService();
    const trackerService = new TeamTrackerService();
    const managerDeskService = new ManagerDeskService(trackerService);
    const managerA = await authService.createUser({
      username: "manager-a",
      displayName: "Manager A",
      password: "secret123",
      role: "manager",
    });
    const managerB = await authService.createUser({
      username: "manager-b",
      displayName: "Manager B",
      password: "secret123",
      role: "manager",
    });

    await seedDeveloper(managerA.workspaceId, "dev-1", "Alice A");
    await seedDeveloper(managerB.workspaceId, "dev-1", "Alice B");
    await seedIssue(managerA.workspaceId, "Workspace A issue", "2027-01-01");
    await seedIssue(managerB.workspaceId, "Workspace B issue", "2020-01-01");
    await db.insert(configTable).values([
      { workspaceId: managerA.workspaceId, key: "jira_project_key", value: "AKEY" },
      { workspaceId: managerB.workspaceId, key: "jira_project_key", value: "BKEY" },
    ]);
    const [tagA] = await db.insert(localTags).values({ workspaceId: managerA.workspaceId, name: "A Tag", color: "#6366f1" }).returning();
    const [tagB] = await db.insert(localTags).values({ workspaceId: managerB.workspaceId, name: "B Tag", color: "#10b981" }).returning();
    await authService.createUser({
      username: "dev-a",
      displayName: "Alice A",
      password: "secret123",
      role: "developer",
      developerAccountId: "dev-1",
      workspaceId: managerA.workspaceId,
    });
    await authService.createUser({
      username: "dev-b",
      displayName: "Alice B",
      password: "secret123",
      role: "developer",
      developerAccountId: "dev-1",
      workspaceId: managerB.workspaceId,
    });

    const app = buildApp(authService, trackerService, managerDeskService);
    const managerACookie = await cookieFor(authService, "manager-a");
    const managerBCookie = await cookieFor(authService, "manager-b");
    const devACookie = await cookieFor(authService, "dev-a");

    const bTrackerItem = await trackerService.addItem("dev-1", "2026-03-08", { title: "B tracker item" }, managerB.workspaceId);
    const bDeskItem = await managerDeskService.createItem(
      managerB.accountId,
      {
        date: "2026-03-08",
        title: "B desk item",
        kind: "action",
        category: "planning",
      },
      managerB.workspaceId
    );

    const issuesRes = await invoke(app, { method: "GET", url: "/api/issues", headers: { cookie: managerACookie } });
    expect(issuesRes.status).toBe(200);
    expect(issuesRes.body.issues.map((issue: { summary: string }) => issue.summary)).toEqual(["Workspace A issue"]);

    const updateIssueRes = await invoke(app, {
      method: "PATCH",
      url: "/api/issues/AM-1",
      headers: { cookie: managerACookie },
      body: { analysisNotes: "A-only note" },
    });
    expect(updateIssueRes.status).toBe(200);
    const [bIssue] = await db
      .select({ analysisNotes: issues.analysisNotes })
      .from(issues)
      .where(and(eq(issues.workspaceId, managerB.workspaceId), eq(issues.jiraKey, "AM-1")));
    expect(bIssue?.analysisNotes).toBeNull();

    const teamRes = await invoke(app, { method: "GET", url: "/api/team/developers", headers: { cookie: managerACookie } });
    expect(teamRes.status).toBe(200);
    expect(teamRes.body.developers.map((developer: { displayName: string }) => developer.displayName)).toEqual(["Alice A"]);

    const tagsRes = await invoke(app, { method: "GET", url: "/api/tags", headers: { cookie: managerACookie } });
    expect(tagsRes.status).toBe(200);
    expect(tagsRes.body.tags.map((tag: { name: string }) => tag.name)).toEqual(["A Tag"]);

    const crossTagRes = await invoke(app, {
      method: "PUT",
      url: "/api/tags/issue/AM-1",
      headers: { cookie: managerACookie },
      body: { tagIds: [tagB!.id] },
    });
    expect(crossTagRes.status).toBe(400);
    expect(crossTagRes.body.error).toContain("do not belong");
    expect(tagA?.id).toBeDefined();

    const trackerRes = await invoke(app, { method: "GET", url: "/api/team-tracker?date=2026-03-08", headers: { cookie: managerACookie } });
    expect(trackerRes.status).toBe(200);
    expect(trackerRes.body.developers.map((day: { developer: { displayName: string } }) => day.developer.displayName)).toEqual(["Alice A"]);

    const crossTrackerRes = await invoke(app, {
      method: "PATCH",
      url: `/api/team-tracker/items/${bTrackerItem.id}`,
      headers: { cookie: managerACookie },
      body: { title: "A should not edit B" },
    });
    expect(crossTrackerRes.status).toBe(404);

    const deskRes = await invoke(app, { method: "GET", url: "/api/manager-desk?date=2026-03-08", headers: { cookie: managerACookie } });
    expect(deskRes.status).toBe(200);
    expect(deskRes.body.items).toEqual([]);

    const crossDeskRes = await invoke(app, {
      method: "PATCH",
      url: `/api/manager-desk/items/${bDeskItem.id}`,
      headers: { cookie: managerACookie },
      body: { title: "A should not edit B desk" },
    });
    expect(crossDeskRes.status).toBe(404);

    const alertsRes = await invoke(app, { method: "GET", url: "/api/alerts", headers: { cookie: managerACookie } });
    expect(alertsRes.status).toBe(200);
    expect(alertsRes.body.alerts.some((alert: { message: string }) => alert.message.includes("Workspace B issue"))).toBe(false);
    expect(alertsRes.body.alerts.some((alert: { developerName?: string }) => alert.developerName === "Alice B")).toBe(false);

    const usersRes = await invoke(app, { method: "GET", url: "/api/auth/users", headers: { cookie: managerACookie } });
    expect(usersRes.status).toBe(200);
    expect(usersRes.body.users.map((user: { username: string }) => user.username).sort()).toEqual(["dev-a", "manager-a"]);

    const configRes = await invoke(app, { method: "GET", url: "/api/config", headers: { cookie: managerACookie } });
    expect(configRes.status).toBe(200);
    expect(configRes.body.jiraProjectKey).toBe("AKEY");

    const myDayRes = await invoke(app, { method: "GET", url: "/api/my-day?date=2026-03-08", headers: { cookie: devACookie } });
    expect(myDayRes.status).toBe(200);
    expect(myDayRes.body.plannedItems).toEqual([]);

    const crossMyDayRes = await invoke(app, {
      method: "PATCH",
      url: `/api/my-day/items/${bTrackerItem.id}`,
      headers: { cookie: devACookie },
      body: { date: "2026-03-08", title: "A developer should not edit B" },
    });
    expect(crossMyDayRes.status).toBe(404);

    const bBeforeReset = await db.select().from(issues).where(eq(issues.workspaceId, managerB.workspaceId));
    expect(bBeforeReset).toHaveLength(1);

    const resetRes = await invoke(app, { method: "POST", url: "/api/config/reset", headers: { cookie: managerACookie } });
    expect(resetRes.status).toBe(200);

    const bAfterReset = await db.select().from(issues).where(eq(issues.workspaceId, managerB.workspaceId));
    const bConfigAfterReset = await db
      .select()
      .from(configTable)
      .where(and(eq(configTable.workspaceId, managerB.workspaceId), eq(configTable.key, "jira_project_key")));
    const usersAfterReset = await db.select().from(appUsers).where(eq(appUsers.workspaceId, managerB.workspaceId));
    expect(bAfterReset).toHaveLength(1);
    expect(bConfigAfterReset[0]?.value).toBe("BKEY");
    expect(usersAfterReset.map((user) => user.username).sort()).toEqual(["dev-b", "manager-b"]);

    const bIssuesRes = await invoke(app, { method: "GET", url: "/api/issues", headers: { cookie: managerBCookie } });
    expect(bIssuesRes.status).toBe(200);
    expect(bIssuesRes.body.issues.map((issue: { summary: string }) => issue.summary)).toEqual(["Workspace B issue"]);
  });

  it("scopes task keys and events by workspace", async () => {
    const authService = new AuthService();
    const trackerService = new TeamTrackerService();
    const managerA = await authService.createUser({
      username: "manager-a",
      displayName: "Manager A",
      password: "secret123",
      role: "manager",
    });
    const managerB = await authService.createUser({
      username: "manager-b",
      displayName: "Manager B",
      password: "secret123",
      role: "manager",
    });
    await seedDeveloper(managerA.workspaceId, "dev-1", "Alice A");
    await seedDeveloper(managerB.workspaceId, "dev-1", "Alice B");
    await db.insert(configTable).values([
      { workspaceId: managerA.workspaceId, key: "tasks_phase1_enabled", value: "true" },
      { workspaceId: managerB.workspaceId, key: "tasks_phase1_enabled", value: "true" },
    ]);

    const itemA = await trackerService.addItem("dev-1", "2026-09-24", { title: "Workspace A task" }, managerA.workspaceId);
    const itemB = await trackerService.addItem("dev-1", "2026-09-24", { title: "Workspace B task" }, managerB.workspaceId);
    expect(itemA.taskKey).toBe("T-1");
    expect(itemB.taskKey).toBe("T-1");

    const app = buildApp(authService, trackerService, new ManagerDeskService(trackerService));
    const managerACookie = await cookieFor(authService, "manager-a");
    const managerBCookie = await cookieFor(authService, "manager-b");

    const resA = await invoke(app, { method: "GET", url: "/api/tasks/T-1", headers: { cookie: managerACookie } });
    expect(resA.status).toBe(200);
    expect(resA.body.title).toBe("Workspace A task");
    const resB = await invoke(app, { method: "GET", url: "/api/tasks/T-1", headers: { cookie: managerBCookie } });
    expect(resB.status).toBe(200);
    expect(resB.body.title).toBe("Workspace B task");

    const eventsB = await invoke(app, { method: "GET", url: "/api/tasks/T-1/events", headers: { cookie: managerBCookie } });
    expect(eventsB.status).toBe(200);
    expect(eventsB.body.events.map((event: { type: string }) => event.type)).toEqual(["created"]);
    expect(eventsB.body.events[0].meta.title).toBe("Workspace B task");
  });
});
