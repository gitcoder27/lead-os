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
