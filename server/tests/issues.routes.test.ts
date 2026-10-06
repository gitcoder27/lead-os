import { describe, expect, it, vi } from "vitest";
import express from "express";
import { createIssuesRouter } from "../src/routes/issues";
import { notFoundHandler, errorHandler } from "../src/middleware/errorHandler";
import { invoke } from "./helpers/http";
import type { IssueService } from "../src/services/issue.service";

function createTestApp(issueService: Partial<IssueService>) {
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
  app.use("/api/issues", createIssuesRouter(issueService as IssueService));
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

describe("issues routes", () => {
  it("rejects invalid issue list query values with 400", async () => {
    const issueService = {
      getPage: vi.fn(async () => ({ issues: [], total: 0, nextOffset: null })),
    };
    const app = createTestApp(issueService);

    const res = await invoke(app, {
      method: "GET",
      url: "/api/issues?filter=surprise&sort=created&order=desc",
    });

    expect(res.status).toBe(400);
    expect(issueService.getPage).not.toHaveBeenCalled();
  });

  it("passes validated issue list query values into the service", async () => {
    const issueService = {
      getPage: vi.fn(async () => ({ issues: [], total: 0, nextOffset: null })),
    };
    const app = createTestApp(issueService);

    const res = await invoke(app, {
      method: "GET",
      url: "/api/issues?filter=blocked&sort=updated&order=asc&trackerDate=2026-03-07&tags=1,2&noTags=false",
    });

    expect(res.status).toBe(200);
    expect(issueService.getPage).toHaveBeenCalledWith(
      expect.objectContaining({
        filter: "blocked",
        sort: "updated",
        order: "asc",
        trackerDate: "2026-03-07",
        tagIds: [1, 2],
        noTags: false,
      }),
      { limit: 200, offset: 0 },
      "default"
    );
  });

  it("aligns comment creation with the shared ok response contract", async () => {
    const issueService = {
      addComment: vi.fn(async () => undefined),
    };
    const app = createTestApp(issueService);

    const res = await invoke(app, {
      method: "POST",
      url: "/api/issues/AM-123/comments",
      body: { text: "Reviewed with Jira owner" },
    });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ ok: true });
    expect(issueService.addComment).toHaveBeenCalledWith("AM-123", "Reviewed with Jira owner", "default");
  });
});

describe('execution validation', () => {
  it('accepts project digits/underscores and explicit null clears', async () => {
    const update = vi.fn(async () => ({ jiraKey: 'AB2_ENG-1' }));
    const response = await invoke(createTestApp({ update } as unknown as Partial<IssueService>), {
      method: 'PATCH',
      url: '/api/issues/AB2_ENG-1',
      body: { assigneeId: null, dueDate: null, analysisNotes: null },
    });
    expect(response.status).toBe(200);
    expect(update).toHaveBeenCalledWith(
      'AB2_ENG-1',
      { assigneeId: null, dueDate: null, analysisNotes: null },
      'default',
    );
  });
  it('rejects impossible calendar dates and empty assignees before writing', async () => {
    const update = vi.fn();
    const app = createTestApp({ update });
    for (const body of [{ dueDate: '2026-02-30' }, { assigneeId: '' }, {}, { statusName: 'Done' }]) {
      expect((await invoke(app, { method: 'PATCH', url: '/api/issues/AB2-1', body })).status).toBe(400);
    }
    expect(update).not.toHaveBeenCalled();
  });
  it('rejects duplicates and more than twenty targets, and forwards guarded transitions', async () => {
    const bulk = vi.fn(async () => ({ results: [] }));
    const transition = vi.fn(async () => ({}));
    const app = createTestApp({ bulk, transition } as unknown as Partial<IssueService>);
    const item = { key: 'AB2-1', operation: { kind: 'restore' } };
    for (const items of [[item, item], Array.from({ length: 21 }, (_, i) => ({ ...item, key: `AB2-${i + 1}` }))])
      expect((await invoke(app, { method: 'POST', url: '/api/issues/bulk', body: { items } })).status).toBe(400);
    expect(bulk).not.toHaveBeenCalled();
    const body = { transitionId: '21', expectedStatus: { name: 'Open', category: 'new' } };
    expect((await invoke(app, { method: 'POST', url: '/api/issues/AB2-1/transition', body })).status).toBe(200);
    expect(transition).toHaveBeenCalledWith('AB2-1', '21', body.expectedStatus, 'default');
  });
});


it("validates bounded paging and returns filter-wide totals", async () => {
  const getPage = vi.fn(async () => ({ issues: [{ jiraKey: "AM-2" }], total: 8, nextOffset: 2 }));
  const app = createTestApp({ getPage } as unknown as Partial<IssueService>);
  const response = await invoke(app, { method: "GET", url: "/api/issues?filter=blocked&limit=1&offset=1" });
  expect(response.body).toEqual({ issues: [{ jiraKey: "AM-2" }], total: 8, nextOffset: 2 });
  expect(getPage).toHaveBeenCalledWith(expect.objectContaining({ filter: "blocked" }), { limit: 1, offset: 1 }, "default");
  for (const query of ["limit=0", "limit=501", "offset=-1", "offset=1.5", "limit=NaN"]) {
    expect((await invoke(app, { method: "GET", url: `/api/issues?${query}` })).status).toBe(400);
  }
});
