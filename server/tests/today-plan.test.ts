import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app";
import { db, resetDatabase } from "./helpers/db";
import { invoke } from "./helpers/http";
import { configTable, dayFocus, developers, tasks } from "../src/db/schema";
import { AuthService, serializeSessionCookie } from "../src/services/auth.service";
import { IssueService } from "../src/services/issue.service";
import { ManagerDeskService } from "../src/services/manager-desk.service";
import { TaskService, type TaskPrincipal } from "../src/services/task.service";
import { TeamTrackerService } from "../src/services/team-tracker.service";
import { TodayService } from "../src/services/today.service";

/** docs/57 §6 (P3-01): Today "my plan", the pinned top 3, and real completions. */
const DATE = "2026-03-08";
const TOMORROW = "2026-03-09";
const authService = new AuthService();
const trackerService = new TeamTrackerService();
const managerDeskService = new ManagerDeskService(trackerService);
const issueService = new IssueService(undefined, undefined, trackerService);
const taskService = new TaskService();
const syncStub = { getLastSyncLog: async () => undefined, getRuntimeStatus: () => ({ status: "idle" as const }) };

function newTodayService() {
  return new TodayService(issueService, trackerService, managerDeskService, syncStub, { todayCacheTtlMs: 0 });
}

function createTestApp(todayService = newTodayService()) {
  return createApp({
    issueService,
    workloadService: {} as any,
    alertService: {} as any,
    automationService: {} as any,
    syncEngine: syncStub as any,
    backupService: {} as any,
    tagService: {} as any,
    teamTrackerService: trackerService,
    authService,
    myDayService: {} as any,
    managerDeskService,
    todayService,
    searchService: {} as any,
    workSavedViewsService: {} as any,
  });
}

let manager: TaskPrincipal;
let cookie: string;
let testApp: ReturnType<typeof createTestApp>;

async function getToday(app = testApp, tz = "UTC") {
  const response = await invoke(app, { method: "GET", url: `/api/today?date=${DATE}&tz=${encodeURIComponent(tz)}`, headers: { cookie } });
  expect(response.status).toBe(200);
  return response.body;
}

async function put(body: unknown, app = testApp) {
  return invoke(app, { method: "PUT", url: "/api/today/top3", headers: { cookie }, body });
}

async function add(title: string, extra: Record<string, unknown> = {}): Promise<string> {
  const row = await taskService.create({ title, ownerType: "manager", ownerId: manager.accountId, ...extra } as never, manager);
  return row.taskKey;
}

describe("Today plan (P3-01)", () => {
  beforeEach(async () => {
    // Only the clock: faking setImmediate stalls Express once an error is routed to its handler.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-03-08T04:00:00.000Z"));
    await resetDatabase();
    const user = await authService.createUser({ username: "manager", displayName: "Manager", password: "secret123", role: "manager" });
    await db.insert(configTable).values([
      { key: "tasks_phase1_enabled", value: "true" },
      { key: "tasks_phase2_stage", value: "2c" },
      { key: "tasks_phase3_enabled", value: "true" },
    ]);
    manager = { type: "manager", accountId: user.accountId, workspaceId: user.workspaceId };
    cookie = serializeSessionCookie((await authService.authenticate("manager", "secret123")).sessionId);
    testApp = createTestApp();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("lists my open planned and active tasks, never waiting, later, future or someone else's", async () => {
    await add("Due today", { scheduledOn: DATE });
    await add("Slipped", { scheduledOn: "2026-03-05" });
    const active = await add("In progress", { status: "active", scheduledOn: null });
    await add("Future", { scheduledOn: "2026-03-20" });
    await add("Parked", { later: true });
    await add("Waiting on legal", { scheduledOn: DATE, waitingOn: { type: "text", label: "Legal" } });
    await add("Undated backlog", { scheduledOn: null });
    await taskService.create({ title: "Someone else's", ownerType: "manager", ownerId: "other-manager", scheduledOn: DATE } as never, { ...manager, accountId: "other-manager" });

    const plan = (await getToday()).focus.plan;

    expect(plan.items.map((item: { title: string }) => item.title).sort()).toEqual(["Due today", "In progress", "Slipped"]);
    expect(plan.items.find((item: { taskKey: string }) => item.taskKey === active)).toMatchObject({ status: "active", overdue: false, pinned: false });
    expect(plan.items.find((item: { title: string }) => item.title === "Slipped")).toMatchObject({ overdue: true });
    // Overdue leads the plain rows.
    expect(plan.items[0].title).toBe("Slipped");
  });

  it("is empty when nothing is planned, and counts the Inbox", async () => {
    await taskService.create({ title: "Captured", scheduledOn: null } as never, manager, { untriaged: true });
    const plan = (await getToday()).focus.plan;
    expect(plan.items).toEqual([]);
    expect(plan.top3).toEqual([]);
    expect(plan.inboxCount).toBe(1);
  });

  it("pins up to three, pins lead the plan and the queue, and survive a fresh server", async () => {
    const a = await add("Alpha", { scheduledOn: DATE });
    const b = await add("Bravo", { scheduledOn: DATE });
    const c = await add("Charlie", { scheduledOn: DATE });
    await add("Delta", { scheduledOn: DATE });

    const saved = await put({ date: DATE, taskKeys: [c, a] });
    expect(saved.status).toBe(200);
    expect(saved.body).toEqual({ date: DATE, taskKeys: [c, a] });

    // A brand new service instance (no cache, no session) sees the same pins.
    const today = await getToday(createTestApp(newTodayService()));
    expect(today.focus.plan.top3).toEqual([c, a]);
    expect(today.focus.plan.items.slice(0, 2).map((item: { taskKey: string; pinned: boolean }) => [item.taskKey, item.pinned])).toEqual([[c, true], [a, true]]);
    const queue = today.actionItems as { type: string; title: string; target: { taskKey?: string }; primaryAction: { kind: string } }[];
    expect(queue.slice(0, 2).map((item) => item.type)).toEqual(["top_three", "top_three"]);
    expect(queue.slice(0, 2).map((item) => item.target.taskKey)).toEqual([c, a]);
    expect(queue[0]!.primaryAction.kind).toBe("mark_done");
    expect(queue.filter((item) => item.type === "top_three")).toHaveLength(2);

    // Replacing writes the whole set: three is the ceiling.
    expect((await put({ date: DATE, taskKeys: [a, b, c] })).status).toBe(200);
    expect((await getToday()).focus.plan.top3).toEqual([a, b, c]);
    const tooMany = await put({ date: DATE, taskKeys: [a, b, c, "T-999"] });
    expect(tooMany.status).toBe(400);
    expect((await getToday()).focus.plan.top3).toEqual([a, b, c]);

    expect((await put({ date: DATE, taskKeys: [] })).status).toBe(200);
    expect((await getToday()).focus.plan.top3).toEqual([]);
  });

  it("folds a pinned task's carry row into its pin", async () => {
    const key = await add("Slipped and pinned", { scheduledOn: "2026-03-05" });
    const before = (await getToday()).actionItems as { type: string; target: { taskKey?: string } }[];
    expect(before.some((item) => item.type === "desk_carry_forward" && item.target.taskKey === key)).toBe(true);

    await put({ date: DATE, taskKeys: [key] });
    const after = (await getToday()).actionItems as { type: string; target: { taskKey?: string } }[];
    expect(after.filter((item) => item.target.taskKey === key).map((item) => item.type)).toEqual(["top_three"]);
  });

  it("rejects closed, unknown and other people's tasks and leaves pins alone", async () => {
    const good = await add("Good", { scheduledOn: DATE });
    const done = await add("Finished", { scheduledOn: DATE });
    await taskService.update(done, { status: "done" }, manager);
    const foreign = (await taskService.create({ title: "Not mine", ownerType: "manager", ownerId: "other-manager" } as never, { ...manager, accountId: "other-manager" })).taskKey;
    await put({ date: DATE, taskKeys: [good] });

    expect((await put({ date: DATE, taskKeys: [done] })).status).toBe(409);
    expect((await put({ date: DATE, taskKeys: [foreign] })).status).toBe(404);
    expect((await put({ date: DATE, taskKeys: ["T-424242"] })).status).toBe(404);
    expect((await put({ date: DATE, taskKeys: ["nope"] })).status).toBe(400);
    expect((await put({ date: "yesterday", taskKeys: [] })).status).toBe(400);
    expect((await getToday()).focus.plan.top3).toEqual([good]);
  });

  it("does not touch developer plan rows", async () => {
    await add("Mine", { scheduledOn: DATE });
    const before = await db.select().from(dayFocus);
    await put({ date: DATE, taskKeys: [] });
    expect(await db.select().from(dayFocus)).toEqual(before);
  });

  it("drops a pin once the task is done, and counts it under Done today", async () => {
    const a = await add("Ship it", { scheduledOn: DATE });
    const b = await add("Stay open", { scheduledOn: DATE });
    await put({ date: DATE, taskKeys: [a, b] });
    await taskService.update(a, { status: "done" }, manager);

    const plan = (await getToday()).focus.plan;
    expect(plan.top3).toEqual([b]);
    expect(plan.items.map((item: { taskKey: string }) => item.taskKey)).toEqual([b]);
    expect(plan.doneToday.count).toBe(1);
    expect(plan.doneToday.items[0]).toMatchObject({ taskKey: a, title: "Ship it" });
  });

  it("counts real completions today: done only, mine only, and not yesterday's", async () => {
    const keys = [await add("Today one", { scheduledOn: DATE }), await add("Today two", { scheduledOn: DATE }), await add("Dropped", { scheduledOn: DATE })];
    for (const key of keys.slice(0, 2)) await taskService.update(key, { status: "done" }, manager);
    await taskService.update(keys[2]!, { status: "dropped" }, manager);
    const old = await add("Yesterday", { scheduledOn: DATE });
    await taskService.update(old, { status: "done" }, manager);
    await db.update(tasks).set({ closedAt: "2026-03-06T10:00:00.000Z" }).where(eqTaskKey(old));
    const foreign = await taskService.create({ title: "Their win", ownerType: "manager", ownerId: "other-manager" } as never, { ...manager, accountId: "other-manager" });
    await taskService.update(foreign.taskKey, { status: "done" }, { ...manager, accountId: "other-manager" });

    const first = (await getToday()).focus.plan.doneToday;
    expect(first.count).toBe(2);
    expect(first.items.map((item: { title: string }) => item.title).sort()).toEqual(["Today one", "Today two"]);

    // No session state involved: a fresh service reads the same number.
    expect((await getToday(createTestApp(newTodayService()))).focus.plan.doneToday.count).toBe(2);
  });

  it("carries tomorrow's picks, and only while they are open", async () => {
    const a = await add("Lead with this", { scheduledOn: DATE });
    const b = await add("And this", { scheduledOn: DATE });
    await put({ date: TOMORROW, taskKeys: [b, a] });

    let plan = (await getToday()).focus.plan;
    expect(plan.tomorrowTop3.date).toBe(TOMORROW);
    expect(plan.tomorrowTop3.items.map((item: { taskKey: string }) => item.taskKey)).toEqual([b, a]);
    // Tomorrow's pins are not today's.
    expect(plan.top3).toEqual([]);

    await taskService.update(b, { status: "done" }, manager);
    plan = (await getToday()).focus.plan;
    expect(plan.tomorrowTop3.items.map((item: { taskKey: string }) => item.taskKey)).toEqual([a]);
  });

  it("marking a pinned task done through the command engine removes its row", async () => {
    const key = await add("Do the thing", { scheduledOn: DATE });
    await put({ date: DATE, taskKeys: [key] });
    const target = { type: "view", view: "tasks", taskKey: key, date: DATE };
    const done = await invoke(testApp, {
      method: "POST",
      url: "/api/manager-actions/commands",
      headers: { cookie },
      body: { date: DATE, tz: "UTC", command: { kind: "mark_done", label: "Done", target, undoable: true } },
    });
    expect(done.status).toBe(200);

    const today = await getToday();
    expect(today.actionItems.some((item: { type: string }) => item.type === "top_three")).toBe(false);
    expect(today.focus.plan.doneToday.count).toBe(1);
  });

  it("judges 'done today' on the manager's calendar day, whatever zone the server runs in", async () => {
    const early = await add("Just after midnight", { scheduledOn: DATE });
    const late = await add("Just before midnight", { scheduledOn: DATE });
    for (const key of [early, late]) await taskService.update(key, { status: "done" }, manager);
    // Tokyo is UTC+9 all year: 2026-03-08 runs from 15:00Z on the 7th to 15:00Z on the 8th.
    await db.update(tasks).set({ closedAt: "2026-03-07T15:30:00.000Z" }).where(eqTaskKey(early));
    await db.update(tasks).set({ closedAt: "2026-03-07T14:30:00.000Z" }).where(eqTaskKey(late));

    const tokyo = (await getToday(testApp, "Asia/Tokyo")).focus.plan.doneToday;
    expect(tokyo.items.map((item: { taskKey: string }) => item.taskKey)).toEqual([early]);
    // The same instants fall on the 7th and the 8th for a UTC manager.
    const utc = (await getToday(testApp, "UTC")).focus.plan.doneToday;
    expect(utc.items.map((item: { taskKey: string }) => item.taskKey)).toEqual([]);
  });

  it("flags overdue on the manager's day when the deadline falls on the other side of midnight", async () => {
    // 2026-03-07T16:00Z is 01:00 on the 8th in Tokyo but still 06:00 on the 7th in Honolulu.
    const key = await add("Deadline", { scheduledOn: null, dueAt: "2026-03-07T16:00:00.000Z" });
    await taskService.update(key, { status: "active" }, manager);
    const tokyo = (await getToday(testApp, "Asia/Tokyo")).focus.plan.items.find((item: { taskKey: string }) => item.taskKey === key);
    expect(tokyo).toMatchObject({ overdue: false });
    const honolulu = (await getToday(testApp, "Pacific/Honolulu")).focus.plan.items.find((item: { taskKey: string }) => item.taskKey === key);
    expect(honolulu).toMatchObject({ overdue: true });
  });

  it("admits an open, inactive deadline-only task on the manager's day, not the server's (docs/63 #4)", async () => {
    // 2026-03-08T16:00Z is 01:00 on the 9th in Tokyo (after today) but 06:00 on the 8th in Honolulu.
    const key = await add("Deadline only", { scheduledOn: null, dueAt: "2026-03-08T16:00:00.000Z" });
    const keys = async (tz: string) => (await getToday(testApp, tz)).focus.plan.items.map((item: { taskKey: string }) => item.taskKey);
    expect(await keys("Asia/Tokyo")).toEqual([]);
    expect(await keys("Pacific/Honolulu")).toEqual([key]);
  });

  it("drops a pin once the task is delegated, parked or waiting, and brings it back when it is mine again", async () => {
    await db.insert(developers).values({ accountId: "dev-1", displayName: "Dev One", isActive: 1 });
    const delegated = await add("Hand off", { scheduledOn: DATE });
    const parked = await add("Park it", { scheduledOn: DATE });
    const waiting = await add("Wait on legal", { scheduledOn: DATE });
    const kept = await add("Keep", { scheduledOn: DATE });
    await put({ date: DATE, taskKeys: [delegated, parked, waiting] });
    expect((await put({ date: TOMORROW, taskKeys: [delegated, waiting, kept] })).status).toBe(200);

    await taskService.update(delegated, { ownerType: "developer", ownerId: "dev-1" } as never, manager);
    await taskService.update(parked, { later: true }, manager);
    await taskService.update(waiting, { waitingOn: { type: "text", label: "Legal" } } as never, manager);

    const plan = (await getToday()).focus.plan;
    expect(plan.top3).toEqual([]);
    expect(plan.items.map((item: { taskKey: string }) => item.taskKey)).toEqual([kept]);
    expect(plan.tomorrowTop3.items.map((item: { taskKey: string }) => item.taskKey)).toEqual([kept]);

    // The pin row is untouched, so handing the task back restores it.
    await taskService.update(parked, { later: false, scheduledOn: DATE }, manager);
    expect((await getToday()).focus.plan.top3).toEqual([parked]);
  });

  it("keeps four ordinary unpinned tasks on the plan across the wrap-up boundary (docs/63 #2)", async () => {
    const keys = [await add("Alpha", { scheduledOn: DATE }), await add("Bravo", { scheduledOn: DATE }), await add("Charlie", { scheduledOn: DATE }), await add("Delta", { scheduledOn: DATE })];

    vi.setSystemTime(new Date("2026-03-08T15:59:00.000Z"));
    const before = await getToday();
    vi.setSystemTime(new Date("2026-03-08T16:00:00.000Z"));
    const after = await getToday();

    expect(before.rhythm.stage).toBe("midday_check");
    expect(after.rhythm.stage).toBe("wrap_up");
    for (const today of [before, after]) {
      expect(today.focus.plan.items.map((item: { taskKey: string }) => item.taskKey).sort()).toEqual([...keys].sort());
      expect(today.focus.plan.items.every((item: { pinned: boolean }) => !item.pinned)).toBe(true);
    }
    // Ordinary tasks scheduled today are not carry rows, so the plan is the only place wrap-up can list them.
    expect(after.focus.wrapUp.carryCandidates).toEqual([]);
  });

  it("has no plan without the canonical task model", async () => {
    await db.delete(configTable);
    expect((await getToday()).focus.plan).toBeUndefined();
  });
});

import { eq } from "drizzle-orm";
function eqTaskKey(key: string) {
  return eq(tasks.taskKey, key);
}
