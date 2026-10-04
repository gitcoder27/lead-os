import { describe, expect, it } from "vitest";
import { AutomationService } from "../src/services/automation.service";

describe("AutomationService", () => {
  const service = new AutomationService({ suggestAssignee: async () => [] } as any);

  it("suggests priority based on labels", () => {
    expect(service.suggestPriority(["production"]).suggested).toBe("Highest");
    expect(service.suggestPriority(["prod-bug"]).suggested).toBe("Highest");
    expect(service.suggestPriority(["customer"]).suggested).toBe("High");
    expect(service.suggestPriority(["client"]).suggested).toBe("High");
    expect(service.suggestPriority(["misc"]).suggested).toBe("Medium");
  });

  it("suggests due date based on priority", () => {
    const createdAt = "2026-03-01T00:00:00.000Z";
    const today = "2026-03-01";
    expect(service.suggestDueDate("Highest", createdAt, today).suggested).toBe("2026-03-02");
    expect(service.suggestDueDate("High", createdAt, today).suggested).toBe("2026-03-04");
    expect(service.suggestDueDate("Medium", createdAt, today).suggested).toBe("2026-03-08");
    expect(service.suggestDueDate("Low", createdAt, today).suggested).toBe("2026-03-15");
    expect(service.suggestDueDate("Lowest", createdAt, today).suggested).toBe("2026-03-15");
  });

  it("never proposes a target date in the past (UX-32)", () => {
    // Created 2026-09-19, Medium → 2026-09-26: already gone by 2026-10-02.
    const late = service.suggestDueDate("Medium", "2026-09-19T08:00:00.000Z", "2026-10-02");
    expect(late.suggested).toBeNull();
    expect(late.reason).toMatch(/already passed/);
    // A target of today is still fair to suggest.
    expect(service.suggestDueDate("Medium", "2026-09-25T08:00:00.000Z", "2026-10-02").suggested).toBe("2026-10-02");
  });

  it("flags the fallback priority so callers never offer it as a change (docs/56 P5-02)", () => {
    expect(service.suggestPriority(["misc"])).toMatchObject({ suggested: "Medium", isDefault: true });
    expect(service.suggestPriority([])).toMatchObject({ isDefault: true });
    expect(service.suggestPriority(["production"]).isDefault).toBeUndefined();
    expect(service.suggestPriority(["Customer"]).isDefault).toBeUndefined();
  });
});
