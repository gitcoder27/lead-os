import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { ManagerTask, TaskSavedView, TaskStatus, TaskViewDefinition, TaskViewFilters, TaskViewMeta } from "shared/types";
import { db } from "../db/connection";
import { taskLinks, taskSavedViews, tasks } from "../db/schema";
import { HttpError } from "../middleware/errorHandler";
import { todayIsoDate } from "../utils/date";
import { TaskEventsService } from "./task-events.service";
import { JiraDriftService } from "./jira-drift.service";
import { TaskService, type TaskPrincipal, type TaskRow } from "./task.service";
import { normalizeWorkspaceId } from "./workspace.service";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const dateRange = z.object({ from: isoDate.optional(), to: isoDate.optional() }).strict();

/**
 * Phase 3 (P3-D9, §5.2): the validated view-definition schema. Closed tasks
 * require an explicit `closed` range so no view can scan all history.
 */
export const taskViewDefinitionSchema = z.object({
  filters: z.object({
    owner: z.union([z.enum(["me", "team", "inbox"]), z.array(z.string().trim().min(1).max(128)).min(1).max(50)]).optional(),
    status: z.array(z.enum(["open", "active", "blocked", "done", "dropped"])).min(1).max(5).optional(),
    labels: z.array(z.string().trim().min(1).max(64)).min(1).max(20).optional(),
    linkedJira: z.boolean().optional(),
    kind: z.enum(["task", "meeting"]).optional(),
    later: z.boolean().optional(),
    scheduled: dateRange.optional(),
    closed: dateRange.optional(),
    followUp: z.boolean().optional(),
    staleDays: z.number().int().min(1).max(365).optional(),
    jiraDrift: z.boolean().optional(),
  }).strict().optional(),
  sort: z.enum(["scheduled", "updated", "created", "priority"]).optional(),
  group: z.enum(["owner", "status", "label", "scheduled"]).optional(),
}).strict();

export function parseTaskViewDefinition(raw: unknown): TaskViewDefinition {
  const result = taskViewDefinitionSchema.safeParse(raw);
  if (!result.success) throw new HttpError(400, `Invalid view definition: ${result.error.issues[0]?.message ?? "bad shape"}`);
  return result.data as TaskViewDefinition;
}

/** Decode a `?viewDef=` base64url payload into a validated definition. */
export function decodeTaskViewDefinition(encoded: string): TaskViewDefinition {
  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    throw new HttpError(400, "Invalid viewDef: not base64url JSON");
  }
  return parseTaskViewDefinition(raw);
}

export function encodeTaskViewDefinition(def: TaskViewDefinition): string {
  return Buffer.from(JSON.stringify(def), "utf8").toString("base64url");
}

function shiftDays(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** Monday of the week containing `today` (ISO weeks). */
function weekStart(today: string): string {
  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();
  return shiftDays(today, -((weekday + 6) % 7));
}

/**
 * Built-in views (§5.2) — code, not rows. Dynamic ranges (closed this week)
 * resolve against the caller's today.
 */
export function builtinTaskViews(today: string): { id: string; name: string; definition: TaskViewDefinition }[] {
  return [
    { id: "today-plan", name: "Today plan", definition: { filters: { owner: "me", status: ["open", "active", "blocked"] }, sort: "scheduled", group: "scheduled" } },
    { id: "my-tasks", name: "My tasks", definition: { filters: { owner: "me" }, sort: "scheduled", group: "status" } },
    { id: "watching", name: "Watching", definition: { filters: { owner: "team" }, sort: "updated", group: "owner" } },
    { id: "inbox", name: "Inbox", definition: { filters: { owner: "inbox", status: ["open"] }, sort: "created" } },
    { id: "follow-ups", name: "Follow-ups", definition: { filters: { followUp: true }, sort: "scheduled", group: "scheduled" } },
    { id: "meetings", name: "Meetings", definition: { filters: { kind: "meeting" }, sort: "scheduled", group: "scheduled" } },
    { id: "blocked", name: "Blocked", definition: { filters: { status: ["blocked"] }, sort: "updated", group: "owner" } },
    { id: "stale", name: "Stale", definition: { filters: { status: ["open", "active", "blocked"], staleDays: 5 }, sort: "updated" } },
    // §8.1: tasks whose primary Jira link disagrees on done-ness.
    { id: "jira-drift", name: "Jira drift", definition: { filters: { jiraDrift: true }, sort: "updated" } },
    { id: "later", name: "Later", definition: { filters: { later: true }, sort: "created" } },
    { id: "closed-week", name: "Closed this week", definition: { filters: { closed: { from: weekStart(today), to: today } }, sort: "updated" } },
  ];
}

const FOLLOW_UP_LABEL = "category:follow_up";

function labelsOf(row: TaskRow): string[] {
  try {
    return JSON.parse(row.labelsJson ?? "[]") as string[];
  } catch {
    return [];
  }
}

function inRange(value: string | null, range: { from?: string; to?: string }): boolean {
  if (!value) return false;
  if (range.from && value < range.from) return false;
  if (range.to && value > range.to) return false;
  return true;
}

function rowMatchesFilters(row: TaskRow, filters: TaskViewFilters, principal: TaskPrincipal): boolean {
  if (filters.owner !== undefined) {
    const owner = filters.owner;
    if (owner === "me") {
      if (!(row.ownerType === "manager" && row.ownerId === principal.accountId)) return false;
    } else if (owner === "team") {
      if (row.ownerType !== "developer") return false;
    } else if (owner === "inbox") {
      if (row.ownerType !== null) return false;
    } else if (!owner.includes(row.ownerId ?? "")) {
      return false;
    }
  }
  if (filters.status && !filters.status.includes(row.status as TaskStatus)) return false;
  if (filters.labels) {
    const labels = labelsOf(row);
    if (!filters.labels.every((label) => labels.includes(label))) return false;
  }
  if (filters.followUp && !row.followUpAt && !labelsOf(row).includes(FOLLOW_UP_LABEL)) return false;
  if (filters.kind && row.kind !== filters.kind) return false;
  if (filters.later !== undefined && (row.later === 1) !== filters.later) return false;
  if (filters.scheduled && !inRange(row.scheduledOn, filters.scheduled)) return false;
  // Closed tasks are only reachable through a bounded closed range (§5.2);
  // the jiraDrift predicate applies its own 7-day closed window (§8.1).
  if (filters.closed) {
    if (!inRange(row.closedAt ? row.closedAt.slice(0, 10) : null, filters.closed)) return false;
  } else if (row.closedAt && !filters.jiraDrift) {
    return false;
  }
  return true;
}

function sortRows(rows: TaskRow[], sort: TaskViewDefinition["sort"]): TaskRow[] {
  const byScheduled = (a: TaskRow, b: TaskRow) =>
    (a.scheduledOn ?? "9999-12-31").localeCompare(b.scheduledOn ?? "9999-12-31") || a.createdAt.localeCompare(b.createdAt) || a.id - b.id;
  const sorted = [...rows];
  switch (sort ?? "scheduled") {
    case "updated":
      return sorted.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id - b.id);
    case "created":
      return sorted.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id - b.id);
    case "priority":
      return sorted.sort((a, b) => Number(b.priority === "high") - Number(a.priority === "high") || byScheduled(a, b));
    default:
      return sorted.sort(byScheduled);
  }
}

export class TaskViewsService {
  constructor(
    private readonly taskService = new TaskService(),
    private readonly events = new TaskEventsService(),
    private readonly drift = new JiraDriftService(),
  ) {}

  /**
   * Manager-scoped rows: tasks I track, tasks I own, and unowned inbox tasks —
   * never another manager's private tasks.
   */
  private async candidateRows(principal: TaskPrincipal): Promise<TaskRow[]> {
    const scope = normalizeWorkspaceId(principal.workspaceId);
    return db.select().from(tasks).where(and(
      eq(tasks.workspaceId, scope),
      isNull(tasks.deletedAt),
      principal.type === "developer"
        ? and(eq(tasks.ownerType, "developer"), eq(tasks.ownerId, principal.accountId))
        : sql`(${tasks.trackedByManagerId} = ${principal.accountId} OR (${tasks.ownerType} = 'manager' AND ${tasks.ownerId} = ${principal.accountId}) OR ${tasks.ownerType} IS NULL)`,
    ));
  }

  /** Execute a validated view definition — batched link/event lookups, no per-row scans. */
  async run(principal: TaskPrincipal, definition: TaskViewDefinition): Promise<ManagerTask[]> {
    const scope = normalizeWorkspaceId(principal.workspaceId);
    const filters = definition.filters ?? {};
    let rows = (await this.candidateRows(principal)).filter((row) => rowMatchesFilters(row, filters, principal));

    if (filters.linkedJira && rows.length) {
      const linked = new Set(
        (await db.select({ taskId: taskLinks.taskId }).from(taskLinks)
          .where(and(eq(taskLinks.workspaceId, scope), inArray(taskLinks.taskId, rows.map((row) => row.id)), eq(taskLinks.kind, "jira"))))
          .map((row) => row.taskId),
      );
      rows = rows.filter((row) => linked.has(row.id));
    }

    if (filters.jiraDrift && rows.length) {
      const drifted = new Set(
        (await this.drift.list(principal, scope, undefined, rows.map((row) => row.id))).map((entry) => entry.taskId),
      );
      rows = rows.filter((row) => drifted.has(row.id));
    }

    if (filters.staleDays !== undefined && rows.length) {
      const lastEventByTask = await this.events.latestActivityByTask(rows.map((row) => row.id), scope);
      const cutoff = shiftDays(todayIsoDate(), -filters.staleDays);
      rows = rows.filter((row) => (lastEventByTask.get(row.id) ?? row.updatedAt).slice(0, 10) <= cutoff);
    }

    return (await this.taskService.toDtos(sortRows(rows, definition.sort), principal)) as ManagerTask[];
  }

  /** Built-ins + this manager's saved views (P3-D10: saved views are private). */
  async list(managerAccountId: string, workspaceId?: string): Promise<TaskViewMeta[]> {
    const scope = normalizeWorkspaceId(workspaceId);
    const today = todayIsoDate();
    const saved = await this.savedRows(managerAccountId, scope);
    return [
      ...builtinTaskViews(today).map((view) => ({ id: view.id, name: view.name, builtin: true, definition: view.definition })),
      ...saved.map((row) => ({ id: `saved:${row.id}`, name: row.name, builtin: false, definition: parseTaskViewDefinition(JSON.parse(row.definitionJson)) })),
    ];
  }

  private async savedRows(managerAccountId: string, workspaceId: string) {
    return db.select().from(taskSavedViews).where(and(
      eq(taskSavedViews.workspaceId, workspaceId),
      eq(taskSavedViews.managerAccountId, managerAccountId),
    )).orderBy(taskSavedViews.position, taskSavedViews.id);
  }

  async create(managerAccountId: string, input: { name: string; definition: unknown }, workspaceId?: string): Promise<TaskSavedView> {
    const scope = normalizeWorkspaceId(workspaceId);
    const name = input.name.trim();
    if (!name) throw new HttpError(400, "View name is required");
    const definition = parseTaskViewDefinition(input.definition);
    const existing = await this.savedRows(managerAccountId, scope);
    if (existing.some((entry) => entry.name === name)) throw new HttpError(409, "A saved view with this name already exists");
    const now = new Date().toISOString();
    const [row] = await db.insert(taskSavedViews).values({
      workspaceId: scope,
      managerAccountId,
      name,
      definitionJson: JSON.stringify(definition),
      position: existing.reduce((maxPosition, entry) => Math.max(maxPosition, entry.position), -1) + 1,
      createdAt: now,
      updatedAt: now,
    }).returning();
    return this.toSavedView(row!);
  }

  async update(managerAccountId: string, id: number, input: { name?: string; definition?: unknown; position?: number }, workspaceId?: string): Promise<TaskSavedView> {
    const scope = normalizeWorkspaceId(workspaceId);
    const row = await this.requireOwned(id, managerAccountId, scope);
    const next: Partial<typeof taskSavedViews.$inferInsert> = { updatedAt: new Date().toISOString() };
    if (input.name !== undefined) {
      const name = input.name.trim();
      if (!name) throw new HttpError(400, "View name is required");
      if (name !== row.name && (await this.savedRows(managerAccountId, scope)).some((entry) => entry.name === name)) {
        throw new HttpError(409, "A saved view with this name already exists");
      }
      next.name = name;
    }
    if (input.definition !== undefined) next.definitionJson = JSON.stringify(parseTaskViewDefinition(input.definition));
    if (input.position !== undefined) next.position = input.position;
    await db.update(taskSavedViews).set(next).where(eq(taskSavedViews.id, row.id));
    return this.toSavedView({ ...row, ...next } as typeof taskSavedViews.$inferSelect);
  }

  async remove(managerAccountId: string, id: number, workspaceId?: string): Promise<void> {
    const scope = normalizeWorkspaceId(workspaceId);
    const row = await this.requireOwned(id, managerAccountId, scope);
    await db.delete(taskSavedViews).where(eq(taskSavedViews.id, row.id));
  }

  /** P3-D10: saved views are reachable only by their owning manager. */
  private async requireOwned(id: number, managerAccountId: string, workspaceId: string) {
    const row = (await db.select().from(taskSavedViews).where(and(
      eq(taskSavedViews.id, id),
      eq(taskSavedViews.workspaceId, workspaceId),
      eq(taskSavedViews.managerAccountId, managerAccountId),
    )).limit(1))[0];
    if (!row) throw new HttpError(404, "Saved view not found");
    return row;
  }

  private toSavedView(row: typeof taskSavedViews.$inferSelect): TaskSavedView {
    return {
      id: row.id,
      name: row.name,
      definition: parseTaskViewDefinition(JSON.parse(row.definitionJson)),
      position: row.position,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
