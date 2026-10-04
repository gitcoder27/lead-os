import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db, resetDatabase } from "./helpers/db";
import { enableCollabParticipation } from "./helpers/team-mode";
import { pinAttentionTimeZone } from "./helpers/attention";
import { configureJira } from "./helpers/jira-config";
import { configTable, developers, issues, managerDeskDays, teamTrackerDays } from "../src/db/schema";
import { IssueService } from "../src/services/issue.service";
import { ManagerDeskService } from "../src/services/manager-desk.service";
import { TeamTrackerService } from "../src/services/team-tracker.service";
import { TodayService } from "../src/services/today.service";

const trackerService = new TeamTrackerService();
const managerDeskService = new ManagerDeskService(trackerService);
const issueService = new IssueService(undefined, undefined, trackerService);

function todayService(syncStatus = { status: "idle" as const }) {
  return new TodayService(issueService, trackerService, managerDeskService, {
    getLastSyncLog: async () => ({
      completedAt: "2026-03-08T08:00:00.000Z",
      status: "success",
      issuesSynced: 3,
      errorMessage: null,
    }),
    getRuntimeStatus: () => syncStatus,
  });
}

function cachedTodayService() {
  const issueServiceMock = {
    getTodaySnapshot: vi.fn(async () => ({ issues: [], activeDefects: 0, dueToday: 0, staleThresholdHours: 24 })),
  };
  const teamTrackerServiceMock = {
    getAttentionSnapshot: vi.fn(async () => ({
      date: "2026-03-08",
      viewMode: "live",
      developers: [],
      summary: { total: 0, blocked: 0, atRisk: 0, stale: 0, noCurrent: 0, doneForToday: 0 },
      attentionQueue: [],
    })),
  };
  const managerDeskServiceMock = {
    getTodayItems: vi.fn(async () => []),
  };
  const syncSourceMock = {
    getLastSyncLog: vi.fn(async () => undefined),
    getRuntimeStatus: vi.fn(() => ({ status: "idle" as const })),
  };

  return {
    issueService: issueServiceMock,
    teamTrackerService: teamTrackerServiceMock,
    managerDeskService: managerDeskServiceMock,
    syncSource: syncSourceMock,
    service: new TodayService(
      issueServiceMock as any,
      teamTrackerServiceMock as any,
      managerDeskServiceMock as any,
      syncSourceMock,
    ),
  };
}

async function seedDeveloper(accountId = "dev-1", displayName = "Alice Smith") {
  await db.insert(developers).values({
    accountId,
    displayName,
    email: `${accountId}@example.com`,
    avatarUrl: null,
    isActive: 1,
  });
}

async function seedIssue(jiraKey: string, overrides: Partial<typeof issues.$inferInsert> = {}) {
  await db.insert(issues).values({
    jiraKey,
    summary: "Checkout regression",
    priorityName: "High",
    priorityId: "1",
    statusName: "In Progress",
    statusCategory: "indeterminate",
    assigneeId: "dev-1",
    assigneeName: "Alice Smith",
    teamScopeState: "in_team",
    syncScopeState: "active",
    reporterName: null,
    component: null,
    labels: JSON.stringify([]),
    dueDate: "2026-03-07",
    developmentDueDate: null,
    flagged: 0,
    createdAt: "2026-03-06T08:00:00.000Z",
    updatedAt: "2026-03-06T08:00:00.000Z",
    syncedAt: "2026-03-06T08:00:00.000Z",
    lastSeenInScopedSyncAt: "2026-03-06T08:00:00.000Z",
    lastReconciledAt: "2026-03-06T08:00:00.000Z",
    scopeChangedAt: null,
    analysisNotes: null,
    excluded: 0,
    aspenSeverity: null,
    ...overrides,
  });
}

describe("TodayService", () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-08T08:30:00.000Z"));
    await resetDatabase();
    await pinAttentionTimeZone();
    await seedDeveloper();
    // These contracts describe a collab team whose developers check in;
    // solo / non-participating suppression lives in today.participation.test.ts.
    await enableCollabParticipation(["dev-1"]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("builds exact ranked action targets across people, work, and manager memory", async () => {
    // docs/56 P1-05: weekends never age anyone, so this runs on a Monday afternoon.
    vi.setSystemTime(new Date("2026-03-09T13:30:00.000Z"));
    await trackerService.updateDay("dev-1", "2026-03-09", { status: "blocked" });
    await seedIssue("AM-1", { dueDate: "2026-03-08" });
    await seedIssue("AM-2", {
      summary: "Needs owner",
      assigneeId: null,
      assigneeName: null,
      dueDate: "2026-03-09",
    });
    const followUp = await managerDeskService.createItem("manager-1", {
      date: "2026-03-09",
      title: "Follow up with QA",
      kind: "action",
      category: "follow_up",
      status: "planned",
      followUpAt: "2026-03-08T10:00:00.000Z",
    });
    const meeting = await managerDeskService.createItem("manager-1", {
      date: "2026-03-09",
      title: "Migration review",
      kind: "meeting",
      category: "planning",
      status: "planned",
    });

    const response = await todayService().getToday("manager-1", "2026-03-09");

    expect(response.summary).toHaveLength(6);
    expect(response.currentPriority?.target.developerAccountId).toBe("dev-1");
    expect(response.actionItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "today-dev-dev-1-blocked",
          type: "stale_check_in",
          target: expect.objectContaining({ type: "developer", developerAccountId: "dev-1" }),
          // UX-02: blocked, so Follow up leads; the stale check-in stays a secondary.
          primaryAction: expect.objectContaining({ kind: "capture_follow_up" }),
          secondaryActions: expect.arrayContaining([expect.objectContaining({ kind: "add_check_in" })]),
        }),
        expect.objectContaining({
          id: "today-issue-AM-1",
          target: expect.objectContaining({ type: "issue", issueKey: "AM-1" }),
        }),
        expect.objectContaining({
          id: `today-follow-up-${followUp.id}`,
          target: expect.objectContaining({ type: "follow_up", managerDeskItemId: followUp.id }),
          secondaryActions: expect.arrayContaining([expect.objectContaining({ kind: "snooze" })]),
        }),
        expect.objectContaining({
          id: `today-meeting-${meeting.id}`,
          primaryAction: expect.objectContaining({ kind: "capture_meeting_outcome" }),
        }),
      ]),
    );
  });

  it("deduplicates concurrent Today and manager-action snapshot builds", async () => {
    const { service, issueService, teamTrackerService, managerDeskService } = cachedTodayService();

    const [today, managerActions] = await Promise.all([
      service.getToday("manager-1", "2026-03-08", "workspace-a"),
      service.getManagerActions("manager-1", "2026-03-08", { surface: "header", limit: 8 }, "workspace-a"),
    ]);

    expect(today.generatedAt).toBe(managerActions.generatedAt);
    expect(issueService.getTodaySnapshot).toHaveBeenCalledTimes(1);
    expect(issueService.getTodaySnapshot).toHaveBeenCalledWith("2026-03-08", "workspace-a");
    expect(teamTrackerService.getAttentionSnapshot).toHaveBeenCalledTimes(1);
    expect(managerDeskService.getTodayItems).toHaveBeenCalledTimes(1);
  });

  it("reuses cached Today snapshots briefly and clears them after commands", async () => {
    const { service, issueService } = cachedTodayService();

    await service.getToday("manager-1", "2026-03-08", "workspace-a");
    await service.getToday("manager-1", "2026-03-08", "workspace-a");
    expect(issueService.getTodaySnapshot).toHaveBeenCalledTimes(1);

    await service.executeCommand(
      "manager-1",
      {
        date: "2026-03-08",
        command: {
          kind: "open",
          label: "Open Team",
          target: { type: "view", view: "team" },
        },
      },
      { type: "manager", accountId: "manager-1" },
      "workspace-a",
    );
    await service.getToday("manager-1", "2026-03-08", "workspace-a");

    expect(issueService.getTodaySnapshot).toHaveBeenCalledTimes(2);
  });

  it("adds sync attention without mutating source data", async () => {
    await configureJira();
    const response = await todayService({ status: "error", errorMessage: "Token expired" }).getToday("manager-1", "2026-03-08");

    expect(response.actionItems[0]).toMatchObject({
      id: "today-sync-error",
      severity: "critical",
      target: { type: "view", view: "settings" },
    });
    expect(response.syncStatus).toMatchObject({ status: "error", errorMessage: "Token expired" });
  });

  describe("without a Jira connection (docs/56 P2-03)", () => {
    it("does not turn a failed or stale sync into a Today signal, and flags the response", async () => {
      const response = await todayService({ status: "error", errorMessage: "Missing jira_project_key in config" }).getToday("manager-1", "2026-03-08");

      expect(response.actionItems.some((item) => item.id === "today-sync-error")).toBe(false);
      expect(response.summary.some((metric) => metric.id === "sync")).toBe(false);
      expect(response.syncStatus).toMatchObject({ status: "error", jiraConfigured: false });
    });

    it("hides the defect metrics when there is no Jira and nothing synced", async () => {
      const ids = (await todayService().getToday("manager-1", "2026-03-08")).summary.map((metric) => metric.id);
      expect(ids).not.toContain("work");
      expect(ids).not.toContain("due-work");
    });

    it("keeps the defect metrics for leftover synced defects", async () => {
      const { service } = cachedTodayService();
      const snapshot = { issues: [], activeDefects: 4, dueToday: 1, staleThresholdHours: 24 };
      const withDefects = new TodayService(
        { getTodaySnapshot: vi.fn(async () => snapshot) } as unknown as IssueService,
        trackerService,
        managerDeskService,
        undefined,
        { todayCacheTtlMs: 0 },
      );
      const ids = (await withDefects.getToday("manager-1", "2026-03-08")).summary.map((metric) => metric.id);
      expect(ids).toContain("work");
      void service;
    });

    it("shows the sync error and defect metrics once Jira is configured, and says so", async () => {
      await configureJira();
      const response = await todayService({ status: "error", errorMessage: "Token expired" }).getToday("manager-1", "2026-03-08");

      expect(response.summary.map((metric) => metric.id)).toEqual(expect.arrayContaining(["work", "due-work", "sync"]));
      expect(response.syncStatus).toMatchObject({ jiraConfigured: true });
    });
  });

  it("returns available sections when one Today source is unavailable", async () => {
    const { service, issueService } = cachedTodayService();
    issueService.getTodaySnapshot.mockRejectedValueOnce(new Error("issues unavailable"));

    const response = await service.getToday("manager-1", "2026-03-08", "workspace-a");

    expect(response.isPartial).toBe(true);
    expect(response.sourceStatus).toMatchObject({
      issues: "unavailable",
      team: "ready",
      desk: "ready",
    });
    expect(response.summary.some((item) => item.id === "work")).toBe(false);
    expect(response.summary.some((item) => item.id === "team")).toBe(true);
  });

  it("does not create a Manager Desk day while reading Today", async () => {
    await todayService().getToday("manager-without-desk", "2026-03-08");

    const days = await db.select().from(managerDeskDays);
    expect(days).toHaveLength(0);
  });

  it("uses set current instead of check-in when a developer has planned work but no current item", async () => {
    const planned = await trackerService.addItem("dev-1", "2026-03-08", {
      title: "BE modernization",
    });

    const response = await todayService().getToday("manager-1", "2026-03-08");
    const developerAction = response.actionItems.find((item) => item.target.developerAccountId === "dev-1");
    const pulseItem = response.teamPulse.find((item) => item.accountId === "dev-1");

    expect(developerAction).toMatchObject({
      title: "Alice Smith",
      actionPreview: "BE modernization",
      primaryAction: {
        kind: "set_current_work",
        label: "Set current",
        target: expect.objectContaining({
          type: "tracker_item",
          trackerItemId: planned.id,
        }),
      },
    });
    expect(pulseItem?.primaryAction).toMatchObject({
      kind: "set_current_work",
      label: "Set current",
      target: expect.objectContaining({ trackerItemId: planned.id }),
    });
    expect(pulseItem?.actionPreview).toBe("BE modernization");
  });

  it("makes Follow up the primary action for blocked and at-risk people, with the reason as subtitle (UX-02)", async () => {
    await seedDeveloper("dev-2", "Noah Smith");
    await enableCollabParticipation(["dev-2"]);
    const planned = await trackerService.addItem("dev-1", "2026-03-08", { title: "Fix flaky payment webhook retries" });
    await trackerService.addCheckIn("dev-1", "2026-03-08", { summary: "Waiting on payments sandbox keys", status: "blocked" }, { type: "manager", accountId: "manager-1" });
    await trackerService.updateDay("dev-2", "2026-03-08", { status: "at_risk" });

    const response = await todayService().getToday("manager-1", "2026-03-08");
    const blocked = response.actionItems.find((item) => item.target.developerAccountId === "dev-1");
    const atRisk = response.actionItems.find((item) => item.target.developerAccountId === "dev-2");
    const pulse = response.teamPulse.find((item) => item.accountId === "dev-1");

    expect(blocked).toMatchObject({
      context: "Waiting on payments sandbox keys",
      primaryAction: {
        kind: "capture_follow_up",
        label: "Follow up",
        target: expect.objectContaining({ type: "developer", developerAccountId: "dev-1", context: expect.objectContaining({ reason: "Waiting on payments sandbox keys", trackerItemId: planned.id }) }),
      },
    });
    // Never previewed against the blocked task itself.
    expect(blocked?.actionPreview).toBeUndefined();
    // Set current stays available, as a secondary with its own tracker-item target.
    expect(blocked?.secondaryActions).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "set_current_work", target: expect.objectContaining({ type: "tracker_item", trackerItemId: planned.id }) }),
    ]));
    expect(atRisk?.primaryAction).toMatchObject({ kind: "capture_follow_up", label: "Follow up" });
    expect(atRisk?.primaryAction.target.context?.reason).toBeUndefined();
    expect(pulse?.primaryAction).toMatchObject({ kind: "capture_follow_up", label: "Follow up" });
    expect(pulse?.actionPreview).toBeUndefined();
  });

  it("keeps developer targets person-only while task context rides in target.context (docs/53 F2)", async () => {
    await seedIssue("AM-1");
    await seedIssue("AM-2", { summary: "Related checkout context" });
    await trackerService.updateDay("dev-1", "2026-03-08", { status: "blocked" });
    const current = await trackerService.addItem("dev-1", "2026-03-08", {
      jiraKey: "AM-1",
      relatedIssueKeys: ["AM-2"],
      title: "Checkout retry fix",
    });
    await trackerService.setCurrentItem(current.id);

    const response = await todayService().getToday("manager-1", "2026-03-08");
    const developerAction = response.actionItems.find((item) => item.target.developerAccountId === "dev-1");
    const pulseItem = response.teamPulse.find((item) => item.accountId === "dev-1");

    // Developer navigation identity lives on the target; task/issue detail
    // is context for the dialogs, not for `open`.
    expect(developerAction?.target).toMatchObject({
      type: "developer",
      view: "team",
      developerAccountId: "dev-1",
      context: {
        trackerItemId: current.id,
        issueKey: "AM-1",
        relatedIssueKeys: ["AM-2"],
      },
    });
    expect(developerAction?.target).not.toHaveProperty("trackerItemId");
    expect(developerAction?.target).not.toHaveProperty("taskKey");
    expect(developerAction?.target).not.toHaveProperty("issueKey");
    expect(pulseItem?.target).toMatchObject({
      type: "developer",
      developerAccountId: "dev-1",
      context: {
        trackerItemId: current.id,
        issueKey: "AM-1",
        relatedIssueKeys: ["AM-2"],
      },
    });
  });

  it("snooze 'later_today' writes now+3h and the item stays out of due follow-ups until then (docs/53 F1)", async () => {
    const item = await managerDeskService.createItem("manager-1", {
      date: "2026-03-08",
      title: "Ping QA on the release",
      kind: "action",
      category: "follow_up",
      status: "planned",
      followUpAt: "2026-03-08T07:00:00.000Z",
    });
    const service = todayService();

    const before = await service.getToday("manager-1", "2026-03-08");
    expect(before.promises.some((promise) => promise.target.managerDeskItemId === item.id)).toBe(true);

    const response = await service.executeCommand(
      "manager-1",
      {
        date: "2026-03-08",
        preset: "later_today",
        command: {
          kind: "snooze",
          label: "Snooze",
          target: { type: "follow_up", view: "follow-ups", managerDeskItemId: item.id, date: "2026-03-08" },
        },
      },
      { type: "manager", accountId: "manager-1" },
    );

    // Fake clock is 2026-03-08T08:30Z → now+3h lands on 11:30Z (already aligned
    // to the half-hour, so no rounding adjustment expected).
    expect((response.result as { followUpAt?: string }).followUpAt).toBe("2026-03-08T11:30:00.000Z");

    const after = await service.getToday("manager-1", "2026-03-08");
    expect(after.promises.some((promise) => promise.target.managerDeskItemId === item.id)).toBe(false);
    expect(after.actionItems.some((action) => action.target.managerDeskItemId === item.id)).toBe(false);

    vi.setSystemTime(new Date("2026-03-08T11:31:00.000Z"));
    const due = await service.getToday("manager-1", "2026-03-08");
    expect(due.promises.some((promise) => promise.target.managerDeskItemId === item.id)).toBe(true);
  });

  it("captured follow-ups default to tomorrow 09:00 and are not due immediately (docs/53 F3)", async () => {
    await seedIssue("AM-1");
    const service = todayService();

    const response = await service.executeCommand(
      "manager-1",
      {
        date: "2026-03-08",
        title: "Check the checkout fix",
        command: {
          kind: "capture_follow_up",
          label: "Follow up",
          target: { type: "issue", view: "work", issueKey: "AM-1", date: "2026-03-08" },
        },
      },
      { type: "manager", accountId: "manager-1" },
    );

    const created = response.result as { id: number; followUpAt?: string };
    const dueAt = new Date(created.followUpAt!);
    expect(dueAt.getHours()).toBe(9);
    expect(dueAt.getMinutes()).toBe(0);
    expect(dueAt.getDate()).toBe(9);

    const today = await service.getToday("manager-1", "2026-03-08");
    expect(today.promises.some((promise) => promise.target.managerDeskItemId === created.id)).toBe(false);
    expect(today.actionItems.some((action) => action.target.managerDeskItemId === created.id)).toBe(false);
  });

  it("captured follow-ups honor the later_today preset and land outside the queue until then (docs/53 F3)", async () => {
    const service = todayService();

    const response = await service.executeCommand(
      "manager-1",
      {
        date: "2026-03-08",
        title: "Ping Deepak this afternoon",
        preset: "later_today",
        command: {
          kind: "capture_follow_up",
          label: "Follow up",
          target: { type: "developer", view: "team", developerAccountId: "dev-1", date: "2026-03-08" },
        },
      },
      { type: "manager", accountId: "manager-1" },
    );

    const created = response.result as { id: number; followUpAt?: string };
    expect(created.followUpAt).toBe("2026-03-08T11:30:00.000Z");

    const today = await service.getToday("manager-1", "2026-03-08");
    expect(today.promises.some((promise) => promise.target.managerDeskItemId === created.id)).toBe(false);
  });

  it("only surfaces high-priority defects that are unassigned, not started, or stale (docs/53 F12)", async () => {
    await seedIssue("AM-10", { dueDate: null, updatedAt: "2026-03-08T07:30:00.000Z" });
    await seedIssue("AM-11", {
      statusCategory: "new",
      statusName: "To Do",
      dueDate: null,
      updatedAt: "2026-03-08T07:30:00.000Z",
    });
    // P1-05: 48 weekday hours; the weekend does not count.
    await seedIssue("AM-12", { dueDate: null, updatedAt: "2026-03-04T08:00:00.000Z" });
    await seedIssue("AM-13", { assigneeId: null, assigneeName: null, dueDate: null });
    await seedIssue("AM-14", { priorityName: "Low", statusCategory: "new", dueDate: null });

    const response = await todayService().getToday("manager-1", "2026-03-08");
    const ids = response.actionItems.map((item) => item.id);

    expect(ids).not.toContain("today-issue-AM-10");
    expect(ids).not.toContain("today-issue-AM-14");
    expect(ids).toContain("today-issue-AM-11");
    expect(ids).toContain("today-issue-AM-12");
    expect(ids).toContain("today-issue-AM-13");
    expect(response.actionItems.find((item) => item.id === "today-issue-AM-11")?.type).toBe("high_priority_issue");
    expect(response.actionItems.find((item) => item.id === "today-issue-AM-12")?.type).toBe("high_priority_issue");
    expect(response.actionItems.find((item) => item.id === "today-issue-AM-13")?.type).toBe("unassigned_issue");
  });

  it("caps high-priority rows at three and folds the rest into an aggregate row (docs/53 F12)", async () => {
    for (const key of ["AM-20", "AM-21", "AM-22", "AM-23", "AM-24"]) {
      await seedIssue(key, { statusCategory: "new", statusName: "To Do", dueDate: null });
    }

    const response = await todayService().getToday("manager-1", "2026-03-08");
    const priorityRows = response.actionItems.filter(
      (item) => item.type === "high_priority_issue" && item.target.issueKey,
    );
    const aggregate = response.actionItems.find((item) => item.id === "today-issue-priority-backlog");

    expect(priorityRows).toHaveLength(3);
    expect(aggregate).toMatchObject({
      type: "high_priority_issue",
      title: "5 high-priority defects",
      target: { type: "view", view: "work", filter: "highPriority" },
      primaryAction: { kind: "open", label: "Open Work" },
    });
  });

  it("does not turn Later desk items into Today carry-forward actions", async () => {
    const planned = await managerDeskService.createItem("manager-1", {
      date: "2026-03-07",
      title: "Carry the planned task",
      kind: "action",
      category: "planning",
      status: "planned",
    });
    const later = await managerDeskService.createItem("manager-1", {
      date: "2026-03-07",
      title: "Parked later task",
      kind: "action",
      category: "planning",
      status: "backlog",
    });

    const response = await todayService().getToday("manager-1", "2026-03-08");

    expect(response.actionItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: `today-desk-carry-${planned.id}`,
          title: "Carry the planned task",
          type: "desk_carry_forward",
        }),
      ])
    );
    expect(response.actionItems).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: `today-desk-carry-${later.id}`,
        }),
      ])
    );
  });

  it("stops asking for another check-in once a no-current developer has a same-day check-in", async () => {
    // docs/56 P1-05: weekends never age anyone, so this runs on a Monday afternoon.
    vi.setSystemTime(new Date("2026-03-09T13:30:00.000Z"));
    // Only the developer's own check-in resets their freshness (docs/56 P1-02).
    const before = await todayService().getToday("manager-1", "2026-03-09");
    const beforeDeveloperAction = before.actionItems.find((item) => item.target.developerAccountId === "dev-1");

    expect(beforeDeveloperAction).toMatchObject({
      title: "Alice Smith",
      context: "No current work",
      primaryAction: expect.objectContaining({ kind: "add_check_in", label: "Add check-in" }),
    });
    expect(before.teamPulse.find((item) => item.accountId === "dev-1")?.primaryAction).toMatchObject({
      kind: "add_check_in",
    });

    await trackerService.addCheckIn("dev-1", "2026-03-09", {
      summary: "Asked about next work",
    }, { type: "developer", accountId: "dev-1" });

    const after = await todayService().getToday("manager-1", "2026-03-09");
    const afterDeveloperAction = after.actionItems.find((item) => item.target.developerAccountId === "dev-1");

    expect(afterDeveloperAction).toMatchObject({
      title: "Alice Smith",
      context: "No current work",
      primaryAction: expect.objectContaining({ kind: "open", label: "Open developer" }),
    });
    expect(after.teamPulse.find((item) => item.accountId === "dev-1")?.primaryAction).toMatchObject({
      kind: "open",
      label: "Open",
    });
    expect(after.standupPrompts.find((item) => item.id === "standup-dev-dev-1")?.primaryAction).toMatchObject({
      kind: "open",
      label: "Open developer",
    });
  });

  it("uses exact day check-ins as the source of truth when lastCheckInAt is missing", async () => {
    await trackerService.addCheckIn("dev-1", "2026-03-08", {
      summary: "Asked about next work",
    });
    await db
      .update(teamTrackerDays)
      .set({ lastCheckInAt: null })
      .where(and(eq(teamTrackerDays.date, "2026-03-08"), eq(teamTrackerDays.developerAccountId, "dev-1")));

    const response = await todayService().getToday("manager-1", "2026-03-08");
    const developerAction = response.actionItems.find((item) => item.target.developerAccountId === "dev-1");

    expect(developerAction).toMatchObject({
      title: "Alice Smith",
      context: "No current work",
      primaryAction: expect.objectContaining({ kind: "open", label: "Open developer" }),
    });
  });

  it("surfaces Jira drift as read-only attention items when Phase 3 is enabled (§8.1)", async () => {
    const { TaskService } = await import("../src/services/task.service");
    const tasks = new TaskService();
    const manager = { type: "manager" as const, accountId: "manager-1", workspaceId: "default" };
    await seedIssue("APP-7", { statusCategory: "done", statusName: "Done" });
    await db.insert(configTable).values([
      { key: "tasks_phase1_enabled", value: "true" },
      { key: "tasks_phase2_stage", value: "2c" },
      { key: "tasks_phase3_enabled", value: "true" },
    ]);
    const row = await tasks.create({ title: "Checkout follow-up" }, manager);
    await tasks.addLink(row.taskKey, { kind: "jira", ref: "APP-7", role: "primary" }, manager);

    const response = await todayService().getToday("manager-1", "2026-03-08");
    const driftItem = response.actionItems.find((item) => item.type === "jira_drift");
    expect(driftItem).toMatchObject({
      id: `jira-drift-${row.taskKey}`,
      type: "jira_drift",
      severity: "warning",
      title: `${row.taskKey} Checkout follow-up`,
      signal: "Done in Jira, open here",
      target: { type: "view", view: "tasks", taskKey: row.taskKey },
      primaryAction: { kind: "open", label: "Open task" },
      secondaryActions: [],
    });
    expect(response.sourceStatus).toMatchObject({ drift: "ready" });
  });

  it("skips Jira drift entirely while Phase 3 is disabled", async () => {
    const { TaskService } = await import("../src/services/task.service");
    const tasks = new TaskService();
    const manager = { type: "manager" as const, accountId: "manager-1", workspaceId: "default" };
    await seedIssue("APP-8", { statusCategory: "done", statusName: "Done" });
    await db.insert(configTable).values({ key: "tasks_phase1_enabled", value: "true" });
    const row = await tasks.create({ title: "Hidden drift" }, manager);
    await tasks.addLink(row.taskKey, { kind: "jira", ref: "APP-8", role: "primary" }, manager);

    const response = await todayService().getToday("manager-1", "2026-03-08");
    expect(response.actionItems.some((item) => item.type === "jira_drift")).toBe(false);
    expect(response.sourceStatus).toMatchObject({ drift: "ready" });
  });
});
