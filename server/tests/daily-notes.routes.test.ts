import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import express from "express";
import { invoke } from "./helpers/http";
import { db, resetDatabase } from "./helpers/db";
import { dailyNotes, developers } from "../src/db/schema";
import { errorHandler, notFoundHandler } from "../src/middleware/errorHandler";
import { requireManager } from "../src/middleware/auth";
import { AuthService, serializeSessionCookie } from "../src/services/auth.service";
import { createNotesRouter } from "../src/routes/notes";
import { DailyNotesService } from "../src/services/daily-notes.service";

const authService = new AuthService();
const service = new DailyNotesService();

function createTestApp() {
  const app = express();
  app.use("/api/notes", express.json({ limit: "512kb" }));
  app.use("/api/notes", requireManager(authService), createNotesRouter(service));
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

async function loginCookie(username: string, password = "secret123"): Promise<string> {
  const { sessionId } = await authService.authenticate(username, password);
  return serializeSessionCookie(sessionId, authService.sessionMaxAgeSeconds);
}

const DATE = "2026-03-08";

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

describe("notes routes auth", () => {
  const routes: Array<{ method: string; url: string; body?: unknown }> = [
    { method: "GET", url: "/api/notes" },
    { method: "GET", url: "/api/notes/sources?itemIds=1" },
    { method: "GET", url: `/api/notes/${DATE}` },
    { method: "PUT", url: `/api/notes/${DATE}`, body: { body: "x", revision: 0 } },
    { method: "POST", url: `/api/notes/${DATE}/append`, body: { text: "x", requestId: randomUUID() } },
    {
      method: "POST",
      url: `/api/notes/${DATE}/follow-ups`,
      body: { date: DATE, title: "t", followUpAt: "2026-03-10T09:00:00.000Z", requestId: randomUUID() },
    },
  ];

  it("returns 401 for unauthenticated requests on every route family", async () => {
    const app = createTestApp();
    for (const route of routes) {
      const res = await invoke(app, { method: route.method, url: route.url, body: route.body });
      expect(res.status, `${route.method} ${route.url}`).toBe(401);
    }
  });

  it("returns 403 for developer users on every route family", async () => {
    const app = createTestApp();
    const cookie = await loginCookie("developer");
    for (const route of routes) {
      const res = await invoke(app, {
        method: route.method,
        url: route.url,
        body: route.body,
        headers: { cookie },
      });
      expect(res.status, `${route.method} ${route.url}`).toBe(403);
    }
  });
});

describe("notes routes happy path", () => {
  it("supports save, get, list, append, follow-up, and sources", async () => {
    const app = createTestApp();
    const cookie = await loginCookie("manager");

    const blank = await invoke(app, {
      method: "GET",
      url: `/api/notes/${DATE}`,
      headers: { cookie },
    });
    expect(blank.status).toBe(200);
    expect(blank.body).toEqual({ note: null, followUps: [] });

    const saved = await invoke(app, {
      method: "PUT",
      url: `/api/notes/${DATE}`,
      body: { body: "note body", revision: 0 },
      headers: { cookie },
    });
    expect(saved.status).toBe(200);
    expect(saved.body.note).toMatchObject({ date: DATE, body: "note body", revision: 1 });

    const appended = await invoke(app, {
      method: "POST",
      url: `/api/notes/${DATE}/append`,
      body: { text: "captured line", requestId: randomUUID() },
      headers: { cookie },
    });
    expect(appended.status).toBe(200);
    expect(appended.body.note.body).toBe("note body\n\ncaptured line");

    const listed = await invoke(app, { method: "GET", url: "/api/notes", headers: { cookie } });
    expect(listed.status).toBe(200);
    expect(listed.body.notes).toHaveLength(1);
    expect(listed.body.nextCursor).toBeNull();

    const followUp = await invoke(app, {
      method: "POST",
      url: `/api/notes/${DATE}/follow-ups`,
      body: {
        date: DATE,
        title: "Follow up",
        followUpAt: "2026-03-10T09:00:00.000Z",
        requestId: randomUUID(),
      },
      headers: { cookie },
    });
    expect(followUp.status).toBe(200);
    expect(followUp.body).toMatchObject({ title: "Follow up", status: "planned", date: DATE });

    const sources = await invoke(app, {
      method: "GET",
      url: `/api/notes/sources?itemIds=${followUp.body.itemId}`,
      headers: { cookie },
    });
    expect(sources.status).toBe(200);
    expect(sources.body.sources).toEqual([
      { itemId: followUp.body.itemId, noteId: saved.body.note.id, date: DATE },
    ]);
  });

  it("accepts a 50000 non-ASCII character body and echoes it exactly", async () => {
    const app = createTestApp();
    const cookie = await loginCookie("manager");
    const body = "界".repeat(50000);

    const res = await invoke(app, {
      method: "PUT",
      url: `/api/notes/${DATE}`,
      body: { body, revision: 0 },
      headers: { cookie },
    });

    expect(res.status).toBe(200);
    expect(res.body.note.body).toBe(body);
    expect(res.body.note.revision).toBe(1);
  });

  it("derives ownership from the authenticated user and ignores supplied scope fields", async () => {
    const app = createTestApp();
    const cookie = await loginCookie("manager");

    const res = await invoke(app, {
      method: "PUT",
      url: `/api/notes/${DATE}`,
      body: {
        body: "mine",
        revision: 0,
        managerAccountId: "someone-else",
        workspaceId: "other",
        ownerId: "spoofed",
      },
      headers: { cookie },
    });
    expect(res.status).toBe(200);

    const rows = await db.select().from(dailyNotes);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ managerAccountId: "manager", workspaceId: "default" });
  });
});

describe("notes routes validation", () => {
  it("rejects invalid calendar dates and formats", async () => {
    const app = createTestApp();
    const cookie = await loginCookie("manager");

    for (const bad of ["2026-02-30", "2026-13-01", "03-08-2026", "2026-3-8", "not-a-date"]) {
      const res = await invoke(app, {
        method: "GET",
        url: `/api/notes/${bad}`,
        headers: { cookie },
      });
      expect(res.status, bad).toBe(400);
    }
  });

  it("rejects invalid save payloads", async () => {
    const app = createTestApp();
    const cookie = await loginCookie("manager");

    const cases: unknown[] = [
      { body: "x" },
      { body: "x", revision: -1 },
      { body: "x", revision: 1.5 },
      { body: "x", revision: "0" },
      { revision: 0 },
      { body: "x".repeat(50001), revision: 0 },
    ];
    for (const body of cases) {
      const res = await invoke(app, {
        method: "PUT",
        url: `/api/notes/${DATE}`,
        body,
        headers: { cookie },
      });
      expect(res.status, JSON.stringify(body).slice(0, 60)).toBe(400);
    }
  });

  it("rejects invalid append payloads", async () => {
    const app = createTestApp();
    const cookie = await loginCookie("manager");

    const cases: unknown[] = [
      { text: "", requestId: randomUUID() },
      { text: "   ", requestId: randomUUID() },
      { text: "x" },
      { text: "x", requestId: "not-a-uuid" },
      { text: "x".repeat(50001), requestId: randomUUID() },
    ];
    for (const body of cases) {
      const res = await invoke(app, {
        method: "POST",
        url: `/api/notes/${DATE}/append`,
        body,
        headers: { cookie },
      });
      expect(res.status, JSON.stringify(body).slice(0, 60)).toBe(400);
    }
  });

  it("rejects invalid follow-up payloads", async () => {
    const app = createTestApp();
    const cookie = await loginCookie("manager");
    const valid = {
      date: DATE,
      title: "Follow up",
      followUpAt: "2026-03-10T09:00:00.000Z",
      requestId: randomUUID(),
    };

    const cases: unknown[] = [
      { ...valid, date: "2026-02-30" },
      { ...valid, date: "not-a-date" },
      { ...valid, title: "" },
      { ...valid, title: "   " },
      { ...valid, title: "t".repeat(501) },
      { ...valid, followUpAt: "not-a-timestamp" },
      { ...valid, followUpAt: undefined },
      { ...valid, requestId: "nope" },
    ];
    for (const body of cases) {
      const res = await invoke(app, {
        method: "POST",
        url: `/api/notes/${DATE}/follow-ups`,
        body,
        headers: { cookie },
      });
      expect(res.status, JSON.stringify(body).slice(0, 80)).toBe(400);
    }
  });

  it("rejects invalid sources and list query parameters", async () => {
    const app = createTestApp();
    const cookie = await loginCookie("manager");

    const badUrls = [
      "/api/notes/sources",
      "/api/notes/sources?itemIds=abc",
      "/api/notes/sources?itemIds=1,-2",
      "/api/notes/sources?itemIds=1.5",
      `/api/notes/sources?itemIds=${Array.from({ length: 101 }, (_, i) => i + 1).join(",")}`,
      "/api/notes?limit=0",
      "/api/notes?limit=101",
      "/api/notes?before=2026-02-30",
      `/api/notes?q=${"q".repeat(201)}`,
    ];
    for (const url of badUrls) {
      const res = await invoke(app, { method: "GET", url, headers: { cookie } });
      expect(res.status, url).toBe(400);
    }
  });

  it("does not leak notes across managers", async () => {
    const app = createTestApp();
    const managerCookie = await loginCookie("manager");

    await invoke(app, {
      method: "PUT",
      url: `/api/notes/${DATE}`,
      body: { body: "private note", revision: 0 },
      headers: { cookie: managerCookie },
    });

    await authService.createUser({
      username: "manager-two",
      displayName: "Manager Two",
      password: "secret123",
      role: "manager",
    });
    const otherCookie = await loginCookie("manager-two");

    const day = await invoke(app, {
      method: "GET",
      url: `/api/notes/${DATE}`,
      headers: { cookie: otherCookie },
    });
    expect(day.status).toBe(200);
    expect(day.body.note).toBeNull();

    const list = await invoke(app, { method: "GET", url: "/api/notes", headers: { cookie: otherCookie } });
    expect(list.body.notes).toEqual([]);
  });
});
