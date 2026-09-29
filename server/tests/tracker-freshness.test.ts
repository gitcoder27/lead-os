import { describe, expect, it } from "vitest";
import {
  buildSignals,
  getFreshnessClock,
  workingDaysBetween,
  type TrackerSignalConfig,
} from "../src/services/tracker-freshness";

// 2026-03-02 is a Monday; 2026-03-07/08 are Saturday/Sunday.
const collab: TrackerSignalConfig = {
  staleThresholdHours: 4,
  noCurrentThresholdHours: 2,
  statusFollowUpThresholdHours: 2,
  teamMode: "collab",
  touchStaleWorkingDays: 5,
  soloNoCurrentEnabled: false,
};
const solo: TrackerSignalConfig = { ...collab, teamMode: "solo" };

function signals(overrides: Partial<Parameters<typeof buildSignals>[0]> = {}) {
  return buildSignals({
    date: "2026-03-09",
    status: "on_track",
    updatedAt: "2026-03-09T08:00:00.000Z",
    plannedItems: [],
    config: collab,
    now: new Date("2026-03-09T12:00:00.000Z"),
    ...overrides,
  });
}

/** A local wall-clock timestamp, so the local calendar date is known in any TZ. */
function local(year: number, month: number, day: number, hour = 12): string {
  return new Date(year, month - 1, day, hour).toISOString();
}

describe("getFreshnessClock", () => {
  it("uses the check-in clock only for collab + participating", () => {
    expect(getFreshnessClock("collab", true)).toBe("check_in");
    expect(getFreshnessClock("collab", false)).toBe("manager_touch");
    expect(getFreshnessClock("collab", undefined)).toBe("manager_touch");
    expect(getFreshnessClock("solo", true)).toBe("manager_touch");
    expect(getFreshnessClock("solo", false)).toBe("manager_touch");
  });
});

describe("workingDaysBetween", () => {
  it("counts weekdays after `from` up to and including `to`", () => {
    expect(workingDaysBetween("2026-03-02", "2026-03-02")).toBe(0);
    expect(workingDaysBetween("2026-03-02", "2026-03-03")).toBe(1);
    expect(workingDaysBetween("2026-03-02", "2026-03-06")).toBe(4);
    expect(workingDaysBetween("2026-03-02", "2026-03-09")).toBe(5);
    expect(workingDaysBetween("2026-03-02", "2026-03-16")).toBe(10);
  });

  it("skips weekends", () => {
    // Friday -> Monday is one working day; Fri -> Sat/Sun is zero.
    expect(workingDaysBetween("2026-03-06", "2026-03-09")).toBe(1);
    expect(workingDaysBetween("2026-03-06", "2026-03-07")).toBe(0);
    expect(workingDaysBetween("2026-03-06", "2026-03-08")).toBe(0);
    // A weekend touch starts counting on Monday.
    expect(workingDaysBetween("2026-03-07", "2026-03-09")).toBe(1);
    expect(workingDaysBetween("2026-03-08", "2026-03-13")).toBe(5);
    // Longer spans with a weekend remainder.
    expect(workingDaysBetween("2026-03-04", "2026-03-15")).toBe(7);
  });

  it("returns 0 for reversed or invalid input", () => {
    expect(workingDaysBetween("2026-03-09", "2026-03-02")).toBe(0);
    expect(workingDaysBetween("nope", "2026-03-02")).toBe(0);
  });
});

describe("buildSignals — collab, participating developer (check-in clock)", () => {
  const base = { config: collab, participates: true };

  it("is stale without a developer check-in even if a manager checked in", () => {
    const result = signals({
      ...base,
      lastCheckInAt: "2026-03-09T11:30:00.000Z",
      freshness: { lastDeveloperCheckInAt: null },
    });
    expect(result.freshness.clock).toBe("check_in");
    expect(result.freshness.staleByTime).toBe(true);
    expect(result.freshness.hoursSinceCheckIn).toBeUndefined();
    expect(result.freshness.staleWithoutCurrentWork).toBe(true);
    expect(result.freshness.untouched).toBeUndefined();
  });

  it("keeps the hour thresholds for developer check-ins", () => {
    const fresh = signals({ ...base, freshness: { lastDeveloperCheckInAt: "2026-03-09T09:00:00.000Z" } });
    expect(fresh.freshness.hoursSinceCheckIn).toBe(3);
    expect(fresh.freshness.staleByTime).toBe(false);
    expect(fresh.freshness.staleWithoutCurrentWork).toBe(true);

    const stale = signals({ ...base, status: "blocked", statusUpdatedAt: "2026-03-09T11:00:00.000Z", freshness: { lastDeveloperCheckInAt: "2026-03-09T08:00:00.000Z" } });
    expect(stale.freshness.staleByTime).toBe(true);
    expect(stale.freshness.staleWithOpenRisk).toBe(true);
  });

  it("treats any check-in after a status change as the follow-up", () => {
    const flagged = signals({ ...base, status: "blocked", statusUpdatedAt: "2026-03-09T09:00:00.000Z", statusUpdatedBy: "manager", lastCheckInAt: "2026-03-09T08:00:00.000Z" });
    expect(flagged.freshness.statusChangeWithoutFollowUp).toBe(true);

    const followed = signals({ ...base, status: "blocked", statusUpdatedAt: "2026-03-09T09:00:00.000Z", lastCheckInAt: "2026-03-09T09:30:00.000Z" });
    expect(followed.freshness.statusChangeWithoutFollowUp).toBe(false);

    const tooSoon = signals({ ...base, status: "blocked", statusUpdatedAt: "2026-03-09T11:00:00.000Z" });
    expect(tooSoon.freshness.statusChangeWithoutFollowUp).toBe(false);
  });

  it("falls back to updatedAt for legacy rows without statusUpdatedAt", () => {
    const result = signals({ ...base, status: "at_risk", updatedAt: "2026-03-09T08:00:00.000Z" });
    expect(result.freshness.hoursSinceStatusChange).toBe(4);
    expect(result.freshness.statusChangeWithoutFollowUp).toBe(true);
  });

  it("does not flag missing current work when done for today", () => {
    const result = signals({ ...base, status: "done_for_today" });
    expect(result.freshness.staleWithoutCurrentWork).toBe(false);
  });
});

describe("buildSignals — solo (manager-touch clock)", () => {
  const base = { config: solo, participates: false };

  it("never raises check-in staleness", () => {
    const result = signals({ ...base, status: "blocked", freshness: { lastManagerTouchAt: local(2026, 3, 9, 9) } });
    expect(result.freshness.clock).toBe("manager_touch");
    expect(result.freshness.staleByTime).toBe(false);
    expect(result.freshness.staleWithOpenRisk).toBe(false);
    expect(result.freshness.untouched).toBe(false);
    expect(result.freshness.workingDaysSinceTouch).toBe(0);
    expect(result.freshness.touchStaleWorkingDays).toBe(5);
  });

  it("flags only after N working days untouched", () => {
    const four = signals({ ...base, date: "2026-03-06", freshness: { lastManagerTouchAt: local(2026, 3, 2) } });
    expect(four.freshness.workingDaysSinceTouch).toBe(4);
    expect(four.freshness.untouched).toBe(false);

    // Mon -> next Mon crosses a weekend: exactly 5 working days.
    const five = signals({ ...base, date: "2026-03-09", freshness: { lastManagerTouchAt: local(2026, 3, 2) } });
    expect(five.freshness.workingDaysSinceTouch).toBe(5);
    expect(five.freshness.untouched).toBe(true);

    const custom = signals({ ...base, config: { ...solo, touchStaleWorkingDays: 1 }, date: "2026-03-09", freshness: { lastManagerTouchAt: local(2026, 3, 6) } });
    expect(custom.freshness.untouched).toBe(true);
  });

  it("does not count weekends toward the threshold", () => {
    // Touched Tuesday; the following Sunday is only 3 working days on.
    const sunday = signals({ ...base, date: "2026-03-08", freshness: { lastManagerTouchAt: local(2026, 3, 3) } });
    expect(sunday.freshness.workingDaysSinceTouch).toBe(3);
    expect(sunday.freshness.untouched).toBe(false);
  });

  it("uses the local calendar date of the touch", () => {
    // 23:30 local on Friday is Friday, whatever the UTC date is.
    const result = signals({ ...base, date: "2026-03-13", freshness: { lastManagerTouchAt: local(2026, 3, 6, 23) } });
    expect(result.freshness.workingDaysSinceTouch).toBe(5);
    expect(result.freshness.untouched).toBe(true);
  });

  it("measures from trackingSince when never touched, and stays quiet without either", () => {
    const tracked = signals({ ...base, freshness: { trackingSince: local(2026, 3, 2) } });
    expect(tracked.freshness.lastManagerTouchAt).toBeUndefined();
    expect(tracked.freshness.untouched).toBe(true);

    const none = signals({ ...base, freshness: {} });
    expect(none.freshness.workingDaysSinceTouch).toBeUndefined();
    expect(none.freshness.untouched).toBe(false);
  });

  it("keeps no_current off by default and honours the opt-in", () => {
    const off = signals({ ...base, freshness: {} });
    expect(off.freshness.staleWithoutCurrentWork).toBe(false);

    const on = signals({ ...base, config: { ...solo, soloNoCurrentEnabled: true }, freshness: { lastManagerTouchAt: "2026-03-09T11:00:00.000Z" } });
    expect(on.freshness.staleWithoutCurrentWork).toBe(false);
    const onStale = signals({ ...base, config: { ...solo, soloNoCurrentEnabled: true }, freshness: { lastManagerTouchAt: "2026-03-09T08:00:00.000Z" } });
    expect(onStale.freshness.staleWithoutCurrentWork).toBe(true);
  });

  it("skips the status follow-up for a manager-authored or unattributed change", () => {
    const manager = signals({ ...base, status: "blocked", statusUpdatedAt: "2026-03-09T08:00:00.000Z", statusUpdatedBy: "manager" });
    expect(manager.freshness.statusChangeWithoutFollowUp).toBe(false);
    const legacy = signals({ ...base, status: "blocked", statusUpdatedAt: "2026-03-09T08:00:00.000Z", statusUpdatedBy: null });
    expect(legacy.freshness.statusChangeWithoutFollowUp).toBe(false);
  });

  it("still flags a developer-authored change until the manager touches them", () => {
    // Solo workspace, but the developer has a login and set blocked from My Day.
    const params = { ...base, participates: true, status: "blocked" as const, statusUpdatedAt: "2026-03-09T08:00:00.000Z", statusUpdatedBy: "developer" };
    expect(signals(params).freshness.statusChangeWithoutFollowUp).toBe(true);
    expect(signals({ ...params, freshness: { lastManagerTouchAt: "2026-03-09T09:00:00.000Z" } }).freshness.statusChangeWithoutFollowUp).toBe(false);
    expect(signals({ ...params, lastCheckInAt: "2026-03-09T09:00:00.000Z" }).freshness.statusChangeWithoutFollowUp).toBe(false);
  });
});

describe("buildSignals — collab, non-participating developer (manager-touch clock)", () => {
  const base = { config: collab, participates: false };

  it("uses the manager-touch clock and ignores check-in staleness", () => {
    const result = signals({ ...base, freshness: { lastManagerTouchAt: local(2026, 3, 2) } });
    expect(result.freshness.clock).toBe("manager_touch");
    expect(result.freshness.staleByTime).toBe(false);
    expect(result.freshness.untouched).toBe(true);
  });

  it("keeps no_current on in collab, on the touch clock", () => {
    const stale = signals({ ...base, freshness: { lastManagerTouchAt: "2026-03-09T08:00:00.000Z" } });
    expect(stale.freshness.staleWithoutCurrentWork).toBe(true);
    const fresh = signals({ ...base, freshness: { lastManagerTouchAt: "2026-03-09T11:00:00.000Z" } });
    expect(fresh.freshness.staleWithoutCurrentWork).toBe(false);
  });

  it("skips the status follow-up for the manager's own change", () => {
    const result = signals({ ...base, status: "waiting", statusUpdatedAt: "2026-03-09T08:00:00.000Z", statusUpdatedBy: "manager" });
    expect(result.freshness.statusChangeWithoutFollowUp).toBe(false);
  });
});
