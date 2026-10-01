import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { configTable, developers } from "../src/db/schema";
import { AuthService, serializeSessionCookie } from "../src/services/auth.service";
import { SelfIdentityService } from "../src/services/self-identity.service";
import { TaskService, type TaskPrincipal } from "../src/services/task.service";
import { TaskViewsService } from "../src/services/task-views.service";
import { WorkloadService } from "../src/services/workload.service";
import { db, resetDatabase } from "./helpers/db";
import { invoke } from "./helpers/http";

const authService = new AuthService();
const self = new SelfIdentityService();
const views = new TaskViewsService();
const taskService = new TaskService();

const ayan: TaskPrincipal = { type: "manager", accountId: "ayan", workspaceId: "default" };
const other: TaskPrincipal = { type: "manager", accountId: "other-manager", workspaceId: "default" };
const TODAY = "2026-10-01";

async function titles(principal: TaskPrincipal, filters: Record<string, unknown>): Promise<string[]> {
  const rows = await views.run(principal, { filters, sort: "created" } as never, TODAY);
  return rows.map((row) => row.title).sort();
}

beforeEach(async () => {
  await resetDatabase();
  await db.insert(configTable).values({ key: "tasks_phase1_enabled", value: "true" });
  await db.insert(developers).values([
    { accountId: "dev-ayan", displayName: "Ayan Saha", isActive: 1, jiraAccountId: "jira-ayan" },
    { accountId: "dev-priya", displayName: "Priya", isActive: 1 },
    { accountId: "dev-gone", displayName: "Gone", isActive: 0 },
  ]);
  // Private to me, assigned the way the Copilot's "assign to me" does.
  await taskService.create({ title: "Private plan" }, ayan);
  // Roster work for the same person, and for a teammate.
  await taskService.create({ title: "Board task", ownerType: "developer", ownerId: "dev-ayan" }, ayan);
  await taskService.create({ title: "Priya task", ownerType: "developer", ownerId: "dev-priya" }, ayan);
});

describe("self identity link", () => {
  it("starts unlinked, and 'me' is only the login's own tasks", async () => {
    expect(await self.get("ayan", "default")).toEqual({ developerAccountId: null, suggestedDeveloperAccountId: null });
    expect(await titles(ayan, { owner: "me" })).toEqual(["Private plan"]);
    expect(await titles(ayan, { owner: "team" })).toEqual(["Board task", "Priya task"]);
  });

  it("links the roster record: 'me' covers both identities and 'team' drops mine", async () => {
    await self.set("ayan", "dev-ayan", "default");
    expect(await titles(ayan, { owner: "me" })).toEqual(["Board task", "Private plan"]);
    expect(await titles(ayan, { owner: "team" })).toEqual(["Priya task"]);
  });

  it("keeps my roster tasks in my scope even when another manager tracks them", async () => {
    await taskService.create({ title: "Tracked elsewhere", ownerType: "developer", ownerId: "dev-ayan" }, other);
    await self.set("ayan", "dev-ayan", "default");
    expect(await titles(ayan, { owner: "me" })).toContain("Tracked elsewhere");
  });

  it("is private to the manager who set it", async () => {
    await self.set("ayan", "dev-ayan", "default");
    expect(await titles(other, { owner: "me" })).toEqual([]);
    expect(await self.linkedDeveloperId("other-manager", "default")).toBeUndefined();
  });

  it("counts follow the same rule as the list", async () => {
    await self.set("ayan", "dev-ayan", "default");
    expect(await views.count(ayan, { filters: { owner: "me" } } as never, TODAY)).toBe(2);
  });

  it("only accepts an active roster member", async () => {
    await expect(self.set("ayan", "dev-gone", "default")).rejects.toMatchObject({ status: 400 });
    await expect(self.set("ayan", "nobody", "default")).rejects.toMatchObject({ status: 400 });
  });

  it("stops applying when the roster record is deactivated, and comes back if it returns", async () => {
    await self.set("ayan", "dev-ayan", "default");
    await db.update(developers).set({ isActive: 0 }).where(eqAccount("dev-ayan"));
    expect(await self.linkedDeveloperId("ayan", "default")).toBeUndefined();
    expect(await titles(ayan, { owner: "me" })).toEqual(["Private plan"]);
    await db.update(developers).set({ isActive: 1 }).where(eqAccount("dev-ayan"));
    expect(await self.linkedDeveloperId("ayan", "default")).toBe("dev-ayan");
  });

  it("unlinking restores the old answer and rewrites no task", async () => {
    await self.set("ayan", "dev-ayan", "default");
    await self.set("ayan", null, "default");
    expect(await self.get("ayan", "default")).toEqual({ developerAccountId: null, suggestedDeveloperAccountId: null });
    expect(await titles(ayan, { owner: "me" })).toEqual(["Private plan"]);
  });

  it("suggests the roster record that matches the saved manager Jira account", async () => {
    await db.insert(configTable).values({ key: "manager_jira_account_id", value: "jira-ayan" });
    expect(await self.get("ayan", "default")).toEqual({ developerAccountId: null, suggestedDeveloperAccountId: "dev-ayan" });
    await self.set("ayan", "dev-ayan", "default");
    expect(await self.get("ayan", "default")).toEqual({ developerAccountId: "dev-ayan", suggestedDeveloperAccountId: null });
  });
});

describe("team self-link routes", () => {
  function app() {
    return createApp({
      issueService: {} as any, workloadService: new WorkloadService(), alertService: {} as any, automationService: {} as any,
      syncEngine: {} as any, backupService: {} as any, tagService: {} as any, teamTrackerService: {} as any, authService,
      myDayService: {} as any, managerDeskService: {} as any, todayService: { clearCache: () => undefined } as any, searchService: {} as any, workSavedViewsService: {} as any,
    });
  }

  async function login(username: string, role: "manager" | "developer", developerAccountId?: string) {
    await authService.createUser({ username, displayName: username, password: "secret123", role, developerAccountId });
    return serializeSessionCookie((await authService.authenticate(username, "secret123")).sessionId);
  }

  it("reads, sets and clears the link for the logged-in manager", async () => {
    const cookie = await login("ayan", "manager");
    const server = app();
    expect((await invoke(server, { method: "GET", url: "/api/team/self", headers: { cookie } })).body).toEqual({ developerAccountId: null, suggestedDeveloperAccountId: null });
    const set = await invoke(server, { method: "PUT", url: "/api/team/self", headers: { cookie }, body: { developerAccountId: "dev-ayan" } });
    expect(set.status).toBe(200);
    expect(set.body).toEqual({ developerAccountId: "dev-ayan", suggestedDeveloperAccountId: null });
    expect((await invoke(server, { method: "PUT", url: "/api/team/self", headers: { cookie }, body: { developerAccountId: null } })).body.developerAccountId).toBeNull();
    expect((await invoke(server, { method: "PUT", url: "/api/team/self", headers: { cookie }, body: { developerAccountId: "dev-gone" } })).status).toBe(400);
  });

  it("is manager-only", async () => {
    await login("boss", "manager");
    const cookie = await login("dev.login", "developer", "dev-priya");
    expect((await invoke(app(), { method: "GET", url: "/api/team/self", headers: { cookie } })).status).toBe(403);
    expect((await invoke(app(), { method: "PUT", url: "/api/team/self", headers: { cookie }, body: { developerAccountId: "dev-priya" } })).status).toBe(403);
  });
});

import { and, eq } from "drizzle-orm";
function eqAccount(accountId: string) {
  return and(eq(developers.workspaceId, "default"), eq(developers.accountId, accountId));
}
