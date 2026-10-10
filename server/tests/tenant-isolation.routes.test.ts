import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeWorkspaceId } from "../src/services/workspace.service";
import { serializeSessionCookie } from "../src/services/auth.service";
import { getJiraApiToken } from "../src/runtime-credentials";
import { resetDatabase } from "./helpers/db";
import { invoke } from "./helpers/http";
import { seedTenants } from "./helpers/tenants";

interface RouteLayer {
  regexp: RegExp;
  route?: { path: string; methods: Record<string, boolean> };
  handle: { stack?: RouteLayer[] };
}

// The committed inventory forces a review when any route is added or changed.
function manifest(stack: RouteLayer[], probes: Array<[string, string, unknown?]>, prefix = "") {
  const entries: Array<{ route: string; scope: string; proof: string }> = [];
  for (const layer of stack) {
    if (layer.route) {
      const path = `${prefix}${layer.route.path === "/" && prefix ? "" : layer.route.path}`;
      for (const method of Object.keys(layer.route.methods)) {
        const matcher = new RegExp(`^${path.replace(/:[^/]+/g, "[^/]+")}/?$`);
        const probed = probes.some(([verb, url]) => verb.toLowerCase() === method && matcher.test(url.split("?")[0]!));
        const publicRoute = ["/api/health", "/api/auth/bootstrap", "/api/auth/login", "/api/auth/change-password", "/api/auth/register", "/api/auth/signup", "/api/auth/invite"].includes(path);
        const install = path.startsWith("/api/backups");
        entries.push({
          route: `${method.toUpperCase()} ${path}`,
          scope: publicRoute ? "public (register: bootstrap or manager)" : install ? "install admin" : path.startsWith("/api/my-day") ? "developer" : path.startsWith("/api/task-inbox") ? "authenticated principal" : "workspace manager",
          proof: probed ? "direct-id/scoped API probe" : publicRoute || install ? "auth/install boundary regression" : `skipped: focused ${prefix} route tests; no valid fixture in this matrix`,
        });
      }
    } else if (layer.handle.stack) {
      const mount = layer.regexp.source.split("\\/?")[0]!.replace(/^\^/, "").replace(/\\\//g, "/");
      entries.push(...manifest(layer.handle.stack, probes, `${prefix}${mount}`));
    }
  }
  return entries.sort((a, b) => a.route.localeCompare(b.route));
}

describe("permanent tenant isolation guard", () => {
  beforeEach(async () => { await resetDatabase(); });
  afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

  it("refuses omitted workspace scope in strict mode, including runtime credentials", () => {
    vi.stubEnv("LEADOS_STRICT_WORKSPACE", "1");
    expect(() => normalizeWorkspaceId()).toThrow("Explicit workspace");
    expect(() => getJiraApiToken()).toThrow("Explicit workspace");
    expect(normalizeWorkspaceId("default")).toBe("default");
  });

  it("detects a probed service call with its workspace argument removed", async () => {
    vi.stubEnv("LEADOS_STRICT_WORKSPACE", "1");
    const { app, search, friendCookie } = await seedTenants();
    const original = search.search.bind(search);
    vi.spyOn(search, "search").mockImplementation((query, _workspace, manager) => original(query, undefined, manager));
    const response = await invoke(app, { method: "GET", url: "/api/search?q=owner", headers: { cookie: friendCookie } });
    expect(response.status).toBe(500);
    expect(response.body.error).toContain("Explicit workspace");
  });

  it("isolates developer sessions and refuses body/header/query workspace overrides", async () => {
    vi.stubEnv("LEADOS_STRICT_WORKSPACE", "1");
    const { app, authService, friend, F, seed, snapshot, before, day } = await seedTenants();
    const member = await F("POST", "/api/team/developers/manual", { displayName: "Friend developer", workspaceId: "default" });
    expect(member.status).toBe(201);
    const developerId = member.body.developer.accountId;
    await authService.createUser({ username: "friend-developer", displayName: "Friend developer", password: "secret123", role: "developer", developerAccountId: developerId, workspaceId: friend.workspaceId });
    const session = await authService.authenticate("friend-developer", "secret123");
    const cookie = serializeSessionCookie(session.sessionId, authService.sessionMaxAgeSeconds);
    for (const url of [`/api/my-day?date=${day}`, `/api/my-day/tasks?date=${day}`, `/api/my-day/tasks/${seed.taskKey}/detail`, "/api/my-day/issues", "/api/task-inbox"]) {
      const response = await invoke(app, { method: "GET", url, headers: { cookie, "x-workspace-id": "default" } });
      expect([200, 404]).toContain(response.status);
      expect(JSON.stringify(response.body)).not.toContain("OWNERSECRET");
    }
    const foreignWrite = await invoke(app, { method: "PATCH", url: `/api/my-day/tasks/${seed.taskKey}`, body: { date: day, title: "Changed" }, headers: { cookie } });
    expect(foreignWrite.status).toBe(404);
    const write = await invoke(app, { method: "PATCH", url: `/api/my-day/tasks/${seed.taskKey}?workspaceId=default`, body: { date: day, title: "Changed", workspaceId: "default" }, headers: { cookie, "x-workspace-id": "default" } });
    expect(write.status).toBe(400);
    expect(write.body.error).toContain("workspaceId");
    expect(snapshot()).toEqual(before);
  });

  it("keeps all owner table families private under direct-id and spoofed-scope probes", async () => {
    vi.stubEnv("LEADOS_STRICT_WORKSPACE", "1");
    const { app, probes, friendCookie, snapshot, before } = await seedTenants();
    expect(manifest(app._router.stack, probes)).toMatchSnapshot();
    for (const [method, url, body] of probes) {
      const response = await invoke(app, {
        method,
        url: `${url}${url.includes("?") ? "&" : "?"}workspaceId=default&workspace_id=default`,
        body,
        headers: { cookie: friendCookie, "x-workspace-id": "default" },
      });
      // Search legitimately echoes the query; inspect only its actual results for markers.
      const payload = url.startsWith("/api/search?") && response.body ? { ...response.body, query: undefined } : response.body;
      expect(JSON.stringify(payload ?? ""), `${method} ${url}`).not.toMatch(/OWNERSECRET|OWNER-AI-KEY|ownerdev|Explicit workspace/);
      expect(response.status, `${method} ${url}: ${JSON.stringify(response.body)}`).toBeLessThan(500);
      expect(snapshot(), `${method} ${url} changed owner rows`).toEqual(before);
    }
  }, 30000);
});
