import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import { db, resetDatabase } from "./helpers/db";
import { invoke } from "./helpers/http";
import { configTable, developers } from "../src/db/schema";
import { errorHandler, notFoundHandler } from "../src/middleware/errorHandler";
import { requireManager } from "../src/middleware/auth";
import { createTasksRouter } from "../src/routes/tasks";
import { createMyDayRouter } from "../src/routes/my-day";
import { AuthService, serializeSessionCookie } from "../src/services/auth.service";
import { TaskKeysService } from "../src/services/task-keys.service";
import { TaskEventsService } from "../src/services/task-events.service";
import { TeamTrackerService } from "../src/services/team-tracker.service";
import { MyDayService } from "../src/services/my-day.service";
import { IssueService } from "../src/services/issue.service";

const auth = new AuthService();
const tracker = new TeamTrackerService();
const keys = new TaskKeysService();
const events = new TaskEventsService(keys);
const app = express();
app.use("/api/tasks", requireManager(auth), createTasksRouter(keys, events));
app.use("/api/my-day", createMyDayRouter(new MyDayService(tracker), auth, new IssueService()));
app.use(notFoundHandler);
app.use(errorHandler);

async function cookie(name: string): Promise<string> {
  const { sessionId } = await auth.authenticate(name, "secret123");
  return serializeSessionCookie(sessionId, auth.sessionMaxAgeSeconds);
}

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-24T09:00:00Z"));
  await resetDatabase();
  await db.insert(configTable).values({ key: "tasks_phase1_enabled", value: "true" });
  await db.insert(developers).values([{ accountId: "dev-1", displayName: "One", isActive: 1 }, { accountId: "dev-2", displayName: "Two", isActive: 1 }]);
  await auth.createUser({ username: "manager-a", displayName: "A", password: "secret123", role: "manager" });
  await auth.createUser({ username: "manager-b", displayName: "B", password: "secret123", role: "manager", workspaceId: "default" });
  await auth.createUser({ username: "dev-user", displayName: "Dev", password: "secret123", role: "developer", developerAccountId: "dev-1" });
});
afterEach(() => vi.useRealTimers());

describe("task event routes", () => {
  it("resolves keys, keeps private events author-only, and responds 200 on replay", async () => {
    const item = await tracker.addItem("dev-1", "2026-09-24", { title: "Review" });
    const requestId = randomUUID();
    const body = { type: "instruction", body: "Internal context", visibility: "private", requestId };
    const first = await invoke(app, { method: "POST", url: `/api/tasks/${item.taskKey}/events`, body, headers: { cookie: await cookie("manager-a") } });
    expect(first.status).toBe(201);
    expect((await invoke(app, { method: "POST", url: `/api/tasks/${item.taskKey}/events`, body, headers: { cookie: await cookie("manager-a") } })).status).toBe(200);
    expect(await invoke(app, { method: "GET", url: `/api/tasks/${item.taskKey?.toLowerCase()}`, headers: { cookie: await cookie("manager-b") } })).toMatchObject({ status: 200, body: { taskKey: item.taskKey } });
    const other = await invoke(app, { method: "GET", url: `/api/tasks/${item.taskKey}/events`, headers: { cookie: await cookie("manager-b") } });
    expect(other.body.events.map((event: { type: string }) => event.type)).toEqual(["created"]);
    expect((await invoke(app, { method: "POST", url: `/api/tasks/${item.taskKey}/events`, body: { ...body, body: "Changed" }, headers: { cookie: await cookie("manager-a") } })).status).toBe(409);
  });

  it("rejects inaccessible or disallowed developer events and redacts deleted tasks", async () => {
    const item = await tracker.addItem("dev-2", "2026-09-24", { title: "Private task" });
    const headers = { cookie: await cookie("dev-user") };
    expect((await invoke(app, { method: "GET", url: `/api/my-day/tasks/${item.taskKey}`, headers })).status).toBe(404);
    const owned = await tracker.addItem("dev-1", "2026-09-24", { title: "Owned" });
    const url = `/api/my-day/tasks/${owned.taskKey}/events`;
    const body = { date: "2026-09-24", type: "update", body: "Progress", requestId: randomUUID() };
    expect((await invoke(app, { method: "POST", url, body: { ...body, type: "instruction" }, headers })).status).toBe(403);
    expect((await invoke(app, { method: "POST", url, body: { ...body, visibility: "private" }, headers })).status).toBe(400);
    expect((await invoke(app, { method: "POST", url, body, headers })).status).toBe(201);
    expect((await invoke(app, { method: "POST", url, body, headers })).status).toBe(200);
    await tracker.deleteItem(owned.id);
    expect((await invoke(app, { method: "GET", url: `/api/tasks/${owned.taskKey}`, headers: { cookie: await cookie("manager-a") } })).status).toBe(410);
  });
});
