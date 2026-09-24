import { beforeEach, describe, expect, it } from "vitest";
import { db, resetDatabase } from "./helpers/db";
import { configTable, developers, managerDeskItems, taskKeyAliases, teamTrackerItems, workspaces } from "../src/db/schema";
import { runInTransaction } from "../src/db/transaction";
import { TaskKeysService } from "../src/services/task-keys.service";
import { TeamTrackerService } from "../src/services/team-tracker.service";
import { ManagerDeskService } from "../src/services/manager-desk.service";
import { eq } from "drizzle-orm";

const keys = new TaskKeysService();
const tracker = new TeamTrackerService();
const desk = new ManagerDeskService(tracker);

beforeEach(async () => {
  await resetDatabase();
  await db.insert(configTable).values({ key: "tasks_phase1_enabled", value: "true" });
  await db.insert(developers).values({ accountId: "dev-1", displayName: "One", isActive: 1 });
});

describe("task keys", () => {
  it("allocates monotonically and independently per workspace", async () => {
    expect(await runInTransaction(async () => keys.allocate("default"))).toBe("T-1");
    expect(await runInTransaction(async () => keys.allocate("default"))).toBe("T-2");
    const now = new Date().toISOString();
    await db.insert(workspaces).values({ id: "other", name: "Other", createdAt: now, updatedAt: now });
    expect(await runInTransaction(async () => keys.allocate("other"))).toBe("T-1");
    expect(await runInTransaction(async () => keys.allocate("default"))).toBe("T-3");
  });

  it("delegated tracker rows inherit the desk item's key", async () => {
    const item = await desk.createItem("manager-a", { date: "2026-09-24", title: "Delegated", assigneeDeveloperAccountId: "dev-1" });
    const [mirror] = await db.select().from(teamTrackerItems).where(eq(teamTrackerItems.managerDeskItemId, item.id));
    expect(item.taskKey).toMatch(/^T-\d+$/);
    expect(mirror?.taskKey).toBe(item.taskKey);
    expect(await keys.resolveTask("default", item.taskKey!)).toMatchObject({ kind: "delegated", managerDeskItemId: item.id, trackerItemId: mirror?.id });
  });

  it("promoting a tracker task adopts its key onto the desk item", async () => {
    const item = await tracker.addItem("dev-1", "2026-09-24", { title: "Promote me" });
    const detail = await desk.promoteTrackerTask("manager-a", item.id);
    expect(detail.managerDeskItem?.taskKey).toBe(item.taskKey);
    const [deskRow] = await db.select().from(managerDeskItems).where(eq(managerDeskItems.id, detail.managerDeskItem!.id));
    expect(deskRow?.taskKey).toBe(item.taskKey);
  });

  it("carry-forward keeps the same key on the moved row", async () => {
    const item = await tracker.addItem("dev-1", "2026-09-24", { title: "Carry me" });
    await tracker.carryForward("2026-09-24", "2026-09-25");
    const [row] = await db.select().from(teamTrackerItems).where(eq(teamTrackerItems.id, item.id));
    expect(row?.taskKey).toBe(item.taskKey);
  });

  it("resolves aliases exactly one hop", async () => {
    const item = await tracker.addItem("dev-1", "2026-09-24", { title: "Alias target" });
    await db.insert(taskKeyAliases).values([
      { workspaceId: "default", aliasKey: "T-98", taskKey: "T-99", reason: "merged", createdAt: new Date().toISOString() },
      { workspaceId: "default", aliasKey: "T-99", taskKey: item.taskKey!, reason: "merged", createdAt: new Date().toISOString() },
    ]);
    expect(await keys.resolve("default", "T-98")).toBe("T-99");
    expect(await keys.resolve("default", "T-99")).toBe(item.taskKey);
    expect(await keys.resolve("default", item.taskKey!)).toBe(item.taskKey);
  });
});
