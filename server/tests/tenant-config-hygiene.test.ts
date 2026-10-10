import { beforeEach, describe, expect, it, vi } from "vitest";
import { rawDb } from "../src/db/connection";
import { resetDatabase } from "./helpers/db";
import { seedTenants } from "./helpers/tenants";

describe("install configuration boundaries", () => {
  beforeEach(resetDatabase);
  it.each(["backupEnabled", "backupIntervalMinutes", "backupRetentionDays", "backupMaxScheduledSnapshots", "backupDirectory", "backupOnStartup", "backupStartupMaxAgeHours", "backupBeforeReset"])("rejects %s before writing any friend's configuration", async (field) => {
    const { F, friend, snapshot, before } = await seedTenants();
    const value = field === "backupDirectory" ? "/tmp/friend-backups" : field.includes("Enabled") || field.includes("OnStartup") || field.includes("BeforeReset") ? false : 10;
    const ownBefore = rawDb.prepare("SELECT * FROM config WHERE workspace_id=? ORDER BY key").all(friend.workspaceId);
    const response = await F("PUT", "/api/config", { jiraBaseUrl: "https://friend.atlassian.net", jiraEmail: "friend@example.com", jiraProjectKey: "FR", [field]: value });
    expect(response.status).toBe(403);
    expect(rawDb.prepare("SELECT * FROM config WHERE workspace_id=? ORDER BY key").all(friend.workspaceId)).toEqual(ownBefore);
    expect(snapshot()).toEqual(before);
  });
  it("hides the backup directory from nonowners", async () => {
    const { F, O } = await seedTenants();
    expect((await F("GET", "/api/config")).body).not.toHaveProperty("backupDirectory");
    expect((await O("GET", "/api/config")).body).toHaveProperty("backupDirectory");
  });
  it("passes only the caller's session workspace to cache invalidation", async () => {
    const { app, friend, friendCookie, O, F, day } = await seedTenants();
    const todayUrl = `/api/today?date=${day}&tz=UTC`;
    await O("GET", todayUrl); await F("GET", todayUrl);
    expect((await O("GET", todayUrl)).headers["x-today-cache"]).toBe("hit");
    expect((await F("GET", todayUrl)).headers["x-today-cache"]).toBe("hit");
    const { TodayService } = await import("../src/services/today.service");
    const clear = vi.spyOn(TodayService.prototype, "clearTodayCache");
    const server = app.listen(0, "127.0.0.1");
    await new Promise<void>(resolve => server.once("listening", resolve));
    const port = (server.address() as { port: number }).port;
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/config/team-mode?workspaceId=default`, { method: "PUT", headers: { "Content-Type": "application/json", Cookie: friendCookie }, body: JSON.stringify({ teamMode: "solo", workspaceId: "default" }) });
      await response.json();
      expect(response.status).toBe(200);
      expect(clear).toHaveBeenCalledWith(friend.workspaceId);
      expect(clear.mock.calls.every(([scope]) => scope === friend.workspaceId)).toBe(true);
      expect((await O("GET", todayUrl)).headers["x-today-cache"]).toBe("hit");
      expect((await F("GET", todayUrl)).headers["x-today-cache"]).toBe("miss");
    } finally { clear.mockRestore(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
  });
});

describe('install-owner Settings outside the default workspace', () => {
  beforeEach(resetDatabase);
  it.each(['/api/config', '/api/config/settings'])('writes the install backup schedule through %s while keeping Jira scoped', async (url) => {
    const { F, friend } = await seedTenants();
    // A trusted operator grant is supported by auth:create-user --install-admin.
    rawDb.prepare("UPDATE app_users SET is_install_admin=1 WHERE username='friend'").run();
    const response = await F('PUT', url, {
      ...(url === '/api/config' ? { jiraBaseUrl: 'https://friend.atlassian.net', jiraEmail: 'friend@example.com', jiraProjectKey: 'FR' } : {}),
      backupEnabled: false, backupIntervalMinutes: 60,
    });
    expect(response.status).toBe(200);
    expect(rawDb.prepare("SELECT value FROM config WHERE workspace_id='default' AND key='backup_interval_minutes'").get()).toEqual({ value: '60' });
    expect(rawDb.prepare("SELECT count(*) AS n FROM config WHERE workspace_id=? AND key LIKE 'backup_%'").get(friend.workspaceId)).toEqual({ n: 0 });
    const configuration = (await F('GET', '/api/config')).body;
    expect(configuration.backupEnabled).toBe(false);
    expect(configuration.backupIntervalMinutes).toBe(60);
    if (url === '/api/config') {
      expect(configuration.jiraProjectKey).toBe('FR');
      expect(rawDb.prepare("SELECT value FROM config WHERE workspace_id='default' AND key='jira_project_key'").get()).not.toEqual({ value: 'FR' });
    }
  });
});
