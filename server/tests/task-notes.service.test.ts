import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db, resetDatabase } from "./helpers/db";
import { configTable, dailyNoteTaskRefs, developers, issues, managerDeskItems, managerDeskLinks } from "../src/db/schema";
import { DailyNotesService } from "../src/services/daily-notes.service";
import { TaskEventsService } from "../src/services/task-events.service";
import { TeamTrackerService } from "../src/services/team-tracker.service";

const service = new DailyNotesService();
const events = new TaskEventsService();
const date = "2026-09-24";

beforeEach(async () => {
  await resetDatabase();
  await db.insert(configTable).values({ key: "tasks_phase1_enabled", value: "true" });
  await db.insert(developers).values({ accountId: "dev-1", displayName: "One", isActive: 1 });
});

describe("note task references", () => {
  it("preserves Jira links and checks the original complete task request on replay", async () => {
    const now = new Date().toISOString();
    await db.insert(issues).values({ jiraKey: "APP-1", summary: "Issue", priorityName: "Medium", priorityId: "3", statusName: "Open", statusCategory: "new", createdAt: now, updatedAt: now, syncedAt: now });
    await service.save("manager-a", date, { revision: 0, body: "Scratchpad" }, "default");
    await service.save("manager-a", "2026-09-23", { revision: 0, body: "Other note" }, "default");
    const input = { title: "From note", jiraKey: "APP-1", context: "Private context", requestId: randomUUID() };
    const created = await service.createTask("manager-a", date, input, "default");
    expect(await db.select().from(managerDeskLinks)).toEqual([expect.objectContaining({ itemId: created.managerDeskItemId, issueKey: "APP-1" })]);
    await db.update(managerDeskItems).set({ title: "Renamed later" }).where(eq(managerDeskItems.id, created.managerDeskItemId!));
    expect(await service.createTask("manager-a", date, input, "default")).toMatchObject({ taskKey: created.taskKey, title: "Renamed later" });
    for (const changed of [{ context: "Changed" }, { jiraKey: "APP-2" }, { title: "Another" }, { developerAccountId: "dev-1" }]) {
      await expect(service.createTask("manager-a", date, { ...input, ...changed }, "default")).rejects.toMatchObject({ status: 409 });
    }
    await expect(service.createTask("manager-a", "2026-09-23", input, "default")).rejects.toMatchObject({ status: 409 });
    expect(await db.select().from(managerDeskItems)).toHaveLength(1);
    const timeline = await events.list(created.taskKey, { kind: "manager", accountId: "manager-a" });
    expect(timeline.events.filter((event) => event.body === input.context)).toHaveLength(1);
    expect((await events.list(created.taskKey, { kind: "manager", accountId: "manager-b" })).events.some((event) => event.body === input.context)).toBe(false);
  });

  it("records mentions once, keeps them after edits, and hides private excerpts", async () => {
    const item = await new TeamTrackerService().addItem("dev-1", date, { title: "Review" });
    await service.save("manager-a", date, { revision: 0, body: `See ${item.taskKey} for private plans. And t-99999 is unknown.` }, "default");
    await service.save("manager-a", date, { revision: 1, body: `No mention remains` }, "default");
    expect((await db.select().from(dailyNoteTaskRefs)).map((ref) => ref.taskKey)).toEqual([item.taskKey]);
    const own = await events.list(item.taskKey!, { kind: "manager", accountId: "manager-a" });
    expect(own.events[0]).toMatchObject({ type: "note_ref", visibility: "private", meta: { relation: "mentioned" } });
    expect((await events.list(item.taskKey!, { kind: "manager", accountId: "manager-b" })).events).toHaveLength(1);
    expect((await events.list(item.taskKey!, { kind: "developer", accountId: "dev-1" })).events).toHaveLength(1);
  });

  it("dedupes task updates, rejects reused IDs, and links a new task to its source note", async () => {
    const item = await new TeamTrackerService().addItem("dev-1", date, { title: "Review" });
    await service.save("manager-a", date, { revision: 0, body: "Scratchpad" }, "default");
    const requestId = randomUUID();
    const payload = { taskKey: item.taskKey!, text: "Only I can see this", requestId };
    const first = await service.addTaskUpdate("manager-a", date, payload, "default");
    expect(await service.addTaskUpdate("manager-a", date, payload, "default")).toEqual(first);
    await expect(service.addTaskUpdate("manager-a", date, { ...payload, text: "Changed" }, "default")).rejects.toMatchObject({ status: 409 });
    expect((await events.list(item.taskKey!, { kind: "manager", accountId: "manager-a" })).events.map((event) => event.type)).toEqual(["note_ref", "update", "created"]);
    expect((await events.list(item.taskKey!, { kind: "developer", accountId: "dev-1" })).events.map((event) => event.type)).toEqual(["created"]);
    const created = await service.createTask("manager-a", date, { title: "New from note", context: "Private context", requestId: randomUUID() }, "default");
    expect(created.kind).toBe("desk_only");
    expect((await events.list(created.taskKey, { kind: "manager", accountId: "manager-a" })).events.map((event) => event.type)).toEqual(["note_ref", "update", "created"]);
  });
});
