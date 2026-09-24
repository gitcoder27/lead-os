import { beforeEach, describe, expect, it } from "vitest";
import express from "express";
import { invoke } from "./helpers/http";
import { db, resetDatabase } from "./helpers/db";
import { issues } from "../src/db/schema";
import { errorHandler, notFoundHandler } from "../src/middleware/errorHandler";
import { requireManager } from "../src/middleware/auth";
import { AuthService } from "../src/services/auth.service";
import { createSearchRouter } from "../src/routes/search";
import { SearchService } from "../src/services/search.service";

beforeEach(async () => {
  await resetDatabase();
});

function createTestApp(options: { authenticated: boolean } = { authenticated: true }) {
  const app = express();
  app.use(express.json());

  if (options.authenticated) {
    app.use((req, _res, next) => {
      req.auth = {
        sessionId: "test-session",
        user: {
          username: "manager",
          accountId: "manager-a",
          workspaceId: "default",
          displayName: "Manager A",
          role: "manager",
        },
      };
      next();
    });
  }

  app.use("/api/search", requireManager(new AuthService()), createSearchRouter(new SearchService()));
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

describe("GET /api/search", () => {
  it("returns grouped search results", async () => {
    await db.insert(issues).values({
      jiraKey: "PROJ-1",
      summary: "Payment provider timeouts",
      priorityName: "High",
      priorityId: "1",
      statusName: "In Progress",
      statusCategory: "indeterminate",
      teamScopeState: "in_team",
      syncScopeState: "active",
      flagged: 0,
      createdAt: "2026-03-01T00:00:00.000Z",
      updatedAt: "2026-03-05T00:00:00.000Z",
      syncedAt: "2026-03-05T00:00:00.000Z",
    });

    const response = await invoke(createTestApp(), { method: "GET", url: "/api/search?q=payment" });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      query: "payment",
      issues: [
        expect.objectContaining({ jiraKey: "PROJ-1", summary: "Payment provider timeouts" }),
      ],
      deskItems: [],
      checkIns: [],
      trackerItems: [],
      developers: [],
      notes: [],
    });
  });

  it("returns 400 when the query is missing", async () => {
    const response = await invoke(createTestApp(), { method: "GET", url: "/api/search" });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ status: 400 });
    expect(typeof response.body.error).toBe("string");
  });

  it("returns 401 for unauthenticated requests", async () => {
    const response = await invoke(createTestApp({ authenticated: false }), {
      method: "GET",
      url: "/api/search?q=payment",
    });

    expect(response.status).toBe(401);
    expect(response.body).toMatchObject({ status: 401 });
  });
});
