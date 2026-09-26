import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import express from "express";
import { db, resetDatabase } from "./helpers/db";
import { invoke } from "./helpers/http";
import { configTable, developers, issues, taskEvents, tasks } from "../src/db/schema";
import { errorHandler, notFoundHandler } from "../src/middleware/errorHandler";
import { requireManager } from "../src/middleware/auth";
import { createTasksRouter } from "../src/routes/tasks";
import { createTaskViewsRouter } from "../src/routes/task-views";
import { createAuthRouter } from "../src/routes/auth";
import { AuthService, serializeSessionCookie } from "../src/services/auth.service";
import { TaskKeysService } from "../src/services/task-keys.service";
import { TaskEventsService } from "../src/services/task-events.service";
import { taskPlanDate } from "../src/services/task-views.service";
import { todayIsoDate } from "../src/utils/date";

/** docs/49: consolidated built-ins, row signals, view counts, and bulk updates. */
const auth = new AuthService();
const keys = new TaskKeysService();
const events = new TaskEventsService(keys);
const app = express();
app.use("/api/tasks", requireManager(auth), createTasksRouter(keys, events));
app.use("/api/task-views", requireManager(auth), createTaskViewsRouter(keys));
app.use("/api/auth", createAuthRouter(auth));
app.use(notFoundHandler);
app.use(errorHandler);

const today = todayIsoDate();
function shift(days: number): string {
  return new Date(Date.parse(`${today}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

async function cookie(name: string): Promise<string> {
  const { sessionId } = await auth.authenticate(name, "secret123");
  return serializeSessionCookie(sessionId, auth.sessionMaxAgeSeconds);
}

function encodeViewDef(definition: unknown): string {
  return encodeURIComponent(Buffer.from(JSON.stringify(definition), "utf8").toString("base64url"));
}

type Headers = { cookie: string };

async function createTask(headers: Headers, body: Record<string, unknown>) {
  const response = await invoke(app, { method: "POST", url: "/api/tasks", headers, body });
  expect(response.status).toBe(201);
  return response.body as { id: number; taskKey: string };
}

async function views(headers: Headers) {
  const response = await invoke(app, { method: "GET", url: `/api/task-views?today=${today}`, headers });
  expect(response.status).toBe(200);
  return response.body.views as { id: string; definition: unknown }[];
}

async function runView(headers: Headers, id: string) {
  const definition = (await views(headers)).find((view) => view.id === id)!.definition;
  const response = await invoke(app, { method: "GET", url: `/api/tasks?viewDef=${encodeViewDef(definition)}&today=${today}`, headers });
  expect(response.status).toBe(200);
  return response.body.tasks as { title: string; taskKey: string; signals: Record<string, unknown> }[];
}

const titles = (rows: { title: string }[]) => rows.map((row) => row.title).sort();

async function makeStale(taskId: number) {
  const old = `${shift(-9)}T09:00:00.000Z`;
  await db.update(tasks).set({ updatedAt: old }).where(eq(tasks.id, taskId));
  await db.update(taskEvents).set({ occurredAt: old }).where(eq(taskEvents.taskId, taskId));
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
  await auth.createUser({ username: "manager-b", displayName: "B", password: "secret123", role: "manager", workspaceId: "default" });
});

describe("taskPlanDate (docs/49 D1)", () => {
  it("takes the earlier of scheduledOn and the dueAt date, ties to the deadline", () => {
    expect(taskPlanDate({ scheduledOn: "2026-09-26", dueAt: null })).toEqual({ date: "2026-09-26", source: "scheduled" });
    expect(taskPlanDate({ scheduledOn: "2026-09-26", dueAt: "2026-09-20T12:00:00" })).toEqual({ date: "2026-09-20", source: "due" });
    expect(taskPlanDate({ scheduledOn: "2026-09-20", dueAt: "2026-09-26T12:00:00" })).toEqual({ date: "2026-09-20", source: "scheduled" });
    expect(taskPlanDate({ scheduledOn: null, dueAt: "2026-09-26T12:00:00" })).toEqual({ date: "2026-09-26", source: "due" });
    expect(taskPlanDate({ scheduledOn: "2026-09-26", dueAt: "2026-09-26T12:00:00" }).source).toBe("due");
    expect(taskPlanDate({ scheduledOn: null, dueAt: null })).toEqual({ date: null, source: null });
  });
});

describe("consolidated built-in views (docs/49 §3)", () => {
  it("Today is plan date <= today; Upcoming is after today; both exclude Later and closed", async () => {
    const headers = { cookie: await cookie("manager-a") };
    await createTask(headers, { title: "Overdue", scheduledOn: shift(-3) });
    await createTask(headers, { title: "Now" });
    await createTask(headers, { title: "Tomorrow", scheduledOn: shift(1) });
    await createTask(headers, { title: "Due today, planned later", scheduledOn: shift(5), dueAt: `${today}T12:00:00.000Z` });
    await createTask(headers, { title: "Undated", scheduledOn: null });
    await createTask(headers, { title: "Parked", later: true });
    await createTask(headers, { title: "Finished", status: "done" });
    await createTask(headers, { title: "Standup", kind: "meeting" });
    await createTask(headers, { title: "Delegated", ownerType: "developer", ownerId: "dev-1" });

    expect(titles(await runView(headers, "today"))).toEqual(["Due today, planned later", "Now", "Overdue", "Standup"]);
    expect(titles(await runView(headers, "upcoming"))).toEqual(["Tomorrow"]);
    expect(titles(await runView(headers, "my-tasks"))).toEqual(["Due today, planned later", "Now", "Overdue", "Standup", "Tomorrow", "Undated"]);
    expect(titles(await runView(headers, "later"))).toEqual(["Parked"]);
  });

  it("Waiting on others covers delegated, blocked, follow-up, and kind:waiting work", async () => {
    const headers = { cookie: await cookie("manager-a") };
    await createTask(headers, { title: "Delegated", ownerType: "developer", ownerId: "dev-1" });
    await createTask(headers, { title: "Blocked", status: "blocked" });
    await createTask(headers, { title: "Follow-up", followUpAt: `${shift(2)}T09:00:00.000Z` });
    await createTask(headers, { title: "Waiting label", labels: ["kind:waiting"] });
    await createTask(headers, { title: "Plain" });
    await createTask(headers, { title: "Parked follow-up", later: true, labels: ["category:follow_up"] });

    expect(titles(await runView(headers, "waiting"))).toEqual(["Blocked", "Delegated", "Follow-up", "Waiting label"]);
  });

  it("Needs attention unions overdue, stale, and drift with per-row signals", async () => {
    const headers = { cookie: await cookie("manager-a") };
    const now = new Date().toISOString();
    await db.insert(issues).values([
      { jiraKey: "APP-1", summary: "Done in Jira", priorityName: "High", priorityId: "1", statusName: "Done", statusCategory: "done", createdAt: now, updatedAt: now, syncedAt: now, labels: "[]" },
    ]);
    await createTask(headers, { title: "Overdue", scheduledOn: shift(-2) });
    const stale = await createTask(headers, { title: "Stale", scheduledOn: shift(3) });
    await makeStale(stale.id);
    const drifted = await createTask(headers, { title: "Drifted", scheduledOn: shift(3) });
    await invoke(app, { method: "POST", url: `/api/tasks/${drifted.taskKey}/links`, headers, body: { kind: "jira", ref: "APP-1", role: "primary" } });
    await createTask(headers, { title: "Healthy" });
    const deadline = await createTask(headers, { title: "Missed deadline", scheduledOn: shift(2), dueAt: `${shift(-1)}T12:00:00.000Z` });

    const rows = await runView(headers, "attention");
    expect(titles(rows)).toEqual(["Drifted", "Missed deadline", "Overdue", "Stale"]);
    const byTitle = new Map(rows.map((row) => [row.title, row.signals]));
    expect(byTitle.get("Overdue")).toMatchObject({ overdue: true, overdueDays: 2, overdueSource: "scheduled", stale: false, drift: false });
    expect(byTitle.get("Stale")).toMatchObject({ overdue: false, stale: true, staleDays: 9 });
    expect(byTitle.get("Drifted")).toMatchObject({ drift: true, overdue: false });
    expect(byTitle.get("Missed deadline")).toMatchObject({ overdue: true, overdueDays: 1, overdueSource: "due" });
    expect(deadline.taskKey).toBeTruthy();

    const driftOnly = await invoke(app, { method: "GET", url: `/api/tasks?viewDef=${encodeViewDef({ filters: { attention: ["drift"] } })}&today=${today}`, headers });
    expect(titles(driftOnly.body.tasks)).toEqual(["Drifted"]);
  });

  it("every run row carries signals, including follow-up due", async () => {
    const headers = { cookie: await cookie("manager-a") };
    await createTask(headers, { title: "Nudge", followUpAt: `${shift(-1)}T09:00:00.000Z` });
    const [row] = await runView(headers, "my-tasks");
    expect(row!.signals).toEqual({ overdue: false, overdueDays: null, overdueSource: null, stale: false, staleDays: null, drift: false, followUpDue: true });
  });

  it("honours the client's today for relative horizons (D3)", async () => {
    const headers = { cookie: await cookie("manager-a") };
    await createTask(headers, { title: "Tomorrow", scheduledOn: shift(1) });
    const definition = (await views(headers)).find((view) => view.id === "today")!.definition;
    const asToday = await invoke(app, { method: "GET", url: `/api/tasks?viewDef=${encodeViewDef(definition)}&today=${today}`, headers });
    expect(asToday.body.tasks).toHaveLength(0);
    const asTomorrow = await invoke(app, { method: "GET", url: `/api/tasks?viewDef=${encodeViewDef(definition)}&today=${shift(1)}`, headers });
    expect(titles(asTomorrow.body.tasks)).toEqual(["Tomorrow"]);
    expect((await invoke(app, { method: "GET", url: `/api/tasks?viewDef=${encodeViewDef(definition)}&today=yesterday`, headers })).status).toBe(400);
  });

  it("rejects invalid new filter values", async () => {
    const headers = { cookie: await cookie("manager-a") };
    for (const filters of [{ horizon: "someday" }, { attention: [] }, { attention: ["late"] }, { waiting: "yes" }]) {
      expect((await invoke(app, { method: "GET", url: `/api/tasks?viewDef=${encodeViewDef({ filters })}`, headers })).status).toBe(400);
    }
  });
});

describe("GET /api/tasks/view-counts (docs/49 §10)", () => {
  it("returns a count for every view that matches the list length exactly (R8)", async () => {
    const headers = { cookie: await cookie("manager-a") };
    const now = new Date().toISOString();
    await db.insert(issues).values([
      { jiraKey: "APP-2", summary: "Open", priorityName: "High", priorityId: "1", statusName: "Open", statusCategory: "new", createdAt: now, updatedAt: now, syncedAt: now, labels: "[]" },
    ]);
    await createTask(headers, { title: "Overdue", scheduledOn: shift(-2) });
    await createTask(headers, { title: "Now" });
    await createTask(headers, { title: "Soon", scheduledOn: shift(4) });
    await createTask(headers, { title: "Inbox", ownerType: null, ownerId: null });
    await createTask(headers, { title: "Delegated", ownerType: "developer", ownerId: "dev-2" });
    await createTask(headers, { title: "Parked", later: true });
    const closed = await createTask(headers, { title: "Closed with open Jira" });
    await invoke(app, { method: "POST", url: `/api/tasks/${closed.taskKey}/links`, headers, body: { kind: "jira", ref: "APP-2", role: "primary" } });
    await invoke(app, { method: "PATCH", url: `/api/tasks/${closed.taskKey}`, headers, body: { status: "done" } });
    const stale = await createTask(headers, { title: "Stale", scheduledOn: shift(2) });
    await makeStale(stale.id);
    await invoke(app, { method: "POST", url: "/api/task-views", headers, body: { name: "Linked", definition: { filters: { linkedJira: true, closed: { from: shift(-30), to: today } } } } });
    await invoke(app, { method: "POST", url: "/api/task-views", headers, body: { name: "Ancient", definition: { filters: { closed: { to: today } } } } });
    // Another manager's private work never counts.
    await createTask({ cookie: await cookie("manager-b") }, { title: "B's overdue", scheduledOn: shift(-2) });

    const response = await invoke(app, { method: "GET", url: `/api/tasks/view-counts?today=${today}`, headers });
    expect(response.status).toBe(200);
    expect(response.body.today).toBe(today);
    const listed = await views(headers);
    expect(Object.keys(response.body.counts).sort()).toEqual(listed.map((view) => view.id).sort());
    for (const view of listed) {
      const rows = await runView(headers, view.id);
      expect({ id: view.id, count: response.body.counts[view.id].count }).toEqual({ id: view.id, count: rows.length });
      expect(response.body.counts[view.id].overdue).toBe(rows.filter((row) => row.signals.overdue).length);
    }
    expect(response.body.counts.today).toEqual({ count: 2, overdue: 1 });
    expect(response.body.counts.attention.count).toBe(3);
  });

  it("defaults today, validates it, and is flag-gated", async () => {
    const headers = { cookie: await cookie("manager-a") };
    const ok = await invoke(app, { method: "GET", url: "/api/tasks/view-counts", headers });
    expect(ok.status).toBe(200);
    expect(ok.body.today).toBe(today);
    expect((await invoke(app, { method: "GET", url: "/api/tasks/view-counts?today=26-09-2026", headers })).status).toBe(400);
    await db.update(configTable).set({ value: "false" }).where(eq(configTable.key, "tasks_phase3_enabled"));
    expect((await invoke(app, { method: "GET", url: "/api/tasks/view-counts", headers })).status).toBe(404);
  });

  it("requires a manager session", async () => {
    expect((await invoke(app, { method: "GET", url: "/api/tasks/view-counts" })).status).toBe(401);
  });
});

describe("POST /api/tasks/bulk (docs/49 §10, D8)", () => {
  it("applies per-task patches in one call and returns DTOs in request order", async () => {
    const headers = { cookie: await cookie("manager-a") };
    const a = await createTask(headers, { title: "A", scheduledOn: shift(-3) });
    const b = await createTask(headers, { title: "B", scheduledOn: shift(-1) });
    const c = await createTask(headers, { title: "C" });

    const response = await invoke(app, {
      method: "POST",
      url: "/api/tasks/bulk",
      headers,
      body: { items: [
        { key: b.taskKey, changes: { scheduledOn: today, later: false } },
        { key: a.taskKey, changes: { scheduledOn: today, later: false } },
        { key: c.taskKey, changes: { status: "done", labels: ["escalation"] } },
      ] },
    });
    expect(response.status).toBe(200);
    expect(response.body.tasks.map((task: { taskKey: string }) => task.taskKey)).toEqual([b.taskKey, a.taskKey, c.taskKey]);
    expect(response.body.tasks[0].scheduledOn).toBe(today);
    expect(response.body.tasks[2]).toMatchObject({ status: "done", labels: ["escalation"] });
    expect(response.body.tasks[2].closedAt).toBeTruthy();

    // Undo = the same endpoint with each task's previous values.
    const undo = await invoke(app, { method: "POST", url: "/api/tasks/bulk", headers, body: { items: [{ key: c.taskKey, changes: { status: "open", labels: [] } }] } });
    expect(undo.body.tasks[0]).toMatchObject({ status: "open", labels: [], closedAt: null });
  });

  it("is atomic: one failing item rolls back the whole batch and names the key", async () => {
    const headers = { cookie: await cookie("manager-a") };
    const ok = await createTask(headers, { title: "Fine" });
    const dev = await createTask(headers, { title: "Dev owned", ownerType: "developer", ownerId: "dev-1" });

    const response = await invoke(app, {
      method: "POST",
      url: "/api/tasks/bulk",
      headers,
      body: { items: [{ key: ok.taskKey, changes: { later: true } }, { key: dev.taskKey, changes: { later: true } }] },
    });
    expect(response.status).toBe(409);
    expect(response.body.error).toBe(`${dev.taskKey}: Developer tasks cannot be Later`);
    const row = (await db.select().from(tasks).where(eq(tasks.id, ok.id)))[0]!;
    expect(row.later).toBe(0);
    expect(row.scheduledOn).toBe(today);
  });

  it("validates the payload", async () => {
    const headers = { cookie: await cookie("manager-a") };
    const task = await createTask(headers, { title: "One" });
    const bad = [
      { items: [] },
      { items: [{ key: task.taskKey, changes: {} }] },
      { items: [{ key: "nope", changes: { status: "done" } }] },
      { items: [{ key: task.taskKey, changes: { status: "finished" } }] },
      { items: [{ key: task.taskKey, changes: { status: "done" } }, { key: task.taskKey.toLowerCase(), changes: { status: "open" } }] },
      { items: Array.from({ length: 201 }, () => ({ key: task.taskKey, changes: { status: "done" } })) },
    ];
    for (const body of bad) {
      expect((await invoke(app, { method: "POST", url: "/api/tasks/bulk", headers, body })).status).toBe(400);
    }
    expect((await invoke(app, { method: "POST", url: "/api/tasks/bulk", headers, body: { items: [{ key: "T-999999", changes: { status: "done" } }] } })).status).toBe(404);
  });

  it("enforces private-field ownership per task", async () => {
    const headersA = { cookie: await cookie("manager-a") };
    const headersB = { cookie: await cookie("manager-b") };
    const task = await createTask(headersA, { title: "A's" });
    const response = await invoke(app, { method: "POST", url: "/api/tasks/bulk", headers: headersB, body: { items: [{ key: task.taskKey, changes: { labels: ["x"] } }] } });
    expect(response.status).toBe(403);
  });

  it("requires a manager session", async () => {
    expect((await invoke(app, { method: "POST", url: "/api/tasks/bulk", body: { items: [] } })).status).toBe(401);
  });
});
