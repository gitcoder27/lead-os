import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { rawDb } from "../src/db/connection";
import { JiraClient } from "../src/jira/client";
import { config } from "../src/config";
import { RegistrationService } from "../src/services/registration.service";
import { createAssistantTools } from "../src/assistant/tools";
import { resetDatabase } from "./helpers/db";
import { invoke } from "./helpers/http";
import { seedTenants, workspaceSnapshot } from "./helpers/tenants";
import { seedRegisteredTenant } from "./helpers/registered-tenant";
import { foreignTenantProbes } from "./helpers/tenant-probes";
beforeEach(async () => { await resetDatabase(); rawDb.exec("DELETE FROM registration_invites"); });
afterEach(() => { config.LEADOS_REGISTRATION = "off"; vi.unstubAllEnvs(); vi.restoreAllMocks(); });
it("registers a private workspace and proves bidirectional reads, direct ids, search/palette, Copilot and CSV source isolation", async () => {
  vi.stubEnv("LEADOS_STRICT_WORKSPACE", "1"); config.LEADOS_REGISTRATION = "invite";
  vi.spyOn(JiraClient.prototype, "getFields").mockResolvedValue([]);
  vi.spyOn(globalThis, "fetch").mockImplementation(async () => { throw new Error("Unexpected outbound call in isolation fixture"); });
  const { app, friend, seed, day, O, before, snapshot, assistantServices } = await seedTenants();
  // Remove the helper's empty CLI tenant so this scenario has precisely A and registered B.
  const users = rawDb.prepare("SELECT id FROM app_users WHERE workspace_id=?").all(friend.workspaceId) as { id: number }[];
  for (const { id } of users) rawDb.prepare("DELETE FROM app_sessions WHERE user_id=?").run(id);
  for (const table of ["app_users", "config"]) rawDb.prepare(`DELETE FROM ${table} WHERE workspace_id=?`).run(friend.workspaceId);
  rawDb.prepare("DELETE FROM workspaces WHERE id=?").run(friend.workspaceId);
  const invite = new RegistrationService().createInvite();
  const signup = await invoke(app, { method: "POST", url: "/api/auth/signup?workspaceId=default", headers: { "x-workspace-id": "default" }, body: { inviteToken: invite.token, username: "registered", displayName: "Friend", password: "safe-friend-password", timeZone: "Pacific/Auckland" } });
  expect(signup.status).toBe(201); const workspace = signup.body.user.workspaceId; const cookie = signup.headers["set-cookie"]!;
  const B = (method: string, url: string, body?: unknown) => invoke(app, { method, url, body, headers: { cookie, "x-workspace-id": "default" } });
  expect(rawDb.prepare("SELECT COUNT(*) AS n FROM workspaces").get()).toEqual({ n: 2 });
  const noKey = await B("POST", "/api/assistant/chat", { message: "Read my tasks", date: day });
  expect(noKey.status).toBe(400); expect(noKey.body.error).toContain("Copilot is not configured");
  expect((await B("GET", "/api/config/ai")).body.hasApiKey).toBe(false);
  for (const [method, url, body] of foreignTenantProbes(seed, day)) {
    const response = await B(method, url, body); const payload = url.startsWith("/api/search?") ? { ...response.body, query: undefined } : response.body;
    expect(JSON.stringify(payload ?? "")).not.toMatch(/OWNERSECRET|OWNER-AI-KEY|ownerdev|Explicit workspace/);
    expect(response.status).toBeLessThan(500); expect(snapshot()).toEqual(before);
  }
  const bSeed = await seedRegisteredTenant(B, workspace, day); expect(bSeed.taskKey).toBe("T-1"); expect(seed.taskKey).toBe("T-1"); expect(snapshot()).toEqual(before);
  expect(JSON.stringify((await B("GET", "/api/tasks?view=all")).body)).toContain("FRIENDSECRET task");
  expect(JSON.stringify((await O("GET", "/api/tasks?view=all")).body)).toContain("OWNERSECRET task alpha");
  expect(JSON.stringify((await B("GET", `/api/notes/${day}`)).body)).toContain("FRIENDSECRET note");
  for (const [call, foreign, blocked] of [[B, seed, /OWNERSECRET|OWNER-AI-KEY|ownerdev/], [O, bSeed, /FRIENDSECRET|FRIEND-AI-KEY|FRIEND-JIRA-KEY/]] as const) {
    for (const [method, originalUrl] of foreignTenantProbes(foreign, day).filter(([verb]) => verb === "GET")) {
      const url = call === O ? originalUrl.replaceAll("OWN-1", "FRIEND-1").replaceAll("OWNERSECRET", "FRIENDSECRET").replaceAll("ownersecret", "friendsecret") : originalUrl;
      const otherWorkspace = call === B ? "default" : workspace;
      const otherBefore = workspaceSnapshot(otherWorkspace);
      const response = await call(method, url); const payload = url.startsWith("/api/search?") ? { ...response.body, query: undefined } : response.body;
      expect(response.status, url).toBeLessThan(500); expect(JSON.stringify(payload ?? ""), url).not.toMatch(blocked);
      expect(workspaceSnapshot(otherWorkspace), `${url} changed the other workspace`).toEqual(otherBefore);
    }
  }
  for (const [call, foreign, ws] of [[B, seed, "default"], [O, bSeed, workspace]] as const) {
    const hash = workspaceSnapshot(ws);
    for (const url of [`/api/projects/${foreign.projectId}`, `/api/project-tracks/${foreign.trackId}`, `/api/contacts/${foreign.contactId}`, `/api/assistant/conversations/${foreign.conversationId}`]) expect([403, 404]).toContain((await call("DELETE", url)).status);
    expect(workspaceSnapshot(ws)).toEqual(hash);
  }
  for (const [managerAccountId, workspaceId, blocked] of [["owner", "default", /FRIENDSECRET/], ["registered", workspace, /OWNERSECRET/]] as const) {
    const context = { managerAccountId, workspaceId, date: day, actor: { type: "manager" as const, accountId: managerAccountId }, services: assistantServices };
    for (const [name, args] of [["get_task", { taskKey: "T-1" }], ["search_workspace", { query: "SECRET" }], ["list_notes", {}], ["get_today_snapshot", { date: day }]] as const) {
      const tool = createAssistantTools(true).find(tool => tool.name === name)!;
      const otherWorkspace = workspaceId === "default" ? workspace : "default";
      const otherBefore = workspaceSnapshot(otherWorkspace);
      const result = await tool.execute(args, context);
      expect(JSON.stringify(result)).not.toMatch(blocked);
      if (name === "get_task") expect(JSON.stringify(result)).toContain(workspaceId === "default" ? "OWNERSECRET task alpha" : "FRIENDSECRET task");
      expect(workspaceSnapshot(otherWorkspace)).toEqual(otherBefore);
    }
  }
  // The product exports CSV from these scoped lists; there is no server export endpoint (§4.8).
  expect(JSON.stringify((await B("GET", "/api/tasks?view=all")).body)).not.toContain("OWNERSECRET");
  expect(JSON.stringify((await O("GET", "/api/tasks?view=all")).body)).not.toContain("FRIENDSECRET");
  const ownerAfterOwnReads = snapshot(); const friendAfterOwnReads = workspaceSnapshot(workspace);
  for (const table of ["tasks", "daily_notes", "config", "app_users", "projects", "one_on_one_sessions"]) expect(ownerAfterOwnReads[table]).toEqual(before[table]);
  await B("POST", "/api/auth/logout");
  const login = await invoke(app, { method: "POST", url: "/api/auth/login", body: { username: "owner", password: "secret123" } });
  expect(login.body.user.workspaceId).toBe("default"); expect(snapshot()).toEqual(ownerAfterOwnReads); expect(workspaceSnapshot(workspace)).toEqual(friendAfterOwnReads);
}, 30000);
