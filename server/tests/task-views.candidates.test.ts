import { beforeEach, expect, it, vi } from "vitest";
import { db, resetDatabase } from "./helpers/db";
import { tasks } from "../src/db/schema";
import { TaskEventsService } from "../src/services/task-events.service";
import { TaskViewsService } from "../src/services/task-views.service";

const principal = { type: "manager" as const, accountId: "manager", workspaceId: "default" };
beforeEach(async () => {
  await resetDatabase();
  await db.insert(tasks).values([
    { taskKey: "T-1", title: "Open", closedAt: null, status: "open" },
    { taskKey: "T-2", title: "Boundary", closedAt: "2026-09-29T00:00:00Z", status: "done" },
    { taskKey: "T-3", title: "Too old", closedAt: "2026-09-28T23:59:59Z", status: "done" },
    { taskKey: "T-4", title: "Future", closedAt: "2026-10-07T00:00:00Z", status: "done" },
  ].map((row) => ({ ...row, ownerType: "manager", ownerId: "manager", trackedByManagerId: "manager", createdAt: "2026-09-01", updatedAt: "2026-09-01" })));
});

it.each([{ jiraDrift: true }, { attention: ["drift" as const] }])("bounds drift candidates before history hydration: %j", async (filters) => {
  const activity = vi.spyOn(TaskEventsService.prototype, "latestActivityByTask");
  await new TaskViewsService().run(principal, { filters }, "2026-10-06", "Pacific/Honolulu");
  const rows = await db.select({ id: tasks.id, taskKey: tasks.taskKey }).from(tasks);
  const keys = new Map(rows.map((row) => [row.id, row.taskKey]));
  expect(activity.mock.calls[0]![0].map((id) => keys.get(id))).toEqual(["T-1", "T-2", "T-4"]);
  activity.mockRestore();
});

it("retains explicit historical closed and withClosed ranges", async () => {
  const service = new TaskViewsService();
  const closed = { from: "2026-09-01", to: "2026-09-28" };
  expect((await service.run(principal, { filters: { closed } }, "2026-10-06", "UTC")).map((row) => row.taskKey)).toEqual(["T-3"]);
  expect((await service.run(principal, { filters: { withClosed: closed } }, "2026-10-06", "UTC")).map((row) => row.taskKey)).toEqual(["T-1", "T-3"]);
});
