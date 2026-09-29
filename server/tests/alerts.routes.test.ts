import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createApp } from "../src/app";
import { db, resetDatabase } from "./helpers/db";
import { invoke } from "./helpers/http";
import { serializeSessionCookie, AuthService } from "../src/services/auth.service";
import { AlertService } from "../src/services/alert.service";
import { issues } from "../src/db/schema";
import { WorkloadService } from "../src/services/workload.service";

function createTestApp(authService: AuthService, alertService: AlertService) {
  return createApp({
    issueService: {} as any,
    workloadService: {} as any,
    alertService,
    automationService: {} as any,
    syncEngine: {
      getLastSyncLog: async () => undefined,
      getRuntimeStatus: () => ({ status: "idle" }),
    } as any,
    backupService: {} as any,
    tagService: {} as any,
    teamTrackerService: {} as any,
    authService,
    myDayService: {} as any,
    managerDeskService: {} as any,
    todayService: {} as any,
    searchService: {} as any,
    workSavedViewsService: {} as any,
  });
}

async function seedOverdueIssue(jiraKey = "PROJ-101") {
  await db.insert(issues).values({
    jiraKey,
    summary: "Legacy overdue issue",
    priorityName: "High",
    priorityId: "1",
    statusName: "In Progress",
    statusCategory: "indeterminate",
    assigneeId: null,
    assigneeName: null,
    teamScopeState: "in_team",
    syncScopeState: "active",
    reporterName: null,
    component: null,
    labels: null,
    dueDate: "2020-01-01",
    developmentDueDate: null,
    flagged: 0,
    createdAt: "2020-01-01T00:00:00.000Z",
    updatedAt: "2030-01-02T00:00:00.000Z",
    syncedAt: "2030-01-02T00:00:00.000Z",
    lastSeenInScopedSyncAt: null,
    lastReconciledAt: null,
    scopeChangedAt: null,
    analysisNotes: null,
    excluded: 0,
    aspenSeverity: null,
  });
}

async function createManagerSession(authService: AuthService, username: string, workspaceId?: string) {
  await authService.createUser({
    username,
    displayName: username,
    password: "secret123",
    role: "manager",
    workspaceId,
  });

  return authService.authenticate(username, "secret123");
}

describe("alerts routes", () => {
  const authService = new AuthService();
  const alertService = new AlertService(
    {
      getIdleDevelopers: async () => [],
    } as unknown as WorkloadService,
    {
      getStaleThresholdHours: async () => 48,
      getJiraSyncScopeMode: async () => "team_assignees",
      getTeamMode: async () => "collab",
    } as any,
  );

  beforeEach(async () => {
    await resetDatabase();
  });

  it("stores dismissals per manager and keeps other managers unaffected", async () => {
    await seedOverdueIssue();
    const app = createTestApp(authService, alertService);
    const managerOne = await createManagerSession(authService, "manager-one");
    const managerTwo = await createManagerSession(authService, "manager-two", managerOne.user.workspaceId);

    const initial = await invoke(app, {
      method: "GET",
      url: "/api/alerts",
      headers: { cookie: serializeSessionCookie(managerOne.sessionId) },
    });

    expect(initial.status).toBe(200);
    expect(initial.body.alerts).toHaveLength(1);
    expect(initial.body.alerts[0].id).toBe("overdue:PROJ-101");

    const dismissResponse = await invoke(app, {
      method: "POST",
      url: "/api/alerts/dismiss",
      body: { alertIds: ["overdue:PROJ-101"] },
      headers: { cookie: serializeSessionCookie(managerOne.sessionId) },
    });

    expect(dismissResponse.status).toBe(200);
    expect(dismissResponse.body).toEqual({ success: true, dismissedIds: ["overdue:PROJ-101"] });

    const managerOneAfterDismiss = await invoke(app, {
      method: "GET",
      url: "/api/alerts",
      headers: { cookie: serializeSessionCookie(managerOne.sessionId) },
    });
    const managerTwoAfterDismiss = await invoke(app, {
      method: "GET",
      url: "/api/alerts",
      headers: { cookie: serializeSessionCookie(managerTwo.sessionId) },
    });

    expect(managerOneAfterDismiss.body.alerts).toEqual([]);
    expect(managerTwoAfterDismiss.body.alerts).toHaveLength(1);
    expect(managerTwoAfterDismiss.body.alerts[0].id).toBe("overdue:PROJ-101");
  });

  it("shows a dismissed alert again only after the condition resolves and later reappears", async () => {
    await seedOverdueIssue();
    const app = createTestApp(authService, alertService);
    const manager = await createManagerSession(authService, "manager");

    await invoke(app, {
      method: "POST",
      url: "/api/alerts/dismiss",
      body: { alertIds: ["overdue:PROJ-101"] },
      headers: { cookie: serializeSessionCookie(manager.sessionId) },
    });

    const hiddenWhileActive = await invoke(app, {
      method: "GET",
      url: "/api/alerts",
      headers: { cookie: serializeSessionCookie(manager.sessionId) },
    });

    expect(hiddenWhileActive.body.alerts).toEqual([]);

    await db
      .update(issues)
      .set({ statusCategory: "done" })
      .where(eq(issues.jiraKey, "PROJ-101"));

    const resolvedState = await invoke(app, {
      method: "GET",
      url: "/api/alerts",
      headers: { cookie: serializeSessionCookie(manager.sessionId) },
    });

    expect(resolvedState.body.alerts).toEqual([]);

    await db
      .update(issues)
      .set({ statusCategory: "indeterminate" })
      .where(eq(issues.jiraKey, "PROJ-101"));

    const resurfaced = await invoke(app, {
      method: "GET",
      url: "/api/alerts",
      headers: { cookie: serializeSessionCookie(manager.sessionId) },
    });

    expect(resurfaced.body.alerts).toHaveLength(1);
    expect(resurfaced.body.alerts[0].id).toBe("overdue:PROJ-101");
  });
});
