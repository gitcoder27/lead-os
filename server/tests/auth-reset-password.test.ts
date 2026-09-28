import { beforeEach, describe, expect, it } from "vitest";
import express from "express";
import { eq } from "drizzle-orm";
import { createAuthRouter } from "../src/routes/auth";
import { errorHandler, notFoundHandler } from "../src/middleware/errorHandler";
import { AuthService, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, serializeSessionCookie } from "../src/services/auth.service";
import { appSessions, appUsers, developers } from "../src/db/schema";
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

// Rebuilt per test: the login throttle is in-memory state owned by the router.
let app = createTestApp();
const NEW_PASSWORD = "brand-new-pass-9";

async function seedDeveloper(accountId: string, workspaceId = "default") {
  await db.insert(developers).values({ workspaceId, accountId, displayName: `Dev ${accountId}`, email: null, avatarUrl: null, isActive: 1 });
}

async function cookieFor(username: string, password = "secret123") {
  const { sessionId } = await authService.authenticate(username, password);
  return { cookie: serializeSessionCookie(sessionId, authService.sessionMaxAgeSeconds), sessionId };
}

function reset(cookie: string | undefined, username: string, body: unknown) {
  return invoke(app, {
    method: "POST",
    url: `/api/auth/users/${encodeURIComponent(username)}/reset-password`,
    headers: cookie ? { cookie } : {},
    body,
  });
}

async function canLogin(username: string, password: string) {
  return (await invoke(app, { method: "POST", url: "/api/auth/login", body: { username, password } })).status === 200;
}

describe("admin password reset", () => {
  beforeEach(async () => {
    app = createTestApp();
    await resetDatabase();
    await authService.createUser({ username: "manager", displayName: "Manager", password: "secret123", role: "manager" });
    await seedDeveloper("dev-1");
    await seedDeveloper("dev-2");
    await authService.createUser({ username: "alice", displayName: "Alice", password: "secret123", role: "developer", developerAccountId: "dev-1" });
    await authService.createUser({ username: "bob", displayName: "Bob", password: "secret123", role: "developer", developerAccountId: "dev-2" });
  });

  describe("POST /api/auth/users/:username/reset-password", () => {
    it("lets a manager set a developer's password: old one stops working, new one works, sessions are revoked", async () => {
      const manager = await cookieFor("manager");
      const aliceSession = await cookieFor("alice");
      const aliceSecondDevice = await cookieFor("alice");
      const bobSession = await cookieFor("bob");

      const res = await reset(manager.cookie, "alice", { newPassword: NEW_PASSWORD });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });
      expect(await canLogin("alice", "secret123")).toBe(false);
      expect(await canLogin("alice", NEW_PASSWORD)).toBe(true);
      expect(await authService.getUserForSession(aliceSession.sessionId)).toBeUndefined();
      expect(await authService.getUserForSession(aliceSecondDevice.sessionId)).toBeUndefined();
      // Everyone else keeps their sessions.
      expect(await authService.getUserForSession(bobSession.sessionId)).toBeDefined();
      expect(await authService.getUserForSession(manager.sessionId)).toBeDefined();
    });

    it("stores a hash, never the plaintext", async () => {
      await reset((await cookieFor("manager")).cookie, "alice", { newPassword: NEW_PASSWORD });
      const row = (await db.select().from(appUsers).where(eq(appUsers.username, "alice")))[0]!;
      expect(row.passwordHash.startsWith("scrypt$")).toBe(true);
      expect(row.passwordHash).not.toContain(NEW_PASSWORD);
    });

    it("requires authentication (401) and a manager (403)", async () => {
      expect((await reset(undefined, "alice", { newPassword: NEW_PASSWORD })).status).toBe(401);

      const bob = await cookieFor("bob");
      expect((await reset(bob.cookie, "alice", { newPassword: NEW_PASSWORD })).status).toBe(403);
      // A developer cannot reset their own password this way either.
      expect((await reset(bob.cookie, "bob", { newPassword: NEW_PASSWORD })).status).toBe(403);

      expect(await canLogin("alice", "secret123")).toBe(true);
      expect(await canLogin("bob", "secret123")).toBe(true);
    });

    it("refuses to reset a manager account, including the caller's own (403), and leaves the password unchanged", async () => {
      await authService.createUser({ username: "manager-b", displayName: "Manager B", password: "secret123", role: "manager", workspaceId: "default" });
      const manager = await cookieFor("manager");

      const other = await reset(manager.cookie, "manager-b", { newPassword: NEW_PASSWORD });
      const self = await reset(manager.cookie, "manager", { newPassword: NEW_PASSWORD });

      expect(other.status).toBe(403);
      expect(self.status).toBe(403);
      expect(await canLogin("manager-b", "secret123")).toBe(true);
      expect(await canLogin("manager", "secret123")).toBe(true);
      expect(await authService.getUserForSession(manager.sessionId)).toBeDefined();
    });

    it("is scoped to the caller's workspace: a developer in another workspace is 404 and untouched", async () => {
      const otherManager = await authService.createUser({ username: "manager-two", displayName: "Manager Two", password: "secret123", role: "manager" });
      expect(otherManager.workspaceId).not.toBe("default");
      await seedDeveloper("dev-9", otherManager.workspaceId);
      await authService.createUser({ username: "zed", displayName: "Zed", password: "secret123", role: "developer", developerAccountId: "dev-9", workspaceId: otherManager.workspaceId });
      const zedSession = await cookieFor("zed");

      const res = await reset((await cookieFor("manager")).cookie, "zed", { newPassword: NEW_PASSWORD });

      expect(res.status).toBe(404);
      expect(await canLogin("zed", "secret123")).toBe(true);
      expect(await authService.getUserForSession(zedSession.sessionId)).toBeDefined();
    });

    it("returns 404 for unknown or already-deleted users", async () => {
      const manager = (await cookieFor("manager")).cookie;
      expect((await reset(manager, "nobody", { newPassword: NEW_PASSWORD })).status).toBe(404);

      await authService.deleteUser("alice", "default");
      expect((await reset(manager, "alice", { newPassword: NEW_PASSWORD })).status).toBe(404);
    });

    it("enforces the same password rules as account creation, and never echoes the password", async () => {
      const manager = (await cookieFor("manager")).cookie;
      const tooShort = "a".repeat(PASSWORD_MIN_LENGTH - 1);
      const tooLong = "b".repeat(PASSWORD_MAX_LENGTH + 1);

      const responses = [
        await reset(manager, "alice", { newPassword: tooShort }),
        await reset(manager, "alice", { newPassword: tooLong }),
        await reset(manager, "alice", { newPassword: "" }),
        await reset(manager, "alice", {}),
        await reset(manager, "alice", { newPassword: 123456789 }),
      ];
      for (const res of responses) expect(res.status).toBe(400);

      const echoed = JSON.stringify(responses.map((res) => res.body));
      expect(echoed).not.toContain(tooShort);
      expect(echoed).not.toContain(tooLong);
      // Boundary values are accepted.
      expect((await reset(manager, "alice", { newPassword: "a".repeat(PASSWORD_MIN_LENGTH) })).status).toBe(200);
      expect((await reset(manager, "alice", { newPassword: "b".repeat(PASSWORD_MAX_LENGTH) })).status).toBe(200);
      // The rejected attempts never changed anything: the accepted boundary password is what works.
      expect(await canLogin("alice", "b".repeat(PASSWORD_MAX_LENGTH))).toBe(true);
    });

    it("lifts a lockout so the person can sign in with the new password straight away", async () => {
      for (let index = 0; index < 5; index += 1) {
        const failed = await invoke(app, { method: "POST", url: "/api/auth/login", body: { username: "alice", password: "wrong-password" } });
        expect(failed.status).toBe(401);
      }
      expect((await invoke(app, { method: "POST", url: "/api/auth/login", body: { username: "alice", password: "secret123" } })).status).toBe(429);

      await reset((await cookieFor("manager")).cookie, "alice", { newPassword: NEW_PASSWORD });

      expect(await canLogin("alice", NEW_PASSWORD)).toBe(true);
    });
  });

  describe("AuthService.resetPassword (CLI policy)", () => {
    it("can reset a manager when the caller allows it, revokes their sessions and reports the count", async () => {
      await cookieFor("manager");
      await cookieFor("manager");

      const result = await authService.resetPassword("Manager", NEW_PASSWORD, { allowedRoles: ["admin", "manager", "developer"] });

      expect(result).toEqual({ username: "manager", role: "manager", sessionsRevoked: 2 });
      expect(JSON.stringify(result)).not.toContain(NEW_PASSWORD);
      expect(await canLogin("manager", NEW_PASSWORD)).toBe(true);
      expect(await canLogin("manager", "secret123")).toBe(false);
    });

    it("honours allowedRoles and rejects inactive accounts", async () => {
      await expect(authService.resetPassword("manager", NEW_PASSWORD, { allowedRoles: ["developer"] })).rejects.toMatchObject({ status: 403 });
      await db.update(appUsers).set({ isActive: 0 }).where(eq(appUsers.username, "alice"));
      await expect(authService.resetPassword("alice", NEW_PASSWORD, { allowedRoles: ["developer"] })).rejects.toMatchObject({ status: 404 });
      expect(await canLogin("manager", "secret123")).toBe(true);
    });

    it("validates the password before touching the account", async () => {
      await cookieFor("alice");
      await expect(authService.resetPassword("alice", "short", { allowedRoles: ["developer"] })).rejects.toMatchObject({ status: 400 });
      const sessions = await db.select().from(appSessions);
      expect(sessions.length).toBeGreaterThan(0);
      expect(await canLogin("alice", "secret123")).toBe(true);
    });
  });
});
