import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import express from "express";
import { db, resetDatabase } from "./helpers/db";
import { invoke } from "./helpers/http";
import { configTable, developers, tasks } from "../src/db/schema";
import { errorHandler, notFoundHandler } from "../src/middleware/errorHandler";
import { requireManager } from "../src/middleware/auth";
import { createTasksRouter } from "../src/routes/tasks";
import { createTaskViewsRouter } from "../src/routes/task-views";
import { AuthService, serializeSessionCookie } from "../src/services/auth.service";
import { TaskEventsService } from "../src/services/task-events.service";
import { TaskKeysService } from "../src/services/task-keys.service";
import { todayIsoDate } from "../src/utils/date";

/** docs/57 §4 (P3-06): the built-in Meetings lens — open meetings plus the last two weeks, with action-item tallies. */
const auth = new AuthService();
const keys = new TaskKeysService();
const app = express();
app.use("/api/tasks", requireManager(auth), createTasksRouter(keys, new TaskEventsService(keys)));
app.use("/api/task-views", requireManager(auth), createTaskViewsRouter(keys));
app.use(notFoundHandler);
app.use(errorHandler);

const today = todayIsoDate();
const shift = (days: number) => new Date(Date.parse(`${today}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
let headers: { cookie: string };

async function cookie(name: string): Promise<string> {
  const { sessionId } = await auth.authenticate(name, "secret123");
  return serializeSessionCookie(sessionId, auth.sessionMaxAgeSeconds);
}

async function create(body: Record<string, unknown>) {
  const response = await invoke(app, { method: "POST", url: "/api/tasks", headers, body });
  expect(response.status).toBe(201);
  return response.body as { id: number; taskKey: string };
}

async function patch(key: string, body: Record<string, unknown>) {
  const response = await invoke(app, { method: "PATCH", url: `/api/tasks/${key}`, headers, body });
  expect(response.status).toBe(200);
  return response.body;
}

/** The Meetings lens exactly as the client asks for it. */
async function meetings(): Promise<{ title: string; taskKey: string; status: string; signals: { actions?: { done: number; total: number } } }[]> {
  const list = await invoke(app, { method: "GET", url: `/api/task-views?today=${today}`, headers });
  const definition = (list.body.views as { id: string; definition: unknown }[]).find((view) => view.id === "meetings")!.definition;
  const response = await invoke(app, {
    method: "GET",
    url: `/api/tasks?viewDef=${encodeURIComponent(Buffer.from(JSON.stringify(definition), "utf8").toString("base64url"))}&today=${today}`,
    headers,
  });
  expect(response.status).toBe(200);
  return response.body.tasks;
}

beforeEach(async () => {
  await resetDatabase();
  await db.insert(configTable).values([
    { key: "tasks_phase1_enabled", value: "true" },
    { key: "tasks_phase2_stage", value: "2c" },
    { key: "tasks_phase3_enabled", value: "true" },
  ]);
  await db.insert(developers).values({ accountId: "dev-1", displayName: "One", isActive: 1 });
  await auth.createUser({ username: "manager-a", displayName: "A", password: "secret123", role: "manager" });
  headers = { cookie: await cookie("manager-a") };
});

describe("built-in Meetings view", () => {
  it("is defined as meetings, open plus the last 14 days closed, grouped by meeting", async () => {
    const list = await invoke(app, { method: "GET", url: `/api/task-views?today=${today}`, headers });
    const view = (list.body.views as { id: string; name: string; section: string; definition: unknown }[]).find((entry) => entry.id === "meetings")!;
    expect(view).toMatchObject({ name: "Meetings", section: "plan" });
    expect(view.definition).toEqual({
      filters: { kind: "meeting", withClosed: { from: shift(-13) } },
      sort: "scheduled",
      group: "meeting",
    });
  });

  it("lists open meetings of any date, never plain tasks", async () => {
    await create({ title: "Past unresolved", kind: "meeting", scheduledOn: shift(-3) });
    await create({ title: "Today sync", kind: "meeting", scheduledOn: today });
    await create({ title: "Next month", kind: "meeting", scheduledOn: shift(30) });
    await create({ title: "Just a task", scheduledOn: today });
    expect((await meetings()).map((row) => row.title).sort()).toEqual(["Next month", "Past unresolved", "Today sync"]);
  });

  it("keeps a meeting closed in the last two weeks as Recent, and drops an older one", async () => {
    const recent = await create({ title: "Closed last week", kind: "meeting", scheduledOn: shift(-6) });
    const old = await create({ title: "Closed long ago", kind: "meeting", scheduledOn: shift(-40) });
    await patch(recent.taskKey, { status: "done" });
    await patch(old.taskKey, { status: "done" });
    await db.update(tasks).set({ closedAt: `${shift(-30)}T10:00:00.000Z` }).where(eq(tasks.taskKey, old.taskKey));

    const rows = await meetings();
    expect(rows.map((row) => row.title)).toEqual(["Closed last week"]);
    expect(rows[0]!.status).toBe("done");
  });

  it("includes a meeting closed right at the edge of the window", async () => {
    const edge = await create({ title: "Edge", kind: "meeting", scheduledOn: shift(-13) });
    await patch(edge.taskKey, { status: "done" });
    await db.update(tasks).set({ closedAt: `${shift(-13)}T12:00:00.000Z` }).where(eq(tasks.taskKey, edge.taskKey));
    expect((await meetings()).map((row) => row.title)).toEqual(["Edge"]);
  });

  it("does not leak closed plain tasks into the lens", async () => {
    const task = await create({ title: "Done task", scheduledOn: today });
    await patch(task.taskKey, { status: "done" });
    expect(await meetings()).toEqual([]);
  });

  it("tallies action items (child tasks) per meeting, ignoring dropped ones", async () => {
    const meeting = await create({ title: "Design review", kind: "meeting", scheduledOn: today });
    const a = await create({ title: "Send notes", parentId: meeting.id });
    await create({ title: "Book room", parentId: meeting.id });
    const dropped = await create({ title: "Cancelled idea", parentId: meeting.id });
    await patch(a.taskKey, { status: "done" });
    await patch(dropped.taskKey, { status: "dropped" });
    await create({ title: "Lonely meeting", kind: "meeting", scheduledOn: today });

    const rows = await meetings();
    expect(rows.find((row) => row.title === "Design review")!.signals.actions).toEqual({ done: 1, total: 2 });
    expect(rows.find((row) => row.title === "Lonely meeting")!.signals.actions).toEqual({ done: 0, total: 0 });
  });

  it("does not count another meeting's children, or deleted action items", async () => {
    const one = await create({ title: "One", kind: "meeting", scheduledOn: today });
    const two = await create({ title: "Two", kind: "meeting", scheduledOn: today });
    await create({ title: "Under one", parentId: one.id });
    const gone = await create({ title: "Removed", parentId: two.id });
    const removed = await invoke(app, { method: "DELETE", url: `/api/tasks/${gone.taskKey}`, headers });
    expect(removed.status).toBe(200);
    const rows = await meetings();
    expect(rows.find((row) => row.title === "One")!.signals.actions).toEqual({ done: 0, total: 1 });
    expect(rows.find((row) => row.title === "Two")!.signals.actions).toEqual({ done: 0, total: 0 });
  });

  it("only meeting rows carry action tallies", async () => {
    await create({ title: "A meeting", kind: "meeting", scheduledOn: today });
    const list = await invoke(app, { method: "GET", url: `/api/task-views?today=${today}`, headers });
    const mine = (list.body.views as { id: string; definition: unknown }[]).find((view) => view.id === "my-tasks")!.definition;
    await create({ title: "Plain", scheduledOn: today });
    const response = await invoke(app, { method: "GET", url: `/api/tasks?viewDef=${encodeURIComponent(Buffer.from(JSON.stringify(mine), "utf8").toString("base64url"))}&today=${today}`, headers });
    const plain = (response.body.tasks as { title: string; signals: { actions?: unknown } }[]).find((row) => row.title === "Plain")!;
    expect(plain.signals.actions).toBeUndefined();
  });

  it("view counts include the lens, and count closed rows inside the window", async () => {
    const done = await create({ title: "Wrapped", kind: "meeting", scheduledOn: today });
    await patch(done.taskKey, { status: "done" });
    await create({ title: "Open one", kind: "meeting", scheduledOn: today });
    const counts = await invoke(app, { method: "GET", url: `/api/tasks/view-counts?today=${today}`, headers });
    expect(counts.status).toBe(200);
    expect(counts.body.counts.meetings.count).toBe(2);
  });
});

describe("view definition schema", () => {
  it("accepts withClosed and the meeting group in a saved view, and rejects an unbounded range", async () => {
    const ok = await invoke(app, {
      method: "POST", url: "/api/task-views", headers,
      body: { name: "My meetings", definition: { filters: { kind: "meeting", withClosed: { from: shift(-6) } }, group: "meeting" } },
    });
    expect(ok.status).toBe(201);
    const bad = await invoke(app, {
      method: "POST", url: "/api/task-views", headers,
      body: { name: "Bad", definition: { filters: { withClosed: {} } } },
    });
    expect(bad.status).toBe(400);
  });
});
