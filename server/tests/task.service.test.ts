import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { db, resetDatabase } from "./helpers/db";
import { configTable, developers, tasks, teamTrackerItems } from "../src/db/schema";
import { TaskService } from "../src/services/task.service";
import { TaskEventsService } from "../src/services/task-events.service";
import { TeamTrackerService } from "../src/services/team-tracker.service";
import { ManagerDeskService } from "../src/services/manager-desk.service";
import { SearchService } from "../src/services/search.service";
import { WorkloadService } from "../src/services/workload.service";
import { DailyNotesService } from "../src/services/daily-notes.service";
import { WorkspaceMaintenanceService } from "../src/services/workspace-maintenance.service";

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
  it("resets canonical tasks and events without relying on legacy rows", async () => {
    await service.create({ title: "Private task", nextAction: "Private" }, manager);
    await service.create({ title: "Developer task" }, developer);
    await new WorkspaceMaintenanceService().reset(manager.accountId, "workspace", "default");
    expect(await db.select().from(tasks)).toEqual([]);
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

  it("rejects closed reassignment and invalid ownership without partial writes", async () => {
    const row = await service.create({ title: "Closed", status: "done" }, manager);
    await expect(service.update(row.taskKey, { ownerType: "developer", ownerId: "dev-1" }, manager)).rejects.toMatchObject({ status: 409 });
    await expect(service.create({ title: "Missing owner", ownerType: "developer" }, manager)).rejects.toMatchObject({ status: 400 });
    await expect(service.create({ title: "Inactive owner", ownerType: "developer", ownerId: "missing" }, manager)).rejects.toThrow();
    expect(await db.select().from(tasks)).toHaveLength(1);
  });
});