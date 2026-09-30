import { and, between, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { WEEKLY_REVIEW_LIMITS, WEEKLY_REVIEW_STEPS } from "shared/types";
import type {
  SaveWeeklyReviewRequest,
  TaskViewDefinition,
  TeamMode,
  WeeklyReviewCheckInRow,
  WeeklyReviewOneOnOneRow,
  WeeklyReviewPastWeek,
  WeeklyReviewPersonRow,
  WeeklyReviewRange,
  WeeklyReviewResponse,
  WeeklyReviewSavedState,
  WeeklyReviewSection,
  WeeklyReviewSourceStatus,
  WeeklyReviewTaskRow,
} from "shared/types";
import { db } from "../db/connection";
import { developers, teamTrackerCheckIns, teamTrackerDays, weeklyReviews } from "../db/schema";
import { HttpError } from "../middleware/errorHandler";
import { logger } from "../utils/logger";
import { todayIsoDate } from "../utils/date";
import { OneOnOneService } from "./one-on-one.service";
import { oneOnOneTaskIds } from "./one-on-one-tasks";
import { getParticipatingDeveloperIds } from "./developer-participation.service";
import { SettingsService } from "./settings.service";
import { TaskEventsService } from "./task-events.service";
import { TaskViewsService } from "./task-views.service";
import type { TaskPrincipal } from "./task.service";
import { addDaysToIsoDay, isValidTimeZone, toZonedIsoDay } from "./today-clock";
import { workingDaysBetween } from "./tracker-freshness";
import { normalizeWorkspaceId } from "./workspace.service";

/** Undated tasks only ask for a decision once they have sat this long. */
const UNDATED_MIN_AGE_DAYS = 14;

export interface WeeklyReviewQuery {
  /** Any day inside the wanted week (snapped to its Monday). */
  week?: string;
  /** The manager's IANA zone; an unknown one falls back to the workspace Attention-rules zone. */
  tz?: string;
  now?: Date;
}

export function isoDayOfWeek(isoDay: string): number {
  return new Date(Date.parse(`${isoDay}T00:00:00Z`)).getUTCDay();
}

/** The Monday of the week that holds `isoDay`. */
export function mondayOf(isoDay: string): string {
  const dow = isoDayOfWeek(isoDay);
  return addDaysToIsoDay(isoDay, dow === 0 ? -6 : 1 - dow);
}

/** The first Mon–Fri day strictly after `isoDay`. */
export function nextWorkdayAfter(isoDay: string): string {
  let next = addDaysToIsoDay(isoDay, 1);
  while (isoDayOfWeek(next) === 0 || isoDayOfWeek(next) === 6) next = addDaysToIsoDay(next, 1);
  return next;
}

export function weekRange(start: string): WeeklyReviewRange {
  return {
    start,
    end: addDaysToIsoDay(start, 6),
    nextStart: addDaysToIsoDay(start, 7),
    nextEnd: addDaysToIsoDay(start, 13),
  };
}

/**
 * docs/59 §4-§5 (WR-01): the read model behind the weekly review. Everything is derived from the
 * canonical task tables through the Tasks views (so membership and privacy rules stay the same as
 * on /tasks); nothing is written here. Dates are the manager's local days, never UTC slices.
 */
export class WeeklyReviewService {
  constructor(
    private readonly views = new TaskViewsService(),
    private readonly events = new TaskEventsService(),
    private readonly settings = new SettingsService(),
    private readonly oneOnOne = new OneOnOneService(),
  ) {}

  async build(principal: TaskPrincipal, query: WeeklyReviewQuery = {}): Promise<WeeklyReviewResponse> {
    const workspaceId = normalizeWorkspaceId(principal.workspaceId);
    const rules = await this.settings.getAttentionRules(workspaceId);
    const timeZone = isValidTimeZone(query.tz) ? query.tz : rules.timeZone;
    const today = todayIsoDate(query.now ?? new Date(), timeZone);

    let start: string;
    let defaultedToLastWeek = false;
    if (query.week) {
      start = mondayOf(query.week);
    } else {
      start = mondayOf(today);
      const dow = isoDayOfWeek(today);
      // Monday and Tuesday: last week is still fresh, and the manager may not have closed it out.
      if ((dow === 1 || dow === 2) && !(await this.lastWeekHandled(principal, addDaysToIsoDay(start, -7)))) {
        start = addDaysToIsoDay(start, -7);
        defaultedToLastWeek = true;
      }
    }
    const range = weekRange(start);

    const [excluded, teamMode, oneOnOneEnabled, roster] = await Promise.all([
      oneOnOneTaskIds(workspaceId),
      this.settings.getTeamMode(workspaceId),
      this.oneOnOne.enabled(workspaceId).catch(() => false),
      this.loadRoster(workspaceId).then((rows) => ({ rows, ok: true }), () => ({ rows: [], ok: false })),
    ]);

    const ctx: SectionContext = { principal, workspaceId, timeZone, today, range, excluded, managerTouchDays: rules.managerTouchDays };
    const [closed, quiet, slipped, inbox, undated, laterNextWeek] = await Promise.all([
      this.closed(ctx),
      this.quiet(ctx),
      this.slipped(ctx),
      this.inbox(ctx),
      this.undated(ctx),
      this.laterNextWeek(ctx),
    ]);
    // Lanes are exclusive, but the Waiting lens also catches blocked and legacy rows: a quiet row is
    // decided once, in step 2.
    const quietIds = new Set(quiet.map((row) => row.id));
    const notQuiet = (rows: WeeklyReviewTaskRow[]) => rows.filter((row) => !quietIds.has(row.id));

    const sections: WeeklyReviewSection[] = [
      { id: "closed", status: "ready", rows: closed },
      { id: "quiet", status: "ready", rows: quiet },
      { id: "slipped", status: "ready", rows: notQuiet(slipped) },
      { id: "inbox", status: "ready", rows: notQuiet(inbox) },
      { id: "undated", status: "ready", rows: notQuiet(undated) },
      { id: "laterNextWeek", status: "ready", rows: laterNextWeek },
      await this.oneOnOnesSection(ctx, oneOnOneEnabled),
      roster.ok ? await this.peopleSection(ctx, roster.rows) : { id: "people", status: "unavailable", rows: [] },
    ];
    if (teamMode === "collab") {
      sections.push(roster.ok ? await this.checkInsSection(ctx, roster.rows) : { id: "checkIns", status: "unavailable", rows: [] });
    }

    return {
      today,
      timeZone,
      range,
      defaultedToLastWeek,
      nextWorkday: nextWorkdayAfter(today),
      teamMode: teamMode as TeamMode,
      rosterSize: roster.rows.length,
      oneOnOneEnabled,
      sections,
      saved: await this.getSaved(principal, range.start),
    };
  }

  /** Last week is handled once it was completed or the manager said "Not this week". */
  private async lastWeekHandled(principal: TaskPrincipal, lastWeekStart: string): Promise<boolean> {
    const row = await this.savedRow(principal, lastWeekStart);
    return Boolean(row?.completedAt || row?.dismissedAt);
  }

  // ── Saved progress (docs/59 §9): private to the manager, one row per week ──

  private async savedRow(principal: TaskPrincipal, weekStart: string) {
    return (
      await db
        .select()
        .from(weeklyReviews)
        .where(and(
          eq(weeklyReviews.workspaceId, normalizeWorkspaceId(principal.workspaceId)),
          eq(weeklyReviews.managerAccountId, principal.accountId),
          eq(weeklyReviews.weekStart, weekStart),
        ))
        .limit(1)
    )[0];
  }

  async getSaved(principal: TaskPrincipal, weekStart: string): Promise<WeeklyReviewSavedState | null> {
    const row = await this.savedRow(principal, weekStart);
    return row ? toSavedState(row) : null;
  }

  /** Upsert this manager's record for `weekStart` (a Monday); only the given fields change. */
  async save(principal: TaskPrincipal, weekStart: string, input: SaveWeeklyReviewRequest): Promise<WeeklyReviewSavedState> {
    if (isoDayOfWeek(weekStart) !== 1) throw new HttpError(400, "weekStart must be a Monday");
    const workspaceId = normalizeWorkspaceId(principal.workspaceId);
    const now = new Date().toISOString();
    const existing = await this.savedRow(principal, weekStart);

    const decisions = existing ? parseDecisions(existing.decisionsJson) : {};
    for (const [key, action] of Object.entries(input.decisions ?? {})) {
      if (action === null) delete decisions[key];
      else decisions[key] = action;
    }
    if (Object.keys(decisions).length > WEEKLY_REVIEW_LIMITS.decisions) throw new HttpError(400, "Too many decisions saved for one week");

    const patch = {
      ...(input.step !== undefined && { step: input.step }),
      decisionsJson: JSON.stringify(decisions),
      ...(input.excluded !== undefined && { excludedJson: JSON.stringify([...new Set(input.excluded)]) }),
      ...(input.reportMarkdown !== undefined && { reportMarkdown: input.reportMarkdown }),
      ...(input.completed !== undefined && { completedAt: input.completed ? (existing?.completedAt ?? now) : null }),
      ...(input.dismissed !== undefined && { dismissedAt: input.dismissed ? (existing?.dismissedAt ?? now) : null }),
      updatedAt: now,
    };
    if (existing) {
      await db.update(weeklyReviews).set(patch).where(eq(weeklyReviews.id, existing.id));
    } else {
      await db.insert(weeklyReviews).values({
        workspaceId,
        managerAccountId: principal.accountId,
        weekStart,
        step: WEEKLY_REVIEW_STEPS[0],
        startedAt: now,
        ...patch,
      });
    }
    return (await this.getSaved(principal, weekStart))!;
  }

  /** Completed weeks, newest first: the "Past updates" list. */
  async listWeeks(principal: TaskPrincipal, limit = 12): Promise<WeeklyReviewPastWeek[]> {
    const rows = await db
      .select()
      .from(weeklyReviews)
      .where(and(
        eq(weeklyReviews.workspaceId, normalizeWorkspaceId(principal.workspaceId)),
        eq(weeklyReviews.managerAccountId, principal.accountId),
        isNotNull(weeklyReviews.completedAt),
      ))
      .orderBy(desc(weeklyReviews.weekStart))
      .limit(limit);
    return rows.map((row) => ({ weekStart: row.weekStart, completedAt: row.completedAt!, reportMarkdown: row.reportMarkdown }));
  }

  // ── Task sections ──

  private async tasks(ctx: SectionContext, definition: TaskViewDefinition): Promise<WeeklyReviewTaskRow[]> {
    const rows = await this.views.run(ctx.principal, definition, ctx.today);
    return rows.filter((row) => !ctx.excluded.has(row.id));
  }

  /** Done and dropped this week (Monday–Sunday in the manager's zone), newest first. */
  private async closed(ctx: SectionContext): Promise<WeeklyReviewTaskRow[]> {
    // The view buckets `closedAt` in the server zone; widen a day each side and cut in the manager's.
    const rows = await this.tasks(ctx, {
      filters: { closed: { from: addDaysToIsoDay(ctx.range.start, -1), to: addDaysToIsoDay(ctx.range.end, 1) } },
      sort: "updated",
    });
    return rows
      .flatMap((row) => {
        const closedDay = toZonedIsoDay(row.closedAt, ctx.timeZone);
        return closedDay && closedDay >= ctx.range.start && closedDay <= ctx.range.end ? [{ ...row, closedDay }] : [];
      })
      .sort((a, b) => (b.closedAt ?? "").localeCompare(a.closedAt ?? "") || a.id - b.id);
  }

  /**
   * The Waiting lens rows that went quiet: the check-by date arrived, or nobody has touched the
   * task for `managerTouchDays` working days (weekends do not count).
   */
  private async quiet(ctx: SectionContext): Promise<WeeklyReviewTaskRow[]> {
    const rows = await this.tasks(ctx, {
      filters: { waiting: true, later: false, status: ["open", "active", "blocked"] },
      sort: "checkBy",
      group: "party",
    });
    const activity = await this.events.latestActivityByTask(rows.map((row) => row.id), ctx.workspaceId);
    return rows.flatMap((row) => {
      const checkBy = toZonedIsoDay(row.followUpAt, ctx.timeZone);
      const lastActivity = toZonedIsoDay(activity.get(row.id) ?? row.updatedAt, ctx.timeZone) ?? ctx.today;
      const idleWorkingDays = workingDaysBetween(lastActivity, ctx.today);
      const checkByPassed = checkBy && checkBy <= ctx.today ? checkBy : null;
      if (!checkByPassed && idleWorkingDays < ctx.managerTouchDays) return [];
      return [{ ...row, quiet: { checkByPassed, idleWorkingDays } }];
    });
  }

  /** My planned tasks whose plan date has passed. */
  private slipped(ctx: SectionContext): Promise<WeeklyReviewTaskRow[]> {
    return this.tasks(ctx, { filters: { owner: "me", lane: "planned", attention: ["overdue"] }, sort: "scheduled" });
  }

  /** The Inbox lane as the Tasks rail defines it: untriaged, unowned, or back from Later. */
  private inbox(ctx: SectionContext): Promise<WeeklyReviewTaskRow[]> {
    return this.tasks(ctx, { filters: { lane: "inbox" }, sort: "created" });
  }

  /** My open tasks with no date that have sat for two weeks or more. */
  private async undated(ctx: SectionContext): Promise<WeeklyReviewTaskRow[]> {
    const cutoff = addDaysToIsoDay(ctx.today, -UNDATED_MIN_AGE_DAYS);
    const rows = await this.tasks(ctx, { filters: { owner: "me", lane: "unscheduled" }, sort: "created" });
    return rows
      .filter((row) => (toZonedIsoDay(row.createdAt, ctx.timeZone) ?? ctx.today) <= cutoff)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id - b.id);
  }

  /** Parked tasks whose resurface date lands in the week after the one under review. */
  private async laterNextWeek(ctx: SectionContext): Promise<WeeklyReviewTaskRow[]> {
    const rows = await this.tasks(ctx, { filters: { later: true }, sort: "created" });
    return rows
      .filter((row) => row.hideUntil && row.hideUntil >= ctx.range.nextStart && row.hideUntil <= ctx.range.nextEnd)
      .sort((a, b) => (a.hideUntil ?? "").localeCompare(b.hideUntil ?? "") || a.id - b.id);
  }

  // ── People sources: a failure marks the section, never the response ──

  private async guarded<Row>(
    id: "oneOnOnes" | "people" | "checkIns",
    workspaceId: string,
    load: () => Promise<Row[]>,
  ): Promise<{ status: WeeklyReviewSourceStatus; rows: Row[] }> {
    try {
      return { status: "ready", rows: await load() };
    } catch (error) {
      logger.warn({ workspaceId, section: id, err: error }, "Weekly review source unavailable");
      return { status: "unavailable", rows: [] };
    }
  }

  private async oneOnOnesSection(ctx: SectionContext, enabled: boolean): Promise<WeeklyReviewSection> {
    const result = await this.guarded<WeeklyReviewOneOnOneRow>("oneOnOnes", ctx.workspaceId, async () =>
      enabled ? this.oneOnOne.reviewSessions({ ...ctx.range, today: ctx.today }, ctx.workspaceId) : [],
    );
    return { id: "oneOnOnes", ...result };
  }

  private async loadRoster(workspaceId: string): Promise<{ accountId: string; displayName: string }[]> {
    return db
      .select({ accountId: developers.accountId, displayName: developers.displayName })
      .from(developers)
      .where(and(eq(developers.workspaceId, workspaceId), eq(developers.isActive, 1)));
  }

  /** People marked blocked or at risk: the latest tracker day this week (up to today) decides. */
  private async peopleSection(ctx: SectionContext, roster: { accountId: string; displayName: string }[]): Promise<WeeklyReviewSection> {
    const result = await this.guarded<WeeklyReviewPersonRow>("people", ctx.workspaceId, async () => {
      if (roster.length === 0) return [];
      const names = new Map(roster.map((person) => [person.accountId, person.displayName]));
      const days = await db
        .select()
        .from(teamTrackerDays)
        .where(and(
          eq(teamTrackerDays.workspaceId, ctx.workspaceId),
          inArray(teamTrackerDays.developerAccountId, [...names.keys()]),
          between(teamTrackerDays.date, ctx.range.start, minDay(ctx.range.end, ctx.today)),
        ))
        .orderBy(desc(teamTrackerDays.date), desc(teamTrackerDays.id));
      const latest = new Map<string, (typeof days)[number]>();
      for (const day of days) if (!latest.has(day.developerAccountId)) latest.set(day.developerAccountId, day);
      const rows: WeeklyReviewPersonRow[] = [];
      for (const day of latest.values()) {
        if (day.status !== "blocked" && day.status !== "at_risk") continue;
        rows.push({
          developerAccountId: day.developerAccountId,
          developerName: names.get(day.developerAccountId) ?? day.developerAccountId,
          status: day.status,
          note: day.managerNotes?.trim() || null,
          statusUpdatedAt: day.statusUpdatedAt,
        });
      }
      return rows.sort((a, b) => a.developerName.localeCompare(b.developerName));
    });
    return { id: "people", ...result };
  }

  /** Collab only: days this week a participating developer checked in. Solo never reads this. */
  private async checkInsSection(ctx: SectionContext, roster: { accountId: string; displayName: string }[]): Promise<WeeklyReviewSection> {
    const result = await this.guarded<WeeklyReviewCheckInRow>("checkIns", ctx.workspaceId, async () => {
      const participating = await getParticipatingDeveloperIds(ctx.workspaceId);
      const people = roster.filter((person) => participating.has(person.accountId));
      if (people.length === 0) return [];
      const upTo = minDay(ctx.range.end, ctx.today);
      const workingDays = workingDaysBetween(addDaysToIsoDay(ctx.range.start, -1), upTo);
      const rows = await db
        .select({ developerAccountId: teamTrackerDays.developerAccountId, date: teamTrackerDays.date })
        .from(teamTrackerCheckIns)
        .innerJoin(teamTrackerDays, eq(teamTrackerDays.id, teamTrackerCheckIns.dayId))
        .where(and(
          eq(teamTrackerCheckIns.workspaceId, ctx.workspaceId),
          eq(teamTrackerCheckIns.authorType, "developer"),
          inArray(teamTrackerDays.developerAccountId, people.map((person) => person.accountId)),
          between(teamTrackerDays.date, ctx.range.start, upTo),
        ));
      const days = new Map<string, Set<string>>();
      for (const row of rows) {
        if (isoDayOfWeek(row.date) === 0 || isoDayOfWeek(row.date) === 6) continue;
        (days.get(row.developerAccountId) ?? days.set(row.developerAccountId, new Set()).get(row.developerAccountId)!).add(row.date);
      }
      return people
        .map((person) => ({
          developerAccountId: person.accountId,
          developerName: person.displayName,
          daysWithCheckIn: days.get(person.accountId)?.size ?? 0,
          workingDays,
        }))
        .sort((a, b) => a.developerName.localeCompare(b.developerName));
    });
    return { id: "checkIns", ...result };
  }
}

interface SectionContext {
  principal: TaskPrincipal;
  workspaceId: string;
  timeZone: string;
  today: string;
  range: WeeklyReviewRange;
  /** Task ids on a 1:1 agenda (docs/59 §4): never part of the review. */
  excluded: Set<number>;
  managerTouchDays: number;
}

type WeeklyReviewRecord = typeof weeklyReviews.$inferSelect;

function parseDecisions(json: string): Record<string, string> {
  try {
    const value = JSON.parse(json) as unknown;
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function parseExcluded(json: string): string[] {
  try {
    const value = JSON.parse(json) as unknown;
    return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
  } catch {
    return [];
  }
}

function toSavedState(row: WeeklyReviewRecord): WeeklyReviewSavedState {
  const step = (WEEKLY_REVIEW_STEPS as readonly string[]).includes(row.step) ? (row.step as WeeklyReviewSavedState["step"]) : WEEKLY_REVIEW_STEPS[0];
  return {
    weekStart: row.weekStart,
    step,
    decisions: parseDecisions(row.decisionsJson),
    excluded: parseExcluded(row.excludedJson),
    reportMarkdown: row.reportMarkdown,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    dismissedAt: row.dismissedAt,
    updatedAt: row.updatedAt,
  };
}

function minDay(a: string, b: string): string {
  return a < b ? a : b;
}
