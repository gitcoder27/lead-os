import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db, resetDatabase } from "./helpers/db";
import { configTable, developers, issues, taskEvents, tasks } from "../src/db/schema";
import { IssueService } from "../src/services/issue.service";
import { ManagerDeskService } from "../src/services/manager-desk.service";
import { TaskService } from "../src/services/task.service";
import { TeamTrackerService } from "../src/services/team-tracker.service";
import { TodayService } from "../src/services/today.service";
import type { ManagerActionCommandRequest } from "shared/types";

/** docs/57 §3 (P3-05): Today's follow-ups and meeting next actions are tasks made through capture once Phase 3 is on. */
const trackerService = new TeamTrackerService();
const managerDeskService = new ManagerDeskService(trackerService);
const issueService = new IssueService(undefined, undefined, trackerService);
const manager = { type: "manager" as const, accountId: "manager-1" };
const principal = { ...manager, workspaceId: undefined };
const taskService = new TaskService();

function todayService() {
  return new TodayService(issueService, trackerService, managerDeskService, {
    getLastSyncLog: async () => undefined,
    getRuntimeStatus: () => ({ status: "idle" as const }),
  }, { todayCacheTtlMs: 0 });
}

const command = (request: Omit<ManagerActionCommandRequest, "date"> & { date?: string }): ManagerActionCommandRequest => ({ date: "2026-03-08", tz: "Asia/Kolkata", ...request });
const followUpCommand = (title: string, target: Record<string, unknown> = { type: "view", view: "team" }, preset?: "later_today" | "tomorrow" | "next_week") =>
  command({ title, ...(preset ? { preset } : {}), command: { kind: "capture_follow_up", label: "Follow up", target: target as never } });

async function seedIssue(jiraKey: string) {
  await db.insert(issues).values({
    jiraKey, summary: `Issue ${jiraKey}`, priorityName: "Medium", priorityId: "3", statusName: "In Progress", statusCategory: "indeterminate",
    assigneeId: "dev-1", assigneeName: "Alice Smith", teamScopeState: "in_team", syncScopeState: "active", reporterName: null, component: null,
    labels: JSON.stringify([]), dueDate: null, developmentDueDate: null, flagged: 0, createdAt: "2026-03-01T08:00:00.000Z", updatedAt: "2026-03-01T08:00:00.000Z",
    syncedAt: "2026-03-01T08:00:00.000Z", lastSeenInScopedSyncAt: "2026-03-01T08:00:00.000Z", lastReconciledAt: "2026-03-01T08:00:00.000Z", scopeChangedAt: null, analysisNotes: null, excluded: 0,
  });
}

async function taskByKey(key: string) {
  return (await db.select().from(tasks).where(eq(tasks.taskKey, key)))[0]!;
}

describe("Today follow-ups through capture (P3-05)", () => {
  beforeEach(async () => {
    // Only the clock is faked (a faked setImmediate stalls anything that awaits I/O).
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-03-08T04:00:00.000Z"));
    await resetDatabase();
    await db.insert(configTable).values([
      { key: "tasks_phase1_enabled", value: "true" },
      { key: "tasks_phase2_stage", value: "2c" },
      { key: "tasks_phase3_enabled", value: "true" },
    ]);
    await db.insert(developers).values({ accountId: "dev-1", displayName: "Alice Smith", email: "a@example.com", avatarUrl: null, isActive: 1 });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("creates a follow-up task with the developer and issue linked, and undo deletes it", async () => {
    await seedIssue("PROJ-7");
    const service = todayService();
    const response = await service.executeCommand("manager-1", followUpCommand("Check in on the rollout", {
      type: "developer", view: "team", developerAccountId: "dev-1", taskKey: "T-99", context: { issueKey: "PROJ-7" },
    }, "tomorrow"), manager);

    const created = response.result as { taskKey: string; labels: string[]; followUpAt: string; scheduledOn: string; ownerType: string; links: { kind: string; ref: string }[]; needsTriage: boolean };
    expect(created).toMatchObject({ labels: ["category:follow_up"], followUpAt: "2026-03-09T03:30:00.000Z", scheduledOn: "2026-03-08", ownerType: "manager", needsTriage: false });
    expect(created.links.map((link) => `${link.kind}:${link.ref}`).sort()).toEqual(["jira:PROJ-7", "person:dev-1"]);
    // The context note is the task's first (private) update.
    const notes = await db.select().from(taskEvents).where(eq(taskEvents.taskKey, created.taskKey));
    expect(notes.find((event) => event.type === "update")).toMatchObject({ body: "Follow-up for T-99", visibility: "private" });
    expect(response.undo?.request.restore).toEqual({ type: "delete_task", taskKey: created.taskKey });

    await service.executeCommand("manager-1", response.undo!.request, manager);
    expect((await taskByKey(created.taskKey)).deletedAt).not.toBeNull();
  });

  it("uses the follow-up time of the preset, not just the day", async () => {
    const response = await todayService().executeCommand("manager-1", followUpCommand("Later today", undefined, "later_today"), manager);
    const created = response.result as { followUpAt: string };
    const later = Date.parse(created.followUpAt);
    expect(later).toBeGreaterThan(Date.parse("2026-03-08T04:00:00.000Z"));
    expect(later).toBeLessThan(Date.parse("2026-03-09T00:00:00.000Z"));
  });

  it("runs the title through the shared grammar", async () => {
    const response = await todayService().executeCommand("manager-1", followUpCommand("Chase the vendor +vendors"), manager);
    const created = response.result as { title: string; labels: string[] };
    expect(created.title).toBe("Chase the vendor");
    expect([...created.labels].sort()).toEqual(["category:follow_up", "vendors"]);
  });

  it("resolves typed dates on the manager's day and zone, not the server's (docs/63 #4)", async () => {
    // 20:00Z on the 8th is already the 9th in Kolkata (the dev machine's zone) but still the 8th in Honolulu.
    vi.setSystemTime(new Date("2026-03-08T20:00:00.000Z"));
    const response = await todayService().executeCommand("manager-1", command({
      date: "2026-03-08",
      tz: "Pacific/Honolulu",
      title: "Chase the vendor !due:tomorrow",
      command: { kind: "capture_follow_up", label: "Follow up", target: { type: "view", view: "team" } },
    }), manager);
    // "tomorrow" is the 9th for the manager, so the deadline is the end of the 9th in Honolulu (UTC-10).
    expect((response.result as { dueAt: string }).dueAt).toBe("2026-03-10T09:59:59.999Z");
  });

  it("rejects a title the grammar can't resolve, and creates nothing", async () => {
    await expect(todayService().executeCommand("manager-1", followUpCommand("Ask @ghost about it"), manager))
      .rejects.toMatchObject({ status: 400, message: expect.stringContaining("ghost") });
    expect(await db.select().from(tasks)).toHaveLength(0);
  });

  it("undo of a task that is already gone is harmless", async () => {
    const service = todayService();
    const response = await service.executeCommand("manager-1", followUpCommand("Short lived"), manager);
    const key = (response.result as { taskKey: string }).taskKey;
    await service.executeCommand("manager-1", response.undo!.request, manager);
    await expect(service.executeCommand("manager-1", response.undo!.request, manager)).resolves.toBeDefined();
    expect((await taskByKey(key)).deletedAt).not.toBeNull();
  });

  it("undo refuses another manager's task", async () => {
    const other = await taskService.create({ title: "Not yours" }, { type: "manager", accountId: "manager-2" });
    await expect(todayService().executeCommand("manager-1", command({
      command: { kind: "restore", label: "Undo", target: { type: "view", view: "team" } },
      restore: { type: "delete_task", taskKey: other.taskKey },
    }), manager)).rejects.toMatchObject({ status: 404 });
    expect((await taskByKey(other.taskKey)).deletedAt).toBeNull();
  });

  describe("meeting outcome → next action", () => {
    async function meeting() {
      return taskService.create({ title: "Migration review", kind: "meeting", scheduledOn: "2026-03-08" }, principal);
    }
    const outcome = (taskKey: string, extra: Record<string, unknown> = {}) => command({
      outcome: "Go for Friday",
      nextAction: "Draft the rollback plan",
      nextActionOwnerAccountId: "dev-1",
      ...extra,
      command: { kind: "capture_meeting_outcome", label: "Outcome", target: { type: "meeting", view: "meetings", taskKey } },
    });

    it("makes the next action a child follow-up, and undo removes it and restores the meeting", async () => {
      const row = await meeting();
      const service = todayService();
      const response = await service.executeCommand("manager-1", outcome(row.taskKey), manager);
      expect(response.undo?.request.restore).toMatchObject({ type: "task", taskKey: row.taskKey, patch: { outcome: null }, alsoDeleteTaskKey: expect.stringMatching(/^T-\d+$/) });

      const nextKey = (response.undo!.request.restore as { alsoDeleteTaskKey: string }).alsoDeleteTaskKey;
      const next = await taskByKey(nextKey);
      expect(next).toMatchObject({ title: "Draft the rollback plan", parentId: row.id, followUpAt: "2026-03-09T03:30:00.000Z" });
      expect(JSON.parse(next.labelsJson ?? "[]")).toContain("category:follow_up");
      expect((await taskByKey(row.taskKey)).outcome).toBe("Go for Friday");

      await service.executeCommand("manager-1", response.undo!.request, manager);
      expect((await taskByKey(nextKey)).deletedAt).not.toBeNull();
      expect((await taskByKey(row.taskKey)).outcome).toBeNull();
    });

    it("makes no follow-up without a next action", async () => {
      const row = await meeting();
      const response = await todayService().executeCommand("manager-1", outcome(row.taskKey, { nextAction: undefined }), manager);
      expect((response.undo!.request.restore as { alsoDeleteTaskKey?: string }).alsoDeleteTaskKey).toBeUndefined();
      expect(await db.select().from(tasks)).toHaveLength(1);
    });
  });
});
