import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { UserRole } from "shared/types";
import { HttpError } from "../middleware/errorHandler";
import type { AlertService } from "../services/alert.service";
import type { AssistantMemoryService } from "../services/assistant-memory.service";
import type { AutomationService } from "../services/automation.service";
import type { DailyNotesService } from "../services/daily-notes.service";
import type { IssueService } from "../services/issue.service";
import type { ManagerDeskService } from "../services/manager-desk.service";
import type { SearchService } from "../services/search.service";
import type { SettingsService } from "../services/settings.service";
import type { TagService } from "../services/tag.service";
import type { TeamTrackerService } from "../services/team-tracker.service";
import type { TodayService } from "../services/today.service";
import type { WorkSavedViewsService } from "../services/work-saved-views.service";
import type { WorkloadService } from "../services/workload.service";
import type { SyncEngine } from "../sync/engine";
import type { LlmToolDefinition } from "./llm-client";

export type AssistantSyncEngine = Pick<
  SyncEngine,
  "getRuntimeStatus" | "getLastSyncLog" | "isAutoSyncEnabled" | "syncNow"
>;

export interface AssistantServices {
  todayService: TodayService;
  teamTrackerService: TeamTrackerService;
  managerDeskService: ManagerDeskService;
  issueService: IssueService;
  dailyNotesService: DailyNotesService;
  workloadService: WorkloadService;
  alertService: AlertService;
  searchService: SearchService;
  syncEngine: AssistantSyncEngine;
  tagService: TagService;
  workSavedViewsService: WorkSavedViewsService;
  automationService: AutomationService;
  settingsService: SettingsService;
  memoryService: AssistantMemoryService;
}

export interface AssistantToolContext {
  managerAccountId: string;
  workspaceId: string;
  date: string;
  currentView?: string;
  toolCallId?: string;
  actor: { type: UserRole; accountId?: string };
  services: AssistantServices;
}

export interface AssistantToolDefinition {
  name: string;
  description: string;
  /** JSON Schema for the tool arguments. */
  parameters: Record<string, unknown>;
  confirm: "always" | "never";
  jiraMutating?: boolean;
  /** Query-key roots the client should invalidate after a confirmed write. */
  invalidate: string[];
  /** Activity label while the tool runs, e.g. "Reading team board…". */
  label(args: Record<string, unknown>): string;
  /** One-line proposal for write tools, e.g. "Create follow-up 'X' for 2026-09-14". */
  summarize(args: Record<string, unknown>): string;
  execute(
    args: Record<string, unknown>,
    ctx: AssistantToolContext
  ): Promise<{ result: unknown; summary: string }>;
}

const MAX_RESULT_CHARS = 12_000;
const MAX_STRING_CHARS = 4_000;
const MAX_NOTE_BODY_CHARS = 4_000;

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD");

const filterTypeSchema = z.enum([
  "all",
  "new",
  "recentlyAssigned",
  "inProgress",
  "reopened",
  "unassigned",
  "dueToday",
  "dueThisWeek",
  "noDueDate",
  "overdue",
  "blocked",
  "stale",
  "highPriority",
  "outOfTeam",
]);

const deskKindSchema = z.enum(["action", "meeting", "decision", "waiting"]);
const deskCategorySchema = z.enum([
  "analysis",
  "design",
  "team_management",
  "cross_team",
  "follow_up",
  "escalation",
  "admin",
  "planning",
  "other",
]);
const deskStatusSchema = z.enum([
  "inbox",
  "planned",
  "in_progress",
  "waiting",
  "backlog",
  "done",
  "cancelled",
]);
const deskPrioritySchema = z.enum(["low", "medium", "high", "critical"]);

function parseArgs<S extends z.ZodTypeAny>(schema: S, args: Record<string, unknown>): z.infer<S> {
  const parsed = schema.safeParse(args);
  if (!parsed.success) {
    const detail = parsed.error.issues.map((issue) => issue.message).join(", ");
    throw new HttpError(400, `Invalid tool arguments: ${detail}`);
  }
  return parsed.data;
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return "";
  }
}

function capValue(value: unknown, maxItems: number): unknown {
  if (Array.isArray(value)) {
    const items: unknown[] = value.slice(0, maxItems).map((item) => capValue(item, maxItems));
    if (value.length > maxItems) {
      items.push({ _truncated: true, omitted: value.length - maxItems });
    }
    return items;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      out[key] = capValue(entry, maxItems);
    }
    return out;
  }
  if (typeof value === "string" && value.length > MAX_STRING_CHARS) {
    return `${value.slice(0, MAX_STRING_CHARS)}…`;
  }
  return value;
}

/** Keep tool results small enough for the model context: arrays shrink until it fits. */
export function compact(value: unknown, max = MAX_RESULT_CHARS): unknown {
  if (safeStringify(value).length <= max) {
    return value;
  }
  for (const maxItems of [25, 12, 6, 3, 1]) {
    const candidate = capValue(value, maxItems);
    if (safeStringify(candidate).length <= max) {
      return candidate;
    }
  }
  return { _truncated: true };
}

function dateProperty(description: string): Record<string, unknown> {
  return { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$", description };
}

export function createAssistantTools(): AssistantToolDefinition[] {
  const readTools: AssistantToolDefinition[] = [
    {
      name: "get_today_snapshot",
      description:
        "Get the manager's Today command view for a date: summary metrics, ranked action items, team pulse, open promises/follow-ups, and sync status.",
      parameters: {
        type: "object",
        properties: { date: dateProperty("YYYY-MM-DD; defaults to today") },
        additionalProperties: false,
      },
      confirm: "never",
      invalidate: [],
      label: () => "Reading today snapshot…",
      summarize: () => "Read today snapshot",
      execute: async (rawArgs, ctx) => {
        const args = parseArgs(z.object({ date: dateSchema.optional() }), rawArgs);
        const date = args.date ?? ctx.date;
        const today = await ctx.services.todayService.getToday(ctx.managerAccountId, date, ctx.workspaceId);
        return {
          result: compact({
            date: today.date,
            rhythm: today.rhythm,
            summary: today.summary,
            actionItems: today.actionItems.map((item) => ({
              id: item.id,
              type: item.type,
              title: item.title,
              context: item.context,
              signal: item.signal,
              severity: item.severity,
              group: item.group,
              target: item.target,
            })),
            teamPulse: today.teamPulse.map((pulse) => ({
              accountId: pulse.accountId,
              displayName: pulse.displayName,
              status: pulse.status,
              detail: pulse.detail,
              currentWork: pulse.currentWork,
              lastUpdate: pulse.lastUpdate,
            })),
            promises: today.promises.map((promise) => ({
              id: promise.id,
              title: promise.title,
              detail: promise.detail,
              severity: promise.severity,
            })),
            syncStatus: today.syncStatus,
          }),
          summary: `Read today snapshot for ${date}`,
        };
      },
    },
    {
      name: "get_team_board",
      description:
        "Get the Team Tracker board for a date: every developer's status, attention signals, current work, planned/completed counts, and latest check-in. Use this to resolve a developer's accountId.",
      parameters: {
        type: "object",
        properties: { date: dateProperty("YYYY-MM-DD; defaults to today") },
        additionalProperties: false,
      },
      confirm: "never",
      invalidate: [],
      label: () => "Reading team board…",
      summarize: () => "Read team board",
      execute: async (rawArgs, ctx) => {
        const args = parseArgs(z.object({ date: dateSchema.optional() }), rawArgs);
        const date = args.date ?? ctx.date;
        const board = await ctx.services.teamTrackerService.getBoard(date, {
          workspaceId: ctx.workspaceId,
          managerAccountId: ctx.managerAccountId,
        });
        return {
          result: compact({
            date: board.date,
            summary: board.summary,
            developers: board.developers.map((day) => ({
              accountId: day.developer.accountId,
              displayName: day.developer.displayName,
              availability: day.availability.state,
              status: day.status,
              isStale: day.isStale,
              signals: day.signals,
              currentItem: day.currentItem
                ? { id: day.currentItem.id, title: day.currentItem.title, jiraKey: day.currentItem.jiraKey }
                : undefined,
              plannedCount: day.plannedItems.length,
              completedCount: day.completedItems.length,
              lastCheckIn: day.checkIns.at(-1)
                ? { summary: day.checkIns.at(-1)!.summary, at: day.checkIns.at(-1)!.createdAt }
                : undefined,
              lastCheckInAt: day.lastCheckInAt,
              nextFollowUpAt: day.nextFollowUpAt,
            })),
            attentionQueue: board.attentionQueue.map((item) => ({
              accountId: item.developer.accountId,
              displayName: item.developer.displayName,
              status: item.status,
              reasons: item.reasons.map((reason) => reason.code),
              isStale: item.isStale,
            })),
          }),
          summary: `Read team board for ${date} (${board.developers.length} developers)`,
        };
      },
    },
    {
      name: "get_developer_day",
      description:
        "Get one developer's day on the Team Tracker: status, availability, current/planned/completed/dropped items, and check-ins. Resolve accountId via get_team_board first.",
      parameters: {
        type: "object",
        properties: {
          accountId: { type: "string", description: "Developer account id" },
          date: dateProperty("YYYY-MM-DD; defaults to today"),
        },
        required: ["accountId"],
        additionalProperties: false,
      },
      confirm: "never",
      invalidate: [],
      label: (args) => `Reading ${String(args.accountId ?? "developer")}'s day…`,
      summarize: (args) => `Read ${String(args.accountId ?? "developer")}'s day`,
      execute: async (rawArgs, ctx) => {
        const args = parseArgs(
          z.object({ accountId: z.string().trim().min(1), date: dateSchema.optional() }),
          rawArgs
        );
        const date = args.date ?? ctx.date;
        const view = await ctx.services.teamTrackerService.getDeveloperDayView(
          date,
          args.accountId,
          undefined,
          ctx.workspaceId
        );
        const projectItem = (item: {
          id: number;
          title: string;
          jiraKey?: string;
          state: string;
          note?: string;
        }) => ({ id: item.id, title: item.title, jiraKey: item.jiraKey, state: item.state, note: item.note });
        const day = view.day;
        return {
          result: compact({
            date: day.date,
            viewMode: view.viewMode,
            developer: { accountId: day.developer.accountId, displayName: day.developer.displayName },
            availability: day.availability,
            status: day.status,
            capacityUnits: day.capacityUnits,
            isStale: day.isStale,
            signals: day.signals,
            lastCheckInAt: day.lastCheckInAt,
            nextFollowUpAt: day.nextFollowUpAt,
            currentItem: day.currentItem ? projectItem(day.currentItem) : undefined,
            plannedItems: day.plannedItems.map(projectItem),
            completedItems: day.completedItems.map(projectItem),
            droppedItems: day.droppedItems.map(projectItem),
            checkIns: day.checkIns.map((checkIn) => ({
              summary: checkIn.summary,
              status: checkIn.status,
              authorType: checkIn.authorType,
              createdAt: checkIn.createdAt,
            })),
          }),
          summary: `Read ${day.developer.displayName}'s day for ${date}`,
        };
      },
    },
    {
      name: "search_issues",
      description:
        "Search Jira defects in the workspace. Filter presets mirror the Work board (all, new, recentlyAssigned, inProgress, reopened, unassigned, dueToday, dueThisWeek, noDueDate, overdue, blocked, stale, highPriority, outOfTeam).",
      parameters: {
        type: "object",
        properties: {
          filter: { type: "string", enum: filterTypeSchema.options },
          assignee: { type: "string", description: "Assignee account id" },
          status: { type: "string", description: "Exact Jira status name" },
          priority: { type: "string", description: "Exact priority name, e.g. High" },
          sort: { type: "string", enum: ["priority", "dueDate", "updated", "created"] },
          limit: { type: "integer", minimum: 1, maximum: 50, description: "Defaults to 25" },
        },
        additionalProperties: false,
      },
      confirm: "never",
      invalidate: [],
      label: () => "Searching issues…",
      summarize: () => "Search issues",
      execute: async (rawArgs, ctx) => {
        const args = parseArgs(
          z.object({
            filter: filterTypeSchema.optional(),
            assignee: z.string().trim().optional(),
            status: z.string().trim().optional(),
            priority: z.string().trim().optional(),
            sort: z.enum(["priority", "dueDate", "updated", "created"]).optional(),
            limit: z.number().int().positive().optional(),
          }),
          rawArgs
        );
        const issues = await ctx.services.issueService.getAll(
          {
            filter: args.filter,
            assignee: args.assignee,
            status: args.status,
            priority: args.priority,
            sort: args.sort,
          },
          ctx.workspaceId
        );
        const limit = Math.min(args.limit ?? 25, 50);
        const limited = issues.slice(0, limit);
        return {
          result: compact({
            total: issues.length,
            issues: limited.map((issue) => ({
              jiraKey: issue.jiraKey,
              summary: issue.summary,
              statusName: issue.statusName,
              priorityName: issue.priorityName,
              assigneeName: issue.assigneeName,
              assigneeId: issue.assigneeId,
              dueDate: issue.dueDate,
              developmentDueDate: issue.developmentDueDate,
              flagged: issue.flagged,
              updatedAt: issue.updatedAt,
            })),
          }),
          summary: `Found ${issues.length} issues`,
        };
      },
    },
    {
      name: "get_issue",
      description: "Get one Jira defect by key (e.g. AM-123).",
      parameters: {
        type: "object",
        properties: { jiraKey: { type: "string" } },
        required: ["jiraKey"],
        additionalProperties: false,
      },
      confirm: "never",
      invalidate: [],
      label: (args) => `Reading ${String(args.jiraKey ?? "issue")}…`,
      summarize: (args) => `Read ${String(args.jiraKey ?? "issue")}`,
      execute: async (rawArgs, ctx) => {
        const args = parseArgs(z.object({ jiraKey: z.string().trim().min(1) }), rawArgs);
        const issue = await ctx.services.issueService.getById(args.jiraKey, ctx.date, ctx.workspaceId);
        if (!issue) {
          return { result: { found: false, jiraKey: args.jiraKey }, summary: `Issue ${args.jiraKey} not found` };
        }
        return {
          result: compact({
            jiraKey: issue.jiraKey,
            summary: issue.summary,
            description: issue.description,
            statusName: issue.statusName,
            statusCategory: issue.statusCategory,
            priorityName: issue.priorityName,
            assigneeId: issue.assigneeId,
            assigneeName: issue.assigneeName,
            reporterName: issue.reporterName,
            component: issue.component,
            labels: issue.labels,
            dueDate: issue.dueDate,
            developmentDueDate: issue.developmentDueDate,
            flagged: issue.flagged,
            analysisNotes: issue.analysisNotes,
            localTags: issue.localTags,
            trackerAssignmentsToday: issue.trackerAssignmentsToday,
            createdAt: issue.createdAt,
            updatedAt: issue.updatedAt,
          }),
          summary: `Read issue ${issue.jiraKey}`,
        };
      },
    },
    {
      name: "list_desk_items",
      description:
        "List the manager's Desk items for a date (follow-ups, decisions, meetings, waiting items). Optionally filter by kind or status.",
      parameters: {
        type: "object",
        properties: {
          date: dateProperty("YYYY-MM-DD; defaults to today"),
          kind: { type: "string", enum: deskKindSchema.options },
          status: { type: "string", enum: deskStatusSchema.options },
        },
        additionalProperties: false,
      },
      confirm: "never",
      invalidate: [],
      label: () => "Reading desk items…",
      summarize: () => "List desk items",
      execute: async (rawArgs, ctx) => {
        const args = parseArgs(
          z.object({
            date: dateSchema.optional(),
            kind: deskKindSchema.optional(),
            status: deskStatusSchema.optional(),
          }),
          rawArgs
        );
        const date = args.date ?? ctx.date;
        const day = await ctx.services.managerDeskService.getDay(ctx.managerAccountId, date, ctx.workspaceId);
        let items = day.items;
        if (args.kind) {
          items = items.filter((item) => item.kind === args.kind);
        }
        if (args.status) {
          items = items.filter((item) => item.status === args.status);
        }
        return {
          result: compact({
            date: day.date,
            summary: day.summary,
            items: items.map((item) => ({
              id: item.id,
              title: item.title,
              kind: item.kind,
              category: item.category,
              status: item.status,
              priority: item.priority,
              followUpAt: item.followUpAt,
              assigneeDeveloperAccountId: item.assigneeDeveloperAccountId,
              nextAction: item.nextAction,
              outcome: item.outcome,
              issueKeys: item.links
                .filter((link) => link.linkType === "issue")
                .map((link) => link.issueKey)
                .filter(Boolean),
            })),
          }),
          summary: `Checked ${items.length} desk items`,
        };
      },
    },
    {
      name: "get_notes",
      description:
        "Read the manager's private daily note for a date. Pass recent=true to also list the last 7 note days.",
      parameters: {
        type: "object",
        properties: {
          date: dateProperty("YYYY-MM-DD; defaults to today"),
          recent: { type: "boolean", description: "Also return the 7 most recent note summaries" },
        },
        additionalProperties: false,
      },
      confirm: "never",
      invalidate: [],
      label: () => "Reading daily notes…",
      summarize: () => "Read daily notes",
      execute: async (rawArgs, ctx) => {
        const args = parseArgs(
          z.object({ date: dateSchema.optional(), recent: z.boolean().optional() }),
          rawArgs
        );
        const date = args.date ?? ctx.date;
        const day = await ctx.services.dailyNotesService.getDay(ctx.managerAccountId, date, ctx.workspaceId);
        let recentNotes: unknown;
        if (args.recent) {
          const list = await ctx.services.dailyNotesService.list(
            ctx.managerAccountId,
            { limit: 7 },
            ctx.workspaceId
          );
          recentNotes = list.notes;
        }
        return {
          result: compact({
            date,
            note: day.note
              ? {
                  date: day.note.date,
                  body: day.note.body.slice(0, MAX_NOTE_BODY_CHARS),
                  bodyTruncated: day.note.body.length > MAX_NOTE_BODY_CHARS,
                  revision: day.note.revision,
                  updatedAt: day.note.updatedAt,
                }
              : null,
            followUps: day.followUps,
            recentNotes,
          }),
          summary: day.note ? `Read note for ${date}` : `No note for ${date}`,
        };
      },
    },
    {
      name: "search_workspace",
      description:
        "Full-text search across issues, desk items, check-ins, developers, and daily notes. Use to resolve names, issue keys, or free-text questions.",
      parameters: {
        type: "object",
        properties: { query: { type: "string", description: "Search text" } },
        required: ["query"],
        additionalProperties: false,
      },
      confirm: "never",
      invalidate: [],
      label: () => "Searching workspace…",
      summarize: (args) => `Search workspace for "${String(args.query ?? "")}"`,
      execute: async (rawArgs, ctx) => {
        const args = parseArgs(z.object({ query: z.string().trim().min(1) }), rawArgs);
        const result = await ctx.services.searchService.search(
          args.query,
          ctx.workspaceId,
          ctx.managerAccountId
        );
        return { result: compact(result), summary: `Searched workspace for "${args.query}"` };
      },
    },
    {
      name: "get_workload",
      description: "Get per-developer workload for a date: active defects, due-today counts, capacity, and load level.",
      parameters: {
        type: "object",
        properties: { date: dateProperty("YYYY-MM-DD; defaults to today") },
        additionalProperties: false,
      },
      confirm: "never",
      invalidate: [],
      label: () => "Reading team workload…",
      summarize: () => "Read team workload",
      execute: async (rawArgs, ctx) => {
        const args = parseArgs(z.object({ date: dateSchema.optional() }), rawArgs);
        const date = args.date ?? ctx.date;
        const workload = await ctx.services.workloadService.getTeamWorkload(date, ctx.workspaceId);
        return {
          result: compact(
            workload.map((entry) => ({
              accountId: entry.developer.accountId,
              displayName: entry.developer.displayName,
              level: entry.level,
              score: entry.score,
              activeDefects: entry.activeDefects,
              dueToday: entry.dueToday,
              blocked: entry.blocked,
              trackerStatus: entry.trackerStatus,
              isTrackerStale: entry.isTrackerStale,
              hasCurrentItem: entry.hasCurrentItem,
              assignedTodayCount: entry.assignedTodayCount,
              completedTodayCount: entry.completedTodayCount,
              capacityUnits: entry.capacityUnits,
              capacityUsed: entry.capacityUsed,
              capacityUtilization: entry.capacityUtilization,
              signals: entry.signals,
            }))
          ),
          summary: `Read workload for ${workload.length} developers`,
        };
      },
    },
    {
      name: "get_alerts",
      description: "List active manager alerts (overdue, stale, blocked, idle developers, high-priority-not-started).",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      confirm: "never",
      invalidate: [],
      label: () => "Reading alerts…",
      summarize: () => "Read alerts",
      execute: async (_args, ctx) => {
        const alerts = await ctx.services.alertService.listAlertsForManager(
          ctx.managerAccountId,
          ctx.workspaceId
        );
        return { result: compact(alerts), summary: `Read ${alerts.length} alerts` };
      },
    },
    {
      name: "get_sync_status",
      description: "Get Jira sync runtime status, last sync log entry, and whether auto-sync is enabled.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      confirm: "never",
      invalidate: [],
      label: () => "Checking Jira sync status…",
      summarize: () => "Check Jira sync status",
      execute: async (_args, ctx) => {
        const runtime = ctx.services.syncEngine.getRuntimeStatus(ctx.workspaceId);
        const [lastLog, autoSyncEnabled] = await Promise.all([
          ctx.services.syncEngine.getLastSyncLog(ctx.workspaceId),
          ctx.services.syncEngine.isAutoSyncEnabled(ctx.workspaceId),
        ]);
        return {
          result: {
            status: runtime.status,
            errorMessage: runtime.errorMessage,
            autoSyncEnabled,
            lastSync: lastLog
              ? {
                  startedAt: lastLog.startedAt,
                  completedAt: lastLog.completedAt,
                  status: lastLog.status,
                  issuesSynced: lastLog.issuesSynced,
                  errorMessage: lastLog.errorMessage,
                }
              : undefined,
          },
          summary: `Sync status: ${runtime.status}`,
        };
      },
    },
    {
      name: "get_desk_item_detail",
      description:
        "Get full detail for one Manager Desk item: fields, linked Jira issues and developers, and delegated tracker task state.",
      parameters: {
        type: "object",
        properties: { itemId: { type: "integer" } },
        required: ["itemId"],
        additionalProperties: false,
      },
      confirm: "never",
      invalidate: [],
      label: (args) => `Opening desk item #${String(args.itemId ?? "?")}…`,
      summarize: (args) => `Load desk item #${String(args.itemId ?? "?")}`,
      execute: async (rawArgs, ctx) => {
        const args = parseArgs(z.object({ itemId: z.number().int().positive() }), rawArgs);
        const detail = await ctx.services.managerDeskService.getItemDetail(
          ctx.managerAccountId,
          args.itemId,
          ctx.workspaceId
        );
        return { result: compact(detail), summary: `Loaded desk item #${args.itemId}` };
      },
    },
    {
      name: "get_tracker_item_detail",
      description:
        "Get manager-facing detail for one Team Tracker item: state, developer, check-ins, and any linked desk item.",
      parameters: {
        type: "object",
        properties: { itemId: { type: "integer" } },
        required: ["itemId"],
        additionalProperties: false,
      },
      confirm: "never",
      invalidate: [],
      label: (args) => `Opening tracker item #${String(args.itemId ?? "?")}…`,
      summarize: (args) => `Load tracker item #${String(args.itemId ?? "?")}`,
      execute: async (rawArgs, ctx) => {
        const args = parseArgs(z.object({ itemId: z.number().int().positive() }), rawArgs);
        const detail = await ctx.services.managerDeskService.getTrackerTaskDetail(
          ctx.managerAccountId,
          args.itemId,
          ctx.workspaceId
        );
        return { result: compact(detail), summary: `Loaded tracker item #${args.itemId}` };
      },
    },
    {
      name: "preview_carry_forward",
      description:
        "Preview what a carry-forward would move without changing anything. For surface=tracker it auto-finds the source date unless fromDate is given; surface=desk requires fromDate.",
      parameters: {
        type: "object",
        properties: {
          surface: { type: "string", enum: ["desk", "tracker"] },
          toDate: dateProperty("YYYY-MM-DD; destination date"),
          fromDate: dateProperty("YYYY-MM-DD; required for desk, optional for tracker"),
          lookbackDays: { type: "integer", description: "Tracker only: how far back to look for a source day (default 7)" },
        },
        required: ["surface", "toDate"],
        additionalProperties: false,
      },
      confirm: "never",
      invalidate: [],
      label: () => "Previewing carry-forward…",
      summarize: (args) => `Preview ${String(args.surface ?? "items")} carry-forward`,
      execute: async (rawArgs, ctx) => {
        const args = parseArgs(
          z.object({
            surface: z.enum(["desk", "tracker"]),
            toDate: dateSchema,
            fromDate: dateSchema.optional(),
            lookbackDays: z.number().int().min(1).max(30).optional(),
          }),
          rawArgs
        );
        const result =
          args.surface === "desk"
            ? args.fromDate
              ? await ctx.services.managerDeskService.previewCarryForward(
                  ctx.managerAccountId,
                  args.fromDate,
                  args.toDate,
                  ctx.workspaceId
                )
              : await ctx.services.managerDeskService.getCarryForwardContext(
                  ctx.managerAccountId,
                  args.toDate,
                  args.lookbackDays,
                  ctx.workspaceId
                )
            : args.fromDate
              ? await ctx.services.teamTrackerService.previewCarryForward(
                  args.fromDate,
                  args.toDate,
                  ctx.workspaceId
                )
              : await ctx.services.teamTrackerService.getCarryForwardContext(
                  args.toDate,
                  args.lookbackDays,
                  ctx.workspaceId
                );
        return { result: compact(result), summary: `Previewed ${args.surface} carry-forward` };
      },
    },
    {
      name: "list_notes",
      description:
        "List the manager's private daily notes (dates + excerpts), newest first. Supports text search and pagination via 'before' cursor. Use get_notes for a note's full body.",
      parameters: {
        type: "object",
        properties: {
          q: { type: "string", description: "Search note bodies" },
          before: dateProperty("YYYY-MM-DD; only notes before this date"),
          limit: { type: "integer", description: "Max notes (default 20)" },
        },
        additionalProperties: false,
      },
      confirm: "never",
      invalidate: [],
      label: () => "Listing notes…",
      summarize: () => "List daily notes",
      execute: async (rawArgs, ctx) => {
        const args = parseArgs(
          z.object({
            q: z.string().trim().max(200).optional(),
            before: dateSchema.optional(),
            limit: z.number().int().min(1).max(50).optional(),
          }),
          rawArgs
        );
        const response = await ctx.services.dailyNotesService.list(
          ctx.managerAccountId,
          { q: args.q, before: args.before, limit: args.limit },
          ctx.workspaceId
        );
        return { result: compact(response), summary: `Listed ${response.notes.length} notes` };
      },
    },
    {
      name: "list_tags",
      description: "List all local tags (id, name, color) available for tagging issues.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      confirm: "never",
      invalidate: [],
      label: () => "Listing tags…",
      summarize: () => "List tags",
      execute: async (_args, ctx) => {
        const tags = await ctx.services.tagService.getAll(ctx.workspaceId);
        return { result: compact(tags), summary: `Listed ${tags.length} tags` };
      },
    },
    {
      name: "list_saved_views",
      description: "List the manager's saved views for a surface (work board or team tracker).",
      parameters: {
        type: "object",
        properties: { surface: { type: "string", enum: ["work", "team"] } },
        required: ["surface"],
        additionalProperties: false,
      },
      confirm: "never",
      invalidate: [],
      label: () => "Listing saved views…",
      summarize: (args) => `List ${String(args.surface ?? "")} saved views`,
      execute: async (rawArgs, ctx) => {
        const args = parseArgs(z.object({ surface: z.enum(["work", "team"]) }), rawArgs);
        const views =
          args.surface === "work"
            ? await ctx.services.workSavedViewsService.listSavedViews(ctx.managerAccountId, ctx.workspaceId)
            : await ctx.services.teamTrackerService.listSavedViews(ctx.managerAccountId, ctx.workspaceId);
        return { result: compact(views), summary: `Listed ${views.length} ${args.surface} saved views` };
      },
    },
    {
      name: "get_issue_suggestions",
      description:
        "Get automation suggestions for an issue: ranked assignee suggestions, suggested priority from labels, and a suggested due date.",
      parameters: {
        type: "object",
        properties: { jiraKey: { type: "string" } },
        required: ["jiraKey"],
        additionalProperties: false,
      },
      confirm: "never",
      invalidate: [],
      label: (args) => `Suggesting for ${String(args.jiraKey ?? "issue")}…`,
      summarize: (args) => `Suggestions for ${String(args.jiraKey ?? "issue")}`,
      execute: async (rawArgs, ctx) => {
        const args = parseArgs(z.object({ jiraKey: z.string().trim().min(1) }), rawArgs);
        const issue = await ctx.services.issueService.getById(args.jiraKey, ctx.date, ctx.workspaceId);
        if (!issue) {
          throw new HttpError(404, "Issue not found");
        }
        const assignee = await ctx.services.automationService.suggestAssignee(ctx.workspaceId);
        const priority = ctx.services.automationService.suggestPriority(issue.labels ?? []);
        const dueDate = ctx.services.automationService.suggestDueDate(
          issue.priorityName ?? "Medium",
          issue.createdAt ?? new Date().toISOString()
        );
        return {
          result: compact({ issueKey: issue.jiraKey, assignee, priority, dueDate }),
          summary: `Suggested for ${issue.jiraKey}`,
        };
      },
    },
    {
      name: "get_workspace_settings",
      description:
        "Read workspace configuration facts: Jira connection (host, project, whether a token is configured — never the token itself), sync settings, thresholds, backup enabled.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      confirm: "never",
      invalidate: [],
      label: () => "Reading workspace settings…",
      summarize: () => "Read workspace settings",
      execute: async (_args, ctx) => {
        const s = ctx.services.settingsService;
        const [jiraBaseUrl, jiraProjectKey, jiraEmail, jiraToken, autoSync, syncIntervalMs, staleH, backupEnabled] =
          await Promise.all([
            s.getJiraBaseUrl(ctx.workspaceId),
            s.getJiraProjectKey(ctx.workspaceId),
            s.getJiraEmail(ctx.workspaceId),
            s.getJiraToken(ctx.workspaceId),
            s.getJiraAutoSyncEnabled(ctx.workspaceId),
            s.getSyncIntervalMs(ctx.workspaceId),
            s.getStaleThresholdHours(ctx.workspaceId),
            s.getBackupEnabled(ctx.workspaceId),
          ]);
        return {
          result: compact({
            jiraBaseUrl,
            jiraEmail,
            jiraProjectKey,
            jiraConfigured: Boolean(jiraToken),
            autoSyncEnabled: autoSync,
            syncIntervalMinutes: Math.round(syncIntervalMs / 60000),
            staleThresholdHours: staleH,
            backupEnabled,
          }),
          summary: "Read workspace settings",
        };
      },
    },
  ];

  const writeTools: AssistantToolDefinition[] = [
    {
      name: "manager_action",
      description:
        "Run a Today command: add_check_in, set_current_work, mark_done, carry_forward, capture_follow_up, capture_meeting_outcome, or snooze against a Today action target. To give a developer a task, use assign_tracker_task instead.",
      parameters: {
        type: "object",
        properties: {
          kind: {
            type: "string",
            enum: [
              "add_check_in",
              "set_current_work",
              "mark_done",
              "carry_forward",
              "capture_follow_up",
              "capture_meeting_outcome",
              "snooze",
            ],
          },
          target: {
            type: "object",
            description: "Today action target",
            properties: {
              type: {
                type: "string",
                enum: ["issue", "developer", "manager_desk_item", "tracker_item", "follow_up", "meeting", "view"],
              },
              view: {
                type: "string",
                enum: ["work", "team", "desk", "follow-ups", "meetings", "notes", "settings"],
              },
              issueKey: { type: "string" },
              relatedIssueKeys: { type: "array", items: { type: "string" } },
              developerAccountId: { type: "string" },
              managerDeskItemId: { type: "integer" },
              trackerItemId: { type: "integer" },
              date: dateProperty("YYYY-MM-DD"),
              filter: { type: "string", enum: filterTypeSchema.options },
            },
            required: ["type", "view"],
            additionalProperties: false,
          },
          title: { type: "string" },
          outcome: { type: "string" },
          preset: { type: "string", enum: ["later_today", "tomorrow", "next_week"] },
          summary: { type: "string", description: "Check-in text for add_check_in" },
          date: dateProperty("YYYY-MM-DD; defaults to today"),
        },
        required: ["kind", "target"],
        additionalProperties: false,
      },
      confirm: "always",
      invalidate: ["today", "manager-actions", "manager-desk", "team-tracker", "workload"],
      label: (args) => `Running ${String(args.kind ?? "action")}…`,
      summarize: (args) =>
        `Run ${String(args.kind ?? "action")}${args.title ? ` "${String(args.title)}"` : ""}`,
      execute: async (rawArgs, ctx) => {
        const args = parseArgs(
          z.object({
            kind: z.enum([
              "add_check_in",
              "set_current_work",
              "mark_done",
              "carry_forward",
              "capture_follow_up",
              "capture_meeting_outcome",
              "snooze",
            ]),
            target: z.object({
              type: z.enum(["issue", "developer", "manager_desk_item", "tracker_item", "follow_up", "meeting", "view"]),
              view: z.enum(["work", "team", "desk", "follow-ups", "meetings", "notes", "settings"]),
              issueKey: z.string().optional(),
              relatedIssueKeys: z.array(z.string()).optional(),
              developerAccountId: z.string().optional(),
              managerDeskItemId: z.number().int().optional(),
              trackerItemId: z.number().int().optional(),
              date: dateSchema.optional(),
              filter: filterTypeSchema.optional(),
            }),
            title: z.string().optional(),
            outcome: z.string().optional(),
            preset: z.enum(["later_today", "tomorrow", "next_week"]).optional(),
            summary: z.string().optional(),
            date: dateSchema.optional(),
          }),
          rawArgs
        );
        const date = args.date ?? ctx.date;
        const result = await ctx.services.todayService.executeCommand(
          ctx.managerAccountId,
          {
            command: { kind: args.kind, label: args.kind, target: args.target },
            date,
            title: args.title,
            outcome: args.outcome,
            preset: args.preset,
            summary: args.summary,
          },
          ctx.actor,
          ctx.workspaceId
        );
        return { result: compact(result), summary: `Ran ${args.kind}` };
      },
    },
    {
      name: "create_desk_item",
      description:
        "Create a Manager Desk item: follow-up, action, meeting, decision, or waiting item, optionally linked to Jira issue keys and/or assigned to a developer.",
      parameters: {
        type: "object",
        properties: {
          date: dateProperty("YYYY-MM-DD; defaults to today"),
          title: { type: "string" },
          kind: { type: "string", enum: deskKindSchema.options },
          category: { type: "string", enum: deskCategorySchema.options },
          status: { type: "string", enum: deskStatusSchema.options },
          priority: { type: "string", enum: deskPrioritySchema.options },
          assigneeDeveloperAccountId: { type: "string" },
          contextNote: { type: "string" },
          nextAction: { type: "string" },
          followUpAt: { type: "string", description: "ISO datetime for the follow-up" },
          participants: { type: "string" },
          issueKeys: { type: "array", items: { type: "string" }, description: "Jira keys to link" },
        },
        required: ["title"],
        additionalProperties: false,
      },
      confirm: "always",
      invalidate: ["today", "manager-actions", "manager-desk", "daily-notes"],
      label: () => "Creating desk item…",
      summarize: (args) =>
        `Create desk item "${String(args.title ?? "")}"${args.date ? ` for ${String(args.date)}` : ""}`,
      execute: async (rawArgs, ctx) => {
        const args = parseArgs(
          z.object({
            date: dateSchema.optional(),
            title: z.string().trim().min(1),
            kind: deskKindSchema.optional(),
            category: deskCategorySchema.optional(),
            status: deskStatusSchema.optional(),
            priority: deskPrioritySchema.optional(),
            assigneeDeveloperAccountId: z.string().trim().optional(),
            contextNote: z.string().optional(),
            nextAction: z.string().optional(),
            followUpAt: z.string().optional(),
            participants: z.string().optional(),
            issueKeys: z.array(z.string().trim().min(1)).max(10).optional(),
          }),
          rawArgs
        );
        const item = await ctx.services.managerDeskService.createItem(
          ctx.managerAccountId,
          {
            date: args.date ?? ctx.date,
            title: args.title,
            kind: args.kind,
            category: args.category,
            status: args.status,
            priority: args.priority,
            assigneeDeveloperAccountId: args.assigneeDeveloperAccountId,
            contextNote: args.contextNote,
            nextAction: args.nextAction,
            followUpAt: args.followUpAt,
            participants: args.participants,
            links: args.issueKeys?.map((issueKey) => ({ linkType: "issue" as const, issueKey })),
          },
          ctx.workspaceId
        );
        return {
          result: compact({ id: item.id, title: item.title, kind: item.kind, status: item.status }),
          summary: `Created desk item "${item.title}"`,
        };
      },
    },
    {
      name: "update_desk_item",
      description: "Update fields on an existing Manager Desk item (title, kind, category, status, priority, assignee, notes, follow-up time).",
      parameters: {
        type: "object",
        properties: {
          itemId: { type: "integer" },
          title: { type: "string" },
          kind: { type: "string", enum: deskKindSchema.options },
          category: { type: "string", enum: deskCategorySchema.options },
          status: { type: "string", enum: deskStatusSchema.options },
          priority: { type: "string", enum: deskPrioritySchema.options },
          assigneeDeveloperAccountId: { type: ["string", "null"] },
          participants: { type: ["string", "null"] },
          contextNote: { type: ["string", "null"] },
          nextAction: { type: ["string", "null"] },
          outcome: { type: ["string", "null"] },
          plannedStartAt: { type: ["string", "null"] },
          plannedEndAt: { type: ["string", "null"] },
          followUpAt: { type: ["string", "null"] },
        },
        required: ["itemId"],
        additionalProperties: false,
      },
      confirm: "always",
      invalidate: ["today", "manager-actions", "manager-desk", "daily-notes", "team-tracker"],
      label: () => "Updating desk item…",
      summarize: (args) => `Update desk item #${String(args.itemId ?? "?")}`,
      execute: async (rawArgs, ctx) => {
        const args = parseArgs(
          z.object({
            itemId: z.number().int().positive(),
            title: z.string().trim().min(1).optional(),
            kind: deskKindSchema.optional(),
            category: deskCategorySchema.optional(),
            status: deskStatusSchema.optional(),
            priority: deskPrioritySchema.optional(),
            assigneeDeveloperAccountId: z.string().trim().nullable().optional(),
            participants: z.string().nullable().optional(),
            contextNote: z.string().nullable().optional(),
            nextAction: z.string().nullable().optional(),
            outcome: z.string().nullable().optional(),
            plannedStartAt: z.string().nullable().optional(),
            plannedEndAt: z.string().nullable().optional(),
            followUpAt: z.string().nullable().optional(),
          }),
          rawArgs
        );
        const { itemId, ...updates } = args;
        const item = await ctx.services.managerDeskService.updateItem(
          ctx.managerAccountId,
          itemId,
          updates,
          ctx.workspaceId
        );
        return {
          result: compact({ id: item.id, title: item.title, status: item.status }),
          summary: `Updated desk item #${item.id}`,
        };
      },
    },
    {
      name: "assign_tracker_task",
      description:
        "Assign a task to a developer's day on the Team Tracker (planned item), optionally linked to a Jira key. Resolve accountId via get_team_board first.",
      parameters: {
        type: "object",
        properties: {
          accountId: { type: "string", description: "Developer account id" },
          date: dateProperty("YYYY-MM-DD; defaults to today"),
          title: { type: "string" },
          jiraKey: { type: "string" },
          note: { type: "string" },
        },
        required: ["accountId", "title"],
        additionalProperties: false,
      },
      confirm: "always",
      invalidate: ["today", "team-tracker", "workload", "manager-desk"],
      label: () => "Assigning task…",
      summarize: (args) =>
        `Assign "${String(args.title ?? "")}" to ${String(args.accountId ?? "developer")}${args.date ? ` for ${String(args.date)}` : ""}`,
      execute: async (rawArgs, ctx) => {
        const args = parseArgs(
          z.object({
            accountId: z.string().trim().min(1),
            date: dateSchema.optional(),
            title: z.string().trim().min(1),
            jiraKey: z.string().trim().optional(),
            note: z.string().optional(),
          }),
          rawArgs
        );
        const item = await ctx.services.teamTrackerService.addItem(
          args.accountId,
          args.date ?? ctx.date,
          { title: args.title, jiraKey: args.jiraKey, note: args.note },
          ctx.workspaceId
        );
        return {
          result: compact({ id: item.id, title: item.title, state: item.state }),
          summary: `Assigned "${item.title}"`,
        };
      },
    },
    {
      name: "add_issue_comment",
      description: "Add a comment to a Jira issue. This writes to Jira directly.",
      parameters: {
        type: "object",
        properties: {
          jiraKey: { type: "string" },
          text: { type: "string" },
        },
        required: ["jiraKey", "text"],
        additionalProperties: false,
      },
      confirm: "always",
      jiraMutating: true,
      invalidate: ["issues"],
      label: (args) => `Commenting on ${String(args.jiraKey ?? "issue")}…`,
      summarize: (args) => `Comment on ${String(args.jiraKey ?? "issue")}`,
      execute: async (rawArgs, ctx) => {
        const args = parseArgs(
          z.object({ jiraKey: z.string().trim().min(1), text: z.string().min(1) }),
          rawArgs
        );
        await ctx.services.issueService.addComment(args.jiraKey, args.text, ctx.workspaceId);
        return { result: { ok: true, jiraKey: args.jiraKey }, summary: `Commented on ${args.jiraKey}` };
      },
    },
    {
      name: "update_issue_fields",
      description:
        "Update Jira fields on an issue (assignee, priority, due dates, flagged) or local analysis notes. This writes to Jira directly.",
      parameters: {
        type: "object",
        properties: {
          jiraKey: { type: "string" },
          assigneeId: { type: "string", description: "Jira account id of the new assignee" },
          priorityName: { type: "string" },
          dueDate: dateProperty("YYYY-MM-DD"),
          developmentDueDate: dateProperty("YYYY-MM-DD"),
          flagged: { type: "boolean" },
          analysisNotes: { type: "string", description: "Local-only notes, not sent to Jira" },
        },
        required: ["jiraKey"],
        additionalProperties: false,
      },
      confirm: "always",
      jiraMutating: true,
      invalidate: ["issues", "today", "workload"],
      label: (args) => `Updating ${String(args.jiraKey ?? "issue")}…`,
      summarize: (args) => `Update fields on ${String(args.jiraKey ?? "issue")}`,
      execute: async (rawArgs, ctx) => {
        const args = parseArgs(
          z.object({
            jiraKey: z.string().trim().min(1),
            assigneeId: z.string().trim().optional(),
            priorityName: z.string().trim().optional(),
            dueDate: dateSchema.optional(),
            developmentDueDate: dateSchema.optional(),
            flagged: z.boolean().optional(),
            analysisNotes: z.string().optional(),
          }),
          rawArgs
        );
        const { jiraKey, ...fields } = args;
        const issue = await ctx.services.issueService.update(jiraKey, fields, ctx.workspaceId);
        return {
          result: compact({
            jiraKey: issue.jiraKey,
            statusName: issue.statusName,
            priorityName: issue.priorityName,
            assigneeName: issue.assigneeName,
            dueDate: issue.dueDate,
            developmentDueDate: issue.developmentDueDate,
            flagged: issue.flagged,
          }),
          summary: `Updated ${issue.jiraKey}`,
        };
      },
    },
    {
      name: "append_daily_note",
      description: "Append a line to the manager's private daily note for a date.",
      parameters: {
        type: "object",
        properties: {
          date: dateProperty("YYYY-MM-DD; defaults to today"),
          text: { type: "string" },
        },
        required: ["text"],
        additionalProperties: false,
      },
      confirm: "always",
      invalidate: ["daily-notes", "global-search"],
      label: () => "Appending to daily note…",
      summarize: (args) => `Append to ${String(args.date ?? "today")}'s daily note`,
      execute: async (rawArgs, ctx) => {
        const args = parseArgs(
          z.object({ date: dateSchema.optional(), text: z.string().min(1) }),
          rawArgs
        );
        const date = args.date ?? ctx.date;
        const response = await ctx.services.dailyNotesService.append(
          ctx.managerAccountId,
          date,
          { text: args.text, requestId: `assistant-${ctx.toolCallId ?? randomUUID()}` },
          ctx.workspaceId
        );
        return {
          result: { ok: true, date, noteId: response.note?.id },
          summary: `Appended to daily note for ${date}`,
        };
      },
    },
    {
      name: "trigger_jira_sync",
      description: "Trigger an immediate Jira sync for this workspace.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      confirm: "always",
      invalidate: ["issues", "syncStatus", "today", "workload"],
      label: () => "Triggering Jira sync…",
      summarize: () => "Trigger a Jira sync now",
      execute: async (_args, ctx) => {
        const result = await ctx.services.syncEngine.syncNow(ctx.workspaceId);
        return {
          result: compact(result),
          summary: `Triggered Jira sync (${result.status})`,
        };
      },
    },
    {
      name: "update_tracker_item",
      description:
        "Update a Team Tracker item: rename it, change its state (planned/in_progress/done/dropped), edit its note, or reorder it.",
      parameters: {
        type: "object",
        properties: {
          itemId: { type: "integer" },
          title: { type: "string" },
          state: { type: "string", enum: ["planned", "in_progress", "done", "dropped"] },
          note: { type: ["string", "null"] },
          position: { type: "integer" },
        },
        required: ["itemId"],
        additionalProperties: false,
      },
      confirm: "always",
      invalidate: ["today", "team-tracker", "workload", "manager-desk"],
      label: () => "Updating tracker item…",
      summarize: (args) => `Update tracker item #${String(args.itemId ?? "?")}`,
      execute: async (rawArgs, ctx) => {
        const args = parseArgs(
          z.object({
            itemId: z.number().int().positive(),
            title: z.string().trim().min(1).max(500).optional(),
            state: z.enum(["planned", "in_progress", "done", "dropped"]).optional(),
            note: z.string().trim().max(2000).nullable().optional(),
            position: z.number().int().min(0).optional(),
          }),
          rawArgs
        );
        const { itemId, ...updates } = args;
        const item = await ctx.services.teamTrackerService.updateItem(itemId, updates, ctx.workspaceId);
        return {
          result: compact({ id: item.id, title: item.title, state: item.state }),
          summary: `Updated tracker item #${item.id}`,
        };
      },
    },
    {
      name: "delete_tracker_item",
      description: "Permanently delete a Team Tracker item. Prefer update_tracker_item with state=dropped when history should be kept.",
      parameters: {
        type: "object",
        properties: { itemId: { type: "integer" } },
        required: ["itemId"],
        additionalProperties: false,
      },
      confirm: "always",
      invalidate: ["today", "team-tracker", "workload", "manager-desk"],
      label: () => "Deleting tracker item…",
      summarize: (args) => `Delete tracker item #${String(args.itemId ?? "?")} permanently`,
      execute: async (rawArgs, ctx) => {
        const args = parseArgs(z.object({ itemId: z.number().int().positive() }), rawArgs);
        await ctx.services.teamTrackerService.deleteItem(args.itemId, undefined, ctx.workspaceId);
        return { result: { ok: true, itemId: args.itemId }, summary: `Deleted tracker item #${args.itemId}` };
      },
    },
    {
      name: "update_developer_day",
      description:
        "Update a developer's day on the Team Tracker: status (on_track/at_risk/blocked/waiting/done_for_today), capacity units, or manager notes.",
      parameters: {
        type: "object",
        properties: {
          accountId: { type: "string", description: "Developer account id" },
          date: dateProperty("YYYY-MM-DD; defaults to today"),
          status: { type: "string", enum: ["on_track", "at_risk", "blocked", "waiting", "done_for_today"] },
          capacityUnits: { type: ["integer", "null"] },
          managerNotes: { type: "string" },
        },
        required: ["accountId"],
        additionalProperties: false,
      },
      confirm: "always",
      invalidate: ["team-tracker", "today", "workload"],
      label: (args) => `Updating ${String(args.accountId ?? "developer")}'s day…`,
      summarize: (args) => `Update ${String(args.accountId ?? "developer")}'s day`,
      execute: async (rawArgs, ctx) => {
        const args = parseArgs(
          z.object({
            accountId: z.string().trim().min(1),
            date: dateSchema.optional(),
            status: z.enum(["on_track", "at_risk", "blocked", "waiting", "done_for_today"]).optional(),
            capacityUnits: z.number().int().min(1).nullable().optional(),
            managerNotes: z.string().trim().optional(),
          }),
          rawArgs
        );
        const day = await ctx.services.teamTrackerService.updateDay(
          args.accountId,
          args.date ?? ctx.date,
          { status: args.status, capacityUnits: args.capacityUnits, managerNotes: args.managerNotes },
          ctx.workspaceId
        );
        return {
          result: compact({ date: day.date, status: day.status }),
          summary: `Updated ${args.accountId}'s day`,
        };
      },
    },
    {
      name: "update_developer_availability",
      description:
        "Mark a developer active or inactive (e.g. out of office / leave) starting from a date.",
      parameters: {
        type: "object",
        properties: {
          accountId: { type: "string", description: "Developer account id" },
          effectiveDate: dateProperty("YYYY-MM-DD; defaults to today"),
          state: { type: "string", enum: ["active", "inactive"] },
          note: { type: "string" },
        },
        required: ["accountId", "state"],
        additionalProperties: false,
      },
      confirm: "always",
      invalidate: ["team-tracker", "today", "workload", "manager-actions"],
      label: (args) => `Setting ${String(args.accountId ?? "developer")} ${String(args.state ?? "")}…`,
      summarize: (args) =>
        `Mark ${String(args.accountId ?? "developer")} ${String(args.state ?? "?")} from ${String(args.effectiveDate ?? "today")}`,
      execute: async (rawArgs, ctx) => {
        const args = parseArgs(
          z.object({
            accountId: z.string().trim().min(1),
            effectiveDate: dateSchema.optional(),
            state: z.enum(["active", "inactive"]),
            note: z.string().trim().max(500).optional(),
          }),
          rawArgs
        );
        const availability = await ctx.services.teamTrackerService.updateAvailability(
          args.accountId,
          { effectiveDate: args.effectiveDate ?? ctx.date, state: args.state, note: args.note },
          ctx.workspaceId
        );
        return { result: compact(availability), summary: `Set ${args.accountId} to ${args.state}` };
      },
    },
    {
      name: "record_status_update",
      description:
        "Record a manager-authored status update on a developer's day (status + rationale/summary/next follow-up). Different from add_check_in, which logs the developer's own check-in text.",
      parameters: {
        type: "object",
        properties: {
          accountId: { type: "string", description: "Developer account id" },
          date: dateProperty("YYYY-MM-DD; defaults to today"),
          status: { type: "string", enum: ["on_track", "at_risk", "blocked", "waiting", "done_for_today"] },
          rationale: { type: "string", description: "Required when status is blocked or at_risk" },
          summary: { type: "string" },
          nextFollowUpAt: { type: ["string", "null"], description: "ISO datetime for the next follow-up" },
        },
        required: ["accountId", "status"],
        additionalProperties: false,
      },
      confirm: "always",
      invalidate: ["team-tracker", "today", "manager-actions", "alerts"],
      label: (args) => `Recording ${String(args.status ?? "status")} for ${String(args.accountId ?? "developer")}…`,
      summarize: (args) => `Set ${String(args.accountId ?? "developer")} to ${String(args.status ?? "?")}`,
      execute: async (rawArgs, ctx) => {
        const args = parseArgs(
          z.object({
            accountId: z.string().trim().min(1),
            date: dateSchema.optional(),
            status: z.enum(["on_track", "at_risk", "blocked", "waiting", "done_for_today"]),
            rationale: z.string().trim().max(2000).optional(),
            summary: z.string().trim().max(2000).optional(),
            nextFollowUpAt: z.string().nullable().optional(),
          }),
          rawArgs
        );
        const day = await ctx.services.teamTrackerService.recordStatusUpdate(
          args.accountId,
          args.date ?? ctx.date,
          {
            status: args.status,
            rationale: args.rationale,
            summary: args.summary,
            nextFollowUpAt: args.nextFollowUpAt ?? undefined,
          },
          ctx.actor,
          ctx.workspaceId
        );
        return {
          result: compact({ date: day.date, status: day.status }),
          summary: `Recorded ${args.status} for ${args.accountId}`,
        };
      },
    },
    {
      name: "carry_forward",
      description:
        "Carry forward unfinished work from one date to another — surface=tracker moves developer day items (and their linked desk items); surface=desk moves manager desk items. Use preview_carry_forward first if unsure what would move.",
      parameters: {
        type: "object",
        properties: {
          surface: { type: "string", enum: ["desk", "tracker"] },
          fromDate: dateProperty("YYYY-MM-DD"),
          toDate: dateProperty("YYYY-MM-DD"),
          itemIds: { type: "array", items: { type: "integer" }, description: "Limit to these items; omit to carry everything pending" },
        },
        required: ["surface", "fromDate", "toDate"],
        additionalProperties: false,
      },
      confirm: "always",
      invalidate: ["today", "team-tracker", "manager-desk", "workload", "carry-forward-context", "carry-forward-preview"],
      label: (args) => `Carrying ${String(args.surface ?? "items")} forward…`,
      summarize: (args) =>
        `Carry ${String(args.surface ?? "items")} forward ${String(args.fromDate ?? "?")} → ${String(args.toDate ?? "?")}`,
      execute: async (rawArgs, ctx) => {
        const args = parseArgs(
          z.object({
            surface: z.enum(["desk", "tracker"]),
            fromDate: dateSchema,
            toDate: dateSchema,
            itemIds: z.array(z.number().int().positive()).optional(),
          }),
          rawArgs
        );
        const carried =
          args.surface === "desk"
            ? await ctx.services.managerDeskService.carryForward(
                ctx.managerAccountId,
                { fromDate: args.fromDate, toDate: args.toDate, itemIds: args.itemIds },
                ctx.workspaceId
              )
            : await ctx.services.teamTrackerService.carryForward(
                args.fromDate,
                args.toDate,
                {
                  itemIds: args.itemIds,
                  carryManagerDeskItems: (params) =>
                    ctx.services.managerDeskService.moveLinkedItemsToDate(
                      ctx.managerAccountId,
                      params,
                      ctx.workspaceId
                    ),
                },
                ctx.workspaceId
              );
        return { result: { carried }, summary: `Carried ${carried} ${args.surface} items forward` };
      },
    },
    {
      name: "delete_desk_item",
      description: "Permanently delete a Manager Desk item. Prefer status=cancelled via update_desk_item when history should be kept.",
      parameters: {
        type: "object",
        properties: { itemId: { type: "integer" } },
        required: ["itemId"],
        additionalProperties: false,
      },
      confirm: "always",
      invalidate: ["today", "manager-actions", "manager-desk", "daily-notes", "team-tracker"],
      label: () => "Deleting desk item…",
      summarize: (args) => `Delete desk item #${String(args.itemId ?? "?")} permanently`,
      execute: async (rawArgs, ctx) => {
        const args = parseArgs(z.object({ itemId: z.number().int().positive() }), rawArgs);
        await ctx.services.managerDeskService.deleteItem(ctx.managerAccountId, args.itemId, ctx.workspaceId);
        return { result: { ok: true, itemId: args.itemId }, summary: `Deleted desk item #${args.itemId}` };
      },
    },
    {
      name: "link_desk_item",
      description:
        "Link a Jira issue, a developer, or a free-text group to an existing Manager Desk item.",
      parameters: {
        type: "object",
        properties: {
          itemId: { type: "integer" },
          linkType: { type: "string", enum: ["issue", "developer", "external_group"] },
          issueKey: { type: "string", description: "Required when linkType=issue" },
          developerAccountId: { type: "string", description: "Required when linkType=developer" },
          externalLabel: { type: "string", description: "Required when linkType=external_group" },
        },
        required: ["itemId", "linkType"],
        additionalProperties: false,
      },
      confirm: "always",
      invalidate: ["manager-desk", "team-tracker", "today"],
      label: () => "Linking desk item…",
      summarize: (args) =>
        `Link ${String(args.issueKey ?? args.developerAccountId ?? args.externalLabel ?? "?")} to desk item #${String(args.itemId ?? "?")}`,
      execute: async (rawArgs, ctx) => {
        const args = parseArgs(
          z
            .object({
              itemId: z.number().int().positive(),
              linkType: z.enum(["issue", "developer", "external_group"]),
              issueKey: z.string().trim().min(1).max(100).optional(),
              developerAccountId: z.string().trim().min(1).max(200).optional(),
              externalLabel: z.string().trim().min(1).max(300).optional(),
            })
            .refine(
              (v) =>
                (v.linkType === "issue" && Boolean(v.issueKey)) ||
                (v.linkType === "developer" && Boolean(v.developerAccountId)) ||
                (v.linkType === "external_group" && Boolean(v.externalLabel)),
              { message: "link payload must match linkType" }
            ),
          rawArgs
        );
        const link = await ctx.services.managerDeskService.addLink(
          ctx.managerAccountId,
          args.itemId,
          {
            linkType: args.linkType,
            issueKey: args.issueKey,
            developerAccountId: args.developerAccountId,
            externalLabel: args.externalLabel,
          },
          ctx.workspaceId
        );
        return { result: compact(link), summary: `Linked to desk item #${args.itemId}` };
      },
    },
    {
      name: "unlink_desk_item",
      description: "Remove a link from a Manager Desk item. Get linkId from get_desk_item_detail.",
      parameters: {
        type: "object",
        properties: {
          itemId: { type: "integer" },
          linkId: { type: "integer" },
        },
        required: ["itemId", "linkId"],
        additionalProperties: false,
      },
      confirm: "always",
      invalidate: ["manager-desk", "team-tracker", "today"],
      label: () => "Removing link…",
      summarize: (args) => `Remove link #${String(args.linkId ?? "?")} from desk item #${String(args.itemId ?? "?")}`,
      execute: async (rawArgs, ctx) => {
        const args = parseArgs(
          z.object({ itemId: z.number().int().positive(), linkId: z.number().int().positive() }),
          rawArgs
        );
        await ctx.services.managerDeskService.deleteLink(
          ctx.managerAccountId,
          args.itemId,
          args.linkId,
          ctx.workspaceId
        );
        return { result: { ok: true }, summary: `Removed link #${args.linkId}` };
      },
    },
    {
      name: "promote_tracker_item",
      description:
        "Promote a Team Tracker item into a Manager Desk item (creates a linked desk item so it shows up in follow-ups/meetings).",
      parameters: {
        type: "object",
        properties: { trackerItemId: { type: "integer" } },
        required: ["trackerItemId"],
        additionalProperties: false,
      },
      confirm: "always",
      invalidate: ["manager-desk", "team-tracker", "today", "manager-actions"],
      label: () => "Promoting tracker item…",
      summarize: (args) => `Promote tracker item #${String(args.trackerItemId ?? "?")} to Desk`,
      execute: async (rawArgs, ctx) => {
        const args = parseArgs(z.object({ trackerItemId: z.number().int().positive() }), rawArgs);
        const detail = await ctx.services.managerDeskService.promoteTrackerTask(
          ctx.managerAccountId,
          args.trackerItemId,
          ctx.workspaceId
        );
        return { result: compact(detail), summary: `Promoted tracker item #${args.trackerItemId}` };
      },
    },
    {
      name: "cancel_delegated_task",
      description:
        "Cancel the tracker task delegated from a Manager Desk item — cancels both sides (desk item goes to cancelled).",
      parameters: {
        type: "object",
        properties: { itemId: { type: "integer", description: "Desk item id" } },
        required: ["itemId"],
        additionalProperties: false,
      },
      confirm: "always",
      invalidate: ["manager-desk", "team-tracker", "today", "manager-actions"],
      label: () => "Cancelling delegated task…",
      summarize: (args) => `Cancel delegated task for desk item #${String(args.itemId ?? "?")}`,
      execute: async (rawArgs, ctx) => {
        const args = parseArgs(z.object({ itemId: z.number().int().positive() }), rawArgs);
        const item = await ctx.services.managerDeskService.cancelDelegatedTask(
          ctx.managerAccountId,
          args.itemId,
          ctx.workspaceId
        );
        return { result: compact({ id: item.id, status: item.status }), summary: `Cancelled delegated task #${args.itemId}` };
      },
    },
    {
      name: "set_issue_excluded",
      description:
        "Exclude an issue from the Work board (local hide — does not touch Jira) or restore a previously excluded one.",
      parameters: {
        type: "object",
        properties: {
          jiraKey: { type: "string" },
          excluded: { type: "boolean" },
        },
        required: ["jiraKey", "excluded"],
        additionalProperties: false,
      },
      confirm: "always",
      invalidate: ["issues", "issue", "today", "workload"],
      label: (args) => `${args.excluded === false ? "Restoring" : "Excluding"} ${String(args.jiraKey ?? "issue")}…`,
      summarize: (args) => `${args.excluded === false ? "Restore" : "Exclude"} ${String(args.jiraKey ?? "issue")}`,
      execute: async (rawArgs, ctx) => {
        const args = parseArgs(
          z.object({ jiraKey: z.string().trim().min(1), excluded: z.boolean() }),
          rawArgs
        );
        if (args.excluded) {
          await ctx.services.issueService.excludeIssue(args.jiraKey, ctx.workspaceId);
        } else {
          await ctx.services.issueService.restoreIssue(args.jiraKey, ctx.workspaceId);
        }
        return {
          result: { ok: true, jiraKey: args.jiraKey, excluded: args.excluded },
          summary: `${args.excluded ? "Excluded" : "Restored"} ${args.jiraKey}`,
        };
      },
    },
    {
      name: "set_issue_tags",
      description:
        "Replace the local tags on an issue (local only — not sent to Jira). Get tag ids from list_tags; pass an empty array to clear tags.",
      parameters: {
        type: "object",
        properties: {
          jiraKey: { type: "string" },
          tagIds: { type: "array", items: { type: "integer" } },
        },
        required: ["jiraKey", "tagIds"],
        additionalProperties: false,
      },
      confirm: "always",
      invalidate: ["issues", "issue", "tags", "tagCounts"],
      label: (args) => `Tagging ${String(args.jiraKey ?? "issue")}…`,
      summarize: (args) => `Set tags on ${String(args.jiraKey ?? "issue")}`,
      execute: async (rawArgs, ctx) => {
        const args = parseArgs(
          z.object({
            jiraKey: z.string().trim().min(1),
            tagIds: z.array(z.number().int().positive()).max(20),
          }),
          rawArgs
        );
        const tags = await ctx.services.tagService.setIssueTags(args.jiraKey, args.tagIds, ctx.workspaceId);
        return { result: compact({ jiraKey: args.jiraKey, tags }), summary: `Tagged ${args.jiraKey}` };
      },
    },
    {
      name: "dismiss_alerts",
      description: "Dismiss alerts from the manager attention inbox. Get alert ids from get_alerts.",
      parameters: {
        type: "object",
        properties: { alertIds: { type: "array", items: { type: "string" } } },
        required: ["alertIds"],
        additionalProperties: false,
      },
      confirm: "always",
      invalidate: ["alerts", "today", "manager-actions"],
      label: () => "Dismissing alerts…",
      summarize: (args) => `Dismiss ${Array.isArray(args.alertIds) ? args.alertIds.length : "?"} alert(s)`,
      execute: async (rawArgs, ctx) => {
        const args = parseArgs(
          z.object({ alertIds: z.array(z.string().trim().min(1)).min(1).max(50) }),
          rawArgs
        );
        const dismissed = await ctx.services.alertService.dismissAlerts(
          ctx.managerAccountId,
          args.alertIds,
          ctx.workspaceId
        );
        return { result: { dismissed }, summary: `Dismissed ${dismissed.length} alert(s)` };
      },
    },
    {
      name: "replace_daily_note",
      description:
        "Replace the entire body of the manager's private daily note for a date. Prefer append_daily_note for additions — this overwrites.",
      parameters: {
        type: "object",
        properties: {
          date: dateProperty("YYYY-MM-DD; defaults to today"),
          body: { type: "string", description: "Complete new note body" },
        },
        required: ["body"],
        additionalProperties: false,
      },
      confirm: "always",
      invalidate: ["daily-notes", "global-search"],
      label: () => "Rewriting daily note…",
      summarize: (args) => `Replace ${String(args.date ?? "today")}'s daily note`,
      execute: async (rawArgs, ctx) => {
        const args = parseArgs(
          z.object({ date: dateSchema.optional(), body: z.string().max(20000) }),
          rawArgs
        );
        const date = args.date ?? ctx.date;
        const current = await ctx.services.dailyNotesService.getDay(ctx.managerAccountId, date, ctx.workspaceId);
        const response = await ctx.services.dailyNotesService.save(
          ctx.managerAccountId,
          date,
          { body: args.body, revision: current.note?.revision ?? 0 },
          ctx.workspaceId
        );
        return {
          result: { ok: true, date, noteId: response.note?.id },
          summary: `Replaced daily note for ${date}`,
        };
      },
    },
    {
      name: "save_memory",
      description:
        "Save a durable memory about the manager's preferences or recurring facts (e.g. \"Priya prefers async updates\", \"deploys are Fridays\"). Use when the manager says to remember something or states a stable preference — not for one-off tasks or dated facts.",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string", description: "One short fact or preference (max 300 chars)" },
        },
        required: ["text"],
        additionalProperties: false,
      },
      confirm: "always",
      invalidate: ["assistant", "memory"],
      label: () => "Saving memory…",
      summarize: (args) => `Remember: "${String(args.text ?? "")}"`,
      execute: async (rawArgs, ctx) => {
        const args = parseArgs(z.object({ text: z.string().trim().min(1).max(300) }), rawArgs);
        const memory = await ctx.services.memoryService.add(ctx.managerAccountId, args.text, ctx.workspaceId);
        return { result: { memory }, summary: "Saved to memory" };
      },
    },
  ];

  return [...readTools, ...writeTools];
}

export function toLlmToolDefinitions(tools: AssistantToolDefinition[]): LlmToolDefinition[] {
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}
