import { describe, expect, it, vi } from "vitest";
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


describe("date formatter cache", () => {
  it("shares one formatter per zone across timestamp, today and week helpers", async () => {
    vi.resetModules();
    const Original = Intl.DateTimeFormat;
    const constructor = vi.spyOn(Intl, "DateTimeFormat").mockImplementation(function (locales, options) {
      return new Original(locales, options);
    });
    try {
      const dates = await import("../src/utils/date");
      const now = new Date("2026-03-08T09:30:00Z");
      for (let i = 0; i < 10; i++) {
        expect(dates.isoDatePart(now.toISOString(), "America/Los_Angeles")).toBe("2026-03-08");
        dates.todayIsoDate(now, "America/Los_Angeles");
        dates.endOfWeekIsoDate(now, "America/Los_Angeles");
        dates.isoDatePart(now.toISOString(), "Asia/Tokyo");
        dates.todayIsoDate(now);
      }
      // LA, Tokyo, default server zone and UTC (used by week shifting).
      expect(constructor).toHaveBeenCalledTimes(4);
      expect(dates.isoDatePart("2026-03-08", "invalid-zone")).toBe("2026-03-08");
      expect(dates.isoDatePart("invalid-timestamp", "invalid-zone")).toBe("invalid-ti");
      expect(() => dates.todayIsoDate(now, "invalid-zone")).toThrow(RangeError);
      expect(() => dates.todayIsoDate(now, "invalid-zone")).toThrow(RangeError);
    } finally {
      constructor.mockRestore();
    }
  });
});
