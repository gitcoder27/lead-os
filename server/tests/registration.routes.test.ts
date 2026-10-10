import express from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { rawDb } from "../src/db/connection";
import { config } from "../src/config";
import { createAuthRouter } from "../src/routes/auth";
import { errorHandler } from "../src/middleware/errorHandler";
import { AuthService } from "../src/services/auth.service";
import { RegistrationService } from "../src/services/registration.service";
import { resetDatabase } from "./helpers/db";
import { invoke } from "./helpers/http";
const auth = new AuthService(); const service = new RegistrationService(auth);
let app: express.Express;
const request = (method: string, url: string, body?: unknown, ip = "192.0.2.7") => invoke(app, { method, url: `/api/auth${url}`, body, remoteAddress: ip });
const input = (token: string) => ({ inviteToken: token, username: "friend", displayName: "Friend", password: "safe-fixture-password", timeZone: "Asia/Kolkata" });
const counts = () => ["app_users", "workspaces", "config"].map(table => rawDb.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get());
describe("dark registration endpoints", () => {
  beforeEach(async () => {
    await resetDatabase(); rawDb.exec("DELETE FROM registration_invites");
    await auth.createUser({ username: "owner", password: "safe-owner-password", displayName: "Owner", role: "manager" });
    app = express(); app.use("/api/auth", createAuthRouter(auth)); app.use(errorHandler); config.LEADOS_REGISTRATION = "invite";
  });
  afterEach(() => { config.LEADOS_REGISTRATION = "off"; vi.useRealTimers(); });
  it("answers 404 while off before validation or rate counting", async () => {
    config.LEADOS_REGISTRATION = "off";
    for (let n = 0; n < 12; n++) {
      expect((await request("POST", "/signup", {})).body).toEqual({ error: "Not Found", status: 404 });
      expect((await request("GET", "/invite")).status).toBe(404);
    }
    config.LEADOS_REGISTRATION = "invite";
    expect((await request("GET", "/invite")).body).toEqual({ valid: false });
  });
  it("consumes a valid invite and returns a private canonical solo session", async () => {
    const invite = service.createInvite(); const before = counts();
    expect((await request("GET", `/invite?token=${invite.token}`)).body).toEqual({ valid: true });
    const response = await request("POST", "/signup", input(invite.token));
    expect(response.status).toBe(201); expect(response.headers["set-cookie"]).toMatch(/dcc_session=.*HttpOnly; SameSite=Lax/);
    expect(response.body.features).toEqual({ tasksPhase3: true, teamMode: "solo", oneOnOne: true, backups: false });
    expect(response.body.user).not.toHaveProperty("isInstallAdmin"); expect(response.body.user.workspaceId).not.toBe("default");
    const ws = response.body.user.workspaceId;
    expect(rawDb.prepare("SELECT is_install_admin FROM app_users WHERE username='friend'").get()).toEqual({ is_install_admin: 0 });
    expect(rawDb.prepare("SELECT value FROM config WHERE workspace_id=? AND key='attention_time_zone'").get(ws)).toEqual({ value: "Asia/Kolkata" });
    expect(rawDb.prepare("SELECT COUNT(*) AS n FROM tasks WHERE workspace_id=?").get(ws)).toEqual({ n: 0 });
    expect(counts()[0]).not.toEqual(before[0]); expect(service.checkInvite(invite.token)).toBe(false);
    expect((await request("POST", "/signup", { ...input(invite.token), username: "another" })).status).toBe(410);
  });
  it.each(["missing", "unknown", "expired", "revoked", "used"])("uses one error for %s invites before probing username existence", async state => {
    const invite = service.createInvite();
    if (state === "expired") rawDb.prepare("UPDATE registration_invites SET expires_at='2000-01-01' WHERE id=?").run(invite.id);
    if (state === "revoked") service.revokeInvite(invite.id);
    if (state === "used") rawDb.prepare("UPDATE registration_invites SET used_at='2026-01-01' WHERE id=?").run(invite.id);
    const before = counts(); const response = await request("POST", "/signup", { ...input(state === "missing" ? "" : state === "unknown" ? "unknown" : invite.token), username: "owner" });
    expect(response.body).toEqual({ error: "This invite link is no longer valid.", status: 410 }); expect(counts()).toEqual(before);
  });
  it("keeps a valid invite usable after a taken username, with no orphan", async () => {
    const invite = service.createInvite(); const before = counts();
    expect((await request("POST", "/signup", { ...input(invite.token), username: "OWNER" })).body).toEqual({ error: "That username is taken.", status: 409 });
    expect(counts()).toEqual(before); expect(service.checkInvite(invite.token)).toBe(true);
  });
  it.each(["admin", "root", "system", "support", "leados", "default", "api", "null", "ab", "_friend", "friend@home", "a".repeat(41)])("refuses username %s", async username => {
    const invite = service.createInvite(); expect((await request("POST", "/signup", { ...input(invite.token), username })).status).toBe(400); expect(service.checkInvite(invite.token)).toBe(true);
  });
  it.each(["short", "password123", "friend", "p".repeat(201)])("refuses unsuitable passwords", async password => {
    const invite = service.createInvite(); expect((await request("POST", "/signup", { ...input(invite.token), password })).status).toBe(400);
  });
  it("refuses role/workspace/authority overrides and invalid zones", async () => {
    const invite = service.createInvite();
    for (const override of [{ workspaceId: "default" }, { role: "manager" }, { isInstallAdmin: true }, { timeZone: "Mars/Olympus" }]) expect((await request("POST", "/signup", { ...input(invite.token), ...override })).status).toBe(400);
  });
  it("rolls back all rows and leaves the invite usable on an injected transaction failure", async () => {
    const invite = service.createInvite(); const before = counts();
    rawDb.exec("CREATE TRIGGER fail_invite BEFORE UPDATE ON registration_invites BEGIN SELECT RAISE(ABORT,'injected registration crash'); END");
    try { await expect(service.signUp(input(invite.token))).rejects.toThrow("injected registration crash"); expect(counts()).toEqual(before); expect(service.checkInvite(invite.token)).toBe(true); }
    finally { rawDb.exec("DROP TRIGGER fail_invite"); }
  });
  it("allows only one use when two accounts race on the same invite", async () => {
    const invite = service.createInvite(); const results = await Promise.all([request("POST", "/signup", input(invite.token)), request("POST", "/signup", { ...input(invite.token), username: "racer" })]);
    expect(results.map(result => result.status).sort()).toEqual([201, 410]); expect(rawDb.prepare("SELECT COUNT(*) AS n FROM workspaces").get()).toEqual({ n: 2 });
  });
  it.each(["invite", "signup"])("limits %s per IP and expires the window", async endpoint => {
    vi.useFakeTimers(); const call = () => request(endpoint === "invite" ? "GET" : "POST", `/${endpoint}`, {});
    try {
      for (let n = 0; n < 10; n++) expect((await call()).status).not.toBe(429);
      const limited = await call(); expect(limited.status).toBe(429); expect(limited.headers["retry-after"]).toBe("900");
      vi.advanceTimersByTime(900000); expect((await call()).status).not.toBe(429);
    } finally { vi.useRealTimers(); }
  });
  it("limits login spraying despite changing usernames", async () => {
    for (let n = 0; n < 30; n++) expect((await request("POST", "/login", { username: `missing${n}`, password: "wrong" })).status).toBe(401);
    expect((await request("POST", "/login", { username: "another", password: "wrong" })).status).toBe(429);
    expect((await request("POST", "/login", { username: "owner", password: "safe-owner-password" }, "192.0.2.8")).status).toBe(200);
  });
});
