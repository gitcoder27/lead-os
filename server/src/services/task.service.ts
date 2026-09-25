import { and, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { z } from "zod";
import type { CreateTaskRequest, DeveloperSurfaceTask, DeveloperTask, FormerOwnerTaskDetail, ManagerDeskAssignee, ManagerSurfaceTask, ManagerTask, SurfaceTask, TaskChildRef, TaskDetailResponse, TaskLink, TaskOwnerType, TaskStatus, UpdateTaskRequest } from "shared/types";
import { db } from "../db/connection";
import { checkinTaskRefs, configTable, dailyNoteFollowUps, dailyNoteTaskRefs, dayFocus, developers, issues, taskLegacyMap, taskLinks, tasks } from "../db/schema";
import { runInTransaction } from "../db/transaction";
import { HttpError } from "../middleware/errorHandler";
import { TaskKeysService } from "./task-keys.service";
import { TaskEventsService, type TaskEventInput } from "./task-events.service";
import { TaskLabelsService } from "./task-labels.service";
import { DeveloperAvailabilityService } from "./developer-availability.service";
import { normalizeWorkspaceId } from "./workspace.service";
import { isoDatePart, todayIsoDate } from "../utils/date";

export type TaskRow = typeof tasks.$inferSelect;
export type TaskLinkRow = typeof taskLinks.$inferSelect;
export type DayFocusRow = typeof dayFocus.$inferSelect;

export interface TaskPrincipal {
  type: "manager" | "developer" | "copilot";
  accountId: string;
  workspaceId?: string;
}

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value, "Invalid date");
const timestamp = z.string().datetime({ offset: true });
export const taskCreateSchema = z.object({
  title: z.string().trim().min(1).max(500),
  kind: z.enum(["task", "meeting"]).optional(), status: z.enum(["open", "active", "blocked", "done", "dropped"]).optional(),
  ownerType: z.enum(["manager", "developer"]).nullable().optional(), ownerId: z.string().trim().min(1).nullable().optional(),
  later: z.boolean().optional(), priority: z.enum(["normal", "high"]).optional(),
  labels: z.array(z.string().trim().min(1).max(100)).max(50).optional(),
  scheduledOn: dateOnly.nullable().optional(), dueAt: timestamp.nullable().optional(), followUpAt: timestamp.nullable().optional(),
  startsAt: timestamp.nullable().optional(), endsAt: timestamp.nullable().optional(),
  participants: z.string().max(4000).nullable().optional(), nextAction: z.string().max(4000).nullable().optional(), outcome: z.string().max(4000).nullable().optional(),
  parentId: z.number().int().positive().nullable().optional(),
}).strict();
export const taskUpdateSchema = taskCreateSchema.partial();
export const taskLinkSchema = z.object({ kind: z.enum(["jira", "person", "external", "task"]), ref: z.string().trim().min(1).max(2000), role: z.enum(["primary", "related"]).nullable().optional() }).strict();

function parseInput<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new HttpError(400, parsed.error.issues.map((issue) => issue.message).join(", "));
  return parsed.data;
}

function dayEnd(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(year!, month! - 1, day! + 1).toISOString();
}

function statusFromLegacy(value: string): string {
  return ({ planned: "open", inbox: "open", backlog: "open", in_progress: "active", waiting: "blocked", cancelled: "dropped" } as Record<string, string>)[value] ?? value;
}

// Normalised projection row used by the Phase 2 parity harness (§2.2.13). The
// `state` field carries the tracker vocabulary so it can be compared directly
// against legacy team_tracker_items.state.
export interface TaskProjection {
  taskKey: string;
  title: string;
  status: string;
  state: string;
  ownerType: string | null;
  ownerId: string | null;
}

export function taskStatusToTrackerState(status: string): string {
  switch (status) {
    case "active": return "in_progress";
    case "done": return "done";
    case "dropped": return "dropped";
    default: return "planned"; // open + blocked surface as planned work
  }
}

export function taskStatusToDeskStatus(status: string, later: number): string {
  if (later && status === "open") return "backlog";
  switch (status) {
    case "active": return "in_progress";
    case "blocked": return "waiting";
    case "done": return "done";
    case "dropped": return "cancelled";
    default: return "planned";
  }
}

function toProjection(row: TaskRow): TaskProjection {
  return {
    taskKey: row.taskKey,
    title: row.title,
    status: row.status,
    state: taskStatusToTrackerState(row.status),
    ownerType: row.ownerType,
    ownerId: row.ownerId,
  };
}

/**
 * Phase 2 canonical read surface. Shadow-only in stage 2a: nothing routes here
 * until the write cutover (2b) and the surface cutovers (2c). The projections
 * mirror the legacy queries so the backfill's --verify parity check can compare
 * them field-by-field.
 */
export class TaskService {
  private readonly keys = new TaskKeysService();
  private readonly events = new TaskEventsService(this.keys);

  async requireTask(key: string, principal: TaskPrincipal, includeDeleted = false, access: "read" | "write" = "write"): Promise<TaskRow> {
    const resolved = await this.keys.resolve(normalizeWorkspaceId(principal.workspaceId), key);
    const row = resolved ? await this.getByKey(resolved, principal.workspaceId) : undefined;
    if (principal.type === "developer") {
      if (!row || row.deletedAt) throw new HttpError(404, "Task not found");
      // Phase 3 (P3-D15): former owners (authored ≥1 event) may read, not write.
      const level = await this.events.developerAccess(resolved!, { kind: "developer", accountId: principal.accountId, workspaceId: principal.workspaceId });
      if (level === "none") throw new HttpError(404, "Task not found");
      if (level === "former" && access === "write") throw new HttpError(403, "Only the current owner can modify this task");
    } else if (!row) throw new HttpError(404, "Task not found");
    if (row.deletedAt && !includeDeleted) throw new HttpError(410, "Task was deleted");
    return row;
  }

  private rowToDto(row: TaskRow, links: TaskLinkRow[], legacyDeskItemId: number | undefined, principal: TaskPrincipal): DeveloperTask | ManagerTask {
    const shared: DeveloperTask = {
      id: row.id, taskKey: row.taskKey, title: row.title, kind: row.kind as DeveloperTask["kind"], status: row.status as TaskStatus,
      ownerType: row.ownerType as TaskOwnerType | null, ownerId: row.ownerId, priority: row.priority as DeveloperTask["priority"],
      scheduledOn: row.scheduledOn, dueAt: row.dueAt, startsAt: row.startsAt, endsAt: row.endsAt, participants: row.participants, outcome: row.outcome,
      createdByType: row.createdByType, createdById: row.createdById, createdAt: row.createdAt, updatedAt: row.updatedAt, closedAt: row.closedAt, deletedAt: row.deletedAt,
      links: links.map((link) => ({ id: link.id, kind: link.kind as TaskLink["kind"], ref: link.ref, role: link.role as TaskLink["role"] })),
    };
    if (principal.type === "developer") return shared;
    const ownsPrivate = row.trackedByManagerId === principal.accountId || (row.ownerType === "manager" && row.ownerId === principal.accountId);
    return { ...shared, legacyDeskItemId: legacyDeskItemId ?? row.id, later: row.later === 1, parentId: row.parentId, trackedByManagerId: ownsPrivate ? row.trackedByManagerId : null,
      labels: ownsPrivate ? JSON.parse(row.labelsJson ?? "[]") as string[] : [], nextAction: ownsPrivate ? row.nextAction : null, followUpAt: ownsPrivate ? row.followUpAt : null };
  }

  async toDto(row: TaskRow, principal: TaskPrincipal): Promise<DeveloperTask | ManagerTask> {
    const links = await this.listLinks([row.id], row.workspaceId);
    if (principal.type === "developer") return this.rowToDto(row, links, undefined, principal);
    const mapped = (await db.select().from(taskLegacyMap).where(and(eq(taskLegacyMap.workspaceId, row.workspaceId), eq(taskLegacyMap.taskId, row.id), eq(taskLegacyMap.sourceTable, "manager_desk_items"), eq(taskLegacyMap.role, "canonical"))).limit(1))[0];
    return this.rowToDto(row, links, mapped?.sourceId, principal);
  }

  /**
   * Batched `toDto` for list views (Phase 3, §5.2): links and legacy-map rows
   * are fetched once for the whole set instead of per task.
   */
  async toDtos(rows: TaskRow[], principal: TaskPrincipal): Promise<(DeveloperTask | ManagerTask)[]> {
    if (!rows.length) return [];
    const scope = normalizeWorkspaceId(principal.workspaceId);
    const ids = rows.map((row) => row.id);
    const [linkRows, mappedRows] = await Promise.all([
      this.listLinks(ids, scope),
      principal.type === "developer"
        ? Promise.resolve([])
        : db.select().from(taskLegacyMap).where(and(eq(taskLegacyMap.workspaceId, scope), inArray(taskLegacyMap.taskId, ids), eq(taskLegacyMap.sourceTable, "manager_desk_items"), eq(taskLegacyMap.role, "canonical"))),
    ]);
    const linksByTask = new Map<number, TaskLinkRow[]>();
    for (const link of linkRows) {
      const list = linksByTask.get(link.taskId);
      if (list) list.push(link);
      else linksByTask.set(link.taskId, [link]);
    }
    const legacyByTask = new Map(mappedRows.map((entry) => [entry.taskId, entry.sourceId]));
    return rows.map((row) => this.rowToDto(row, linksByTask.get(row.id) ?? [], legacyByTask.get(row.id), principal));
  }

  async list(principal: TaskPrincipal, filter: { view?: "desk" | "follow-ups" | "meetings" | "developer" | "all"; ownerId?: string; date?: string; closedFrom?: string; closedTo?: string } = {}): Promise<TaskRow[]> {
    const scope = normalizeWorkspaceId(principal.workspaceId);
    const date = filter.date ?? todayIsoDate();
    parseInput(dateOnly, date);
    if (filter.closedFrom) parseInput(dateOnly, filter.closedFrom);
    if (filter.closedTo) parseInput(dateOnly, filter.closedTo);
    const rows = await db.select().from(tasks).where(and(eq(tasks.workspaceId, scope), isNull(tasks.deletedAt),
      principal.type === "developer" ? and(eq(tasks.ownerType, "developer"), eq(tasks.ownerId, principal.accountId)) :
        filter.view === "developer" ? and(eq(tasks.ownerType, "developer"), filter.ownerId ? eq(tasks.ownerId, filter.ownerId) : undefined) :
          filter.view === "all" ? undefined : sql`(${tasks.trackedByManagerId} = ${principal.accountId} OR (${tasks.ownerType} = 'manager' AND ${tasks.ownerId} = ${principal.accountId}))`
    )).orderBy(tasks.createdAt, tasks.id);
    return rows.filter((row) => {
      if (filter.view === "follow-ups" && !row.followUpAt && !(JSON.parse(row.labelsJson ?? "[]") as string[]).includes("category:follow_up")) return false;
      if (filter.view === "meetings" && row.kind !== "meeting") return false;
      if (filter.closedFrom || filter.closedTo) {
        const closedDate = row.closedAt ? todayIsoDate(new Date(row.closedAt)) : null;
        return Boolean(closedDate && (!filter.closedFrom || closedDate >= filter.closedFrom) && (!filter.closedTo || closedDate <= filter.closedTo));
      }
      if (filter.view === "all") return true;
      if (row.closedAt) return todayIsoDate(new Date(row.closedAt)) === date;
      if (filter.view === "follow-ups" || filter.view === "meetings") return true;
      return row.ownerType === "developer" || row.later === 1 || !row.scheduledOn || row.scheduledOn <= date;
    });
  }

  private async validateShape(row: Pick<TaskRow, "ownerType" | "ownerId" | "later" | "startsAt" | "endsAt" | "parentId" | "workspaceId" | "scheduledOn">, id?: number): Promise<void> {
    if (Boolean(row.ownerType) !== Boolean(row.ownerId)) throw new HttpError(400, "Owner type and ID must be supplied together");
    if (row.ownerType === "developer") {
      if (row.later) throw new HttpError(409, "Developer tasks cannot be Later");
      const owner = (await db.select().from(developers).where(and(eq(developers.workspaceId, row.workspaceId), eq(developers.accountId, row.ownerId!), eq(developers.isActive, 1))).limit(1))[0];
      if (!owner) throw new HttpError(400, "Active developer not found");
      await new DeveloperAvailabilityService().assertAvailableForDate(row.ownerId!, row.scheduledOn ?? todayIsoDate(), row.workspaceId);
    }
    if (row.startsAt && row.endsAt && Date.parse(row.startsAt) > Date.parse(row.endsAt)) throw new HttpError(400, "End must follow start");
    if (row.parentId) {
      const visited = new Set<number>(id ? [id] : []);
      let parentId: number | null = row.parentId;
      while (parentId) {
        if (visited.has(parentId)) throw new HttpError(409, "Task parents cannot form a cycle");
        visited.add(parentId);
        const parent = await this.getById(parentId, row.workspaceId);
        if (!parent || parent.deletedAt) throw new HttpError(404, "Parent task not found");
        parentId = parent.parentId;
      }
    }
  }

  private async emit(row: TaskRow, input: Omit<TaskEventInput, "taskKey" | "workspaceId" | "taskId">, principal: TaskPrincipal): Promise<void> {
    await this.events.append({ ...input, taskId: row.id, taskKey: row.taskKey, workspaceId: row.workspaceId } as TaskEventInput, { type: "system", accountId: principal.accountId });
  }

  private async focus(row: TaskRow, date = todayIsoDate()): Promise<void> {
    if (row.ownerType !== "developer" || !row.ownerId) return;
    const existing = await this.focusRowsFor("developer", row.ownerId, date, row.workspaceId);
    await db.insert(dayFocus).values({ workspaceId: row.workspaceId, taskId: row.id, date, ownerType: "developer", ownerId: row.ownerId,
      position: existing.reduce((max, entry) => Math.max(max, entry.position), -1) + 1, source: "plan", createdAt: new Date().toISOString() }).onConflictDoNothing();
  }

  private async demoteOthers(row: Pick<TaskRow, "id" | "workspaceId" | "ownerType" | "ownerId" | "status">, principal: TaskPrincipal): Promise<void> {
    if (row.ownerType !== "developer" || row.status !== "active" || !row.ownerId) return;
    const others = await db.select().from(tasks).where(and(eq(tasks.workspaceId, row.workspaceId), eq(tasks.ownerType, "developer"), eq(tasks.ownerId, row.ownerId), eq(tasks.status, "active"), isNull(tasks.deletedAt), ne(tasks.id, row.id)));
    for (const previous of others) {
      await db.update(tasks).set({ status: "open", updatedAt: new Date().toISOString() }).where(eq(tasks.id, previous.id));
      await this.focus(previous);
      await this.emit(previous, { type: "status", body: null, meta: { domain: "task_status", from: "active", to: "open", reason: "single_current" } }, principal);
      await this.emit(previous, { type: "focus", body: null, meta: { action: "unset_current", date: todayIsoDate() } }, principal);
    }
  }

  async create(input: CreateTaskRequest, principal: TaskPrincipal): Promise<TaskRow> {
    const data = parseInput(taskCreateSchema, input);
    return runInTransaction(async () => {
      const scope = normalizeWorkspaceId(principal.workspaceId);
      if (principal.type === "developer" && Object.keys(data).some((field) => !["title", "status", "scheduledOn"].includes(field))) throw new HttpError(403, "Developer creation fields are restricted");
      // Phase 3 (P3-D13): assigning a not-yet-registered label registers it.
      if (data.labels?.length && await this.keys.phase3Enabled(scope)) {
        await new TaskLabelsService().ensureRegistered(scope, data.labels);
      }
      const now = new Date().toISOString();
      const ownerType = principal.type === "developer" ? "developer" : data.ownerType === undefined ? "manager" : data.ownerType;
      const ownerId = principal.type === "developer" ? principal.accountId : data.ownerId === undefined && ownerType === "manager" ? principal.accountId : data.ownerId ?? null;
      const values = { ...data, labels: undefined, workspaceId: scope, ownerType, ownerId, later: data.later ? 1 : 0, parentId: data.parentId ?? null,
        startsAt: data.startsAt ?? null, endsAt: data.endsAt ?? null, scheduledOn: data.scheduledOn ?? todayIsoDate(),
        taskKey: this.keys.allocate(scope), trackedByManagerId: principal.type === "developer" ? null : principal.accountId,
        labelsJson: data.labels ? JSON.stringify(data.labels) : null, status: data.status ?? "open", createdByType: principal.type, createdById: principal.accountId, createdAt: now, updatedAt: now,
        closedAt: data.status === "done" || data.status === "dropped" ? now : null };
      await this.validateShape(values);
      await this.demoteOthers({ ...values, id: -1 }, principal);
      const row = (await db.insert(tasks).values(values).returning())[0]!;
      await this.focus(row, row.scheduledOn ?? todayIsoDate());
      const parent = row.parentId ? await this.getById(row.parentId, scope) : undefined;
      await this.emit(row, { type: "created", body: null, meta: { source: principal.type === "developer" ? "my_day" : principal.type === "copilot" ? "copilot" : "desk", ownerType, ownerId, title: row.title, ...(parent && { parentKey: parent.taskKey }) } }, principal);
      if (row.status !== "open") await this.emit(row, { type: "status", body: null, meta: { domain: "task_status", from: "open", to: row.status, reason: "user" } }, principal);
      if (row.status === "active") await this.emit(row, { type: "focus", body: null, meta: { action: "set_current", date: todayIsoDate() } }, principal);
      return row;
    });
  }

  async update(key: string, input: UpdateTaskRequest, principal: TaskPrincipal): Promise<TaskRow> {
    const data = parseInput(taskUpdateSchema, input);
    return runInTransaction(async () => {
      const before = await this.requireTask(key, principal);
      if (principal.type !== "developer" && before.trackedByManagerId !== principal.accountId && !(before.ownerType === "manager" && before.ownerId === principal.accountId) && ["nextAction", "followUpAt", "labels"].some((field) => Object.hasOwn(data, field))) throw new HttpError(403, "Only the tracking manager can change private task fields");
      if (principal.type === "developer") {
        if (Object.keys(data).some((field) => !["title", "status"].includes(field))) throw new HttpError(403, "Developer update fields are restricted");
        if (data.title !== undefined && (before.createdByType !== "developer" || before.createdById !== principal.accountId)) throw new HttpError(403, "Only the creator can rename this task");
      }
      const { labels, later, ...fields } = data;
      // Phase 3 (P3-D13): assigning a not-yet-registered label registers it.
      if (labels && labels.length && await this.keys.phase3Enabled(before.workspaceId)) {
        await new TaskLabelsService().ensureRegistered(before.workspaceId, labels);
      }
      const next = { ...before, ...fields, labelsJson: labels === undefined ? before.labelsJson : JSON.stringify(labels), later: later === undefined ? before.later : Number(later) };
      const reassigned = next.ownerType !== before.ownerType || next.ownerId !== before.ownerId;
      if (reassigned) {
        if (["done", "dropped"].includes(before.status)) throw new HttpError(409, "Reopen closed work before reassigning");
        if (before.status === "active") next.status = "open";
      }
      await this.validateShape(next, before.id);
      await this.demoteOthers(next, principal);
      const now = new Date().toISOString();
      next.updatedAt = now;
      next.closedAt = ["done", "dropped"].includes(next.status) ? before.closedAt ?? now : null;
      await db.update(tasks).set(next).where(eq(tasks.id, before.id));
      await this.focus(next);
      if (before.title !== next.title) await this.emit(next, { type: "title", body: null, meta: { from: before.title, to: next.title } }, principal);
      if (reassigned) await this.emit(next, { type: "assign", body: null, meta: { fromType: before.ownerType as TaskOwnerType | null, fromId: before.ownerId, toType: next.ownerType as TaskOwnerType | null, toId: next.ownerId, ...(before.status !== next.status && { stateReset: { from: before.status, to: next.status } }) } }, principal);
      if (before.status !== next.status) {
        await this.emit(next, { type: "status", body: null, meta: { domain: "task_status", from: before.status, to: next.status, reason: reassigned ? "reassigned" : "user" } }, principal);
        if (before.status === "active" || next.status === "active") await this.emit(next, { type: "focus", body: null, meta: { action: next.status === "active" ? "set_current" : "unset_current", date: todayIsoDate() } }, principal);
      }
      for (const [field, eventField] of [["scheduledOn", "day"], ["startsAt", "planned_start_at"], ["endsAt", "planned_end_at"], ["followUpAt", "follow_up_at"]] as const) {
        if (before[field] !== next[field]) await this.emit(next, { type: "schedule", body: null, meta: { field: eventField, from: before[field], to: next[field], via: field === "scheduledOn" ? "reschedule" : "edit" } }, principal);
      }
      if (data.scheduledOn) await this.focus(next, data.scheduledOn);
      return next;
    });
  }

  async remove(key: string, principal: TaskPrincipal): Promise<void> {
    await runInTransaction(async () => {
      const row = await this.requireTask(key, principal);
      if (principal.type === "developer" && (row.createdByType !== "developer" || row.createdById !== principal.accountId)) throw new HttpError(403, "Only the creator can delete this task");
      await this.focus(row);
      await db.update(tasks).set({ deletedAt: new Date().toISOString(), updatedAt: new Date().toISOString() }).where(eq(tasks.id, row.id));
      await this.emit(row, { type: "status", body: null, meta: { domain: "task_status", from: row.status, to: "deleted", reason: "user" } }, principal);
    });
  }

  async setCurrent(key: string, principal: TaskPrincipal, ifNoCurrent = false): Promise<TaskRow> {
    return runInTransaction(async () => {
      const row = await this.requireTask(key, principal);
      if (ifNoCurrent && row.ownerType === "developer" && row.ownerId) {
        const active = await db.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.workspaceId, row.workspaceId), eq(tasks.ownerType, "developer"), eq(tasks.ownerId, row.ownerId), eq(tasks.status, "active"), isNull(tasks.deletedAt), ne(tasks.id, row.id))).limit(1);
        if (active.length) throw new HttpError(409, "Current work changed. Refresh Today before setting current work.");
      }
      return this.update(key, { status: "active" }, principal);
    });
  }

  async addLink(key: string, input: { kind: TaskLink["kind"]; ref: string; role?: TaskLink["role"] }, principal: TaskPrincipal): Promise<TaskLinkRow> {
    const data = parseInput(taskLinkSchema, input);
    return runInTransaction(async () => {
      if (principal.type === "developer") throw new HttpError(403, "Only managers can change task links");
      const row = await this.requireTask(key, principal);
      const ref = data.kind === "jira" ? data.ref.toUpperCase() : data.ref;
      if (data.kind !== "jira" && data.role) throw new HttpError(400, "Only Jira links have roles");
      if (data.kind === "jira" && !(await db.select().from(issues).where(and(eq(issues.workspaceId, row.workspaceId), eq(issues.jiraKey, ref))).limit(1))[0]) throw new HttpError(404, "Issue not found");
      if (data.kind === "person" && !(await db.select().from(developers).where(and(eq(developers.workspaceId, row.workspaceId), eq(developers.accountId, ref))).limit(1))[0]) throw new HttpError(404, "Developer not found");
      if (data.kind === "task") await this.requireTask(ref, principal);
      const existing = await this.listLinks([row.id], row.workspaceId);
      const duplicate = existing.find((link) => link.kind === data.kind && link.ref === ref);
      if (duplicate) return duplicate;
      if (data.role === "primary" && existing.some((link) => link.kind === "jira" && link.role === "primary")) throw new HttpError(409, "Task already has a primary Jira link");
      const link = (await db.insert(taskLinks).values({ taskId: row.id, workspaceId: row.workspaceId, kind: data.kind, ref, role: data.kind === "jira" ? data.role ?? "related" : null, createdAt: new Date().toISOString() }).returning())[0]!;
      await this.emit(row, { type: "link", body: null, meta: { action: "added", kind: data.kind, ref, ...(link.role && { role: link.role as "primary" | "related" }) } }, principal);
      return link;
    });
  }

  async removeLink(key: string, linkId: number, principal: TaskPrincipal): Promise<void> {
    await runInTransaction(async () => {
      if (principal.type === "developer") throw new HttpError(403, "Only managers can change task links");
      const row = await this.requireTask(key, principal);
      const link = (await this.listLinks([row.id], row.workspaceId)).find((entry) => entry.id === linkId);
      if (!link) throw new HttpError(404, "Link not found");
      await db.delete(taskLinks).where(eq(taskLinks.id, link.id));
      await this.emit(row, { type: "link", body: null, meta: { action: "removed", kind: link.kind as TaskLink["kind"], ref: link.ref, ...(link.role && { role: link.role as "primary" | "related" }) } }, principal);
    });
  }

  async getByKey(key: string, workspaceId?: string): Promise<TaskRow | undefined> {
    const rows = await db.select().from(tasks).where(and(
      eq(tasks.workspaceId, normalizeWorkspaceId(workspaceId)),
      eq(tasks.taskKey, key)
    )).limit(1);
    return rows[0];
  }

  private childRef(row: TaskRow): TaskChildRef {
    return {
      id: row.id, taskKey: row.taskKey, title: row.title,
      kind: row.kind as TaskChildRef["kind"], status: row.status as TaskStatus,
      ownerType: row.ownerType as TaskOwnerType | null, ownerId: row.ownerId,
    };
  }

  /**
   * Phase 3 (P3-D2/D3): task DTO plus action-item children and parent ref.
   * Developer viewers only see children they own; deleted tasks return a
   * tombstone DTO (manager only — `requireTask` already excludes deleted rows
   * for developers).
   */
  async detail(key: string, principal: TaskPrincipal): Promise<TaskDetailResponse | FormerOwnerTaskDetail> {
    const row = await this.requireTask(key, principal, true, "read");
    if (principal.type === "developer" && (row.ownerType !== "developer" || row.ownerId !== principal.accountId)) {
      // Phase 3 (P3-D15): former owners get key/title/status only — no links,
      // children, labels, or private fields.
      return { taskKey: row.taskKey, title: row.title, status: row.status as TaskStatus, access: "former-owner" };
    }
    const dto = await this.toDto(row, principal);
    const scope = row.workspaceId;
    const childRows = await db.select().from(tasks).where(and(
      eq(tasks.workspaceId, scope), eq(tasks.parentId, row.id), isNull(tasks.deletedAt),
      principal.type === "developer" ? and(eq(tasks.ownerType, "developer"), eq(tasks.ownerId, principal.accountId)) : undefined,
    )).orderBy(tasks.createdAt, tasks.id);
    const parentRow = row.parentId ? await this.getById(row.parentId, scope) : undefined;
    return {
      ...dto,
      children: childRows.map((child) => this.childRef(child)),
      parent: parentRow ? this.childRef(parentRow) : null,
    };
  }

  async track(key: string, principal: TaskPrincipal): Promise<TaskRow> {
    return runInTransaction(async () => {
      if (principal.type === "developer") throw new HttpError(403, "Manager access required");
      const row = await this.requireTask(key, principal);
      if (row.trackedByManagerId && row.trackedByManagerId !== principal.accountId) throw new HttpError(409, "Task is tracked by another manager");
      return (await db.update(tasks).set({ trackedByManagerId: principal.accountId, updatedAt: new Date().toISOString() }).where(eq(tasks.id, row.id)).returning())[0]!;
    });
  }

  async purge(taskIds: number[], workspaceId?: string): Promise<void> {
    if (!taskIds.length) return;
    await runInTransaction(async () => {
      const scope = normalizeWorkspaceId(workspaceId);
      const rows = await db.select().from(tasks).where(and(eq(tasks.workspaceId, scope), inArray(tasks.id, taskIds)));
      const ids = rows.map((row) => row.id);
      if (!ids.length) return;
      await this.events.deleteForTasks(scope, ids);
      await db.delete(checkinTaskRefs).where(and(eq(checkinTaskRefs.workspaceId, scope), inArray(checkinTaskRefs.taskId, ids)));
      await db.delete(dailyNoteTaskRefs).where(and(eq(dailyNoteTaskRefs.workspaceId, scope), inArray(dailyNoteTaskRefs.taskId, ids)));
      await db.delete(dailyNoteFollowUps).where(and(eq(dailyNoteFollowUps.workspaceId, scope), inArray(dailyNoteFollowUps.taskId, ids)));
      await db.delete(taskLegacyMap).where(and(eq(taskLegacyMap.workspaceId, scope), inArray(taskLegacyMap.taskId, ids)));
      await db.delete(dayFocus).where(and(eq(dayFocus.workspaceId, scope), inArray(dayFocus.taskId, ids)));
      await db.delete(taskLinks).where(and(eq(taskLinks.workspaceId, scope), inArray(taskLinks.taskId, ids)));
      await db.update(tasks).set({ parentId: null }).where(and(eq(tasks.workspaceId, scope), inArray(tasks.parentId, ids)));
      await db.delete(tasks).where(and(eq(tasks.workspaceId, scope), inArray(tasks.id, ids)));
    });
  }

  async history(managerId: string, date: string, workspaceId?: string): Promise<TaskRow[]> {
    const scope = normalizeWorkspaceId(workspaceId);
    const end = dayEnd(parseInput(dateOnly, date));
    const rows = await db.select().from(tasks).where(and(eq(tasks.workspaceId, scope), eq(tasks.trackedByManagerId, managerId)));
    const events = await this.events.historyForTasks(rows.map((row) => row.id), scope);
    return rows.flatMap((row) => {
      if (row.createdAt >= end || (row.deletedAt && row.deletedAt < end)) return [];
      const projected = { ...row };
      for (const event of events.filter((entry) => entry.taskId === row.id && entry.occurredAt >= end && !entry.redactedAt)) {
        const meta = JSON.parse(event.metaJson ?? "{}") as Record<string, unknown>;
        if (event.type === "status" && typeof meta.from === "string") projected.status = statusFromLegacy(meta.from);
        if (event.type === "title" && typeof meta.from === "string") projected.title = meta.from;
        if (event.type === "assign") { projected.ownerId = typeof meta.fromId === "string" ? meta.fromId : null; projected.ownerType = typeof meta.fromType === "string" ? meta.fromType : null; }
        if (event.type === "schedule") {
          const field = ({ day: "scheduledOn", follow_up_at: "followUpAt", planned_start_at: "startsAt", planned_end_at: "endsAt" } as const)[meta.field as "day"];
          if (field) projected[field] = typeof meta.from === "string" ? meta.from : null;
        }
      }
      if (row.closedAt && row.closedAt >= end) { projected.closedAt = null; if (["done", "dropped"].includes(projected.status)) projected.status = "open"; }
      projected.deletedAt = null;
      // Legacy snapshot history shows every item that existed at cutoff,
      // regardless of its scheduled day — mirror that for parity.
      return [projected];
    });
  }

  async getById(id: number, workspaceId?: string): Promise<TaskRow | undefined> {
    const rows = await db.select().from(tasks).where(and(
      eq(tasks.workspaceId, normalizeWorkspaceId(workspaceId)),
      eq(tasks.id, id)
    )).limit(1);
    return rows[0];
  }

  async listLinks(taskIds: number[], workspaceId?: string): Promise<TaskLinkRow[]> {
    if (!taskIds.length) return [];
    return db.select().from(taskLinks).where(and(
      eq(taskLinks.workspaceId, normalizeWorkspaceId(workspaceId)),
      inArray(taskLinks.taskId, taskIds)
    ));
  }

  /** Task-event actor -> canonical principal (manager/copilot are manager principals). */
  principal(workspaceId?: string, actor?: { type?: string; accountId?: string }, managerId?: string): TaskPrincipal {
    if (!actor?.accountId && !managerId) throw new HttpError(400, "Task mutations require an initiating account");
    return { workspaceId, accountId: actor?.accountId ?? managerId!, type: actor?.type === "developer" ? "developer" : actor?.type === "copilot" ? "copilot" : "manager" };
  }

  /**
   * Resolve a legacy surface id (team_tracker_items / manager_desk_items) to
   * its canonical task via task_legacy_map; post-cutover tasks.id values above
   * the seed resolve to themselves.
   */
  async resolve(source: "team_tracker_items" | "manager_desk_items", id: number, workspaceId?: string): Promise<TaskRow> {
    const scope = normalizeWorkspaceId(workspaceId);
    const seed = (await db.select().from(configTable).where(and(eq(configTable.workspaceId, scope), eq(configTable.key, "tasks_phase2_id_seed"))).limit(1))[0];
    const taskId = await this.resolveLegacyId(source, id, Number(seed?.value ?? Number.MAX_SAFE_INTEGER), scope);
    const task = taskId ? await this.getById(taskId, scope) : undefined;
    if (!task || task.deletedAt) throw new HttpError(404, "Task not found");
    return task;
  }

  /** The legacy surface id a task answers to (canonical/mirror mapping, else the task id). */
  async surfaceId(task: TaskRow, source: "team_tracker_items" | "manager_desk_items"): Promise<number> {
    const mapped = await db.select().from(taskLegacyMap).where(and(eq(taskLegacyMap.workspaceId, task.workspaceId), eq(taskLegacyMap.taskId, task.id), eq(taskLegacyMap.sourceTable, source)));
    return mapped.find((row) => row.role === "canonical" || row.role === "mirror")?.sourceId ?? task.id;
  }

  /**
   * Surface-item route refs accept either the legacy numeric id or a canonical
   * `T-<n>` key (§2.3.3 dual-identity window). Returns the numeric surface id
   * the legacy services operate on.
   */
  async surfaceIdForRef(source: "team_tracker_items" | "manager_desk_items", ref: string, workspaceId?: string): Promise<number> {
    if (/^\d+$/.test(ref)) return Number(ref);
    const task = await this.getByKey(ref.toUpperCase(), workspaceId);
    if (!task || task.deletedAt) throw new HttpError(404, "Task not found");
    return this.surfaceId(task, source);
  }

  /**
   * Batched Phase 2c surface DTOs: canonical tasks plus the presentation
   * fields the legacy TrackerWorkItem/ManagerDeskItem rows carried. Privacy
   * follows the principal — a developer receives DeveloperSurfaceTask rows
   * (no manager-private fields).
   */
  async surfaceDtos(rows: TaskRow[], options: { date: string; principal: TaskPrincipal }): Promise<SurfaceTask[]> {
    if (!rows.length) return [];
    const scope = normalizeWorkspaceId(options.principal.workspaceId);
    const ids = rows.map((row) => row.id);
    const developerOwnerIds = [...new Set(rows.filter((row) => row.ownerType === "developer" && row.ownerId).map((row) => row.ownerId!))];
    const viewer = { kind: options.principal.type === "developer" ? "developer" as const : "manager" as const, accountId: options.principal.accountId, workspaceId: scope };
    const [linkRows, mappingRows, focusRows, originRows, latestEvents, developerRows, availabilityByAccountId] = await Promise.all([
      this.listLinks(ids, scope),
      db.select().from(taskLegacyMap).where(and(eq(taskLegacyMap.workspaceId, scope), inArray(taskLegacyMap.taskId, ids))),
      developerOwnerIds.length
        ? db.select().from(dayFocus).where(and(eq(dayFocus.workspaceId, scope), eq(dayFocus.ownerType, "developer"), inArray(dayFocus.ownerId, developerOwnerIds), eq(dayFocus.date, options.date), inArray(dayFocus.taskId, ids)))
        : Promise.resolve([]),
      db.select({ taskId: dayFocus.taskId, ownerId: dayFocus.ownerId, originDate: sql<string>`MIN(${dayFocus.date})` }).from(dayFocus)
        .where(and(eq(dayFocus.workspaceId, scope), inArray(dayFocus.taskId, ids)))
        .groupBy(dayFocus.taskId, dayFocus.ownerId),
      this.events.latestForKeys(rows.map((row) => row.taskKey), viewer),
      developerOwnerIds.length
        ? db.select({ accountId: developers.accountId, displayName: developers.displayName, avatarUrl: developers.avatarUrl }).from(developers)
            .where(and(eq(developers.workspaceId, scope), inArray(developers.accountId, developerOwnerIds)))
        : Promise.resolve([]),
      developerOwnerIds.length
        ? new DeveloperAvailabilityService().getAvailabilityMapForDate(developerOwnerIds, options.date, scope)
        : Promise.resolve(new Map<string, never>()),
    ]);

    const linksByTask = new Map<number, TaskLinkRow[]>();
    for (const link of linkRows) {
      const bucket = linksByTask.get(link.taskId) ?? [];
      bucket.push(link);
      linksByTask.set(link.taskId, bucket);
    }
    const mappedByTaskSource = new Map<string, number>();
    for (const mapping of mappingRows) {
      if (mapping.role === "canonical" || mapping.role === "mirror") mappedByTaskSource.set(`${mapping.sourceTable}:${mapping.taskId}`, mapping.sourceId);
    }
    const focusByOwnerTask = new Map<string, DayFocusRow>();
    for (const focus of focusRows) focusByOwnerTask.set(`${focus.ownerId}:${focus.taskId}`, focus);
    const originByOwnerTask = new Map<string, string>();
    for (const origin of originRows) originByOwnerTask.set(`${origin.ownerId}:${origin.taskId}`, origin.originDate);
    const developerByAccountId = new Map(developerRows.map((row) => [row.accountId, row]));

    const jiraKeys = [...new Set(linkRows.filter((link) => link.kind === "jira").map((link) => link.ref))];
    const issueRows = jiraKeys.length
      ? await db.select({ jiraKey: issues.jiraKey, summary: issues.summary, priorityName: issues.priorityName, dueDate: issues.dueDate }).from(issues)
          .where(and(eq(issues.workspaceId, scope), inArray(issues.jiraKey, jiraKeys)))
      : [];
    const issueByKey = new Map(issueRows.map((row) => [row.jiraKey, row]));

    const today = todayIsoDate();
    const todayMs = Date.parse(`${today}T12:00:00Z`);
    return rows.map((row) => {
      const jiraLinks = (linksByTask.get(row.id) ?? []).filter((link) => link.kind === "jira");
      const primary = jiraLinks.find((link) => link.role === "primary") ?? jiraLinks[0];
      const issue = primary ? issueByKey.get(primary.ref) : undefined;
      const latestEvent = latestEvents.get(row.taskKey);
      const createdDay = isoDatePart(row.createdAt);
      const ageDays = createdDay ? Math.max(0, Math.round((todayMs - Date.parse(`${createdDay}T12:00:00Z`)) / 86400000)) : undefined;
      const tracked = Boolean(row.trackedByManagerId);
      const developerOwned = row.ownerType === "developer";
      const extras = {
        position: focusByOwnerTask.get(`${row.ownerId}:${row.id}`)?.position ?? row.id,
        originDate: (row.ownerId ? originByOwnerTask.get(`${row.ownerId}:${row.id}`) : undefined) ?? row.scheduledOn ?? createdDay ?? options.date,
        itemType: (primary ? "jira" : "custom") as "jira" | "custom",
        lifecycle: (tracked ? "manager_desk_linked" : "tracker_only") as "tracker_only" | "manager_desk_linked",
        ...(developerOwned && { trackerItemId: mappedByTaskSource.get(`team_tracker_items:${row.id}`) ?? row.id }),
        ...(tracked && { deskItemId: mappedByTaskSource.get(`manager_desk_items:${row.id}`) ?? row.id }),
        ...(primary && { jiraKey: primary.ref, jiraSummary: issue?.summary ?? undefined, jiraPriorityName: issue?.priorityName ?? undefined, jiraDueDate: issue?.dueDate ?? undefined }),
        relatedIssueKeys: jiraLinks.filter((link) => link !== primary).map((link) => link.ref),
        ...(latestEvent && { latestEvent }),
        ...(ageDays !== undefined && { ageDays }),
        ...(developerOwned && row.ownerId && developerByAccountId.has(row.ownerId) && {
          assignee: {
            accountId: row.ownerId,
            displayName: developerByAccountId.get(row.ownerId)!.displayName,
            avatarUrl: developerByAccountId.get(row.ownerId)!.avatarUrl ?? undefined,
            availability: (availabilityByAccountId as Map<string, ManagerDeskAssignee["availability"]>).get(row.ownerId),
          } satisfies ManagerDeskAssignee,
        }),
      };
      const links = (linksByTask.get(row.id) ?? []).map((link) => ({ id: link.id, kind: link.kind as TaskLink["kind"], ref: link.ref, role: link.role as TaskLink["role"] }));
      const shared: DeveloperTask = {
        id: row.id, taskKey: row.taskKey, title: row.title, kind: row.kind as DeveloperTask["kind"], status: row.status as TaskStatus,
        ownerType: row.ownerType as TaskOwnerType | null, ownerId: row.ownerId, priority: row.priority as DeveloperTask["priority"],
        scheduledOn: row.scheduledOn, dueAt: row.dueAt, startsAt: row.startsAt, endsAt: row.endsAt, participants: row.participants, outcome: row.outcome,
        createdByType: row.createdByType, createdById: row.createdById, createdAt: row.createdAt, updatedAt: row.updatedAt, closedAt: row.closedAt, deletedAt: row.deletedAt, links,
      };
      if (options.principal.type === "developer") return { ...shared, ...extras } satisfies DeveloperSurfaceTask;
      const ownsPrivate = row.trackedByManagerId === options.principal.accountId || (row.ownerType === "manager" && row.ownerId === options.principal.accountId);
      const managerDto: ManagerTask = { ...shared, legacyDeskItemId: mappedByTaskSource.get(`manager_desk_items:${row.id}`) ?? row.id, later: row.later === 1, parentId: row.parentId,
        trackedByManagerId: ownsPrivate ? row.trackedByManagerId : null,
        labels: ownsPrivate ? JSON.parse(row.labelsJson ?? "[]") as string[] : [], nextAction: ownsPrivate ? row.nextAction : null, followUpAt: ownsPrivate ? row.followUpAt : null };
      return { ...managerDto, ...extras } satisfies ManagerSurfaceTask;
    });
  }

  /** Single-row convenience wrapper for surfaceDtos. */
  async surfaceDto(row: TaskRow, options: { date: string; principal: TaskPrincipal }): Promise<SurfaceTask> {
    return (await this.surfaceDtos([row], options))[0]!;
  }

  /**
   * Adapter lookup (§2.3.2): resolve a legacy surface id to a task. Returns the
   * legacy-mapped task id, or the raw id when it is already a post-cutover
   * tasks.id (the tasks sequence is seeded above every legacy id).
   */
  async resolveLegacyId(sourceTable: "team_tracker_items" | "manager_desk_items", sourceId: number, tasksSequenceSeed: number, workspaceId?: string): Promise<number | null> {
    const mapped = await db.select({ taskId: taskLegacyMap.taskId }).from(taskLegacyMap).where(and(
      eq(taskLegacyMap.sourceTable, sourceTable),
      eq(taskLegacyMap.workspaceId, normalizeWorkspaceId(workspaceId)),
      eq(taskLegacyMap.sourceId, sourceId)
    )).limit(1);
    if (mapped[0]) return mapped[0].taskId;
    return sourceId > tasksSequenceSeed && await this.getById(sourceId, workspaceId) ? sourceId : null;
  }

  /**
   * Developer board projection (live view parity): every open developer-owned
   * task, plus any task that has a day_focus row on `date` (covers items closed
   * on that day). Mirrors buildLiveDeveloperDays' latest-row-per-key result.
   */
  async projectDeveloperBoardDay(ownerId: string, date: string, workspaceId?: string): Promise<TaskProjection[]> {
    return (await this.developerBoardRows([ownerId], date, workspaceId)).map(toProjection);
  }

  async developerBoardRows(ownerIds: string[], date: string, workspaceId?: string): Promise<TaskRow[]> {
    if (!ownerIds.length) return [];
    const scope = normalizeWorkspaceId(workspaceId);
    parseInput(dateOnly, date);
    const [year, month, day] = date.split("-").map(Number);
    const start = new Date(year!, month! - 1, day!).toISOString();
    const end = dayEnd(date);
    const rows = await db.select().from(tasks)
      .where(and(
        eq(tasks.workspaceId, scope),
        eq(tasks.ownerType, "developer"),
        inArray(tasks.ownerId, ownerIds),
        isNull(tasks.deletedAt),
        sql`(${tasks.status} IN ('open','active','blocked') OR (${tasks.closedAt} >= ${start} AND ${tasks.closedAt} < ${end}))`
      ));
    return rows;
  }

  /**
   * Developer history projection: the tasks present on that date, i.e. the
   * day_focus rows for the day. Mirrors buildHistoricalDeveloperDay.
   */
  async projectDeveloperHistoryDay(ownerId: string, date: string, workspaceId?: string): Promise<TaskProjection[]> {
    const scope = normalizeWorkspaceId(workspaceId);
    const rows = await db.select({ task: tasks }).from(dayFocus)
      .innerJoin(tasks, eq(tasks.id, dayFocus.taskId))
      .where(and(
        eq(dayFocus.workspaceId, scope),
        eq(dayFocus.ownerType, "developer"),
        eq(dayFocus.ownerId, ownerId),
        eq(dayFocus.date, date)
      ))
      .orderBy(dayFocus.position, dayFocus.id);
    const history = await this.events.historyForTasks(rows.map((row) => row.task.id), scope);
    const end = dayEnd(date);
    return rows.flatMap(({ task }) => {
      if (task.createdAt >= end || (task.deletedAt && task.deletedAt < end)) return [];
      const projected = { ...task };
      for (const event of history.filter((entry) => entry.taskId === task.id && entry.occurredAt >= end && !entry.redactedAt)) {
        const meta = JSON.parse(event.metaJson ?? "{}") as Record<string, unknown>;
        if (event.type === "status" && typeof meta.from === "string") projected.status = statusFromLegacy(meta.from);
        if (event.type === "title" && typeof meta.from === "string") projected.title = meta.from;
        if (event.type === "assign") {
          projected.ownerType = typeof meta.fromType === "string" ? meta.fromType : null;
          projected.ownerId = typeof meta.fromId === "string" ? meta.fromId : null;
        }
      }
      if (task.closedAt && task.closedAt >= end && ["done", "dropped"].includes(projected.status)) projected.status = "open";
      return [toProjection(projected)];
    });
  }

  /**
   * Desk live-day parity (buildLiveDayView): open items whose scheduled_on is
   * not after the date, Later items always, and items closed on that day.
   */
  async projectDeskDay(managerAccountId: string, date: string, workspaceId?: string): Promise<TaskProjection[]> {
    const scope = normalizeWorkspaceId(workspaceId);
    const rows = await db.select().from(tasks).where(and(
      eq(tasks.workspaceId, scope),
      eq(tasks.trackedByManagerId, managerAccountId),
      isNull(tasks.deletedAt)
    ));
    // Mirrors the legacy live filter: Later/backlog always; open items whose
    // origin (scheduled) day is not after the date; items closed on that day.
    // closedAt compares via isoDatePart (server-local), matching
    // isoDatePart(item.completedAt) — SQLite date() would shift evening
    // closures a day early.
    return rows.filter((row) => {
      const openish = ["open", "active", "blocked"].includes(row.status);
      return (openish && (row.scheduledOn === null || row.scheduledOn <= date)) ||
        (row.status === "open" && row.later === 1) ||
        (row.closedAt !== null && isoDatePart(row.closedAt) === date);
    }).map(toProjection);
  }

  /**
   * Desk planning-day parity (isRelevantToPlanningDate): open items whose
   * scheduled/start/end/follow-up day lands on the date.
   */
  async projectDeskPlanningDay(managerAccountId: string, date: string, workspaceId?: string): Promise<TaskProjection[]> {
    const scope = normalizeWorkspaceId(workspaceId);
    const rows = await db.select().from(tasks).where(and(
      eq(tasks.workspaceId, scope),
      eq(tasks.trackedByManagerId, managerAccountId),
      isNull(tasks.deletedAt),
      sql`${tasks.status} IN ('open','active','blocked')`
    ));
    return rows.filter((row) =>
      (row.scheduledOn ?? isoDatePart(row.createdAt)) === date ||
      isoDatePart(row.startsAt) === date ||
      isoDatePart(row.endsAt) === date ||
      isoDatePart(row.followUpAt) === date
    ).map(toProjection);
  }

  /**
   * getTodayItems parity: not closed, not deleted, tracked by the manager, and
   * either a due follow-up, an undecided meeting due by the date, or open work
   * scheduled on/before it (the carry-forward analogue).
   */
  async projectTodayItems(managerAccountId: string, date: string, workspaceId?: string): Promise<TaskProjection[]> {
    const scope = normalizeWorkspaceId(workspaceId);
    const rows = await db.select().from(tasks).where(and(
      eq(tasks.workspaceId, scope),
      eq(tasks.trackedByManagerId, managerAccountId),
      isNull(tasks.deletedAt),
      sql`${tasks.status} NOT IN ('done','dropped')`
    ));
    return rows.filter((row) => {
      const scheduledOn = row.scheduledOn ?? date;
      const isFollowUp = Boolean(row.followUpAt) || (row.labelsJson?.includes('"category:follow_up"') ?? false);
      const isDueFollowUp = isFollowUp && (!row.followUpAt || (isoDatePart(row.followUpAt) ?? date) <= date);
      const isMeeting = row.kind === "meeting" && !row.outcome?.trim() && scheduledOn <= date;
      const isCarryForward = !row.later && !isFollowUp && row.kind !== "meeting" && (
        scheduledOn < date ||
        Boolean(row.startsAt && (isoDatePart(row.startsAt) ?? date) < date) ||
        Boolean(row.endsAt && (isoDatePart(row.endsAt) ?? date) < date)
      );
      return isDueFollowUp || isMeeting || isCarryForward;
    }).map(toProjection);
  }

  /** Follow-ups predicate (§2.3.3 #7): follow_up_at set or category:follow_up. */
  async projectFollowUps(managerAccountId: string, workspaceId?: string): Promise<TaskProjection[]> {
    const scope = normalizeWorkspaceId(workspaceId);
    const rows = await db.select().from(tasks).where(and(
      eq(tasks.workspaceId, scope),
      eq(tasks.trackedByManagerId, managerAccountId),
      isNull(tasks.deletedAt),
      sql`(${tasks.followUpAt} IS NOT NULL OR ${tasks.labelsJson} LIKE '%"category:follow_up"%')`
    ));
    return rows.map(toProjection);
  }

  /** Meetings predicate (§2.3.3 #7): kind='meeting' tracked by the manager. */
  async projectMeetings(managerAccountId: string, workspaceId?: string): Promise<TaskProjection[]> {
    const scope = normalizeWorkspaceId(workspaceId);
    const rows = await db.select().from(tasks).where(and(
      eq(tasks.workspaceId, scope),
      eq(tasks.trackedByManagerId, managerAccountId),
      isNull(tasks.deletedAt),
      eq(tasks.kind, "meeting")
    ));
    return rows.map(toProjection);
  }

  /** Used by verification and tests: count developer-owned actives per owner. */
  async activeCountsByDeveloper(workspaceId?: string): Promise<Map<string, number>> {
    const scope = normalizeWorkspaceId(workspaceId);
    const rows = await db.select({ ownerId: tasks.ownerId, count: sql<number>`COUNT(*)` }).from(tasks)
      .where(and(
        eq(tasks.workspaceId, scope),
        eq(tasks.ownerType, "developer"),
        eq(tasks.status, "active"),
        isNull(tasks.deletedAt)
      ))
      .groupBy(tasks.ownerId);
    return new Map(rows.map((row) => [row.ownerId ?? "", row.count]));
  }

  async focusRowsFor(ownerType: string, ownerId: string, date: string, workspaceId?: string): Promise<DayFocusRow[]> {
    const scope = normalizeWorkspaceId(workspaceId);
    return db.select().from(dayFocus).where(and(
      eq(dayFocus.workspaceId, scope),
      eq(dayFocus.ownerType, ownerType),
      eq(dayFocus.ownerId, ownerId),
      eq(dayFocus.date, date)
    )).orderBy(dayFocus.position, dayFocus.id);
  }

  today(): string {
    return todayIsoDate();
  }
}
