import { and, desc, eq, gte, isNull } from "drizzle-orm";
import type { TodayCheckInAsk, TodayRhythmBoundaries, TodayRhythmSettings } from "shared/types";
import { db } from "../db/connection";
import {
  configTable,
  developers,
  issues,
  standupSessions,
  tasks,
  teamTrackerCheckIns,
  teamTrackerDays,
  todayCheckInAsks,
  todayVisits,
} from "../db/schema";
import { HttpError } from "../middleware/errorHandler";
import { addDaysToIsoDay, normalizeRhythmBoundaries, validateRhythmBoundaries } from "./today-clock";
import { normalizeWorkspaceId } from "./workspace.service";

const RHYTHM_CONFIG_KEY = "today_rhythm_boundaries";

/** A gap longer than this between Today requests starts a new visit. */
export const TODAY_VISIT_IDLE_MS = 45 * 60 * 1000;

export interface StandupSessionSummary {
  startedAt: string;
  endedAt: string;
  reviewed: string[];
  flagged: string[];
  sessionCount: number;
}

export interface CheckInSince {
  developerAccountId: string;
  displayName: string;
  createdAt: string;
}

/**
 * docs/53 §8.5-7: small persisted state behind the stage-driven Today —
 * workspace rhythm boundaries, the per-manager visit anchor for the
 * since-last-visit delta, check-in asks, and the reads Today needs from
 * standup sessions, check-ins and resolved issues.
 */
export class TodayStateService {
  async getRhythmSettings(workspaceId?: string): Promise<TodayRhythmSettings> {
    const scope = normalizeWorkspaceId(workspaceId);
    const row = (await db
      .select({ value: configTable.value })
      .from(configTable)
      .where(and(eq(configTable.workspaceId, scope), eq(configTable.key, RHYTHM_CONFIG_KEY)))
      .limit(1))[0];
    let parsed: unknown;
    try {
      parsed = row ? JSON.parse(row.value) : undefined;
    } catch {
      parsed = undefined;
    }
    return { boundaries: normalizeRhythmBoundaries(parsed) };
  }

  /** docs/56 P2-02: the manager has saved their own stage times (otherwise the defaults apply). */
  async hasCustomRhythm(workspaceId?: string): Promise<boolean> {
    const scope = normalizeWorkspaceId(workspaceId);
    const row = (await db
      .select({ value: configTable.value })
      .from(configTable)
      .where(and(eq(configTable.workspaceId, scope), eq(configTable.key, RHYTHM_CONFIG_KEY)))
      .limit(1))[0];
    return Boolean(row);
  }

  /** docs/56 P2-02: any live task in the workspace (for the getting-started checklist). */
  async hasTasks(workspaceId?: string): Promise<boolean> {
    const scope = normalizeWorkspaceId(workspaceId);
    const row = (await db
      .select({ id: tasks.id })
      .from(tasks)
      .where(and(eq(tasks.workspaceId, scope), isNull(tasks.deletedAt)))
      .limit(1))[0];
    return Boolean(row);
  }

  async updateRhythmSettings(boundaries: TodayRhythmBoundaries, workspaceId?: string): Promise<TodayRhythmSettings> {
    const error = validateRhythmBoundaries(boundaries);
    if (error) throw new HttpError(400, error);
    const scope = normalizeWorkspaceId(workspaceId);
    const value = JSON.stringify({
      standupStart: boundaries.standupStart,
      middayStart: boundaries.middayStart,
      wrapUpStart: boundaries.wrapUpStart,
    });
    await db
      .insert(configTable)
      .values({ workspaceId: scope, key: RHYTHM_CONFIG_KEY, value })
      .onConflictDoUpdate({ target: [configTable.workspaceId, configTable.key], set: { value } });
    return this.getRhythmSettings(scope);
  }

  /**
   * Touch the manager's Today visit and return the delta baseline: the last
   * activity before the current visit (undefined on the very first visit).
   * Polling keeps `last_active_at` fresh, so only a real absence (closed or
   * hidden tab past the idle window) rolls the baseline forward.
   */
  async recordVisit(managerAccountId: string, workspaceId?: string, now = new Date()): Promise<string | undefined> {
    const scope = normalizeWorkspaceId(workspaceId);
    const nowIso = now.toISOString();
    const existing = (await db
      .select()
      .from(todayVisits)
      .where(and(eq(todayVisits.workspaceId, scope), eq(todayVisits.managerAccountId, managerAccountId)))
      .limit(1))[0];

    if (!existing) {
      await db
        .insert(todayVisits)
        .values({ workspaceId: scope, managerAccountId, visitStartedAt: nowIso, lastActiveAt: nowIso, baselineAt: null })
        .onConflictDoNothing();
      return undefined;
    }

    const lastActiveMs = Date.parse(existing.lastActiveAt);
    const isNewVisit = Number.isNaN(lastActiveMs) || now.getTime() - lastActiveMs > TODAY_VISIT_IDLE_MS;
    const baselineAt = isNewVisit ? existing.lastActiveAt : existing.baselineAt;
    await db
      .update(todayVisits)
      .set(isNewVisit
        ? { visitStartedAt: nowIso, lastActiveAt: nowIso, baselineAt }
        : { lastActiveAt: nowIso })
      .where(and(eq(todayVisits.workspaceId, scope), eq(todayVisits.managerAccountId, managerAccountId)));
    return baselineAt ?? undefined;
  }

  /** Today's sealed standup rounds for this manager, newest first, folded into one summary. */
  async getStandupSummary(managerAccountId: string, date: string, workspaceId?: string): Promise<StandupSessionSummary | undefined> {
    const scope = normalizeWorkspaceId(workspaceId);
    const rows = await db
      .select({
        startedAt: standupSessions.startedAt,
        endedAt: standupSessions.endedAt,
        reviewedJson: standupSessions.reviewedJson,
        flaggedJson: standupSessions.flaggedJson,
      })
      .from(standupSessions)
      .where(and(
        eq(standupSessions.workspaceId, scope),
        eq(standupSessions.managerAccountId, managerAccountId),
        eq(standupSessions.date, date),
      ))
      .orderBy(desc(standupSessions.endedAt), desc(standupSessions.id));
    const latest = rows[0];
    if (!latest) return undefined;
    const reviewed = new Set<string>();
    const flagged = new Set<string>();
    for (const row of rows) {
      for (const id of parseIds(row.reviewedJson)) reviewed.add(id);
      for (const id of parseIds(row.flaggedJson)) flagged.add(id);
    }
    return {
      startedAt: latest.startedAt,
      endedAt: latest.endedAt,
      reviewed: [...reviewed],
      flagged: [...flagged],
      sessionCount: rows.length,
    };
  }

  /** Developer-authored check-ins created after `since`, active developers only. */
  async listDeveloperCheckInsSince(since: string, workspaceId?: string): Promise<CheckInSince[]> {
    const scope = normalizeWorkspaceId(workspaceId);
    const rows = await db
      .select({
        developerAccountId: teamTrackerDays.developerAccountId,
        displayName: developers.displayName,
        createdAt: teamTrackerCheckIns.createdAt,
      })
      .from(teamTrackerCheckIns)
      .innerJoin(teamTrackerDays, eq(teamTrackerDays.id, teamTrackerCheckIns.dayId))
      .innerJoin(developers, and(
        eq(developers.workspaceId, teamTrackerDays.workspaceId),
        eq(developers.accountId, teamTrackerDays.developerAccountId),
      ))
      .where(and(
        eq(teamTrackerCheckIns.workspaceId, scope),
        eq(teamTrackerCheckIns.authorType, "developer"),
        gte(teamTrackerCheckIns.createdAt, since),
        eq(developers.isActive, 1),
      ));
    const sinceMs = Date.parse(since);
    return rows.filter((row) => Date.parse(row.createdAt) > sinceMs);
  }

  /** Issues that moved to done after `since` (Jira `updated`; compared as instants). */
  async countIssuesResolvedSince(since: string, workspaceId?: string): Promise<number> {
    const scope = normalizeWorkspaceId(workspaceId);
    const sinceMs = Date.parse(since);
    // Prefilter by day prefix a day early (a "-0800" local date can trail the
    // UTC day); the exact instant compare happens in JS.
    const rows = await db
      .select({ updatedAt: issues.updatedAt })
      .from(issues)
      .where(and(
        eq(issues.workspaceId, scope),
        eq(issues.statusCategory, "done"),
        eq(issues.excluded, 0),
        gte(issues.updatedAt, addDaysToIsoDay(since.slice(0, 10), -1)),
      ));
    return rows.filter((row) => parseInstant(row.updatedAt) > sinceMs).length;
  }

  async listCheckInAsks(managerAccountId: string, date: string, workspaceId?: string): Promise<TodayCheckInAsk[]> {
    const scope = normalizeWorkspaceId(workspaceId);
    const rows = await db
      .select()
      .from(todayCheckInAsks)
      .where(and(
        eq(todayCheckInAsks.workspaceId, scope),
        eq(todayCheckInAsks.managerAccountId, managerAccountId),
        eq(todayCheckInAsks.date, date),
        isNull(todayCheckInAsks.cancelledAt),
      ))
      .orderBy(desc(todayCheckInAsks.askedAt));
    return rows.map(toAsk);
  }

  async findOpenAsk(managerAccountId: string, developerAccountId: string, date: string, workspaceId?: string): Promise<TodayCheckInAsk | undefined> {
    const asks = await this.listCheckInAsks(managerAccountId, date, workspaceId);
    return asks.find((ask) => ask.developerAccountId === developerAccountId);
  }

  async createCheckInAsk(
    input: { managerAccountId: string; developerAccountId: string; date: string; title: string; trackerItemId?: number; taskKey?: string; askedAt?: string },
    workspaceId?: string,
  ): Promise<TodayCheckInAsk> {
    const scope = normalizeWorkspaceId(workspaceId);
    const row = (await db
      .insert(todayCheckInAsks)
      .values({
        workspaceId: scope,
        managerAccountId: input.managerAccountId,
        developerAccountId: input.developerAccountId,
        date: input.date,
        askedAt: input.askedAt ?? new Date().toISOString(),
        title: input.title,
        trackerItemId: input.trackerItemId ?? null,
        taskKey: input.taskKey ?? null,
      })
      .returning())[0]!;
    return toAsk(row);
  }

  async getCheckInAsk(managerAccountId: string, askId: number, workspaceId?: string): Promise<TodayCheckInAsk & { cancelled: boolean }> {
    const scope = normalizeWorkspaceId(workspaceId);
    const row = (await db
      .select()
      .from(todayCheckInAsks)
      .where(and(
        eq(todayCheckInAsks.workspaceId, scope),
        eq(todayCheckInAsks.managerAccountId, managerAccountId),
        eq(todayCheckInAsks.id, askId),
      ))
      .limit(1))[0];
    if (!row) throw new HttpError(404, "Check-in request not found");
    return { ...toAsk(row), cancelled: row.cancelledAt !== null };
  }

  async cancelCheckInAsk(managerAccountId: string, askId: number, workspaceId?: string): Promise<void> {
    const scope = normalizeWorkspaceId(workspaceId);
    await db
      .update(todayCheckInAsks)
      .set({ cancelledAt: new Date().toISOString() })
      .where(and(
        eq(todayCheckInAsks.workspaceId, scope),
        eq(todayCheckInAsks.managerAccountId, managerAccountId),
        eq(todayCheckInAsks.id, askId),
        isNull(todayCheckInAsks.cancelledAt),
      ));
  }
}

function toAsk(row: typeof todayCheckInAsks.$inferSelect): TodayCheckInAsk {
  return {
    id: row.id,
    developerAccountId: row.developerAccountId,
    date: row.date,
    askedAt: row.askedAt,
    title: row.title,
    ...(row.trackerItemId !== null ? { trackerItemId: row.trackerItemId } : {}),
    ...(row.taskKey ? { taskKey: row.taskKey } : {}),
  };
}

function parseIds(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

/** Jira timestamps may carry "+0000" offsets; normalise to "+00:00" before parsing. */
export function parseInstant(value: string | undefined | null): number {
  if (!value) return NaN;
  const direct = Date.parse(value);
  if (!Number.isNaN(direct)) return direct;
  return Date.parse(value.replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
}
