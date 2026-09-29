import { describe, expect, it } from "vitest";
import {
  hasWorkingHoursElapsed,
  isWeekendIsoDay,
  startOfLocalDay,
  weekdayWindow,
  workingHoursBetween,
  workingMsBetween,
  workingWindowFromRules,
  type WorkingWindow,
} from "../src/services/working-hours";

// docs/56 P1-05. 2026-03-06 is a Friday, 2026-03-07/08 a weekend, 2026-03-09 a Monday.
const utc: WorkingWindow = { timeZone: "UTC", startMinutes: 9 * 60, endMinutes: 18 * 60 };

describe("workingHoursBetween", () => {
  it("counts only the part of a weekday inside the window", () => {
    expect(workingHoursBetween("2026-03-09T07:00:00Z", "2026-03-09T08:30:00Z", utc)).toBe(0);
    expect(workingHoursBetween("2026-03-09T07:00:00Z", "2026-03-09T10:30:00Z", utc)).toBe(1.5);
    expect(workingHoursBetween("2026-03-09T10:00:00Z", "2026-03-09T20:00:00Z", utc)).toBe(8);
  });

  it("skips nights and weekends", () => {
    // Fri 16:00 → Mon 10:00 = Fri 16–18 + Mon 09–10.
    expect(workingHoursBetween("2026-03-06T16:00:00Z", "2026-03-09T10:00:00Z", utc)).toBe(3);
    expect(workingHoursBetween("2026-03-07T10:00:00Z", "2026-03-08T20:00:00Z", utc)).toBe(0);
    // A full Mon–Fri week.
    expect(workingHoursBetween("2026-03-09T00:00:00Z", "2026-03-16T00:00:00Z", utc)).toBe(45);
  });

  it("is zero for empty, reversed or invalid spans", () => {
    expect(workingMsBetween("2026-03-09T12:00:00Z", "2026-03-09T12:00:00Z", utc)).toBe(0);
    expect(workingMsBetween("2026-03-09T12:00:00Z", "2026-03-09T10:00:00Z", utc)).toBe(0);
    expect(workingMsBetween("not a date", "2026-03-09T10:00:00Z", utc)).toBe(0);
  });

  it("measures the window in the configured zone, not the server's", () => {
    const kolkata: WorkingWindow = { timeZone: "Asia/Kolkata", startMinutes: 9 * 60, endMinutes: 18 * 60 };
    // 03:30Z–06:30Z = 09:00–12:00 in Kolkata.
    expect(workingHoursBetween("2026-03-09T03:30:00Z", "2026-03-09T06:30:00Z", kolkata)).toBe(3);
    // 18:30Z Sunday = 00:00 Monday in Kolkata; 03:30Z = 09:00.
    expect(workingHoursBetween("2026-03-08T12:00:00Z", "2026-03-09T03:30:00Z", kolkata)).toBe(0);
  });

  it("does not drift across a DST weekend", () => {
    // US DST starts Sunday 2026-03-08: Fri 12:00 EST (17:00Z) → Mon 12:00 EDT (16:00Z).
    const ny: WorkingWindow = { timeZone: "America/New_York", startMinutes: 9 * 60, endMinutes: 18 * 60 };
    expect(workingHoursBetween("2026-03-06T17:00:00Z", "2026-03-09T16:00:00Z", ny)).toBe(9);
    expect(workingHoursBetween("2026-03-06T17:00:00Z", "2026-03-09T16:00:00Z", weekdayWindow("America/New_York"))).toBe(24);
  });

  it("stops early at the cap", () => {
    const capped = workingMsBetween("2026-01-05T00:00:00Z", "2026-03-09T00:00:00Z", utc, 2 * 3_600_000);
    expect(capped).toBeGreaterThanOrEqual(2 * 3_600_000);
    expect(capped).toBeLessThan(10 * 3_600_000);
  });
});

describe("hasWorkingHoursElapsed", () => {
  it("never fires before day start or across a weekend alone", () => {
    expect(hasWorkingHoursElapsed("2026-03-09T00:00:00Z", "2026-03-09T08:30:00Z", 1, utc)).toBe(false);
    expect(hasWorkingHoursElapsed("2026-03-06T17:00:00Z", "2026-03-09T08:30:00Z", 4, utc)).toBe(false);
    expect(hasWorkingHoursElapsed("2026-03-06T17:00:00Z", "2026-03-09T12:00:00Z", 4, utc)).toBe(true);
  });

  it("agrees with the full count on long spans (fast path)", () => {
    expect(hasWorkingHoursElapsed("2025-12-01T00:00:00Z", "2026-03-09T12:00:00Z", 100, utc)).toBe(true);
    expect(hasWorkingHoursElapsed("2026-03-09T11:00:00Z", "2026-03-09T12:00:00Z", 2, utc)).toBe(false);
    expect(hasWorkingHoursElapsed("bad", "2026-03-09T12:00:00Z", 1, utc)).toBe(false);
  });

  it("counts whole weekdays for Jira staleness", () => {
    const jira = weekdayWindow("UTC");
    // Thu 08:00 → Sun 08:30 = 40 weekday hours; Wed 08:00 → Sun = 64.
    expect(hasWorkingHoursElapsed("2026-03-05T08:00:00Z", "2026-03-08T08:30:00Z", 48, jira)).toBe(false);
    expect(hasWorkingHoursElapsed("2026-03-04T08:00:00Z", "2026-03-08T08:30:00Z", 48, jira)).toBe(true);
  });
});

describe("helpers", () => {
  it("builds the window from the rules, falling back on a bad day", () => {
    expect(workingWindowFromRules({ dayStart: "08:30", dayEnd: "17:00", timeZone: "UTC" })).toEqual({ timeZone: "UTC", startMinutes: 510, endMinutes: 1020 });
    expect(workingWindowFromRules({ dayStart: "18:00", dayEnd: "09:00", timeZone: "UTC" })).toEqual({ timeZone: "UTC", startMinutes: 540, endMinutes: 1080 });
    expect(workingWindowFromRules({ dayStart: "nope", dayEnd: "17:00", timeZone: "UTC" }).startMinutes).toBe(540);
  });

  it("finds local midnight and weekends", () => {
    expect(startOfLocalDay(new Date("2026-03-09T02:00:00Z"), "Asia/Kolkata").toISOString()).toBe("2026-03-08T18:30:00.000Z");
    expect(isWeekendIsoDay("2026-03-07")).toBe(true);
    expect(isWeekendIsoDay("2026-03-09")).toBe(false);
  });
});

describe("memoized day boundaries", () => {
  it("keep zones apart and give the same answer on a repeat scan", () => {
    const kolkata: WorkingWindow = { timeZone: "Asia/Kolkata", startMinutes: 9 * 60, endMinutes: 18 * 60 };
    const from = "2026-03-06T16:00:00Z";
    const to = "2026-03-09T10:00:00Z";
    const utcFirst = workingHoursBetween(from, to, utc);
    const kolkataFirst = workingHoursBetween(from, to, kolkata);
    expect(utcFirst).toBe(3);
    expect(kolkataFirst).not.toBe(utcFirst);
    expect(workingHoursBetween(from, to, utc)).toBe(utcFirst);
    expect(workingHoursBetween(from, to, kolkata)).toBe(kolkataFirst);
    // A weekday-only window (Jira) across the weekend and the US DST change:
    // Fri 07:00 EST → midnight (17h) + Mon (24h) + Tue to 08:00 EDT (8h).
    expect(workingHoursBetween("2026-03-06T12:00:00Z", "2026-03-10T12:00:00Z", weekdayWindow("America/New_York"))).toBe(49);
  });
});
