import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db, resetDatabase } from "./helpers/db";
import { issues } from "../src/db/schema";
import { IssueService } from "../src/services/issue.service";
import { SettingsService } from "../src/services/settings.service";
import { eq } from "drizzle-orm";
const SOURCE_UPDATED = "2026-09-28T09:00:00Z";
const NOW = "2026-10-02T09:00:00.000Z";
const client = {
  updateIssue: vi.fn(),
  addComment: vi.fn(),
  getTransitions: vi.fn(),
  transitionIssue: vi.fn(),
  getIssue: vi.fn(),
};
let settings: SettingsService;
let service: IssueService;
beforeEach(async () => {
  await resetDatabase();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(NOW));
  vi.resetAllMocks();
  settings = new SettingsService();
  vi.spyOn(settings, "getJiraDevDueDateField").mockResolvedValue("");
  client.updateIssue.mockResolvedValue(undefined);
  client.transitionIssue.mockResolvedValue(undefined);
  client.getIssue.mockResolvedValue({
    key: "AB2_ENG-1",
    id: "1",
    fields: { status: { name: "Open", statusCategory: { key: "new" } }, updated: SOURCE_UPDATED },
  });
  client.getTransitions.mockResolvedValue([
    {
      id: "21",
      name: "Start",
      to: { name: "In Progress", statusCategory: { key: "indeterminate" } },
      hasScreen: false,
    },
  ]);
  service = new IssueService(client, settings);
  for (const key of ["AB2_ENG-1", "AB2_ENG-2"])
    await db
      .insert(issues)
      .values({
        jiraKey: key,
        summary: "Synthetic",
        priorityName: "High",
        priorityId: "1",
        statusName: "Open",
        statusCategory: "new",
        assigneeId: "dev",
        assigneeName: "Priya",
        dueDate: "2026-10-01",
        developmentDueDate: "2026-10-01",
        createdAt: SOURCE_UPDATED,
        updatedAt: SOURCE_UPDATED,
        syncedAt: SOURCE_UPDATED,
      });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
describe("Jira execution reliability", () => {
  it("unassigns and clears dates with explicit null, using standard duedate when no custom field exists", async () => {
    const issue = await service.update("AB2_ENG-1", { assigneeId: null, developmentDueDate: null });
    expect(client.updateIssue).toHaveBeenCalledWith("AB2_ENG-1", { assignee: null, duedate: null });
    expect(issue.assigneeId).toBeUndefined();
    expect(issue.dueDate).toBeUndefined();
    expect(issue.developmentDueDate).toBeUndefined();
  });
  it("local notes and acknowledged field writes preserve the Jira source timestamp", async () => {
    const issue = await service.update("AB2_ENG-1", { analysisNotes: "Local note" });
    expect(client.updateIssue).not.toHaveBeenCalled();
    expect(issue.updatedAt).toBe(SOURCE_UPDATED);
    expect(issue.localUpdatedAt).toBe(NOW);
    expect(issue.stale).toBe(true);
    await service.update("AB2_ENG-1", { dueDate: "2026-10-03" });
    expect((await service.getById("AB2_ENG-1"))?.updatedAt).toBe(SOURCE_UPDATED);
  });
  it("does not update local issue values when Jira rejects the write", async () => {
    client.updateIssue.mockRejectedValue(new Error("Jira denied"));
    await expect(service.update("AB2_ENG-1", { assigneeId: null })).rejects.toThrow();
    const row = (await db.select().from(issues).where(eq(issues.jiraKey, "AB2_ENG-1")))[0]!;
    expect(row.assigneeId).toBe("dev");
    expect(row.updatedAt).toBe(SOURCE_UPDATED);
  });
  it("persists exclusions/snoozes, hides them from Work/Today and restores without resetting Jira freshness", async () => {
    await service.snoozeIssue("AB2_ENG-1", "2026-10-03T00:00:00.000Z");
    await service.excludeIssue("AB2_ENG-2");
    expect(await service.getAll()).toHaveLength(0);
    expect((await service.getTodaySnapshot("2026-10-02")).issues).toHaveLength(0);
    expect((await service.getAll({ filter: "excluded" })).map((issue) => issue.jiraKey).sort()).toEqual([
      "AB2_ENG-1",
      "AB2_ENG-2",
    ]);
    await service.restoreIssue("AB2_ENG-2");
    expect((await service.getAll()).map((issue) => issue.jiraKey)).toEqual(["AB2_ENG-2"]);
    vi.setSystemTime(new Date("2026-10-03T01:00:00Z"));
    expect(await service.getAll()).toHaveLength(2);
    expect((await service.getById("AB2_ENG-2"))?.updatedAt).toBe(SOURCE_UPDATED);
  });
  it("rejects form-required or stale transitions before posting to Jira", async () => {
    client.getTransitions.mockResolvedValue([
      { id: "31", name: "Resolve", hasScreen: true, to: { name: "Done", statusCategory: { key: "done" } } },
    ]);
    await expect(service.transition("AB2_ENG-1", "31", { name: "Open", category: "new" })).rejects.toThrow();
    expect(client.transitionIssue).not.toHaveBeenCalled();
    client.getIssue.mockResolvedValue({ fields: { status: { name: "Done", statusCategory: { key: "done" } } } });
    await expect(service.transition("AB2_ENG-1", "21", { name: "Open", category: "new" })).rejects.toThrow();
    expect(client.transitionIssue).not.toHaveBeenCalled();
  });
  it("returns per-item bulk results and accepts a retry containing only failed items", async () => {
    client.updateIssue.mockImplementation(async (key: string) => {
      if (key === "AB2_ENG-2") throw new Error("Rejected");
    });
    const action = { kind: "update" as const, update: { flagged: true } };
    const result = await service.bulk([
      { key: "AB2_ENG-1", operation: action },
      { key: "AB2_ENG-2", operation: action },
    ]);
    expect(result.results.map((row) => row.ok)).toEqual([true, false]);
    client.updateIssue.mockResolvedValue(undefined);
    await service.bulk(result.results.filter((row) => !row.ok).map((row) => ({ key: row.key, operation: action })));
    expect(client.updateIssue.mock.calls.map((call) => call[0])).toEqual(["AB2_ENG-1", "AB2_ENG-2", "AB2_ENG-2"]);
  });
});

describe("transition safety and workspace boundaries", () => {
  it("mirrors an acknowledged transition even when the refresh fails, without replaying it", async () => {
    client.getIssue
      .mockResolvedValueOnce({
        fields: { status: { name: "Open", statusCategory: { key: "new" } }, updated: SOURCE_UPDATED },
      })
      .mockRejectedValueOnce(new Error("Refresh unavailable"));
    const result = await service.transition("AB2_ENG-1", "21", { name: "Open", category: "new" });
    expect(result.refreshPending).toBe(true);
    expect(result.issue.statusName).toBe("In Progress");
    expect(result.issue.updatedAt).toBe(SOURCE_UPDATED);
    client.getIssue.mockResolvedValue({
      fields: { status: { name: "In Progress", statusCategory: { key: "indeterminate" } } },
    });
    await expect(service.transition("AB2_ENG-1", "21", { name: "Open", category: "new" })).rejects.toMatchObject({
      status: 409,
    });
    expect(client.transitionIssue).toHaveBeenCalledTimes(1);
  });
  it("refuses ambiguous category transitions and required fields, and keeps failures safe", async () => {
    const start = {
      id: "21",
      name: "Start",
      hasScreen: false,
      to: { name: "In Progress", statusCategory: { key: "indeterminate" } },
    };
    client.getTransitions.mockResolvedValue([start, { ...start, id: "22", name: "Start alternatively" }]);
    const result = await service.bulk([
      {
        key: "AB2_ENG-1",
        operation: {
          kind: "transitionTo",
          category: "indeterminate",
          expectedStatus: { name: "Open", category: "new" },
        },
      },
    ]);
    expect(result.results[0]).toMatchObject({ ok: false, status: 409 });
    expect(client.transitionIssue).not.toHaveBeenCalled();
    client.getTransitions.mockResolvedValue([{ ...start, fields: { resolution: { required: true } } }]);
    expect((await service.getTransitions("AB2_ENG-1")).transitions[0]?.supported).toBe(false);
    client.getTransitions.mockResolvedValue([start]);
    client.transitionIssue.mockRejectedValue(new Error("secret raw provider body"));
    await expect(service.transition("AB2_ENG-1", "21", { name: "Open", category: "new" })).rejects.toThrow(
      "didn't acknowledge",
    );
    expect((await service.getById("AB2_ENG-1"))?.statusName).toBe("Open");
  });
  it("does not contact Jira for another workspace, and bounds bulk requests", async () => {
    await expect(service.getTransitions("AB2_ENG-1", "other")).rejects.toMatchObject({ status: 404 });
    expect(client.getIssue).not.toHaveBeenCalled();
    const item = { key: "AB2_ENG-1", operation: { kind: "restore" as const } };
    await expect(service.bulk(Array.from({ length: 21 }, () => item))).rejects.toMatchObject({ status: 400 });
    await expect(service.bulk([item, item])).rejects.toMatchObject({ status: 400 });
  });
  it("honors an explicitly configured custom date field", async () => {
    vi.mocked(settings.getJiraDevDueDateField).mockResolvedValue("customfield_123");
    const result = await service.update("AB2_ENG-1", { developmentDueDate: null });
    expect(client.updateIssue).toHaveBeenCalledWith("AB2_ENG-1", { customfield_123: null });
    expect(result.dueDate).toBe("2026-10-01");
    expect(result.developmentDueDate).toBeUndefined();
  });
});

describe("date field configuration", () => {
  it("keeps persisted blanks blank and preserves explicit custom fields", async () => {
    vi.mocked(settings.getJiraDevDueDateField).mockRestore();
    vi.spyOn(settings, "getConfigValue").mockResolvedValueOnce("").mockResolvedValueOnce("customfield_987");
    expect(await settings.getJiraDevDueDateField()).toBe("");
    expect(await settings.getJiraDevDueDateField()).toBe("customfield_987");
  });
});
