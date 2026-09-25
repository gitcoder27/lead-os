import { randomUUID } from "node:crypto";
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { ManagerDeskService } from "../src/services/manager-desk.service";
import { TaskEventsService } from "../src/services/task-events.service";
import { TeamTrackerService } from "../src/services/team-tracker.service";
import { resetDatabase, db } from "./helpers/db";
import {
  configTable,
  developers,
  issues,
  managerDeskItems,
  teamTrackerItems,
  teamTrackerDays,
  teamTrackerSavedViews,
} from "../src/db/schema";

const service = new TeamTrackerService();
const managerDeskService = new ManagerDeskService(service);
const eventsService = new TaskEventsService();
const managerViewer = { kind: "manager" as const, accountId: "manager-1" };

async function enableTaskKeys() {
  await db.insert(configTable).values({ key: "tasks_phase1_enabled", value: "true" });
}

async function seedDevelopers() {
  await db.insert(developers).values([
    { accountId: "dev-1", displayName: "Alice Smith", email: null, avatarUrl: null, isActive: 1 },
    { accountId: "dev-2", displayName: "Bob Jones", email: null, avatarUrl: null, isActive: 1 },
  ]);
}

async function seedIssue(overrides: Partial<typeof issues.$inferInsert> = {}) {
  await db.insert(issues).values({
    jiraKey: "AM-123",
    summary: "Linked Jira task",
    description: null,
    aspenSeverity: null,
    priorityName: "High",
    priorityId: "1",
    statusName: "In Progress",
    statusCategory: "indeterminate",
    assigneeId: "dev-1",
    assigneeName: "Alice Smith",
    teamScopeState: "in_team",
    syncScopeState: "active",
    reporterName: "Lead",
    component: null,
    labels: JSON.stringify([]),
    dueDate: "2026-03-10",
    developmentDueDate: "2026-03-08",
    flagged: 0,
    createdAt: "2026-03-07T08:00:00.000Z",
    updatedAt: "2026-03-07T08:00:00.000Z",
    syncedAt: "2026-03-07T08:00:00.000Z",
    lastSeenInScopedSyncAt: "2026-03-07T08:00:00.000Z",
    lastReconciledAt: "2026-03-07T08:00:00.000Z",
    scopeChangedAt: null,
    analysisNotes: null,
    excluded: 0,
    ...overrides,
  });
}

describe("TeamTrackerService", () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-07T08:00:00.000Z"));
    await resetDatabase();
    await seedDevelopers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("ensureDay", () => {
    it("creates a new day row when none exists", async () => {
      const day = await service.ensureDay("2026-03-07", "dev-1");
      expect(day.id).toBeDefined();
      expect(day.date).toBe("2026-03-07");
      expect(day.developerAccountId).toBe("dev-1");
      expect(day.status).toBe("on_track");
    });

    it("returns existing day on subsequent calls", async () => {
      const first = await service.ensureDay("2026-03-07", "dev-1");
      const second = await service.ensureDay("2026-03-07", "dev-1");
      expect(first.id).toBe(second.id);
    });

    it("seeds a new live day from the latest prior effective risk state", async () => {
      await service.recordStatusUpdate(
        "dev-1",
        "2026-03-06",
        {
          status: "blocked",
          rationale: "Waiting for deploy credentials",
          nextFollowUpAt: "2026-03-07T10:00:00.000Z",
        },
        { type: "manager", accountId: "manager-1" }
      );
      const day = await service.ensureDay("2026-03-07", "dev-1");

      expect(day.status).toBe("blocked");
      expect(day.nextFollowUpAt).toBe("2026-03-07T10:00:00.000Z");
    });

    it("seeds manager notes from the latest prior day", async () => {
      await service.updateDay("dev-1", "2026-03-06", {
        managerNotes: "Focus the migration review on the edge-case repro.",
      });

      const day = await service.ensureDay("2026-03-07", "dev-1");

      expect(day.managerNotes).toBe("Focus the migration review on the edge-case repro.");
    });

    it("does not seed manager notes for non-live dates", async () => {
      await service.updateDay("dev-1", "2026-03-06", {
        managerNotes: "Focus the migration review on the edge-case repro.",
      });

      const day = await service.ensureDay("2026-03-05", "dev-1");

      expect(day.managerNotes).toBeNull();
    });

    it("returns the same row under concurrent calls", async () => {
      const [first, second] = await Promise.all([
        service.ensureDay("2026-03-07", "dev-1"),
        service.ensureDay("2026-03-07", "dev-1"),
      ]);

      expect(first.id).toBe(second.id);

      const rows = await db.select().from(teamTrackerDays);
      expect(
        rows.filter(
          (row) =>
            row.date === "2026-03-07" && row.developerAccountId === "dev-1"
        )
      ).toHaveLength(1);
    });
  });

  describe("getBoard", () => {
    it("returns one entry per active developer", async () => {
      const board = await service.getBoard("2026-03-07");
      expect(board.developers).toHaveLength(2);
      expect(board.date).toBe("2026-03-07");
      expect(board.viewMode).toBe("live");
      expect(board.summary.total).toBe(2);
    });

    it("surfaces unfinished work from earlier days on the live board without manual carry-forward", async () => {
      await service.addItem("dev-1", "2026-03-06", {
        title: "Yesterday follow-up",
      });

      const board = await service.getBoard("2026-03-07");
      const devDay = board.developers.find(
        (d) => d.developer.accountId === "dev-1"
      )!;

      expect(board.viewMode).toBe("live");
      expect(devDay.plannedItems.map((item) => item.title)).toContain(
        "Yesterday follow-up"
      );
    });

    it("returns past dates as historical snapshots without pulling in future work", async () => {
      await service.addItem("dev-1", "2026-03-06", {
        title: "Yesterday follow-up",
      });
      await service.addItem("dev-1", "2026-03-07", {
        title: "Today planning task",
      });

      const board = await service.getBoard("2026-03-06");
      const devDay = board.developers.find(
        (d) => d.developer.accountId === "dev-1"
      )!;

      expect(board.viewMode).toBe("history");
      expect(board.attentionQueue).toEqual([]);
      expect(devDay.plannedItems.map((item) => item.title)).toEqual([
        "Yesterday follow-up",
      ]);
    });

    it("moves inactive developers into the restore tray for the selected date", async () => {
      await service.updateAvailability("dev-2", {
        effectiveDate: "2026-03-07",
        state: "inactive",
        note: "PTO today",
      });

      const board = await service.getBoard("2026-03-07");

      expect(board.developers.map((day) => day.developer.accountId)).toEqual(["dev-1"]);
      expect(board.inactiveDevelopers).toEqual([
        expect.objectContaining({
          developer: expect.objectContaining({ accountId: "dev-2" }),
          availability: expect.objectContaining({
            state: "inactive",
            note: "PTO today",
            startDate: "2026-03-07",
          }),
        }),
      ]);
      expect(board.summary.total).toBe(1);
    });

    it("groups items into current/planned/completed/dropped", async () => {
      const item1 = await service.addItem("dev-1", "2026-03-07", {
        title: "Task A",
      });
      await service.addItem("dev-1", "2026-03-07", {
        title: "Task B",
      });
      await service.setCurrentItem(item1.id);

      const board = await service.getBoard("2026-03-07");
      const devDay = board.developers.find(
        (d) => d.developer.accountId === "dev-1"
      )!;
      expect(devDay.currentItem?.title).toBe("Task A");
      expect(devDay.plannedItems).toHaveLength(1);
      expect(devDay.plannedItems[0].title).toBe("Task B");
    });

    it("computes smarter freshness and risk signals for the board", async () => {
      await seedIssue({ developmentDueDate: "2026-03-06", dueDate: "2026-03-09" });
      await service.updateDay("dev-1", "2026-03-07", {
        status: "blocked",
      });
      const jiraItem = await service.addItem("dev-1", "2026-03-07", {
        jiraKey: "AM-123",
        title: "Linked Jira task",
      });
      await service.addItem("dev-1", "2026-03-07", {
        title: "Secondary task",
      });
      await service.setCurrentItem(jiraItem.id);
      vi.setSystemTime(new Date("2026-03-07T12:00:00.000Z"));

      const board = await service.getBoard("2026-03-07");
      const devDay = board.developers.find(
        (d) => d.developer.accountId === "dev-1"
      )!;

      expect(devDay.isStale).toBe(true);
      expect(devDay.signals.freshness.staleByTime).toBe(true);
      expect(devDay.signals.freshness.staleWithOpenRisk).toBe(true);
      expect(devDay.signals.freshness.statusChangeWithoutFollowUp).toBe(true);
      expect(devDay.signals.risk.overdueLinkedWork).toBe(true);
      expect(devDay.signals.risk.overdueLinkedCount).toBe(1);
      expect(devDay.signals.risk).not.toHaveProperty("overCapacity");
      expect(board.summary.overdueLinkedWork).toBe(1);
      expect(board.summary).not.toHaveProperty("overCapacity");
      expect(board.summary.statusFollowUp).toBe(1);
      expect(board.attentionQueue[0]?.reasons.map((reason) => reason.code)).toEqual([
        "blocked",
        "stale_with_open_risk",
        "overdue_linked_work",
        "status_change_without_follow_up",
      ]);
      expect(board.attentionQueue[0]?.availableQuickActions).toEqual([
        "update_status",
        "mark_inactive",
        "capture_follow_up",
      ]);
      expect(board.attentionQueue[0]?.currentItem).toEqual({
        id: jiraItem.id,
        title: "Linked Jira task",
        jiraKey: "AM-123",
        lifecycle: "tracker_only",
      });
      expect(board.attentionQueue[0]?.setCurrentCandidates).toEqual([]);
    });

    it("adds set-current quick-action metadata only when planned work is available", async () => {
      const first = await service.addItem("dev-1", "2026-03-07", {
        title: "First planned task",
      });
      const second = await service.addItem("dev-1", "2026-03-07", {
        title: "Second planned task",
      });
      await service.recordStatusUpdate(
        "dev-1",
        "2026-03-07",
        {
          status: "blocked",
          rationale: "Need to pick the right next task",
          summary: "Queue needs manager intervention",
          nextFollowUpAt: "2026-03-07T10:30:00.000Z",
        },
        {
          type: "manager",
          accountId: "manager-1",
        }
      );

      const board = await service.getBoard("2026-03-07");
      const attentionItem = board.attentionQueue.find(
        (item) => item.developer.accountId === "dev-1"
      );

      expect(attentionItem).toMatchObject({
        nextFollowUpAt: "2026-03-07T10:30:00.000Z",
        availableQuickActions: [
          "update_status",
          "mark_inactive",
          "capture_follow_up",
          "set_current",
        ],
      });
      expect(attentionItem?.setCurrentCandidates).toEqual([
        {
          id: first.id,
          title: "First planned task",
          jiraKey: undefined,
          lifecycle: "tracker_only",
        },
        {
          id: second.id,
          title: "Second planned task",
          jiraKey: undefined,
          lifecycle: "tracker_only",
        },
      ]);
    });

    it("filters the board by search text across developer, notes, check-ins, and item fields", async () => {
      await service.updateDay("dev-1", "2026-03-07", {
        managerNotes: "Needs help on the login flow",
      });
      await service.addCheckIn("dev-2", "2026-03-07", {
        summary: "Investigating payment gateway timeouts",
      });
      await service.addItem("dev-1", "2026-03-07", {
        title: "Investigate login regression",
      });
      await service.addItem("dev-2", "2026-03-07", {
        title: "Patch checkout bug",
        note: "Pair with payments team",
      });

      const noteBoard = await service.getBoard("2026-03-07", {
        query: { q: "login" },
      });
      const checkInBoard = await service.getBoard("2026-03-07", {
        query: { q: "gateway" },
      });
      const itemNoteBoard = await service.getBoard("2026-03-07", {
        query: { q: "payments" },
      });

      expect(noteBoard.developers.map((day) => day.developer.accountId)).toEqual(["dev-1"]);
      expect(checkInBoard.developers.map((day) => day.developer.accountId)).toEqual(["dev-2"]);
      expect(itemNoteBoard.developers.map((day) => day.developer.accountId)).toEqual(["dev-2"]);
      expect(noteBoard.summary.total).toBe(2);
      expect(noteBoard.visibleSummary.total).toBe(1);
    });

    it("sorts the visible board by blocked-first order", async () => {
      await db.insert(developers).values([
        { accountId: "dev-3", displayName: "Cara Diaz", email: null, avatarUrl: null, isActive: 1 },
        { accountId: "dev-4", displayName: "Derek Long", email: null, avatarUrl: null, isActive: 1 },
      ]);
      await service.updateDay("dev-1", "2026-03-07", { status: "on_track" });
      await service.updateDay("dev-2", "2026-03-07", { status: "waiting" });
      await service.updateDay("dev-3", "2026-03-07", { status: "blocked" });
      await service.updateDay("dev-4", "2026-03-07", { status: "at_risk" });

      const board = await service.getBoard("2026-03-07", {
        query: { sortBy: "blocked_first" },
      });

      expect(board.developers.map((day) => day.developer.accountId)).toEqual([
        "dev-3",
        "dev-4",
        "dev-2",
        "dev-1",
      ]);
    });

    it("builds grouped board metadata for status grouping", async () => {
      await service.updateDay("dev-1", "2026-03-07", { status: "blocked" });
      await service.updateDay("dev-2", "2026-03-07", { status: "waiting" });

      const board = await service.getBoard("2026-03-07", {
        query: { groupBy: "status" },
      });

      expect(board.groups).toEqual([
        expect.objectContaining({
          key: "blocked",
          count: 1,
        }),
        expect.objectContaining({
          key: "waiting",
          count: 1,
        }),
      ]);
      expect(board.groups[0]?.developers[0]?.developer.accountId).toBe("dev-1");
      expect(board.groups[1]?.developers[0]?.developer.accountId).toBe("dev-2");
    });

    it("filters inactive developers with the same search query", async () => {
      await service.updateAvailability("dev-2", {
        effectiveDate: "2026-03-07",
        state: "inactive",
        note: "PTO today",
      });

      const board = await service.getBoard("2026-03-07", {
        query: { q: "pto" },
      });

      expect(board.developers).toHaveLength(0);
      expect(board.inactiveDevelopers).toEqual([
        expect.objectContaining({
          developer: expect.objectContaining({ accountId: "dev-2" }),
        }),
      ]);
    });
  });

  describe("addItem", () => {
    it("creates a planned item with correct position", async () => {
      await seedIssue();

      const item1 = await service.addItem("dev-1", "2026-03-07", {
        title: "First",
      });
      const item2 = await service.addItem("dev-1", "2026-03-07", {
        jiraKey: "AM-123",
        title: "Second",
      });
      expect(item1.position).toBe(0);
      expect(item2.position).toBe(1);
      expect(item2.itemType).toBe("jira");
      expect(item2.jiraKey).toBe("AM-123");
      expect(item1.lifecycle).toBe("tracker_only");
      expect(item2.lifecycle).toBe("tracker_only");
      expect(item2.state).toBe("planned");
    });

    it("hydrates Jira-linked items with priority and effective due date context", async () => {
      await seedIssue();

      const item = await service.addItem("dev-1", "2026-03-07", {
        jiraKey: "AM-123",
        title: "Linked Jira task",
      });

      expect(item.jiraPriorityName).toBe("High");
      expect(item.jiraDueDate).toBe("2026-03-08");
      expect(item.jiraSummary).toBe("Linked Jira task");
    });

    it("stores normalized related Jira keys without duplicating the primary issue", async () => {
      await seedIssue();
      await seedIssue({ jiraKey: "AM-456", summary: "Secondary context" });
      await seedIssue({ jiraKey: "AM-789", summary: "Tertiary context" });

      const item = await service.addItem("dev-1", "2026-03-07", {
        jiraKey: " am-123 ",
        relatedIssueKeys: ["am-456", "AM-123", "AM-456", " am-789 "],
        title: "Multi-issue tracker item",
      });

      expect(item.jiraKey).toBe("AM-123");
      expect(item.relatedIssueKeys).toEqual(["AM-456", "AM-789"]);

      const rows = await db
        .select()
        .from(teamTrackerItems)
        .where(eq(teamTrackerItems.id, item.id));
      expect(rows[0]?.relatedJiraKeys).toBe(JSON.stringify(["AM-456", "AM-789"]));
    });

    it("matches related Jira keys in Team Tracker search", async () => {
      await seedIssue();
      await seedIssue({ jiraKey: "AM-456", summary: "Secondary context" });

      await service.addItem("dev-1", "2026-03-07", {
        jiraKey: "AM-123",
        relatedIssueKeys: ["AM-456"],
        title: "Primary task",
      });

      const board = await service.getBoard("2026-03-07", {
        query: { q: "AM-456" },
      });

      expect(board.developers).toHaveLength(1);
      expect(board.developers[0]?.plannedItems).toEqual([
        expect.objectContaining({
          title: "Primary task",
          relatedIssueKeys: ["AM-456"],
        }),
      ]);
    });

    it("rejects Jira-linked items whose key is not present in synced issues", async () => {
      await expect(
        service.addItem("dev-1", "2026-03-07", {
          jiraKey: "AM-999",
          title: "Missing Jira task",
        })
      ).rejects.toThrow("Jira issue AM-999 is not available in synced issues");
    });

    it("rejects related Jira keys that are not present in synced issues", async () => {
      await seedIssue();

      await expect(
        service.addItem("dev-1", "2026-03-07", {
          jiraKey: "AM-123",
          relatedIssueKeys: ["AM-404"],
          title: "Missing related Jira task",
        })
      ).rejects.toThrow("Jira issue AM-404 is not available in synced issues");
    });

    it("rejects new work for an inactive developer", async () => {
      await service.updateAvailability("dev-2", {
        effectiveDate: "2026-03-07",
        state: "inactive",
        note: "PTO today",
      });

      await expect(
        service.addItem("dev-2", "2026-03-07", {
          title: "Should wait",
        })
      ).rejects.toThrow("Developer is inactive on 2026-03-07");
    });

    it("allows multiple descriptive tasks to link the same Jira issue", async () => {
      await seedIssue();

      await service.addItem("dev-1", "2026-03-07", {
        jiraKey: "AM-123",
        title: "Reproduce the customer report",
      });

      const secondItem = await service.addItem("dev-1", "2026-03-07", {
        jiraKey: "AM-123",
        title: "Patch the validation path",
      });

      expect(secondItem.jiraKey).toBe("AM-123");
      expect(secondItem.title).toBe("Patch the validation path");
    });
  });

  describe("getIssueAssignmentSummaryMap", () => {
    it("summarizes active linked work per Jira issue for the selected day", async () => {
      await seedIssue();
      await service.addItem("dev-1", "2026-03-07", {
        jiraKey: "AM-123",
        title: "Reproduce the report",
      });
      await service.addItem("dev-2", "2026-03-07", {
        jiraKey: "AM-123",
        title: "Patch the validation path",
      });
      await service.addItem("dev-2", "2026-03-07", {
        jiraKey: "AM-123",
        title: "Old investigation",
      });
      const doneItem = await service.addItem("dev-1", "2026-03-07", {
        jiraKey: "AM-123",
        title: "Completed follow-up",
      });
      await service.updateItem(doneItem.id, { state: "done" });

      const summaryMap = await service.getIssueAssignmentSummaryMap("2026-03-07");

      expect(summaryMap.get("AM-123")).toEqual({
        activeCount: 3,
        developerNames: ["Alice Smith", "Bob Jones"],
      });
    });
  });

  describe("setCurrentItem", () => {
    it("enforces single in_progress per day", async () => {
      const item1 = await service.addItem("dev-1", "2026-03-07", {
        title: "Task A",
      });
      const item2 = await service.addItem("dev-1", "2026-03-07", {
        title: "Task B",
      });

      await service.setCurrentItem(item1.id);
      let board = await service.getBoard("2026-03-07");
      let devDay = board.developers.find(
        (d) => d.developer.accountId === "dev-1"
      )!;
      expect(devDay.currentItem?.id).toBe(item1.id);

      // Set item2 as current - should reset item1
      await service.setCurrentItem(item2.id);
      board = await service.getBoard("2026-03-07");
      devDay = board.developers.find(
        (d) => d.developer.accountId === "dev-1"
      )!;
      expect(devDay.currentItem?.id).toBe(item2.id);
      expect(devDay.plannedItems.some((i) => i.id === item1.id)).toBe(true);
    });

    it("demotes in-progress work on other days when setting today's current item", async () => {
      const yesterday = await service.addItem("dev-1", "2026-03-06", {
        title: "Yesterday current task",
      });
      const today = await service.addItem("dev-1", "2026-03-07", {
        title: "Today current task",
      });

      await service.setCurrentItem(yesterday.id);
      await service.setCurrentItem(today.id);

      const rows = await db
        .select()
        .from(teamTrackerItems)
        .where(eq(teamTrackerItems.id, yesterday.id));

      expect(rows[0]?.state).toBe("planned");
    });

    it("chooses the most recently activated live in-progress item as current", async () => {
      vi.setSystemTime(new Date("2026-03-06T09:00:00.000Z"));
      const yesterday = await service.addItem("dev-1", "2026-03-06", {
        title: "Yesterday current task",
      });
      await service.setCurrentItem(yesterday.id);

      vi.setSystemTime(new Date("2026-03-07T09:00:00.000Z"));
      const today = await service.addItem("dev-1", "2026-03-07", {
        title: "Today current task",
      });
      await service.setCurrentItem(today.id);

      const board = await service.getBoard("2026-03-07");
      const devDay = board.developers.find((day) => day.developer.accountId === "dev-1")!;

      expect(devDay.currentItem?.id).toBe(today.id);
      expect(devDay.plannedItems).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: yesterday.id,
            state: "planned",
            originDate: "2026-03-06",
          }),
        ])
      );
    });

    it("can make reactivated inherited work the live current item and demotes the previous one", async () => {
      vi.setSystemTime(new Date("2026-03-06T09:00:00.000Z"));
      const yesterday = await service.addItem("dev-1", "2026-03-06", {
        title: "Yesterday current task",
      });
      await service.setCurrentItem(yesterday.id);

      vi.setSystemTime(new Date("2026-03-07T09:00:00.000Z"));
      const today = await service.addItem("dev-1", "2026-03-07", {
        title: "Today current task",
      });
      await service.setCurrentItem(today.id);

      vi.setSystemTime(new Date("2026-03-07T10:00:00.000Z"));
      await service.setCurrentItem(yesterday.id);

      const board = await service.getBoard("2026-03-07");
      const devDay = board.developers.find((day) => day.developer.accountId === "dev-1")!;

      expect(devDay.currentItem?.id).toBe(yesterday.id);
      expect(devDay.plannedItems).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: today.id,
            state: "planned",
            originDate: "2026-03-07",
          }),
        ])
      );

      const rows = await db
        .select()
        .from(teamTrackerItems)
        .where(eq(teamTrackerItems.id, today.id));
      expect(rows[0]?.state).toBe("planned");
    });

    it("rejects guarded stale set-current when another item is already current", async () => {
      const staleCandidate = await service.addItem("dev-1", "2026-03-07", {
        title: "Stale Today action candidate",
      });
      const developerChoice = await service.addItem("dev-1", "2026-03-07", {
        title: "Developer selected task",
      });

      await service.setCurrentItem(developerChoice.id);

      await expect(service.setCurrentItem(staleCandidate.id, { ifNoCurrent: true })).rejects.toMatchObject({
        status: 409,
        message: "Current work changed. Refresh Today before setting current work.",
      });

      const board = await service.getBoard("2026-03-07");
      const devDay = board.developers.find((day) => day.developer.accountId === "dev-1")!;
      expect(devDay.currentItem?.id).toBe(developerChoice.id);
      expect(devDay.plannedItems.some((item) => item.id === staleCandidate.id)).toBe(true);
    });
  });

  describe("updateItem", () => {
    it("marks item as done with completedAt timestamp", async () => {
      const item = await service.addItem("dev-1", "2026-03-07", {
        title: "Do thing",
      });
      const updated = await service.updateItem(item.id, { state: "done" });
      expect(updated.state).toBe("done");
      expect(updated.completedAt).toBeDefined();
    });

    it("persists note clearing as null instead of ignoring the update", async () => {
      const item = await service.addItem("dev-1", "2026-03-07", {
        title: "Document follow-up",
        note: "Initial note",
      });

      const updated = await service.updateItem(item.id, { note: null });
      const rows = await db
        .select()
        .from(teamTrackerItems)
        .where(eq(teamTrackerItems.id, item.id));

      expect(updated.note).toBeUndefined();
      expect(rows[0]?.note).toBeNull();
    });

    it("enforces a single current item when state is updated directly to in_progress", async () => {
      const first = await service.addItem("dev-1", "2026-03-07", {
        title: "First",
      });
      const second = await service.addItem("dev-1", "2026-03-07", {
        title: "Second",
      });

      await service.setCurrentItem(first.id);
      await service.updateItem(second.id, { state: "in_progress" });

      const board = await service.getBoard("2026-03-07");
      const devDay = board.developers.find(
        (d) => d.developer.accountId === "dev-1"
      )!;

      expect(devDay.currentItem?.id).toBe(second.id);
      expect(devDay.plannedItems.some((item) => item.id === first.id)).toBe(
        true
      );
    });

    it("reorders items by normalizing sibling positions", async () => {
      const first = await service.addItem("dev-1", "2026-03-07", {
        title: "First",
      });
      const second = await service.addItem("dev-1", "2026-03-07", {
        title: "Second",
      });
      const third = await service.addItem("dev-1", "2026-03-07", {
        title: "Third",
      });

      await service.updateItem(third.id, { position: second.position });

      const board = await service.getBoard("2026-03-07");
      const devDay = board.developers.find(
        (d) => d.developer.accountId === "dev-1"
      )!;

      expect(devDay.plannedItems.map((item) => item.title)).toEqual([
        "First",
        "Third",
        "Second",
      ]);
      expect(devDay.plannedItems.map((item) => item.position)).toEqual([0, 1, 2]);
      expect(first.position).toBe(0);
    });

    it("rejects title edits for Manager Desk-linked delegated tasks", async () => {
      const managerItem = await managerDeskService.createItem("manager-1", {
        date: "2026-03-07",
        title: "Shared delegated task",
        assigneeDeveloperAccountId: "dev-1",
      });
      const linkedItem = (await service.getItemDetailContextForManagerDeskItem(managerItem.id))
        ?.trackerItem;
      expect(linkedItem).toBeDefined();

      await expect(
        service.updateItem(linkedItem!.id, { title: "Developer rename attempt" })
      ).rejects.toThrow("Linked delegated tasks must be renamed from Manager Desk");
    });

    it("touches the linked Manager Desk item when execution changes", async () => {
      const managerItem = await managerDeskService.createItem("manager-1", {
        date: "2026-03-07",
        title: "Shared delegated task",
        assigneeDeveloperAccountId: "dev-1",
      });
      const linkedRow = (
        await db
          .select()
          .from(teamTrackerItems)
          .where(eq(teamTrackerItems.managerDeskItemId, managerItem.id))
      )[0];
      expect(linkedRow).toBeDefined();

      const before = (
        await db.select().from(managerDeskItems).where(eq(managerDeskItems.id, managerItem.id))
      )[0];
      expect(before).toBeDefined();

      vi.setSystemTime(new Date("2026-03-07T09:30:00.000Z"));
      await service.updateItem(linkedRow!.id, {
        state: "done",
        note: "Execution completed by developer.",
      });

      const after = (
        await db.select().from(managerDeskItems).where(eq(managerDeskItems.id, managerItem.id))
      )[0];
      expect(after?.updatedAt).toBe("2026-03-07T09:30:00.000Z");

      const refreshed = await managerDeskService.getDay("manager-1", "2026-03-07");
      expect(refreshed.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: managerItem.id,
            delegatedExecution: expect.objectContaining({
              trackerItemId: linkedRow!.id,
              state: "done",
              note: "Execution completed by developer.",
              completedAt: "2026-03-07T09:30:00.000Z",
              updatedAt: "2026-03-07T09:30:00.000Z",
            }),
          }),
        ])
      );
    });
  });

  describe("deleteItem", () => {
    it("removes item from database", async () => {
      const item = await service.addItem("dev-1", "2026-03-07", {
        title: "To remove",
      });
      await service.deleteItem(item.id);
      const board = await service.getBoard("2026-03-07");
      const devDay = board.developers.find(
        (d) => d.developer.accountId === "dev-1"
      )!;
      const allItems = [
        ...devDay.plannedItems,
        ...devDay.completedItems,
        ...devDay.droppedItems,
      ];
      expect(allItems.find((i) => i.id === item.id)).toBeUndefined();
    });

    it("rejects deleting Manager Desk-linked delegated tasks from Team Tracker", async () => {
      const managerItem = await managerDeskService.createItem("manager-1", {
        date: "2026-03-07",
        title: "Shared delegated task",
        assigneeDeveloperAccountId: "dev-1",
      });
      const linkedItem = (await service.getItemDetailContextForManagerDeskItem(managerItem.id))
        ?.trackerItem;
      expect(linkedItem).toBeDefined();

      await expect(service.deleteItem(linkedItem!.id)).rejects.toThrow(
        "Linked delegated tasks cannot be deleted; mark them dropped instead"
      );
    });
  });

  describe("manager desk linkage helpers", () => {
    it("delegates Manager Desk issue links with one primary Jira key and related context", async () => {
      await seedIssue();
      await seedIssue({ jiraKey: "AM-456", summary: "Secondary context" });
      await seedIssue({ jiraKey: "AM-789", summary: "Tertiary context" });

      const managerItem = await managerDeskService.createItem("manager-1", {
        date: "2026-03-07",
        title: "Shared delegated task",
        assigneeDeveloperAccountId: "dev-1",
        links: [
          { linkType: "issue", issueKey: "AM-123" },
          { linkType: "issue", issueKey: "AM-456" },
          { linkType: "issue", issueKey: "AM-789" },
        ],
      });

      const linkedItem = (await service.getItemDetailContextForManagerDeskItem(managerItem.id))
        ?.trackerItem;

      expect(linkedItem).toMatchObject({
        jiraKey: "AM-123",
        relatedIssueKeys: ["AM-456", "AM-789"],
      });

      const rows = await db
        .select()
        .from(teamTrackerItems)
        .where(eq(teamTrackerItems.managerDeskItemId, managerItem.id));
      expect(rows[0]?.relatedJiraKeys).toBe(JSON.stringify(["AM-456", "AM-789"]));
    });

    it("resyncs related Jira keys when Manager Desk issue links change", async () => {
      await seedIssue();
      await seedIssue({ jiraKey: "AM-456", summary: "Secondary context" });
      await seedIssue({ jiraKey: "AM-789", summary: "Tertiary context" });

      const managerItem = await managerDeskService.createItem("manager-1", {
        date: "2026-03-07",
        title: "Shared delegated task",
        assigneeDeveloperAccountId: "dev-1",
        links: [
          { linkType: "issue", issueKey: "AM-123" },
          { linkType: "issue", issueKey: "AM-456" },
        ],
      });

      await managerDeskService.addLink("manager-1", managerItem.id, {
        linkType: "issue",
        issueKey: "AM-789",
      });

      let linkedItem = (await service.getItemDetailContextForManagerDeskItem(managerItem.id))
        ?.trackerItem;
      expect(linkedItem).toMatchObject({
        jiraKey: "AM-123",
        relatedIssueKeys: ["AM-456", "AM-789"],
      });

      const primaryLink = managerItem.links.find((link) => link.issueKey === "AM-123");
      expect(primaryLink).toBeDefined();
      await managerDeskService.deleteLink("manager-1", managerItem.id, primaryLink!.id);

      linkedItem = (await service.getItemDetailContextForManagerDeskItem(managerItem.id))
        ?.trackerItem;
      expect(linkedItem).toMatchObject({
        jiraKey: "AM-456",
        relatedIssueKeys: ["AM-789"],
      });
    });

    it("unlinks Manager Desk work without deleting tracker execution data", async () => {
      const managerItem = await managerDeskService.createItem("manager-1", {
        date: "2026-03-07",
        title: "Shared delegated task",
        assigneeDeveloperAccountId: "dev-1",
      });
      const linkedItem = (await service.getItemDetailContextForManagerDeskItem(managerItem.id))
        ?.trackerItem;
      expect(linkedItem).toBeDefined();

      await service.updateItem(linkedItem!.id, {
        state: "in_progress",
        note: "Execution note should survive unlinking.",
      });

      vi.setSystemTime(new Date("2026-03-07T10:15:00.000Z"));
      await service.unlinkManagerDeskItem(managerItem.id);

      const rows = await db
        .select()
        .from(teamTrackerItems)
        .where(eq(teamTrackerItems.id, linkedItem!.id));

      expect(rows).toEqual([
        expect.objectContaining({
          id: linkedItem!.id,
          managerDeskItemId: null,
          title: "Shared delegated task",
          state: "in_progress",
          note: "Execution note should survive unlinking.",
          updatedAt: "2026-03-07T10:15:00.000Z",
        }),
      ]);
    });

    it("cancels linked Manager Desk work by marking the tracker item dropped", async () => {
      const managerItem = await managerDeskService.createItem("manager-1", {
        date: "2026-03-07",
        title: "Shared delegated task",
        assigneeDeveloperAccountId: "dev-1",
      });
      const linkedItem = (await service.getItemDetailContextForManagerDeskItem(managerItem.id))
        ?.trackerItem;
      expect(linkedItem).toBeDefined();

      const cancelled = await service.cancelManagerDeskItem(managerItem.id);
      expect(cancelled).toBe(true);

      const rows = await db
        .select()
        .from(teamTrackerItems)
        .where(eq(teamTrackerItems.id, linkedItem!.id));
      expect(rows).toEqual([
        expect.objectContaining({
          id: linkedItem!.id,
          state: "dropped",
        }),
      ]);
    });
  });

  describe("addCheckIn", () => {
    it("creates check-in and updates lastCheckInAt", async () => {
      const checkIn = await service.addCheckIn("dev-1", "2026-03-07", {
        summary: "Spoke to Alice - moving forward",
      });
      expect(checkIn.summary).toBe("Spoke to Alice - moving forward");

      const board = await service.getBoard("2026-03-07");
      const devDay = board.developers.find(
        (d) => d.developer.accountId === "dev-1"
      )!;
      expect(devDay.lastCheckInAt).toBeDefined();
      expect(devDay.checkIns).toHaveLength(1);
    });

    it("updates status when provided with check-in", async () => {
      await service.addCheckIn("dev-1", "2026-03-07", {
        summary: "Blocked on dependency",
        status: "blocked",
      });
      const board = await service.getBoard("2026-03-07");
      const devDay = board.developers.find(
        (d) => d.developer.accountId === "dev-1"
      )!;
      expect(devDay.status).toBe("blocked");
      expect(devDay.statusUpdatedAt).toBeDefined();
    });

    it("exposes recent check-ins from prior days on the live board", async () => {
      await service.addCheckIn("dev-1", "2026-02-20", {
        summary: "Old check-in outside window",
      });
      await service.addCheckIn("dev-1", "2026-03-05", {
        summary: "Thursday sync",
      });
      await service.addCheckIn("dev-1", "2026-03-06", {
        summary: "Friday sync",
      });

      const board = await service.getBoard("2026-03-07");
      const devDay = board.developers.find(
        (d) => d.developer.accountId === "dev-1"
      )!;

      expect(devDay.checkIns).toHaveLength(0);
      expect(devDay.recentCheckIns).toEqual([
        expect.objectContaining({ summary: "Friday sync", date: "2026-03-06" }),
        expect.objectContaining({ summary: "Thursday sync", date: "2026-03-05" }),
      ]);
    });

    it("clears the next follow-up marker when a new check-in is recorded", async () => {
      await service.recordStatusUpdate(
        "dev-1",
        "2026-03-07",
        {
          status: "blocked",
          rationale: "Waiting on platform input",
          nextFollowUpAt: "2026-03-07T10:30:00.000Z",
        },
        {
          type: "manager",
          accountId: "manager-1",
        }
      );

      await service.addCheckIn(
        "dev-1",
        "2026-03-07",
        {
          summary: "Platform replied, resuming work",
          status: "on_track",
        },
        {
          type: "developer",
          accountId: "dev-1",
        }
      );

      const board = await service.getBoard("2026-03-07");
      const devDay = board.developers.find(
        (d) => d.developer.accountId === "dev-1"
      )!;

      expect(devDay.status).toBe("on_track");
      expect(devDay.nextFollowUpAt).toBeUndefined();
    });

    it("rejects check-ins for an inactive developer", async () => {
      await service.updateAvailability("dev-2", {
        effectiveDate: "2026-03-07",
        state: "inactive",
        note: "PTO today",
      });

      await expect(
        service.addCheckIn("dev-2", "2026-03-07", {
          summary: "Trying to check in",
        })
      ).rejects.toThrow("Developer is inactive on 2026-03-07");
    });
  });

  describe("recordStatusUpdate", () => {
    it("requires rationale for blocked and at-risk updates", async () => {
      await expect(
        service.recordStatusUpdate(
          "dev-1",
          "2026-03-07",
          {
            status: "blocked",
          },
          {
            type: "manager",
            accountId: "manager-1",
          }
        )
      ).rejects.toThrow(
        "rationale is required when status is blocked or at_risk"
      );
    });

    it("records a unified status update with rationale and follow-up metadata", async () => {
      const day = await service.recordStatusUpdate(
        "dev-1",
        "2026-03-07",
        {
          status: "blocked",
          rationale: "Waiting on platform review",
          summary: "Escalated in #backend-help",
          nextFollowUpAt: "2026-03-07T10:30:00.000Z",
        },
        {
          type: "manager",
          accountId: "manager-1",
        }
      );

      expect(day.status).toBe("blocked");
      expect(day.lastCheckInAt).toBeDefined();
      expect(day.nextFollowUpAt).toBe("2026-03-07T10:30:00.000Z");
      expect(day.checkIns).toHaveLength(1);
      expect(day.checkIns[0]).toMatchObject({
        summary: "Escalated in #backend-help",
        status: "blocked",
        rationale: "Waiting on platform review",
        nextFollowUpAt: "2026-03-07T10:30:00.000Z",
        authorType: "manager",
        authorAccountId: "manager-1",
      });
      expect(day.signals.freshness.statusChangeWithoutFollowUp).toBe(false);
    });
  });

  describe("updateDay", () => {
    it("updates status and manager notes", async () => {
      await service.updateDay("dev-1", "2026-03-07", {
        status: "at_risk",
        managerNotes: "Needs help with deployment",
      });
      const board = await service.getBoard("2026-03-07");
      const devDay = board.developers.find(
        (d) => d.developer.accountId === "dev-1"
      )!;
      expect(devDay.status).toBe("at_risk");
      expect(devDay.managerNotes).toBe("Needs help with deployment");
      expect(devDay.statusUpdatedAt).toBeDefined();
    });

    it("no longer exposes daily capacity on the board DTO", async () => {
      await service.updateDay("dev-1", "2026-03-07", { status: "on_track" });

      const board = await service.getBoard("2026-03-07");
      const devDay = board.developers.find(
        (d) => d.developer.accountId === "dev-1"
      )!;

      expect(devDay).not.toHaveProperty("capacityUnits");
      expect(devDay.signals.risk).not.toHaveProperty("capacityDelta");
    });

    it("rejects day updates for an inactive developer", async () => {
      await service.updateAvailability("dev-2", {
        effectiveDate: "2026-03-07",
        state: "inactive",
        note: "PTO today",
      });

      await expect(
        service.updateDay("dev-2", "2026-03-07", {
          status: "waiting",
        })
      ).rejects.toThrow("Developer is inactive on 2026-03-07");
    });
  });

  describe("saved views", () => {
    it("creates, lists, updates, and deletes manager-scoped saved views", async () => {
      const created = await service.createSavedView("manager-1", {
        name: "Morning triage",
        q: "alice",
        sortBy: "attention",
        groupBy: "attention_state",
      });

      expect(created).toMatchObject({
        name: "Morning triage",
        q: "alice",
        summaryFilter: "all",
        sortBy: "attention",
        groupBy: "attention_state",
      });

      const listed = await service.listSavedViews("manager-1");
      expect(listed).toHaveLength(1);
      expect(listed[0]?.id).toBe(created.id);

      const updated = await service.updateSavedView("manager-1", created.id, {
        name: "Blocked first",
        q: "",
        summaryFilter: "blocked",
        sortBy: "blocked_first",
      });
      expect(updated).toMatchObject({
        id: created.id,
        name: "Blocked first",
        q: "",
        summaryFilter: "blocked",
        sortBy: "blocked_first",
        groupBy: "attention_state",
      });

      await service.deleteSavedView("manager-1", created.id);
      const rows = await db.select().from(teamTrackerSavedViews);
      expect(rows).toHaveLength(0);
    });

    it("isolates saved views by manager and rejects duplicate names per manager", async () => {
      await service.createSavedView("manager-1", {
        name: "Morning triage",
      });
      await service.createSavedView("manager-2", {
        name: "Morning triage",
      });

      await expect(
        service.createSavedView("manager-1", {
          name: "Morning triage",
        })
      ).rejects.toThrow('Saved view "Morning triage" already exists');

      await expect(
        service.updateSavedView("manager-1", 2, {
          name: "Changed",
        })
      ).rejects.toThrow("Saved view not found");
    });

    it("resolves saved-view queries with explicit overrides", async () => {
      const savedView = await service.createSavedView("manager-1", {
        name: "Morning triage",
        q: "alice",
        summaryFilter: "blocked",
        sortBy: "attention",
        groupBy: "status",
      });

      const resolved = await service.resolveBoardQuery("manager-1", {
        viewId: savedView.id,
        sortBy: "name",
        q: "",
      });

      expect(resolved).toEqual({
        viewId: savedView.id,
        q: "",
        summaryFilter: "blocked",
        sortBy: "name",
        groupBy: "status",
      });
    });
  });

  describe("carryForward", () => {
    it("rejects same-day and backwards carry-forward requests", async () => {
      await expect(
        service.carryForward("2026-03-07", "2026-03-07")
      ).rejects.toThrow("toDate must be after fromDate");
      await expect(
        service.carryForward("2026-03-08", "2026-03-07")
      ).rejects.toThrow("toDate must be after fromDate");
    });

    it("previews only items that still need to be carried into the target day", async () => {
      await service.addItem("dev-1", "2026-03-06", {
        title: "Unfinished task",
      });
      await service.addItem("dev-1", "2026-03-06", {
        title: "Second unfinished task",
      });

      await service.addItem("dev-1", "2026-03-07", {
        title: "Unfinished task",
      });

      const preview = await service.previewCarryForward(
        "2026-03-06",
        "2026-03-07"
      );

      expect(preview).toMatchObject({
        carryable: 1,
        developers: [
          {
            developer: expect.objectContaining({
              accountId: "dev-1",
            }),
            items: [
              expect.objectContaining({
                title: "Second unfinished task",
                lifecycle: "tracker_only",
              }),
            ],
          },
        ],
      });
    });

    it("includes Manager Desk-linked items when previewing carry-forward work", async () => {
      await managerDeskService.createItem("manager-1", {
        date: "2026-03-06",
        title: "Shared task owned by Manager Desk",
        status: "planned",
        assigneeDeveloperAccountId: "dev-1",
      });
      await service.addItem("dev-1", "2026-03-06", {
        title: "Standalone tracker task",
      });

      const preview = await service.previewCarryForward(
        "2026-03-06",
        "2026-03-07"
      );

      expect(preview.carryable).toBe(2);
      expect(preview.developers).toEqual([
        {
          developer: expect.objectContaining({
            accountId: "dev-1",
            displayName: "Alice Smith",
          }),
          items: [
            expect.objectContaining({
              title: "Shared task owned by Manager Desk",
              lifecycle: "manager_desk_linked",
            }),
            expect.objectContaining({
              title: "Standalone tracker task",
              lifecycle: "tracker_only",
            }),
          ],
        },
      ]);
    });

    it("carries unfinished items to the next day", async () => {
      await service.addItem("dev-1", "2026-03-06", {
        title: "Unfinished task",
      });
      const done = await service.addItem("dev-1", "2026-03-06", {
        title: "Finished task",
      });
      await service.updateItem(done.id, { state: "done" });

      const carried = await service.carryForward("2026-03-06", "2026-03-07");
      expect(carried).toBe(1);

      const board = await service.getBoard("2026-03-07");
      const devDay = board.developers.find(
        (d) => d.developer.accountId === "dev-1"
      )!;
      expect(devDay.plannedItems.some((i) => i.title === "Unfinished task")).toBe(true);
    });

    it("preserves related Jira keys when carrying tracker-only work forward", async () => {
      await seedIssue();
      await seedIssue({ jiraKey: "AM-456", summary: "Secondary context" });

      await service.addItem("dev-1", "2026-03-06", {
        jiraKey: "AM-123",
        relatedIssueKeys: ["AM-456"],
        title: "Unfinished related task",
      });

      const carried = await service.carryForward("2026-03-06", "2026-03-07");
      expect(carried).toBe(1);

      const board = await service.getBoard("2026-03-07");
      const devDay = board.developers.find(
        (d) => d.developer.accountId === "dev-1"
      )!;
      expect(devDay.plannedItems).toEqual([
        expect.objectContaining({
          title: "Unfinished related task",
          jiraKey: "AM-123",
          relatedIssueKeys: ["AM-456"],
        }),
      ]);
    });

    it("carries Manager Desk-linked items into the next day by rebasing their manager work", async () => {
      const sourceManagerItem = await managerDeskService.createItem("manager-1", {
        date: "2026-03-06",
        title: "Shared task owned by Manager Desk",
        status: "in_progress",
        assigneeDeveloperAccountId: "dev-1",
      });
      await service.addItem("dev-1", "2026-03-06", {
        title: "Standalone tracker task",
      });

      const carried = await service.carryForward("2026-03-06", "2026-03-07", {
        carryManagerDeskItems: (params) =>
          managerDeskService.carryForward("manager-1", params),
      });

      expect(carried).toBe(2);

      const board = await service.getBoard("2026-03-07");
      const devDay = board.developers.find(
        (d) => d.developer.accountId === "dev-1"
      )!;
      expect(devDay.plannedItems.map((item) => item.title)).toEqual([
        "Standalone tracker task",
        "Shared task owned by Manager Desk",
      ]);

      const carriedManagerItems = await db
        .select()
        .from(managerDeskItems)
        .where(eq(managerDeskItems.sourceItemId, sourceManagerItem.id));
      expect(carriedManagerItems).toHaveLength(0);

      const targetDeskDay = await managerDeskService.getDay("manager-1", "2026-03-07");
      expect(targetDeskDay.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: sourceManagerItem.id,
            title: "Shared task owned by Manager Desk",
          }),
        ])
      );

      const linkedItem = devDay.plannedItems.find(
        (item) => item.title === "Shared task owned by Manager Desk"
      );
      expect(linkedItem?.lifecycle).toBe("manager_desk_linked");
      expect(linkedItem?.managerDeskItemId).toBe(sourceManagerItem.id);
    });

    it("supports partial carry-forward selection by Team Tracker item id across mixed sources", async () => {
      const trackerOnly = await service.addItem("dev-1", "2026-03-06", {
        title: "Standalone tracker task",
      });
      const sourceManagerItem = await managerDeskService.createItem("manager-1", {
        date: "2026-03-06",
        title: "Shared task owned by Manager Desk",
        status: "planned",
        assigneeDeveloperAccountId: "dev-1",
      });
      const preview = await service.previewCarryForward("2026-03-06", "2026-03-07");
      const linkedPreviewItem = preview.developers[0]?.items.find(
        (item) => item.managerDeskItemId === sourceManagerItem.id
      );

      const carried = await service.carryForward("2026-03-06", "2026-03-07", {
        itemIds: [trackerOnly.id, linkedPreviewItem!.id],
        carryManagerDeskItems: (params) =>
          managerDeskService.carryForward("manager-1", params),
      });

      expect(carried).toBe(2);

      const board = await service.getBoard("2026-03-07");
      const devDay = board.developers.find(
        (d) => d.developer.accountId === "dev-1"
      )!;
      expect(devDay.plannedItems.map((item) => item.title)).toEqual([
        "Standalone tracker task",
        "Shared task owned by Manager Desk",
      ]);

      const carriedManagerItems = await db
        .select()
        .from(managerDeskItems)
        .where(eq(managerDeskItems.sourceItemId, sourceManagerItem.id));
      expect(carriedManagerItems).toHaveLength(0);

      const linkedItem = devDay.plannedItems.find(
        (item) => item.title === "Shared task owned by Manager Desk"
      );
      expect(linkedItem?.managerDeskItemId).toBe(sourceManagerItem.id);
    });

    it("rejects duplicate carry-forward selection ids", async () => {
      const item = await service.addItem("dev-1", "2026-03-06", {
        title: "Standalone tracker task",
      });

      await expect(
        service.carryForward("2026-03-06", "2026-03-07", {
          itemIds: [item.id, item.id],
        })
      ).rejects.toThrow("itemIds must not contain duplicates");
    });

    it("rejects unknown carry-forward selection ids for the source date", async () => {
      await service.addItem("dev-1", "2026-03-06", {
        title: "Standalone tracker task",
      });

      await expect(
        service.carryForward("2026-03-06", "2026-03-07", {
          itemIds: [999999],
        })
      ).rejects.toThrow(
        "One or more Team Tracker items were not found for the source date"
      );
    });

    it("skips selected items that are already represented on the target day", async () => {
      const item = await service.addItem("dev-1", "2026-03-06", {
        title: "Already carried",
      });
      await service.addItem("dev-1", "2026-03-07", {
        title: "Already carried",
      });

      const carried = await service.carryForward("2026-03-06", "2026-03-07", {
        itemIds: [item.id],
      });

      expect(carried).toBe(0);
    });

    it("skips mixed-source items already present on the target day and is safe to retry", async () => {
      await seedIssue();

      await service.addItem("dev-1", "2026-03-06", {
        title: "Already carried",
      });
      await managerDeskService.createItem("manager-1", {
        date: "2026-03-06",
        title: "Shared follow-up",
        status: "planned",
        assigneeDeveloperAccountId: "dev-1",
      });
      const inProgress = await service.addItem("dev-1", "2026-03-06", {
        jiraKey: "AM-123",
        title: "Needs follow-up",
      });
      await service.setCurrentItem(inProgress.id);

      await service.addItem("dev-1", "2026-03-07", {
        title: "Already carried",
      });
      await service.addItem("dev-1", "2026-03-07", {
        title: "Shared follow-up",
      });

      const first = await service.carryForward("2026-03-06", "2026-03-07", {
        carryManagerDeskItems: (params) =>
          managerDeskService.carryForward("manager-1", params),
      });
      const second = await service.carryForward("2026-03-06", "2026-03-07", {
        carryManagerDeskItems: (params) =>
          managerDeskService.carryForward("manager-1", params),
      });

      expect(first).toBe(1);
      expect(second).toBe(0);

      const board = await service.getBoard("2026-03-07");
      const devDay = board.developers.find(
        (d) => d.developer.accountId === "dev-1"
      )!;
      const plannedTitles = devDay.plannedItems.map((item) => item.title);
      expect(plannedTitles.filter((title) => title === "Already carried")).toHaveLength(1);
      expect(plannedTitles.filter((title) => title === "Shared follow-up")).toHaveLength(2);
      expect(devDay.currentItem?.title).toBe("Needs follow-up");

      expect(
        devDay.plannedItems
          .filter((item) => item.title === "Shared follow-up")
          .map((item) => item.lifecycle)
          .sort()
      ).toEqual(["manager_desk_linked", "tracker_only"]);
    });

    it("moves the tracker row forward preserving id, state, and note", async () => {
      vi.setSystemTime(new Date("2026-03-06T09:00:00.000Z"));
      const inFlight = await service.addItem("dev-1", "2026-03-06", {
        title: "In-flight task",
        note: "Waiting on the upstream fix.",
      });
      await service.setCurrentItem(inFlight.id);

      vi.setSystemTime(new Date("2026-03-07T08:00:00.000Z"));
      const carried = await service.carryForward("2026-03-06", "2026-03-07");
      expect(carried).toBe(1);

      const rows = await db
        .select()
        .from(teamTrackerItems)
        .where(eq(teamTrackerItems.id, inFlight.id));
      const targetDay = await db
        .select()
        .from(teamTrackerDays)
        .where(eq(teamTrackerDays.id, rows[0]!.dayId));
      expect(targetDay[0]?.date).toBe("2026-03-07");
      expect(rows[0]?.state).toBe("in_progress");
      expect(rows[0]?.note).toBe("Waiting on the upstream fix.");

      const board = await service.getBoard("2026-03-07");
      const devDay = board.developers.find(
        (d) => d.developer.accountId === "dev-1"
      )!;
      expect(devDay.currentItem?.id).toBe(inFlight.id);
      expect(devDay.currentItem?.originDate).toBe("2026-03-06");
    });

    it("does not duplicate work when the carried item's note was edited", async () => {
      await service.addItem("dev-1", "2026-03-06", {
        title: "Ongoing task",
        note: "first pass",
      });
      await service.addItem("dev-1", "2026-03-07", {
        title: "Ongoing task",
        note: "edited context",
      });

      const carried = await service.carryForward("2026-03-06", "2026-03-07");

      expect(carried).toBe(0);
    });

    it("emits a schedule event with via 'carry_forward' for each moved keyed row", async () => {
      await enableTaskKeys();
      const item = await service.addItem("dev-1", "2026-03-06", {
        title: "Keyed carry candidate",
      });
      expect(item.taskKey).toMatch(/^T-\d+$/);

      const carried = await service.carryForward("2026-03-06", "2026-03-07");
      expect(carried).toBe(1);

      const events = await eventsService.list(item.taskKey!, managerViewer);
      const schedule = events.events.find((event) => event.type === "schedule");
      expect(schedule).toBeDefined();
      expect(schedule?.meta).toMatchObject({
        field: "day",
        from: "2026-03-06",
        to: "2026-03-07",
        via: "carry_forward",
      });
    });

    it("groups carried work by task key even when the target row was renamed", async () => {
      await enableTaskKeys();
      const item = await service.addItem("dev-1", "2026-03-06", {
        title: "Original title",
        note: "ctx",
      });
      const targetDay = await service.ensureDay("2026-03-07", "dev-1");
      await db.insert(teamTrackerItems).values({
        workspaceId: "default",
        dayId: targetDay.id,
        taskKey: item.taskKey,
        itemType: "custom",
        title: "Renamed title",
        note: null,
        state: "planned",
        position: 0,
        createdAt: "2026-03-07T08:00:00.000Z",
        updatedAt: "2026-03-07T08:00:00.000Z",
      });

      const carried = await service.carryForward("2026-03-06", "2026-03-07");

      expect(carried).toBe(0);
    });

    it("carries distinct keyed tasks even when titles match the target day", async () => {
      await enableTaskKeys();
      await service.addItem("dev-1", "2026-03-06", { title: "Same title" });
      await service.addItem("dev-1", "2026-03-06", { title: "Same title" });
      await service.addItem("dev-1", "2026-03-07", { title: "Same title" });

      const carried = await service.carryForward("2026-03-06", "2026-03-07");

      expect(carried).toBe(2);
      const board = await service.getBoard("2026-03-07");
      const devDay = board.developers.find(
        (d) => d.developer.accountId === "dev-1"
      )!;
      expect(
        devDay.plannedItems.filter((item) => item.title === "Same title")
      ).toHaveLength(3);
    });
  });

  describe("reassignItem", () => {
    it("emits assign, schedule, and status events when moving an in-progress task", async () => {
      await enableTaskKeys();
      const item = await service.addItem("dev-1", "2026-03-07", {
        title: "In-flight reassignment",
      });
      await service.setCurrentItem(item.id);

      const updated = await service.reassignItem(
        item.id,
        "dev-2",
        "2026-03-08",
        randomUUID()
      );
      expect(updated.id).toBe(item.id);
      expect(updated.taskKey).toBe(item.taskKey);
      expect(updated.state).toBe("planned");

      const events = await eventsService.list(item.taskKey!, managerViewer);
      const assign = events.events.find((event) => event.type === "assign");
      expect(assign?.meta).toMatchObject({
        fromType: "developer",
        fromId: "dev-1",
        toType: "developer",
        toId: "dev-2",
        stateReset: { from: "in_progress", to: "planned" },
      });
      const schedule = events.events.find((event) => event.type === "schedule");
      expect(schedule?.meta).toMatchObject({
        field: "day",
        from: "2026-03-07",
        to: "2026-03-08",
        via: "reassign",
      });
      const status = events.events.find((event) => event.type === "status");
      expect(status?.meta).toMatchObject({
        domain: "tracker_state",
        from: "in_progress",
        to: "planned",
        reason: "reassigned",
      });
    });

    it("replays by requestId without duplicating events", async () => {
      await enableTaskKeys();
      const item = await service.addItem("dev-1", "2026-03-07", {
        title: "Idempotent reassign",
      });
      const requestId = randomUUID();

      await service.reassignItem(item.id, "dev-2", "2026-03-08", requestId);
      const replayed = await service.reassignItem(item.id, "dev-2", "2026-03-08", requestId);
      expect(replayed.id).toBe(item.id);

      const events = await eventsService.list(item.taskKey!, managerViewer);
      expect(
        events.events.filter((event) => event.type === "assign")
      ).toHaveLength(1);
    });
  });

  describe("getIssueAssignments", () => {
    it("returns the active linked tasks for a Jira issue on a given date", async () => {
      await seedIssue();
      const firstItem = await service.addItem("dev-1", "2026-03-07", {
        jiraKey: "AM-123",
        title: "Reproduce the customer report",
      });
      const secondItem = await service.addItem("dev-1", "2026-03-07", {
        jiraKey: "AM-123",
        title: "Patch the validation path",
      });

      const assignments = await service.getIssueAssignments("AM-123", "2026-03-07");

      expect(assignments).toEqual([
        {
          date: "2026-03-07",
          jiraKey: "AM-123",
          itemId: firstItem.id,
          title: "Reproduce the customer report",
          state: "planned",
          developer: {
            accountId: "dev-1",
            displayName: "Alice Smith",
            email: undefined,
            avatarUrl: undefined,
            isActive: true,
          },
        },
        {
          date: "2026-03-07",
          jiraKey: "AM-123",
          itemId: secondItem.id,
          title: "Patch the validation path",
          state: "planned",
          developer: {
            accountId: "dev-1",
            displayName: "Alice Smith",
            email: undefined,
            avatarUrl: undefined,
            isActive: true,
          },
        },
      ]);
    });

    it("omits completed tasks from the active linked task list", async () => {
      await seedIssue();
      const item = await service.addItem("dev-1", "2026-03-07", {
        jiraKey: "AM-123",
        title: "Linked Jira task",
      });
      await service.updateItem(item.id, { state: "done" });

      const assignments = await service.getIssueAssignments("AM-123", "2026-03-07");

      expect(assignments).toEqual([]);
    });
  });

  describe("stale detection", () => {
    it("marks developer as stale when no check-in", async () => {
      const board = await service.getBoard("2026-03-07");
      const devDay = board.developers.find(
        (d) => d.developer.accountId === "dev-1"
      )!;
      expect(devDay.isStale).toBe(true);
    });

    it("marks developer as not stale after recent check-in", async () => {
      await service.addCheckIn("dev-1", "2026-03-07", {
        summary: "All good",
      });
      const board = await service.getBoard("2026-03-07");
      const devDay = board.developers.find(
        (d) => d.developer.accountId === "dev-1"
      )!;
      expect(devDay.isStale).toBe(false);
    });
  });

  describe("summary computation", () => {
    it("computes correct summary counts", async () => {
      await service.updateDay("dev-1", "2026-03-07", { status: "blocked" });
      await service.updateDay("dev-2", "2026-03-07", { status: "at_risk" });

      const board = await service.getBoard("2026-03-07");
      expect(board.summary.blocked).toBe(1);
      expect(board.summary.atRisk).toBe(1);
      expect(board.summary.noCurrent).toBe(2);
    });
  });
});
