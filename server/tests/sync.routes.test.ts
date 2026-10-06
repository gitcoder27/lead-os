import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import { createSyncRouter } from "../src/routes/sync";
import { notFoundHandler, errorHandler } from "../src/middleware/errorHandler";
import { invoke } from "./helpers/http";
import { SyncEngine } from "../src/sync/engine";
import { rawDb } from "../src/db/connection";
import { resetDatabase } from "./helpers/db";

function createTestApp(syncEngine: Partial<SyncEngine>, workspaceId = "default") {
  const app = express();
  app.use((req, _res, next) => {
    req.auth = {
      sessionId: "test-session",
      user: {
        username: "manager",
        accountId: "manager",
        workspaceId,
        displayName: "Manager",
        role: "manager",
      },
    };
    next();
  });
  app.use("/api/sync", createSyncRouter(syncEngine as SyncEngine));
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

describe("sync routes", () => {
  beforeEach(resetDatabase);

  function statusApp(workspaceId = "default") {
    const engine = new SyncEngine();
    vi.spyOn(engine, "isAutoSyncEnabled").mockResolvedValue(false);
    vi.spyOn(engine, "isJiraConfigured").mockResolvedValue(true);
    vi.spyOn(engine, "getSyncScope").mockResolvedValue({ mode: "team_and_unassigned", rosterSize: 0 });
    return createTestApp(engine, workspaceId);
  }

  it("keeps the last successful timestamp when a later run fails", async () => {
    const app = statusApp();
    const insert = rawDb.prepare("INSERT INTO sync_log (workspace_id, started_at, completed_at, status, error_message) VALUES (?, ?, ?, ?, ?)");
    const successAt = "2026-03-07T08:00:00.000Z";
    const failureAt = "2026-03-07T09:00:00.000Z";
    insert.run("default", successAt, successAt, "success", null);
    const success = await invoke(app, { method: "GET", url: "/api/sync/status" });
    expect(success.body).toMatchObject({ status: "idle", lastSyncedAt: successAt, lastSuccessAt: successAt });

    insert.run("default", failureAt, failureAt, "error", "Jira API error (500): raw body");
    const failure = await invoke(app, { method: "GET", url: "/api/sync/status" });
    expect(failure.status).toBe(200);
    expect(failure.body).toMatchObject({ status: "error", lastSyncedAt: failureAt, lastSuccessAt: successAt });
  });

  it.each([false, true])("has no lastSuccessAt for failures only, even with another workspace's success (%s)", async (otherSuccess) => {
    const at = "2026-03-07T08:00:00.000Z";
    const insert = rawDb.prepare("INSERT INTO sync_log (workspace_id, started_at, completed_at, status) VALUES (?, ?, ?, ?)");
    insert.run("failures-only", at, at, "error");
    if (otherSuccess) insert.run("default", at, at, "success");
    const res = await invoke(statusApp("failures-only"), { method: "GET", url: "/api/sync/status" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "error", lastSyncedAt: at });
    expect(res.body).not.toHaveProperty("lastSuccessAt");
  });
  it("returns 202 when a sync request is skipped because another run is active", async () => {
    const now = "2026-03-07T08:00:00.000Z";
    const app = createTestApp({
      syncNow: vi.fn(async () => ({
        status: "skipped",
        reason: "already_running",
        issuesSynced: 0,
        startedAt: now,
        completedAt: now,
      })),
    });

    const res = await invoke(app, { method: "POST", url: "/api/sync" });

    expect(res.status).toBe(202);
    expect(res.body).toEqual({
      status: "skipped",
      reason: "already_running",
      issuesSynced: 0,
      startedAt: now,
      completedAt: now,
    });
  });

  it("reports autoSyncEnabled in the sync status payload", async () => {
    const app = createTestApp({
      getLastSyncLog: vi.fn(async () => undefined),
      getLastSuccessfulSyncLog: vi.fn(async () => undefined),
      getRuntimeStatus: vi.fn(() => ({ status: "idle" as const, errorMessage: undefined })),
      isAutoSyncEnabled: vi.fn(async () => false),
      isJiraConfigured: vi.fn(async () => true),
      getSyncScope: vi.fn(async () => ({ mode: "team_and_unassigned" as const, rosterSize: 3 })),
    });

    const res = await invoke(app, { method: "GET", url: "/api/sync/status" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      status: "idle",
      autoSyncEnabled: false,
      jiraConfigured: true,
      syncScope: { mode: "team_and_unassigned", rosterSize: 3 },
    });
  });

  it("reports jiraConfigured: false so the client can hide sync controls (docs/56 P2-03)", async () => {
    const app = createTestApp({
      getLastSyncLog: vi.fn(async () => undefined),
      getLastSuccessfulSyncLog: vi.fn(async () => undefined),
      getRuntimeStatus: vi.fn(() => ({ status: "idle" as const, errorMessage: undefined })),
      isAutoSyncEnabled: vi.fn(async () => true),
      isJiraConfigured: vi.fn(async () => false),
      getSyncScope: vi.fn(async () => ({ mode: "team_and_unassigned" as const, rosterSize: 0 })),
    });

    const res = await invoke(app, { method: "GET", url: "/api/sync/status" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ jiraConfigured: false, status: "idle" });
  });

  it("returns 202 with jira_not_configured when there is nothing to sync", async () => {
    const now = "2026-03-07T08:00:00.000Z";
    const app = createTestApp({
      syncNow: vi.fn(async () => ({ status: "skipped", reason: "jira_not_configured", issuesSynced: 0, startedAt: now, completedAt: now })),
    });

    const res = await invoke(app, { method: "POST", url: "/api/sync" });

    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({ status: "skipped", reason: "jira_not_configured" });
  });
});
