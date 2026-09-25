import { and, desc, eq, inArray, like, lt, max, or, sql } from "drizzle-orm";
import { z } from "zod";
import type { TaskEvent, TaskEventSummary, TaskEventType, TaskEventVisibility } from "shared/types";
import { db } from "../db/connection";
import { taskEvents, tasks, teamTrackerDays, teamTrackerItems } from "../db/schema";
import { runInTransaction } from "../db/transaction";
import { HttpError } from "../middleware/errorHandler";
import { normalizeWorkspaceId } from "./workspace.service";
import { TaskKeysService } from "./task-keys.service";

const imported = z.object({ field: z.enum(["tracker_note", "desk_context_note"]), sourceTable: z.enum(["team_tracker_items", "manager_desk_items"]), sourceId: z.number().int().positive(), sectionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(), approximateTime: z.literal(true) });
const approx = { approximateTime: z.literal(true).optional() };
const via = z.enum(["standup", "task_drawer", "notes_page", "copilot"]);
const messageMeta = z.object({ via: via.optional(), ...approx }).nullable();
const eventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("created"), meta: z.object({ source: z.enum(["desk", "tracker", "my_day", "note", "copilot", "today", "promote", "import"]), ownerType: z.enum(["manager", "developer"]).nullable(), ownerId: z.string().nullable(), title: z.string().min(1), jiraKeys: z.array(z.string()).optional(), parentKey: z.string().optional(), ...approx }), body: z.null() }),
  z.object({ type: z.literal("update"), meta: z.object({ via: z.enum(["standup", "task_drawer", "my_day", "notes_page", "copilot", "note_field", "context_note_field", "capture"]).optional(), imported: imported.optional(), checkInId: z.number().int().positive().optional(), labelRenamed: z.object({ from: z.string().min(1), to: z.string().min(1) }).optional(), labelRemoved: z.object({ name: z.string().min(1) }).optional() }).nullable(), body: z.string().trim().min(1).max(4000) }),
  z.object({ type: z.literal("instruction"), meta: messageMeta, body: z.string().trim().min(1).max(4000) }),
  z.object({ type: z.literal("decision"), meta: messageMeta, body: z.string().trim().min(1).max(4000) }),
  z.object({ type: z.literal("blocker"), meta: z.object({ action: z.enum(["raised", "cleared"]), developerDayStatus: z.enum(["on_track", "at_risk", "blocked", "waiting", "done_for_today"]).optional(), checkInId: z.number().int().positive().optional(), ...approx }), body: z.string().trim().min(1).max(4000).nullable() }),
  z.object({ type: z.literal("status"), meta: z.object({ domain: z.enum(["tracker_state", "desk_status", "task_status"]), from: z.string().nullable(), to: z.string(), reason: z.enum(["user", "desk_sync", "reassigned", "single_current", "migration"]).optional(), outcome: z.string().optional(), ...approx }), body: z.null() }),
  z.object({ type: z.literal("assign"), meta: z.object({ fromType: z.enum(["manager", "developer"]).nullable(), fromId: z.string().nullable(), toType: z.enum(["manager", "developer"]).nullable(), toId: z.string().nullable(), stateReset: z.object({ from: z.string(), to: z.string() }).optional(), ...approx }), body: z.null() }),
  z.object({ type: z.literal("focus"), meta: z.object({ action: z.enum(["set_current", "unset_current"]), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), ...approx }), body: z.null() }),
  z.object({ type: z.literal("title"), meta: z.object({ from: z.string(), to: z.string(), ...approx }), body: z.null() }),
  z.object({ type: z.literal("schedule"), meta: z.object({ field: z.enum(["day", "follow_up_at", "planned_start_at", "planned_end_at"]), from: z.string().nullable(), to: z.string().nullable(), via: z.enum(["carry_forward", "reschedule", "snooze", "edit", "reassign"]), ...approx }), body: z.null() }),
  z.object({ type: z.literal("link"), meta: z.object({ action: z.enum(["added", "removed"]), kind: z.enum(["jira", "person", "external", "task"]), ref: z.string(), role: z.enum(["primary", "related"]).optional(), ...approx }), body: z.null() }),
  z.object({ type: z.literal("checkin_ref"), meta: z.object({ checkInId: z.number().int().positive(), date: z.string(), developerAccountId: z.string(), excerpt: z.string().max(200) }), body: z.null() }),
  z.object({ type: z.literal("note_ref"), meta: z.object({ noteId: z.number().int().positive(), noteDate: z.string(), relation: z.enum(["mentioned", "created_from", "update_from"]), excerpt: z.string().optional() }), body: z.null() }),
  z.object({ type: z.literal("merged"), meta: z.object({ survivorKey: z.string(), mergedKey: z.string(), decisionRef: z.string() }), body: z.null() }),
]);

export type TaskEventInput = z.input<typeof eventSchema> & {
  taskId?: number;
  taskKey: string;
  workspaceId?: string;
  visibility?: TaskEventVisibility;
  requestId?: string;
  dedupeKey?: string;
  occurredAt?: string;
  sourceTable?: string;
  sourceId?: number;
};
export type TaskEventActor = { type: "manager" | "developer" | "copilot" | "system"; accountId?: string };
export type TaskViewer = { kind: "manager" | "developer"; accountId: string; workspaceId?: string };
type EventRow = typeof taskEvents.$inferSelect;

function mapEvent(row: EventRow): TaskEvent {
  const base: TaskEvent = {
    id: row.id, taskKey: row.taskKey, type: row.type as TaskEventType,
    body: row.redactedAt ? null : row.body, visibility: row.visibility as TaskEventVisibility,
    author: { type: row.authorType as TaskEvent["author"]["type"], ...(row.authorId && { id: row.authorId }) },
    meta: row.redactedAt || !row.metaJson ? null : JSON.parse(row.metaJson) as unknown,
    occurredAt: row.occurredAt, approximateTime: row.metaJson?.includes('"approximateTime":true') ?? false,
  };
  if (row.redactedAt) {
    return { id: base.id, taskKey: base.taskKey, type: base.type, visibility: base.visibility, author: { type: base.author.type }, occurredAt: base.occurredAt, approximateTime: base.approximateTime, redacted: true };
  }
  return base;
}

export class TaskEventsService {
  constructor(private readonly keys = new TaskKeysService()) {}

  async append(input: TaskEventInput, actor: TaskEventActor): Promise<TaskEvent> {
    return (await this.appendInternal(input, actor, false)).event;
  }

  async appendWithReplay(input: TaskEventInput, actor: TaskEventActor): Promise<{ event: TaskEvent; replayed: boolean }> {
    return this.appendInternal(input, actor, false);
  }

  async appendImport(input: TaskEventInput, actor: TaskEventActor): Promise<TaskEvent> {
    if (!input.dedupeKey?.startsWith("imp:") || input.type !== "update" || !input.meta?.imported) throw new HttpError(403, "Import event required");
    return (await this.appendInternal(input, actor, true)).event;
  }

  /**
   * Phase 2 backfill writes (§2.2.10): system/migration-authored events with
   * `p2:` dedupe keys. Skips the phase-1 flag gate like appendImport, and lets
   * non-system actors emit types the API gate would reject (e.g. a private
   * `note_ref` authored by the owning manager). Validation still applies.
   */
  async appendBackfill(input: TaskEventInput, actor: TaskEventActor): Promise<TaskEvent> {
    if (!input.dedupeKey?.startsWith("p2:")) throw new HttpError(403, "Backfill events require a p2: dedupe key");
    return (await this.appendInternal(input, actor, true)).event;
  }

  private async appendInternal(input: TaskEventInput, actor: TaskEventActor, migration: boolean): Promise<{ event: TaskEvent; replayed: boolean }> {
    const workspaceId = normalizeWorkspaceId(input.workspaceId);
    if (!migration) await this.keys.assertEnabled(workspaceId);
    const parsed = eventSchema.safeParse({ type: input.type, meta: input.meta, body: input.body });
    if (!parsed.success || (input.type === "blocker" && input.meta?.action === "raised" && !input.body)) throw new HttpError(400, parsed.success ? "Raised blocker needs a body" : parsed.error.issues.map((issue) => issue.message).join(", "));
    const checkInSideEffect = input.type === "checkin_ref" && input.sourceTable === "team_tracker_checkins";
    const backfill = migration && input.dedupeKey?.startsWith("p2:");
    if (actor.type === "developer" && !backfill) {
      if (input.visibility === "private") throw new HttpError(400, "Developer updates must be shared");
      if (!checkInSideEffect && !(["update", "blocker"] as string[]).includes(input.type)) throw new HttpError(403, "Event type is not allowed for developers");
      await this.assertDeveloperOwns(input.taskKey, { kind: "developer", accountId: actor.accountId ?? "", workspaceId });
    }
    if (actor.type !== "system" && !backfill && !checkInSideEffect && !(["update", "instruction", "decision", "blocker"] as string[]).includes(input.type)) throw new HttpError(403, "System event only");
    const visibility: TaskEventVisibility = input.type === "note_ref" || (input.type === "schedule" && input.meta?.field === "follow_up_at") || (input.type === "update" && input.meta?.imported?.field === "desk_context_note") || (input.type === "update" && input.meta?.via === "context_note_field")
      ? "private" : actor.type === "developer" || !(["update", "instruction", "decision", "blocker"] as string[]).includes(input.type) ? "shared" : input.visibility ?? "shared";
    const dedupeKey = input.requestId ? `req:${input.requestId}` : input.dedupeKey ?? null;
    return runInTransaction(async () => {
      if (dedupeKey) {
        const found = await db.select().from(taskEvents).where(and(eq(taskEvents.workspaceId, workspaceId), eq(taskEvents.dedupeKey, dedupeKey))).limit(1);
        if (found[0]) {
          if (found[0].taskKey !== input.taskKey || found[0].type !== input.type || found[0].body !== parsed.data.body || found[0].metaJson !== (parsed.data.meta === null ? null : JSON.stringify(parsed.data.meta)) || found[0].visibility !== visibility || found[0].authorType !== actor.type || found[0].authorId !== (actor.accountId ?? null)) throw new HttpError(409, "requestId was already used with a different payload");
          return { event: mapEvent(found[0]), replayed: true };
        }
      }
      const now = new Date().toISOString();
      let taskId = input.taskId;
      if (await this.keys.canonicalEnabled(workspaceId)) {
        const key = await this.keys.resolve(workspaceId, input.taskKey);
        const canonical = (await db.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.workspaceId, workspaceId), eq(tasks.taskKey, key ?? ""))).limit(1))[0];
        if (!canonical || (taskId !== undefined && taskId !== canonical.id)) throw new HttpError(404, "Task not found");
        taskId = canonical.id;
      }
      const rows = await db.insert(taskEvents).values({
        taskId,
        workspaceId, taskKey: input.taskKey, type: input.type, body: parsed.data.body,
        visibility, authorType: actor.type, authorId: actor.accountId ?? null,
        metaJson: parsed.data.meta === null ? null : JSON.stringify(parsed.data.meta),
        sourceTable: input.sourceTable ?? null, sourceId: input.sourceId ?? null, dedupeKey,
        occurredAt: input.occurredAt ?? now, createdAt: now,
      }).returning();
      return { event: mapEvent(rows[0]!), replayed: false };
    });
  }

  private async visibility(viewer: TaskViewer) {
    if (viewer.kind === "developer" && await this.keys.canonicalEnabled(viewer.workspaceId)) {
      return and(eq(taskEvents.visibility, "shared"), sql`EXISTS (
        SELECT 1 FROM tasks owned WHERE owned.id = ${taskEvents.taskId}
        AND owned.workspace_id = ${normalizeWorkspaceId(viewer.workspaceId)}
        AND owned.owner_type = 'developer' AND owned.owner_id = ${viewer.accountId}
        AND owned.deleted_at IS NULL
      )`)!;
    }
    return viewer.kind === "manager"
      ? or(eq(taskEvents.visibility, "shared"), eq(taskEvents.authorId, viewer.accountId))!
      : and(eq(taskEvents.visibility, "shared"), sql`EXISTS (
        SELECT 1 FROM team_tracker_items ti JOIN team_tracker_days td ON td.id = ti.day_id
        WHERE ti.workspace_id = ${normalizeWorkspaceId(viewer.workspaceId)} AND ti.task_key = ${taskEvents.taskKey}
        AND ti.id = (SELECT newer.id FROM team_tracker_items newer JOIN team_tracker_days nd ON nd.id = newer.day_id
          WHERE newer.workspace_id = ti.workspace_id AND newer.task_key = ti.task_key
          ORDER BY nd.date DESC, newer.updated_at DESC, newer.id DESC LIMIT 1)
        AND td.developer_account_id = ${viewer.accountId})`)!;
  }

  private async assertDeveloperOwns(key: string, viewer: TaskViewer): Promise<void> {
    if (await this.keys.canonicalEnabled(viewer.workspaceId)) {
      const resolved = await this.keys.resolve(normalizeWorkspaceId(viewer.workspaceId), key);
      const task = (await db.select().from(tasks).where(and(eq(tasks.workspaceId, normalizeWorkspaceId(viewer.workspaceId)), eq(tasks.taskKey, resolved ?? ""))).limit(1))[0];
      if (!task || task.deletedAt || task.ownerType !== "developer" || task.ownerId !== viewer.accountId) throw new HttpError(404, "Task not found");
      return;
    }
    const rows = await db.select({ accountId: teamTrackerDays.developerAccountId }).from(teamTrackerItems)
      .innerJoin(teamTrackerDays, eq(teamTrackerDays.id, teamTrackerItems.dayId))
      .where(and(eq(teamTrackerItems.workspaceId, normalizeWorkspaceId(viewer.workspaceId)), eq(teamTrackerItems.taskKey, key)))
      .orderBy(desc(teamTrackerDays.date), desc(teamTrackerItems.updatedAt), desc(teamTrackerItems.id)).limit(1);
    if (rows[0]?.accountId !== viewer.accountId) throw new HttpError(404, "Task not found");
  }

  async list(taskKey: string, viewer: TaskViewer, options: { cursor?: string; limit?: number } = {}): Promise<{ events: TaskEvent[]; nextCursor: string | null }> {
    await this.keys.assertEnabled(viewer.workspaceId);
    const key = await this.keys.resolve(normalizeWorkspaceId(viewer.workspaceId), taskKey);
    if (!key) throw new HttpError(404, "Task not found");
    if (viewer.kind === "developer") await this.assertDeveloperOwns(key, viewer);
    const limit = Math.min(100, Math.max(1, options.limit ?? 50));
    const cursor = options.cursor ? Number(options.cursor) : undefined;
    if (cursor !== undefined && (!Number.isSafeInteger(cursor) || cursor < 1)) throw new HttpError(400, "Invalid cursor");
    const identity = await this.identity(key, viewer.workspaceId);
    const rows = await db.select().from(taskEvents).where(and(eq(taskEvents.workspaceId, normalizeWorkspaceId(viewer.workspaceId)), identity, await this.visibility(viewer), cursor ? lt(taskEvents.id, cursor) : undefined)).orderBy(desc(taskEvents.id)).limit(limit + 1);
    return { events: rows.slice(0, limit).map(mapEvent), nextCursor: rows.length > limit ? String(rows[limit - 1]!.id) : null };
  }

  async latestOfType(taskKey: string, type: TaskEventType, viewer: TaskViewer): Promise<TaskEvent | null> {
    await this.keys.assertEnabled(viewer.workspaceId);
    if (viewer.kind === "developer") await this.assertDeveloperOwns(taskKey, viewer);
    const rows = await db.select().from(taskEvents).where(and(eq(taskEvents.workspaceId, normalizeWorkspaceId(viewer.workspaceId)), await this.identity(taskKey, viewer.workspaceId), eq(taskEvents.type, type), await this.visibility(viewer))).orderBy(desc(taskEvents.occurredAt), desc(taskEvents.id)).limit(1);
    return rows[0] ? mapEvent(rows[0]) : null;
  }

  async latestForKey(taskKey: string, workspaceId?: string, type?: TaskEventType): Promise<TaskEvent | null> {
    const rows = await db.select().from(taskEvents).where(and(eq(taskEvents.workspaceId, normalizeWorkspaceId(workspaceId)), eq(taskEvents.taskKey, taskKey), type ? eq(taskEvents.type, type) : undefined)).orderBy(desc(taskEvents.occurredAt), desc(taskEvents.id)).limit(1);
    return rows[0] ? mapEvent(rows[0]) : null;
  }

  async getByRequestId(requestId: string, viewer: TaskViewer): Promise<{ event: TaskEvent; sourceId: number | null } | null> {
    await this.keys.assertEnabled(viewer.workspaceId);
    const rows = await db.select().from(taskEvents).where(and(eq(taskEvents.workspaceId, normalizeWorkspaceId(viewer.workspaceId)), eq(taskEvents.dedupeKey, `req:${requestId}`), await this.visibility(viewer))).limit(1);
    return rows[0] ? { event: mapEvent(rows[0]), sourceId: rows[0].sourceId } : null;
  }

  async get(eventId: number, viewer: TaskViewer): Promise<TaskEvent> {
    await this.keys.assertEnabled(viewer.workspaceId);
    const rows = await db.select().from(taskEvents).where(and(eq(taskEvents.workspaceId, normalizeWorkspaceId(viewer.workspaceId)), eq(taskEvents.id, eventId), await this.visibility(viewer))).limit(1);
    if (!rows[0]) throw new HttpError(404, "Event not found");
    return mapEvent(rows[0]);
  }

  async searchBodies(viewer: TaskViewer, pattern: string, limit: number): Promise<{ taskKey: string; excerpt: string }[]> {
    if (!(await this.keys.enabled(viewer.workspaceId))) return [];
    const rows = await db.select({ taskKey: taskEvents.taskKey, body: taskEvents.body }).from(taskEvents).where(and(eq(taskEvents.workspaceId, normalizeWorkspaceId(viewer.workspaceId)), like(taskEvents.body, pattern), await this.visibility(viewer))).orderBy(desc(taskEvents.occurredAt), desc(taskEvents.id)).limit(limit * 5);
    return [...new Map(rows.map((row) => [row.taskKey, { taskKey: row.taskKey, excerpt: (row.body ?? "").slice(0, 160) }])).values()].slice(0, limit);
  }

  async latestForKeys(keys: string[], viewer: TaskViewer): Promise<Map<string, TaskEventSummary>> {
    const result = new Map<string, TaskEventSummary>();
    if (!keys.length || !(await this.keys.enabled(viewer.workspaceId))) return result;
    const canonical = await this.keys.canonicalEnabled(viewer.workspaceId);
    const canonicalRows = canonical ? await db.select({ id: tasks.id, taskKey: tasks.taskKey }).from(tasks).where(and(eq(tasks.workspaceId, normalizeWorkspaceId(viewer.workspaceId)), inArray(tasks.taskKey, keys))) : [];
    const keyById = new Map(canonicalRows.map((row) => [row.id, row.taskKey]));
    if (canonical && !canonicalRows.length) return result;
    const rows = await db.select().from(taskEvents).where(and(eq(taskEvents.workspaceId, normalizeWorkspaceId(viewer.workspaceId)), canonical ? inArray(taskEvents.taskId, canonicalRows.map((row) => row.id)) : inArray(taskEvents.taskKey, keys), await this.visibility(viewer))).orderBy(desc(taskEvents.occurredAt), desc(taskEvents.id));
    for (const row of rows) {
      const key = canonical ? keyById.get(row.taskId!)! : row.taskKey;
      if (!result.has(key)) result.set(key, { id: row.id, type: row.type as TaskEventType, excerpt: row.redactedAt ? "[redacted]" : (row.body ?? row.type).slice(0, 160), authorType: row.authorType as TaskEvent["author"]["type"], occurredAt: row.occurredAt, approximateTime: row.metaJson?.includes('"approximateTime":true') ?? false, visibility: row.visibility as TaskEventVisibility });
    }
    return result;
  }

  async changeVisibility(key: string, id: number, accountId: string, visibility: TaskEventVisibility, workspaceId?: string): Promise<TaskEvent> {
    const event = await this.get(id, { kind: "manager", accountId, workspaceId });
    if (await this.keys.resolve(normalizeWorkspaceId(workspaceId), event.taskKey) !== await this.keys.resolve(normalizeWorkspaceId(workspaceId), key) || event.author.id !== accountId || event.redacted || !(["update", "instruction", "decision", "blocker"] as string[]).includes(event.type) || !(["manager", "copilot"] as string[]).includes(event.author.type) || (event.meta && typeof event.meta === "object" && ("imported" in event.meta || ("via" in event.meta && event.meta.via === "context_note_field")))) throw new HttpError(403, "Visibility cannot be changed");
    const rows = await db.update(taskEvents).set({ visibility }).where(and(eq(taskEvents.workspaceId, normalizeWorkspaceId(workspaceId)), eq(taskEvents.id, id))).returning();
    return mapEvent(rows[0]!);
  }

  async pruneOrphans(workspaceId: string, all = false): Promise<void> {
    const scope = normalizeWorkspaceId(workspaceId);
    if (all) {
      await db.delete(taskEvents).where(eq(taskEvents.workspaceId, scope));
      return;
    }
    await db.delete(taskEvents).where(and(eq(taskEvents.workspaceId, scope), sql`NOT EXISTS (SELECT 1 FROM team_tracker_items ti WHERE ti.workspace_id = ${scope} AND ti.task_key = ${taskEvents.taskKey})`, sql`NOT EXISTS (SELECT 1 FROM manager_desk_items di WHERE di.workspace_id = ${scope} AND di.task_key = ${taskEvents.taskKey})`));
  }

  async deletePrivateForAuthor(workspaceId: string, accountId: string): Promise<number> {
    const deleted = await db.delete(taskEvents).where(and(eq(taskEvents.workspaceId, normalizeWorkspaceId(workspaceId)), eq(taskEvents.visibility, "private"), eq(taskEvents.authorId, accountId))).returning({ id: taskEvents.id });
    return deleted.length;
  }

  async deleteForTasks(workspaceId: string, taskIds: number[]): Promise<void> {
    if (taskIds.length) await db.delete(taskEvents).where(and(eq(taskEvents.workspaceId, normalizeWorkspaceId(workspaceId)), inArray(taskEvents.taskId, taskIds)));
  }

  async countPrivateForAuthor(workspaceId: string, accountId: string): Promise<number> {
    const rows = await db.select({ id: taskEvents.id }).from(taskEvents).where(and(eq(taskEvents.workspaceId, normalizeWorkspaceId(workspaceId)), eq(taskEvents.visibility, "private"), eq(taskEvents.authorId, accountId)));
    return rows.length;
  }

  async redact(key: string, id: number, accountId: string, workspaceId?: string): Promise<void> {
    const event = await this.get(id, { kind: "manager", accountId, workspaceId });
    if (await this.keys.resolve(normalizeWorkspaceId(workspaceId), event.taskKey) !== await this.keys.resolve(normalizeWorkspaceId(workspaceId), key) || event.author.type === "developer" || !accountId || event.author.id !== accountId || event.redacted || Date.now() - new Date(event.occurredAt).getTime() > 30 * 86400000) throw new HttpError(403, "Event cannot be redacted");
    await db.update(taskEvents).set({ body: null, metaJson: null, redactedAt: new Date().toISOString(), redactedBy: accountId }).where(and(eq(taskEvents.workspaceId, normalizeWorkspaceId(workspaceId)), eq(taskEvents.id, id)));
  }

  // ── Phase 2 backfill surface ─────────────────────────
  // Internal to the backfill service/CLI; never routed. Keeps the single-owner
  // boundary for the event table while letting the migration read raw rows,
  // repoint task_id, and perform the audited task_key rewrite for approved
  // split decisions (§2.2.1 — the only place task_key is rewritten).

  async listRawForWorkspace(workspaceId?: string): Promise<EventRow[]> {
    return db.select().from(taskEvents).where(eq(taskEvents.workspaceId, normalizeWorkspaceId(workspaceId)));
  }

  async historyForTasks(taskIds: number[], workspaceId?: string): Promise<EventRow[]> {
    if (!taskIds.length) return [];
    return db.select().from(taskEvents).where(and(eq(taskEvents.workspaceId, normalizeWorkspaceId(workspaceId)), inArray(taskEvents.taskId, taskIds))).orderBy(desc(taskEvents.occurredAt), desc(taskEvents.id));
  }

  /** Phase 3 (P3-D9 stale view): newest event timestamp per task, batched. */
  async latestActivityByTask(taskIds: number[], workspaceId?: string): Promise<Map<number, string>> {
    if (!taskIds.length) return new Map();
    const rows = await db
      .select({ taskId: taskEvents.taskId, last: max(taskEvents.occurredAt) })
      .from(taskEvents)
      .where(and(eq(taskEvents.workspaceId, normalizeWorkspaceId(workspaceId)), inArray(taskEvents.taskId, taskIds)))
      .groupBy(taskEvents.taskId);
    return new Map(rows.map((row) => [row.taskId!, row.last!]));
  }

  private async identity(key: string, workspaceId?: string) {
    if (!(await this.keys.canonicalEnabled(workspaceId))) return eq(taskEvents.taskKey, key);
    const resolved = await this.keys.resolve(normalizeWorkspaceId(workspaceId), key);
    return sql`${taskEvents.taskId} IN (SELECT id FROM tasks WHERE workspace_id = ${normalizeWorkspaceId(workspaceId)} AND task_key = ${resolved ?? ""})`;
  }

  async repointKeyToTaskId(workspaceId: string, taskKey: string, taskId: number): Promise<void> {
    await db.update(taskEvents).set({ taskId }).where(and(eq(taskEvents.workspaceId, normalizeWorkspaceId(workspaceId)), eq(taskEvents.taskKey, taskKey)));
  }

  async moveEventsToKey(workspaceId: string, eventIds: number[], taskKey: string): Promise<void> {
    if (!eventIds.length) return;
    await db.update(taskEvents).set({ taskKey }).where(and(eq(taskEvents.workspaceId, normalizeWorkspaceId(workspaceId)), inArray(taskEvents.id, eventIds)));
  }

  /** Internal: clear repointed task ids (used when re-running the Phase 2 backfill, which wipes and rebuilds the tasks table). */
  async clearTaskIds(workspaceId: string): Promise<void> {
    await db.update(taskEvents).set({ taskId: null }).where(eq(taskEvents.workspaceId, normalizeWorkspaceId(workspaceId)));
  }

  /** Internal: table fingerprint for the Phase 2 backfill input hash. */
  async fingerprint(workspaceId: string): Promise<{ count: number; maxId: number | null; maxTs: string | null }> {
    const rows = await db.all<{ count: number; maxId: number | null; maxTs: string | null }>(
      sql`SELECT COUNT(*) AS count, MAX(id) AS maxId, MAX(created_at) AS maxTs FROM task_events WHERE workspace_id = ${normalizeWorkspaceId(workspaceId)}`
    );
    return rows[0] ?? { count: 0, maxId: null, maxTs: null };
  }
}
