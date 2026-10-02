import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { db, resetDatabase } from "./helpers/db";
import { issues, configTable, developers, oneOnOneAgendaItems, oneOnOneSeries } from "../src/db/schema";
import { WeeklyReviewService } from "../src/services/weekly-review.service";
import { SettingsService } from "../src/services/settings.service";
import { TaskService } from "../src/services/task.service";
import { TaskViewsService } from "../src/services/task-views.service";
import { SyncEngine } from "../src/sync/engine";
import type { JiraIssue } from "../src/jira/types";
import { eq } from "drizzle-orm";

const principal = { type: "manager" as const, accountId: "lead", workspaceId: "default" };
const now = "2026-10-02T12:00:00.000Z";
beforeEach(async () => { await resetDatabase(); vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(now)); await db.insert(configTable).values([{ key: "tasks_phase1_enabled", value: "true" }, { key: "tasks_phase3_enabled", value: "true" }, { key: "tasks_phase2_stage", value: "2c" }]); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
function settings(connected = true) {
  const service = new SettingsService();
  vi.spyOn(service, "isJiraConfigured").mockResolvedValue(connected);
  vi.spyOn(service, "getJiraSyncScopeMode").mockResolvedValue("team_assignees");
  return service;
}
async function issue(key: string, extra: Partial<typeof issues.$inferInsert> = {}) {
  await db.insert(issues).values({ jiraKey: key, summary: key, priorityName: "High", priorityId: "1", statusName: "Open", statusCategory: "new", createdAt: "2026-09-28T09:00:00Z", updatedAt: now, syncedAt: now, ...extra });
}
describe("weekly review report projection", () => {
  it("omits disconnected Jira and retains unknown resolution history", async () => {
    await issue("OLD-1", { statusCategory: "done" });
    expect((await new WeeklyReviewService(undefined, undefined, settings(false)).build(principal, { tz: "UTC" })).jira).toBeUndefined();
    const result = await new WeeklyReviewService(undefined, undefined, settings()).build(principal, { tz: "UTC" });
    expect(result.jira).toEqual({ status: "ready", resolved: null, opened: 1, topResolved: [], criticalOpen: [] });
  });
  it("uses manager-zone resolution dates and scope/exclusion boundaries with a three-highlight cap", async () => {
    for (let i = 1; i <= 5; i++) await issue(`DONE-${i}`, { statusCategory: "done", resolvedAt: "2026-09-27T23:30:00Z" });
    await issue("OPEN-1", { createdAt: "2026-09-25T09:00:00Z" });
    await issue("EXCLUDED-1", { excluded: 1 });
    await issue("SCOPE-1", { teamScopeState: "out_of_team" });
    await issue("MISSING-1", { syncScopeState: "missing" });
    await issue("OTHER-1", { workspaceId: "other" });
    const service = new WeeklyReviewService(undefined, undefined, settings());
    const result = await service.build(principal, { tz: "Asia/Kolkata" });
    expect(result.jira?.resolved).toBe(5); expect(result.jira?.opened).toBe(5);
    expect(result.jira?.topResolved).toHaveLength(3); expect(result.jira?.criticalOpen.map((row) => row.key)).toEqual(["OPEN-1"]);
    expect(result.jira?.criticalOpen[0]?.openDays).toBe(7);
    expect((await service.build(principal, { tz: "UTC" })).jira?.resolved).toBe(0);
  });
  it("reports a failed Jira source without fabricated ready totals", async () => {
    const config = settings(); vi.spyOn(config, "getJiraSyncScopeMode").mockRejectedValue(new Error("unavailable"));
    expect((await new WeeklyReviewService(undefined, undefined, config).build(principal, { tz: "UTC" })).jira?.status).toBe("unavailable");
  });
  it("includes fresh blocked tasks but excludes private agenda tasks from the review and flags them for CSV", async () => {
    await db.insert(developers).values({ accountId: "dev", displayName: "Priya" });
    const tasks = new TaskService();
    const visible = await tasks.create({ title: "Fresh blocker", status: "blocked", ownerType: "manager", ownerId: "lead", followUpAt: "2026-10-10T09:00:00Z" }, principal);
    const privateTask = await tasks.create({ title: "Private agenda", status: "blocked", ownerType: "manager", ownerId: "lead" }, principal);
    const privateAction = await tasks.create({ title: "Private session action", status: "done", ownerType: "manager", ownerId: "lead" }, principal);
    const [series] = await db.insert(oneOnOneSeries).values({ developerAccountId: "dev", cadence: "weekly", createdAt: now }).returning();
    await db.insert(oneOnOneAgendaItems).values([{ seriesId: series!.id, taskId: privateTask.id, position: 0, addedAt: now }, { seriesId: series!.id, taskId: privateAction.id, position: 1, addedAt: now }]);
    const review = await new WeeklyReviewService(undefined, undefined, settings(false)).build(principal, { tz: "UTC" });
    const blocked = review.sections.find((section) => section.id === "blocked");
    expect(blocked?.rows.map((row) => "taskKey" in row && row.taskKey)).toEqual([visible.taskKey]);
    expect(JSON.stringify(review)).not.toMatch(/Private agenda|Private session action/);
    const rows = await new TaskViewsService().run(principal, { filters: { status: ["blocked", "done"], withClosed: { from: "2026-09-28", to: "2026-10-04" } } }, "2026-10-02");
    expect(rows.find((row) => row.id === privateTask.id)?.oneOnOne).toBe(true);
    expect(rows.find((row) => row.id === privateAction.id)?.oneOnOne).toBe(true);
    expect(rows.find((row) => row.id === visible.id)?.oneOnOne).toBeUndefined();
  });
});

describe("mocked Jira resolution sync", () => {
  it("requests resolutiondate, maps valid dates, observes Done fallbacks once and never backfills imports", async () => {
    const jiraIssue: JiraIssue = { id: "1", key: "TEST-1", fields: { summary: "Synthetic", status: { name: "Open", statusCategory: { key: "new" } }, created: "2026-09-01T09:00:00Z", updated: now } };
    const client = { getCurrentUser: vi.fn(async () => ({ accountId: "mock", displayName: "Mock" })), searchIssues: vi.fn(async () => [jiraIssue]) };
    const config = {
      getJiraBaseUrl: async () => "https://jira.invalid", getJiraEmail: async () => "mock@example.invalid", getJiraProjectKey: async () => "TEST", getJiraToken: async () => "mock-only", getJiraSyncJql: async () => "project = TEST", getJiraSyncScopeMode: async () => "base_query", getManagerJiraAccountId: async () => "", getJiraDevDueDateField: async () => undefined, getJiraAspenSeverityField: async () => undefined, createJiraClient: async () => client,
    };
    const engine = new SyncEngine(config as unknown as SettingsService);
    const sync = async () => { expect((await engine.syncNow()).status).toBe("success"); return (await db.select().from(issues).where(eq(issues.jiraKey, "TEST-1")))[0]!; };
    expect((await sync()).resolvedAt).toBeNull();
    expect(client.searchIssues).toHaveBeenCalledWith(expect.any(String), expect.arrayContaining(["resolutiondate"]));
    jiraIssue.fields.status = { name: "Done", statusCategory: { key: "done" } };
    expect((await sync()).resolvedAt).toBe(now);
    vi.setSystemTime(new Date("2026-10-03T12:00:00Z"));
    expect((await sync()).resolvedAt).toBe(now);
    jiraIssue.fields.resolutiondate = "2026-10-01T09:00:00+0530";
    expect((await sync()).resolvedAt).toBe("2026-10-01T03:30:00.000Z");
    jiraIssue.fields.resolutiondate = null;
    expect((await sync()).resolvedAt).toBe("2026-10-01T03:30:00.000Z");
    await db.delete(issues);
    expect((await sync()).resolvedAt).toBeNull();
  });
});
