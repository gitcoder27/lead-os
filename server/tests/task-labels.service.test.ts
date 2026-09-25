import { beforeEach, describe, expect, it } from "vitest";
import { db, resetDatabase } from "./helpers/db";
import { configTable, developers, taskLabels, tasks } from "../src/db/schema";
import { and, eq } from "drizzle-orm";
import { TaskService } from "../src/services/task.service";
import { TaskEventsService } from "../src/services/task-events.service";
import { TaskKeysService } from "../src/services/task-keys.service";
import { TaskLabelsService } from "../src/services/task-labels.service";

const service = new TaskService();
const labels = new TaskLabelsService();
const events = new TaskEventsService();
const keys = new TaskKeysService();
const manager = { type: "manager" as const, accountId: "manager-a", workspaceId: "default" };
const developer = { type: "developer" as const, accountId: "dev-1", workspaceId: "default" };

async function enablePhase3() {
  await db.insert(configTable).values([
    { key: "tasks_phase1_enabled", value: "true" },
    { key: "tasks_phase2_stage", value: "2c" },
    { key: "tasks_phase3_enabled", value: "true" },
  ]);
}

beforeEach(async () => {
  await resetDatabase();
  await enablePhase3();
  await db.insert(developers).values([{ accountId: "dev-1", displayName: "One", isActive: 1 }]);
});

describe("phase 3 flag gating", () => {
  it("reports disabled below stage 2c even when the flag is on", async () => {
    await db.update(configTable).set({ value: "2b" }).where(eq(configTable.key, "tasks_phase2_stage"));
    expect(await keys.phase3Enabled("default")).toBe(false);
    await expect(labels.list("default")).rejects.toMatchObject({ status: 404 });
    await expect(keys.setPhase3Enabled("default", true)).rejects.toMatchObject({ status: 409 });
  });

  it("reports disabled at 2c without the flag", async () => {
    await db.delete(configTable).where(eq(configTable.key, "tasks_phase3_enabled"));
    expect(await keys.phase3Enabled("default")).toBe(false);
    await keys.setPhase3Enabled("default", true);
    expect(await keys.phase3Enabled("default")).toBe(true);
    await keys.setPhase3Enabled("default", false);
    expect(await keys.phase3Enabled("default")).toBe(false);
  });
});

describe("task label registry", () => {
  it("seeds the registry idempotently from tasks.labels_json plus system labels", async () => {
    await service.create({ title: "Follow up", labels: ["category:follow_up", "qa-review"] }, manager);
    await service.create({ title: "Other", labels: ["qa-review", "local"] }, manager);
    expect(await labels.seedFromTasks("default")).toBe(3);
    const first = await labels.list("default");
    expect(first.map((l) => l.name).sort()).toEqual(["category:follow_up", "kind:decision", "kind:waiting", "local", "qa-review"]);
    expect(first.find((l) => l.name === "category:follow_up")?.system).toBe(true);
    expect(first.find((l) => l.name === "qa-review")?.system).toBe(false);
    // Re-running does not duplicate or fail.
    await labels.seedFromTasks("default");
    expect((await labels.list("default")).length).toBe(first.length);
  });

  it("auto-registers labels assigned through task create/update", async () => {
    const row = await service.create({ title: "Labeled", labels: ["fresh"] }, manager);
    await service.update(row.taskKey, { labels: ["fresh", "added-later"] }, manager);
    const names = (await labels.list("default")).map((l) => l.name);
    expect(names).toContain("fresh");
    expect(names).toContain("added-later");
  });

  it("creates, recolors and deletes non-system labels", async () => {
    const created = await labels.create("default", { name: " Sprint-42 ", color: "teal" });
    expect(created).toMatchObject({ name: "sprint-42", color: "teal", system: false });
    await expect(labels.create("default", { name: "sprint-42" })).rejects.toMatchObject({ status: 409 });
    const recolored = await labels.update("default", "sprint-42", { color: "pink" });
    expect(recolored.color).toBe("pink");
    await labels.remove("default", "sprint-42");
    expect((await db.select().from(taskLabels)).length).toBe(0);
    await expect(labels.create("default", { name: "bad name!" })).rejects.toMatchObject({ status: 400 });
    await expect(labels.create("default", { name: "ok", color: "chartreuse" })).rejects.toMatchObject({ status: 400 });
  });

  it("renames a label across every task in one pass and emits private events", async () => {
    const a = await service.create({ title: "A", labels: ["old", "other"] }, manager);
    const b = await service.create({ title: "B", labels: ["old"] }, manager);
    // "old" was auto-registered by the task creates — no explicit create needed.
    await labels.update("default", "old", { name: "new" }, manager.accountId);
    const rows = await db.select().from(tasks);
    for (const row of rows) {
      const parsed = JSON.parse(row.labelsJson ?? "[]") as string[];
      expect(parsed).not.toContain("old");
    }
    const aRow = await service.getByKey(a.taskKey);
    expect(JSON.parse(aRow?.labelsJson ?? "[]")).toEqual(["new", "other"].sort());
    for (const key of [a.taskKey, b.taskKey]) {
      const list = await events.list(key, { kind: "manager", accountId: manager.accountId });
      expect(list.events.some((e) => e.type === "update" && e.visibility === "private")).toBe(true);
    }
    // The registry now holds `new`, not `old`.
    const names = (await labels.list("default")).map((l) => l.name);
    expect(names).toContain("new");
    expect(names).not.toContain("old");
  });

  it("refuses to rename into an existing name", async () => {
    await labels.create("default", { name: "one" });
    await labels.create("default", { name: "two" });
    await expect(labels.update("default", "one", { name: "two" })).rejects.toMatchObject({ status: 409 });
  });

  it("protects system labels from rename and delete but allows recolor", async () => {
    await labels.list("default"); // seeds system labels
    await expect(labels.update("default", "category:follow_up", { name: "nope" })).rejects.toMatchObject({ status: 403 });
    await expect(labels.remove("default", "category:follow_up")).rejects.toMatchObject({ status: 403 });
    await expect(labels.remove("default", "kind:decision")).rejects.toMatchObject({ status: 403 });
    await expect(labels.remove("default", "priority:high")).rejects.toMatchObject({ status: 404 }); // not registered yet
    await service.create({ title: "Hot", labels: ["priority:high"] }, manager);
    await labels.list("default");
    await expect(labels.remove("default", "priority:high")).rejects.toMatchObject({ status: 403 });
    const recolored = await labels.update("default", "category:follow_up", { color: "red" });
    expect(recolored.color).toBe("red");
  });

  it("deleting a label strips it from every task", async () => {
    const a = await service.create({ title: "A", labels: ["doomed", "keep"] }, manager);
    // "doomed" was auto-registered by the task create.
    await labels.remove("default", "doomed", manager.accountId);
    const aRow = await service.getByKey(a.taskKey);
    expect(JSON.parse(aRow?.labelsJson ?? "[]")).toEqual(["keep"]);
  });
});

describe("task detail payload (P3-D2)", () => {
  it("returns children and parent refs; developers only see children they own", async () => {
    const parent = await service.create({ title: "Parent", kind: "meeting" }, manager);
    const own = await service.create({ title: "Mine", parentId: parent.id, ownerType: "developer", ownerId: "dev-1" }, manager);
    await service.create({ title: "Hidden child", parentId: parent.id }, manager);

    const detail = await service.detail(parent.taskKey, manager);
    expect(detail.children.map((c) => c.title).sort()).toEqual(["Hidden child", "Mine"]);
    expect(detail.parent).toBeNull();

    const ownDetail = await service.detail(own.taskKey, developer);
    expect(ownDetail.parent?.taskKey).toBe(parent.taskKey);

    const parentForDev = await service.detail(parent.taskKey, manager);
    expect(parentForDev.children.length).toBe(2);
    // Developer can't open the parent (not theirs).
    await expect(service.detail(parent.taskKey, developer)).rejects.toMatchObject({ status: 404 });
  });

  it("serves a tombstone DTO for deleted tasks to managers, 404 to developers", async () => {
    const row = await service.create({ title: "Gone", ownerType: "developer", ownerId: "dev-1" }, manager);
    await service.remove(row.taskKey, manager);
    const detail = await service.detail(row.taskKey, manager);
    expect(detail.deletedAt).toBeTruthy();
    await expect(service.detail(row.taskKey, developer)).rejects.toMatchObject({ status: 404 });
  });
});
