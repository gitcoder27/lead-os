import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { db, resetDatabase } from "./helpers/db";
import { configTable, contacts, developers, tasks, teamTrackerItems, weeklyReviews } from "../src/db/schema";
import { ContactsService } from "../src/services/contacts.service";
import { TaskService } from "../src/services/task.service";
import { TaskEventsService } from "../src/services/task-events.service";
import { TeamTrackerService } from "../src/services/team-tracker.service";
import { ManagerDeskService } from "../src/services/manager-desk.service";
import { SearchService } from "../src/services/search.service";
import { WorkloadService } from "../src/services/workload.service";
import { DailyNotesService } from "../src/services/daily-notes.service";
import { WorkspaceMaintenanceService } from "../src/services/workspace-maintenance.service";
import { taskGuardFields, type ManagerTask, type TaskExpectedState, type TaskGuardField, type UpdateTaskRequest } from "shared/types";

const service = new TaskService();
const events = new TaskEventsService();
const manager = { type: "manager" as const, accountId: "manager-a", workspaceId: "default" };
const developer = { type: "developer" as const, accountId: "dev-1", workspaceId: "default" };
afterEach(() => vi.useRealTimers());

beforeEach(async () => {
  await resetDatabase();
  await db.insert(configTable).values([{ key: "tasks_phase1_enabled", value: "true" }, { key: "tasks_phase2_stage", value: "2b" }, { key: "tasks_phase2_id_seed", value: "0" }]);
  await db.insert(developers).values([{ accountId: "dev-1", displayName: "One", isActive: 1 }, { accountId: "dev-2", displayName: "Two", isActive: 1 }]);
});

describe("canonical tasks", () => {
  it("P3-02: triage marker and resurface date follow the triage rules and stay private", async () => {
    const bare = await service.create({ title: "Bare capture", scheduledOn: null }, manager, { untriaged: true });
    expect(bare.needsTriage).toBe(1);
    // Other create paths are triaged by default, and developers can never create untriaged work.
    expect((await service.create({ title: "Desk task" }, manager)).needsTriage).toBe(0);
    expect((await service.create({ title: "Mine" }, developer, { untriaged: true })).needsTriage).toBe(0);
    // Editing text is not a triage decision; a status change is.
    expect((await service.update(bare.taskKey, { title: "Renamed" }, manager)).needsTriage).toBe(1);
    expect((await service.update(bare.taskKey, { status: "active" }, manager)).needsTriage).toBe(0);
    expect((await service.update(bare.taskKey, { triaged: false }, manager)).needsTriage).toBe(1);

    const parked = await service.update(bare.taskKey, { status: "open", later: true, hideUntil: "2099-01-05" }, manager);
    expect(parked).toMatchObject({ later: 1, hideUntil: "2099-01-05", needsTriage: 0 });
    // Re-parking without a date clears the old one; un-parking always clears it.
    expect((await service.update(bare.taskKey, { later: true }, manager)).hideUntil).toBeNull();
    await service.update(bare.taskKey, { hideUntil: "2099-01-05" }, manager);
    expect((await service.update(bare.taskKey, { later: false }, manager)).hideUntil).toBeNull();
    await expect(service.update(bare.taskKey, { hideUntil: "2099-01-05" }, manager)).rejects.toMatchObject({ status: 409 });

    const devTask = await service.create({ title: "Dev work", ownerType: "developer", ownerId: "dev-1" }, manager);
    const devView = await service.toDto(devTask, developer);
    expect(devView).not.toHaveProperty("hideUntil");
    expect(devView).not.toHaveProperty("needsTriage");
    await expect(service.update(devTask.taskKey, { triaged: true } as never, developer)).rejects.toMatchObject({ status: 403 });
  });

  it("resets canonical tasks and events without relying on legacy rows", async () => {
    await service.create({ title: "Private task", nextAction: "Private" }, manager);
    await service.create({ title: "Developer task" }, developer);
    await new ContactsService().create(manager.accountId, { displayName: "Acme Legal" }, "default");
    const stamp = "2026-10-02T12:00:00.000Z";
    await db.insert(weeklyReviews).values([
      { workspaceId: "default", managerAccountId: manager.accountId, weekStart: "2026-09-28", startedAt: stamp, updatedAt: stamp },
      { workspaceId: "default", managerAccountId: "someone-else", weekStart: "2026-09-28", startedAt: stamp, updatedAt: stamp },
    ]);
    await new WorkspaceMaintenanceService().reset(manager.accountId, "workspace", "default");
    // The reset manager's weekly reviews go with their tasks; another manager's stay.
    expect((await db.select().from(weeklyReviews)).map((row) => row.managerAccountId)).toEqual(["someone-else"]);
    expect(await db.select().from(tasks)).toEqual([]);
    expect(await db.select().from(contacts)).toEqual([]);
    expect(await events.listRawForWorkspace()).toEqual([]);
  });

  it("creates canonical note follow-ups and resolves their source without Desk rows", async () => {
    const notes = new DailyNotesService();
    const date = service.today();
    await notes.save(manager.accountId, date, { body: "Follow up tomorrow", revision: 0 }, "default");
    const input = { title: "Check release", date, followUpAt: "2026-10-01T09:00:00Z", requestId: crypto.randomUUID() };
    const created = await notes.createFollowUp(manager.accountId, date, input, "default");
    expect(await notes.createFollowUp(manager.accountId, date, input, "default")).toMatchObject({ itemId: created.itemId });
    expect((await notes.getSources(manager.accountId, [created.itemId], "default")).sources[0]?.date).toBe(date);
    expect((await notes.getDay(manager.accountId, date, "default")).followUps[0]?.title).toBe("Check release");
  });

  it("adapts Desk and Tracker to a single task with no mirror writes", async () => {
    const desk = new ManagerDeskService();
    const item = await desk.createItem(manager.accountId, { date: service.today(), title: "One record", assigneeDeveloperAccountId: "dev-1" });
    await desk.updateItem(manager.accountId, item.id, { status: "in_progress" });
    const board = await new TeamTrackerService().getBoard(service.today());
    expect(board.developers.find((day) => day.developer.accountId === "dev-1")?.currentItem?.taskKey).toBe(item.taskKey);
    expect((await desk.getDay(manager.accountId, service.today())).items[0]).toMatchObject({ taskKey: item.taskKey, status: "in_progress" });
    await desk.moveLinkedItemsToDate(manager.accountId, { fromDate: service.today(), toDate: "2099-01-01", itemIds: [item.id] });
    expect((await service.getByKey(item.taskKey!))?.scheduledOn).toBe("2099-01-01");
    await desk.deleteItem(manager.accountId, item.id);
    expect((await service.getByKey(item.taskKey!))?.deletedAt).toBeTruthy();
    expect(await db.select().from(teamTrackerItems)).toEqual([]);
  });

  it("adapts Tracker writes without creating legacy task rows", async () => {
    const tracker = new TeamTrackerService();
    const item = await tracker.addItem("dev-1", service.today(), { title: "Adapter task", actor: manager });
    await tracker.setCurrentItem(item.id, undefined, "default", manager);
    await tracker.updateItem(item.id, { state: "done" }, "default", developer);
    expect((await service.getByKey(item.taskKey!))?.status).toBe("done");
    await expect(tracker.assertItemBelongsToDeveloper(item.id, "dev-2")).rejects.toMatchObject({ status: 404 });
    expect(await db.select().from(teamTrackerItems)).toEqual([]);
    const search = await new SearchService().search("Adapter", "default", manager.accountId);
    expect(search.tasks?.map((task) => task.taskKey)).toContain(item.taskKey);
    expect(search.deskItems).toEqual([]);
    expect(search.trackerItems).toEqual([]);
    expect((await new WorkloadService().getTeamWorkload(service.today())).find((row) => row.developer.accountId === "dev-1")?.completedTodayCount).toBe(1);
  });

  it("buckets completion by closure day and reconstructs pre-completion history", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-21T09:00:00Z"));
    const row = await service.create({ title: "Monday task", ownerType: "developer", ownerId: "dev-1" }, manager);
    vi.setSystemTime(new Date("2026-09-23T09:00:00Z"));
    await service.update(row.taskKey, { status: "done", title: "Wednesday title" }, manager);
    expect(await service.projectDeveloperBoardDay("dev-1", "2026-09-23")).toEqual([expect.objectContaining({ status: "done" })]);
    expect(await service.projectDeveloperBoardDay("dev-1", "2026-09-21")).toEqual([]);
    expect(await service.projectDeveloperHistoryDay("dev-1", "2026-09-21")).toEqual([expect.objectContaining({ status: "open", title: "Monday task" })]);
  });

  it("atomically switches current work and keeps task identity through reassignment", async () => {
    const first = await service.create({ title: "First", ownerType: "developer", ownerId: "dev-1", status: "active" }, manager);
    const second = await service.create({ title: "Second", ownerType: "developer", ownerId: "dev-1" }, manager);
    await expect(service.setCurrent(second.taskKey, manager, true)).rejects.toMatchObject({ status: 409 });
    expect((await service.getByKey(first.taskKey))?.status).toBe("active");
    await service.update(second.taskKey, { status: "active" }, developer);
    expect((await service.getByKey(first.taskKey))?.status).toBe("open");
    const reassigned = await service.update(second.taskKey, { ownerId: "dev-2" }, manager);
    expect(reassigned).toMatchObject({ id: second.id, taskKey: second.taskKey, status: "open", ownerId: "dev-2" });
    await expect(service.requireTask(second.taskKey, developer)).rejects.toMatchObject({ status: 404 });
    await expect(events.list(second.taskKey, { kind: "developer", accountId: "dev-1" })).rejects.toMatchObject({ status: 404 });
    expect((await events.list(second.taskKey, { kind: "developer", accountId: "dev-2" })).events.some((event) => event.type === "assign")).toBe(true);
    expect((await events.listRawForWorkspace()).every((event) => event.taskId !== null)).toBe(true);
    const board = await new TeamTrackerService().getBoard(service.today(), { workspaceId: "default", managerAccountId: manager.accountId });
    expect(board.developers.find((day) => day.developer.accountId === "dev-2")?.plannedItems[0]).toMatchObject({ taskKey: second.taskKey, title: "Second" });
  });

  it("omits manager fields from developer DTOs and enforces creator permissions", async () => {
    const row = await service.create({ title: "Delegated", ownerType: "developer", ownerId: "dev-1", nextAction: "Private action", labels: ["Private label"], followUpAt: "2026-10-01T10:00:00.000Z" }, manager);
    const dto = await service.toDto(row, developer);
    for (const field of ["nextAction", "labels", "labelsJson", "trackedByManagerId", "followUpAt"]) expect(dto).not.toHaveProperty(field);
    await expect(service.update(row.taskKey, { nextAction: "Overwrite" }, { ...manager, accountId: "manager-b" })).rejects.toMatchObject({ status: 403 });
    await expect(service.update(row.taskKey, { title: "Renamed" }, developer)).rejects.toMatchObject({ status: 403 });
    await expect(service.remove(row.taskKey, developer)).rejects.toMatchObject({ status: 403 });
    await expect(service.update(row.taskKey, { later: true }, manager)).rejects.toMatchObject({ status: 409 });
    const own = await service.create({ title: "Own task" }, developer);
    expect((await service.update(own.taskKey, { title: "Own renamed" }, developer)).title).toBe("Own renamed");
    await service.remove(own.taskKey, developer);
    expect((await service.getByKey(own.taskKey))?.deletedAt).toBeTruthy();
    expect(await db.select().from(tasks)).toHaveLength(2);
  });

  it("enforces Later semantics — no date, manager-owned only (G2)", async () => {
    // Create: /later stores scheduled_on as NULL, not today.
    const parked = await service.create({ title: "Park it", later: true }, manager);
    expect(parked.scheduledOn).toBeNull();
    expect(parked.later).toBe(1);

    // later + an explicit date is invalid either direction.
    await expect(service.create({ title: "Bad", later: true, scheduledOn: "2099-01-01" }, manager)).rejects.toMatchObject({ status: 409 });
    // Developer-owned Later is invalid — Later is a manager/inbox concept.
    await expect(service.create({ title: "Dev later", later: true, ownerType: "developer", ownerId: "dev-1" }, manager)).rejects.toMatchObject({ status: 409 });

    // Update: parking clears the scheduled date…
    const dated = await service.create({ title: "Scheduled", scheduledOn: "2099-01-01" }, manager);
    const updated = await service.update(dated.taskKey, { later: true }, manager);
    expect(updated.later).toBe(1);
    expect(updated.scheduledOn).toBeNull();
    // …but an explicit date in the same patch is still rejected.
    await expect(service.update(dated.taskKey, { later: true, scheduledOn: "2099-01-01" }, manager)).rejects.toMatchObject({ status: 409 });

    // Explicit scheduledOn:null on create is honored (stays unscheduled, not today).
    const unscheduled = await service.create({ title: "No date", scheduledOn: null }, manager);
    expect(unscheduled.scheduledOn).toBeNull();
  });

  it("rejects closed reassignment and invalid ownership without partial writes", async () => {
    const row = await service.create({ title: "Closed", status: "done" }, manager);
    await expect(service.update(row.taskKey, { ownerType: "developer", ownerId: "dev-1" }, manager)).rejects.toMatchObject({ status: 409 });
    await expect(service.create({ title: "Missing owner", ownerType: "developer" }, manager)).rejects.toMatchObject({ status: 400 });
    await expect(service.create({ title: "Inactive owner", ownerType: "developer", ownerId: "missing" }, manager)).rejects.toThrow();
    expect(await db.select().from(tasks)).toHaveLength(1);
  });
});
/** docs/61 TS-01 (D1): the optional `expected` guard on bulk writes. */
describe("bulk write guard", () => {
  const dto = async (key: string) => (await service.toDto((await service.getByKey(key))!, manager)) as ManagerTask;
  const pick = (task: ManagerTask, fields: TaskGuardField[]): TaskExpectedState => {
    const state: Record<string, unknown> = {};
    for (const field of fields) state[field] = field === "triaged" ? !task.needsTriage : field === "waitingOn" ? (task.waitingOn ? { type: task.waitingOn.type, ref: task.waitingOn.ref, label: task.waitingOn.label } : null) : task[field];
    return state as TaskExpectedState;
  };
  const guarded = async (key: string, changes: UpdateTaskRequest) => ({ key, changes, expected: pick(await dto(key), taskGuardFields(changes)) });

  it("refuses the whole undo when a later schedule change moved the same fields", async () => {
    const task = await service.create({ title: "Plan", scheduledOn: "2099-01-01" }, manager);
    await service.bulkUpdate([await guarded(task.taskKey, { scheduledOn: "2099-01-02", later: false })], manager);
    const postA = pick(await dto(task.taskKey), ["later", "scheduledOn", "hideUntil", "triaged"]);
    await service.bulkUpdate([await guarded(task.taskKey, { scheduledOn: "2099-01-03", later: false })], manager);

    await expect(service.bulkUpdate([{ key: task.taskKey, changes: { later: false, scheduledOn: "2099-01-01" }, expected: postA }], manager)).rejects.toMatchObject({ status: 409 });
    expect((await service.getByKey(task.taskKey))!.scheduledOn).toBe("2099-01-03");
  });

  it("ignores an unrelated edit, and treats a value changed away and back as unchanged", async () => {
    const task = await service.create({ title: "Plan", scheduledOn: "2099-01-01" }, manager);
    await service.bulkUpdate([await guarded(task.taskKey, { scheduledOn: "2099-01-02", later: false })], manager);
    const postA = pick(await dto(task.taskKey), ["later", "scheduledOn", "hideUntil", "triaged"]);
    await service.update(task.taskKey, { title: "Renamed", priority: "high" }, manager);
    await service.update(task.taskKey, { scheduledOn: "2099-01-09" }, manager);
    await service.update(task.taskKey, { scheduledOn: "2099-01-02" }, manager);

    const [row] = await service.bulkUpdate([{ key: task.taskKey, changes: { later: false, scheduledOn: "2099-01-01" }, expected: postA }], manager);
    expect(row).toMatchObject({ scheduledOn: "2099-01-01", title: "Renamed" });
  });

  it("changes neither task when one of two conflicts, with no events or labels left behind", async () => {
    const a = await service.create({ title: "A", scheduledOn: "2099-01-01" }, manager);
    const b = await service.create({ title: "B", scheduledOn: "2099-01-01" }, manager);
    const items = [await guarded(a.taskKey, { status: "done", labels: ["fresh-label"] }), await guarded(b.taskKey, { status: "done" })];
    await service.update(b.taskKey, { status: "active" }, manager);
    const eventsBefore = (await events.listRawForWorkspace()).length;

    await expect(service.bulkUpdate(items, manager)).rejects.toMatchObject({ status: 409, message: `${b.taskKey}: Task changed since this action` });
    expect((await service.getByKey(a.taskKey))).toMatchObject({ status: "open", labelsJson: null });
    expect((await service.getByKey(b.taskKey))!.status).toBe("active");
    expect((await events.listRawForWorkspace()).length).toBe(eventsBefore);
  });

  it("guards coupled fields: Later restores the resurface date and the Inbox marker", async () => {
    const task = await service.create({ title: "Parked", later: true, hideUntil: "2099-02-01", scheduledOn: null }, manager);
    await service.update(task.taskKey, { triaged: false }, manager);
    const before = await dto(task.taskKey);
    const forward: UpdateTaskRequest = { later: false, scheduledOn: "2099-01-05" };
    await service.bulkUpdate([await guarded(task.taskKey, forward)], manager);
    const post = pick(await dto(task.taskKey), taskGuardFields({ later: true, scheduledOn: null, hideUntil: "2099-02-01", triaged: false }));
    const [row] = await service.bulkUpdate([{ key: task.taskKey, changes: { later: true, scheduledOn: null, hideUntil: before.hideUntil, triaged: false }, expected: post }], manager);
    expect(row).toMatchObject({ later: 1, scheduledOn: null, hideUntil: "2099-02-01", needsTriage: 1 });
  });

  it("refuses a changed Inbox marker or waiting party, and accepts an unchanged party", async () => {
    const task = await service.create({ title: "Chase", scheduledOn: null }, manager, { untriaged: true });
    await service.update(task.taskKey, { waitingOn: { type: "text", label: "Legal" } }, manager);
    const expected = pick(await dto(task.taskKey), taskGuardFields({ waitingOn: null }));
    await service.bulkUpdate([{ key: task.taskKey, changes: { waitingOn: null }, expected }], manager);
    await expect(service.bulkUpdate([{ key: task.taskKey, changes: { waitingOn: null }, expected }], manager)).rejects.toMatchObject({ status: 409 });

    await service.update(task.taskKey, { waitingOn: { type: "text", label: "Legal" } }, manager);
    const party = { ...expected, waitingOn: { type: "text" as const, label: "Finance" } };
    await expect(service.bulkUpdate([{ key: task.taskKey, changes: { waitingOn: null }, expected: party }], manager)).rejects.toMatchObject({ status: 409 });
    const inboxNow = { ...expected, waitingOn: { type: "text" as const, label: "Legal" }, triaged: false };
    await expect(service.bulkUpdate([{ key: task.taskKey, changes: { waitingOn: null }, expected: inboxNow }], manager)).rejects.toMatchObject({ status: 409 });
  });

  it("rejects a guard that omits a coupled field, and stays compatible without one", async () => {
    const task = await service.create({ title: "Plan", scheduledOn: "2099-01-01" }, manager);
    await expect(service.bulkUpdate([{ key: task.taskKey, changes: { later: true }, expected: { later: false } }], manager)).rejects.toMatchObject({ status: 400 });
    await expect(service.bulkUpdate([{ key: task.taskKey, changes: { status: "done" }, expected: { status: "open", bogus: 1 } as never }], manager)).rejects.toMatchObject({ status: 400 });
    expect(taskGuardFields({ ownerType: "developer", ownerId: "dev-1" }).sort()).toEqual(["ownerId", "ownerType", "status", "triaged"]);
    const [row] = await service.bulkUpdate([{ key: task.taskKey, changes: { status: "done" } }], manager);
    expect(row!.status).toBe("done");
  });

  it("does not reveal another manager's private values through the guard", async () => {
    const other = { type: "manager" as const, accountId: "manager-b", workspaceId: "default" };
    const task = await service.create({ title: "Dev work", ownerType: "developer", ownerId: "dev-1" }, manager);
    // The viewer sees `later: false` on a task they do not track; a stale-looking guard must not probe the real value.
    const expected = { later: false, scheduledOn: task.scheduledOn, hideUntil: null, triaged: true };
    const [row] = await service.bulkUpdate([{ key: task.taskKey, changes: { scheduledOn: "2099-01-04" }, expected }], other);
    expect(row!.scheduledOn).toBe("2099-01-04");
  });
});
