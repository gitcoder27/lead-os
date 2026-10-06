import { beforeEach, expect, it, vi } from "vitest";
import { db, resetDatabase } from "./helpers/db";
import { tasks } from "../src/db/schema";
import { TaskService } from "../src/services/task.service";
import { TaskViewsService } from "../src/services/task-views.service";

const principal = { type: "manager" as const, accountId: "paging-manager", workspaceId: "default" };
beforeEach(async () => {
  await resetDatabase();
  await db.insert(tasks).values(Array.from({ length: 701 }, (_, index) => ({
    taskKey: `T-${index + 1}`, title: `Synthetic ${index}`, status: "open", ownerType: "manager", ownerId: principal.accountId,
    trackedByManagerId: principal.accountId, scheduledOn: "2026-10-06", dueAt: "2026-10-06T01:00:00Z",
    priority: index < 600 ? "high" : "normal", createdAt: "2026-10-06T01:00:00Z", updatedAt: "2026-10-06T01:00:00Z",
  })));
});

it("bounds enrichment and pages after complete filtering and stable sorting", async () => {
  const taskService = new TaskService();
  const enrichment = vi.spyOn(taskService, "toDtos");
  const service = new TaskViewsService(taskService);
  const definition = { filters: { priority: "high" as const }, sort: "scheduled" as const };
  const first = await service.runPage(principal, definition, {}, "2026-10-06", "UTC");
  expect(first.tasks).toHaveLength(200);
  expect(first.total).toBe(600);
  expect(first.nextOffset).toBe(200);
  expect(enrichment.mock.calls[0]![0]).toHaveLength(200);
  const second = await service.runPage(principal, definition, { offset: 200 }, "2026-10-06", "UTC");
  const third = await service.runPage(principal, definition, { offset: 400 }, "2026-10-06", "UTC");
  expect(third.nextOffset).toBeNull();
  const keys = [...first.tasks, ...second.tasks, ...third.tasks].map((task) => task.taskKey);
  expect(new Set(keys).size).toBe(600);
  expect(keys).toEqual((await service.run(principal, definition, "2026-10-06", "UTC")).map((task) => task.taskKey));
  expect(await service.count(principal, definition, "2026-10-06", "UTC")).toBe(600);
  const counts = await service.counts(principal, "2026-10-06", "UTC");
  expect(counts["high-priority"]!.count).toBe(600);
  expect((await service.runPage(principal, definition, { limit: 500 }, "2026-10-06", "UTC")).tasks).toHaveLength(500);
  expect((await service.runPage(principal, definition, { offset: 600 }, "2026-10-06", "UTC")).tasks).toEqual([]);
  await expect(service.runPage(principal, definition, { limit: 501 })).rejects.toThrow();
});
