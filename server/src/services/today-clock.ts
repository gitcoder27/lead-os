import {
  DEFAULT_TODAY_RHYTHM_BOUNDARIES,
  type TodayRhythmBoundaries,
  type TodayRhythmStage,
  type TodayRhythmState,
} from "shared/types";

/**
 * docs/53 F5: Today computes stage and day boundaries in the manager's IANA
 * zone (sent by the client as `tz`), never the server clock or UTC slicing.
 */

const partsFormatters = new Map<string, Intl.DateTimeFormat>();

export function serverTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

export function isValidTimeZone(value: string | undefined): value is string {
  if (!value || value.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** A valid IANA zone, else the server zone (old clients that send no `tz`). */
export function resolveTimeZone(value?: string): string {
  return isValidTimeZone(value) ? value : serverTimeZone();
}

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = partsFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    partsFormatters.set(timeZone, formatter);
  }
  return formatter;
}

export interface ZonedParts {
  isoDay: string;
  hour: number;
  minute: number;
  second: number;
}

export function zonedParts(instant: Date, timeZone: string): ZonedParts {
  const parts: Record<string, string> = {};
  for (const part of formatterFor(timeZone).formatToParts(instant)) {
    parts[part.type] = part.value;
  }
  return {
    isoDay: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

/** Offset (ms) of `timeZone` from UTC at `instant`. */
function zoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = zonedParts(instant, timeZone);
  const [year, month, day] = parts.isoDay.split("-").map(Number) as [number, number, number];
  const asUtc = Date.UTC(year, month - 1, day, parts.hour, parts.minute, parts.second);
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/**
 * The UTC instant of a local wall-clock time in `timeZone`. DST gaps resolve
 * forward (02:30 on a spring-forward day → 03:30), overlaps to the earlier.
 */
export function zonedTimeToUtc(isoDay: string, hour: number, minute: number, timeZone: string): Date {
  const [year, month, day] = isoDay.split("-").map(Number) as [number, number, number];
  const wallAsUtc = Date.UTC(year, month - 1, day, hour, minute, 0);
  let guess = wallAsUtc - zoneOffsetMs(new Date(wallAsUtc), timeZone);
  // Second pass settles the offset when the first guess crossed a transition.
  guess = wallAsUtc - zoneOffsetMs(new Date(guess), timeZone);
  return new Date(guess);
}

export function addDaysToIsoDay(isoDay: string, days: number): string {
  const [year, month, day] = isoDay.split("-").map(Number) as [number, number, number];
  const next = new Date(Date.UTC(year, month - 1, day + days));
  return next.toISOString().slice(0, 10);
}

/**
 * The manager-local calendar day of a value. Date-only strings (`YYYY-MM-DD`,
 * e.g. Jira due dates) are already days; timestamps convert through the zone.
 */
export function toZonedIsoDay(value: string | undefined | null, timeZone: string): string | undefined {
  if (!value) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const time = Date.parse(value);
  if (Number.isNaN(time)) return value.slice(0, 10);
  return zonedParts(new Date(time), timeZone).isoDay;
}

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function parseClockTime(value: string): { hour: number; minute: number } | undefined {
  const match = TIME_PATTERN.exec(value);
  if (!match) return undefined;
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

function clockMinutes(value: string): number {
  const parsed = parseClockTime(value);
  return parsed ? parsed.hour * 60 + parsed.minute : NaN;
}

/** Boundaries must be valid HH:MM and strictly increasing. */
export function validateRhythmBoundaries(boundaries: TodayRhythmBoundaries): string | undefined {
  const values = [boundaries.standupStart, boundaries.middayStart, boundaries.wrapUpStart].map(clockMinutes);
  if (values.some((value) => Number.isNaN(value))) return "Stage boundaries must be HH:MM (24h)";
  if (!(values[0]! < values[1]! && values[1]! < values[2]!)) {
    return "Stage boundaries must be in order: standup < midday < wrap-up";
  }
  return undefined;
}

export function normalizeRhythmBoundaries(value: unknown): TodayRhythmBoundaries {
  if (value && typeof value === "object") {
    const candidate = { ...DEFAULT_TODAY_RHYTHM_BOUNDARIES, ...(value as Partial<TodayRhythmBoundaries>) };
    if (!validateRhythmBoundaries(candidate)) {
      return {
        standupStart: candidate.standupStart,
        middayStart: candidate.middayStart,
        wrapUpStart: candidate.wrapUpStart,
      };
    }
  }
  return { ...DEFAULT_TODAY_RHYTHM_BOUNDARIES };
}

const stageCopy: Record<TodayRhythmStage, { label: string; detail: string }> = {
  morning_plan: { label: "Morning plan", detail: "Set direction" },
  standup_window: { label: "Standup window", detail: "Clear blockers" },
  midday_check: { label: "Midday check", detail: "Keep flow moving" },
  wrap_up: { label: "Wrap-up", detail: "Close loops" },
};

export function getRhythmState(
  now: Date,
  timeZone: string,
  boundaries: TodayRhythmBoundaries = DEFAULT_TODAY_RHYTHM_BOUNDARIES,
): TodayRhythmState {
  const local = zonedParts(now, timeZone);
  const minutes = local.hour * 60 + local.minute;
  const edges: Array<{ stage: TodayRhythmStage; at: string }> = [
    { stage: "standup_window", at: boundaries.standupStart },
    { stage: "midday_check", at: boundaries.middayStart },
    { stage: "wrap_up", at: boundaries.wrapUpStart },
  ];
  let stage: TodayRhythmStage = "morning_plan";
  let next: (typeof edges)[number] | undefined = edges[0];
  for (const [index, edge] of edges.entries()) {
    if (minutes >= clockMinutes(edge.at)) {
      stage = edge.stage;
      next = edges[index + 1];
    }
  }
  const nextTime = next ? parseClockTime(next.at) : undefined;
  return {
    stage,
    ...stageCopy[stage],
    timeZone,
    localTime: `${String(local.hour).padStart(2, "0")}:${String(local.minute).padStart(2, "0")}`,
    boundaries,
    ...(next && nextTime
      ? { nextStage: { stage: next.stage, startsAt: zonedTimeToUtc(local.isoDay, nextTime.hour, nextTime.minute, timeZone).toISOString() } }
      : {}),
  };
}
