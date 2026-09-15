import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { UserRole } from "shared/types";
import { HttpError } from "../middleware/errorHandler";
import type { AlertService } from "../services/alert.service";
import type { DailyNotesService } from "../services/daily-notes.service";
import type { IssueService } from "../services/issue.service";
import type { ManagerDeskService } from "../services/manager-desk.service";
import type { SearchService } from "../services/search.service";
import type { TeamTrackerService } from "../services/team-tracker.service";
import type { TodayService } from "../services/today.service";
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
