import { beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
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
import { TaskService } from "../src/services/task.service";
import { TeamTrackerService } from "../src/services/team-tracker.service";
import { MyDayService } from "../src/services/my-day.service";
import { IssueService } from "../src/services/issue.service";
import { todayIsoDate } from "../src/utils/date";

const auth = new AuthService();
const keys = new TaskKeysService();
const events = new TaskEventsService(keys);
const tracker = new TeamTrackerService();
const app = express();
app.use("/api/tasks", requireManager(auth), createTasksRouter(keys, events));
app.use("/api/my-day", createMyDayRouter(new MyDayService(tracker), auth, new IssueService()));
app.use(notFoundHandler);
app.use(errorHandler);

async function cookie(name: string): Promise<string> {
  const { sessionId } = await auth.authenticate(name, "secret123");
  return serializeSessionCookie(sessionId, auth.sessionMaxAgeSeconds);
}

const today = todayIsoDate();

async function managerCreates(body: Record<string, unknown>, username = "manager-a") {
  const res = await invoke(app, { method: "POST", url: "/api/tasks", headers: { cookie: await cookie(username) }, body });
  expect(res.status).toBe(201);
  return res.body as { taskKey: string; details: string | null };
}

async function eventTypes(taskKey: string): Promise<string[]> {
  const res = await invoke(app, { method: "GET", url: `/api/tasks/${taskKey}/events`, headers: { cookie: await cookie("manager-a") } });
  expect(res.status).toBe(200);
  return (res.body.events as { type: string }[]).map((event) => event.type);
}

beforeEach(async () => {
  await resetDatabase();
  await db.insert(configTable).values([
    { key: "tasks_phase1_enabled", value: "true" },
    { key: "tasks_phase2_stage", value: "2c" },
    { key: "tasks_phase3_enabled", value: "true" },
  ]);
  await db.insert(developers).values([
    { accountId: "dev-1", displayName: "One", isActive: 1 },
    { accountId: "dev-2", displayName: "Two", isActive: 1 },
  ]);
  await auth.createUser({ username: "manager-a", displayName: "A", password: "secret123", role: "manager" });
  await auth.createUser({ username: "manager-b", displayName: "B", password: "secret123", role: "manager" });
  await auth.createUser({ username: "dev-one", displayName: "One", password: "secret123", role: "developer", developerAccountId: "dev-1" });
  await auth.createUser({ username: "dev-two", displayName: "Two", password: "secret123", role: "developer", developerAccountId: "dev-2" });
});

describe("task details — shared description", () => {
  it("manager writes → developer sees it in detail, native list and My Day projections", async () => {
    const task = await managerCreates({ title: "Ship export", ownerType: "developer", ownerId: "dev-1", details: "  Export CSV for finance.\nDone = download works.  " });
    // Surrounding whitespace is trimmed; internal newlines are kept.
    expect(task.details).toBe("Export CSV for finance.\nDone = download works.");
    const headers = { cookie: await cookie("dev-one") };

    const detail = await invoke(app, { method: "GET", url: `/api/my-day/tasks/${task.taskKey}/detail`, headers });
    expect(detail.status).toBe(200);
    expect(detail.body.details).toBe("Export CSV for finance.\nDone = download works.");
    // Developer projection still omits manager-private fields.
    expect(detail.body).not.toHaveProperty("labels");
    expect(detail.body).not.toHaveProperty("followUpAt");
    expect(detail.body).not.toHaveProperty("trackedByManagerId");

    const list = await invoke(app, { method: "GET", url: `/api/my-day/tasks?date=${today}`, headers });
    expect(list.body.tasks.find((row: { taskKey: string }) => row.taskKey === task.taskKey).details).toBe("Export CSV for finance.\nDone = download works.");

    const day = await invoke(app, { method: "GET", url: `/api/my-day?date=${today}`, headers });
    expect(day.status).toBe(200);
    expect(day.body.taskModel).toBe("canonical");
    expect(day.body.tasks.find((row: { taskKey: string }) => row.taskKey === task.taskKey).details).toBe("Export CSV for finance.\nDone = download works.");
  });

  it("developer writes → manager sees it, without adding timeline events", async () => {
    // Manager-created: the developer is the owner but not the creator, so the
    // title stays locked while details stays editable.
    const task = await managerCreates({ title: "Investigate flake", ownerType: "developer", ownerId: "dev-1" });
    expect(task.details).toBeNull();
    const before = await eventTypes(task.taskKey);
    const headers = { cookie: await cookie("dev-one") };

    const patch = await invoke(app, { method: "PATCH", url: `/api/my-day/tasks/${task.taskKey}`, headers, body: { date: today, details: "Repro: run suite 5x with --shuffle" } });
    expect(patch.status).toBe(200);
    expect(patch.body.details).toBe("Repro: run suite 5x with --shuffle");

    const managerView = await invoke(app, { method: "GET", url: `/api/tasks/${task.taskKey}/detail`, headers: { cookie: await cookie("manager-a") } });
    expect(managerView.body.details).toBe("Repro: run suite 5x with --shuffle");
    // Details is static description — the running thread is untouched.
    expect(await eventTypes(task.taskKey)).toEqual(before);

    const rename = await invoke(app, { method: "PATCH", url: `/api/my-day/tasks/${task.taskKey}`, headers, body: { date: today, title: "Renamed" } });
    expect(rename.status).toBe(403);
  });

  it("blank details clears the field on both write paths", async () => {
    const task = await managerCreates({ title: "Clear me", ownerType: "developer", ownerId: "dev-1", details: "Old context" });
    const dev = await invoke(app, { method: "PATCH", url: `/api/my-day/tasks/${task.taskKey}`, headers: { cookie: await cookie("dev-one") }, body: { date: today, details: "   " } });
    expect(dev.body.details).toBeNull();
    await invoke(app, { method: "PATCH", url: `/api/tasks/${task.taskKey}`, headers: { cookie: await cookie("manager-a") }, body: { details: "Back again" } });
    const manager = await invoke(app, { method: "PATCH", url: `/api/tasks/${task.taskKey}`, headers: { cookie: await cookie("manager-a") }, body: { details: null } });
    expect(manager.status).toBe(200);
    expect(manager.body.details).toBeNull();
  });

  it("stays inside the task's workspace for managers", async () => {
    const task = await managerCreates({ title: "Shared", ownerType: "developer", ownerId: "dev-1", details: "Workspace A only" });
    const other = { cookie: await cookie("manager-b") };
    expect((await invoke(app, { method: "GET", url: `/api/tasks/${task.taskKey}/detail`, headers: other })).status).toBe(404);
    expect((await invoke(app, { method: "PATCH", url: `/api/tasks/${task.taskKey}`, headers: other, body: { details: "From another lead" } })).status).toBe(404);
    const reread = await invoke(app, { method: "GET", url: `/api/tasks/${task.taskKey}/detail`, headers: { cookie: await cookie("manager-a") } });
    expect(reread.body.details).toBe("Workspace A only");
  });

  it("does not widen developer authz", async () => {
    const task = await managerCreates({ title: "Not yours", ownerType: "developer", ownerId: "dev-2", details: "Secret-ish context" });
    const devOne = { cookie: await cookie("dev-one") };
    // Non-owner: invisible.
    expect((await invoke(app, { method: "GET", url: `/api/my-day/tasks/${task.taskKey}/detail`, headers: devOne })).status).toBe(404);
    expect((await invoke(app, { method: "PATCH", url: `/api/my-day/tasks/${task.taskKey}`, headers: devOne, body: { date: today, details: "hijack" } })).status).toBe(404);

    // Owner: details rides along with the existing allowlist, never past it.
    const devTwo = { cookie: await cookie("dev-two") };
    const mixed = await invoke(app, { method: "PATCH", url: `/api/my-day/tasks/${task.taskKey}`, headers: devTwo, body: { date: today, details: "ok", priority: "high" } });
    expect(mixed.status).toBe(403);
    const reread = await invoke(app, { method: "GET", url: `/api/tasks/${task.taskKey}/detail`, headers: { cookie: await cookie("manager-a") } });
    expect(reread.body.details).toBe("Secret-ish context");
    expect(reread.body.priority).toBe("normal");
  });

  it("former owners keep the restricted key/title/status projection and cannot write details", async () => {
    const task = await managerCreates({ title: "Handed off", ownerType: "developer", ownerId: "dev-1", details: "Context for whoever owns it" });
    const devOne = { cookie: await cookie("dev-one") };
    const posted = await invoke(app, { method: "POST", url: `/api/my-day/tasks/${task.taskKey}/events`, headers: devOne, body: { date: today, type: "update", body: "Started", requestId: randomUUID() } });
    expect(posted.status).toBe(201);
    await new TaskService().update(task.taskKey, { ownerType: "developer", ownerId: "dev-2" }, { type: "manager", accountId: "mgr" });

    const detail = await invoke(app, { method: "GET", url: `/api/my-day/tasks/${task.taskKey}/detail`, headers: devOne });
    expect(detail.status).toBe(200);
    expect(detail.body).toEqual({ taskKey: task.taskKey, title: "Handed off", status: "open", access: "former-owner" });
    const write = await invoke(app, { method: "PATCH", url: `/api/my-day/tasks/${task.taskKey}`, headers: devOne, body: { date: today, details: "stale edit" } });
    expect(write.status).toBe(403);
  });

  it("lands at capture time from the developer's quick-add and native create", async () => {
    const headers = { cookie: await cookie("dev-one") };
    const quick = await invoke(app, { method: "POST", url: "/api/my-day/items", headers, body: { date: today, title: "Quick add", details: "Why: customer escalation" } });
    expect(quick.status).toBe(201);
    const quickKey = quick.body.taskKey as string;
    const quickDetail = await invoke(app, { method: "GET", url: `/api/my-day/tasks/${quickKey}/detail`, headers });
    expect(quickDetail.body.details).toBe("Why: customer escalation");
    // Context is the description now, not a timeline update.
    expect(await eventTypes(quickKey)).toEqual(["created"]);

    const native = await invoke(app, { method: "POST", url: "/api/my-day/tasks", headers, body: { date: today, title: "Native", details: "Native context" } });
    expect(native.status).toBe(201);
    expect(native.body.details).toBe("Native context");
  });

  it("rejects details beyond the size cap", async () => {
    const task = await managerCreates({ title: "Big", ownerType: "developer", ownerId: "dev-1" });
    const res = await invoke(app, { method: "PATCH", url: `/api/tasks/${task.taskKey}`, headers: { cookie: await cookie("manager-a") }, body: { details: "x".repeat(20001) } });
    expect(res.status).toBe(400);
  });
});
