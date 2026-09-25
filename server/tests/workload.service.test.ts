vi.mock("../src/services/task-keys.service", () => ({ TaskKeysService: class { async canonicalEnabled() { return false; } } }));
import { describe, expect, it, vi } from "vitest";
import { WorkloadService } from "../src/services/workload.service";

const devRows = [
  { accountId: "dev-1", displayName: "Alice", email: null, avatarUrl: null, isActive: 1 },
  { accountId: "dev-2", displayName: "Bob", email: null, avatarUrl: null, isActive: 1 },
  { accountId: "dev-3", displayName: "Carol", email: null, avatarUrl: null, isActive: 1 },
  { accountId: "dev-4", displayName: "Dan", email: null, avatarUrl: null, isActive: 1 },
  { accountId: "dev-5", displayName: "Eve", email: null, avatarUrl: null, isActive: 1 },
];

const issueRows = [
  { assigneeId: "dev-1", statusCategory: "indeterminate", priorityName: "Highest", dueDate: "2099-01-01", developmentDueDate: null, flagged: 0, excluded: 0, teamScopeState: "in_team", syncScopeState: "active" },
  { assigneeId: "dev-1", statusCategory: "indeterminate", priorityName: "High", dueDate: null, developmentDueDate: null, flagged: 1, excluded: 0, teamScopeState: "in_team", syncScopeState: "active" },
  { assigneeId: "dev-2", statusCategory: "new", priorityName: "Medium", dueDate: null, developmentDueDate: null, flagged: 0, excluded: 0, teamScopeState: "in_team", syncScopeState: "active" },
  { assigneeId: "dev-2", statusCategory: "done", priorityName: "Low", dueDate: null, developmentDueDate: null, flagged: 0, excluded: 0, teamScopeState: "in_team", syncScopeState: "active" },
  { assigneeId: "dev-3", statusCategory: "indeterminate", priorityName: "High", dueDate: null, developmentDueDate: null, flagged: 0, excluded: 1, teamScopeState: "in_team", syncScopeState: "active" },
  { assigneeId: "dev-4", statusCategory: "indeterminate", priorityName: "Medium", dueDate: null, developmentDueDate: null, flagged: 0, excluded: 0, teamScopeState: "in_team", syncScopeState: "active" },
] as any[];

const trackerDayRows = [
  { id: 1, date: "2026-03-09", developerAccountId: "dev-1", status: "on_track", capacityUnits: 3, lastCheckInAt: "2026-03-09T08:00:00.000Z" },
  { id: 2, date: "2026-03-09", developerAccountId: "dev-2", status: "blocked", capacityUnits: 1, lastCheckInAt: "2026-03-09T08:00:00.000Z" },
  { id: 3, date: "2026-03-09", developerAccountId: "dev-3", status: "waiting", capacityUnits: 2, lastCheckInAt: "2026-03-09T08:00:00.000Z" },
  { id: 5, date: "2026-03-09", developerAccountId: "dev-5", status: "done_for_today", capacityUnits: 2, lastCheckInAt: "2026-03-09T08:00:00.000Z" },
] as any[];

const trackerItemRows = [
  { id: 101, dayId: 1, state: "in_progress" },
  { id: 102, dayId: 1, state: "planned" },
  { id: 103, dayId: 1, state: "done" },
  { id: 201, dayId: 2, state: "planned" },
  { id: 202, dayId: 2, state: "planned" },
  { id: 301, dayId: 3, state: "planned" },
] as any[];

function conditionContainsValue(condition: any, expected: string, seen = new Set<object>()): boolean {
  if (condition === expected) {
    return true;
  }
  if (!condition || typeof condition !== "object") {
    return false;
  }
  if (seen.has(condition)) {
    return false;
  }
  seen.add(condition);
  if ("value" in condition && condition.value === expected) {
    return true;
  }
  return Object.values(condition).some((value) => conditionContainsValue(value, expected, seen));
}

vi.mock("../src/db/connection", () => ({
  db: {
    select: () => ({
      from: (table: any) => {
        if (table?.accountId) {
          return { where: async () => devRows };
        }
        if (table?.developerAccountId) {
          return { where: async () => trackerDayRows };
        }
        if (table?.itemType) {
          return { where: async () => trackerItemRows };
        }
        return {
          where: async (condition: any) =>
            conditionContainsValue(condition, "dev-3")
              ? issueRows.filter((issue) => issue.assigneeId === "dev-3")
              : issueRows,
        };
      },
    }),
  },
}));

describe("WorkloadService", () => {
  const service = new WorkloadService();

  it("calculates score and threshold levels", async () => {
    expect(service.calculateScore(["Highest", "High", "Medium"])).toBe(9);
    expect(service.getLevel(4.9)).toBe("light");
    expect(service.getLevel(5)).toBe("medium");
    expect(service.getLevel(12)).toBe("heavy");
  });

  it("identifies idle developers from computed team list", () => {
    const team = [
      {
        developer: { accountId: "dev-1", displayName: "Alice", isActive: true },
        activeDefects: 1,
        dueToday: 0,
        blocked: 0,
        score: 3,
        level: "light" as const,
        signals: { idle: false, noCurrentItem: false, backlogTrackerMismatch: false },
      },
      {
        developer: { accountId: "dev-2", displayName: "Bob", isActive: true },
        activeDefects: 0,
        dueToday: 0,
        blocked: 0,
        score: 0,
        level: "light" as const,
        signals: { idle: true, noCurrentItem: false, backlogTrackerMismatch: false },
      },
    ];
    const idle = team.filter((entry) => entry.signals?.idle === true).map((entry) => entry.developer.accountId);
    expect(idle).toEqual(["dev-2"]);
  });

  it("computes workload from developer and issue datasets", async () => {
    const service = new WorkloadService();
    const team = await service.getTeamWorkload("2026-03-09");

    expect(team).toHaveLength(5);
    expect(team.find((entry) => entry.developer.accountId === "dev-1")?.score).toBe(8);
    expect(team.find((entry) => entry.developer.accountId === "dev-2")?.activeDefects).toBe(1);
    expect(team.find((entry) => entry.developer.accountId === "dev-3")?.activeDefects).toBe(0);
    expect(team.find((entry) => entry.developer.accountId === "dev-1")?.assignedTodayCount).toBe(2);
    expect(team.find((entry) => entry.developer.accountId === "dev-1")).not.toHaveProperty("capacityUnits");
    expect(team.find((entry) => entry.developer.accountId === "dev-2")?.signals).not.toHaveProperty("overCapacity");
    expect(team.find((entry) => entry.developer.accountId === "dev-3")?.signals?.idle).toBe(false);
    expect(team.find((entry) => entry.developer.accountId === "dev-4")?.signals?.idle).toBe(true);
    expect(team.find((entry) => entry.developer.accountId === "dev-5")?.signals?.idle).toBe(false);
    expect(team.find((entry) => entry.developer.accountId === "dev-4")?.signals?.backlogTrackerMismatch).toBe(true);
  });

  it("returns idle developers and ranked suggestions using service methods", async () => {
    const service = new WorkloadService();
    const idle = await service.getIdleDevelopers("2026-03-09");
    expect(idle.map((d) => d.accountId)).toContain("dev-4");
    expect(idle.map((d) => d.accountId)).not.toContain("dev-3");
    expect(idle.map((d) => d.accountId)).not.toContain("dev-5");

    const ranked = await service.suggestAssignee();
    expect(ranked[0]?.developer.accountId).toBe("dev-4");
    expect(ranked[1]?.developer.accountId).toBe("dev-3");
    expect(ranked.some((entry) => entry.developer.accountId === "dev-5" && entry.reason.includes("marked done for today"))).toBe(true);
    expect(ranked.at(-1)?.developer.accountId).toBe("dev-2");
    expect(ranked[0]?.reason).toContain("planned today");
    expect(ranked[0]?.reason).toContain("backlog score");
    expect(ranked[0]?.reason).toContain("active Jira issue");
    expect(ranked[0]?.workload.developer.accountId).toBe("dev-4");
  });

  it("ignores excluded issues in workload and developer issue queries", async () => {
    const service = new WorkloadService();
    const team = await service.getTeamWorkload();
    const dev3 = team.find((entry) => entry.developer.accountId === "dev-3");

    expect(dev3?.activeDefects).toBe(0);
    expect(await service.getDeveloperIssues("dev-3")).toHaveLength(0);
  });
});
