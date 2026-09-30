import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db, resetDatabase } from "./helpers/db";
import { enableCollabParticipation } from "./helpers/team-mode";
import {
  configTable,
  developers,
  oneOnOneAgendaItems,
  oneOnOneSeries,
  oneOnOneSessions,
  taskEvents,
  tasks,
  teamTrackerCheckIns,
  teamTrackerDays,
} from "../src/db/schema";
import { OneOnOneService } from "../src/services/one-on-one.service";
import { TaskService, type TaskPrincipal } from "../src/services/task.service";
import { WeeklyReviewService, mondayOf, nextWorkdayAfter } from "../src/services/weekly-review.service";

/** docs/59 §4 (WR-01): the weekly review read model. */
const FRIDAY = "2026-10-02T12:00:00.000Z";
const MONDAY = "2026-10-05T10:00:00.000Z";
const taskService = new TaskService();
const oneOnOne = new OneOnOneService();
const review = new WeeklyReviewService();

let manager: TaskPrincipal;
const other: TaskPrincipal = { type: "manager", accountId: "manager-b", workspaceId: "default" };

function at(iso: string) {
  vi.setSystemTime(new Date(iso));
}

async function add(title: string, extra: Record<string, unknown> = {}, principal: TaskPrincipal = manager) {
  return taskService.create({ title, ownerType: "manager", ownerId: principal.accountId, scheduledOn: null, ...extra } as never, principal);
}

async function close(taskKey: string, closedAt: string, status = "done") {
  await db.update(tasks).set({ status, closedAt }).where(eq(tasks.taskKey, taskKey));
}

async function build(now: string, query: { week?: string; tz?: string } = {}) {
  at(now);
  return review.build(manager, { tz: "UTC", ...query });
}

function section(response: Awaited<ReturnType<typeof build>>, id: string) {
  return response.sections.find((entry) => entry.id === id);
}

function titles(response: Awaited<ReturnType<typeof build>>, id: string): string[] {
  const found = section(response, id);
  return (found?.rows ?? []).map((row) => ("title" in row ? row.title : "developerName" in row ? row.developerName : ""));
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  at(FRIDAY);
  await resetDatabase();
  await db.insert(configTable).values([
    { key: "tasks_phase1_enabled", value: "true" },
    { key: "tasks_phase2_stage", value: "2c" },
    { key: "tasks_phase3_enabled", value: "true" },
  ]);
  await db.insert(developers).values([
    { accountId: "dev-1", displayName: "Priya", isActive: 1 },
    { accountId: "dev-2", displayName: "Sam", isActive: 1 },
  ]);
  manager = { type: "manager", accountId: "manager-a", workspaceId: "default" };
});

afterEach(() => {
  vi.useRealTimers();
});

describe("week helpers", () => {
  it("snaps to Monday and finds the next workday", () => {
    expect(mondayOf("2026-10-02")).toBe("2026-09-28");
    expect(mondayOf("2026-10-04")).toBe("2026-09-28");
    expect(mondayOf("2026-10-05")).toBe("2026-10-05");
    expect(nextWorkdayAfter("2026-10-02")).toBe("2026-10-05");
    expect(nextWorkdayAfter("2026-10-04")).toBe("2026-10-05");
    expect(nextWorkdayAfter("2026-10-05")).toBe("2026-10-06");
  });
});

describe("week range and default (§4)", () => {
  it("returns Monday to Sunday and the next workday for a Friday", async () => {
    const response = await build(FRIDAY);
    expect(response.range).toEqual({ start: "2026-09-28", end: "2026-10-04", nextStart: "2026-10-05", nextEnd: "2026-10-11" });
    expect(response.today).toBe("2026-10-02");
    expect(response.nextWorkday).toBe("2026-10-05");
    expect(response.defaultedToLastWeek).toBe(false);
    expect(response.sections.map((entry) => entry.id)).toEqual(["closed", "quiet", "slipped", "inbox", "undated", "laterNextWeek", "plannedNextWeek", "oneOnOnes", "people"]);
  });

  it("puts a Sunday evening in Auckland into the new week, and a Monday morning in Honolulu into the old one", async () => {
    // 22:00Z on Sunday 4 Oct is Monday 11:00 NZDT.
    const auckland = await build("2026-10-04T22:00:00.000Z", { tz: "Pacific/Auckland", week: undefined });
    expect(auckland.today).toBe("2026-10-05");
    // Monday in Auckland: last week is unreviewed, so it opens on last week.
    expect(auckland.range.start).toBe("2026-09-28");
    expect(auckland.defaultedToLastWeek).toBe(true);
    // 05:00Z Monday is Sunday 19:00 in Honolulu (UTC-10): still the old week, no catch-up.
    const honolulu = await build("2026-10-05T05:00:00.000Z", { tz: "Pacific/Honolulu" });
    expect(honolulu.today).toBe("2026-10-04");
    expect(honolulu.range.start).toBe("2026-09-28");
    expect(honolulu.defaultedToLastWeek).toBe(false);
    // An explicit week is never second-guessed.
    const explicit = await build("2026-10-04T22:00:00.000Z", { tz: "Pacific/Auckland", week: "2026-10-05" });
    expect(explicit.range.start).toBe("2026-10-05");
    expect(explicit.defaultedToLastWeek).toBe(false);
  });

  it("defaults to last week on Monday and Tuesday while it is not completed, and to this week later", async () => {
    const monday = await build(MONDAY);
    expect(monday.range.start).toBe("2026-09-28");
    expect(monday.defaultedToLastWeek).toBe(true);
    const tuesday = await build("2026-10-06T09:00:00.000Z");
    expect(tuesday.range.start).toBe("2026-09-28");
    const wednesday = await build("2026-10-07T09:00:00.000Z");
    expect(wednesday.range.start).toBe("2026-10-05");
    expect(wednesday.defaultedToLastWeek).toBe(false);
    // Snaps any day in the week to its Monday.
    expect((await build(FRIDAY, { week: "2026-10-01" })).range.start).toBe("2026-09-28");
  });

  it("falls back to the workspace zone for an unknown tz", async () => {
    at(FRIDAY);
    const response = await review.build(manager, { tz: "Not/AZone" });
    expect(typeof response.timeZone).toBe("string");
    expect(response.timeZone).not.toBe("Not/AZone");
  });
});

describe("Monday default uses the saved week (WR-02)", () => {
  const LAST = "2026-09-28";

  it("stays on this week once last week was completed or dismissed, and returns to last week on reopen", async () => {
    expect((await build(MONDAY)).defaultedToLastWeek).toBe(true);
    await review.save(manager, LAST, { completed: true });
    const done = await build(MONDAY);
    expect(done.defaultedToLastWeek).toBe(false);
    expect(done.range.start).toBe("2026-10-05");
    await review.save(manager, LAST, { completed: false });
    expect((await build(MONDAY)).defaultedToLastWeek).toBe(true);
    await review.save(manager, LAST, { dismissed: true });
    expect((await build(MONDAY)).defaultedToLastWeek).toBe(false);
  });

  it("only counts the caller's own record", async () => {
    await review.save(other, LAST, { completed: true });
    expect((await build(MONDAY)).defaultedToLastWeek).toBe(true);
  });

  it("returns the saved state with the week", async () => {
    await review.save(manager, LAST, { step: "people", decisions: { "T-1": "drop" } });
    const response = await build(FRIDAY, { week: LAST });
    expect(response.saved).toMatchObject({ weekStart: LAST, step: "people", decisions: { "T-1": "drop" } });
    expect((await build(FRIDAY, { week: "2026-10-05" })).saved).toBeNull();
  });

  it("rejects a weekStart that is not a Monday", async () => {
    await expect(review.save(manager, "2026-09-29", {})).rejects.toMatchObject({ status: 400 });
  });
});

describe("closed this week", () => {
  it("cuts closed rows to the manager's calendar days, in each zone", async () => {
    const mon = await add("Closed Monday");
    const sun = await add("Closed late Sunday UTC");
    const before = await add("Closed the Sunday before");
    const dropped = await add("Dropped Wednesday");
    await close(mon.taskKey, "2026-09-28T09:00:00.000Z");
    await close(sun.taskKey, "2026-10-04T23:30:00.000Z");
    await close(before.taskKey, "2026-09-27T23:30:00.000Z");
    await close(dropped.taskKey, "2026-09-30T10:00:00.000Z", "dropped");

    const utc = await build(FRIDAY, { week: "2026-09-28" });
    // Newest first; the Sunday-before row is last week in UTC.
    expect(titles(utc, "closed")).toEqual(["Closed late Sunday UTC", "Dropped Wednesday", "Closed Monday"]);
    const row = section(utc, "closed")!.rows[0] as { closedDay?: string };
    expect(row.closedDay).toBe("2026-10-04");

    // Auckland is 13 hours ahead: the late-Sunday row is Monday there (next week), and the row from
    // 23:30Z the Sunday before is Monday 28 Sep in Auckland (this week).
    const auckland = await build(FRIDAY, { week: "2026-09-28", tz: "Pacific/Auckland" });
    expect(titles(auckland, "closed")).toEqual(["Dropped Wednesday", "Closed Monday", "Closed the Sunday before"]);
  });

  it("includes tasks delegated to a developer that I track", async () => {
    const delegated = await add("Priya ships the runbook", { ownerType: "developer", ownerId: "dev-1" });
    await close(delegated.taskKey, "2026-09-30T10:00:00.000Z");
    const response = await build(FRIDAY);
    expect(titles(response, "closed")).toEqual(["Priya ships the runbook"]);
  });
});

describe("quiet: waiting and delegated (§4)", () => {
  it("lists a waiting task whose check-by passed, with the day, and leaves a fresh one alone", async () => {
    await add("Vendor DPA signed", { waitingOn: { type: "text", label: "Legal" }, followUpAt: "2026-09-30T09:00:00.000Z" });
    await add("Due later", { waitingOn: { type: "text", label: "Finance" }, followUpAt: "2026-10-09T09:00:00.000Z" });
    const response = await build(FRIDAY);
    expect(titles(response, "quiet")).toEqual(["Vendor DPA signed"]);
    const row = section(response, "quiet")!.rows[0] as { quiet?: { checkByPassed: string | null; idleWorkingDays: number } };
    expect(row.quiet).toEqual({ checkByPassed: "2026-09-30", idleWorkingDays: 0 });
  });

  it("counts 5 working days, not 5 calendar days, across a weekend", async () => {
    // Last touched Wednesday 30 Sep. On Monday 5 Oct that is 5 calendar days but 3 working days.
    at("2026-09-30T09:00:00.000Z");
    await add("Quiet since Wednesday", { waitingOn: { type: "text", label: "Legal" } });
    // Last touched Friday 25 Sep: 6 working days by Monday 5 Oct.
    at("2026-09-25T09:00:00.000Z");
    await add("Quiet since last Friday", { waitingOn: { type: "text", label: "Vendor" } });
    const response = await build(MONDAY, { week: "2026-09-28" });
    expect(titles(response, "quiet")).toEqual(["Quiet since last Friday"]);
    const row = section(response, "quiet")!.rows[0] as { quiet?: { idleWorkingDays: number; checkByPassed: string | null } };
    expect(row.quiet?.idleWorkingDays).toBe(6);
    expect(row.quiet?.checkByPassed).toBeNull();
  });

  it("uses the workspace's managerTouchDays", async () => {
    at("2026-09-30T09:00:00.000Z");
    await add("Touched Wednesday", { waitingOn: { type: "text", label: "Legal" } });
    await db.insert(configTable).values({ key: "team_tracker_touch_stale_working_days", value: "3" });
    const response = await build(MONDAY, { week: "2026-09-28" });
    expect(titles(response, "quiet")).toEqual(["Touched Wednesday"]);
  });

  it("lists a delegated developer task that went idle", async () => {
    at("2026-09-21T09:00:00.000Z");
    await add("Search re-index", { ownerType: "developer", ownerId: "dev-1" });
    at("2026-10-01T09:00:00.000Z");
    await add("Fresh delegated task", { ownerType: "developer", ownerId: "dev-1" });
    const response = await build(FRIDAY);
    expect(titles(response, "quiet")).toEqual(["Search re-index"]);
  });

  it("does not treat another manager's private waiting-on as waiting for me", async () => {
    // Unowned rows are visible to every manager, but the waiting-on party is private to the tracker.
    await taskService.create({ title: "B waits on Legal", ownerType: null, ownerId: null, scheduledOn: null, waitingOn: { type: "text", label: "Legal" }, followUpAt: "2026-09-30T09:00:00.000Z" } as never, other);
    const response = await build(FRIDAY);
    expect(titles(response, "quiet")).toEqual([]);
    expect(titles(response, "inbox")).toEqual(["B waits on Legal"]);
  });

  it("shows a quiet row once, not again under slipped", async () => {
    // A blocked task with a passed plan date is in the Waiting lens and would also be "slipped".
    at("2026-09-21T09:00:00.000Z");
    await add("Blocked on approval", { status: "blocked", scheduledOn: "2026-09-25" });
    const response = await build(FRIDAY);
    expect(titles(response, "quiet")).toEqual(["Blocked on approval"]);
    expect(titles(response, "slipped")).toEqual([]);
  });
});

describe("loose ends", () => {
  it("lists my slipped, planned tasks and not future, undated or someone else's", async () => {
    await add("Slipped Tuesday", { scheduledOn: "2026-09-29" });
    await add("Planned today", { scheduledOn: "2026-10-02" });
    await add("Planned next week", { scheduledOn: "2026-10-06" });
    await add("Priya slipped", { ownerType: "developer", ownerId: "dev-1", scheduledOn: "2026-09-29" });
    const response = await build(FRIDAY);
    expect(titles(response, "slipped")).toEqual(["Slipped Tuesday"]);
  });

  it("lists the Inbox lane", async () => {
    await taskService.create({ title: "Unowned capture", ownerType: null, ownerId: null } as never, manager);
    await add("Owned and dated", { scheduledOn: "2026-10-05" });
    const response = await build(FRIDAY);
    expect(titles(response, "inbox")).toEqual(["Unowned capture"]);
  });

  it("lists undated tasks only once they are 14+ days old", async () => {
    at("2026-09-18T09:00:00.000Z");
    await add("Old and undated");
    at("2026-09-19T09:00:00.000Z");
    await add("Just old enough");
    at("2026-09-25T09:00:00.000Z");
    await add("Too new");
    const response = await build(FRIDAY);
    expect(titles(response, "undated")).toEqual(["Old and undated"]);
    // Two weeks to the day counts.
    at("2026-10-03T09:00:00.000Z");
    expect(titles(await review.build(manager, { tz: "UTC" }), "undated")).toEqual(["Old and undated", "Just old enough"]);
  });

  it("lists Later tasks that come back next week, soonest first", async () => {
    await add("Back Tuesday", { later: true, hideUntil: "2026-10-06" });
    await add("Back Monday", { later: true, hideUntil: "2026-10-05" });
    await add("Back in three weeks", { later: true, hideUntil: "2026-10-23" });
    await add("Later, no date", { later: true });
    const response = await build(FRIDAY);
    expect(titles(response, "laterNextWeek")).toEqual(["Back Monday", "Back Tuesday"]);
  });
});

describe("next week: planned tasks and Monday's pins", () => {
  it("lists my open planned tasks for next week, by plan date, and nothing else", async () => {
    await add("Planned Wednesday", { scheduledOn: "2026-10-07" });
    await add("Planned Monday", { scheduledOn: "2026-10-05" });
    await add("Due next Thursday", { scheduledOn: null, dueAt: "2026-10-08T17:00:00.000Z" });
    await add("Planned this week", { scheduledOn: "2026-10-02" });
    await add("Planned in three weeks", { scheduledOn: "2026-10-23" });
    await add("Waiting next week", { scheduledOn: "2026-10-06", waitingOn: { type: "text", label: "Legal" } });
    await add("Parked", { later: true, hideUntil: "2026-10-06" });
    await add("Priya's task", { scheduledOn: "2026-10-06", ownerType: "developer", ownerId: "dev-1" });
    const done = await add("Done already", { scheduledOn: "2026-10-06" });
    await close(done.taskKey, "2026-10-01T10:00:00.000Z");
    const response = await build(FRIDAY);
    expect(titles(response, "plannedNextWeek")).toEqual(["Planned Monday", "Planned Wednesday", "Due next Thursday"]);
  });

  it("starts at the next workday, so a mid-week review still offers what is left of this week", async () => {
    await add("Planned Wednesday", { scheduledOn: "2026-09-30" });
    await add("Planned Thursday", { scheduledOn: "2026-10-01" });
    await add("Planned next Tuesday", { scheduledOn: "2026-10-06" });
    const response = await build("2026-09-30T10:00:00.000Z");
    expect(response.nextWorkday).toBe("2026-10-01");
    expect(titles(response, "plannedNextWeek")).toEqual(["Planned Thursday", "Planned next Tuesday"]);
  });

  it("never lists a 1:1 topic or session action item planned next week", async () => {
    await db.insert(configTable).values({ key: "one_on_one_enabled", value: "true" });
    const detail = await oneOnOne.createSeries({ developerAccountId: "dev-1", cadence: "weekly" }, "default");
    const action = (await oneOnOne.createSessionAction(detail.series.id, detail.upcoming!.id, { title: "Draft the promo case", scheduledOn: "2026-10-06" }, manager)).item.task;
    const attached = await add("Existing task on the agenda", { scheduledOn: "2026-10-06" });
    await oneOnOne.attachAgenda(detail.series.id, { taskId: attached.id }, manager);
    await add("Ordinary planned task", { scheduledOn: "2026-10-06" });
    const response = await build(FRIDAY);
    expect(titles(response, "plannedNextWeek")).toEqual(["Ordinary planned task"]);
    expect(action.taskId).toBeGreaterThan(0);
  });

  it("returns what is pinned for the next workday, in pin order, dropping tasks that closed or were reassigned", async () => {
    const first = await add("Q4 roadmap draft");
    const gone = await add("Finished before Monday");
    const reassigned = await add("Handed to Priya");
    const second = await add("Calibration prep");
    await taskService.setTop3(manager, "2026-10-05", [first.taskKey, gone.taskKey, reassigned.taskKey]);
    await taskService.setTop3(manager, "2026-10-06", [second.taskKey]);
    await close(gone.taskKey, "2026-10-01T10:00:00.000Z");
    await db.update(tasks).set({ ownerType: "developer", ownerId: "dev-1" }).where(eq(tasks.taskKey, reassigned.taskKey));
    const response = await build(FRIDAY);
    expect(response.nextWorkdayTop3).toEqual([{ taskKey: first.taskKey, title: "Q4 roadmap draft" }]);
    // Pins for another day are not returned.
    expect((await build("2026-10-05T10:00:00.000Z", { week: "2026-10-05" })).nextWorkdayTop3).toEqual([{ taskKey: second.taskKey, title: "Calibration prep" }]);
  });

  it("keeps a pinned 1:1 task in the list but flags it, so it is never reported", async () => {
    await db.insert(configTable).values({ key: "one_on_one_enabled", value: "true" });
    const detail = await oneOnOne.createSeries({ developerAccountId: "dev-1", cadence: "weekly" }, "default");
    const topic = (await oneOnOne.attachAgenda(detail.series.id, { title: "Career growth chat" }, manager)).task;
    const plain = await add("Calibration prep");
    await taskService.setTop3(manager, "2026-10-05", [topic.taskKey, plain.taskKey]);
    const response = await build(FRIDAY);
    expect(response.nextWorkdayTop3).toEqual([
      { taskKey: topic.taskKey, title: "Career growth chat", oneOnOne: true },
      { taskKey: plain.taskKey, title: "Calibration prep" },
    ]);
  });
});

describe("people, 1:1s and check-ins", () => {
  async function seedDay(developerAccountId: string, date: string, status: string, managerNotes: string | null = null) {
    const now = new Date().toISOString();
    return (await db.insert(teamTrackerDays).values({ workspaceId: "default", date, developerAccountId, status, managerNotes, statusUpdatedAt: now, createdAt: now, updatedAt: now }).returning())[0]!;
  }

  it("lists people whose latest day this week is blocked or at risk, with the note", async () => {
    await seedDay("dev-1", "2026-09-29", "blocked");
    await seedDay("dev-1", "2026-10-01", "on_track");
    await seedDay("dev-2", "2026-10-01", "at_risk", "capacity");
    const response = await build(FRIDAY);
    expect(response.rosterSize).toBe(2);
    const people = section(response, "people")!.rows as { developerName: string; status: string; note: string | null }[];
    expect(people.map((row) => [row.developerName, row.status, row.note])).toEqual([["Sam", "at_risk", "capacity"]]);
  });

  it("reports the 1:1s due next week and missed this week, and nothing while the workspace has it off", async () => {
    const now = new Date().toISOString();
    const series = await db.insert(oneOnOneSeries).values([
      { workspaceId: "default", developerAccountId: "dev-1", cadence: "weekly", active: 1, createdAt: now },
      { workspaceId: "default", developerAccountId: "dev-2", cadence: "weekly", active: 1, createdAt: now },
    ]).returning();
    await db.insert(oneOnOneSessions).values([
      { workspaceId: "default", seriesId: series[0]!.id, scheduledFor: "2026-09-30", status: "scheduled", createdAt: now },
      { workspaceId: "default", seriesId: series[1]!.id, scheduledFor: "2026-10-01", status: "skipped", createdAt: now },
      { workspaceId: "default", seriesId: series[0]!.id, scheduledFor: "2026-10-07", status: "scheduled", createdAt: now },
      { workspaceId: "default", seriesId: series[1]!.id, scheduledFor: "2026-10-08", status: "scheduled", createdAt: now },
    ]);
    const off = await build(FRIDAY);
    expect(off.oneOnOneEnabled).toBe(false);
    expect(section(off, "oneOnOnes")).toEqual({ id: "oneOnOnes", status: "ready", rows: [] });

    await db.insert(configTable).values({ key: "one_on_one_enabled", value: "true" });
    const on = await build(FRIDAY);
    const rows = section(on, "oneOnOnes")!.rows as { developerName: string; scheduledFor: string; kind: string }[];
    expect(rows.map((row) => [row.developerName, row.scheduledFor, row.kind])).toEqual([
      ["Priya", "2026-09-30", "missed"],
      ["Sam", "2026-10-01", "missed"],
      ["Priya", "2026-10-07", "due_next_week"],
      ["Sam", "2026-10-08", "due_next_week"],
    ]);
  });

  it("marks a failing 1:1 source unavailable and still returns the rest", async () => {
    await add("Slipped", { scheduledOn: "2026-09-29" });
    const broken = new WeeklyReviewService(undefined, undefined, undefined, {
      enabled: async () => true,
      reviewSessions: async () => { throw new Error("boom"); },
    } as unknown as OneOnOneService);
    at(FRIDAY);
    const response = await broken.build(manager, { tz: "UTC" });
    expect(section(response, "oneOnOnes")).toEqual({ id: "oneOnOnes", status: "unavailable", rows: [] });
    expect((section(response, "slipped")!.rows).length).toBe(1);
    expect(section(response, "people")!.status).toBe("ready");
  });

  it("adds check-ins only in collab mode, and only for participating developers", async () => {
    const solo = await build(FRIDAY);
    expect(section(solo, "checkIns")).toBeUndefined();

    await enableCollabParticipation(["dev-1"]);
    const monday = await seedDay("dev-1", "2026-09-28", "on_track");
    const tuesday = await seedDay("dev-1", "2026-09-29", "on_track");
    const sat = await seedDay("dev-1", "2026-10-03", "on_track");
    const samDay = await seedDay("dev-2", "2026-09-28", "on_track");
    const now = new Date().toISOString();
    await db.insert(teamTrackerCheckIns).values([
      { workspaceId: "default", dayId: monday.id, summary: "a", authorType: "developer", createdAt: now },
      { workspaceId: "default", dayId: monday.id, summary: "b", authorType: "developer", createdAt: now },
      { workspaceId: "default", dayId: tuesday.id, summary: "manager wrote this", authorType: "manager", createdAt: now },
      { workspaceId: "default", dayId: sat.id, summary: "weekend", authorType: "developer", createdAt: now },
      { workspaceId: "default", dayId: samDay.id, summary: "Sam does not participate", authorType: "developer", createdAt: now },
    ]);
    const collab = await build(FRIDAY);
    expect(collab.teamMode).toBe("collab");
    expect(section(collab, "checkIns")).toEqual({
      id: "checkIns",
      status: "ready",
      rows: [{ developerAccountId: "dev-1", developerName: "Priya", daysWithCheckIn: 1, workingDays: 5 }],
    });
  });
});

describe("1:1 tasks never appear (docs/59 §4, §10)", () => {
  async function seedSeries(workspaceId = "default") {
    await db.insert(configTable).values({ workspaceId, key: "one_on_one_enabled", value: "true" }).onConflictDoNothing();
    return oneOnOne.createSeries({ developerAccountId: "dev-1", cadence: "weekly" }, workspaceId);
  }

  it("keeps a done topic, a session action item and an open topic out of every section", async () => {
    const detail = await seedSeries();
    const seriesId = detail.series.id;
    const sessionId = detail.upcoming!.id;

    const doneTopic = (await oneOnOne.attachAgenda(seriesId, { title: "Discuss performance concerns" }, manager)).task;
    const openTopic = (await oneOnOne.attachAgenda(seriesId, { title: "Career growth chat" }, manager)).task;
    const action = (await oneOnOne.createSessionAction(seriesId, sessionId, { title: "Draft the promo case", scheduledOn: "2026-09-29" }, manager)).item.task;
    // A topic can also sit undated for weeks, wait on someone, or slip.
    const oldTopic = (await oneOnOne.attachAgenda(seriesId, { title: "Old undated topic" }, manager)).task;
    await db.update(tasks).set({ createdAt: "2026-09-01T00:00:00.000Z" }).where(eq(tasks.id, oldTopic.taskId));
    const attached = await add("Existing task attached to the agenda", { scheduledOn: "2026-09-29" });
    await oneOnOne.attachAgenda(seriesId, { taskId: attached.id }, manager);

    await close(doneTopic.taskKey, "2026-09-30T10:00:00.000Z");
    await db.update(tasks).set({ status: "open", scheduledOn: "2026-09-29" }).where(eq(tasks.id, openTopic.taskId));

    // Ordinary tasks of the same shapes do appear.
    const shipped = await add("Shipped normally");
    await close(shipped.taskKey, "2026-09-30T10:00:00.000Z");
    await add("Slipped normally", { scheduledOn: "2026-09-29" });

    const response = await build(FRIDAY, { week: "2026-09-28" });
    for (const id of ["closed", "quiet", "slipped", "inbox", "undated", "laterNextWeek"]) {
      const list = titles(response, id);
      for (const hidden of ["Discuss performance concerns", "Career growth chat", "Draft the promo case", "Old undated topic", "Existing task attached to the agenda"]) {
        expect(list, `${id} must not list "${hidden}"`).not.toContain(hidden);
      }
    }
    expect(titles(response, "closed")).toEqual(["Shipped normally"]);
    expect(titles(response, "slipped")).toEqual(["Slipped normally"]);
    expect(titles(response, "undated")).toEqual([]);
    expect(action.taskId).toBeGreaterThan(0);
  });

  it("scopes the exclusion to the workspace", async () => {
    // A task in another workspace that happens to share an id with an agenda row must not vanish here.
    const detail = await seedSeries();
    const topic = (await oneOnOne.attachAgenda(detail.series.id, { title: "Topic" }, manager)).task;
    await db.update(oneOnOneAgendaItems).set({ workspaceId: "other-ws" }).where(eq(oneOnOneAgendaItems.taskId, topic.taskId));
    await close(topic.taskKey, "2026-09-30T10:00:00.000Z");
    expect(titles(await build(FRIDAY, { week: "2026-09-28" }), "closed")).toEqual(["Topic"]);
  });
});

describe("rows without events", () => {
  it("fall back to the row's updatedAt for last activity", async () => {
    // A task inserted without events still has a defined last activity (updatedAt), never NaN.
    const row = await add("No events", { waitingOn: { type: "text", label: "Legal" } });
    await db.delete(taskEvents).where(eq(taskEvents.taskKey, row.taskKey));
    const response = await build(FRIDAY);
    expect(titles(response, "quiet")).toEqual([]);
  });
});
