import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db, rawDb } from "../src/db/connection";
import { configTable, dayFocus, taskEvents, tasks } from "../src/db/schema";
import { TaskEventsService } from "../src/services/task-events.service";
import { TaskService } from "../src/services/task.service";
import { ManagerDeskService } from "../src/services/manager-desk.service";
import { resetDatabase } from "./helpers/db";
const date = "2026-09-10";
const end = new Date(2026, 8, 11).toISOString();
const before = new Date(Date.parse(end) - 1).toISOString();
const after = new Date(Date.parse(end) + 1).toISOString();
const service = new TaskService();
const events = new TaskEventsService();

beforeEach(async () => { await resetDatabase(); await db.insert(configTable).values([{ key: "tasks_phase1_enabled", value: "true" }, { key: "tasks_phase2_stage", value: "2c" }]); });
afterEach(() => { vi.restoreAllMocks(); });
const addTask = async (extra: Partial<typeof tasks.$inferInsert> = {}) => (await db.insert(tasks).values({ taskKey: "T-1", title: "Current", trackedByManagerId: "manager", createdAt: before, updatedAt: after, ...extra }).returning())[0]!;
const addEvent = async (taskId: number, type: string, meta: object, extra: Partial<typeof taskEvents.$inferInsert> = {}) => (await db.insert(taskEvents).values({ taskId, taskKey: `T-${taskId}`, type, metaJson: JSON.stringify(meta), visibility: "private", authorType: "manager", occurredAt: after, createdAt: after, ...extra }).returning())[0]!;

it("reconstructs all manager fields with cutoff inclusivity, descending id ties, redactions and tenant isolation", async () => {
  const task = await addTask({ title: "C", status: "done", closedAt: after, priority: "high", ownerType: "developer", ownerId: "new", scheduledOn: "2026-09-14", dueAt: after, followUpAt: after, startsAt: after, endsAt: after });
  const first = await addEvent(task.id, "title", { from: "A", to: "B" }, { occurredAt: end });
  const second = await addEvent(task.id, "title", { from: "B", to: "C" }, { occurredAt: end });
  await addEvent(task.id, "status", { from: "in_progress", to: "done" });
  await addEvent(task.id, "priority", { from: "normal", to: "high" });
  await addEvent(task.id, "assign", { fromId: "old", fromType: "manager" });
  for (const field of ["day", "due_at", "follow_up_at", "planned_start_at", "planned_end_at"]) await addEvent(task.id, "schedule", { field, from: field === "day" ? "2026-09-15" : null });
  await addEvent(task.id, "title", { from: "redacted" }, { redactedAt: after });
  await addEvent(task.id, "title", { from: "foreign" }, { workspaceId: "other" });
  await addEvent(task.id, "title", { from: "too early" }, { occurredAt: before });
  await addEvent(task.id, "update", {}, { metaJson: "not reconstruction JSON" });
  const selected = await events.reconstructionForTasks([task.id], end);
  expect(selected).toHaveLength(10);
  expect(selected.filter(event => event.type === "title").map(event => event.metaJson)).toEqual([second.metaJson, first.metaJson]);
  const [projected] = await service.history("manager", date);
  expect(projected).toMatchObject({ title: "A", status: "active", closedAt: null, deletedAt: null, priority: "normal", ownerType: "manager", ownerId: "old", scheduledOn: "2026-09-15", dueAt: null, followUpAt: null, startsAt: null, endsAt: null });
  const desk = await new ManagerDeskService().getDay("manager", date);
  expect(desk.viewMode).toBe("history");
  expect(desk.items[0]).toMatchObject({ title: "A" });
});

it("preserves existence, closure and deletion boundaries, including work scheduled on other dates", async () => {
  await addTask({ taskKey: "T-1", createdAt: end });
  await addTask({ taskKey: "T-2", deletedAt: before });
  const deletedAtCutoff = await addTask({ taskKey: "T-3", deletedAt: end, scheduledOn: "2026-10-01" });
  const closedBefore = await addTask({ taskKey: "T-4", status: "done", closedAt: before });
  const closedAtCutoff = await addTask({ taskKey: "T-5", status: "done", closedAt: end });
  await addTask({ taskKey: "T-6", trackedByManagerId: "someone-else" });
  await addTask({ taskKey: "T-7", workspaceId: "other" });
  const history = await service.history("manager", date);
  expect(history.map(row => row.id).sort((a, b) => a - b)).toEqual([deletedAtCutoff.id, closedBefore.id, closedAtCutoff.id]);
  expect([...history].sort((a, b) => a.id - b.id).map(row => [row.deletedAt, row.status, row.closedAt])).toEqual([[null, "open", null], [null, "done", before], [null, "open", null]]);
  expect(await events.reconstructionForTasks([], end)).toEqual([]);
});

it("preserves developer history projection and the caller's zone", async () => {
  const utcEnd = "2026-09-11T00:00:00.000Z";
  const task = await addTask({ title: "New", ownerType: "developer", ownerId: "dev", status: "done", closedAt: utcEnd });
  await db.insert(dayFocus).values({ workspaceId: "default", taskId: task.id, ownerType: "developer", ownerId: "dev", date, position: 0, isCurrent: 0, source: "manual", createdAt: before });
  await addEvent(task.id, "title", { from: "Original", to: "Middle" }, { occurredAt: utcEnd });
  await addEvent(task.id, "title", { from: "Middle", to: "New" }, { occurredAt: utcEnd });
  await addEvent(task.id, "status", { from: "planned", to: "done" }, { occurredAt: utcEnd });
  const history = await service.projectDeveloperHistoryDay("dev", date, "default", "UTC");
  expect(history[0]).toMatchObject({ title: "Original", status: "open" });
});

it("loads only reconstruction events and visits their task IDs once on 4,000 tasks / 40,000 events", async () => {
  const insertTask = rawDb.prepare("INSERT INTO tasks (task_key,title,tracked_by_manager_id,created_at,updated_at) VALUES (?,?,?,?,?)");
  const insertEvent = rawDb.prepare("INSERT INTO task_events (task_id,task_key,type,meta_json,visibility,author_type,occurred_at,created_at) VALUES (?,?,?,?,?,?,?,?)");
  rawDb.transaction(() => {
    for (let i = 1; i <= 4000; i++) {
      const key = `T-${i}`;
      const id = Number(insertTask.run(key, `Current ${i}`, "manager", before, after).lastInsertRowid);
      for (let j = 0; j < 10; j++) insertEvent.run(id, key, j === 9 ? "title" : "update", JSON.stringify(j === 9 ? { from: `Original ${i}` } : {}), "private", "manager", j < 5 ? before : after, after);
    }
  })();
  let idReads = 0;
  const original = TaskEventsService.prototype.reconstructionForTasks;
  const query = vi.spyOn(TaskEventsService.prototype, "reconstructionForTasks").mockImplementation(async function (...args) {
    const rows = await original.apply(this, args);
    expect(rows).toHaveLength(4000);
    return rows.map(event => ({ ...event, get taskId() { idReads++; return event.taskId; } }));
  });
  const allHistory = vi.spyOn(TaskEventsService.prototype, "historyForTasks");
  const reconstructed = await service.history("manager", date);
  expect(query).toHaveBeenCalledOnce();
  expect(allHistory).not.toHaveBeenCalled();
  expect(idReads).toBe(4000);
  expect(reconstructed).toHaveLength(4000);
  reconstructed.forEach((row, index) => expect(row.title).toBe(`Original ${index + 1}`));
  expect(db.select().from(tasks).where(eq(tasks.title, "Current 1")).all()).toHaveLength(1);
});
