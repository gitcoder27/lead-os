import type {
  TeamMode,
  TrackerDeveloperSignals,
  TrackerDeveloperStatus,
  TrackerFreshnessClock,
  TrackerWorkItem,
} from "shared/types";
import { isoDatePart } from "../utils/date";
import { hasWorkingHoursElapsed, startOfLocalDay, type WorkingWindow } from "./working-hours";

export interface TrackerSignalConfig {
  staleThresholdHours: number;
  noCurrentThresholdHours: number;
  statusFollowUpThresholdHours: number;
  /** docs/56 P1-02 */
  teamMode: TeamMode;
  touchStaleWorkingDays: number;
  soloNoCurrentEnabled: boolean;
  /** docs/56 P1-05: hour thresholds count working time in this window. */
  window: WorkingWindow;
}

/**
 * docs/56 P1-02: per-developer timestamps the day row cannot carry.
 * `lastDeveloperCheckInAt` is recomputed from developer-authored check-in rows
 * on the effective day row (the row's `lastCheckInAt` stays "any author").
 * The touch fields are only loaded for developers on the manager-touch clock.
 */
export interface TrackerFreshnessInputs {
  lastDeveloperCheckInAt?: string | null;
  lastManagerTouchAt?: string | null;
  /** First tracker day row for the developer: the baseline when never touched. */
  trackingSince?: string | null;
}

/** Effective rule (docs/56 Decisions #1): `collab && participates` keeps the check-in clock. */
export function getFreshnessClock(teamMode: TeamMode, participates: boolean | undefined): TrackerFreshnessClock {
  return teamMode === "collab" && participates ? "check_in" : "manager_touch";
}

function calendarDayMs(date: string): number {
  // Calendar arithmetic on YYYY-MM-DD strings, timezone-independent.
  return Date.parse(`${date}T12:00:00Z`);
}

/** Mon–Fri days `d` with `from < d <= to` (local calendar dates). */
export function workingDaysBetween(from: string, to: string): number {
  const start = calendarDayMs(from);
  const end = calendarDayMs(to);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return 0;
  }
  const days = Math.round((end - start) / 86_400_000);
  const startDow = new Date(start).getUTCDay();
  let count = Math.floor(days / 7) * 5;
  for (let offset = 1; offset <= days % 7; offset += 1) {
    const dow = (startDow + offset) % 7;
    if (dow !== 0 && dow !== 6) count += 1;
  }
  return count;
}

function getHoursSince(value: string | null | undefined, now = new Date()): number | undefined {
  if (!value) {
    return undefined;
  }

  const diff = now.getTime() - new Date(value).getTime();
  return Math.max(0, Math.round((diff / (60 * 60 * 1000)) * 10) / 10);
}

function hasOpenRiskStatus(status: TrackerDeveloperStatus): boolean {
  return status === "blocked" || status === "at_risk" || status === "waiting";
}

function isAtOrAfter(value: string | null | undefined, reference: string): boolean {
  return Boolean(value && new Date(value).getTime() >= new Date(reference).getTime());
}

export function buildSignals(params: {
  date: string;
  status: TrackerDeveloperStatus;
  /** Day-row value: last check-in by anyone. */
  lastCheckInAt?: string | null;
  statusUpdatedAt?: string | null;
  statusUpdatedBy?: string | null;
  updatedAt: string;
  currentItem?: TrackerWorkItem;
  plannedItems: TrackerWorkItem[];
  config: TrackerSignalConfig;
  participates?: boolean;
  freshness?: TrackerFreshnessInputs;
  now?: Date;
}): TrackerDeveloperSignals {
  const now = params.now ?? new Date();
  const clock = getFreshnessClock(params.config.teamMode, params.participates);
  const effectiveStatusUpdatedAt =
    params.statusUpdatedAt ??
    (params.status !== "on_track" ? params.updatedAt : null);
  const hoursSinceStatusChange = getHoursSince(effectiveStatusUpdatedAt, now);
  const noCurrentWork =
    !params.currentItem && params.status !== "done_for_today";
  const openRisk = hasOpenRiskStatus(params.status);
  const overdueLinkedCount = [params.currentItem, ...params.plannedItems].filter(
    (item): item is TrackerWorkItem =>
      Boolean(item?.jiraDueDate && item.jiraDueDate < params.date)
  ).length;
  const window = params.config.window;
  // docs/56 P1-05: hour rules count working time, so nights, weekends and the
  // hours before day start never age anything. With no timestamp at all the
  // clock starts at today's local midnight: nobody is stale at 8:30.
  const workingHoursSince = (value: string | null | undefined, hours: number) =>
    hasWorkingHoursElapsed(value ?? startOfLocalDay(now, window.timeZone), now, hours, window);
  const statusFollowUpDue = Boolean(
    effectiveStatusUpdatedAt &&
      openRisk &&
      workingHoursSince(effectiveStatusUpdatedAt, params.config.statusFollowUpThresholdHours)
  );
  const thresholds = {
    staleThresholdHours: params.config.staleThresholdHours,
    noCurrentThresholdHours: params.config.noCurrentThresholdHours,
    statusFollowUpThresholdHours: params.config.statusFollowUpThresholdHours,
  };
  const risk = {
    openRisk,
    overdueLinkedWork: overdueLinkedCount > 0,
    overdueLinkedCount,
  };

  if (clock === "check_in") {
    // Only the developer's own check-ins reset their staleness; a manager
    // check-in is a manager touch, not a developer update (P0-V2).
    const lastDeveloperCheckInAt = params.freshness?.lastDeveloperCheckInAt ?? null;
    const hoursSinceCheckIn = getHoursSince(lastDeveloperCheckInAt, now);
    const staleByTime = workingHoursSince(lastDeveloperCheckInAt, params.config.staleThresholdHours);
    const staleWithoutCurrentWork =
      noCurrentWork && workingHoursSince(lastDeveloperCheckInAt, params.config.noCurrentThresholdHours);
    // Any check-in after the change (the manager's included) is a follow-up.
    const statusChangeWithoutFollowUp =
      statusFollowUpDue && !isAtOrAfter(params.lastCheckInAt, effectiveStatusUpdatedAt!);

    return {
      freshness: {
        ...thresholds,
        hoursSinceCheckIn,
        hoursSinceStatusChange,
        staleByTime,
        staleWithOpenRisk: staleByTime && openRisk,
        staleWithoutCurrentWork,
        statusChangeWithoutFollowUp,
        clock,
        noCurrentTracked: true,
      },
      risk,
    };
  }

  const lastManagerTouchAt = params.freshness?.lastManagerTouchAt ?? undefined;
  const baseline = lastManagerTouchAt ?? params.freshness?.trackingSince ?? undefined;
  // `params.date` is a tracker day: keyed in the server's local zone, like every
  // other tracker date. The baseline must land on the same calendar or the day
  // count is off by one whenever the Attention-rules zone differs from the
  // server's (that zone only shapes the working-hours window).
  const baselineDate = isoDatePart(baseline);
  const workingDaysSinceTouch = baselineDate
    ? workingDaysBetween(baselineDate, params.date)
    : undefined;
  const untouched =
    workingDaysSinceTouch !== undefined &&
    workingDaysSinceTouch >= params.config.touchStaleWorkingDays;
  const noCurrentEnabled =
    params.config.teamMode === "collab" || params.config.soloNoCurrentEnabled;
  // The time-based "stale without current work" reason is a check-in judgement,
  // so it stays on the check-in clock. Touch-clock people who are tracked for
  // no-current work get the plain `no_current` reason (`noCurrentTracked`).
  const staleWithoutCurrentWork = false;
  // The manager's own status change needs no follow-up from the manager.
  const developerAuthoredChange = params.statusUpdatedBy === "developer";
  const statusChangeWithoutFollowUp =
    developerAuthoredChange &&
    statusFollowUpDue &&
    !isAtOrAfter(params.lastCheckInAt, effectiveStatusUpdatedAt!) &&
    !isAtOrAfter(lastManagerTouchAt, effectiveStatusUpdatedAt!);

  return {
    freshness: {
      ...thresholds,
      hoursSinceCheckIn: getHoursSince(params.lastCheckInAt, now),
      hoursSinceStatusChange,
      staleByTime: false,
      staleWithOpenRisk: false,
      staleWithoutCurrentWork,
      statusChangeWithoutFollowUp,
      clock,
      lastManagerTouchAt,
      workingDaysSinceTouch,
      touchStaleWorkingDays: params.config.touchStaleWorkingDays,
      untouched,
      noCurrentTracked: noCurrentEnabled,
    },
    risk,
  };
}

/**
 * docs/56 P1-03: developer-participation flows (asks, "quiet since standup",
 * "no check-in today", stale counts) apply only on the check-in clock. A
 * missing clock (pre-P1-02 payloads) keeps the old behaviour.
 */
export function usesCheckIns(signals: TrackerDeveloperSignals | undefined): boolean {
  return signals?.freshness.clock !== "manager_touch";
}

/** docs/56 P1-03: "no current work" counts and reasons; absent = tracked. */
export function tracksNoCurrent(signals: TrackerDeveloperSignals | undefined): boolean {
  return signals?.freshness.noCurrentTracked !== false;
}
