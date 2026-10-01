import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db, resetDatabase } from "./helpers/db";
import { enableCollabParticipation } from "./helpers/team-mode";
import { configTable, developers, issues, standupSessions, todayCheckInAsks, todayVisits } from "../src/db/schema";
import { IssueService } from "../src/services/issue.service";
import { ManagerDeskService } from "../src/services/manager-desk.service";
import { TeamTrackerService } from "../src/services/team-tracker.service";
import { TodayService } from "../src/services/today.service";
import {
  getRhythmState,
  resolveTimeZone,
  serverTimeZone,
  toZonedIsoDay,
  zonedTimeToUtc,
} from "../src/services/today-clock";
import type { ManagerActionCommandRequest } from "shared/types";

const trackerService = new TeamTrackerService();
const managerDeskService = new ManagerDeskService(trackerService);
const issueService = new IssueService(undefined, undefined, trackerService);
const manager = { type: "manager" as const, accountId: "manager-1" };

function todayService() {
  return new TodayService(issueService, trackerService, managerDeskService, {
    getLastSyncLog: async () => undefined,
    getRuntimeStatus: () => ({ status: "idle" as const }),
  }, { todayCacheTtlMs: 0 });
}

async function seedDeveloper(accountId = "dev-1", displayName = "Alice Smith") {
  await db.insert(developers).values({ accountId, displayName, email: `${accountId}@example.com`, avatarUrl: null, isActive: 1 });
}

async function seedIssue(jiraKey: string, overrides: Partial<typeof issues.$inferInsert> = {}) {
  await db.insert(issues).values({
    jiraKey,
    summary: `Issue ${jiraKey}`,
    priorityName: "Medium",
    priorityId: "3",
    statusName: "In Progress",
    statusCategory: "indeterminate",
    assigneeId: "dev-1",
    assigneeName: "Alice Smith",
    teamScopeState: "in_team",
    syncScopeState: "active",
    reporterName: null,
    component: null,
    labels: JSON.stringify([]),
    dueDate: null,
    developmentDueDate: null,
    flagged: 0,
    createdAt: "2026-03-01T08:00:00.000Z",
    updatedAt: "2026-03-01T08:00:00.000Z",
    syncedAt: "2026-03-01T08:00:00.000Z",
    lastSeenInScopedSyncAt: "2026-03-01T08:00:00.000Z",
    lastReconciledAt: "2026-03-01T08:00:00.000Z",
    scopeChangedAt: null,
    analysisNotes: null,
    excluded: 0,
    aspenSeverity: null,
    ...overrides,
  });
}

async function enablePhase3() {
  await db.insert(configTable).values([
    { key: "tasks_phase1_enabled", value: "true" },
    { key: "tasks_phase2_stage", value: "2c" },
    { key: "tasks_phase3_enabled", value: "true" },
  ]);
}

function command(request: Omit<ManagerActionCommandRequest, "date"> & { date?: string }): ManagerActionCommandRequest {
  return { date: "2026-03-08", ...request };
}

describe("today-clock (docs/53 F5/F6)", () => {
  it("computes the stage in the manager's zone at boundary edges", () => {
    // 04:29Z = 09:59 IST; 04:30Z = 10:00 IST.
    expect(getRhythmState(new Date("2026-03-08T04:29:00Z"), "Asia/Kolkata").stage).toBe("morning_plan");
    expect(getRhythmState(new Date("2026-03-08T04:30:00Z"), "Asia/Kolkata").stage).toBe("standup_window");
    expect(getRhythmState(new Date("2026-03-08T06:30:00Z"), "Asia/Kolkata").stage).toBe("midday_check");
    expect(getRhythmState(new Date("2026-03-08T10:30:00Z"), "Asia/Kolkata").stage).toBe("wrap_up");
    // Same instant, different manager: 04:30Z is 20:30 the previous day in LA.
    expect(getRhythmState(new Date("2026-03-08T04:30:00Z"), "America/Los_Angeles").stage).toBe("wrap_up");
    expect(getRhythmState(new Date("2026-03-08T04:30:00Z"), "UTC").stage).toBe("morning_plan");
  });

  it("honours configured boundaries and reports the next stage", () => {
    const boundaries = { standupStart: "09:15", middayStart: "11:00", wrapUpStart: "17:30" };
    const state = getRhythmState(new Date("2026-03-08T03:44:00Z"), "Asia/Kolkata", boundaries); // 09:14 IST
    expect(state).toMatchObject({
      stage: "morning_plan",
      timeZone: "Asia/Kolkata",
      localTime: "09:14",
      boundaries,
      nextStage: { stage: "standup_window", startsAt: "2026-03-08T03:45:00.000Z" },
    });
    expect(getRhythmState(new Date("2026-03-08T03:45:00Z"), "Asia/Kolkata", boundaries).stage).toBe("standup_window");
    expect(getRhythmState(new Date("2026-03-08T12:00:00Z"), "Asia/Kolkata", boundaries).nextStage).toBeUndefined();
  });

  it("maps timestamps to the zoned day and keeps date-only values as-is", () => {
    expect(toZonedIsoDay("2026-03-08T20:00:00.000Z", "Asia/Kolkata")).toBe("2026-03-09");
    expect(toZonedIsoDay("2026-03-08T02:00:00.000Z", "America/Los_Angeles")).toBe("2026-03-07");
    expect(toZonedIsoDay("2026-03-08", "America/Los_Angeles")).toBe("2026-03-08");
  });

  it("resolves wall-clock times across a DST change", () => {
    // US spring-forward is 2026-03-08: 09:00 EDT = 13:00Z, the day before is EST.
    expect(zonedTimeToUtc("2026-03-08", 9, 0, "America/New_York").toISOString()).toBe("2026-03-08T13:00:00.000Z");
    expect(zonedTimeToUtc("2026-03-07", 9, 0, "America/New_York").toISOString()).toBe("2026-03-07T14:00:00.000Z");
  });

  it("falls back to the server zone for unknown zones", () => {
    expect(resolveTimeZone("Not/AZone")).toBe(serverTimeZone());
    expect(resolveTimeZone("Asia/Kolkata")).toBe("Asia/Kolkata");
  });
});

describe("TodayService stage-driven contracts (docs/53 §8.5-7)", () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-08T04:00:00.000Z")); // 09:30 IST
    await resetDatabase();
    await seedDeveloper();
    // Collab team with check-ins; see today.participation.test.ts for solo.
    await enableCollabParticipation(["dev-1"]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("computes due/overdue and the stage in the requested zone", async () => {
    await managerDeskService.createItem("manager-1", {
      date: "2026-03-07",
      title: "Late-evening promise",
      kind: "action",
      category: "follow_up",
      status: "planned",
      // 2026-03-07T20:00Z is 01:30 on the 8th in IST, still the 7th in UTC.
      followUpAt: "2026-03-07T20:00:00.000Z",
    });
    const service = todayService();

    const ist = await service.getToday("manager-1", "2026-03-08", undefined, { tz: "Asia/Kolkata" });
    expect(ist.rhythm).toMatchObject({ stage: "morning_plan", timeZone: "Asia/Kolkata", localTime: "09:30" });
    expect(ist.promises[0]).toMatchObject({ detail: "Due today", severity: "warning" });

    const utc = await service.getToday("manager-1", "2026-03-08", undefined, { tz: "UTC" });
    expect(utc.rhythm).toMatchObject({ stage: "morning_plan", timeZone: "UTC", localTime: "04:00" });
    expect(utc.promises[0]).toMatchObject({ detail: "Overdue 2026-03-07", severity: "critical" });
  });

  it("reads configurable stage boundaries and rejects out-of-order ones", async () => {
    const service = todayService();
    await expect(service.getRhythmSettings()).resolves.toEqual({
      boundaries: { standupStart: "10:00", middayStart: "12:00", wrapUpStart: "16:00" },
      weeklyReviewDay: 5,
      weeklyReviewInWrapUp: true,
    });
    await service.updateRhythmSettings({ boundaries: { standupStart: "09:15", middayStart: "11:00", wrapUpStart: "17:00" } });
    const today = await service.getToday("manager-1", "2026-03-08", undefined, { tz: "Asia/Kolkata" });
    expect(today.rhythm.stage).toBe("standup_window");
    await expect(service.updateRhythmSettings({ boundaries: { standupStart: "12:00", middayStart: "11:00", wrapUpStart: "17:00" } }))
      .rejects.toMatchObject({ status: 400 });
  });

  it("snooze and capture defaults land at 09:00 on the manager's wall clock", async () => {
    const item = await managerDeskService.createItem("manager-1", {
      date: "2026-03-08",
      title: "Ping QA",
      kind: "action",
      category: "follow_up",
      status: "planned",
      followUpAt: "2026-03-08T03:00:00.000Z",
    });
    const response = await todayService().executeCommand("manager-1", command({
      tz: "Asia/Kolkata",
      preset: "tomorrow",
      command: { kind: "snooze", label: "Snooze", target: { type: "follow_up", view: "follow-ups", managerDeskItemId: item.id } },
    }), manager);
    expect((response.result as { followUpAt?: string }).followUpAt).toBe("2026-03-09T03:30:00.000Z");
  });

  describe("standup focus (F7)", () => {
    beforeEach(async () => {
      await enablePhase3();
    });

    it("emits a Start standup row and a not_started focus before/during the window", async () => {
      const today = await todayService().getToday("manager-1", "2026-03-08", undefined, { tz: "Asia/Kolkata" });
      const row = today.actionItems.find((item) => item.type === "standup");
      expect(row).toMatchObject({
        id: "today-standup-start",
        title: "Start standup",
        group: "now",
        target: { type: "view", view: "team", mode: "standup" },
        primaryAction: { kind: "open", label: "Start standup" },
      });
      expect(today.focus).toMatchObject({
        stage: "morning_plan",
        morning: { standup: { status: "not_started", flaggedCount: 0, target: { view: "team", mode: "standup" } } },
      });
    });

    it("switches to a completed status with flagged people once a round is sealed", async () => {
      await seedDeveloper("dev-2", "Deepak Rao");
      await db.insert(standupSessions).values({
        managerAccountId: "manager-1",
        date: "2026-03-08",
        startedAt: "2026-03-08T04:05:00.000Z",
        endedAt: "2026-03-08T04:10:00.000Z",
        reviewedJson: JSON.stringify(["dev-1", "dev-2"]),
        flaggedJson: JSON.stringify(["dev-2"]),
        createdAt: "2026-03-08T04:10:00.000Z",
      });
      vi.setSystemTime(new Date("2026-03-08T04:45:00.000Z")); // 10:15 IST, standup window

      const today = await todayService().getToday("manager-1", "2026-03-08", undefined, { tz: "Asia/Kolkata" });
      expect(today.actionItems.some((item) => item.type === "standup")).toBe(false);
      expect(today.focus).toMatchObject({
        stage: "standup_window",
        morning: {
          standup: {
            status: "completed",
            startedAt: "2026-03-08T04:05:00.000Z",
            endedAt: "2026-03-08T04:10:00.000Z",
            reviewedCount: 2,
            flaggedCount: 1,
            flagged: [{ accountId: "dev-2", displayName: "Deepak Rao" }],
            target: { type: "developer", developerAccountId: "dev-2" },
          },
        },
      });
    });

    it("drops the standup row after the window closes", async () => {
      vi.setSystemTime(new Date("2026-03-08T07:00:00.000Z")); // 12:30 IST
      const today = await todayService().getToday("manager-1", "2026-03-08", undefined, { tz: "Asia/Kolkata" });
      expect(today.actionItems.some((item) => item.type === "standup")).toBe(false);
      expect(today.focus).toMatchObject({ stage: "midday_check", midday: { standup: { status: "not_started" } } });
    });
  });

  it("omits standup focus while Phase 3 is off", async () => {
    const today = await todayService().getToday("manager-1", "2026-03-08", undefined, { tz: "Asia/Kolkata" });
    expect(today.actionItems.some((item) => item.type === "standup")).toBe(false);
    expect(today.focus).toEqual(expect.objectContaining({ stage: "morning_plan" }));
    expect(today.focus && "morning" in today.focus ? today.focus.morning.standup : "x").toBeUndefined();
  });

  it("builds the midday focus: follow-ups due in two hours and people silent today", async () => {
    vi.setSystemTime(new Date("2026-03-08T07:30:00.000Z")); // 13:00 IST
    await seedDeveloper("dev-2", "Deepak Rao");
    await trackerService.addCheckIn("dev-2", "2026-03-08", { summary: "on it" }, { type: "developer", accountId: "dev-2" });
    const soon = await managerDeskService.createItem("manager-1", {
      date: "2026-03-08", title: "Soon", kind: "action", category: "follow_up", status: "planned",
      followUpAt: "2026-03-08T08:30:00.000Z",
    });
    await managerDeskService.createItem("manager-1", {
      date: "2026-03-08", title: "Later", kind: "action", category: "follow_up", status: "planned",
      followUpAt: "2026-03-08T11:00:00.000Z",
    });

    const today = await todayService().getToday("manager-1", "2026-03-08", undefined, { tz: "Asia/Kolkata" });
    expect(today.focus?.stage).toBe("midday_check");
    const midday = today.focus && "midday" in today.focus ? today.focus.midday : undefined;
    expect(midday?.dueSoon.map((item) => item.target.managerDeskItemId)).toEqual([soon.id]);
    expect(midday?.silentSinceStandup.map((person) => person.accountId)).toEqual(["dev-1"]);
    expect(midday?.silentSinceStandup[0]?.primaryAction).toMatchObject({ kind: "ask_check_in", undoable: true });
  });

  it("builds the wrap-up focus: missing check-ins, open promises, carry-to-tomorrow, EOD note", async () => {
    vi.setSystemTime(new Date("2026-03-08T11:30:00.000Z")); // 17:00 IST
    const promise = await managerDeskService.createItem("manager-1", {
      date: "2026-03-08", title: "Promise", kind: "action", category: "follow_up", status: "planned",
      followUpAt: "2026-03-08T05:00:00.000Z",
    });
    const stale = await managerDeskService.createItem("manager-1", {
      date: "2026-03-06", title: "Old plan", kind: "action", category: "planning", status: "planned",
    });

    const today = await todayService().getToday("manager-1", "2026-03-08", undefined, { tz: "Asia/Kolkata" });
    const wrapUp = today.focus && "wrapUp" in today.focus ? today.focus.wrapUp : undefined;
    expect(today.focus?.stage).toBe("wrap_up");
    expect(wrapUp?.missingCheckIns).toEqual([
      expect.objectContaining({ accountId: "dev-1", primaryAction: expect.objectContaining({ kind: "ask_check_in" }) }),
    ]);
    expect(wrapUp?.openPromises.map((item) => item.target.managerDeskItemId)).toEqual([promise.id]);
    expect(wrapUp?.carryCandidates).toEqual([
      expect.objectContaining({
        target: expect.objectContaining({ managerDeskItemId: stale.id }),
        primaryAction: expect.objectContaining({ kind: "carry_forward", label: "Carry to tomorrow", toDate: "2026-03-09" }),
      }),
    ]);
    expect(wrapUp?.eodNoteTarget).toEqual({ type: "view", view: "notes", date: "2026-03-08" });
  });

  it("returns honest totals, group counts, and overflow rows past the visible cut (F13)", async () => {
    for (let index = 0; index < 26; index += 1) {
      await seedIssue(`AM-${index + 1}`, { dueDate: "2026-03-01" });
    }
    const today = await todayService().getToday("manager-1", "2026-03-08", undefined, { tz: "Asia/Kolkata" });
    // 26 overdue issues + dev-1's stale-check-in row.
    expect(today.actionItems).toHaveLength(20);
    expect(today.totalCount).toBe(27);
    expect(today.overflowActionItems).toHaveLength(7);
    expect(today.groupCounts).toEqual({ now: 26, next: 1, later: 0 });
    expect(today.summary.find((metric) => metric.id === "attention")?.value).toBe(27);
  });

  it("keeps counting past the shipped cap, so the client can say how many rows it never received (docs/63 #6)", async () => {
    for (let index = 0; index < 101; index += 1) {
      await seedIssue(`AM-${index + 1}`, { dueDate: "2026-03-01" });
    }
    const today = await todayService().getToday("manager-1", "2026-03-08", undefined, { tz: "Asia/Kolkata" });
    const shipped = today.actionItems.length + (today.overflowActionItems?.length ?? 0);
    expect(shipped).toBe(100);
    // 101 overdue issues + dev-1's stale-check-in row.
    expect(today.totalCount).toBe(102);
    expect(today.summary.find((metric) => metric.id === "attention")?.value).toBe(102);
  });

  describe("since-last-visit delta", () => {
    it("has no baseline on the first visit, then anchors to the last activity before a new visit", async () => {
      const service = todayService();
      const first = await service.getToday("manager-1", "2026-03-08", undefined, { tz: "Asia/Kolkata", recordVisit: true });
      expect(first.delta).toMatchObject({ newIssues: { count: 0 }, resolvedCount: 0 });
      expect(first.delta?.since).toBeUndefined();

      // Polls inside the idle window keep the same (empty) baseline.
      vi.setSystemTime(new Date("2026-03-08T04:20:00.000Z"));
      const poll = await service.getToday("manager-1", "2026-03-08", undefined, { tz: "Asia/Kolkata", recordVisit: true });
      expect(poll.delta?.since).toBeUndefined();

      // Overnight changes: new issue, overdue since the last visit, a dev check-in,
      // a follow-up coming due, and a resolved issue.
      await seedIssue("AM-NEW", { createdAt: "2026-03-09T01:00:00.000+0000" });
      await seedIssue("AM-DUE", { dueDate: "2026-03-08" });
      await seedIssue("AM-OLD", { dueDate: "2026-03-01" });
      await seedIssue("AM-DONE", { statusCategory: "done", statusName: "Done", updatedAt: "2026-03-09T02:00:00.000+0000" });
      const followUp = await managerDeskService.createItem("manager-1", {
        date: "2026-03-08", title: "Newly due", kind: "action", category: "follow_up", status: "planned",
        followUpAt: "2026-03-09T02:30:00.000Z",
      });
      vi.setSystemTime(new Date("2026-03-09T01:30:00.000Z"));
      await trackerService.addCheckIn("dev-1", "2026-03-09", { summary: "Shipped the fix" }, { type: "developer", accountId: "dev-1" });
      await trackerService.addCheckIn("dev-1", "2026-03-09", { summary: "Manager note" }, { type: "manager", accountId: "manager-1" });

      vi.setSystemTime(new Date("2026-03-09T03:00:00.000Z")); // next morning, 08:30 IST
      const next = await service.getToday("manager-1", "2026-03-09", undefined, { tz: "Asia/Kolkata", recordVisit: true });
      expect(next.delta).toMatchObject({
        since: "2026-03-08T04:20:00.000Z",
        newIssues: { count: 1, items: [expect.objectContaining({ jiraKey: "AM-NEW" })] },
        overdueOvernight: { count: 1, items: [expect.objectContaining({ jiraKey: "AM-DUE", target: expect.objectContaining({ filter: "overdue" }) })] },
        newCheckIns: { count: 1, people: [expect.objectContaining({ developerAccountId: "dev-1", count: 1 })] },
        followUpsNewlyDue: { count: 1, items: [expect.objectContaining({ target: expect.objectContaining({ managerDeskItemId: followUp.id }) })] },
        resolvedCount: 1,
      });

      const [visit] = await db.select().from(todayVisits).where(eq(todayVisits.managerAccountId, "manager-1"));
      expect(visit).toMatchObject({ baselineAt: "2026-03-08T04:20:00.000Z", lastActiveAt: "2026-03-09T03:00:00.000Z" });
    });

    it("is absent for reads that do not record a visit (header inbox)", async () => {
      const today = await todayService().getToday("manager-1", "2026-03-08");
      expect(today.delta).toBeUndefined();
      expect(await db.select().from(todayVisits)).toHaveLength(0);
    });
  });

  describe("Ask for update (F15)", () => {
    beforeEach(async () => {
      await trackerService.updateDay("dev-1", "2026-03-08", { status: "blocked" });
    });

    it("offers ask_check_in on developers who need a check-in", async () => {
      const today = await todayService().getToday("manager-1", "2026-03-08", undefined, { tz: "Asia/Kolkata" });
      const row = today.actionItems.find((item) => item.target.developerAccountId === "dev-1");
      expect(row?.primaryAction.kind).toBe("add_check_in");
      expect(row?.secondaryActions[0]).toMatchObject({ kind: "ask_check_in", label: "Ask for update", undoable: true, confirm: false });
    });

    it("lands a Check-in request task on My Day, records asked_at, and undo removes both", async () => {
      const service = todayService();
      const response = await service.executeCommand("manager-1", command({
        command: {
          kind: "ask_check_in",
          label: "Ask for update",
          target: { type: "developer", view: "team", developerAccountId: "dev-1", context: { issueKey: "AM-1" } },
        },
      }), manager);
      expect(response.undo?.request).toMatchObject({ command: { kind: "restore" }, restore: { type: "check_in_ask" } });

      const day = await trackerService.getDeveloperDay("2026-03-08", "dev-1");
      const requestItem = day.plannedItems.find((item) => item.title === "Check-in request: update on AM-1");
      expect(requestItem).toBeDefined();

      const today = await service.getToday("manager-1", "2026-03-08", undefined, { tz: "Asia/Kolkata" });
      const row = today.actionItems.find((item) => item.target.developerAccountId === "dev-1");
      const pulse = today.teamPulse.find((person) => person.accountId === "dev-1");
      expect(row?.askedAt).toBe("2026-03-08T04:00:00.000Z");
      expect(row?.secondaryActions.some((action) => action.kind === "ask_check_in")).toBe(false);
      expect(pulse?.askedAt).toBe("2026-03-08T04:00:00.000Z");
      expect(today.checkInAsks).toEqual([expect.objectContaining({ developerAccountId: "dev-1" })]);

      // Re-asking the same day reuses the open ask.
      const again = await service.executeCommand("manager-1", command({
        command: { kind: "ask_check_in", label: "Ask", target: { type: "developer", view: "team", developerAccountId: "dev-1" } },
      }), manager);
      expect(again.result).toMatchObject({ reused: true });

      await service.executeCommand("manager-1", response.undo!.request, manager);
      const dayAfter = await trackerService.getDeveloperDay("2026-03-08", "dev-1");
      expect(dayAfter.plannedItems.some((item) => item.id === requestItem!.id)).toBe(false);
      const [ask] = await db.select().from(todayCheckInAsks);
      expect(ask?.cancelledAt).not.toBeNull();
      const restored = await service.getToday("manager-1", "2026-03-08", undefined, { tz: "Asia/Kolkata" });
      expect(restored.teamPulse.find((person) => person.accountId === "dev-1")?.askedAt).toBeUndefined();
    });

    it("clears askedAt once the developer checks in after the ask", async () => {
      const service = todayService();
      await service.executeCommand("manager-1", command({
        command: { kind: "ask_check_in", label: "Ask", target: { type: "developer", view: "team", developerAccountId: "dev-1" } },
      }), manager);
      vi.setSystemTime(new Date("2026-03-08T04:10:00.000Z"));
      await trackerService.addCheckIn("dev-1", "2026-03-08", { summary: "Unblocked" }, { type: "developer", accountId: "dev-1" });
      const today = await service.getToday("manager-1", "2026-03-08", undefined, { tz: "Asia/Kolkata" });
      expect(today.checkInAsks).toEqual([]);
      expect(today.teamPulse.find((person) => person.accountId === "dev-1")?.askedAt).toBeUndefined();
    });
  });

  describe("undo (F11)", () => {
    async function followUp() {
      return managerDeskService.createItem("manager-1", {
        date: "2026-03-08", title: "Promise", kind: "action", category: "follow_up", status: "planned",
        followUpAt: "2026-03-08T03:00:00.000Z",
      });
    }

    it("marks Done/Snooze undoable without confirm and keeps legacy carry confirm-gated", async () => {
      await followUp();
      await managerDeskService.createItem("manager-1", { date: "2026-03-06", title: "Old plan", kind: "action", category: "planning", status: "planned" });
      const today = await todayService().getToday("manager-1", "2026-03-08", undefined, { tz: "Asia/Kolkata" });
      const promise = today.actionItems.find((item) => item.type === "follow_up_due");
      const carry = today.actionItems.find((item) => item.type === "desk_carry_forward");
      expect(promise?.primaryAction).toMatchObject({ kind: "mark_done", confirm: false, undoable: true });
      expect(promise?.secondaryActions.find((action) => action.kind === "snooze")).toMatchObject({ confirm: false, undoable: true });
      expect(carry?.primaryAction).toMatchObject({ kind: "carry_forward", confirm: true });
      expect(carry?.primaryAction.undoable).toBeUndefined();
    });

    it("mark_done → undo restores the prior status and the row returns", async () => {
      const item = await followUp();
      const service = todayService();
      const target = { type: "follow_up" as const, view: "follow-ups" as const, managerDeskItemId: item.id };
      const done = await service.executeCommand("manager-1", command({ command: { kind: "mark_done", label: "Done", target } }), manager);
      expect(done.undo?.request.restore).toEqual({ type: "desk_item", managerDeskItemId: item.id, patch: { status: "planned" } });
      expect((await service.getToday("manager-1", "2026-03-08")).promises).toHaveLength(0);

      await service.executeCommand("manager-1", done.undo!.request, manager);
      const restored = await service.getToday("manager-1", "2026-03-08");
      expect(restored.promises.map((promise) => promise.target.managerDeskItemId)).toEqual([item.id]);
    });

    it("snooze → undo restores the prior followUpAt", async () => {
      const item = await followUp();
      const service = todayService();
      const snoozed = await service.executeCommand("manager-1", command({
        preset: "next_week",
        command: { kind: "snooze", label: "Snooze", target: { type: "follow_up", view: "follow-ups", managerDeskItemId: item.id } },
      }), manager);
      const undone = await service.executeCommand("manager-1", snoozed.undo!.request, manager);
      expect((undone.result as { followUpAt?: string }).followUpAt).toBe("2026-03-08T03:00:00.000Z");
    });

    it("capture_follow_up → undo deletes the created follow-up", async () => {
      const service = todayService();
      const created = await service.executeCommand("manager-1", command({
        title: "Chase the release note",
        command: { kind: "capture_follow_up", label: "Follow up", target: { type: "developer", view: "team", developerAccountId: "dev-1" } },
      }), manager);
      const createdId = (created.result as { id: number }).id;
      expect(created.undo?.request.restore).toEqual({ type: "delete_desk_item", managerDeskItemId: createdId });
      await service.executeCommand("manager-1", created.undo!.request, manager);
      const day = await managerDeskService.getDay("manager-1", "2026-03-08");
      expect(day.items.some((item) => item.id === createdId)).toBe(false);
    });

    it("canonical tasks: Done and Carry return task patches and undo restores them", async () => {
      await enablePhase3();
      const promise = await managerDeskService.createItem("manager-1", {
        date: "2026-03-08", title: "Canonical promise", kind: "action", category: "follow_up", status: "planned",
        followUpAt: "2026-03-08T03:00:00.000Z",
      });
      const old = await managerDeskService.createItem("manager-1", { date: "2026-03-06", title: "Old plan", kind: "action", category: "planning", status: "planned" });
      const service = todayService();
      const today = await service.getToday("manager-1", "2026-03-08", undefined, { tz: "Asia/Kolkata" });
      const carryRow = today.actionItems.find((item) => item.type === "desk_carry_forward");
      expect(carryRow?.primaryAction).toMatchObject({ kind: "carry_forward", confirm: false, undoable: true });

      const done = await service.executeCommand("manager-1", command({
        command: { kind: "mark_done", label: "Done", target: { type: "follow_up", view: "follow-ups", managerDeskItemId: promise.id, taskKey: promise.taskKey! } },
      }), manager);
      expect(done.undo?.request.restore).toEqual({ type: "task", taskKey: promise.taskKey, patch: { status: "open" } });
      await service.executeCommand("manager-1", done.undo!.request, manager);
      const afterDone = await service.getToday("manager-1", "2026-03-08");
      expect(afterDone.promises.some((item) => item.target.taskKey === promise.taskKey)).toBe(true);

      const carried = await service.executeCommand("manager-1", command({ command: carryRow!.primaryAction }), manager);
      expect(carried.undo?.request.restore).toEqual({ type: "task", taskKey: old.taskKey, patch: { scheduledOn: "2026-03-06" } });
      await service.executeCommand("manager-1", carried.undo!.request, manager);
      const afterCarry = await service.getToday("manager-1", "2026-03-08");
      expect(afterCarry.actionItems.some((item) => item.type === "desk_carry_forward" && item.target.taskKey === old.taskKey)).toBe(true);
    });

    it("restore requires the manager to own the target", async () => {
      const item = await followUp();
      await expect(todayService().executeCommand("manager-2", command({
        command: { kind: "restore", label: "Undo", target: { type: "follow_up", view: "follow-ups", managerDeskItemId: item.id } },
        restore: { type: "desk_item", managerDeskItemId: item.id, patch: { status: "done" } },
      }), { type: "manager", accountId: "manager-2" })).rejects.toMatchObject({ status: 404 });
    });
  });

  describe("meeting outcome → next action (F14)", () => {
    it("creates a linked follow-up owned by the named developer, and undo removes it", async () => {
      const meeting = await managerDeskService.createItem("manager-1", {
        date: "2026-03-08", title: "Migration review", kind: "meeting", category: "planning", status: "planned",
      });
      const service = todayService();
      const response = await service.executeCommand("manager-1", command({
        tz: "Asia/Kolkata",
        outcome: "Go for Friday",
        nextAction: "Draft the rollback plan",
        nextActionOwnerAccountId: "dev-1",
        command: { kind: "capture_meeting_outcome", label: "Outcome", target: { type: "meeting", view: "meetings", managerDeskItemId: meeting.id } },
      }), manager);
      const nextAction = (response.result as { nextActionFollowUp?: { id: number; title: string; followUpAt?: string; category: string; links: Array<{ developerAccountId?: string }> } }).nextActionFollowUp;
      expect(nextAction).toMatchObject({
        title: "Draft the rollback plan",
        category: "follow_up",
        followUpAt: "2026-03-09T03:30:00.000Z",
        links: [expect.objectContaining({ developerAccountId: "dev-1" })],
      });
      expect(response.undo?.request.restore).toMatchObject({
        type: "desk_item",
        managerDeskItemId: meeting.id,
        patch: { status: "planned", outcome: null },
        alsoDeleteDeskItemId: nextAction!.id,
      });

      await service.executeCommand("manager-1", response.undo!.request, manager);
      const day = await managerDeskService.getDay("manager-1", "2026-03-08");
      expect(day.items.find((item) => item.id === meeting.id)).toMatchObject({ status: "planned" });
      expect(day.items.some((item) => item.id === nextAction!.id)).toBe(false);
    });

    it("skips the follow-up when no next action is given", async () => {
      const meeting = await managerDeskService.createItem("manager-1", {
        date: "2026-03-08", title: "Sync", kind: "meeting", category: "planning", status: "planned",
      });
      const response = await todayService().executeCommand("manager-1", command({
        outcome: "Nothing new",
        command: { kind: "capture_meeting_outcome", label: "Outcome", target: { type: "meeting", view: "meetings", managerDeskItemId: meeting.id } },
      }), manager);
      expect(response.result).not.toHaveProperty("nextActionFollowUp");
    });
  });
});
