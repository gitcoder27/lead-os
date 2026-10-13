import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import { eq } from "drizzle-orm";
import { createAuthRouter } from "../src/routes/auth";
import { notFoundHandler, errorHandler } from "../src/middleware/errorHandler";
import { AuthService, PASSWORD_MIN_LENGTH, SESSION_COOKIE_NAME } from "../src/services/auth.service";
import { appSessions, developers } from "../src/db/schema";
import { db, resetDatabase } from "./helpers/db";
import { invoke } from "./helpers/http";

const authService = new AuthService();

function createTestApp() {
  const app = express();
  app.use("/api/auth", createAuthRouter(authService));
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

async function seedDeveloper(accountId = "dev-1", displayName = "Developer") {
  await db.insert(developers).values({
    accountId,
    displayName,
    email: `${accountId}@example.com`,
    avatarUrl: null,
    isActive: 1,
  });
}

describe("auth routes", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("GET /api/auth/bootstrap reports whether bootstrap registration is still open", async () => {
    const app = createTestApp();

    const before = await invoke(app, {
      method: "GET",
      url: "/api/auth/bootstrap",
    });

    expect(before.status).toBe(200);
    expect(before.body).toEqual({ bootstrapOpen: true, userCount: 0 });

    await authService.createUser({
      username: "manager",
      displayName: "Manager",
      password: "secret123",
      role: "manager",
    });

    const after = await invoke(app, {
      method: "GET",
      url: "/api/auth/bootstrap",
    });

    expect(after.status).toBe(200);
    expect(after.body).toEqual({ bootstrapOpen: false });
  });

  it("POST /api/auth/login creates a session and returns the authenticated user", async () => {
    await authService.createUser({
      username: "manager",
      displayName: "Manager",
      password: "secret123",
      role: "manager",
    });
    await seedDeveloper("dev-1", "Alice Smith");
    await authService.createUser({
      username: "alice",
      displayName: "Alice Smith",
      password: "secret123",
      role: "developer",
      developerAccountId: "dev-1",
    });

    const app = createTestApp();
    const res = await invoke(app, {
      method: "POST",
      url: "/api/auth/login",
      body: {
        username: "alice",
        password: "secret123",
      },
    });

    expect(res.status).toBe(200);
    expect(res.body?.user).toMatchObject({
      username: "alice",
      accountId: "dev-1",
      displayName: "Alice Smith",
      role: "developer",
      developerAccountId: "dev-1",
    });
    expect(res.headers["set-cookie"]).toContain(`${SESSION_COOKIE_NAME}=`);
    expect(res.headers["set-cookie"]).toContain("HttpOnly");
  });

  it("password change revokes every old session, clears the cookie, and requires a fresh login", async () => {
    await authService.createUser({ username: "manager", displayName: "Manager", password: "secret123", role: "manager" });
    await authService.createUser({ username: "other", displayName: "Other", password: "secret123", role: "manager" });
    const sessions = await Promise.all([authService.authenticate("manager", "secret123"), authService.authenticate("manager", "secret123")]);
    const other = await authService.authenticate("other", "secret123");
    const app = createTestApp();
    const failed = await invoke(app, { method: "POST", url: "/api/auth/change-password", body: { username: "manager", currentPassword: "wrong", newPassword: "new-secret-123" } });
    expect(failed.status).toBe(401);
    expect(await authService.getUserForSession(sessions[0]!.sessionId)).toBeDefined();
    const changed = await invoke(app, { method: "POST", url: "/api/auth/change-password", body: { username: "manager", currentPassword: "secret123", newPassword: "new-secret-123" } });
    expect(changed.status).toBe(200);
    expect(changed.headers["set-cookie"]).toContain("Max-Age=0");
    for (const session of sessions) {
      const result = await invoke(app, { method: "GET", url: "/api/auth/me", headers: { cookie: `${SESSION_COOKIE_NAME}=${session.sessionId}` } });
      expect(result.status).toBe(401);
    }
    expect(await authService.getUserForSession(other.sessionId)).toBeDefined();
    await expect(authService.authenticate("manager", "secret123")).rejects.toMatchObject({ status: 401 });
    await expect(authService.authenticate("manager", "new-secret-123")).resolves.toBeDefined();
  });

  it("touches an active session at most once every five minutes", async () => {
    await authService.createUser({
      username: "manager",
      displayName: "Manager",
      password: "secret123",
      role: "manager",
    });
    const session = await authService.authenticate("manager", "secret123");
    const sessionRow = (await db.select().from(appSessions))[0]!;
    await db
      .update(appSessions)
      .set({ lastSeenAt: "2020-01-01T00:00:00.000Z" })
      .where(eq(appSessions.id, sessionRow.id));

    await authService.getUserForSession(session.sessionId);
    const firstTouch = (await db.select().from(appSessions))[0]!.lastSeenAt;
    await authService.getUserForSession(session.sessionId);
    const secondTouch = (await db.select().from(appSessions))[0]!.lastSeenAt;

    expect(firstTouch).not.toBe("2020-01-01T00:00:00.000Z");
    expect(secondTouch).toBe(firstTouch);
  });

  it("limits password-change spraying by IP before service calls and expires the window", async () => {
    const app = createTestApp();
    const change = vi.spyOn(authService, "changePassword");
    const attempt = (username: string, remoteAddress = "192.0.2.1") => invoke(app, {
      method: "POST", url: "/api/auth/change-password", remoteAddress,
      body: { username, currentPassword: "wrong-password", newPassword: "new-password" },
    });
    const now = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(now);
    try {
      for (let i = 0; i < 30; i++) expect((await attempt(`unknown-${i}`)).status).toBe(401);
      const limited = await attempt("unknown-31");
      expect(limited.status).toBe(429);
      expect(limited.headers["retry-after"]).toBe("900");
      expect(change).toHaveBeenCalledTimes(30);
      expect((await attempt("other", "192.0.2.2")).status).toBe(401);
      clock.mockReturnValue(now + 15 * 60_000);
      expect((await attempt("fresh-window")).status).toBe(401);
    } finally { change.mockRestore(); clock.mockRestore(); }
  });

  it("POST /api/auth/login throttles repeated failed attempts by username and address", async () => {
    await authService.createUser({
      username: "manager",
      displayName: "Manager",
      password: "secret123",
      role: "manager",
    });

    const app = createTestApp();
    for (let index = 0; index < 5; index += 1) {
      const failed = await invoke(app, {
        method: "POST",
        url: "/api/auth/login",
        body: {
          username: "manager",
          password: "wrong-password",
        },
      });
      expect(failed.status).toBe(401);
    }

    const throttled = await invoke(app, {
      method: "POST",
      url: "/api/auth/login",
      body: {
        username: "manager",
        password: "secret123",
      },
    });

    expect(throttled.status).toBe(429);
    expect(throttled.body?.error).toBe("Too many failed attempts. Try again later.");
  });

  it("POST /api/auth/register only allows a manager for the bootstrap account and auto-signs them in", async () => {
    const app = createTestApp();

    const rejected = await invoke(app, {
      method: "POST",
      url: "/api/auth/register",
      body: {
        username: "dev",
        displayName: "Developer",
        password: "secret123",
        role: "developer",
        developerAccountId: "dev-1",
      },
    });

    expect(rejected.status).toBe(403);
    expect(rejected.body?.error).toBe("The first account must be a manager");

    const created = await invoke(app, {
      method: "POST",
      url: "/api/auth/register",
      body: {
        username: "manager",
        displayName: "Manager",
        password: "secret123",
        role: "manager",
      },
    });

    expect(created.status).toBe(201);
    expect(created.body?.user).toMatchObject({
      username: "manager",
      role: "manager",
    });
    expect(created.headers["set-cookie"]).toContain(`${SESSION_COOKIE_NAME}=`);
  });

  it("AuthService enforces a manager bootstrap account before CLI-only admin creation", async () => {
    await expect(authService.createUser({
      username: "admin-first",
      displayName: "Admin First",
      password: "secret123",
      role: "admin",
    })).rejects.toMatchObject({
      status: 403,
      message: "The first account must be a manager",
    });

    await authService.createUser({
      username: "manager",
      displayName: "Manager",
      password: "secret123",
      role: "manager",
    });
    const admin = await authService.createUser({
      username: "admin",
      displayName: "Admin",
      password: "secret123",
      role: "admin",
    });
    const login = await authService.authenticate("admin", "secret123");

    expect(admin).toMatchObject({
      username: "admin",
      role: "admin",
      workspaceId: "default",
    });
    expect(login.user).toMatchObject({
      username: "admin",
      role: "admin",
      workspaceId: "default",
    });
  });

  it("POST /api/auth/register keeps admin creation out of the web registration flow", async () => {
    await authService.createUser({
      username: "manager",
      displayName: "Manager",
      password: "secret123",
      role: "manager",
    });

    const app = createTestApp();
    const managerLogin = await invoke(app, {
      method: "POST",
      url: "/api/auth/login",
      body: {
        username: "manager",
        password: "secret123",
      },
    });

    const rejected = await invoke(app, {
      method: "POST",
      url: "/api/auth/register",
      headers: {
        cookie: managerLogin.headers["set-cookie"],
      },
      body: {
        username: "admin",
        displayName: "Admin",
        password: "secret123",
        role: "admin",
      },
    });

    expect(rejected.status).toBe(400);
  });

  it("POST /api/auth/register requires a manager session after bootstrap", async () => {
    await seedDeveloper("dev-1");
    await authService.createUser({
      username: "manager",
      displayName: "Manager",
      password: "secret123",
      role: "manager",
    });
    await authService.createUser({
      username: "dev",
      displayName: "Developer",
      password: "secret123",
      role: "developer",
      developerAccountId: "dev-1",
    });

    const app = createTestApp();
    const devLogin = await invoke(app, {
      method: "POST",
      url: "/api/auth/login",
      body: {
        username: "dev",
        password: "secret123",
      },
    });

    const unauthenticated = await invoke(app, {
      method: "POST",
      url: "/api/auth/register",
      body: {
        username: "new-dev",
        displayName: "New Developer",
        password: "secret123",
        role: "developer",
        developerAccountId: "dev-2",
      },
    });
    expect(unauthenticated.status).toBe(401);

    const forbidden = await invoke(app, {
      method: "POST",
      url: "/api/auth/register",
      headers: {
        cookie: devLogin.headers["set-cookie"],
      },
      body: {
        username: "new-dev",
        displayName: "New Developer",
        password: "secret123",
        role: "developer",
        developerAccountId: "dev-2",
      },
    });

    expect(forbidden.status).toBe(403);
    expect(forbidden.body?.error).toBe("Only managers can create users");
  });

  it("DELETE /api/auth/users/:username removes a developer account and invalidates its sessions", async () => {
    await seedDeveloper("dev-1");
    await authService.createUser({
      username: "manager",
      displayName: "Manager",
      password: "secret123",
      role: "manager",
    });
    await authService.createUser({
      username: "dev",
      displayName: "Developer",
      password: "secret123",
      role: "developer",
      developerAccountId: "dev-1",
    });

    const app = createTestApp();
    const managerLogin = await invoke(app, {
      method: "POST",
      url: "/api/auth/login",
      body: {
        username: "manager",
        password: "secret123",
      },
    });
    const devLogin = await invoke(app, {
      method: "POST",
      url: "/api/auth/login",
      body: {
        username: "dev",
        password: "secret123",
      },
    });

    const removed = await invoke(app, {
      method: "DELETE",
      url: "/api/auth/users/dev",
      headers: {
        cookie: managerLogin.headers["set-cookie"],
      },
    });

    expect(removed.status).toBe(200);
    expect(removed.body).toEqual({ ok: true });

    const users = await invoke(app, {
      method: "GET",
      url: "/api/auth/users",
      headers: {
        cookie: managerLogin.headers["set-cookie"],
      },
    });

    expect(users.status).toBe(200);
    expect(users.body?.users).toHaveLength(1);
    expect(users.body?.users[0]?.username).toBe("manager");

    const deletedUserSession = await invoke(app, {
      method: "GET",
      url: "/api/auth/me",
      headers: {
        cookie: devLogin.headers["set-cookie"],
      },
    });

    expect(deletedUserSession.status).toBe(401);
    expect(deletedUserSession.body?.error).toBe("Authentication required");
  });

  it("DELETE /api/auth/users/:username rejects deleting manager accounts", async () => {
    await authService.createUser({
      username: "manager",
      displayName: "Manager",
      password: "secret123",
      role: "manager",
    });

    const app = createTestApp();
    const managerLogin = await invoke(app, {
      method: "POST",
      url: "/api/auth/login",
      body: {
        username: "manager",
        password: "secret123",
      },
    });

    const removed = await invoke(app, {
      method: "DELETE",
      url: "/api/auth/users/manager",
      headers: {
        cookie: managerLogin.headers["set-cookie"],
      },
    });

    expect(removed.status).toBe(400);
    expect(removed.body?.error).toBe("Only developer accounts can be deleted from settings");
  });

  it("GET /api/auth/me rejects unauthenticated requests", async () => {
    const app = createTestApp();

    const res = await invoke(app, {
      method: "GET",
      url: "/api/auth/me",
    });

    expect(res.status).toBe(401);
    expect(res.body?.error).toBe("Authentication required");
  });

  it("POST /api/auth/logout invalidates the current session", async () => {
    await authService.createUser({
      username: "manager",
      displayName: "Manager",
      password: "secret123",
      role: "manager",
    });
    await seedDeveloper("dev-1", "Alice Smith");
    await authService.createUser({
      username: "alice",
      displayName: "Alice Smith",
      password: "secret123",
      role: "developer",
      developerAccountId: "dev-1",
    });

    const app = createTestApp();
    const login = await invoke(app, {
      method: "POST",
      url: "/api/auth/login",
      body: {
        username: "alice",
        password: "secret123",
      },
    });

    const cookie = login.headers["set-cookie"];
    expect(cookie).toContain(`${SESSION_COOKIE_NAME}=`);

    const logout = await invoke(app, {
      method: "POST",
      url: "/api/auth/logout",
      headers: {
        cookie,
      },
    });

    expect(logout.status).toBe(200);
    expect(logout.body).toEqual({ ok: true });
    expect(logout.headers["set-cookie"]).toContain("Max-Age=0");

    const me = await invoke(app, {
      method: "GET",
      url: "/api/auth/me",
      headers: {
        cookie,
      },
    });

    expect(me.status).toBe(401);
  });

  describe("minimum password length (docs/56 P2-01)", () => {
    const short = "a".repeat(PASSWORD_MIN_LENGTH - 1);
    const ok = "a".repeat(PASSWORD_MIN_LENGTH);

    it("is more than six characters", () => {
      expect(PASSWORD_MIN_LENGTH).toBeGreaterThan(6);
    });

    it("POST /api/auth/register rejects a short password for the bootstrap manager and accepts the minimum", async () => {
      const app = createTestApp();
      const body = { username: "manager", displayName: "Manager", role: "manager" };

      const rejected = await invoke(app, { method: "POST", url: "/api/auth/register", body: { ...body, password: short } });
      expect(rejected.status).toBe(400);
      expect((await invoke(app, { method: "GET", url: "/api/auth/bootstrap" })).body?.bootstrapOpen).toBe(true);

      const created = await invoke(app, { method: "POST", url: "/api/auth/register", body: { ...body, password: ok } });
      expect(created.status).toBe(201);
    });

    it("AuthService.createUser enforces it too, so the CLI cannot create a weak login", async () => {
      await expect(authService.createUser({ username: "manager", displayName: "Manager", password: short, role: "manager" }))
        .rejects.toMatchObject({ status: 400, message: `Password must be at least ${PASSWORD_MIN_LENGTH} characters` });
      expect(await authService.getUserCount()).toBe(0);
      await expect(authService.createUser({ username: "manager", displayName: "Manager", password: ok, role: "manager" })).resolves.toBeTruthy();
    });

    it("POST /api/auth/change-password rejects a short new password", async () => {
      const app = createTestApp();
      await authService.createUser({ username: "manager", displayName: "Manager", password: ok, role: "manager" });
      const rejected = await invoke(app, {
        method: "POST",
        url: "/api/auth/change-password",
        body: { username: "manager", currentPassword: ok, newPassword: short },
      });
      expect(rejected.status).toBe(400);
      const changed = await invoke(app, {
        method: "POST",
        url: "/api/auth/change-password",
        body: { username: "manager", currentPassword: ok, newPassword: `${ok}!` },
      });
      expect(changed.status).toBe(200);
    });
  });
});
