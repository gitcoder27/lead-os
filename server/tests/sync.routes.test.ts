import { describe, expect, it, vi } from "vitest";
import express from "express";
import { createSyncRouter } from "../src/routes/sync";
import { notFoundHandler, errorHandler } from "../src/middleware/errorHandler";
import { invoke } from "./helpers/http";
import type { SyncEngine } from "../src/sync/engine";

function createTestApp(syncEngine: Partial<SyncEngine>) {
  const app = express();
  app.use((req, _res, next) => {
    req.auth = {
      sessionId: "test-session",
      user: {
        username: "manager",
        accountId: "manager",
        workspaceId: "default",
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
      getRuntimeStatus: vi.fn(() => ({ status: "idle" as const, errorMessage: undefined })),
      isAutoSyncEnabled: vi.fn(async () => false),
      isJiraConfigured: vi.fn(async () => true),
    });

    const res = await invoke(app, { method: "GET", url: "/api/sync/status" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      status: "idle",
      autoSyncEnabled: false,
      jiraConfigured: true,
    });
  });

  it("reports jiraConfigured: false so the client can hide sync controls (docs/56 P2-03)", async () => {
    const app = createTestApp({
      getLastSyncLog: vi.fn(async () => undefined),
      getRuntimeStatus: vi.fn(() => ({ status: "idle" as const, errorMessage: undefined })),
      isAutoSyncEnabled: vi.fn(async () => true),
      isJiraConfigured: vi.fn(async () => false),
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
