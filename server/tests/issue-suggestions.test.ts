import { beforeEach, expect, it } from "vitest";
import { db, resetDatabase } from "./helpers/db";
import { configTable, issues } from "../src/db/schema";
import { IssueService } from "../src/services/issue.service";
const service = new IssueService();
beforeEach(async () => {
  await resetDatabase();
  await db.insert(issues).values(Array.from({ length: 20 }, (_, i) => ({
    jiraKey: `APP-${i}`, summary: `Éclair 100%_${i}`, priorityName: i < 2 ? "High" : "Medium", priorityId: "1", statusName: "Open", statusCategory: i === 0 ? "done" : "new",
    excluded: i === 1 ? 1 : 0, syncScopeState: i === 2 ? "out_of_scope" : "active", teamScopeState: i === 3 ? "out_of_team" : "in_team",
    snoozedUntil: i === 4 ? "2999-01-01T00:00:00Z" : null,
    createdAt: "2026-10-06", updatedAt: "2026-10-06", syncedAt: "2026-10-06", description: "huge description", analysisNotes: "private notes",
  })));
});
it("returns eight visible issues with exactly five fields and literal Unicode search", async () => {
  const result = await service.suggestions("éCLAIR 100%_", "default");
  expect(result).toHaveLength(8);
  expect(result.every((row) => Number(row.jiraKey.slice(4)) >= 5)).toBe(true);
  expect(Object.keys(result[0]!)).toEqual(["jiraKey", "summary", "priorityName", "dueDate", "developmentDueDate"]);
  expect(await service.suggestions("missing", "default")).toEqual([]);
  expect(await service.suggestions("", "another-workspace")).toEqual([]);
});
it("base_query includes active out-of-team issues", async () => {
  await db.insert(configTable).values({ key: "jira_sync_scope_mode", value: "base_query" });
  expect((await service.suggestions("100%_3", "default"))[0]!.jiraKey).toBe("APP-3");
});
