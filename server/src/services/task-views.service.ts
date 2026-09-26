import { and, eq, gte, inArray, isNull, lte, sql, type SQL } from "drizzle-orm";
import { TASK_STALE_DAYS, taskViewDefinitionSchema, type ManagerTask, type TaskSavedView, type TaskSignals, type TaskStatus, type TaskViewCount, type TaskViewDefinition, type TaskViewFilters, type TaskViewMeta, type TaskViewTask } from "shared/types";
import { db } from "../db/connection";
import { taskLinks, taskSavedViews, tasks } from "../db/schema";
import { HttpError } from "../middleware/errorHandler";
import { isoDatePart, todayIsoDate } from "../utils/date";
import { TaskEventsService } from "./task-events.service";
import { JIRA_DRIFT_CLOSED_WINDOW_DAYS, JiraDriftService } from "./jira-drift.service";
import { TaskService, type TaskPrincipal, type TaskRow } from "./task.service";
import { normalizeWorkspaceId } from "./workspace.service";

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
 * Built-in views (§5.2, docs/49 §3) — code, not rows. Relative horizons and
 * the closed-this-week range resolve against the caller's today.
 */
export function builtinTaskViews(today: string): { id: string; name: string; section: "plan" | "review"; definition: TaskViewDefinition }[] {
  const openish: TaskStatus[] = ["open", "active", "blocked"];
  return [
    { id: "today", name: "Today", section: "plan", definition: { filters: { owner: "me", status: openish, later: false, horizon: "today" }, sort: "scheduled", group: "scheduled" } },
    { id: "inbox", name: "Inbox", section: "plan", definition: { filters: { owner: "inbox", status: ["open"] }, sort: "created" } },
    { id: "my-tasks", name: "My tasks", section: "plan", definition: { filters: { owner: "me", later: false }, sort: "scheduled", group: "scheduled" } },
    { id: "waiting", name: "Waiting on others", section: "plan", definition: { filters: { waiting: true, later: false, status: openish }, sort: "updated", group: "owner" } },
    { id: "upcoming", name: "Upcoming", section: "plan", definition: { filters: { owner: "me", status: openish, later: false, horizon: "upcoming" }, sort: "scheduled", group: "scheduled" } },
    { id: "later", name: "Later", section: "plan", definition: { filters: { later: true }, sort: "created" } },
    // §8.1 drift, overdue plan dates, and stale work in one review queue.
    { id: "attention", name: "Needs attention", section: "review", definition: { filters: { attention: ["overdue", "stale", "drift"] }, sort: "scheduled" } },
    { id: "closed-week", name: "Closed this week", section: "review", definition: { filters: { closed: { from: weekStart(today), to: today } }, sort: "updated" } },
  ];
}

const FOLLOW_UP_LABEL = "category:follow_up";
const WAITING_LABEL = "kind:waiting";
const OPEN_STATUSES = new Set(["open", "active", "blocked"]);

function labelsOf(row: TaskRow): string[] {
  try {
    return JSON.parse(row.labelsJson ?? "[]") as string[];
  } catch {
    return [];
  }
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/**
 * docs/49 D1: the plan date is the earlier of `scheduledOn` and the local
 * date of `dueAt`. A tie counts as the deadline so it drives the overdue tone.
 */
export function taskPlanDate(row: Pick<TaskRow, "scheduledOn" | "dueAt">): { date: string | null; source: "due" | "scheduled" | null } {
  const due = isoDatePart(row.dueAt) ?? null;
  const scheduled = row.scheduledOn;
  if (due && (!scheduled || due <= scheduled)) return { date: due, source: "due" };
  if (scheduled) return { date: scheduled, source: "scheduled" };
  return { date: null, source: null };
}

/** Batched per-row facts the matcher and signals need beyond the row itself. */
interface RowFacts {
  lastActivity: Map<number, string>;
  drifted: Set<number>;
  jiraLinked: Set<number> | null;
}

export function taskSignals(row: TaskRow, facts: RowFacts, today: string): TaskSignals {
  const open = OPEN_STATUSES.has(row.status);
  const plan = taskPlanDate(row);
  const overdue = open && plan.date !== null && plan.date < today;
  const lastActivity = (facts.lastActivity.get(row.id) ?? row.updatedAt).slice(0, 10);
  const idleDays = daysBetween(lastActivity, today);
  const stale = open && idleDays >= TASK_STALE_DAYS;
  const followUpDate = isoDatePart(row.followUpAt);
  return {
    overdue,
    overdueDays: overdue ? daysBetween(plan.date!, today) : null,
    overdueSource: overdue ? plan.source : null,
    stale,
    staleDays: stale ? idleDays : null,
    drift: facts.drifted.has(row.id),
    followUpDue: open && Boolean(followUpDate && followUpDate <= today),
  };
}

function followUpMatch(row: TaskRow): boolean {
  return row.followUpAt !== null || labelsOf(row).includes(FOLLOW_UP_LABEL);
}

/**
 * docs/49 D4: the single source of truth for view membership. SQL bounds the
 * candidate set in `run()`; this predicate decides. `counts()` evaluates every
 * view against one shared universe with the same function, so badge counts
 * can never disagree with the rendered list.
 */
export function matchesTaskViewFilters(
  row: TaskRow,
  filters: TaskViewFilters,
  context: { principal: TaskPrincipal; today: string; facts: RowFacts; signals: TaskSignals },
): boolean {
  const { principal, today, facts, signals } = context;
  if (row.deletedAt) return false;
  if (filters.owner !== undefined) {
    const owner = filters.owner;
    const ok = owner === "me" ? row.ownerType === "manager" && row.ownerId === principal.accountId
      : owner === "team" ? row.ownerType === "developer"
        : owner === "inbox" ? row.ownerType === null
          : row.ownerId !== null && owner.includes(row.ownerId);
    if (!ok) return false;
  }
  if (filters.status?.length && !filters.status.includes(row.status as TaskStatus)) return false;
  if (filters.kind && row.kind !== filters.kind) return false;
  if (filters.later !== undefined) {
    const parked = row.later === 1 && row.trackedByManagerId === principal.accountId;
    if (parked !== filters.later) return false;
  }
  if (filters.scheduled) {
    if (!row.scheduledOn) return false;
    if (filters.scheduled.from && row.scheduledOn < filters.scheduled.from) return false;
    if (filters.scheduled.to && row.scheduledOn > filters.scheduled.to) return false;
  }
  if (filters.linkedJira !== undefined && (facts.jiraLinked?.has(row.id) ?? false) !== filters.linkedJira) return false;
  if (filters.followUp !== undefined && followUpMatch(row) !== filters.followUp) return false;
  // Closed tasks are only reachable through a bounded closed range (§5.2) or
  // the drift signal's own 7-day window (§8.1).
  if (filters.closed) {
    if (!row.closedAt) return false;
    const closedDate = row.closedAt.slice(0, 10);
    if (filters.closed.from && closedDate < filters.closed.from) return false;
    if (filters.closed.to && closedDate > filters.closed.to) return false;
  } else if (row.closedAt && filters.jiraDrift !== true && !filters.attention?.includes("drift")) {
    return false;
  }
  if (filters.labels?.length) {
    const labels = labelsOf(row);
    if (!filters.labels.every((label) => labels.includes(label))) return false;
  }
  if (filters.jiraDrift !== undefined && signals.drift !== filters.jiraDrift) return false;
  if (filters.staleDays !== undefined) {
    const lastActivity = (facts.lastActivity.get(row.id) ?? row.updatedAt).slice(0, 10);
    if (lastActivity > shiftDays(today, -filters.staleDays)) return false;
  }
  if (filters.horizon) {
    const plan = taskPlanDate(row).date;
    if (!plan) return false;
    if (filters.horizon === "today" ? plan > today : plan <= today) return false;
  }
  if (filters.waiting !== undefined) {
    const waiting = row.ownerType === "developer" || row.status === "blocked" || followUpMatch(row) || labelsOf(row).includes(WAITING_LABEL);
    if (waiting !== filters.waiting) return false;
  }
  if (filters.attention?.length) {
    const hit = filters.attention.some((reason) => (reason === "overdue" ? signals.overdue : reason === "stale" ? signals.stale : signals.drift));
    if (!hit) return false;
  }
  return true;
}

function sortRows(rows: TaskRow[], sort: TaskViewDefinition["sort"]): TaskRow[] {
  const planKey = (row: TaskRow) => taskPlanDate(row).date ?? "9999-12-31";
  const byScheduled = (a: TaskRow, b: TaskRow) =>
    planKey(a).localeCompare(planKey(b)) || (a.startsAt ?? "").localeCompare(b.startsAt ?? "") || a.createdAt.localeCompare(b.createdAt) || a.id - b.id;
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

function needsJiraLinks(definitions: TaskViewDefinition[]): boolean {
  return definitions.some((definition) => definition.filters?.linkedJira !== undefined);
}

export class TaskViewsService {
  constructor(
    private readonly taskService = new TaskService(),
    private readonly events = new TaskEventsService(),
    private readonly drift = new JiraDriftService(),
  ) {}

  /**
   * Manager-scoped rows: tasks I track, tasks I own, and unowned inbox tasks —
   * never another manager's private tasks. Every bounded view predicate is
   * pushed into SQL (§5.2: batched and indexed, no all-history scans); only
   * JSON-label matching and the batched staleness/drift lookups filter in
   * memory afterwards.
   */
  private scopePredicate(principal: TaskPrincipal): SQL {
    return principal.type === "developer"
      ? and(eq(tasks.ownerType, "developer"), eq(tasks.ownerId, principal.accountId))!
      : sql`(${tasks.trackedByManagerId} = ${principal.accountId} OR (${tasks.ownerType} = 'manager' AND ${tasks.ownerId} = ${principal.accountId}) OR ${tasks.ownerType} IS NULL)`;
  }

  private async candidateRows(principal: TaskPrincipal, filters: TaskViewFilters): Promise<TaskRow[]> {
    const scope = normalizeWorkspaceId(principal.workspaceId);
    const conditions: SQL[] = [eq(tasks.workspaceId, scope), isNull(tasks.deletedAt), this.scopePredicate(principal)];

    if (filters.owner !== undefined) {
      const owner = filters.owner;
      conditions.push(
        owner === "me" ? and(eq(tasks.ownerType, "manager"), eq(tasks.ownerId, principal.accountId))!
          : owner === "team" ? eq(tasks.ownerType, "developer")
            : owner === "inbox" ? isNull(tasks.ownerType)
              : inArray(tasks.ownerId, owner),
      );
    }
    if (filters.status?.length) conditions.push(inArray(tasks.status, filters.status));
    if (filters.kind) conditions.push(eq(tasks.kind, filters.kind));
    // `later` is tracking-manager-private like the other private fields — a
    // parked row only reads as later to the manager tracking it.
    if (filters.later !== undefined) {
      conditions.push(filters.later
        ? and(eq(tasks.later, 1), eq(tasks.trackedByManagerId, principal.accountId))!
        : sql`NOT (${tasks.later} = 1 AND ${tasks.trackedByManagerId} = ${principal.accountId})`);
    }
    if (filters.scheduled) {
      if (filters.scheduled.from) conditions.push(gte(tasks.scheduledOn, filters.scheduled.from));
      if (filters.scheduled.to) conditions.push(lte(tasks.scheduledOn, filters.scheduled.to));
    }
    if (filters.linkedJira !== undefined) {
      const linked = sql`EXISTS (SELECT 1 FROM task_links tl WHERE tl.task_id = ${tasks.id} AND tl.workspace_id = ${scope} AND tl.kind = 'jira')`;
      conditions.push(filters.linkedJira ? linked : sql`NOT ${linked}`);
    }
    // COALESCE keeps NULL labels_json rows out of three-valued-logic traps:
    // `NOT (x OR NULL)` would wrongly exclude unlabeled rows for followUp:false.
    const followUpPred = sql`(${tasks.followUpAt} IS NOT NULL OR COALESCE(${tasks.labelsJson}, '') LIKE ${`%"${FOLLOW_UP_LABEL}"%`})`;
    if (filters.followUp !== undefined) conditions.push(filters.followUp ? followUpPred : sql`NOT ${followUpPred}`);
    // Closed tasks are only reachable through a bounded closed range (§5.2);
    // the jiraDrift predicate applies its own 7-day closed window (§8.1).
    if (filters.closed) {
      const closedDate = sql`substr(${tasks.closedAt}, 1, 10)`;
      if (filters.closed.from) conditions.push(gte(closedDate, filters.closed.from));
      if (filters.closed.to) conditions.push(lte(closedDate, filters.closed.to));
    } else if (filters.jiraDrift !== true && !filters.attention?.includes("drift")) {
      conditions.push(isNull(tasks.closedAt));
    }
    return db.select().from(tasks).where(and(...conditions));
  }

  /** Batched facts for a candidate set: last activity, drift, and (on demand) Jira links. */
  private async facts(principal: TaskPrincipal, rows: TaskRow[], today: string, withJiraLinks: boolean): Promise<RowFacts> {
    const scope = normalizeWorkspaceId(principal.workspaceId);
    if (!rows.length) return { lastActivity: new Map(), drifted: new Set(), jiraLinked: withJiraLinks ? new Set() : null };
    const ids = rows.map((row) => row.id);
    const [lastActivity, drift, links] = await Promise.all([
      this.events.latestActivityByTask(ids, scope),
      this.drift.list(principal, scope, today, ids),
      withJiraLinks
        ? db.selectDistinct({ taskId: taskLinks.taskId }).from(taskLinks).where(and(eq(taskLinks.workspaceId, scope), eq(taskLinks.kind, "jira"), inArray(taskLinks.taskId, ids)))
        : Promise.resolve(null),
    ]);
    return {
      lastActivity,
      drifted: new Set(drift.map((entry) => entry.taskId)),
      jiraLinked: links ? new Set(links.map((link) => link.taskId)) : null,
    };
  }

  private matching(principal: TaskPrincipal, rows: TaskRow[], definition: TaskViewDefinition, facts: RowFacts, today: string) {
    const filters = definition.filters ?? {};
    const matched: { row: TaskRow; signals: TaskSignals }[] = [];
    for (const row of rows) {
      const signals = taskSignals(row, facts, today);
      if (matchesTaskViewFilters(row, filters, { principal, today, facts, signals })) matched.push({ row, signals });
    }
    return matched;
  }

  private async evaluate(principal: TaskPrincipal, definition: TaskViewDefinition, today: string) {
    const rows = await this.candidateRows(principal, definition.filters ?? {});
    const facts = await this.facts(principal, rows, today, needsJiraLinks([definition]));
    return this.matching(principal, rows, definition, facts, today);
  }

  /** Execute a validated view definition — batched link/event lookups, no per-row scans. */
  async run(principal: TaskPrincipal, definition: TaskViewDefinition, today = todayIsoDate()): Promise<TaskViewTask[]> {
    const matched = await this.evaluate(principal, definition, today);
    const signalsById = new Map(matched.map((entry) => [entry.row.id, entry.signals]));
    const sorted = sortRows(matched.map((entry) => entry.row), definition.sort);
    const dtos = (await this.taskService.toDtos(sorted, principal)) as ManagerTask[];
    return dtos.map((dto) => ({ ...dto, signals: signalsById.get(dto.id)! }));
  }

  /**
   * docs/49 §10: counts for every built-in and saved view from one candidate
   * universe (open rows plus rows closed since the earliest bounded closed
   * range or the drift window) and one batched facts pass. A saved view with
   * an open-ended `closed.to` range falls back to its own bounded query.
   */
  async counts(principal: TaskPrincipal, today = todayIsoDate()): Promise<Record<string, TaskViewCount>> {
    const scope = normalizeWorkspaceId(principal.workspaceId);
    const views = await this.list(principal.accountId, principal.workspaceId, today);
    let closedFloor = shiftDays(today, -JIRA_DRIFT_CLOSED_WINDOW_DAYS);
    for (const view of views) {
      const from = view.definition.filters?.closed?.from;
      if (from && from < closedFloor) closedFloor = from;
    }
    const universe = await db.select().from(tasks).where(and(
      eq(tasks.workspaceId, scope),
      isNull(tasks.deletedAt),
      this.scopePredicate(principal),
      sql`(${tasks.closedAt} IS NULL OR substr(${tasks.closedAt}, 1, 10) >= ${closedFloor})`,
    ));
    const facts = await this.facts(principal, universe, today, needsJiraLinks(views.map((view) => view.definition)));
    const counts: Record<string, TaskViewCount> = {};
    for (const view of views) {
      const closed = view.definition.filters?.closed;
      const matched = closed && !closed.from
        ? await this.evaluate(principal, view.definition, today)
        : this.matching(principal, universe, view.definition, facts, today);
      counts[view.id] = { count: matched.length, overdue: matched.filter((entry) => entry.signals.overdue).length };
    }
    return counts;
  }

  /** Built-ins + this manager's saved views (P3-D10: saved views are private). */
  async list(managerAccountId: string, workspaceId?: string, today = todayIsoDate()): Promise<TaskViewMeta[]> {
    const scope = normalizeWorkspaceId(workspaceId);
    const saved = await this.savedRows(managerAccountId, scope);
    return [
      ...builtinTaskViews(today).map((view) => ({ id: view.id, name: view.name, builtin: true, section: view.section, definition: view.definition })),
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
