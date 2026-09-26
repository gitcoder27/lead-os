import { and, asc, desc, eq, inArray, isNotNull, isNull, lte, sql } from "drizzle-orm";
import type {
  OneOnOneAgendaAttachRequest,
  OneOnOneAgendaItem,
  OneOnOneAgendaTask,
  OneOnOneAgendaReorderRequest,
  OneOnOneCadence,
  OneOnOneDueSignal,
  OneOnOneSeriesCreateRequest,
  OneOnOneSeriesDetail,
  OneOnOneSeriesSummary,
  OneOnOneSeriesUpdateRequest,
  OneOnOneSession,
  OneOnOneSessionActionRequest,
  OneOnOneSessionCreateRequest,
  OneOnOneSessionUpdateRequest,
  TaskStatus,
} from "shared/types";
import { db } from "../db/connection";
import { runInTransaction } from "../db/transaction";
import {
  configTable,
  developers,
  oneOnOneAgendaItems,
  oneOnOneSeries,
  oneOnOneSessions,
  tasks,
} from "../db/schema";
import { HttpError } from "../middleware/errorHandler";
import { todayIsoDate } from "../utils/date";
import { TaskKeysService } from "./task-keys.service";
import { TaskService, type TaskPrincipal } from "./task.service";
import { normalizeWorkspaceId } from "./workspace.service";

export const ONE_ON_ONE_FLAG = "one_on_one_enabled";

export type OneOnOneSeriesRow = typeof oneOnOneSeries.$inferSelect;
export type OneOnOneSessionRow = typeof oneOnOneSessions.$inferSelect;
export type OneOnOneAgendaRow = typeof oneOnOneAgendaItems.$inferSelect;
type TaskRow = typeof tasks.$inferSelect;

const OPEN_TASK_STATUSES: TaskStatus[] = ["open", "active", "blocked"];
const CLOSED_SESSION_STATUSES = ["done", "skipped"] as const;
const AGENDA_ATTACH_CONFLICT = "Task is already on the agenda";

// ── Cadence math (48 §5): all arithmetic on YYYY-MM-DD via UTC ──

function parseIsoDay(iso: string): number {
  return Date.parse(`${iso}T00:00:00Z`);
}

function toIsoDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDaysIso(iso: string, days: number): string {
  return toIsoDay(parseIsoDay(iso) + days * 86_400_000);
}

function diffDaysIso(from: string, to: string): number {
  return Math.round((parseIsoDay(to) - parseIsoDay(from)) / 86_400_000);
}

/** Same day-of-month one month later, clamped to the target month's length. */
function addMonthsIso(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  const targetYear = year!;
  const targetMonth = month!; // 1-based source month → 0-based index for +1 month
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  return toIsoDay(Date.UTC(targetYear, targetMonth, Math.min(day!, lastDay)));
}

function advanceByCadence(iso: string, cadence: OneOnOneCadence): string {
  switch (cadence) {
    case "weekly":
      return addDaysIso(iso, 7);
    case "biweekly":
      return addDaysIso(iso, 14);
    case "monthly":
      return addMonthsIso(iso);
    default:
      return iso;
  }
}

function weekdayOf(iso: string): number {
  return new Date(parseIsoDay(iso)).getUTCDay();
}

/** Next occurrence of `weekday` (0 = Sunday) on or after `iso`. */
function snapToWeekday(iso: string, weekday: number): string {
  return addDaysIso(iso, (weekday - weekdayOf(iso) + 7) % 7);
}

/**
 * 48 §5 (OO-D4): next `scheduled_for`. Anchored to the last session's planned
 * date so cadence rhythm survives late completions; stepped forward until it
 * is not in the past, then snapped to the preferred weekday. `ad_hoc` and
 * fresh series never schedule ahead of today.
 */
export function nextSessionDate(
  cadence: OneOnOneCadence,
  preferredWeekday: number | null,
  lastScheduledFor: string | null,
  today: string,
): string | null {
  if (cadence === "ad_hoc") {
    return null;
  }
  if (!lastScheduledFor) {
    return preferredWeekday !== null && preferredWeekday !== undefined
      ? snapToWeekday(today, preferredWeekday)
      : today;
  }
  let candidate = advanceByCadence(lastScheduledFor, cadence);
  while (candidate < today) {
    candidate = advanceByCadence(candidate, cadence);
  }
  return preferredWeekday !== null && preferredWeekday !== undefined
    ? snapToWeekday(candidate, preferredWeekday)
    : candidate;
}

export class OneOnOneService {
  private readonly keys = new TaskKeysService();
  private readonly taskService = new TaskService();

  /** 48 §0: `one_on_one_enabled` — purely additive, no stage prerequisite. */
  async enabled(workspaceId?: string): Promise<boolean> {
    const scope = normalizeWorkspaceId(workspaceId);
    const rows = await db
      .select({ value: configTable.value })
      .from(configTable)
      .where(and(eq(configTable.workspaceId, scope), eq(configTable.key, ONE_ON_ONE_FLAG)))
      .limit(1);
    return rows[0]?.value === "true";
  }

  async assertEnabled(workspaceId?: string): Promise<void> {
    if (!(await this.enabled(workspaceId))) throw new HttpError(404, "Not Found");
  }

  /** CLI toggle — mirrors TaskKeysService.setPhase3Enabled without a stage gate. */
  async setEnabled(workspaceId: string | undefined, enable: boolean): Promise<void> {
    const scope = normalizeWorkspaceId(workspaceId);
    await db
      .insert(configTable)
      .values({ workspaceId: scope, key: ONE_ON_ONE_FLAG, value: enable ? "true" : "false" })
      .onConflictDoUpdate({
        target: [configTable.workspaceId, configTable.key],
        set: { value: enable ? "true" : "false" },
      });
  }

  // ── Series ──

  async listSeries(workspaceId?: string, today = todayIsoDate()): Promise<OneOnOneSeriesSummary[]> {
    const scope = normalizeWorkspaceId(workspaceId);
    const rows = await db
      .select({ series: oneOnOneSeries, developerName: developers.displayName })
      .from(oneOnOneSeries)
      .innerJoin(
        developers,
        and(
          eq(developers.workspaceId, scope),
          eq(developers.accountId, oneOnOneSeries.developerAccountId),
        ),
      )
      .where(eq(oneOnOneSeries.workspaceId, scope))
      .orderBy(asc(developers.displayName));
    const ids = rows.map((row) => row.series.id);
    const nextSessions = await this.nextSessionBySeries(ids, scope);
    const openCounts = await this.openAgendaCounts(ids, scope);
    return rows.map(({ series, developerName }) =>
      this.toSummary(series, developerName, nextSessions.get(series.id), openCounts.get(series.id) ?? 0, today),
    );
  }

  async createSeries(
    input: OneOnOneSeriesCreateRequest,
    workspaceId?: string,
  ): Promise<OneOnOneSeriesDetail> {
    const scope = normalizeWorkspaceId(workspaceId);
    return runInTransaction(async () => {
      const developer = (
        await db
          .select()
          .from(developers)
          .where(and(eq(developers.workspaceId, scope), eq(developers.accountId, input.developerAccountId)))
          .limit(1)
      )[0];
      if (!developer) throw new HttpError(404, "Developer not found");
      const existing = (
        await db
          .select({ id: oneOnOneSeries.id })
          .from(oneOnOneSeries)
          .where(
            and(
              eq(oneOnOneSeries.workspaceId, scope),
              eq(oneOnOneSeries.developerAccountId, input.developerAccountId),
            ),
          )
          .limit(1)
      )[0];
      if (existing) throw new HttpError(409, "A 1:1 series already exists for this developer");
      const row = (
        await db
          .insert(oneOnOneSeries)
          .values({
            workspaceId: scope,
            developerAccountId: input.developerAccountId,
            cadence: input.cadence,
            preferredWeekday: input.preferredWeekday ?? null,
            active: 1,
            createdAt: new Date().toISOString(),
          })
          .returning()
      )[0]!;
      await this.ensureNextSession(row, scope);
      return this.getDetail(row.id, scope);
    });
  }

  async updateSeries(
    id: number,
    input: OneOnOneSeriesUpdateRequest,
    workspaceId?: string,
  ): Promise<OneOnOneSeriesDetail> {
    const scope = normalizeWorkspaceId(workspaceId);
    return runInTransaction(async () => {
      const series = await this.requireSeries(id, scope);
      await db
        .update(oneOnOneSeries)
        .set({
          cadence: input.cadence ?? series.cadence,
          preferredWeekday:
            input.preferredWeekday === undefined ? series.preferredWeekday : input.preferredWeekday,
          active: input.active === undefined ? series.active : input.active ? 1 : 0,
        })
        .where(eq(oneOnOneSeries.id, series.id));
      const updated = await this.requireSeries(id, scope);
      await this.ensureNextSession(updated, scope);
      return this.getDetail(id, scope);
    });
  }

  async getDetail(
    id: number,
    workspaceId?: string,
    today = todayIsoDate(),
  ): Promise<OneOnOneSeriesDetail> {
    const scope = normalizeWorkspaceId(workspaceId);
    const series = await this.requireSeries(id, scope);
    // 48 §5: lazy auto-scheduling — the next session materializes on read.
    await this.ensureNextSession(series, scope, today);

    const sessionRows = await db
      .select()
      .from(oneOnOneSessions)
      .where(and(eq(oneOnOneSessions.workspaceId, scope), eq(oneOnOneSessions.seriesId, series.id)))
      .orderBy(desc(oneOnOneSessions.scheduledFor), desc(oneOnOneSessions.id));

    const agendaRows = await this.agendaRows(series.id, scope);
    const carriedBoundary = await this.latestClosedSession(series.id, scope);
    const agenda = agendaRows.map(({ item, task }) => this.toAgendaItem(item, task, carriedBoundary));
    const openAgendaCount = agendaRows.filter(({ task }) => OPEN_TASK_STATUSES.includes(task.status as TaskStatus) && !task.deletedAt).length;

    const developerName = await this.developerName(series.developerAccountId, scope);
    const upcoming =
      sessionRows
        .filter((row) => row.status === "scheduled")
        .sort((a, b) => a.scheduledFor.localeCompare(b.scheduledFor) || a.id - b.id)[0] ?? null;

    return {
      series: this.toSummary(series, developerName, upcoming, openAgendaCount, today),
      upcoming: upcoming ? this.toSession(upcoming, openAgendaCount) : null,
      sessions: sessionRows.map((row) => this.toSession(row, this.sessionAgendaCount(row, agendaRows))),
      agenda,
    };
  }

  // ── Sessions ──

  /** Manual session create — also the ad_hoc path (48 §3). */
  async createSession(
    seriesId: number,
    input: OneOnOneSessionCreateRequest,
    workspaceId?: string,
  ): Promise<OneOnOneSeriesDetail> {
    const scope = normalizeWorkspaceId(workspaceId);
    return runInTransaction(async () => {
      const series = await this.requireSeries(seriesId, scope);
      const existing = await this.scheduledSessions(series.id, scope);
      if (existing.length) throw new HttpError(409, "A session is already scheduled for this series");
      await db.insert(oneOnOneSessions).values({
        workspaceId: scope,
        seriesId: series.id,
        scheduledFor: input.scheduledFor ?? todayIsoDate(),
        status: "scheduled",
        notes: "",
        createdAt: new Date().toISOString(),
      });
      return this.getDetail(series.id, scope);
    });
  }

  /**
   * Session lifecycle: reschedule (`scheduledFor`), notes autosave, Start
   * (`started`), and `scheduled → done | skipped` transitions. Closing a
   * session lazily creates the next one for non-ad_hoc cadences.
   */
  async updateSession(
    seriesId: number,
    sessionId: number,
    input: OneOnOneSessionUpdateRequest,
    workspaceId?: string,
    today = todayIsoDate(),
  ): Promise<OneOnOneSeriesDetail> {
    const scope = normalizeWorkspaceId(workspaceId);
    return runInTransaction(async () => {
      const series = await this.requireSeries(seriesId, scope);
      const session = await this.requireSession(series.id, sessionId, scope);
      const now = new Date().toISOString();
      const patch: Partial<
        Pick<OneOnOneSessionRow, "status" | "notes" | "scheduledFor" | "startedAt" | "completedAt">
      > = {};

      if (input.notes !== undefined) patch.notes = input.notes;
      if (input.scheduledFor !== undefined) patch.scheduledFor = input.scheduledFor;
      if (input.started !== undefined) {
        if (session.status !== "scheduled") {
          throw new HttpError(409, "Only a scheduled session can start");
        }
        patch.startedAt = input.started ? (session.startedAt ?? now) : null;
      }
      if (input.status !== undefined && input.status !== session.status) {
        if (input.status === "scheduled") {
          // Reopening a closed session requires a free upcoming slot.
          const scheduled = await this.scheduledSessions(series.id, scope);
          if (scheduled.length) {
            throw new HttpError(409, "Another session is already scheduled");
          }
          patch.status = "scheduled";
          patch.completedAt = null;
        } else {
          if (session.status !== "scheduled") {
            throw new HttpError(409, `Session is already ${session.status}`);
          }
          patch.status = input.status;
          patch.completedAt = now;
        }
      }

      if (Object.keys(patch).length) {
        await db.update(oneOnOneSessions).set(patch).where(eq(oneOnOneSessions.id, session.id));
      }

      // 48 §4.2: completing without reopening the agenda detaches the still-
      // open items (the tasks stay open; the links are removed).
      if (patch.status === "done" && input.reopenCarried === false) {
        await this.detachOpenAgendaItems(series.id, scope);
      }
      if (patch.status === "done" || patch.status === "skipped") {
        await this.ensureNextSession(series, scope, today);
      }
      return this.getDetail(series.id, scope, today);
    });
  }

  // ── Agenda ──

  async listAgenda(seriesId: number, workspaceId?: string): Promise<OneOnOneAgendaItem[]> {
    const scope = normalizeWorkspaceId(workspaceId);
    const series = await this.requireSeries(seriesId, scope);
    const [rows, boundary] = await Promise.all([
      this.agendaRows(series.id, scope),
      this.latestClosedSession(series.id, scope),
    ]);
    return rows.map(({ item, task }) => this.toAgendaItem(item, task, boundary));
  }

  /**
   * Attach an existing task (`taskId`/`taskKey`) or create one inline from a
   * freeform `title` — 48 §4.2 "Add to agenda…" capture. Create + link run in
   * a single transaction.
   */
  async attachAgenda(
    seriesId: number,
    input: OneOnOneAgendaAttachRequest,
    principal: TaskPrincipal,
    workspaceId?: string,
  ): Promise<OneOnOneAgendaItem> {
    const scope = normalizeWorkspaceId(workspaceId);
    return runInTransaction(async () => {
      const series = await this.requireSeries(seriesId, scope);
      const task = await this.resolveOrCreateAgendaTask(series, input, principal, scope);
      const item = await this.attachTask(series.id, task.id, scope);
      const boundary = await this.latestClosedSession(series.id, scope);
      return this.toAgendaItem(item, task, boundary);
    });
  }

  async reorderAgenda(
    seriesId: number,
    input: OneOnOneAgendaReorderRequest,
    workspaceId?: string,
  ): Promise<OneOnOneAgendaItem[]> {
    const scope = normalizeWorkspaceId(workspaceId);
    return runInTransaction(async () => {
      const series = await this.requireSeries(seriesId, scope);
      const rows = await db
        .select({ id: oneOnOneAgendaItems.id })
        .from(oneOnOneAgendaItems)
        .where(
          and(eq(oneOnOneAgendaItems.workspaceId, scope), eq(oneOnOneAgendaItems.seriesId, series.id)),
        );
      const known = new Set(rows.map((row) => row.id));
      const incoming = new Set(input.itemIds);
      if (incoming.size !== input.itemIds.length || rows.length !== input.itemIds.length || input.itemIds.some((id) => !known.has(id))) {
        throw new HttpError(400, "itemIds must be a permutation of the current agenda");
      }
      for (const [position, itemId] of input.itemIds.entries()) {
        await db
          .update(oneOnOneAgendaItems)
          .set({ position })
          .where(eq(oneOnOneAgendaItems.id, itemId));
      }
      return this.listAgenda(series.id, scope);
    });
  }

  /** Detach removes the link row (history is the closed-task case, 48 §5). */
  async detachAgenda(seriesId: number, itemId: number, workspaceId?: string): Promise<void> {
    const scope = normalizeWorkspaceId(workspaceId);
    await runInTransaction(async () => {
      const series = await this.requireSeries(seriesId, scope);
      const row = (
        await db
          .select({ id: oneOnOneAgendaItems.id })
          .from(oneOnOneAgendaItems)
          .where(
            and(
              eq(oneOnOneAgendaItems.workspaceId, scope),
              eq(oneOnOneAgendaItems.seriesId, series.id),
              eq(oneOnOneAgendaItems.id, itemId),
            ),
          )
          .limit(1)
      )[0];
      if (!row) throw new HttpError(404, "Agenda item not found");
      await db.delete(oneOnOneAgendaItems).where(eq(oneOnOneAgendaItems.id, row.id));
      await this.reindexAgenda(series.id, scope);
    });
  }

  /**
   * 48 §3 (OO-D8): create a canonical action item + attach it to the agenda in
   * one transaction — if the attach fails the task rolls back too.
   */
  async createSessionAction(
    seriesId: number,
    sessionId: number,
    input: OneOnOneSessionActionRequest,
    principal: TaskPrincipal,
    workspaceId?: string,
  ): Promise<{ item: OneOnOneAgendaItem }> {
    const scope = normalizeWorkspaceId(workspaceId);
    return runInTransaction(async () => {
      const series = await this.requireSeries(seriesId, scope);
      const session = await this.requireSession(series.id, sessionId, scope);
      if (session.status !== "scheduled") {
        throw new HttpError(409, `Cannot add action items to a ${session.status} session`);
      }
      const ownerType = input.ownerType ?? "developer";
      const task = await this.taskService.create(
        {
          title: input.title,
          ownerType,
          ownerId: input.ownerId ?? (ownerType === "developer" ? series.developerAccountId : principal.accountId),
          scheduledOn: input.scheduledOn ?? undefined,
        },
        principal,
        { source: "one_on_one" },
      );
      const item = await this.attachTask(series.id, task.id, scope);
      const boundary = await this.latestClosedSession(series.id, scope);
      return { item: this.toAgendaItem(item, task, boundary) };
    });
  }

  // ── Signals (48 §4.4 — read-only) ──

  /**
   * Due/overdue scheduled sessions per developer. Powers the standup badge and
   * the Today attention item — this method never writes.
   */
  async dueSignals(workspaceId?: string, date = todayIsoDate()): Promise<OneOnOneDueSignal[]> {
    const scope = normalizeWorkspaceId(workspaceId);
    const rows = await db
      .select({
        sessionId: oneOnOneSessions.id,
        scheduledFor: oneOnOneSessions.scheduledFor,
        seriesId: oneOnOneSeries.id,
        developerAccountId: oneOnOneSeries.developerAccountId,
        developerName: developers.displayName,
      })
      .from(oneOnOneSessions)
      .innerJoin(
        oneOnOneSeries,
        and(
          eq(oneOnOneSeries.id, oneOnOneSessions.seriesId),
          eq(oneOnOneSeries.workspaceId, scope),
          eq(oneOnOneSeries.active, 1),
        ),
      )
      .innerJoin(
        developers,
        and(
          eq(developers.workspaceId, scope),
          eq(developers.accountId, oneOnOneSeries.developerAccountId),
        ),
      )
      .where(
        and(
          eq(oneOnOneSessions.workspaceId, scope),
          eq(oneOnOneSessions.status, "scheduled"),
          lte(oneOnOneSessions.scheduledFor, date),
        ),
      )
      .orderBy(asc(oneOnOneSessions.scheduledFor), asc(oneOnOneSessions.id));

    const byDeveloper = new Map<string, OneOnOneDueSignal>();
    for (const row of rows) {
      if (byDeveloper.has(row.developerAccountId)) continue;
      byDeveloper.set(row.developerAccountId, {
        seriesId: row.seriesId,
        sessionId: row.sessionId,
        developerAccountId: row.developerAccountId,
        developerName: row.developerName,
        scheduledFor: row.scheduledFor,
        overdueDays: Math.max(0, diffDaysIso(row.scheduledFor, date)),
      });
    }
    return [...byDeveloper.values()];
  }

  // ── Internals ──

  private async requireSeries(id: number, workspaceId: string): Promise<OneOnOneSeriesRow> {
    const row = (
      await db
        .select()
        .from(oneOnOneSeries)
        .where(and(eq(oneOnOneSeries.id, id), eq(oneOnOneSeries.workspaceId, workspaceId)))
        .limit(1)
    )[0];
    if (!row) throw new HttpError(404, "1:1 series not found");
    return row;
  }

  private async requireSession(
    seriesId: number,
    sessionId: number,
    workspaceId: string,
  ): Promise<OneOnOneSessionRow> {
    const row = (
      await db
        .select()
        .from(oneOnOneSessions)
        .where(
          and(
            eq(oneOnOneSessions.id, sessionId),
            eq(oneOnOneSessions.workspaceId, workspaceId),
            eq(oneOnOneSessions.seriesId, seriesId),
          ),
        )
        .limit(1)
    )[0];
    if (!row) throw new HttpError(404, "Session not found");
    return row;
  }

  private async scheduledSessions(seriesId: number, workspaceId: string): Promise<OneOnOneSessionRow[]> {
    return db
      .select()
      .from(oneOnOneSessions)
      .where(
        and(
          eq(oneOnOneSessions.workspaceId, workspaceId),
          eq(oneOnOneSessions.seriesId, seriesId),
          eq(oneOnOneSessions.status, "scheduled"),
        ),
      )
      .orderBy(asc(oneOnOneSessions.scheduledFor), asc(oneOnOneSessions.id));
  }

  /** 48 §5 (OO-D4): lazy auto-scheduling — creates the next session if missing. */
  private async ensureNextSession(
    series: OneOnOneSeriesRow,
    workspaceId: string,
    today = todayIsoDate(),
  ): Promise<void> {
    if (!series.active || series.cadence === "ad_hoc") return;
    const scheduled = await this.scheduledSessions(series.id, workspaceId);
    if (scheduled.length) return;
    const last = (
      await db
        .select({ scheduledFor: oneOnOneSessions.scheduledFor })
        .from(oneOnOneSessions)
        .where(and(eq(oneOnOneSessions.workspaceId, workspaceId), eq(oneOnOneSessions.seriesId, series.id)))
        .orderBy(desc(oneOnOneSessions.scheduledFor), desc(oneOnOneSessions.id))
        .limit(1)
    )[0];
    const scheduledFor = nextSessionDate(
      series.cadence as OneOnOneCadence,
      series.preferredWeekday,
      last?.scheduledFor ?? null,
      today,
    );
    if (!scheduledFor) return;
    await db.insert(oneOnOneSessions).values({
      workspaceId,
      seriesId: series.id,
      scheduledFor,
      status: "scheduled",
      notes: "",
      createdAt: new Date().toISOString(),
    });
  }

  private async agendaRows(
    seriesId: number,
    workspaceId: string,
  ): Promise<{ item: OneOnOneAgendaRow; task: TaskRow }[]> {
    return db
      .select({ item: oneOnOneAgendaItems, task: tasks })
      .from(oneOnOneAgendaItems)
      .innerJoin(tasks, eq(tasks.id, oneOnOneAgendaItems.taskId))
      .where(
        and(eq(oneOnOneAgendaItems.workspaceId, workspaceId), eq(oneOnOneAgendaItems.seriesId, seriesId)),
      )
      .orderBy(asc(oneOnOneAgendaItems.position), asc(oneOnOneAgendaItems.id));
  }

  /**
   * 48 §4.2 "carried from <date>": the latest closed (done|skipped) session
   * that ended while the item was attached. Comparison is `addedAt <
   * completedAt` — items attached during the session still count as carried.
   */
  private async latestClosedSession(
    seriesId: number,
    workspaceId: string,
  ): Promise<{ scheduledFor: string; completedAt: string } | null> {
    const row = (
      await db
        .select({ scheduledFor: oneOnOneSessions.scheduledFor, completedAt: oneOnOneSessions.completedAt })
        .from(oneOnOneSessions)
        .where(
          and(
            eq(oneOnOneSessions.workspaceId, workspaceId),
            eq(oneOnOneSessions.seriesId, seriesId),
            inArray(oneOnOneSessions.status, [...CLOSED_SESSION_STATUSES]),
            isNotNull(oneOnOneSessions.completedAt),
          ),
        )
        .orderBy(desc(oneOnOneSessions.completedAt), desc(oneOnOneSessions.id))
        .limit(1)
    )[0];
    return row?.completedAt ? { scheduledFor: row.scheduledFor, completedAt: row.completedAt } : null;
  }

  private async attachTask(
    seriesId: number,
    taskId: number,
    workspaceId: string,
  ): Promise<OneOnOneAgendaRow> {
    const duplicate = (
      await db
        .select({ id: oneOnOneAgendaItems.id })
        .from(oneOnOneAgendaItems)
        .where(
          and(
            eq(oneOnOneAgendaItems.workspaceId, workspaceId),
            eq(oneOnOneAgendaItems.seriesId, seriesId),
            eq(oneOnOneAgendaItems.taskId, taskId),
          ),
        )
        .limit(1)
    )[0];
    if (duplicate) throw new HttpError(409, AGENDA_ATTACH_CONFLICT);
    const maxPosition = (
      await db
        .select({ position: sql<number>`coalesce(max(${oneOnOneAgendaItems.position}), -1)` })
        .from(oneOnOneAgendaItems)
        .where(and(eq(oneOnOneAgendaItems.workspaceId, workspaceId), eq(oneOnOneAgendaItems.seriesId, seriesId)))
    )[0]?.position ?? -1;
    return (
      await db
        .insert(oneOnOneAgendaItems)
        .values({
          workspaceId,
          seriesId,
          taskId,
          position: maxPosition + 1,
          addedAt: new Date().toISOString(),
        })
        .returning()
    )[0]!;
  }

  private async reindexAgenda(seriesId: number, workspaceId: string): Promise<void> {
    const rows = await db
      .select({ id: oneOnOneAgendaItems.id })
      .from(oneOnOneAgendaItems)
      .where(and(eq(oneOnOneAgendaItems.workspaceId, workspaceId), eq(oneOnOneAgendaItems.seriesId, seriesId)))
      .orderBy(asc(oneOnOneAgendaItems.position), asc(oneOnOneAgendaItems.id));
    for (const [position, row] of rows.entries()) {
      await db.update(oneOnOneAgendaItems).set({ position }).where(eq(oneOnOneAgendaItems.id, row.id));
    }
  }

  private async detachOpenAgendaItems(seriesId: number, workspaceId: string): Promise<void> {
    const rows = await db
      .select({ id: oneOnOneAgendaItems.id })
      .from(oneOnOneAgendaItems)
      .innerJoin(tasks, eq(tasks.id, oneOnOneAgendaItems.taskId))
      .where(
        and(
          eq(oneOnOneAgendaItems.workspaceId, workspaceId),
          eq(oneOnOneAgendaItems.seriesId, seriesId),
          inArray(tasks.status, OPEN_TASK_STATUSES),
          isNull(tasks.deletedAt),
        ),
      );
    for (const row of rows) {
      await db.delete(oneOnOneAgendaItems).where(eq(oneOnOneAgendaItems.id, row.id));
    }
    await this.reindexAgenda(seriesId, workspaceId);
  }

  private async resolveOrCreateAgendaTask(
    series: OneOnOneSeriesRow,
    input: OneOnOneAgendaAttachRequest,
    principal: TaskPrincipal,
    workspaceId: string,
  ): Promise<TaskRow> {
    if (input.title !== undefined) {
      return this.taskService.create(
        { title: input.title, ownerType: "developer", ownerId: series.developerAccountId },
        principal,
        { source: "one_on_one" },
      );
    }
    if (input.taskId !== undefined) {
      const row = (
        await db
          .select()
          .from(tasks)
          .where(and(eq(tasks.id, input.taskId), eq(tasks.workspaceId, workspaceId)))
          .limit(1)
      )[0];
      if (!row) throw new HttpError(404, "Task not found");
      if (row.deletedAt) throw new HttpError(410, "Task was deleted");
      return row;
    }
    if (input.taskKey !== undefined) {
      const resolved = await this.keys.resolve(workspaceId, input.taskKey);
      const row = resolved
        ? (
            await db
              .select()
              .from(tasks)
              .where(and(eq(tasks.taskKey, resolved), eq(tasks.workspaceId, workspaceId)))
              .limit(1)
          )[0]
        : undefined;
      if (!row) throw new HttpError(404, "Task not found");
      if (row.deletedAt) throw new HttpError(410, "Task was deleted");
      return row;
    }
    throw new HttpError(400, "Provide taskId, taskKey, or title");
  }

  private async developerName(accountId: string, workspaceId: string): Promise<string> {
    const row = (
      await db
        .select({ displayName: developers.displayName })
        .from(developers)
        .where(and(eq(developers.workspaceId, workspaceId), eq(developers.accountId, accountId)))
        .limit(1)
    )[0];
    return row?.displayName ?? accountId;
  }

  private async nextSessionBySeries(
    seriesIds: number[],
    workspaceId: string,
  ): Promise<Map<number, OneOnOneSessionRow>> {
    if (!seriesIds.length) return new Map();
    const rows = await db
      .select()
      .from(oneOnOneSessions)
      .where(
        and(
          eq(oneOnOneSessions.workspaceId, workspaceId),
          inArray(oneOnOneSessions.seriesId, seriesIds),
          eq(oneOnOneSessions.status, "scheduled"),
        ),
      )
      .orderBy(asc(oneOnOneSessions.scheduledFor), asc(oneOnOneSessions.id));
    const map = new Map<number, OneOnOneSessionRow>();
    for (const row of rows) {
      if (!map.has(row.seriesId)) map.set(row.seriesId, row);
    }
    return map;
  }

  private async openAgendaCounts(
    seriesIds: number[],
    workspaceId: string,
  ): Promise<Map<number, number>> {
    if (!seriesIds.length) return new Map();
    const rows = await db
      .select({ seriesId: oneOnOneAgendaItems.seriesId, count: sql<number>`count(*)` })
      .from(oneOnOneAgendaItems)
      .innerJoin(tasks, eq(tasks.id, oneOnOneAgendaItems.taskId))
      .where(
        and(
          eq(oneOnOneAgendaItems.workspaceId, workspaceId),
          inArray(oneOnOneAgendaItems.seriesId, seriesIds),
          inArray(tasks.status, OPEN_TASK_STATUSES),
          isNull(tasks.deletedAt),
        ),
      )
      .groupBy(oneOnOneAgendaItems.seriesId);
    return new Map(rows.map((row) => [row.seriesId, row.count]));
  }

  private toSummary(
    series: OneOnOneSeriesRow,
    developerName: string,
    upcoming: OneOnOneSessionRow | undefined | null,
    openAgendaCount: number,
    today: string,
  ): OneOnOneSeriesSummary {
    return {
      id: series.id,
      developerAccountId: series.developerAccountId,
      developerName,
      cadence: series.cadence as OneOnOneCadence,
      preferredWeekday: series.preferredWeekday,
      active: series.active === 1,
      nextSessionDate: upcoming?.scheduledFor ?? null,
      nextSessionOverdueDays: upcoming ? Math.max(0, diffDaysIso(upcoming.scheduledFor, today)) : null,
      openAgendaCount,
      createdAt: series.createdAt,
    };
  }

  private toSession(row: OneOnOneSessionRow, agendaCount: number): OneOnOneSession {
    return {
      id: row.id,
      seriesId: row.seriesId,
      scheduledFor: row.scheduledFor,
      status: row.status as OneOnOneSession["status"],
      notes: row.notes,
      startedAt: row.startedAt,
      completedAt: row.completedAt,
      createdAt: row.createdAt,
      agendaCount,
    };
  }

  private toAgendaItem(
    item: OneOnOneAgendaRow,
    task: TaskRow,
    boundary: { scheduledFor: string; completedAt: string } | null,
  ): OneOnOneAgendaItem {
    const projection: OneOnOneAgendaTask = {
      taskId: task.id,
      taskKey: task.taskKey,
      title: task.title,
      status: task.status as TaskStatus,
      ownerType: task.ownerType as OneOnOneAgendaTask["ownerType"],
      ownerId: task.ownerId,
      deletedAt: task.deletedAt,
    };
    return {
      id: item.id,
      seriesId: item.seriesId,
      taskId: item.taskId,
      position: item.position,
      addedAt: item.addedAt,
      carriedFrom: boundary && item.addedAt < boundary.completedAt ? boundary.scheduledFor : null,
      task: projection,
    };
  }

  /**
   * Approximate agenda snapshot for a session row (48 §4.2 history column):
   * closed sessions count links that were attached before they closed; the
   * live session counts open agenda items.
   */
  private sessionAgendaCount(
    session: OneOnOneSessionRow,
    rows: { item: OneOnOneAgendaRow; task: TaskRow }[],
  ): number {
    if (session.status === "scheduled") {
      return rows.filter(({ task }) => OPEN_TASK_STATUSES.includes(task.status as TaskStatus) && !task.deletedAt).length;
    }
    const closedAt = session.completedAt ?? session.createdAt;
    return rows.filter(({ item }) => item.addedAt <= closedAt).length;
  }
}
