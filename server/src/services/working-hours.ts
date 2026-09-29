import type { AttentionRules } from "shared/types";
import { addDaysToIsoDay, parseClockTime, zonedParts, zonedTimeToUtc } from "./today-clock";

/**
 * docs/56 P1-05: working-time math for the Attention rules. Working time is
 * Mon–Fri, between `startMinutes` and `endMinutes` of the local day in
 * `timeZone`. All day boundaries go through the zone helpers, so DST days are
 * as long as they really are and the server clock's zone never matters.
 */
export interface WorkingWindow {
  timeZone: string;
  /** Minutes after local midnight, inclusive. */
  startMinutes: number;
  /** Minutes after local midnight, exclusive; 1440 = end of day. */
  endMinutes: number;
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;
/** Safety bound; the fast paths in `hasWorkingHoursElapsed` settle longer spans. */
const MAX_SCAN_DAYS = 400;

function clockToMinutes(value: string, fallback: number): number {
  const parsed = parseClockTime(value);
  return parsed ? parsed.hour * 60 + parsed.minute : fallback;
}

/** The tracker's window: the configured working day. */
export function workingWindowFromRules(rules: Pick<AttentionRules, "dayStart" | "dayEnd" | "timeZone">): WorkingWindow {
  const startMinutes = clockToMinutes(rules.dayStart, 9 * 60);
  const endMinutes = clockToMinutes(rules.dayEnd, 18 * 60);
  return endMinutes > startMinutes
    ? { timeZone: rules.timeZone, startMinutes, endMinutes }
    : { timeZone: rules.timeZone, startMinutes: 9 * 60, endMinutes: 18 * 60 };
}

/** Jira staleness: whole weekdays count, weekends do not. */
export function weekdayWindow(timeZone: string): WorkingWindow {
  return { timeZone, startMinutes: 0, endMinutes: 24 * 60 };
}

export function isWeekendIsoDay(isoDay: string): boolean {
  const dow = new Date(`${isoDay}T12:00:00Z`).getUTCDay();
  return dow === 0 || dow === 6;
}

function localInstant(isoDay: string, minutes: number, timeZone: string): number {
  if (minutes >= 24 * 60) {
    return zonedTimeToUtc(addDaysToIsoDay(isoDay, 1), 0, 0, timeZone).getTime();
  }
  return zonedTimeToUtc(isoDay, Math.floor(minutes / 60), minutes % 60, timeZone).getTime();
}

/** Local midnight (in the window's zone) of the day `instant` falls on. */
export function startOfLocalDay(instant: Date, timeZone: string): Date {
  return zonedTimeToUtc(zonedParts(instant, timeZone).isoDay, 0, 0, timeZone);
}

function toTime(value: Date | string | number): number {
  if (typeof value === "number") return value;
  return value instanceof Date ? value.getTime() : Date.parse(value);
}

/**
 * Working milliseconds in `[from, to)`. With `capMs`, stops scanning once the
 * total reaches it (callers that only compare against a threshold).
 */
export function workingMsBetween(from: Date | string | number, to: Date | string | number, window: WorkingWindow, capMs?: number): number {
  const start = toTime(from);
  const end = toTime(to);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return 0;
  }
  let day = zonedParts(new Date(start), window.timeZone).isoDay;
  const lastDay = zonedParts(new Date(end), window.timeZone).isoDay;
  let total = 0;
  for (let scanned = 0; day <= lastDay && scanned < MAX_SCAN_DAYS; scanned += 1, day = addDaysToIsoDay(day, 1)) {
    if (isWeekendIsoDay(day)) continue;
    const windowStart = Math.max(start, localInstant(day, window.startMinutes, window.timeZone));
    const windowEnd = Math.min(end, localInstant(day, window.endMinutes, window.timeZone));
    if (windowEnd > windowStart) {
      total += windowEnd - windowStart;
      if (capMs !== undefined && total >= capMs) return total;
    }
  }
  return total;
}

/** Working hours in `[from, to)`, to one decimal. */
export function workingHoursBetween(from: Date | string, to: Date | string, window: WorkingWindow): number {
  return Math.round((workingMsBetween(from, to, window) / HOUR_MS) * 10) / 10;
}

/**
 * True once at least `hours` of working time have passed since `from`. Cheap
 * for the common cases: fewer wall-clock hours than the threshold can never be
 * enough, and a span long enough to hold the needed full working weeks (plus
 * one for the partial weeks at either end) always is.
 */
export function hasWorkingHoursElapsed(from: Date | string, to: Date | string, hours: number, window: WorkingWindow): boolean {
  const start = toTime(from);
  const end = toTime(to);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
  const thresholdMs = hours * HOUR_MS;
  const elapsed = end - start;
  if (elapsed < thresholdMs) return false;
  const weekMs = 5 * (window.endMinutes - window.startMinutes) * 60 * 1000;
  if (weekMs > 0 && elapsed >= (Math.ceil(thresholdMs / weekMs) + 1) * WEEK_MS + DAY_MS) return true;
  return workingMsBetween(start, end, window, thresholdMs) >= thresholdMs;
}
