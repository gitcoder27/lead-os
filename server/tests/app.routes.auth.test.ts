import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { serializeSessionCookie } from "../src/services/auth.service";
import { AuthService } from "../src/services/auth.service";
import { developers, workspaces } from "../src/db/schema";
import { db, resetDatabase } from "./helpers/db";
import { invoke } from "./helpers/http";

const managerOnlyCases = [
  { method: "GET", url: "/api/issues" },
  { method: "GET", url: "/api/overview" },
  { method: "GET", url: "/api/team/workload" },
  { method: "GET", url: "/api/alerts" },
  { method: "POST", url: "/api/alerts/dismiss", body: { alertIds: ["overdue:PROJ-1"] } },
  { method: "GET", url: "/api/suggestions/duedate/High" },
  { method: "GET", url: "/api/sync/status" },
  { method: "GET", url: "/api/config" },
  { method: "GET", url: "/api/tags" },
  { method: "GET", url: "/api/team-tracker?date=2026-03-08" },
  { method: "GET", url: "/api/team-tracker/standup/feed?accountId=dev-1" },
  { method: "GET", url: "/api/team-tracker/standup/session/latest" },
  { method: "POST", url: "/api/team-tracker/standup/session", body: {} },
  { method: "POST", url: "/api/team-tracker/standup/reviews", body: {} },
  { method: "GET", url: "/api/today?date=2026-03-08" },
  { method: "GET", url: "/api/manager-actions?date=2026-03-08" },
  {
    method: "POST",
    url: "/api/manager-actions/commands",
    body: {
      date: "2026-03-08",
      command: {
        kind: "open",
        label: "Open",
        target: { type: "view", view: "team", date: "2026-03-08" },
      },
    },
  },
  { method: "GET", url: "/api/manager-desk?date=2026-03-08" },
  // docs/56 P6-01: backups belong to the manager, not to an admin role nobody has.
  { method: "GET", url: "/api/backups" },
  { method: "POST", url: "/api/backups/run" },
  { method: "GET", url: "/api/backups/dashboard.backup-20260308-000000000-manual.db/download" },
] as const;

function createTestApp(authService: AuthService) {
  return createApp({
    issueService: {} as any,
    workloadService: {} as any,
    alertService: {} as any,
    automationService: {} as any,
    syncEngine: {
      getLastSyncLog: async () => undefined,
      getRuntimeStatus: () => ({ status: "idle" }),
    } as any,
    backupService: {
      listBackups: async () => [],
      getRuntimeStatus: async () => ({
        enabled: true,
        running: false,
        directory: "/tmp/lead-os-test-backups",
      }),
      createRequestedBackup: async (reason = "manual") => ({
        name: "lead-os-manual-test.db",
        path: "/tmp/lead-os-test-backups/lead-os-manual-test.db",
        sizeBytes: 1024,
        createdAt: "2026-03-08T00:00:00.000Z",
        reason,
      }),
    } as any,
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

async function seedDeveloper(accountId = "dev-1") {
  await db.insert(developers).values({
    accountId,
    displayName: "Developer",
    email: `${accountId}@example.com`,
    avatarUrl: null,
    isActive: 1,
  });
}

describe("app route authorization", () => {
  const authService = new AuthService();

  beforeEach(async () => {
    await resetDatabase();
  });

  it.each(managerOnlyCases)("$method $url rejects unauthenticated access", async ({ method, url, body }) => {
    const app = createTestApp(authService);
    const response = await invoke(app, { method, url, body });

    expect(response.status).toBe(401);
    expect(response.body?.error).toBe("Authentication required");
  });

  it.each(managerOnlyCases)("$method $url rejects developer access", async ({ method, url, body }) => {
    await authService.createUser({
      username: "manager",
      displayName: "Manager",
      password: "secret123",
      role: "manager",
    });
    await seedDeveloper("dev-1");
    const developer = await authService.createUser({
      username: "dev",
      displayName: "Developer",
      password: "secret123",
      role: "developer",
      developerAccountId: "dev-1",
    });
    const session = await authService.authenticate(developer.username, "secret123");
    const app = createTestApp(authService);

    const response = await invoke(app, {
      method,
      url,
      body,
      headers: {
        cookie: serializeSessionCookie(session.sessionId),
      },
    });

    expect(response.status).toBe(403);
    expect(response.body?.error).toBe("Manager access required");
  });

  it.each(managerOnlyCases)("$method $url rejects admin access", async ({ method, url, body }) => {
    await authService.createUser({
      username: "manager",
      displayName: "Manager",
      password: "secret123",
      role: "manager",
    });
    await authService.createUser({
      username: "admin",
      displayName: "Admin",
      password: "secret123",
      role: "admin",
    });
    const session = await authService.authenticate("admin", "secret123");
    const app = createTestApp(authService);

    const response = await invoke(app, {
      method,
      url,
      body,
      headers: {
        cookie: serializeSessionCookie(session.sessionId),
      },
    });

    expect(response.status).toBe(403);
    expect(response.body?.error).toBe("Manager access required");
  });

  it.each(["/api/backups", "/api/backups/run"])("%s rejects an admin-role user: it is manager-only now", async (url) => {
    await authService.createUser({ username: "manager", displayName: "Manager", password: "secret123", role: "manager" });
    await authService.createUser({ username: "admin", displayName: "Admin", password: "secret123", role: "admin" });
    const session = await authService.authenticate("admin", "secret123");
    const app = createTestApp(authService);

    const response = await invoke(app, {
      method: url.endsWith("/run") ? "POST" : "GET",
      url,
      headers: { cookie: serializeSessionCookie(session.sessionId) },
    });

    expect(response.status).toBe(403);
    expect(response.body?.error).toBe("Manager access required");
  });

  it("allows managers to list, run and download backups", async () => {
    await authService.createUser({ username: "manager", displayName: "Manager", password: "secret123", role: "manager" });
    const session = await authService.authenticate("manager", "secret123");
    const app = createTestApp(authService);
    const headers = { cookie: serializeSessionCookie(session.sessionId) };

    const list = await invoke(app, { method: "GET", url: "/api/backups", headers });
    const run = await invoke(app, { method: "POST", url: "/api/backups/run", headers });

    expect(list.status).toBe(200);
    expect(list.body).toMatchObject({
      backups: [],
      runtime: {
        enabled: true,
        running: false,
      },
    });
    expect(run.status).toBe(201);
    expect(run.body?.backup).toMatchObject({
      name: "lead-os-manual-test.db",
      reason: "manual",
    });
    // docs/56 P6-01 review: responses never carry the server path.
    expect(run.body?.backup).not.toHaveProperty("path");
  });

  // docs/56 P6-01 review: a snapshot is the whole install, so another workspace's manager is refused.
  it.each([
    { method: "GET", url: "/api/backups" },
    { method: "POST", url: "/api/backups/run" },
    { method: "GET", url: "/api/backups/dashboard.backup-20260308-000000000-manual.db/download" },
  ])("$method $url rejects a manager of another workspace", async ({ method, url }) => {
    await authService.createUser({ username: "owner", displayName: "Owner", password: "secret123", role: "manager" });
    const now = new Date().toISOString();
    await db.insert(workspaces).values({ id: "workspace_other", name: "Other", createdAt: now, updatedAt: now });
    const other = await authService.createUser({ username: "other", displayName: "Other", password: "secret123", role: "manager", workspaceId: "workspace_other" });
    expect(other.workspaceId).toBe("workspace_other");
    const session = await authService.authenticate("other", "secret123");
    const app = createTestApp(authService);

    const response = await invoke(app, { method, url, headers: { cookie: serializeSessionCookie(session.sessionId) } });

    expect(response.status).toBe(403);
    expect(response.body?.error).toBe("Only a manager of the default workspace can manage backups");
  });

  it("GET /api/my-day rejects manager access", async () => {
    await authService.createUser({
      username: "manager",
      displayName: "Manager",
      password: "secret123",
      role: "manager",
    });
    const session = await authService.authenticate("manager", "secret123");
    const app = createTestApp(authService);

    const response = await invoke(app, {
      method: "GET",
      url: "/api/my-day?date=2026-03-08",
      headers: {
        cookie: serializeSessionCookie(session.sessionId),
      },
    });

    expect(response.status).toBe(403);
    expect(response.body?.error).toBe("Developer access required");
  });
});
