import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db, resetDatabase } from "./helpers/db";
import { configTable, developers, tasks } from "../src/db/schema";
import { IssueService } from "../src/services/issue.service";
import { ManagerDeskService } from "../src/services/manager-desk.service";
import { TeamTrackerService } from "../src/services/team-tracker.service";
import { TodayService } from "../src/services/today.service";

/**
 * docs/56 P2-02: the first-run checklist on /api/today, and the standup card
 * needing at least one person.
 */
const trackerService = new TeamTrackerService();
const managerDeskService = new ManagerDeskService(trackerService);
const issueService = new IssueService(undefined, undefined, trackerService);

function todayService() {
  return new TodayService(issueService, trackerService, managerDeskService, {
    getLastSyncLog: async () => undefined,
    getRuntimeStatus: () => ({ status: "idle" as const }),
  }, { todayCacheTtlMs: 0 });
}

const getToday = () => todayService().getToday("manager-1", "2026-03-08", undefined, { tz: "Asia/Kolkata" });

async function enablePhase3() {
  await db.insert(configTable).values([
    { key: "tasks_phase1_enabled", value: "true" },
    { key: "tasks_phase2_stage", value: "2c" },
    { key: "tasks_phase3_enabled", value: "true" },
  ]);
}

describe("Today getting-started checklist (P2-02)", () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-08T04:00:00.000Z")); // 09:30 IST, morning_plan
    await resetDatabase();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("is all false for a brand-new workspace", async () => {
    expect((await getToday()).gettingStarted).toEqual({ people: false, tasks: false, jira: false, rhythm: false });
  });

  it("ticks people, tasks, Jira and rhythm as each appears", async () => {
    const service = todayService();
    await db.insert(developers).values({ accountId: "dev-1", displayName: "Alice Smith", email: null, avatarUrl: null, isActive: 1 });
    expect((await getToday()).gettingStarted).toMatchObject({ people: true, tasks: false, jira: false, rhythm: false });

    await db.insert(tasks).values({ taskKey: "T-1", title: "First task", ownerType: "manager", ownerId: "manager-1", createdAt: "2026-03-08T04:00:00.000Z", updatedAt: "2026-03-08T04:00:00.000Z" });
    expect((await getToday()).gettingStarted).toMatchObject({ people: true, tasks: true, jira: false, rhythm: false });

    await service.updateRhythmSettings({ boundaries: { standupStart: "09:15", middayStart: "11:00", wrapUpStart: "17:00" } });
    expect((await getToday()).gettingStarted).toMatchObject({ rhythm: true, jira: false });

    await db.insert(configTable).values([
      { key: "jira_base_url", value: "https://tenant.atlassian.net" },
      { key: "jira_email", value: "ops@example.com" },
      { key: "jira_project_key", value: "AM" },
      { key: "jira_api_token", value: "token" },
    ]);
    expect((await getToday()).gettingStarted).toEqual({ people: true, tasks: true, jira: true, rhythm: true });
  });

  it("a deleted task does not count", async () => {
    await db.insert(tasks).values({ taskKey: "T-1", title: "Gone", ownerType: "manager", ownerId: "manager-1", deletedAt: "2026-03-08T03:00:00.000Z", createdAt: "2026-03-08T02:00:00.000Z", updatedAt: "2026-03-08T02:00:00.000Z" });
    expect((await getToday()).gettingStarted?.tasks).toBe(false);
  });

  it("a half-saved Jira connection is not configured", async () => {
    await db.insert(configTable).values([
      { key: "jira_base_url", value: "https://tenant.atlassian.net" },
      { key: "jira_project_key", value: "AM" },
    ]);
    expect((await getToday()).gettingStarted?.jira).toBe(false);
  });

  describe("the standup card needs people", () => {
    beforeEach(async () => {
      await enablePhase3();
    });

    it("has no standup focus and no Start standup row with an empty roster", async () => {
      const today = await getToday();
      expect(today.actionItems.some((item) => item.type === "standup")).toBe(false);
      expect(JSON.stringify(today.focus ?? {})).not.toContain("not_started");
      expect(today.focus).not.toHaveProperty("morning.standup");
    });

    it("appears once someone is on the team", async () => {
      await db.insert(developers).values({ accountId: "dev-1", displayName: "Alice Smith", email: null, avatarUrl: null, isActive: 1 });
      const today = await getToday();
      expect(today.actionItems.some((item) => item.type === "standup")).toBe(true);
      expect(today.focus).toMatchObject({ morning: { standup: { status: "not_started" } } });
    });
  });
});
