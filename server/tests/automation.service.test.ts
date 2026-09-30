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
    expect(service.suggestDueDate("Highest", createdAt).suggested).toBe("2026-03-02");
    expect(service.suggestDueDate("High", createdAt).suggested).toBe("2026-03-04");
    expect(service.suggestDueDate("Medium", createdAt).suggested).toBe("2026-03-08");
    expect(service.suggestDueDate("Low", createdAt).suggested).toBe("2026-03-15");
    expect(service.suggestDueDate("Lowest", createdAt).suggested).toBe("2026-03-15");
  });

  it("flags the fallback priority so callers never offer it as a change (docs/56 P5-02)", () => {
    expect(service.suggestPriority(["misc"])).toMatchObject({ suggested: "Medium", isDefault: true });
    expect(service.suggestPriority([])).toMatchObject({ isDefault: true });
    expect(service.suggestPriority(["production"]).isDefault).toBeUndefined();
    expect(service.suggestPriority(["Customer"]).isDefault).toBeUndefined();
  });
});
