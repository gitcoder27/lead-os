import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import { createSuggestionsRouter } from "../src/routes/suggestions";
import { AutomationService } from "../src/services/automation.service";
import type { IssueService } from "../src/services/issue.service";
import { errorHandler, notFoundHandler } from "../src/middleware/errorHandler";
import { invoke } from "./helpers/http";

function createTestApp(issue: { jiraKey: string; labels: string[]; createdAt: string } | undefined) {
  const getById = vi.fn(async () => issue);
  const app = express();
  app.use((req, _res, next) => {
    req.auth = {
      sessionId: "s",
      user: { username: "manager", accountId: "manager", workspaceId: "default", displayName: "Manager", role: "manager" },
    };
    next();
  });
  app.use(
    "/api/suggestions",
    createSuggestionsRouter(new AutomationService({ suggestAssignee: async () => [] } as any), { getById } as unknown as IssueService)
  );
  app.use(notFoundHandler);
  app.use(errorHandler);
  return { app, getById };
}

describe("suggestions routes (docs/56 P5-02)", () => {
  beforeEach(() => {
    // Only the clock: the error handler and the response stream need real timers.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-03-20T09:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("counts the due-date target from the issue's creation, not from now", async () => {
    const { app, getById } = createTestApp({ jiraKey: "AM-1", labels: [], createdAt: "2026-03-19T10:00:00.000Z" });

    const res = await invoke(app, { method: "GET", url: "/api/suggestions/duedate/High?issue=AM-1" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ suggested: "2026-03-22", reason: "High priority target is 3 calendar days from creation." });
    expect(getById).toHaveBeenCalledWith("AM-1", undefined, "default");
  });

  it("proposes no date when the issue's target has already passed (UX-32)", async () => {
    const { app } = createTestApp({ jiraKey: "AM-1", labels: [], createdAt: "2026-03-01T10:00:00.000Z" });

    const res = await invoke(app, { method: "GET", url: "/api/suggestions/duedate/High?issue=AM-1" });

    expect(res.status).toBe(200);
    expect(res.body.suggested).toBeNull();
    expect(res.body.reason).toMatch(/already passed/);
  });

  it("keeps the old from-now behaviour when no issue is given", async () => {
    const { app, getById } = createTestApp(undefined);

    const res = await invoke(app, { method: "GET", url: "/api/suggestions/duedate/High" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ suggested: "2026-03-23" });
    expect(getById).not.toHaveBeenCalled();
  });

  it("404s for an unknown issue", async () => {
    const { app } = createTestApp(undefined);

    expect((await invoke(app, { method: "GET", url: "/api/suggestions/duedate/High?issue=AM-9" })).status).toBe(404);
  });

  it("accepts project keys with digits and underscores (P5-02 review)", async () => {
    const { app, getById } = createTestApp({ jiraKey: "AB2_X-12", labels: [], createdAt: "2026-03-01T10:00:00.000Z" });

    expect((await invoke(app, { method: "GET", url: "/api/suggestions/duedate/High?issue=AB2_X-12" })).status).toBe(200);
    expect(getById).toHaveBeenCalledWith("AB2_X-12", undefined, "default");
  });

  it("400s for a malformed issue key", async () => {
    const { app } = createTestApp(undefined);

    expect((await invoke(app, { method: "GET", url: "/api/suggestions/duedate/High?issue=nope" })).status).toBe(400);
  });

  it("marks a label-less priority suggestion as the default fallback", async () => {
    const { app } = createTestApp({ jiraKey: "AM-1", labels: ["misc"], createdAt: "2026-03-01T10:00:00.000Z" });

    const res = await invoke(app, { method: "GET", url: "/api/suggestions/priority/AM-1" });

    expect(res.body).toMatchObject({ suggested: "Medium", isDefault: true });
  });

  it("does not flag a label-based priority suggestion as default", async () => {
    const { app } = createTestApp({ jiraKey: "AM-1", labels: ["production"], createdAt: "2026-03-01T10:00:00.000Z" });

    const res = await invoke(app, { method: "GET", url: "/api/suggestions/priority/AM-1" });

    expect(res.body).toMatchObject({ suggested: "Highest" });
    expect((res.body as { isDefault?: boolean }).isDefault).toBeUndefined();
  });
});
