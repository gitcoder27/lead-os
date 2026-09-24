import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db, resetDatabase } from "./helpers/db";
import { developers, issues } from "../src/db/schema";
import { HttpError } from "../src/middleware/errorHandler";
import { AlertService } from "../src/services/alert.service";
import { AutomationService } from "../src/services/automation.service";
import { DailyNotesService } from "../src/services/daily-notes.service";
import { IssueService } from "../src/services/issue.service";
import { ManagerDeskService } from "../src/services/manager-desk.service";
import { SearchService } from "../src/services/search.service";
import { SettingsService } from "../src/services/settings.service";
import { TagService } from "../src/services/tag.service";
import { TeamTrackerService } from "../src/services/team-tracker.service";
import { TodayService } from "../src/services/today.service";
import { WorkSavedViewsService } from "../src/services/work-saved-views.service";
import { WorkloadService } from "../src/services/workload.service";
import {
  createAssistantTools,
  type AssistantServices,
  type AssistantToolContext,
} from "../src/assistant/tools";

const WORKSPACE_ID = "default";
const MANAGER_ID = "manager-1";
const DATE = "2026-03-07";

const jiraStub = {
  updateIssue: vi.fn(async () => undefined),
  addComment: vi.fn(async () => undefined),
};

const settingsService = new SettingsService();
const teamTrackerService = new TeamTrackerService();
const managerDeskService = new ManagerDeskService(teamTrackerService);
const issueService = new IssueService(jiraStub, settingsService, teamTrackerService);
const workloadService = new WorkloadService();
const alertService = new AlertService(workloadService, settingsService);
const dailyNotesService = new DailyNotesService(managerDeskService);
const searchService = new SearchService(settingsService, dailyNotesService);
const syncEngine = {
  getRuntimeStatus: vi.fn(() => ({ status: "idle" as const })),
  getLastSyncLog: vi.fn(async () => undefined),
  isAutoSyncEnabled: vi.fn(async () => true),
  syncNow: vi.fn(async () => ({
    status: "success" as const,
    issuesSynced: 3,
    startedAt: "2026-03-07T08:00:00.000Z",
    completedAt: "2026-03-07T08:00:05.000Z",
  })),
};
const todayService = new TodayService(issueService, teamTrackerService, managerDeskService, syncEngine);

const services: AssistantServices = {
  todayService,
  teamTrackerService,
  managerDeskService,
  issueService,
  dailyNotesService,
  workloadService,
  alertService,
  searchService,
  syncEngine,
  tagService: new TagService(),
  workSavedViewsService: new WorkSavedViewsService(),
  automationService: new AutomationService(workloadService),
  settingsService,
};

const tools = createAssistantTools();
const toolByName = new Map(tools.map((tool) => [tool.name, tool]));

function ctx(): AssistantToolContext {
  return {
    managerAccountId: MANAGER_ID,
    workspaceId: WORKSPACE_ID,
    date: DATE,
    toolCallId: "call-1",
    actor: { type: "manager", accountId: MANAGER_ID },
    services,
  };
}

async function run(name: string, args: Record<string, unknown>) {
  const tool = toolByName.get(name);
  expect(tool, `tool ${name} registered`).toBeDefined();
  return tool!.execute(args, ctx());
}

async function seedDeveloper() {
  await db.insert(developers).values({
    accountId: "dev-1",
    displayName: "Alice Smith",
    email: "alice@example.com",
    avatarUrl: null,
    source: "jira",
    jiraAccountId: "dev-1",
    isActive: 1,
  });
}

async function seedIssue() {
  await db.insert(issues).values({
    jiraKey: "AM-123",
    summary: "Fix login redirect loop",
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
    createdAt: "2026-03-06T08:00:00.000Z",
    updatedAt: "2026-03-07T08:00:00.000Z",
    syncedAt: "2026-03-07T08:00:00.000Z",
    excluded: 0,
  });
}

describe("assistant tools", () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-07T08:00:00.000Z"));
    await resetDatabase();
    vi.clearAllMocks();
    await seedDeveloper();
    await seedIssue();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("registers all 45 tools with LLM-ready metadata", () => {
    expect(tools).toHaveLength(45);
    for (const tool of tools) {
      expect(tool.name).toBeTruthy();
      expect(tool.description).toBeTruthy();
      expect(tool.parameters).toMatchObject({ type: "object" });
      expect(typeof tool.label({})).toBe("string");
      expect(typeof tool.summarize({})).toBe("string");
    }
  });

  it("get_today_snapshot returns a compact projection", async () => {
    const { result, summary } = await run("get_today_snapshot", {});
    const snapshot = result as Record<string, unknown>;
    expect(snapshot.date).toBe(DATE);
    expect(Array.isArray(snapshot.summary)).toBe(true);
    expect(Array.isArray(snapshot.actionItems)).toBe(true);
    expect(summary).toContain(DATE);
  });

  it("get_team_board projects developers with status and counts", async () => {
    const { result } = await run("get_team_board", {});
    const board = result as { developers: Array<Record<string, unknown>>; attentionQueue: unknown[] };
    expect(board.developers).toHaveLength(1);
    expect(board.developers[0]).toMatchObject({
      accountId: "dev-1",
      displayName: "Alice Smith",
      plannedCount: 0,
      completedCount: 0,
    });
  });

  it("get_developer_day returns the developer day view", async () => {
    const { result } = await run("get_developer_day", { accountId: "dev-1" });
    const day = result as Record<string, unknown>;
    expect(day.date).toBe(DATE);
    expect(day.developer).toMatchObject({ accountId: "dev-1", displayName: "Alice Smith" });
    expect(Array.isArray(day.plannedItems)).toBe(true);
  });

  it("search_issues projects issue fields", async () => {
    const { result } = await run("search_issues", { filter: "all" });
    const payload = result as { total: number; issues: Array<Record<string, unknown>> };
    expect(payload.total).toBe(1);
    expect(payload.issues[0]).toMatchObject({
      jiraKey: "AM-123",
      summary: "Fix login redirect loop",
      statusName: "In Progress",
      priorityName: "High",
      assigneeId: "dev-1",
    });
  });

  it("get_issue returns the issue and reports not-found", async () => {
    const found = await run("get_issue", { jiraKey: "AM-123" });
    expect(found.result).toMatchObject({ jiraKey: "AM-123", summary: "Fix login redirect loop" });

    const missing = await run("get_issue", { jiraKey: "AM-999" });
    expect(missing.result).toMatchObject({ found: false, jiraKey: "AM-999" });
  });

  it("list_desk_items filters by kind and status", async () => {
    await managerDeskService.createItem(MANAGER_ID, {
      date: DATE,
      title: "Follow up with Alice",
      kind: "action",
      category: "follow_up",
      status: "planned",
    });
    await managerDeskService.createItem(MANAGER_ID, {
      date: DATE,
      title: "Weekly sync",
      kind: "meeting",
      category: "team_management",
    });

    const all = await run("list_desk_items", {});
    expect((all.result as { items: unknown[] }).items).toHaveLength(2);

    const meetings = await run("list_desk_items", { kind: "meeting" });
    const meetingItems = (meetings.result as { items: Array<Record<string, unknown>> }).items;
    expect(meetingItems).toHaveLength(1);
    expect(meetingItems[0]).toMatchObject({ title: "Weekly sync", kind: "meeting" });

    const planned = await run("list_desk_items", { status: "planned" });
    expect((planned.result as { items: unknown[] }).items).toHaveLength(1);
  });

  it("get_notes returns the day's note body", async () => {
    await dailyNotesService.append(MANAGER_ID, DATE, { text: "First line", requestId: "seed-1" }, WORKSPACE_ID);

    const { result } = await run("get_notes", { recent: true });
    const payload = result as { note: { body: string }; recentNotes: unknown[] };
    expect(payload.note.body).toBe("First line");
    expect(payload.recentNotes).toHaveLength(1);
  });

  it("search_workspace finds issues and desk items", async () => {
    await managerDeskService.createItem(MANAGER_ID, { date: DATE, title: "Redirect loop review" });

    const { result } = await run("search_workspace", { query: "redirect" });
    const payload = result as { issues: unknown[]; deskItems: unknown[] };
    expect(payload.issues).toHaveLength(1);
    expect(payload.deskItems).toHaveLength(1);
  });

  it("get_workload returns per-developer load", async () => {
    const { result } = await run("get_workload", {});
    const entries = result as Array<Record<string, unknown>>;
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ accountId: "dev-1", displayName: "Alice Smith", activeDefects: 1 });
  });

  it("get_alerts returns an array", async () => {
    const { result } = await run("get_alerts", {});
    expect(Array.isArray(result)).toBe(true);
  });

  it("get_sync_status combines runtime, log, and auto-sync flag", async () => {
    const { result } = await run("get_sync_status", {});
    expect(result).toMatchObject({ status: "idle", autoSyncEnabled: true });
  });

  it("manager_action add_check_in writes a check-in", async () => {
    const { summary } = await run("manager_action", {
      kind: "add_check_in",
      target: { type: "developer", view: "team", developerAccountId: "dev-1" },
      summary: "Making progress",
    });
    expect(summary).toContain("add_check_in");

    const view = await teamTrackerService.getDeveloperDayView(DATE, "dev-1", { viewer: { kind: "manager", accountId: MANAGER_ID } }, WORKSPACE_ID);
    expect(view.day.checkIns.at(-1)?.summary).toBe("Making progress");
  });

  it("create_desk_item creates a linked desk item", async () => {
    const { result } = await run("create_desk_item", {
      title: "Follow up on AM-123",
      kind: "action",
      category: "follow_up",
      issueKeys: ["AM-123"],
    });
    expect(result).toMatchObject({ title: "Follow up on AM-123" });

    const day = await managerDeskService.getDay(MANAGER_ID, DATE, WORKSPACE_ID);
    const item = day.items.find((entry) => entry.title === "Follow up on AM-123");
    expect(item).toBeDefined();
    expect(item!.links.map((link) => link.issueKey)).toContain("AM-123");
  });

  it("update_desk_item changes fields", async () => {
    const item = await managerDeskService.createItem(MANAGER_ID, { date: DATE, title: "Draft" });

    const { result } = await run("update_desk_item", { itemId: item.id, status: "in_progress", priority: "high" });
    expect(result).toMatchObject({ status: "in_progress" });

    const day = await managerDeskService.getDay(MANAGER_ID, DATE, WORKSPACE_ID);
    expect(day.items.find((entry) => entry.id === item.id)?.priority).toBe("high");
  });

  it("assign_tracker_task adds a planned item to the developer's day", async () => {
    const { result } = await run("assign_tracker_task", {
      accountId: "dev-1",
      title: "Fix login redirect loop",
      jiraKey: "AM-123",
    });
    expect(result).toMatchObject({ title: "Fix login redirect loop", state: "planned" });

    const view = await teamTrackerService.getDeveloperDayView(DATE, "dev-1", { viewer: { kind: "manager", accountId: MANAGER_ID } }, WORKSPACE_ID);
    expect(view.day.plannedItems.map((entry) => entry.jiraKey)).toContain("AM-123");
  });

  it("add_issue_comment goes through IssueService (Jira-mutating)", async () => {
    const addCommentSpy = vi.spyOn(issueService, "addComment");

    const { summary } = await run("add_issue_comment", { jiraKey: "AM-123", text: "Investigating" });
    expect(summary).toContain("AM-123");
    expect(addCommentSpy).toHaveBeenCalledWith("AM-123", "Investigating", WORKSPACE_ID);
    expect(jiraStub.addComment).toHaveBeenCalledWith("AM-123", "Investigating");
  });

  it("update_issue_fields goes through IssueService (Jira-mutating)", async () => {
    const updateSpy = vi.spyOn(issueService, "update");

    const { result } = await run("update_issue_fields", { jiraKey: "AM-123", priorityName: "Highest", analysisNotes: "watch" });
    expect(result).toMatchObject({ jiraKey: "AM-123", priorityName: "Highest" });
    expect(updateSpy).toHaveBeenCalledWith("AM-123", { priorityName: "Highest", analysisNotes: "watch" }, WORKSPACE_ID);
    expect(jiraStub.updateIssue).toHaveBeenCalled();
  });

  it("append_daily_note appends with an assistant request id", async () => {
    const { summary } = await run("append_daily_note", { text: "Note from copilot" });
    expect(summary).toContain(DATE);

    const day = await dailyNotesService.getDay(MANAGER_ID, DATE, WORKSPACE_ID);
    expect(day.note?.body).toBe("Note from copilot");
  });

  it("trigger_jira_sync calls syncNow", async () => {
    const { result } = await run("trigger_jira_sync", {});
    expect(result).toMatchObject({ status: "success", issuesSynced: 3 });
    expect(syncEngine.syncNow).toHaveBeenCalledWith(WORKSPACE_ID);
  });

  it("write tools are marked confirm=always and carry invalidate hints", () => {
    const writeNames = [
      "manager_action",
      "create_desk_item",
      "update_desk_item",
      "assign_tracker_task",
      "add_issue_comment",
      "update_issue_fields",
      "append_daily_note",
      "trigger_jira_sync",
      "update_tracker_item",
      "delete_tracker_item",
      "update_developer_day",
      "update_developer_availability",
      "record_status_update",
      "carry_forward",
      "delete_desk_item",
      "link_desk_item",
      "unlink_desk_item",
      "promote_tracker_item",
      "cancel_delegated_task",
      "set_issue_excluded",
      "set_issue_tags",
      "dismiss_alerts",
      "replace_daily_note",
      "save_memory",
    ];
    for (const name of writeNames) {
      const tool = toolByName.get(name)!;
      expect(tool.confirm, name).toBe("always");
      expect(tool.invalidate.length, name).toBeGreaterThan(0);
    }
    expect(toolByName.get("add_issue_comment")!.jiraMutating).toBe(true);
    expect(toolByName.get("update_issue_fields")!.jiraMutating).toBe(true);
  });

  it("get_desk_item_detail returns item detail with links", async () => {
    const item = await managerDeskService.createItem(MANAGER_ID, {
      date: DATE,
      title: "Follow up on AM-123",
      links: [{ linkType: "issue", issueKey: "AM-123" }],
    });

    const { result } = await run("get_desk_item_detail", { itemId: item.id });
    expect(result).toMatchObject({ item: expect.objectContaining({ id: item.id }) });
  });

  it("get_tracker_item_detail returns tracker task detail", async () => {
    const item = await teamTrackerService.addItem("dev-1", DATE, { title: "Task A" }, WORKSPACE_ID);

    const { result } = await run("get_tracker_item_detail", { itemId: item.id });
    expect(result).toBeTruthy();
  });

  it("preview_carry_forward works for both surfaces", async () => {
    await managerDeskService.createItem(MANAGER_ID, { date: DATE, title: "Pending item", status: "planned" });

    const desk = await run("preview_carry_forward", { surface: "desk", toDate: "2026-03-08" });
    expect(desk.result).toMatchObject({ toDate: "2026-03-08" });

    const tracker = await run("preview_carry_forward", { surface: "tracker", toDate: "2026-03-08" });
    expect(tracker.result).toMatchObject({ toDate: "2026-03-08" });
  });

  it("list_notes lists and searches daily notes", async () => {
    await dailyNotesService.append(MANAGER_ID, DATE, { text: "Discussed hiring plan", requestId: "n1" }, WORKSPACE_ID);

    const all = await run("list_notes", {});
    expect((all.result as { notes: unknown[] }).notes.length).toBeGreaterThan(0);

    const hit = await run("list_notes", { q: "hiring" });
    expect((hit.result as { notes: unknown[] }).notes).toHaveLength(1);

    const miss = await run("list_notes", { q: "nonexistent-xyz" });
    expect((miss.result as { notes: unknown[] }).notes).toHaveLength(0);
  });

  it("list_tags returns tags", async () => {
    await services.tagService.create("regression", "#ff0000", WORKSPACE_ID);

    const { result } = await run("list_tags", {});
    expect(result).toMatchObject([{ name: "regression" }]);
  });

  it("list_saved_views returns arrays for both surfaces", async () => {
    const work = await run("list_saved_views", { surface: "work" });
    expect(Array.isArray(work.result)).toBe(true);
    const team = await run("list_saved_views", { surface: "team" });
    expect(Array.isArray(team.result)).toBe(true);
  });

  it("get_issue_suggestions returns ranked suggestions", async () => {
    const { result } = await run("get_issue_suggestions", { jiraKey: "AM-123" });
    expect(result).toMatchObject({ issueKey: "AM-123" });
    await expect(run("get_issue_suggestions", { jiraKey: "AM-999" })).rejects.toMatchObject({ status: 404 });
  });

  it("get_workspace_settings returns config facts without secrets", async () => {
    const { result } = await run("get_workspace_settings", {});
    const settings = result as Record<string, unknown>;
    expect(settings.jiraConfigured).toBe(false);
    expect(typeof settings.syncIntervalMinutes).toBe("number");
    expect(JSON.stringify(result)).not.toContain("token");
  });

  it("update_tracker_item changes state and title", async () => {
    const item = await teamTrackerService.addItem("dev-1", DATE, { title: "Task A" }, WORKSPACE_ID);

    const { result } = await run("update_tracker_item", { itemId: item.id, state: "done", title: "Task A+" });
    expect(result).toMatchObject({ state: "done", title: "Task A+" });
  });

  it("delete_tracker_item removes the item", async () => {
    const item = await teamTrackerService.addItem("dev-1", DATE, { title: "Task B" }, WORKSPACE_ID);

    await run("delete_tracker_item", { itemId: item.id });
    const view = await teamTrackerService.getDeveloperDayView(DATE, "dev-1", { viewer: { kind: "manager", accountId: MANAGER_ID } }, WORKSPACE_ID);
    expect(view.day.plannedItems.find((entry) => entry.id === item.id)).toBeUndefined();
  });

  it("update_developer_day sets status and notes", async () => {
    const { result } = await run("update_developer_day", {
      accountId: "dev-1",
      status: "blocked",
      managerNotes: "Waiting on API access",
    });
    expect(result).toMatchObject({ status: "blocked" });
  });

  it("update_developer_availability marks inactive", async () => {
    const { result } = await run("update_developer_availability", {
      accountId: "dev-1",
      state: "inactive",
      note: "OOO",
    });
    expect(result).toMatchObject({ state: "inactive" });
  });

  it("record_status_update records status and requires rationale for blocked", async () => {
    const { result } = await run("record_status_update", { accountId: "dev-1", status: "on_track", summary: "Going well" });
    expect(result).toMatchObject({ status: "on_track" });

    await expect(run("record_status_update", { accountId: "dev-1", status: "blocked" })).rejects.toMatchObject({
      status: 400,
    });
  });

  it("carry_forward moves desk and tracker items to the target date", async () => {
    await managerDeskService.createItem(MANAGER_ID, { date: DATE, title: "Desk carry", status: "planned" });
    await teamTrackerService.addItem("dev-1", DATE, { title: "Tracker carry" }, WORKSPACE_ID);

    const desk = await run("carry_forward", { surface: "desk", fromDate: DATE, toDate: "2026-03-08" });
    expect((desk.result as { carried: number }).carried).toBeGreaterThanOrEqual(1);

    const tracker = await run("carry_forward", { surface: "tracker", fromDate: DATE, toDate: "2026-03-08" });
    expect((tracker.result as { carried: number }).carried).toBeGreaterThanOrEqual(1);
  });

  it("delete_desk_item removes the item", async () => {
    const item = await managerDeskService.createItem(MANAGER_ID, { date: DATE, title: "Delete me" });

    await run("delete_desk_item", { itemId: item.id });
    const day = await managerDeskService.getDay(MANAGER_ID, DATE, WORKSPACE_ID);
    expect(day.items.find((entry) => entry.id === item.id)).toBeUndefined();
  });

  it("link_desk_item and unlink_desk_item manage links", async () => {
    const item = await managerDeskService.createItem(MANAGER_ID, { date: DATE, title: "Linkable" });

    const linked = await run("link_desk_item", { itemId: item.id, linkType: "issue", issueKey: "AM-123" });
    const linkId = (linked.result as { id: number }).id;
    expect(linkId).toBeGreaterThan(0);

    const day = await managerDeskService.getDay(MANAGER_ID, DATE, WORKSPACE_ID);
    expect(day.items.find((entry) => entry.id === item.id)?.links?.map((link) => link.issueKey)).toContain("AM-123");

    await run("unlink_desk_item", { itemId: item.id, linkId });
    const after = await managerDeskService.getDay(MANAGER_ID, DATE, WORKSPACE_ID);
    expect(after.items.find((entry) => entry.id === item.id)?.links ?? []).toHaveLength(0);
  });

  it("promote_tracker_item creates a linked desk item", async () => {
    const item = await teamTrackerService.addItem("dev-1", DATE, { title: "Promote me" }, WORKSPACE_ID);

    const { result } = await run("promote_tracker_item", { trackerItemId: item.id });
    expect(result).toBeTruthy();
  });

  it("cancel_delegated_task cancels the delegated tracker task", async () => {
    const item = await managerDeskService.createItem(MANAGER_ID, {
      date: DATE,
      title: "Delegated",
      assigneeDeveloperAccountId: "dev-1",
    });

    const { result } = await run("cancel_delegated_task", { itemId: item.id });
    expect(result).toMatchObject({ status: "cancelled" });
  });

  it("set_issue_excluded hides and restores an issue", async () => {
    await run("set_issue_excluded", { jiraKey: "AM-123", excluded: true });
    const hidden = await issueService.getById("AM-123", DATE, WORKSPACE_ID);
    expect(hidden?.excluded).toBe(true);

    await run("set_issue_excluded", { jiraKey: "AM-123", excluded: false });
    const restored = await issueService.getById("AM-123", DATE, WORKSPACE_ID);
    expect(restored?.excluded).toBe(false);
  });

  it("set_issue_tags replaces the issue's tags", async () => {
    const tag = await services.tagService.create("frontend", "#00ff00", WORKSPACE_ID);

    const { result } = await run("set_issue_tags", { jiraKey: "AM-123", tagIds: [tag.id] });
    expect((result as { tags: Array<{ name: string }> }).tags.map((t) => t.name)).toContain("frontend");
  });

  it("dismiss_alerts dismisses by id", async () => {
    const { result } = await run("dismiss_alerts", { alertIds: ["alert-1", "alert-2"] });
    expect((result as { dismissed: string[] }).dismissed).toEqual(["alert-1", "alert-2"]);
  });

  it("replace_daily_note overwrites the note body", async () => {
    await dailyNotesService.append(MANAGER_ID, DATE, { text: "Old text", requestId: "n1" }, WORKSPACE_ID);

    await run("replace_daily_note", { body: "Fresh text" });
    const day = await dailyNotesService.getDay(MANAGER_ID, DATE, WORKSPACE_ID);
    expect(day.note?.body).toBe("Fresh text");
  });

  it("rejects invalid arguments with HttpError 400", async () => {
    await expect(run("get_developer_day", {})).rejects.toMatchObject({ status: 400 });
    await expect(run("create_desk_item", {})).rejects.toMatchObject({ status: 400 });
    await expect(run("search_issues", { filter: "bogus" })).rejects.toMatchObject({ status: 400 });

    const error = await run("get_developer_day", {}).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(HttpError);
  });
});
