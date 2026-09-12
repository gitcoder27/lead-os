import { beforeEach, describe, expect, it } from "vitest";
import express from "express";
import { invoke } from "./helpers/http";
import { db, resetDatabase } from "./helpers/db";
import { developers } from "../src/db/schema";
import { errorHandler, notFoundHandler } from "../src/middleware/errorHandler";
import { requireManager } from "../src/middleware/auth";
import { AuthService, serializeSessionCookie } from "../src/services/auth.service";
import { createPreferencesRouter } from "../src/routes/preferences";
import { NavPreferencesService } from "../src/services/nav-preferences.service";

const authService = new AuthService();
const service = new NavPreferencesService();

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/preferences", requireManager(authService), createPreferencesRouter(service));
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

async function loginCookie(username: string, password = "secret123"): Promise<string> {
  const { sessionId } = await authService.authenticate(username, password);
  return serializeSessionCookie(sessionId, authService.sessionMaxAgeSeconds);
}

const DEFAULT_LAYOUT = {
  topNav: ["work", "team", "desk"],
  moreNav: ["follow-ups", "notes", "meetings"],
};

beforeEach(async () => {
  await resetDatabase();
  await db.insert(developers).values({
    accountId: "dev-1",
    displayName: "Dev One",
    isActive: 1,
  });
  await authService.createUser({
    username: "manager",
    displayName: "Manager One",
    password: "secret123",
    role: "manager",
  });
  await authService.createUser({
    username: "developer",
    displayName: "Dev One",
    password: "secret123",
    role: "developer",
    developerAccountId: "dev-1",
  });
});

describe("preferences routes auth", () => {
  it("returns 401 for unauthenticated requests", async () => {
    const app = createTestApp();
    for (const method of ["GET", "PUT"]) {
      const res = await invoke(app, { method, url: "/api/preferences/navigation", body: DEFAULT_LAYOUT });
      expect(res.status, `${method} /api/preferences/navigation`).toBe(401);
    }
  });

  it("returns 403 for developer users", async () => {
    const app = createTestApp();
    const cookie = await loginCookie("developer");
    for (const method of ["GET", "PUT"]) {
      const res = await invoke(app, {
        method,
        url: "/api/preferences/navigation",
        body: DEFAULT_LAYOUT,
        headers: { cookie },
      });
      expect(res.status, `${method} /api/preferences/navigation`).toBe(403);
    }
  });
});

describe("preferences routes happy path", () => {
  it("returns the default layout, then persists a saved layout", async () => {
    const app = createTestApp();
    const cookie = await loginCookie("manager");

    const initial = await invoke(app, {
      method: "GET",
      url: "/api/preferences/navigation",
      headers: { cookie },
    });
    expect(initial.status).toBe(200);
    expect(initial.body.preferences).toEqual(DEFAULT_LAYOUT);
    expect(initial.headers["cache-control"]).toBe("private, no-store");

    const custom = {
      topNav: ["notes", "desk"],
      moreNav: ["work", "team", "follow-ups", "meetings"],
    };
    const saved = await invoke(app, {
      method: "PUT",
      url: "/api/preferences/navigation",
      body: custom,
      headers: { cookie },
    });
    expect(saved.status).toBe(200);
    expect(saved.body.preferences).toEqual(custom);

    const reloaded = await invoke(app, {
      method: "GET",
      url: "/api/preferences/navigation",
      headers: { cookie },
    });
    expect(reloaded.body.preferences).toEqual(custom);
  });

  it("rejects layouts that duplicate or omit pages", async () => {
    const app = createTestApp();
    const cookie = await loginCookie("manager");

    const duplicate = await invoke(app, {
      method: "PUT",
      url: "/api/preferences/navigation",
      body: { topNav: ["work", "notes"], moreNav: ["team", "desk", "follow-ups", "notes", "meetings"] },
      headers: { cookie },
    });
    expect(duplicate.status).toBe(400);

    const missing = await invoke(app, {
      method: "PUT",
      url: "/api/preferences/navigation",
      body: { topNav: ["work"], moreNav: ["team"] },
      headers: { cookie },
    });
    expect(missing.status).toBe(400);
  });

  it("rejects unknown page ids at the schema layer", async () => {
    const app = createTestApp();
    const cookie = await loginCookie("manager");

    const res = await invoke(app, {
      method: "PUT",
      url: "/api/preferences/navigation",
      body: { topNav: ["work", "team", "desk", "settings"], moreNav: ["follow-ups", "notes"] },
      headers: { cookie },
    });
    expect(res.status).toBe(400);
  });
});
