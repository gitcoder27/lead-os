import { beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { createApp } from "../src/app";
import { appSessions, appUsers, developers } from "../src/db/schema";
import { AuthService, serializeSessionCookie } from "../src/services/auth.service";
import { IssueService } from "../src/services/issue.service";
import { MyDayService } from "../src/services/my-day.service";
import { TeamTrackerService } from "../src/services/team-tracker.service";
import { WorkloadService } from "../src/services/workload.service";
import { todayIsoDate } from "../src/utils/date";
import { db, resetDatabase } from "./helpers/db";
import { invoke } from "./helpers/http";

const authService = new AuthService();
const trackerService = new TeamTrackerService();

function createTestApp() {
  return createApp({
    issueService: new IssueService(),
    workloadService: new WorkloadService(),
    alertService: {} as any,
    automationService: {} as any,
    syncEngine: {} as any,
    backupService: {} as any,
    tagService: {} as any,
    teamTrackerService: trackerService,
    authService,
    myDayService: new MyDayService(trackerService),
    managerDeskService: {} as any,
    todayService: {} as any,
    searchService: {} as any,
    workSavedViewsService: {} as any,
  });
}

const app = createTestApp();
const MY_DAY_URL = () => `/api/my-day?date=${todayIsoDate()}`;

async function seedDeveloper(accountId: string, workspaceId = "default") {
  await db.insert(developers).values({
    workspaceId,
    accountId,
    displayName: `Dev ${accountId}`,
    email: `${accountId}@example.com`,
    avatarUrl: null,
    isActive: 1,
  });
}

async function cookieFor(username: string, password = "secret123") {
  const { sessionId } = await authService.authenticate(username, password);
  return serializeSessionCookie(sessionId, authService.sessionMaxAgeSeconds);
}

function myDay(cookie: string) {
  return invoke(app, { method: "GET", url: MY_DAY_URL(), headers: { cookie } });
}

function removeMember(cookie: string, accountId: string) {
  return invoke(app, { method: "DELETE", url: `/api/team/developers/${accountId}`, headers: { cookie } });
}

function login(username: string, password = "secret123") {
  return invoke(app, { method: "POST", url: "/api/auth/login", body: { username, password } });
}

async function sessionCountFor(username: string): Promise<number> {
  const user = (await db.select().from(appUsers).where(eq(appUsers.username, username)))[0];
  if (!user) return 0;
  return (await db.select().from(appSessions).where(eq(appSessions.userId, user.id))).length;
}

describe("removing a team member revokes their login (P0-S2)", () => {
  beforeEach(async () => {
    await resetDatabase();
    await authService.createUser({ username: "manager", displayName: "Manager", password: "secret123", role: "manager" });
    await seedDeveloper("dev-1");
    await seedDeveloper("dev-2");
    await authService.createUser({ username: "alice", displayName: "Alice", password: "secret123", role: "developer", developerAccountId: "dev-1" });
    await authService.createUser({ username: "bob", displayName: "Bob", password: "secret123", role: "developer", developerAccountId: "dev-2" });
  });

  it("baseline: an active developer can reach /api/my-day", async () => {
    expect((await myDay(await cookieFor("alice"))).status).toBe(200);
  });

  it("DELETE /api/team/developers/:id: the removed developer's existing cookie gets 401 and their login rows are gone", async () => {
    const managerCookie = await cookieFor("manager");
    const aliceCookie = await cookieFor("alice");
    const bobCookie = await cookieFor("bob");
    expect((await myDay(aliceCookie)).status).toBe(200);

    const res = await removeMember(managerCookie, "dev-1");
    expect(res.status).toBe(200);

    expect((await myDay(aliceCookie)).status).toBe(401);
    expect((await db.select().from(appUsers).where(eq(appUsers.username, "alice"))).length).toBe(0);
    expect(await sessionCountFor("alice")).toBe(0);
    // Other developers are untouched.
    expect((await myDay(bobCookie)).status).toBe(200);
  });

  it("login fails after removal, with the same error as a wrong password", async () => {
    await removeMember(await cookieFor("manager"), "dev-1");

    const removed = await login("alice");
    const wrong = await login("bob", "not-the-password");
    expect(removed.status).toBe(401);
    expect(removed.body?.error).toBe(wrong.body?.error);
  });

  it("the manager keeps working: session survives removals and login still works", async () => {
    const managerCookie = await cookieFor("manager");
    await removeMember(managerCookie, "dev-1");
    await removeMember(managerCookie, "dev-2");

    expect((await invoke(app, { method: "GET", url: "/api/auth/me", headers: { cookie: managerCookie } })).status).toBe(200);
    expect((await login("manager")).status).toBe(200);
  });

  it("PATCH isActive:false is also a removal and revokes the login", async () => {
    const managerCookie = await cookieFor("manager");
    const aliceCookie = await cookieFor("alice");

    const res = await invoke(app, {
      method: "PATCH",
      url: "/api/team/developers/dev-1",
      headers: { cookie: managerCookie },
      body: { isActive: false },
    });
    expect(res.status).toBe(200);
    expect((await myDay(aliceCookie)).status).toBe(401);
    expect((await login("alice")).status).toBe(401);
  });

  it("PATCH without an isActive change does not log anyone out", async () => {
    const managerCookie = await cookieFor("manager");
    const aliceCookie = await cookieFor("alice");

    const res = await invoke(app, {
      method: "PATCH",
      url: "/api/team/developers/dev-1",
      headers: { cookie: managerCookie },
      body: { displayName: "Alice Renamed" },
    });
    expect(res.status).toBe(200);
    expect((await myDay(aliceCookie)).status).toBe(200);
  });

  it("re-adding the same developer and linking a fresh login works; the old cookie stays dead", async () => {
    const managerCookie = await cookieFor("manager");
    const oldCookie = await cookieFor("alice");
    await removeMember(managerCookie, "dev-1");

    const readd = await invoke(app, {
      method: "POST",
      url: "/api/team/developers",
      headers: { cookie: managerCookie },
      body: { developers: [{ accountId: "dev-1", displayName: "Dev dev-1" }] },
    });
    expect(readd.status).toBe(200);

    // Re-adding alone does not resurrect the login or the old session.
    expect((await myDay(oldCookie)).status).toBe(401);
    expect((await login("alice")).status).toBe(401);

    // The username is free again, so the manager can link a new login.
    await authService.createUser({ username: "alice", displayName: "Alice", password: "new-secret1", role: "developer", developerAccountId: "dev-1" });
    expect((await login("alice", "new-secret1")).status).toBe(200);
    expect((await myDay(await cookieFor("alice", "new-secret1"))).status).toBe(200);
    expect((await myDay(oldCookie)).status).toBe(401);
  });

  it("defense in depth: a surviving session and login are rejected when the team member is inactive, and the session is dropped", async () => {
    const aliceCookie = await cookieFor("alice");
    // Simulate a removal that did not revoke (older removals, direct SQL, other code paths).
    await db.update(developers).set({ isActive: 0 }).where(eq(developers.accountId, "dev-1"));

    expect((await myDay(aliceCookie)).status).toBe(401);
    expect(await sessionCountFor("alice")).toBe(0);
    const res = await login("alice");
    expect(res.status).toBe(401);
    expect(await sessionCountFor("alice")).toBe(0);
  });

  it("defense in depth: a developer login whose team member row is missing is rejected", async () => {
    const aliceCookie = await cookieFor("alice");
    await db.delete(developers).where(eq(developers.accountId, "dev-1"));

    expect((await myDay(aliceCookie)).status).toBe(401);
    expect((await login("alice")).status).toBe(401);
  });

  it("re-activating a member who was deactivated by an older code path kills their stale session but keeps the login", async () => {
    const managerCookie = await cookieFor("manager");
    const staleCookie = await cookieFor("alice");
    // Legacy state: developer inactive, login row and session both still present.
    await db.update(developers).set({ isActive: 0 }).where(eq(developers.accountId, "dev-1"));

    const res = await invoke(app, {
      method: "PATCH",
      url: "/api/team/developers/dev-1",
      headers: { cookie: managerCookie },
      body: { isActive: true },
    });
    expect(res.status).toBe(200);

    expect((await myDay(staleCookie)).status).toBe(401);
    expect(await sessionCountFor("alice")).toBe(0);
    expect((await login("alice")).status).toBe(200);
  });

  it("saving the roster (POST /developers) does not log out members who were already active", async () => {
    const managerCookie = await cookieFor("manager");
    const aliceCookie = await cookieFor("alice");
    const bobCookie = await cookieFor("bob");

    const res = await invoke(app, {
      method: "POST",
      url: "/api/team/developers",
      headers: { cookie: managerCookie },
      body: {
        developers: [
          { accountId: "dev-1", displayName: "Dev dev-1" },
          { accountId: "dev-2", displayName: "Dev dev-2" },
        ],
      },
    });
    expect(res.status).toBe(200);
    expect((await myDay(aliceCookie)).status).toBe(200);
    expect((await myDay(bobCookie)).status).toBe(200);
  });

  it("only touches the manager's own workspace when another workspace has the same developer id", async () => {
    const other = await authService.createUser({ username: "manager-two", displayName: "Manager Two", password: "secret123", role: "manager" });
    expect(other.workspaceId).not.toBe("default");
    await seedDeveloper("dev-1", other.workspaceId);
    await authService.createUser({
      username: "alice-two",
      displayName: "Alice Two",
      password: "secret123",
      role: "developer",
      developerAccountId: "dev-1",
      workspaceId: other.workspaceId,
    });
    const otherCookie = await cookieFor("alice-two");

    await removeMember(await cookieFor("manager"), "dev-1");

    expect((await myDay(otherCookie)).status).toBe(200);
    expect(
      (await db.select().from(developers).where(and(eq(developers.workspaceId, other.workspaceId), eq(developers.accountId, "dev-1"))))[0]?.isActive
    ).toBe(1);
    expect((await db.select().from(appUsers).where(eq(appUsers.username, "alice-two"))).length).toBe(1);
  });
});
