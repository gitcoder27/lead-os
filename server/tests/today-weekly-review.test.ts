import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app";
import { invoke } from "./helpers/http";
import { AuthService, serializeSessionCookie } from "../src/services/auth.service";
import { db, resetDatabase } from "./helpers/db";
import { configTable } from "../src/db/schema";
import { IssueService } from "../src/services/issue.service";
import { ManagerDeskService } from "../src/services/manager-desk.service";
import { SettingsService } from "../src/services/settings.service";
import { TeamTrackerService } from "../src/services/team-tracker.service";
import { TodayService } from "../src/services/today.service";
import { WeeklyReviewService } from "../src/services/weekly-review.service";
import type { TaskPrincipal } from "../src/services/task.service";

/** docs/59 §5.1 (WR-06): what Today offers about the weekly review, by day. */
const trackerService = new TeamTrackerService();
const managerDeskService = new ManagerDeskService(trackerService);
const issueService = new IssueService(undefined, undefined, trackerService);
const reviews = new WeeklyReviewService();
const settings = new SettingsService();
const principal: TaskPrincipal = { type: "manager", accountId: "manager-1", workspaceId: "default" };

const WEDNESDAY = "2026-09-30";
const FRIDAY = "2026-10-02";
const SATURDAY = "2026-10-03";
const MONDAY = "2026-10-05";
const TUESDAY = "2026-10-06";
const THIS_WEEK = "2026-09-28";

function todayService() {
  return new TodayService(issueService, trackerService, managerDeskService, {
    getLastSyncLog: async () => undefined,
    getRuntimeStatus: () => ({ status: "idle" as const }),
  }, { todayCacheTtlMs: 0 });
}

async function reviewOn(date: string) {
  return (await todayService().getToday("manager-1", date, undefined, { tz: "UTC" })).weeklyReview;
}

beforeEach(async () => {
  await resetDatabase();
  await db.insert(configTable).values([
    { key: "tasks_phase1_enabled", value: "true" },
    { key: "tasks_phase2_stage", value: "2c" },
    { key: "tasks_phase3_enabled", value: "true" },
  ]);
});

describe("Today's weeklyReview (WR-06)", () => {
  it("is offered on the review day (Friday by default) and on no other ordinary day", async () => {
    expect(await reviewOn(FRIDAY)).toEqual({ due: true, weekStart: THIS_WEEK });
    for (const date of [WEDNESDAY, SATURDAY, "2026-10-04"]) expect(await reviewOn(date), date).toBeUndefined();
  });

  it("follows the configured review day", async () => {
    await settings.setWeeklyReviewSettings(undefined, { day: 3 });
    expect(await reviewOn(WEDNESDAY)).toEqual({ due: true, weekStart: THIS_WEEK });
    expect(await reviewOn(FRIDAY)).toBeUndefined();
  });

  it("shows the done state with the completion time once the week's review is finished, and nothing once dismissed", async () => {
    const saved = await reviews.save(principal, THIS_WEEK, { completed: true });
    expect(await reviewOn(FRIDAY)).toEqual({ due: false, completedAt: saved.completedAt, weekStart: THIS_WEEK });
    await reviews.save(principal, THIS_WEEK, { completed: false, dismissed: true });
    expect(await reviewOn(FRIDAY)).toBeUndefined();
  });

  it("is switched off with 'Show it in wrap-up', catch-up included", async () => {
    await settings.setWeeklyReviewSettings(undefined, { inWrapUp: false });
    expect(await reviewOn(FRIDAY)).toBeUndefined();
    expect(await reviewOn(MONDAY)).toBeUndefined();
  });

  it("offers a catch-up on Monday and Tuesday until last week is completed or dismissed", async () => {
    expect(await reviewOn(MONDAY)).toEqual({ due: true, catchUp: true, weekStart: THIS_WEEK });
    expect(await reviewOn(TUESDAY)).toEqual({ due: true, catchUp: true, weekStart: THIS_WEEK });
    // Wednesday is too late to nag.
    expect(await reviewOn("2026-10-07")).toBeUndefined();

    await reviews.save(principal, THIS_WEEK, { dismissed: true });
    expect(await reviewOn(MONDAY)).toBeUndefined();
    await reviews.save(principal, THIS_WEEK, { dismissed: false });
    expect(await reviewOn(MONDAY)).toMatchObject({ catchUp: true });
    await reviews.save(principal, THIS_WEEK, { completed: true });
    expect(await reviewOn(TUESDAY)).toBeUndefined();
  });

  it("only counts the manager's own record", async () => {
    await reviews.save({ ...principal, accountId: "manager-2" }, THIS_WEEK, { completed: true });
    expect(await reviewOn(MONDAY)).toMatchObject({ catchUp: true });
  });

  it("is absent without the Tasks workspace", async () => {
    await db.delete(configTable);
    expect(await reviewOn(FRIDAY)).toBeUndefined();
  });
});

describe("Today's cache follows the review (WR-06)", () => {
  const authService = new AuthService();

  beforeEach(() => {
    // Only the clock: faking timers wholesale stalls the server.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-02T09:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("a finished review or a moved review day shows on the next Today read, not after the cache expires", async () => {
    await authService.createUser({ username: "manager", displayName: "Manager", password: "secret123", role: "manager" });
    const cookie = serializeSessionCookie((await authService.authenticate("manager", "secret123")).sessionId);
    const syncStub = { getLastSyncLog: async () => undefined, getRuntimeStatus: () => ({ status: "idle" as const }) };
    // A real cache window: without the clear-on-write, the second read would be the cached one.
    const cached = new TodayService(issueService, trackerService, managerDeskService, syncStub, { todayCacheTtlMs: 60_000 });
    const app = createApp({
      issueService, workloadService: {} as any, alertService: {} as any, automationService: {} as any, syncEngine: syncStub as any,
      backupService: {} as any, tagService: {} as any, teamTrackerService: trackerService, authService, myDayService: {} as any,
      managerDeskService, todayService: cached, searchService: {} as any, workSavedViewsService: {} as any,
    });
    // The in-process helper never emits `finish`, which is what clears the cache, so use a real socket.
    const server = app.listen(0);
    try {
      const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
      const call = async (method: string, path: string, body?: unknown) => {
        const response = await fetch(base + path, { method, headers: { cookie, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
        return { status: response.status, body: await response.json() as any, cache: response.headers.get("x-today-cache") };
      };
      const read = () => call("GET", `/api/today?date=${FRIDAY}&tz=UTC`);

      const first = await read();
      expect(first.body.weeklyReview).toEqual({ due: true, weekStart: THIS_WEEK });
      expect((await read()).cache).toBe("hit");
      const done = await call("PUT", `/api/review/week/${THIS_WEEK}`, { completed: true });
      expect(done.status).toBe(200);
      const afterReview = await read();
      expect(afterReview.cache).toBe("miss");
      expect(afterReview.body.weeklyReview).toEqual({ due: false, completedAt: done.body.saved.completedAt, weekStart: THIS_WEEK });

      // A settings write clears it too: the review day moves, so Friday no longer offers it.
      expect((await call("PUT", "/api/today/settings", { weeklyReviewDay: 3 })).status).toBe(200);
      expect((await read()).body.weeklyReview).toBeUndefined();
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
