import { describe, expect, it } from "vitest";
import { endOfWeekIsoDate, isoDatePart, todayIsoDate } from "../src/utils/date";

describe("date utils", () => {
  it("uses the requested local calendar date instead of UTC when deriving today", () => {
    const now = new Date("2026-03-18T20:30:00.000Z");

    expect(todayIsoDate(now, "Asia/Kolkata")).toBe("2026-03-19");
    expect(todayIsoDate(now, "UTC")).toBe("2026-03-18");
  });

  it("computes the week end using the same local calendar basis", () => {
    const now = new Date("2026-03-18T20:30:00.000Z");

    expect(endOfWeekIsoDate(now, "Asia/Kolkata")).toBe("2026-03-22");
    expect(endOfWeekIsoDate(now, "UTC")).toBe("2026-03-22");
  });

  it("derives the local calendar date from timestamps for isoDatePart", () => {
    expect(isoDatePart("2026-03-18T20:30:00.000Z", "Asia/Kolkata")).toBe("2026-03-19");
    expect(isoDatePart("2026-03-18T20:30:00.000Z", "UTC")).toBe("2026-03-18");
    expect(isoDatePart("2026-03-18")).toBe("2026-03-18");
    expect(isoDatePart(undefined)).toBeUndefined();
    expect(isoDatePart(null)).toBeUndefined();
  });
});
