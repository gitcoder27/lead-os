import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, resetDatabase } from "./helpers/db";
import {
  dataMigrations,
  developers,
  managerDeskDays,
  managerDeskItems,
  taskKeySequences,
  teamTrackerDays,
  teamTrackerItems,
} from "../src/db/schema";
import { TaskPhase2BackfillService } from "../src/services/task-phase2-backfill.service";
import { TaskService, taskStatusToDeskStatus, taskStatusToTrackerState } from "../src/services/task.service";
import { TeamTrackerService } from "../src/services/team-tracker.service";
import { ManagerDeskService } from "../src/services/manager-desk.service";
import { todayIsoDate } from "../src/utils/date";

const service = new TaskPhase2BackfillService();
const taskService = new TaskService();
const tracker = new TeamTrackerService();
const desk = new ManagerDeskService();

const P1_AT = "2026-02-01T00:00:00.000Z";
const today = todayIsoDate();
const yesterday = new Date(`${today}T00:00:00Z`);
yesterday.setUTCDate(yesterday.getUTCDate() - 1);
const yday = yesterday.toISOString().slice(0, 10);
const T = (isoDate: string, time = "T09:00:00.000Z") => `${isoDate}${time}`;

const devStatusToTask = (state: string) => ({ planned: "open", in_progress: "active", done: "done", dropped: "dropped" }[state] ?? state);
const deskStatusToTask = (status: string) => ({ inbox: "open", planned: "open", in_progress: "active", waiting: "blocked", backlog: "open", done: "done", cancelled: "dropped" }[status] ?? status);

async function devDay(date: string, dev = "dev-1") {
  return (await db.insert(teamTrackerDays).values({
    workspaceId: "default", date, developerAccountId: dev, createdAt: T(date, "T07:00:00.000Z"), updatedAt: T(date, "T07:00:00.000Z"),
  }).returning())[0]!;
}

async function trackerRow(dayId: number, o: { taskKey: string; title: string; state?: string; position?: number; managerDeskItemId?: number; createdAt: string; updatedAt?: string; completedAt?: string }) {
  return (await db.insert(teamTrackerItems).values({
    workspaceId: "default", dayId, taskKey: o.taskKey, itemType: "custom",
    managerDeskItemId: o.managerDeskItemId ?? null,
    title: o.title, state: o.state ?? "planned", position: o.position ?? 0,
    createdAt: o.createdAt, updatedAt: o.updatedAt ?? o.createdAt, completedAt: o.completedAt ?? null,
  }).returning())[0]!;
}

async function deskDay(date: string, manager = "mgr-1") {
  return (await db.insert(managerDeskDays).values({
    workspaceId: "default", date, managerAccountId: manager, createdAt: T(date, "T07:00:00.000Z"), updatedAt: T(date, "T07:00:00.000Z"),
  }).returning())[0]!;
}

async function deskRow(dayId: number, o: { taskKey: string; title: string; status?: string; assignee?: string; followUpAt?: string; createdAt: string }) {
  return (await db.insert(managerDeskItems).values({
    workspaceId: "default", dayId, taskKey: o.taskKey, title: o.title,
    kind: "action", category: "other", status: o.status ?? "planned", priority: "medium",
    assigneeDeveloperAccountId: o.assignee ?? null, followUpAt: o.followUpAt ?? null,
    createdAt: o.createdAt, updatedAt: o.createdAt,
  }).returning())[0]!;
}

async function backfill() {
  const report = await service.plan("default");
  await service.apply("default", { inputHash: report.inputHash, decisions: report.decisionsTemplate.decisions });
}

beforeEach(async () => {
  await resetDatabase();
  await db.insert(developers).values({ accountId: "dev-1", displayName: "Dev One", isActive: 1 });
  await db.insert(dataMigrations).values([
    { name: "p1_assign_task_keys", appliedAt: P1_AT },
    { name: "p1_import_task_notes", appliedAt: P1_AT },
  ]);
  await db.insert(taskKeySequences).values({ workspaceId: "default", nextValue: 100 });
});

// A leftover p2_backfill marker would contract task_events.task_id to NOT NULL
// the next time any file runs migrate() — leave the shared DB clean.
afterAll(async () => {
  await resetDatabase();
});

describe("Phase 2 parity (§2.5.3)", () => {
  it("live board: task projection equals legacy board rows on {key,title,status}", async () => {
    const day = await devDay(today);
    await trackerRow(day.id, { taskKey: "T-1", title: "Active work", state: "in_progress", position: 0, createdAt: T(today) });
    await trackerRow(day.id, { taskKey: "T-2", title: "Planned work", state: "planned", position: 1, createdAt: T(today) });
    await backfill();

    const board = await tracker.getBoard(today, { workspaceId: "default" });
    const dev = board.developers!.find((d) => d.developer.accountId === "dev-1")!;
    const legacy = new Map<string, { title: string; status: string }>();
    for (const item of [dev.currentItem, ...dev.plannedItems, ...dev.completedItems, ...dev.droppedItems].filter(Boolean)) {
      legacy.set(item!.taskKey!, { title: item!.title, status: devStatusToTask(item!.state) });
    }
    const projected = new Map((await taskService.projectDeveloperBoardDay("dev-1", today, "default")).map((p) => [p.taskKey, p]));
    expect([...projected.keys()].sort()).toEqual([...legacy.keys()].sort());
    for (const [key, item] of legacy) {
      expect(projected.get(key)!.title).toBe(item.title);
      expect(projected.get(key)!.status).toBe(item.status);
    }
  });

  it("history day: day_focus projection equals the day's legacy rows", async () => {
    const day = await devDay(yday);
    await trackerRow(day.id, { taskKey: "T-1", title: "Done yesterday", state: "done", createdAt: T(yday), completedAt: T(yday, "T17:00:00.000Z"), updatedAt: T(yday, "T17:00:00.000Z") });
    await trackerRow(day.id, { taskKey: "T-2", title: "Dropped yesterday", state: "dropped", createdAt: T(yday) });
    await backfill();

    const legacyRows = await db.select().from(teamTrackerItems).where(eq(teamTrackerItems.dayId, day.id));
    const projected = new Map((await taskService.projectDeveloperHistoryDay("dev-1", yday, "default")).map((p) => [p.taskKey, p]));
    expect([...projected.keys()].sort()).toEqual(legacyRows.map((r) => r.taskKey).sort());
    for (const row of legacyRows) {
      expect(projected.get(row.taskKey!)!.title).toBe(row.title);
      expect(taskStatusToTrackerState(projected.get(row.taskKey!)!.status, projected.get(row.taskKey!)!.later)).toBe(row.state === "in_progress" ? "in_progress" : row.state);
    }
  });

  it("desk today: projected items equal getTodayItems on {key,title,status}", async () => {
    const day = await deskDay(today);
    await deskRow(day.id, { taskKey: "T-1", title: "Desk planned", status: "planned", createdAt: T(today) });
    await deskRow(day.id, { taskKey: "T-2", title: "Desk waiting", status: "waiting", followUpAt: today, createdAt: T(today) });
    await backfill();

    const legacy = new Map((await desk.getTodayItems("mgr-1", today, "default"))
      .filter((item) => item.taskKey)
      .map((item) => [item.taskKey!, { title: item.title, status: deskStatusToTask(item.status) }]));
    const projected = new Map((await taskService.projectTodayItems("mgr-1", today, "default")).map((p) => [p.taskKey, p]));
    expect([...projected.keys()].sort()).toEqual([...legacy.keys()].sort());
    for (const [key, item] of legacy) {
      expect(projected.get(key)!.title).toBe(item.title);
      expect(projected.get(key)!.status).toBe(item.status);
    }
  });

  it("delegated task: board + desk projections agree on the same canonical task", async () => {
    const day = await deskDay(today);
    const item = await deskRow(day.id, { taskKey: "T-1", title: "Delegated", status: "planned", assignee: "dev-1", createdAt: T(today) });
    const dev = await devDay(today);
    await trackerRow(dev.id, { taskKey: "T-1", title: "Delegated", managerDeskItemId: item.id, state: "in_progress", createdAt: T(today) });
    await backfill();

    const devProjection = await taskService.projectDeveloperBoardDay("dev-1", today, "default");
    expect(devProjection).toHaveLength(1);
    expect(devProjection[0]).toMatchObject({ taskKey: "T-1", status: "active", title: "Delegated" });
    // Same-day planned items are not "today items" (no carry-forward yet) —
    // both legacy and projection agree it's absent; the desk day view has it.
    const legacyToday = await desk.getTodayItems("mgr-1", today, "default");
    const projectedToday = await taskService.projectTodayItems("mgr-1", today, "default");
    expect(projectedToday.map((p) => p.taskKey)).toEqual(legacyToday.filter((i) => i.taskKey).map((i) => i.taskKey));
    const deskProjection = await taskService.projectDeskDay("mgr-1", today, "default");
    expect(deskProjection.map((p) => p.taskKey)).toContain("T-1");
    expect(taskStatusToDeskStatus(devProjection[0]!.status, devProjection[0]!.later)).toBe("in_progress");
  });

  it("--verify is clean after apply on a mixed fixture", async () => {
    const day = await devDay(today);
    await trackerRow(day.id, { taskKey: "T-1", title: "A", state: "in_progress", createdAt: T(today) });
    const deskDayRow = await deskDay(today);
    await deskRow(deskDayRow.id, { taskKey: "T-2", title: "B", status: "inbox", createdAt: T(today) });
    await backfill();
    const result = await service.verify("default", { strict: true });
    expect(result.ok).toBe(true);
    expect(result.parityDiffs).toEqual([]);
  });
});
