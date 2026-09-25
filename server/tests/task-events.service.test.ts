import { beforeEach, describe, expect, it } from "vitest";
import { db, resetDatabase } from "./helpers/db";
import { configTable, developers } from "../src/db/schema";
import { runInTransaction } from "../src/db/transaction";
import { TaskKeysService } from "../src/services/task-keys.service";
import { TaskEventsService } from "../src/services/task-events.service";
import { TeamTrackerService } from "../src/services/team-tracker.service";
import { ManagerDeskService } from "../src/services/manager-desk.service";

const keys = new TaskKeysService();
const events = new TaskEventsService(keys);

beforeEach(async () => {
  await resetDatabase();
  await db.insert(configTable).values({ key: "tasks_phase1_enabled", value: "true" });
  await db.insert(developers).values([{ accountId: "dev-1", displayName: "One", isActive: 1 }, { accountId: "dev-2", displayName: "Two", isActive: 1 }]);
});

describe("task keys and events", () => {
  it("retains the initiating actor on focus, demotion, deletion, and mirror events", async () => {
    const tracker = new TeamTrackerService();
    const desk = new ManagerDeskService(tracker);
    const manager = { type: "manager" as const, accountId: "manager-a" };
    const developer = { type: "developer" as const, accountId: "dev-1" };
    const first = await tracker.addItem("dev-1", "2026-09-24", { title: "First", actor: manager });
    const second = await tracker.addItem("dev-1", "2026-09-24", { title: "Second", actor: manager });
    await tracker.setCurrentItem(first.id, undefined, "default", manager);
    await tracker.updateItem(second.id, { state: "in_progress" }, "default", developer);
    const firstEvents = (await events.list(first.taskKey!, { kind: "manager", accountId: "manager-a" })).events;
    expect(firstEvents.filter((event) => event.type === "focus").map((event) => event.author.id)).toEqual(["dev-1", "manager-a"]);
    await tracker.carryForward("2026-09-24", "2026-09-25", { itemIds: [first.id], actor: manager });
    expect((await events.list(first.taskKey!, { kind: "manager", accountId: "manager-a" })).events[0]).toMatchObject({ type: "schedule", author: { type: "system", id: "manager-a" } });
    await tracker.deleteItem(second.id, undefined, "default", developer);
    expect((await events.list(second.taskKey!, { kind: "manager", accountId: "manager-a" })).events[0]).toMatchObject({ type: "status", author: { type: "system", id: "dev-1" }, meta: { to: "deleted" } });
    const delegated = await desk.createItem("manager-a", { date: "2026-09-24", title: "Delegated", assigneeDeveloperAccountId: "dev-1", actor: manager });
    await desk.updateItem("manager-a", delegated.id, { assigneeDeveloperAccountId: "dev-2", title: "Renamed" });
    await desk.cancelDelegatedTask("manager-a", delegated.id);
    const mirroredEvents = (await events.list(delegated.taskKey!, { kind: "manager", accountId: "manager-a" })).events;
    expect(mirroredEvents.every((event) => event.author.id === "manager-a")).toBe(true);
    expect(mirroredEvents).toContainEqual(expect.objectContaining({ type: "status", meta: expect.objectContaining({ domain: "tracker_state", to: "dropped" }) }));
  });

  it("lets managers redact their own Copilot updates and note references, but not another actor's events", async () => {
    const key = await runInTransaction(async () => keys.allocate("default"));
    const copilot = await events.append({ taskKey: key, type: "update", body: "Remove this", meta: { via: "copilot" } }, { type: "copilot", accountId: "manager-a" });
    const note = await events.append({ taskKey: key, type: "note_ref", body: null, meta: { noteId: 1, noteDate: "2026-09-24", relation: "mentioned", excerpt: "Private excerpt" } }, { type: "system", accountId: "manager-a" });
    await expect(events.redact(key, copilot.id, "manager-b")).rejects.toMatchObject({ status: 403 });
    const old = await events.append({ taskKey: key, type: "update", body: "Old", meta: { via: "copilot" }, occurredAt: new Date(Date.now() - 31 * 86400000).toISOString() }, { type: "copilot", accountId: "manager-a" });
    await expect(events.redact(key, old.id, "manager-a")).rejects.toMatchObject({ status: 403 });
    for (const event of [copilot, note]) {
      await events.redact(key, event.id, "manager-a");
      const redacted = await events.get(event.id, { kind: "manager", accountId: "manager-a" });
      expect(redacted.redacted).toBe(true);
      expect(redacted).not.toHaveProperty("body");
      expect(redacted).not.toHaveProperty("meta");
    }
  });

  it("allocates monotonically inside transactions and resolves case-insensitive aliases", async () => {
    expect(() => keys.allocate("default")).toThrow("transaction");
    expect(await runInTransaction(async () => keys.allocate("default"))).toBe("T-1");
    expect(await runInTransaction(async () => keys.allocate("default"))).toBe("T-2");
    expect(await keys.resolve("default", " t-02 ")).toBe("T-2");
  });

  it("forces developer visibility and enforces current ownership even with no existing events", async () => {
    const tracker = new TeamTrackerService();
    const item = await tracker.addItem("dev-1", "2026-09-24", { title: "Review" });
    const input = { workspaceId: "default", taskKey: item.taskKey!, type: "update" as const, body: "Progress", meta: { via: "standup" as const }, requestId: "46f6f4eb-21f1-4913-af1f-dd6ffbc15225" };
    const created = await events.append(input, { type: "developer", accountId: "dev-1" });
    expect(created.visibility).toBe("shared");
    expect((await events.list(item.taskKey!, { kind: "developer", accountId: "dev-1" })).events).toHaveLength(2);
    expect(await events.append(input, { type: "developer", accountId: "dev-1" })).toEqual(created);
    await expect(events.append({ ...input, body: "Changed" }, { type: "developer", accountId: "dev-1" })).rejects.toMatchObject({ status: 409 });
    await expect(events.append({ ...input, visibility: "private" }, { type: "developer", accountId: "dev-1" })).rejects.toMatchObject({ status: 400 });
    await expect(events.append({ ...input, type: "instruction" }, { type: "developer", accountId: "dev-1" })).rejects.toMatchObject({ status: 403 });
    await expect(events.list(item.taskKey!, { kind: "developer", accountId: "dev-2" })).rejects.toMatchObject({ status: 404 });
  });

  it("forces private note refs and reminder schedules while preserving public task changes", async () => {
    const item = await new TeamTrackerService().addItem("dev-1", "2026-09-24", { title: "Audit" });
    const taskKey = item.taskKey!;
    const note = await events.append({ taskKey, type: "note_ref", body: null, meta: { noteId: 2, noteDate: "2026-09-24", relation: "mentioned" }, visibility: "shared" }, { type: "system", accountId: "manager-a" });
    const reminder = await events.append({ taskKey, type: "schedule", body: null, meta: { field: "follow_up_at", from: null, to: "2026-09-25T09:00:00Z", via: "edit" }, visibility: "shared" }, { type: "system", accountId: "manager-a" });
    expect(note.visibility).toBe("private");
    expect(reminder.visibility).toBe("private");
    const other = await events.list(taskKey, { kind: "manager", accountId: "manager-b" });
    expect(other.events.map((event) => event.type)).toEqual(["created"]);
    expect((await events.list(taskKey, { kind: "developer", accountId: "dev-1" })).events.map((event) => event.type)).toEqual(["created"]);
    await expect(events.changeVisibility(taskKey, note.id, "manager-a", "shared")).rejects.toMatchObject({ status: 403 });
  });

  it("moves a tracker task in place and revokes the former developer's event access", async () => {
    const tracker = new TeamTrackerService();
    const item = await tracker.addItem("dev-1", "2026-09-24", { title: "Handoff" });
    const requestId = "48509246-5496-44fb-a075-d32e7fa8ac29";
    const moved = await tracker.reassignItem(item.id, "dev-2", "2026-09-25", requestId, "default", "manager-a");
    expect(moved).toMatchObject({ id: item.id, taskKey: item.taskKey });
    expect(await tracker.reassignItem(item.id, "dev-2", "2026-09-25", requestId, "default", "manager-a")).toEqual(moved);
    await expect(tracker.reassignItem(item.id, "dev-1", "2026-09-25", requestId, "default", "manager-a")).rejects.toMatchObject({ status: 409 });
    expect((await events.list(item.taskKey!, { kind: "developer", accountId: "dev-2" })).events.map((event) => event.type)).toEqual(["schedule", "assign", "created"]);
    await expect(events.list(item.taskKey!, { kind: "developer", accountId: "dev-1" })).rejects.toMatchObject({ status: 404 });
  });

  it("resolves deleted keys to a tombstone without reusing the sequence", async () => {
    const tracker = new TeamTrackerService();
    const item = await tracker.addItem("dev-1", "2026-09-24", { title: "Remove me" });
    await tracker.deleteItem(item.id);
    expect(await keys.resolveTask("default", item.taskKey!)).toMatchObject({ taskKey: item.taskKey, title: "Remove me", deleted: true });
    expect((await tracker.addItem("dev-1", "2026-09-24", { title: "New" })).taskKey).not.toBe(item.taskKey);
  });

  it("keeps manager private events author-only and redacts without losing the timeline slot", async () => {
    const key = await runInTransaction(async () => keys.allocate("default"));
    const event = await events.append({ taskKey: key, type: "update", meta: { via: "task_drawer" }, body: "Confidential", visibility: "private" }, { type: "manager", accountId: "manager-a" });
    expect((await events.list(key, { kind: "manager", accountId: "manager-a" })).events).toHaveLength(1);
    expect((await events.list(key, { kind: "manager", accountId: "manager-b" })).events).toHaveLength(0);
    await events.redact(key, event.id, "manager-a");
    const redacted = await events.get(event.id, { kind: "manager", accountId: "manager-a" });
    expect(redacted.redacted).toBe(true);
    expect(redacted).not.toHaveProperty("body");
    expect(redacted).not.toHaveProperty("meta");
    expect(redacted.author).toEqual({ type: "manager" });
  });
});
