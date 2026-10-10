import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { rawDb } from "../src/db/connection";
import { SettingsService } from "../src/services/settings.service";
import { SyncEngine } from "../src/sync/engine";
import { resetDatabase } from "./helpers/db";
import { seedTenants } from "./helpers/tenants";

describe("tenant scheduling boundaries", () => {
  beforeEach(async () => { await resetDatabase(); });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it("rejects a friend's 1ms interval before any config write", async () => {
    const { F, settings, friend, snapshot, before } = await seedTenants();
    const response = await F("PUT", "/api/config", { jiraBaseUrl: "https://friend.atlassian.net", jiraEmail: "friend@example.com", jiraProjectKey: "FR", syncIntervalMs: 1 });
    expect(response.status).toBe(400);
    expect(await settings.getConfigValue("sync_interval_ms", friend.workspaceId)).toBeUndefined();
    expect(snapshot()).toEqual(before);
  });

  it("saving a friend's auto-sync setting does not restart the shared timer", async () => {
    const { F, syncStub, snapshot, before } = await seedTenants();
    const restart = vi.spyOn(syncStub, "start");
    expect((await F("PUT", "/api/config/settings", { jiraAutoSyncEnabled: false })).status).toBe(200);
    expect(restart).not.toHaveBeenCalled();
    expect(snapshot()).toEqual(before);
  });

  it("clamps legacy persisted intervals to 5–1440 minutes on reads", async () => {
    rawDb.prepare("INSERT INTO config (workspace_id,key,value) VALUES (?, 'sync_interval_ms', ?)").run("default", "1");
    rawDb.prepare("INSERT INTO config (workspace_id,key,value) VALUES (?, 'sync_interval_ms', ?)").run("friend", "999999999");
    const settings = new SettingsService();
    expect(await settings.getSyncIntervalMs("default")).toBe(300000);
    expect(await settings.getSyncIntervalMs("friend")).toBe(86400000);
  });

  it("uses an idempotent fixed tick even when the owner disables auto-sync", async () => {
    vi.useFakeTimers();
    const settings = { getJiraAutoSyncEnabled: vi.fn(async () => false) } as unknown as SettingsService;
    const engine = new SyncEngine(settings);
    const tick = vi.spyOn(engine, "syncAllWorkspaces").mockResolvedValue([]);
    try {
      await engine.start();
      await engine.start();
      await vi.advanceTimersByTimeAsync(60000);
      expect(tick).toHaveBeenCalledTimes(1);
      expect(settings.getJiraAutoSyncEnabled).not.toHaveBeenCalled();
    } finally { engine.stop(); }
  });

  it("only syncs a workspace when its own interval is due, including failures", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-10T10:00:00Z"));
    const settings = {
      getJiraAutoSyncEnabled: vi.fn(async () => true),
      getSyncIntervalMs: vi.fn(async (workspace: string) => workspace === "default" ? 3600000 : 300000),
    } as unknown as SettingsService;
    const engine = new SyncEngine(settings);
    vi.spyOn(engine, "getSyncableWorkspaceIds").mockResolvedValue(["default", "friend"]);
    rawDb.prepare("INSERT INTO sync_log (workspace_id,started_at,status) VALUES (?, ?, ?)").run("default", "2026-10-10T09:30:00Z", "success");
    rawDb.prepare("INSERT INTO sync_log (workspace_id,started_at,status) VALUES (?, ?, ?)").run("friend", "2026-10-10T09:54:00Z", "error");
    const sync = vi.spyOn(engine, "syncNow").mockResolvedValue({ status: "success", issuesSynced: 0, startedAt: "", completedAt: "" });
    await engine.syncAllWorkspaces();
    expect(sync).toHaveBeenCalledExactlyOnceWith("friend");
  });
});
