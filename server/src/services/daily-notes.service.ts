import { createHash } from "node:crypto";
import { and, desc, eq, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import type {
  DailyNote,
  DailyNoteDayContext,
  DailyNoteFollowUp,
  DailyNoteRef,
  DailyNoteRefRelation,
  DailyNoteResponse,
  DailyNoteSourcesResponse,
  DailyNoteSummary,
  DailyNotesResponse,
  AppendDailyNotePayload,
  CreateDailyNoteFollowUpPayload,
  ManagerDeskStatus,
  SaveDailyNotePayload,
} from "shared/types";
import { db, rawDb } from "../db/connection";
import {
  configTable,
  dailyNoteCaptures,
  dailyNoteFollowUps,
  dailyNotes,
  dailyNoteTaskRefs,
  developers,
  managerDeskDays,
  managerDeskItems,
  oneOnOneSessions,
  standupSessions,
  taskLegacyMap,
  tasks,
  teamTrackerDays,
  teamTrackerItems,
} from "../db/schema";
import { runInTransaction } from "../db/transaction";
import { HttpError } from "../middleware/errorHandler";
import { ManagerDeskService } from "./manager-desk.service";
import { TeamTrackerService } from "./team-tracker.service";
import { TaskKeysService } from "./task-keys.service";
import { TaskEventsService } from "./task-events.service";
import { isoDatePart, todayIsoDate } from "../utils/date";
import { normalizeWorkspaceId } from "./workspace.service";
import { TaskService } from "./task.service";
import { taskStatusToDeskStatus } from "./task.service";

const MAX_BODY_LENGTH = 50000;
const DEFAULT_LIST_LIMIT = 30;
const MAX_LIST_LIMIT = 100;
const TITLE_LENGTH = 120;
const EXCERPT_LENGTH = 180;
const SNIPPET_TOKENS = 24;
const SNIPPET_OPEN = "⟦";
const SNIPPET_CLOSE = "⟧";
const NOTE_CONFLICT_MESSAGE = "This note changed elsewhere. Review the latest version before saving.";
const MENTION_PATTERN = /\bT-(\d{1,9})\b/gi;
const LEGACY_DESK_SURFACE = "manager_desk_items";
const LEGACY_MAP_ROLES = ["canonical", "mirror"] as const;
const OPEN_DESK_STATUSES = new Set<ManagerDeskStatus>(["inbox", "planned", "in_progress", "waiting"]);
const OPEN_TASK_STATUSES = new Set(["open", "active", "blocked"]);
const LIVE_ONE_ON_ONE_STATUSES = ["scheduled", "done"];
const CARRIED_LINE_MARKER = "↩";
const ONE_ON_ONE_FLAG = "one_on_one_enabled";

type DailyNoteRow = typeof dailyNotes.$inferSelect;
type TaskRow = typeof tasks.$inferSelect;
type NoteTaskRefRow = typeof dailyNoteTaskRefs.$inferSelect;
type NoteFollowUpRow = typeof dailyNoteFollowUps.$inferSelect;

/** First-offset per normalized T-n token; used to diff mentions between bodies. */
function mentionTokens(body: string): Map<string, number> {
  const tokens = new Map<string, number>();
  for (const match of body.matchAll(MENTION_PATTERN)) {
    const normalized = `T-${Number(match[1])}`;
    if (!tokens.has(normalized)) {
      tokens.set(normalized, match.index ?? 0);
    }
  }
  return tokens;
}

function parseJsonList(value: string | null | undefined): unknown[] {
  if (!value) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function countCarriedLines(body: string): number {
  let count = 0;
  for (const line of body.split("\n")) {
    if (line.includes(CARRIED_LINE_MARKER)) {
      count += 1;
    }
  }
  return count;
}

function trackerStateToDeskStatus(state: string): ManagerDeskStatus {
  switch (state) {
    case "in_progress": return "in_progress";
    case "blocked": return "waiting";
    case "done": return "done";
    case "dropped": return "cancelled";
    default: return "planned";
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

function assertScope(managerAccountId: string, workspaceId: string): void {
  if (!managerAccountId?.trim() || !workspaceId?.trim()) {
    throw new HttpError(403, "Daily notes are private to their author");
  }
}

function deriveTitle(body: string): string {
  const line = body
    .split("\n")
    .map((value) => value.trim())
    .find((value) => value.length > 0);
  return line ? line.slice(0, TITLE_LENGTH) : "Daily note";
}

function buildExcerpt(body: string, query?: string): string {
  const collapsed = body.replace(/\s+/g, " ").trim();
  if (collapsed.length <= EXCERPT_LENGTH) {
    return collapsed;
  }

  const normalizedQuery = query?.trim();
  if (normalizedQuery) {
    const matchIndex = collapsed.toLowerCase().indexOf(normalizedQuery.toLowerCase());
    if (matchIndex >= 0) {
      const start = Math.max(
        0,
        Math.min(
          matchIndex - Math.floor((EXCERPT_LENGTH - normalizedQuery.length) / 2),
          collapsed.length - EXCERPT_LENGTH
        )
      );
      return collapsed.slice(start, start + EXCERPT_LENGTH);
    }
  }

  return collapsed.slice(0, EXCERPT_LENGTH);
}

function toSummary(row: DailyNoteRow, query?: string, snippet?: string): DailyNoteSummary {
  return {
    id: row.id,
    date: row.date,
    title: deriveTitle(row.body),
    excerpt: buildExcerpt(row.body, query),
    updatedAt: row.updatedAt,
    ...(snippet ? { snippet } : {}),
  };
}

function toNote(row: DailyNoteRow): DailyNote {
  return {
    ...toSummary(row),
    body: row.body,
    revision: row.revision,
    createdAt: row.createdAt,
  };
}

function hashPayload(shape: Record<string, unknown>): string {
  return createHash("sha256").update(JSON.stringify(shape)).digest("hex");
}

export class DailyNotesService {
  private readonly followUpOperations = new Map<string, Promise<void>>();

  constructor(private readonly managerDesk = new ManagerDeskService(), private readonly tracker = new TeamTrackerService()) {}
  private readonly taskKeys = new TaskKeysService();
  private readonly tasks = new TaskService();

  private async canonicalTaskId(key: string, workspaceId: string): Promise<number | undefined> {
    return await this.taskKeys.canonicalEnabled(workspaceId) ? (await this.tasks.getByKey(key, workspaceId))?.id : undefined;
  }

  /**
   * Batched "From this note" composition (docs/52 F9, P2): one shot of refs,
   * one tasks lookup, one surface map, one developer map — no per-ref N+1.
   * `followUps` keeps the legacy response shape until the UI moves to refs[].
   */
  private async composeCanonicalRefs(
    managerId: string,
    workspaceId: string,
    noteId: number
  ): Promise<{ refs: DailyNoteRef[]; followUps: Array<DailyNoteFollowUp & { noteId: number }> }> {
    const refRows = await db
      .select()
      .from(dailyNoteTaskRefs)
      .where(
        and(
          eq(dailyNoteTaskRefs.workspaceId, workspaceId),
          eq(dailyNoteTaskRefs.managerAccountId, managerId),
          eq(dailyNoteTaskRefs.noteId, noteId)
        )
      )
      .orderBy(dailyNoteTaskRefs.createdAt, dailyNoteTaskRefs.taskKey);
    const migrated = await db
      .select()
      .from(dailyNoteFollowUps)
      .where(
        and(
          eq(dailyNoteFollowUps.workspaceId, workspaceId),
          eq(dailyNoteFollowUps.managerAccountId, managerId),
          eq(dailyNoteFollowUps.noteId, noteId)
        )
      );
    if (refRows.length === 0 && migrated.length === 0) {
      return { refs: [], followUps: [] };
    }

    const taskIds = new Set<number>();
    const taskKeys = new Set<string>();
    for (const ref of refRows) {
      if (ref.taskId) taskIds.add(ref.taskId);
      taskKeys.add(ref.taskKey);
    }
    for (const mig of migrated) {
      if (mig.taskId) taskIds.add(mig.taskId);
    }
    const taskRows =
      taskIds.size || taskKeys.size
        ? await db
            .select()
            .from(tasks)
            .where(
              and(
                eq(tasks.workspaceId, workspaceId),
                or(
                  taskIds.size ? inArray(tasks.id, [...taskIds]) : undefined,
                  taskKeys.size ? inArray(tasks.taskKey, [...taskKeys]) : undefined
                )
              )
            )
        : [];
    const taskById = new Map(taskRows.map((row) => [row.id, row]));
    const taskByKey = new Map(taskRows.map((row) => [row.taskKey, row]));

    const surfaceRows = taskRows.length
      ? await db
          .select({ taskId: taskLegacyMap.taskId, sourceId: taskLegacyMap.sourceId })
          .from(taskLegacyMap)
          .where(
            and(
              eq(taskLegacyMap.workspaceId, workspaceId),
              eq(taskLegacyMap.sourceTable, LEGACY_DESK_SURFACE),
              inArray(taskLegacyMap.role, [...LEGACY_MAP_ROLES]),
              inArray(taskLegacyMap.taskId, taskRows.map((row) => row.id))
            )
          )
      : [];
    const surfaceIdByTask = new Map(surfaceRows.map((row) => [row.taskId, row.sourceId]));

    const ownerIds = [
      ...new Set(
        taskRows
          .filter((row) => row.ownerType === "developer" && row.ownerId)
          .map((row) => row.ownerId as string)
      ),
    ];
    const ownerRows = ownerIds.length
      ? await db
          .select({ accountId: developers.accountId, displayName: developers.displayName })
          .from(developers)
          .where(and(eq(developers.workspaceId, workspaceId), inArray(developers.accountId, ownerIds)))
      : [];
    const ownerNames = new Map(ownerRows.map((row) => [row.accountId, row.displayName]));

    const refs: DailyNoteRef[] = [];
    const followUps: Array<DailyNoteFollowUp & { noteId: number }> = [];
    const seen = new Set<string>();
    const push = (
      task: TaskRow,
      relation: DailyNoteRefRelation,
      refNoteId: number,
      fallbackItemId?: number
    ) => {
      const itemId = surfaceIdByTask.get(task.id) ?? fallbackItemId ?? task.id;
      const key = `${relation}:${itemId}`;
      if (seen.has(key)) return;
      seen.add(key);
      const status = taskStatusToDeskStatus(task.status, task.later) as ManagerDeskStatus;
      const owner =
        task.ownerType === "developer" && task.ownerId
          ? ownerNames.get(task.ownerId) ?? task.ownerId
          : undefined;
      const due = task.followUpAt ?? task.dueAt ?? task.scheduledOn ?? undefined;
      refs.push({
        ...(task.taskKey ? { taskKey: task.taskKey } : {}),
        itemId,
        relation,
        title: task.title,
        status,
        ...(owner ? { owner } : {}),
        ...(due ? { due } : {}),
      });
      if (relation === "created_from") {
        followUps.push({
          noteId: refNoteId,
          itemId,
          date: task.scheduledOn ?? todayIsoDate(),
          title: task.title,
          status,
          followUpAt: task.followUpAt ?? undefined,
        });
      }
    };

    for (const ref of refRows) {
      const task = (ref.taskId ? taskById.get(ref.taskId) : undefined) ?? taskByKey.get(ref.taskKey);
      if (!task || task.deletedAt || task.trackedByManagerId !== managerId) continue;
      push(task, ref.relation as DailyNoteRefRelation, ref.noteId);
    }
    for (const mig of migrated) {
      const task = mig.taskId ? taskById.get(mig.taskId) : undefined;
      if (!task || task.deletedAt || task.trackedByManagerId !== managerId) continue;
      push(task, "created_from", mig.noteId, mig.itemId);
    }
    return { refs, followUps };
  }

  /** Legacy-mode refs: taskKey refs resolve through desk items (then tracker items). */
  private async composeLegacyRefs(
    managerId: string,
    workspaceId: string,
    noteId: number
  ): Promise<{ refs: DailyNoteRef[]; followUps: DailyNoteFollowUp[] }> {
    const followUpRows = await db
      .select({
        itemId: dailyNoteFollowUps.itemId,
        date: managerDeskDays.date,
        title: managerDeskItems.title,
        status: managerDeskItems.status,
        followUpAt: managerDeskItems.followUpAt,
        plannedStartAt: managerDeskItems.plannedStartAt,
        taskKey: managerDeskItems.taskKey,
        assigneeId: managerDeskItems.assigneeDeveloperAccountId,
      })
      .from(dailyNoteFollowUps)
      .innerJoin(managerDeskItems, eq(dailyNoteFollowUps.itemId, managerDeskItems.id))
      .innerJoin(managerDeskDays, eq(managerDeskItems.dayId, managerDeskDays.id))
      .where(
        and(
          eq(dailyNoteFollowUps.workspaceId, workspaceId),
          eq(dailyNoteFollowUps.managerAccountId, managerId),
          eq(dailyNoteFollowUps.noteId, noteId),
          eq(managerDeskItems.workspaceId, workspaceId),
          eq(managerDeskDays.workspaceId, workspaceId),
          eq(managerDeskDays.managerAccountId, managerId)
        )
      )
      .orderBy(dailyNoteFollowUps.itemId);

    const followUps = followUpRows.map((row) => ({
      itemId: row.itemId,
      date: row.date,
      title: row.title,
      status: row.status as ManagerDeskStatus,
      followUpAt: row.followUpAt ?? undefined,
    }));

    const refRows = await db
      .select()
      .from(dailyNoteTaskRefs)
      .where(
        and(
          eq(dailyNoteTaskRefs.workspaceId, workspaceId),
          eq(dailyNoteTaskRefs.managerAccountId, managerId),
          eq(dailyNoteTaskRefs.noteId, noteId)
        )
      )
      .orderBy(dailyNoteTaskRefs.createdAt, dailyNoteTaskRefs.taskKey);

    const refKeys = [...new Set(refRows.map((ref) => ref.taskKey))];
    type DeskRow = {
      id: number;
      taskKey: string | null;
      title: string;
      status: string;
      followUpAt: string | null;
      plannedStartAt: string | null;
      assigneeId: string | null;
    };
    const deskByKey = new Map<string, DeskRow>();
    const ownerIds = new Set<string>();
    for (const row of followUpRows) {
      if (row.assigneeId) ownerIds.add(row.assigneeId);
    }
    if (refKeys.length) {
      const deskRows: DeskRow[] = await db
        .select({
          id: managerDeskItems.id,
          taskKey: managerDeskItems.taskKey,
          title: managerDeskItems.title,
          status: managerDeskItems.status,
          followUpAt: managerDeskItems.followUpAt,
          plannedStartAt: managerDeskItems.plannedStartAt,
          assigneeId: managerDeskItems.assigneeDeveloperAccountId,
        })
        .from(managerDeskItems)
        .innerJoin(managerDeskDays, eq(managerDeskItems.dayId, managerDeskDays.id))
        .where(
          and(
            eq(managerDeskItems.workspaceId, workspaceId),
            eq(managerDeskDays.workspaceId, workspaceId),
            eq(managerDeskDays.managerAccountId, managerId),
            inArray(managerDeskItems.taskKey, refKeys)
          )
        )
        .orderBy(desc(managerDeskItems.updatedAt));
      for (const row of deskRows) {
        if (row.taskKey && !deskByKey.has(row.taskKey)) {
          deskByKey.set(row.taskKey, row);
          if (row.assigneeId) ownerIds.add(row.assigneeId);
        }
      }
    }

    const missingKeys = refKeys.filter((key) => !deskByKey.has(key));
    type TrackerRow = { taskKey: string | null; title: string; state: string; developerAccountId: string };
    const trackerByKey = new Map<string, TrackerRow>();
    if (missingKeys.length) {
      const trackerRows: TrackerRow[] = await db
        .select({
          taskKey: teamTrackerItems.taskKey,
          title: teamTrackerItems.title,
          state: teamTrackerItems.state,
          developerAccountId: teamTrackerDays.developerAccountId,
        })
        .from(teamTrackerItems)
        .innerJoin(teamTrackerDays, eq(teamTrackerItems.dayId, teamTrackerDays.id))
        .where(
          and(
            eq(teamTrackerItems.workspaceId, workspaceId),
            inArray(teamTrackerItems.taskKey, missingKeys)
          )
        )
        .orderBy(desc(teamTrackerItems.updatedAt));
      for (const row of trackerRows) {
        if (row.taskKey && !trackerByKey.has(row.taskKey)) {
          trackerByKey.set(row.taskKey, row);
          ownerIds.add(row.developerAccountId);
        }
      }
    }

    const ownerRows = ownerIds.size
      ? await db
          .select({ accountId: developers.accountId, displayName: developers.displayName })
          .from(developers)
          .where(and(eq(developers.workspaceId, workspaceId), inArray(developers.accountId, [...ownerIds])))
      : [];
    const ownerNames = new Map(ownerRows.map((row) => [row.accountId, row.displayName]));
    const ownerOf = (accountId: string | null | undefined) =>
      accountId ? ownerNames.get(accountId) ?? accountId : undefined;

    const refs: DailyNoteRef[] = [];
    const seen = new Set<string>();
    const mark = (relation: string, itemId: number | undefined, taskKey: string | undefined) =>
      seen.add(`${relation}:${itemId ?? `key:${taskKey ?? ""}`}`);
    const marked = (relation: string, itemId: number | undefined, taskKey: string | undefined) =>
      seen.has(`${relation}:${itemId ?? `key:${taskKey ?? ""}`}`);

    for (const row of followUpRows) {
      mark("created_from", row.itemId, row.taskKey ?? undefined);
      if (row.taskKey) mark("created_from", undefined, row.taskKey);
      const due = row.followUpAt ?? row.plannedStartAt ?? undefined;
      refs.push({
        itemId: row.itemId,
        ...(row.taskKey ? { taskKey: row.taskKey } : {}),
        relation: "created_from",
        title: row.title,
        status: row.status as ManagerDeskStatus,
        ...(ownerOf(row.assigneeId) ? { owner: ownerOf(row.assigneeId)! } : {}),
        ...(due ? { due } : {}),
      });
    }

    for (const ref of refRows) {
      const relation = ref.relation as DailyNoteRefRelation;
      const desk = deskByKey.get(ref.taskKey);
      if (desk) {
        if (marked(relation, desk.id, ref.taskKey)) continue;
        mark(relation, desk.id, ref.taskKey);
        const due = desk.followUpAt ?? desk.plannedStartAt ?? undefined;
        refs.push({
          itemId: desk.id,
          taskKey: ref.taskKey,
          relation,
          title: desk.title,
          status: desk.status as ManagerDeskStatus,
          ...(ownerOf(desk.assigneeId) ? { owner: ownerOf(desk.assigneeId)! } : {}),
          ...(due ? { due } : {}),
        });
        continue;
      }
      const tracker = trackerByKey.get(ref.taskKey);
      if (!tracker || marked(relation, undefined, ref.taskKey)) continue;
      mark(relation, undefined, ref.taskKey);
      const owner = ownerOf(tracker.developerAccountId);
      refs.push({
        taskKey: ref.taskKey,
        relation,
        title: tracker.title,
        status: trackerStateToDeskStatus(tracker.state),
        ...(owner ? { owner } : {}),
      });
    }
    return { refs, followUps };
  }

  private async composeNoteRefs(
    managerId: string,
    workspaceId: string,
    noteId: number
  ): Promise<{ refs: DailyNoteRef[]; followUps: Array<DailyNoteFollowUp & { noteId: number }> }> {
    if (await this.taskKeys.canonicalEnabled(workspaceId)) {
      return this.composeCanonicalRefs(managerId, workspaceId, noteId);
    }
    const legacy = await this.composeLegacyRefs(managerId, workspaceId, noteId);
    return {
      refs: legacy.refs,
      followUps: legacy.followUps.map((row) => ({ ...row, noteId })),
    };
  }

  private async canonicalFollowUps(managerId: string, workspaceId: string, noteId: number): Promise<Array<DailyNoteFollowUp & { noteId: number }>> {
    return (await this.composeCanonicalRefs(managerId, workspaceId, noteId)).followUps;
  }
  private readonly eventsService = new TaskEventsService(this.taskKeys);

  /** Re-scan task-key mentions (P2): only tokens absent from the previous body
   *  pay the resolve/lookup cost; canonical task rows come from one query. */
  private async scanMentions(note: DailyNoteRow, previousBody = ""): Promise<void> {
    if (!(await this.taskKeys.enabled(note.workspaceId))) return;
    const previous = mentionTokens(previousBody);
    const fresh = [...mentionTokens(note.body)].filter(([token]) => !previous.has(token));
    if (!fresh.length) return;

    const resolved = new Map<string, { token: string; index: number }>();
    for (const [token, index] of fresh) {
      const key = await this.taskKeys.resolve(note.workspaceId, token);
      if (key && !resolved.has(key)) {
        resolved.set(key, { token, index });
      }
    }
    if (!resolved.size) return;

    const canonical = await this.taskKeys.canonicalEnabled(note.workspaceId);
    const taskByKey = new Map<string, TaskRow>();
    if (canonical) {
      const rows = await db
        .select()
        .from(tasks)
        .where(and(eq(tasks.workspaceId, note.workspaceId), inArray(tasks.taskKey, [...resolved.keys()])));
      for (const row of rows) {
        taskByKey.set(row.taskKey, row);
      }
    }

    for (const [key, { token, index }] of resolved) {
      let taskId: number | undefined;
      if (canonical) {
        const task = taskByKey.get(key);
        if (!task || task.deletedAt) continue;
        taskId = task.id;
      } else {
        try {
          if ((await this.taskKeys.resolveTask(note.workspaceId, key)).deleted) continue;
        } catch {
          continue;
        }
      }
      const inserted = await db
        .insert(dailyNoteTaskRefs)
        .values({
          workspaceId: note.workspaceId,
          managerAccountId: note.managerAccountId,
          noteId: note.id,
          taskKey: key,
          taskId,
          relation: "mentioned",
          createdAt: nowIso(),
        })
        .onConflictDoNothing()
        .returning();
      if (!inserted.length) continue;
      await this.eventsService.append(
        {
          workspaceId: note.workspaceId,
          taskKey: key,
          type: "note_ref",
          body: null,
          meta: {
            noteId: note.id,
            noteDate: note.date,
            relation: "mentioned",
            excerpt: note.body.slice(Math.max(0, index - 80), index + token.length + 80),
          },
        },
        { type: "system", accountId: note.managerAccountId }
      );
    }
  }

  /**
   * FTS5 body search ordered by date (the `before` cursor is a date, so rank
   * ordering would corrupt pagination — docs/52 F11). Rows also carry the FTS
   * `snippet()` text with ⟦…⟧ match markers for later UI highlighting (F12).
   * Undefined when the query has no searchable terms or the index is
   * unavailable — callers fall back to substring matching.
   */
  private searchNoteBodies(
    managerAccountId: string,
    workspaceId: string,
    query: string,
    before: string | undefined,
    limit: number
  ): Array<DailyNoteRow & { snippet?: string }> | undefined {
    const terms = (query.match(/[\p{L}\p{N}]+/gu) ?? []).slice(0, 12);
    if (terms.length === 0) {
      return undefined;
    }
    const match = terms
      .map((term) => (term.length >= 3 ? `${term}*` : `"${term.replace(/"/g, '""')}"`))
      .join(" ");
    try {
      const params: unknown[] = [match, workspaceId, managerAccountId];
      if (before) {
        params.push(before);
      }
      params.push(limit);
      const rows = rawDb
        .prepare(
          `SELECT n.id, n.workspace_id, n.manager_account_id, n.date, n.body, n.revision, n.created_at, n.updated_at,
                  snippet(daily_notes_fts, 1, '${SNIPPET_OPEN}', '${SNIPPET_CLOSE}', '…', ${SNIPPET_TOKENS}) AS snippet
           FROM daily_notes_fts
           JOIN daily_notes n ON n.id = daily_notes_fts.rowid
           WHERE daily_notes_fts MATCH ?
             AND n.workspace_id = ?
             AND n.manager_account_id = ?
             AND length(trim(n.body)) > 0
             ${before ? "AND n.date < ?" : ""}
           ORDER BY n.date DESC
           LIMIT ?`
        )
        .all(...params) as Array<Record<string, unknown>>;
      return rows.map((row) => ({
        id: row.id as number,
        workspaceId: row.workspace_id as string,
        managerAccountId: row.manager_account_id as string,
        date: row.date as string,
        body: row.body as string,
        revision: row.revision as number,
        createdAt: row.created_at as string,
        updatedAt: row.updated_at as string,
        snippet: typeof row.snippet === "string" ? row.snippet : undefined,
      }));
    } catch {
      return undefined;
    }
  }

  async list(
    managerAccountId: string,
    query: { q?: string; before?: string; limit?: number },
    workspaceId: string
  ): Promise<DailyNotesResponse> {
    assertScope(managerAccountId, workspaceId);
    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    const limit = Math.min(Math.max(Math.trunc(query.limit ?? DEFAULT_LIST_LIMIT), 1), MAX_LIST_LIMIT);
    const trimmedQuery = query.q?.trim();

    let rows: Array<DailyNoteRow & { snippet?: string }> | undefined = trimmedQuery
      ? this.searchNoteBodies(managerAccountId, normalizedWorkspaceId, trimmedQuery, query.before, limit + 1)
      : undefined;

    if (!rows) {
      const conditions = [
        eq(dailyNotes.workspaceId, normalizedWorkspaceId),
        eq(dailyNotes.managerAccountId, managerAccountId),
        sql`length(trim(${dailyNotes.body})) > 0`,
      ];
      if (query.before) {
        conditions.push(lt(dailyNotes.date, query.before));
      }
      if (trimmedQuery) {
        conditions.push(
          sql`(instr(lower(${dailyNotes.body}), lower(${trimmedQuery})) > 0 OR instr(${dailyNotes.date}, ${trimmedQuery}) > 0)`
        );
      }

      rows = await db
        .select()
        .from(dailyNotes)
        .where(and(...conditions))
        .orderBy(desc(dailyNotes.date))
        .limit(limit + 1);
    }

    const page = rows.slice(0, limit);
    const hasMore = rows.length > limit;
    return {
      notes: page.map((row) => toSummary(row, trimmedQuery, row.snippet)),
      nextCursor: hasMore && page.length > 0 ? page[page.length - 1]!.date : null,
    };
  }

  async getDay(managerAccountId: string, date: string, workspaceId: string): Promise<DailyNoteResponse> {
    assertScope(managerAccountId, workspaceId);
    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    const note = await this.findNote(managerAccountId, date, normalizedWorkspaceId);
    if (!note) {
      return { note: null, followUps: [], refs: [] };
    }

    const { refs, followUps } = await this.composeNoteRefs(managerAccountId, normalizedWorkspaceId, note.id);
    return {
      note: toNote(note),
      // `noteId` is internal to compose*; the public followUp shape omits it.
      followUps: followUps.map(({ noteId: _noteId, ...rest }) => rest),
      refs,
    };
  }

  /** docs/52 §5 — cheap day-context strip assembled from existing tables. */
  async getDayContext(
    managerAccountId: string,
    date: string,
    workspaceId: string
  ): Promise<DailyNoteDayContext> {
    assertScope(managerAccountId, workspaceId);
    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);

    const standupRow = (
      await db
        .select({
          endedAt: standupSessions.endedAt,
          reviewedJson: standupSessions.reviewedJson,
          flaggedJson: standupSessions.flaggedJson,
        })
        .from(standupSessions)
        .where(
          and(
            eq(standupSessions.workspaceId, normalizedWorkspaceId),
            eq(standupSessions.managerAccountId, managerAccountId),
            eq(standupSessions.date, date)
          )
        )
        .orderBy(desc(standupSessions.endedAt))
        .limit(1)
    )[0];

    const [note, followUpsDue, oneOnOnes] = await Promise.all([
      this.findNote(managerAccountId, date, normalizedWorkspaceId),
      this.countDueFollowUps(managerAccountId, date, normalizedWorkspaceId),
      this.countOneOnOnes(date, normalizedWorkspaceId),
    ]);

    return {
      standup: standupRow
        ? {
            endedAt: standupRow.endedAt,
            reviewed: parseJsonList(standupRow.reviewedJson).length,
            flagged: parseJsonList(standupRow.flaggedJson).length,
          }
        : null,
      carriedFrom: note ? countCarriedLines(note.body) : 0,
      followUpsDue,
      oneOnOnes,
    };
  }

  private async countDueFollowUps(
    managerAccountId: string,
    date: string,
    workspaceId: string
  ): Promise<number> {
    if (await this.taskKeys.canonicalEnabled(workspaceId)) {
      const rows = await db
        .select({
          status: tasks.status,
          closedAt: tasks.closedAt,
          followUpAt: tasks.followUpAt,
          labelsJson: tasks.labelsJson,
        })
        .from(tasks)
        .where(
          and(
            eq(tasks.workspaceId, workspaceId),
            eq(tasks.trackedByManagerId, managerAccountId),
            isNull(tasks.deletedAt),
            or(isNotNull(tasks.followUpAt), sql`${tasks.labelsJson} LIKE '%"category:follow_up"%'`)
          )
        );
      return rows.filter(
        (row) =>
          !row.closedAt &&
          OPEN_TASK_STATUSES.has(row.status) &&
          (!row.followUpAt || (isoDatePart(row.followUpAt) ?? date) <= date)
      ).length;
    }

    const rows = await db
      .select({ status: managerDeskItems.status, followUpAt: managerDeskItems.followUpAt })
      .from(managerDeskItems)
      .innerJoin(managerDeskDays, eq(managerDeskItems.dayId, managerDeskDays.id))
      .where(
        and(
          eq(managerDeskItems.workspaceId, workspaceId),
          eq(managerDeskDays.workspaceId, workspaceId),
          eq(managerDeskDays.managerAccountId, managerAccountId),
          or(eq(managerDeskItems.category, "follow_up"), isNotNull(managerDeskItems.followUpAt))
        )
      );
    return rows.filter(
      (row) =>
        OPEN_DESK_STATUSES.has(row.status as ManagerDeskStatus) &&
        (!row.followUpAt || (isoDatePart(row.followUpAt) ?? date) <= date)
    ).length;
  }

  private async countOneOnOnes(date: string, workspaceId: string): Promise<number> {
    const flag = (
      await db
        .select({ value: configTable.value })
        .from(configTable)
        .where(and(eq(configTable.workspaceId, workspaceId), eq(configTable.key, ONE_ON_ONE_FLAG)))
        .limit(1)
    )[0];
    if (flag?.value !== "true") {
      return 0;
    }
    const row = (
      await db
        .select({ count: sql<number>`count(*)` })
        .from(oneOnOneSessions)
        .where(
          and(
            eq(oneOnOneSessions.workspaceId, workspaceId),
            eq(oneOnOneSessions.scheduledFor, date),
            inArray(oneOnOneSessions.status, LIVE_ONE_ON_ONE_STATUSES)
          )
        )
    )[0];
    return row?.count ?? 0;
  }

  async save(
    managerAccountId: string,
    date: string,
    input: SaveDailyNotePayload,
    workspaceId: string
  ): Promise<DailyNoteResponse> {
    assertScope(managerAccountId, workspaceId);
    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    if (!Number.isInteger(input.revision) || input.revision < 0) {
      throw new HttpError(400, "revision must be a non-negative integer");
    }
    if (input.body.length > MAX_BODY_LENGTH) {
      throw new HttpError(400, `Note body must be ${MAX_BODY_LENGTH} characters or fewer`);
    }

    return runInTransaction(async () => {
    let previousBody = "";
    rawDb.transaction(() => {
      const current = db
        .select()
        .from(dailyNotes)
        .where(
          and(
            eq(dailyNotes.workspaceId, normalizedWorkspaceId),
            eq(dailyNotes.managerAccountId, managerAccountId),
            eq(dailyNotes.date, date)
          )
        )
        .get();

      if (!current) {
        if (input.revision !== 0) {
          throw new HttpError(409, NOTE_CONFLICT_MESSAGE);
        }
        if (input.body.trim().length === 0) {
          return;
        }
        const now = nowIso();
        const inserted = db
          .insert(dailyNotes)
          .values({
            workspaceId: normalizedWorkspaceId,
            managerAccountId,
            date,
            body: input.body,
            revision: 1,
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoNothing()
          .run();
        if (inserted.changes === 0) {
          throw new HttpError(409, NOTE_CONFLICT_MESSAGE);
        }
        return;
      }

      previousBody = current.body;
      if (input.body === current.body) {
        return;
      }

      if (input.body.trim().length === 0) {
        // F13: clearing the note deletes the row so blank notes never surface
        // in the list; child refs/captures and the FTS row go with it.
        const deleted = db
          .delete(dailyNotes)
          .where(and(eq(dailyNotes.id, current.id), eq(dailyNotes.revision, input.revision)))
          .run();
        if (deleted.changes === 0) {
          throw new HttpError(409, NOTE_CONFLICT_MESSAGE);
        }
        db.delete(dailyNoteCaptures).where(eq(dailyNoteCaptures.noteId, current.id)).run();
        db.delete(dailyNoteFollowUps).where(eq(dailyNoteFollowUps.noteId, current.id)).run();
        db.delete(dailyNoteTaskRefs).where(eq(dailyNoteTaskRefs.noteId, current.id)).run();
        return;
      }

      const updated = db
        .update(dailyNotes)
        .set({ body: input.body, revision: input.revision + 1, updatedAt: nowIso() })
        .where(
          and(
            eq(dailyNotes.id, current.id),
            eq(dailyNotes.revision, input.revision)
          )
        )
        .run();
      if (updated.changes === 0) {
        throw new HttpError(409, NOTE_CONFLICT_MESSAGE);
      }
    })();
    const note = await this.findNote(managerAccountId, date, normalizedWorkspaceId);
    if (note) await this.scanMentions(note, previousBody);
    return this.getDay(managerAccountId, date, normalizedWorkspaceId);
    });
  }

  async append(
    managerAccountId: string,
    date: string,
    input: AppendDailyNotePayload,
    workspaceId: string
  ): Promise<DailyNoteResponse> {
    assertScope(managerAccountId, workspaceId);
    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    const text = input.text.trim();
    if (!text) {
      throw new HttpError(400, "text is required");
    }
    if (text.length > MAX_BODY_LENGTH) {
      throw new HttpError(400, `Note body must be ${MAX_BODY_LENGTH} characters or fewer`);
    }
    const payloadHash = hashPayload({ route: "append", date, text });

    return runInTransaction(async () => {
    let previousBody = "";
    rawDb.transaction(() => {
      const receipt = db
        .select()
        .from(dailyNoteCaptures)
        .where(
          and(
            eq(dailyNoteCaptures.workspaceId, normalizedWorkspaceId),
            eq(dailyNoteCaptures.managerAccountId, managerAccountId),
            eq(dailyNoteCaptures.requestId, input.requestId)
          )
        )
        .get();

      if (receipt) {
        if (receipt.payloadHash !== payloadHash) {
          throw new HttpError(409, "requestId was already used with a different payload");
        }
        return;
      }

      const current = db
        .select()
        .from(dailyNotes)
        .where(
          and(
            eq(dailyNotes.workspaceId, normalizedWorkspaceId),
            eq(dailyNotes.managerAccountId, managerAccountId),
            eq(dailyNotes.date, date)
          )
        )
        .get();

      const now = nowIso();
      let noteId: number;
      if (current) {
        previousBody = current.body;
        const combined = current.body.length > 0 ? `${current.body}\n\n${text}` : text;
        if (combined.length > MAX_BODY_LENGTH) {
          throw new HttpError(400, `Note body must be ${MAX_BODY_LENGTH} characters or fewer`);
        }
        db.update(dailyNotes)
          .set({ body: combined, revision: current.revision + 1, updatedAt: now })
          .where(eq(dailyNotes.id, current.id))
          .run();
        noteId = current.id;
      } else {
        const inserted = db
          .insert(dailyNotes)
          .values({
            workspaceId: normalizedWorkspaceId,
            managerAccountId,
            date,
            body: text,
            revision: 1,
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoNothing()
          .run();
        if (inserted.changes === 0) {
          throw new HttpError(409, NOTE_CONFLICT_MESSAGE);
        }
        noteId = Number(inserted.lastInsertRowid);
      }

      db.insert(dailyNoteCaptures)
        .values({
          workspaceId: normalizedWorkspaceId,
          managerAccountId,
          noteId,
          requestId: input.requestId,
          payloadHash,
          createdAt: now,
        })
        .run();
    })();
    const note = await this.findNote(managerAccountId, date, normalizedWorkspaceId);
    if (note) await this.scanMentions(note, previousBody);
    return this.getDay(managerAccountId, date, normalizedWorkspaceId);
    });
  }

  async addTaskUpdate(managerAccountId: string, noteDate: string, input: { taskKey: string; text: string; type?: "update" | "instruction" | "decision"; visibility?: "shared" | "private"; requestId: string }, workspaceId: string) {
    await this.taskKeys.assertEnabled(workspaceId);
    return runInTransaction(async () => {
      const note = await this.findNote(managerAccountId, noteDate, workspaceId);
      if (!note) throw new HttpError(404, "Note not found");
      const task = await this.taskKeys.resolveTask(workspaceId, input.taskKey);
      if (task.deleted) throw new HttpError(410, "Task was deleted");
      const type = input.type ?? "update";
      const event = await this.eventsService.append({ workspaceId, taskKey: task.taskKey, type, body: input.text, meta: { via: "notes_page" }, visibility: input.visibility ?? "private", requestId: input.requestId }, { type: "manager", accountId: managerAccountId });
      await db.insert(dailyNoteTaskRefs).values({ workspaceId, managerAccountId, noteId: note.id, taskKey: task.taskKey, taskId: await this.canonicalTaskId(task.taskKey, workspaceId), relation: "update_from", requestId: input.requestId, createdAt: nowIso() }).onConflictDoNothing();
      await this.eventsService.append({ workspaceId, taskKey: task.taskKey, type: "note_ref", body: null, meta: { noteId: note.id, noteDate, relation: "update_from" }, dedupeKey: `note:ref:${input.requestId}` }, { type: "system", accountId: managerAccountId });
      return event;
    });
  }

  async createTask(managerAccountId: string, noteDate: string, input: { title: string; developerAccountId?: string; jiraKey?: string; context?: string; requestId: string }, workspaceId: string) {
    await this.taskKeys.assertEnabled(workspaceId);
    return runInTransaction(async () => {
      const note = await this.findNote(managerAccountId, noteDate, workspaceId);
      if (!note) throw new HttpError(404, "Note not found");
      const payloadHash = hashPayload({
        route: "task",
        noteId: note.id,
        noteDate,
        title: input.title.trim(),
        developerAccountId: input.developerAccountId ?? null,
        jiraKey: input.jiraKey?.trim().toUpperCase() || null,
        context: input.context?.trim() || null,
      });
      const receipt = (await db.select().from(dailyNoteTaskRefs).where(and(eq(dailyNoteTaskRefs.workspaceId, workspaceId), eq(dailyNoteTaskRefs.managerAccountId, managerAccountId), eq(dailyNoteTaskRefs.requestId, input.requestId))).limit(1))[0];
      if (receipt) {
        if (receipt.relation !== "created_from" || receipt.payloadHash !== payloadHash) throw new HttpError(409, "requestId was already used with a different payload");
        return this.taskKeys.resolveTask(workspaceId, receipt.taskKey);
      }
      const actor = { type: "manager" as const, accountId: managerAccountId };
      const created = input.developerAccountId
        ? await this.tracker.addItem(input.developerAccountId, todayIsoDate(), { title: input.title, jiraKey: input.jiraKey, source: "note", actor }, workspaceId)
        : await this.managerDesk.createItem(managerAccountId, { date: todayIsoDate(), title: input.title, status: "inbox", source: "note", actor, links: input.jiraKey ? [{ linkType: "issue", issueKey: input.jiraKey }] : undefined }, workspaceId);
      const key = created.taskKey;
      if (!key) throw new Error("Task key was not allocated");
      if (input.context?.trim()) await this.eventsService.append({ workspaceId, taskKey: key, type: "update", body: input.context, meta: { via: "notes_page" }, visibility: "private" }, actor);
      await db.insert(dailyNoteTaskRefs).values({ workspaceId, managerAccountId, noteId: note.id, taskKey: key, taskId: await this.canonicalTaskId(key, workspaceId), relation: "created_from", requestId: input.requestId, payloadHash, createdAt: nowIso() });
      await this.eventsService.append({ workspaceId, taskKey: key, type: "note_ref", body: null, meta: { noteId: note.id, noteDate, relation: "created_from" } }, { type: "system", accountId: managerAccountId });
      return this.taskKeys.resolveTask(workspaceId, key);
    });
  }

  async createFollowUp(
    managerAccountId: string,
    noteDate: string,
    input: CreateDailyNoteFollowUpPayload,
    workspaceId: string
  ): Promise<DailyNoteFollowUp> {
    assertScope(managerAccountId, workspaceId);
    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    const key = `${normalizedWorkspaceId}:${managerAccountId}:${input.requestId}`;
    const previous = this.followUpOperations.get(key) ?? Promise.resolve();
    const operation = previous.then(() =>
      this.createFollowUpInternal(managerAccountId, noteDate, input, normalizedWorkspaceId)
    );
    const tracked = operation.then(
      () => undefined,
      () => undefined
    );
    this.followUpOperations.set(key, tracked);
    try {
      return await operation;
    } finally {
      if (this.followUpOperations.get(key) === tracked) {
        this.followUpOperations.delete(key);
      }
    }
  }

  async getSources(
    managerAccountId: string,
    itemIds: number[],
    workspaceId: string
  ): Promise<DailyNoteSourcesResponse> {
    assertScope(managerAccountId, workspaceId);
    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    const ids = [...new Set(itemIds.filter((id) => Number.isInteger(id) && id > 0))];
    if (ids.length === 0) {
      return { sources: [] };
    }
    if (await this.taskKeys.canonicalEnabled(normalizedWorkspaceId)) {
      // Map caller item ids (desk surface ids) to task ids, then filter refs in
      // SQL instead of scanning every canonical follow-up (docs/52 P2).
      const mapped = await db
        .select({ taskId: taskLegacyMap.taskId, sourceId: taskLegacyMap.sourceId })
        .from(taskLegacyMap)
        .where(
          and(
            eq(taskLegacyMap.workspaceId, normalizedWorkspaceId),
            eq(taskLegacyMap.sourceTable, LEGACY_DESK_SURFACE),
            inArray(taskLegacyMap.sourceId, ids),
            inArray(taskLegacyMap.role, [...LEGACY_MAP_ROLES])
          )
        );
      const taskIdBySurfaceId = new Map(mapped.map((row) => [row.sourceId, row.taskId]));
      const surfaceIdByTaskId = new Map(mapped.map((row) => [row.taskId, row.sourceId]));
      const candidateTaskIds = new Set<number>([...mapped.map((row) => row.taskId), ...ids]);

      const refRows = await db
        .select()
        .from(dailyNoteTaskRefs)
        .where(
          and(
            eq(dailyNoteTaskRefs.workspaceId, normalizedWorkspaceId),
            eq(dailyNoteTaskRefs.managerAccountId, managerAccountId),
            eq(dailyNoteTaskRefs.relation, "created_from"),
            inArray(dailyNoteTaskRefs.taskId, [...candidateTaskIds])
          )
        );
      const migratedRows = await db
        .select()
        .from(dailyNoteFollowUps)
        .where(
          and(
            eq(dailyNoteFollowUps.workspaceId, normalizedWorkspaceId),
            eq(dailyNoteFollowUps.managerAccountId, managerAccountId),
            inArray(dailyNoteFollowUps.itemId, ids)
          )
        );

      const neededTaskIds = new Set<number>();
      for (const ref of refRows) {
        if (ref.taskId) neededTaskIds.add(ref.taskId);
      }
      for (const mig of migratedRows) {
        if (mig.taskId) neededTaskIds.add(mig.taskId);
        const mappedId = taskIdBySurfaceId.get(mig.itemId);
        if (mappedId !== undefined) neededTaskIds.add(mappedId);
      }
      const taskRows = neededTaskIds.size
        ? await db
            .select()
            .from(tasks)
            .where(and(eq(tasks.workspaceId, normalizedWorkspaceId), inArray(tasks.id, [...neededTaskIds])))
        : [];
      const taskById = new Map(taskRows.map((row) => [row.id, row]));
      const taskUsable = (task: TaskRow | undefined): task is TaskRow =>
        Boolean(task && !task.deletedAt && task.trackedByManagerId === managerAccountId);

      const hits: Array<{ itemId: number; noteId: number }> = [];
      for (const ref of refRows) {
        if (ref.taskId === null) continue;
        const task = taskById.get(ref.taskId);
        if (!taskUsable(task)) continue;
        const itemId = surfaceIdByTaskId.get(task.id) ?? task.id;
        if (!ids.includes(itemId)) continue;
        hits.push({ itemId, noteId: ref.noteId });
      }
      for (const mig of migratedRows) {
        const taskId = mig.taskId ?? taskIdBySurfaceId.get(mig.itemId);
        const task = taskId !== undefined ? taskById.get(taskId) : undefined;
        if (!taskUsable(task)) continue;
        hits.push({ itemId: mig.itemId, noteId: mig.noteId });
      }

      const noteIds = [...new Set(hits.map((hit) => hit.noteId))];
      const noteRows = noteIds.length
        ? await db
            .select({ id: dailyNotes.id, date: dailyNotes.date })
            .from(dailyNotes)
            .where(
              and(
                eq(dailyNotes.workspaceId, normalizedWorkspaceId),
                eq(dailyNotes.managerAccountId, managerAccountId),
                inArray(dailyNotes.id, noteIds)
              )
            )
        : [];
      const dateByNoteId = new Map(noteRows.map((row) => [row.id, row.date]));

      const seen = new Set<string>();
      const sources: DailyNoteSourcesResponse["sources"] = [];
      for (const hit of hits) {
        const date = dateByNoteId.get(hit.noteId);
        const key = `${hit.itemId}:${hit.noteId}`;
        if (date === undefined || seen.has(key)) continue;
        seen.add(key);
        sources.push({ itemId: hit.itemId, noteId: hit.noteId, date });
      }
      return { sources };
    }

    const rows = await db
      .select({
        itemId: dailyNoteFollowUps.itemId,
        noteId: dailyNoteFollowUps.noteId,
        date: dailyNotes.date,
      })
      .from(dailyNoteFollowUps)
      .innerJoin(dailyNotes, eq(dailyNoteFollowUps.noteId, dailyNotes.id))
      .where(
        and(
          eq(dailyNoteFollowUps.workspaceId, normalizedWorkspaceId),
          eq(dailyNoteFollowUps.managerAccountId, managerAccountId),
          eq(dailyNotes.workspaceId, normalizedWorkspaceId),
          eq(dailyNotes.managerAccountId, managerAccountId),
          inArray(dailyNoteFollowUps.itemId, ids)
        )
      )
      .orderBy(dailyNoteFollowUps.itemId);

    return {
      sources: rows.map((row) => ({ itemId: row.itemId, noteId: row.noteId, date: row.date })),
    };
  }

  private async createFollowUpInternal(
    managerAccountId: string,
    noteDate: string,
    input: CreateDailyNoteFollowUpPayload,
    normalizedWorkspaceId: string
  ): Promise<DailyNoteFollowUp> {
    const note = await this.findNote(managerAccountId, noteDate, normalizedWorkspaceId);
    if (!note) {
      throw new HttpError(404, "Note not found");
    }

    const title = input.title.trim();
    const payloadHash = hashPayload({
      route: "follow-up",
      noteDate,
      date: input.date,
      title,
      followUpAt: input.followUpAt,
    });

    return runInTransaction(async () => {
      if (await this.taskKeys.canonicalEnabled(normalizedWorkspaceId)) {
        const migratedReceipt = (await db.select().from(dailyNoteFollowUps).where(and(eq(dailyNoteFollowUps.workspaceId, normalizedWorkspaceId), eq(dailyNoteFollowUps.managerAccountId, managerAccountId), eq(dailyNoteFollowUps.requestId, input.requestId))).limit(1))[0];
        if (migratedReceipt) {
          if (migratedReceipt.payloadHash !== payloadHash) throw new HttpError(409, "requestId was already used with a different payload");
          const existing = (await this.canonicalFollowUps(managerAccountId, normalizedWorkspaceId, note.id)).find((entry) => entry.itemId === migratedReceipt.itemId);
          if (!existing) throw new HttpError(410, "Follow-up was deleted");
          return existing;
        }
        const receipt = (await db.select().from(dailyNoteTaskRefs).where(and(eq(dailyNoteTaskRefs.workspaceId, normalizedWorkspaceId), eq(dailyNoteTaskRefs.managerAccountId, managerAccountId), eq(dailyNoteTaskRefs.requestId, input.requestId))).limit(1))[0];
        if (receipt) {
          if (receipt.payloadHash !== payloadHash) throw new HttpError(409, "requestId was already used with a different payload");
          const existing = (await this.canonicalFollowUps(managerAccountId, normalizedWorkspaceId, note.id)).find((entry) => entry.itemId === receipt.taskId);
          if (existing) return existing;
          throw new HttpError(410, "Follow-up was deleted");
        }
        const task = await this.tasks.create({ title, scheduledOn: input.date, followUpAt: input.followUpAt, labels: ["category:follow_up"] }, { type: "manager", accountId: managerAccountId, workspaceId: normalizedWorkspaceId });
        await db.insert(dailyNoteTaskRefs).values({ workspaceId: normalizedWorkspaceId, managerAccountId, noteId: note.id, taskId: task.id, taskKey: task.taskKey, relation: "created_from", requestId: input.requestId, payloadHash, createdAt: nowIso() });
        await this.eventsService.append({ workspaceId: normalizedWorkspaceId, taskKey: task.taskKey, type: "note_ref", body: null, meta: { noteId: note.id, noteDate, relation: "created_from" } }, { type: "system", accountId: managerAccountId });
        return { itemId: task.id, title: task.title, date: input.date, status: "planned" as const, followUpAt: task.followUpAt ?? undefined };
      }
      const receiptRows = await db
        .select()
        .from(dailyNoteFollowUps)
        .where(
          and(
            eq(dailyNoteFollowUps.workspaceId, normalizedWorkspaceId),
            eq(dailyNoteFollowUps.managerAccountId, managerAccountId),
            eq(dailyNoteFollowUps.requestId, input.requestId)
          )
        )
        .limit(1);
      const receipt = receiptRows[0];

      if (receipt) {
        if (receipt.payloadHash !== payloadHash) {
          throw new HttpError(409, "requestId was already used with a different payload");
        }
        const existing = await this.findFollowUp(managerAccountId, receipt.itemId, normalizedWorkspaceId);
        if (existing) {
          return existing;
        }
        await db.delete(dailyNoteFollowUps).where(eq(dailyNoteFollowUps.id, receipt.id));
      }

      const item = await this.managerDesk.createItem(managerAccountId, {
        date: input.date,
        title,
        kind: "action",
        category: "follow_up",
        status: "planned",
        priority: "medium",
        followUpAt: input.followUpAt,
        source: "note",
        actor: { type: "manager", accountId: managerAccountId },
      }, normalizedWorkspaceId);

      await db.insert(dailyNoteFollowUps).values({
        workspaceId: normalizedWorkspaceId,
        managerAccountId,
        noteId: note.id,
        itemId: item.id,
        requestId: input.requestId,
        payloadHash,
        createdAt: nowIso(),
      });
      if (item.taskKey) {
        await db.insert(dailyNoteTaskRefs).values({ workspaceId: normalizedWorkspaceId, managerAccountId, noteId: note.id, taskKey: item.taskKey, relation: "created_from", createdAt: nowIso() }).onConflictDoNothing();
        await this.eventsService.append({ workspaceId: normalizedWorkspaceId, taskKey: item.taskKey, type: "note_ref", body: null, meta: { noteId: note.id, noteDate, relation: "created_from" } }, { type: "system", accountId: managerAccountId });
      }

      return {
        itemId: item.id,
        date: input.date,
        title: item.title,
        status: item.status,
        followUpAt: item.followUpAt,
      };
    });
  }

  private async findFollowUp(
    managerAccountId: string,
    itemId: number,
    normalizedWorkspaceId: string
  ): Promise<DailyNoteFollowUp | undefined> {
    const rows = await db
      .select({
        itemId: managerDeskItems.id,
        date: managerDeskDays.date,
        title: managerDeskItems.title,
        status: managerDeskItems.status,
        followUpAt: managerDeskItems.followUpAt,
      })
      .from(managerDeskItems)
      .innerJoin(managerDeskDays, eq(managerDeskItems.dayId, managerDeskDays.id))
      .where(
        and(
          eq(managerDeskItems.id, itemId),
          eq(managerDeskItems.workspaceId, normalizedWorkspaceId),
          eq(managerDeskDays.workspaceId, normalizedWorkspaceId),
          eq(managerDeskDays.managerAccountId, managerAccountId)
        )
      )
      .limit(1);

    const row = rows[0];
    if (!row) {
      return undefined;
    }
    return {
      itemId: row.itemId,
      date: row.date,
      title: row.title,
      status: row.status as ManagerDeskStatus,
      followUpAt: row.followUpAt ?? undefined,
    };
  }

  private async findNote(
    managerAccountId: string,
    date: string,
    normalizedWorkspaceId: string
  ): Promise<DailyNoteRow | undefined> {
    const rows = await db
      .select()
      .from(dailyNotes)
      .where(
        and(
          eq(dailyNotes.workspaceId, normalizedWorkspaceId),
          eq(dailyNotes.managerAccountId, managerAccountId),
          eq(dailyNotes.date, date)
        )
      )
      .limit(1);
    return rows[0];
  }
}
