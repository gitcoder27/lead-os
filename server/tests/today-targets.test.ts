import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db, resetDatabase } from "./helpers/db";
import { configTable } from "../src/db/schema";
import { IssueService } from "../src/services/issue.service";
import { ManagerDeskService } from "../src/services/manager-desk.service";
import { TaskService } from "../src/services/task.service";
import { TeamTrackerService } from "../src/services/team-tracker.service";
import { TodayService } from "../src/services/today.service";

/** docs/57 §5 (P3-06): Today's follow-up and meeting rows open the Tasks views, not the retired pages. */
const trackerService = new TeamTrackerService();
const managerDeskService = new ManagerDeskService(trackerService);
const issueService = new IssueService(undefined, undefined, trackerService);
const taskService = new TaskService();
const principal = { type: "manager" as const, accountId: "manager-1" };

const service = () => new TodayService(issueService, trackerService, managerDeskService, {
  getLastSyncLog: async () => undefined,
  getRuntimeStatus: () => ({ status: "idle" as const }),
}, { todayCacheTtlMs: 0 });

describe("Today targets for follow-ups and meetings", () => {
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-03-08T04:00:00.000Z"));
    await resetDatabase();
    await db.insert(configTable).values([
      { key: "tasks_phase1_enabled", value: "true" },
      { key: "tasks_phase2_stage", value: "2c" },
      { key: "tasks_phase3_enabled", value: "true" },
    ]);
  });
  afterEach(() => vi.useRealTimers());

  it("a due follow-up opens its own task; nothing claims it is in Waiting, which excludes follow-ups I owe myself (docs/63 #4)", async () => {
    const task = await taskService.create({ title: "Chase QA", scheduledOn: "2026-03-07", followUpAt: "2026-03-07T03:30:00.000Z", labels: ["category:follow_up"] }, principal);
    const today = await service().getToday("manager-1", "2026-03-08", undefined, { tz: "UTC" });

    const row = today.actionItems.find((item) => item.type === "follow_up_due")!;
    expect(row.target).toMatchObject({ type: "follow_up", view: "tasks", taskKey: task.taskKey });
    expect(row.target.taskView).toBeUndefined();
    expect(today.promises[0]!.target).toMatchObject({ view: "tasks", taskKey: task.taskKey });
    expect(today.promises[0]!.target.taskView).toBeUndefined();
    // The count covers follow-ups the Waiting lens would not list, so it names no list: a click focuses the queue.
    const metric = today.summary.find((entry) => entry.id === "promises")!;
    expect(metric.value).toBe(1);
    expect(metric.target).toBeUndefined();
    expect(JSON.stringify(today)).not.toContain('"view":"follow-ups"');
  });

  it("a meeting that needs an outcome opens the Meetings view", async () => {
    const meeting = await taskService.create({ title: "Design review", kind: "meeting", scheduledOn: "2026-03-08" }, principal);
    const today = await service().getToday("manager-1", "2026-03-08", undefined, { tz: "UTC" });

    const row = today.actionItems.find((item) => item.type === "meeting_outcome")!;
    expect(row.target).toMatchObject({ type: "meeting", view: "tasks", taskView: "meetings", taskKey: meeting.taskKey });
    expect(today.meetingPrompts[0]!.target).toMatchObject({ view: "tasks", taskView: "meetings" });
    expect(JSON.stringify(today)).not.toContain('"view":"meetings"');
  });
});
