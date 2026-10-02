import express from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db, resetDatabase } from "./helpers/db";
import { invoke } from "./helpers/http";
import { appUsers, configTable, developers } from "../src/db/schema";
import { requireAuth } from "../src/middleware/auth";
import { errorHandler } from "../src/middleware/errorHandler";
import { AuthService } from "../src/services/auth.service";
import { TaskService } from "../src/services/task.service";
import { TaskEventsService } from "../src/services/task-events.service";
import { createTaskInboxRouter } from "../src/routes/task-inbox";
import type { AuthUser } from "shared/types";
const users: Record<string, AuthUser> = {
  lead: { username: "lead", accountId: "lead", displayName: "Lead", workspaceId: "default", role: "manager" },
  dev: {
    username: "dev",
    accountId: "dev-1",
    developerAccountId: "dev-1",
    displayName: "Dev",
    workspaceId: "default",
    role: "developer",
  },
  other: { username: "other", accountId: "other", displayName: "Other", workspaceId: "default", role: "manager" },
  admin: { username: "admin", accountId: "admin", displayName: "Admin", workspaceId: "default", role: "admin" },
};
const auth = new AuthService();
vi.spyOn(auth, "getUserForSession").mockImplementation(async (id) => users[id] ?? null);
const app = express();
app.use("/api/task-inbox", requireAuth(auth), createTaskInboxRouter());
app.use(errorHandler);
const get = (url = "", session = "dev") =>
  invoke(app, { method: "GET", url: `/api/task-inbox${url}`, headers: { cookie: `dcc_session=${session}` } });
const read = (body: unknown, session = "dev") =>
  invoke(app, { method: "POST", url: "/api/task-inbox/read", body, headers: { cookie: `dcc_session=${session}` } });

beforeEach(async () => {
  await resetDatabase();
  await db.insert(configTable).values([
    { key: "tasks_phase1_enabled", value: "true" },
    { key: "tasks_phase2_stage", value: "2b" },
    { key: "team_mode", value: "collab" },
  ]);
  await db.insert(developers).values({ accountId: "dev-1", displayName: "Dev", isActive: 1 });
  await db.insert(appUsers).values(
    Object.values(users).map((user) => ({
      username: user.username,
      displayName: user.displayName,
      role: user.role,
      developerAccountId: user.developerAccountId ?? null,
      passwordHash: "test-only",
      createdAt: "2026-10-03T09:00:00Z",
      updatedAt: "2026-10-03T09:00:00Z",
    })),
  );
});

describe("personal task inbox routes", () => {
  it("authenticates both workspace roles and rejects anonymous/admin access", async () => {
    expect((await get("", "missing")).status).toBe(401);
    expect((await get("", "admin")).status).toBe(403);
    expect((await get("", "lead")).status).toBe(200);
    expect((await get()).body).toMatchObject({ enabled: true, events: [], unreadCount: 0 });
  });
  it("acknowledges read/unread, restricts other recipients and opens the exact event only on its task", async () => {
    const task = await new TaskService().create(
      { title: "Assigned", ownerType: "developer", ownerId: "dev-1" },
      { type: "manager", accountId: "lead" },
    );
    const instruction = await new TaskEventsService().append(
      { taskKey: task.taskKey, type: "instruction", body: "Please review", meta: null },
      { type: "manager", accountId: "lead" },
    );
    const initial = await get("?unread=true&limit=1");
    expect(initial.status).toBe(200);
    expect(initial.body.events).toHaveLength(1);
    expect(initial.body.unreadCount).toBe(2);
    const id = initial.body.events[0].id;
    expect((await read({ ids: [id], read: true }, "other")).status).toBe(404);
    expect((await read({ ids: [id], read: true })).body).toEqual({ success: true });
    expect((await get("?unread=true")).body.unreadCount).toBe(1);
    expect((await get(`?cursor=${initial.body.nextCursor}`)).body.events[0].kind).toBe("assignment");
    expect((await get(`/events/${instruction.id}?taskKey=${task.taskKey}`)).body.event.body).toBe("Please review");
    expect((await get(`/events/${instruction.id}?taskKey=T-999`)).status).toBe(404);
    expect((await read({ ids: [id], read: false })).status).toBe(200);
    expect((await get()).body.unreadCount).toBe(2);
  });
  it("validates bounds and rejects recipient or workspace overrides", async () => {
    for (const query of [
      "?limit=51",
      "?limit=0",
      "?cursor=-1",
      "?unread=yes",
      "?workspaceId=elsewhere",
      "?recipientUserId=1",
    ])
      expect((await get(query)).status).toBe(400);
    for (const body of [
      { ids: [], read: true },
      { ids: [1, 1], read: true },
      { ids: [0], read: true },
      { ids: [1.5], read: true },
      { ids: Array.from({ length: 101 }, (_, i) => i + 1), read: true },
      { ids: [1], read: "true" },
      { ids: [1], read: true, workspaceId: "other" },
    ])
      expect((await read(body)).status).toBe(400);
    expect((await get("/events/0?taskKey=T-1")).status).toBe(400);
  });
});
