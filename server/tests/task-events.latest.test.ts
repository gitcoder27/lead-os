import { beforeEach, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db, resetDatabase } from "./helpers/db";
import { rawDb } from "../src/db/connection";
import { configTable, taskEvents, tasks } from "../src/db/schema";
import { TaskEventsService } from "../src/services/task-events.service";
const service = new TaskEventsService();
beforeEach(async () => {
  await resetDatabase();
  await db.insert(configTable).values([
    { key: "tasks_phase1_enabled", value: "true" },
    { key: "tasks_phase2_stage", value: "2c" },
    { key: "tasks_phase3_enabled", value: "true" },
  ]).onConflictDoUpdate({ target: [configTable.workspaceId, configTable.key], set: { value: "true" } });
  await db.update(configTable).set({ value: "2c" }).where(eq(configTable.key, "tasks_phase2_stage"));
  await db.insert(tasks).values({ taskKey: "T-1", title: "Task", ownerType: "developer", ownerId: "d1", createdAt: "2026-10-06", updatedAt: "2026-10-06" });
  const task = (await db.select().from(tasks))[0]!;
  await db.insert(taskEvents).values(Array.from({ length: 1000 }, (_, i) => ({
    taskId: task.id, taskKey: "old-alias", type: "update", body: `History ${i} ${'x'.repeat(4000)}`, metaJson: '{"approximateTime":true}', visibility: "shared", authorType: "developer", authorId: "d1", occurredAt: "2026-10-05T00:00:00Z", createdAt: "2026-10-05",
  })));
  await db.insert(taskEvents).values([
    { taskId: task.id, taskKey: "old-alias", type: "update", body: '😀'.repeat(170), visibility: "shared", authorType: "manager", authorId: "m2", occurredAt: "2026-10-06T00:00:00Z", createdAt: "2026-10-06" },
    { taskId: task.id, taskKey: "old-alias", type: "update", body: "Hidden", visibility: "private", authorType: "manager", authorId: "m1", redactedAt: "2026-10-06", metaJson: '{"approximateTime":true}', occurredAt: "2026-10-06T00:00:00Z", createdAt: "2026-10-06" },
  ]);
});
it("selects one summary using time/ID ordering and viewer visibility without loading bodies", async () => {
  const all = vi.spyOn(db, "all");
  const own = (await service.latestForKeys(["T-1"], { kind: "manager", accountId: "m1" })).get("T-1")!;
  expect(own).toMatchObject({ excerpt: "[redacted]", approximateTime: true, visibility: "private" });
  expect(all.mock.results.at(-1)!.value).toHaveLength(1);
  expect(own).not.toHaveProperty("body"); expect(own).not.toHaveProperty("metaJson");
  const other = (await service.latestForKeys(["T-1"], { kind: "manager", accountId: "m2" })).get("T-1")!;
  expect(other.id).toBe(own.id - 1);
  expect(other.excerpt).toBe('😀'.repeat(80));
  expect((await service.latestForKeys(["T-1"], { kind: "developer", accountId: "d1" })).get("T-1")!.id).toBe(other.id);
  expect(await service.latestForKeys(["T-1"], { kind: "developer", accountId: "d2" })).toEqual(new Map());
  await db.update(tasks).set({ ownerId: "d2" });
  expect((await service.latestForKeys(["T-1"], { kind: "developer", accountId: "d1" })).get("T-1")!.excerpt).toContain('History 999');
  all.mockRestore();
});
it("uses the existing event index for bounded latest lookups", () => {
  const plan = rawDb.prepare("EXPLAIN QUERY PLAN SELECT id FROM task_events WHERE task_id = ? ORDER BY occurred_at DESC, id DESC LIMIT 1").all(1);
  expect(JSON.stringify(plan)).toContain("idx_task_events_task_time");
});
it("preserves legacy key lookup and disabled behavior", async () => {
  await db.update(configTable).set({ value: "" }).where(eq(configTable.key, "tasks_phase2_stage"));
  expect((await service.latestForKeys(["old-alias"], { kind: "manager", accountId: "m2" })).size).toBe(1);
  await db.update(configTable).set({ value: "false" }).where(and(eq(configTable.key, "tasks_phase1_enabled"), eq(configTable.workspaceId, "default")));
  expect(await service.latestForKeys(["old-alias"], { kind: "manager", accountId: "m2" })).toEqual(new Map());
});
