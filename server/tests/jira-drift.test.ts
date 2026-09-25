import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, resetDatabase } from "./helpers/db";
import { configTable, developers, issues, taskLinks, tasks } from "../src/db/schema";
import { JiraDriftService } from "../src/services/jira-drift.service";
import { TaskService } from "../src/services/task.service";
import type { TaskPrincipal } from "../src/services/task.service";

const taskService = new TaskService();
const drift = new JiraDriftService();
const manager: TaskPrincipal = { type: "manager", accountId: "manager-1", workspaceId: "default" };

async function seedIssue(jiraKey: string, statusCategory = "indeterminate", workspaceId = "default") {
  const now = new Date().toISOString();
  await db.insert(issues).values({
    workspaceId,
    jiraKey,
    summary: `${jiraKey} summary`,
    priorityName: "High",
    priorityId: "1",
    statusName: "In Progress",
    statusCategory,
    assigneeId: null,
    assigneeName: null,
    teamScopeState: "in_team",
    syncScopeState: "active",
    reporterName: null,
    component: null,
    labels: JSON.stringify([]),
    dueDate: null,
    developmentDueDate: null,
    flagged: 0,
    createdAt: now,
    updatedAt: now,
    syncedAt: now,
    lastSeenInScopedSyncAt: now,
    lastReconciledAt: now,
    scopeChangedAt: null,
    analysisNotes: null,
    excluded: 0,
    aspenSeverity: null,
  });
}

async function linkedTask(title: string, jiraKey: string, role: "primary" | "related" = "primary") {
  const row = await taskService.create({ title }, manager);
  await taskService.addLink(row.taskKey, { kind: "jira", ref: jiraKey, role }, manager);
  return row;
}

describe("JiraDriftService (P3-D16, §8.1)", () => {
  beforeEach(async () => {
    await resetDatabase();
    await db.insert(configTable).values({ key: "tasks_phase1_enabled", value: "true" });
  });

  it("flags tasks done in Jira but still open in LeadOS", async () => {
    await seedIssue("APP-1", "done");
    await seedIssue("APP-2", "indeterminate");
    await linkedTask("Done in Jira", "APP-1");
    await linkedTask("Still aligned", "APP-2");

    const entries = await drift.list(manager, "default", "2026-03-08");
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ direction: "jira_done_task_open", jiraKey: "APP-1", title: "Done in Jira" });
  });

  it("flags tasks closed in LeadOS while Jira stays open (7-day window)", async () => {
    await seedIssue("APP-3", "indeterminate");
    const row = await linkedTask("Closed here", "APP-3");
    await taskService.update(row.taskKey, { status: "done" }, manager);

    const entries = await drift.list(manager, "default", "2026-03-08");
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ direction: "task_done_jira_open", jiraKey: "APP-3", status: "done" });
  });

  it("excludes tasks closed outside the 7-day window", async () => {
    await seedIssue("APP-4", "indeterminate");
    const row = await linkedTask("Closed long ago", "APP-4");
    await taskService.update(row.taskKey, { status: "done" }, manager);
    await db.update(tasks).set({ closedAt: "2026-02-20T08:00:00.000Z" }).where(eq(tasks.id, row.id));

    const entries = await drift.list(manager, "default", "2026-03-08");
    expect(entries).toHaveLength(0);
  });

  it("reports no drift when both sides agree", async () => {
    await seedIssue("APP-5", "done");
    const row = await linkedTask("Done both sides", "APP-5");
    await taskService.update(row.taskKey, { status: "done" }, manager);
    await seedIssue("APP-6", "indeterminate");
    await linkedTask("Open both sides", "APP-6");

    expect(await drift.list(manager, "default", "2026-03-08")).toHaveLength(0);
  });

  it("prefers the primary Jira link over related links", async () => {
    await seedIssue("APP-7", "done");
    await seedIssue("APP-8", "indeterminate");
    const row = await taskService.create({ title: "Two links" }, manager);
    // Insert directly — addLink enforces primary uniqueness and issue existence.
    await db.insert(taskLinks).values([
      { taskId: row.id, workspaceId: "default", kind: "jira", ref: "APP-7", role: "related", createdAt: new Date().toISOString() },
      { taskId: row.id, workspaceId: "default", kind: "jira", ref: "APP-8", role: "primary", createdAt: new Date().toISOString() },
    ]);

    // The primary (APP-8, still open) wins — no drift even though APP-7 is done.
    expect(await drift.list(manager, "default", "2026-03-08")).toHaveLength(0);

    await db.update(issues).set({ statusCategory: "done" }).where(eq(issues.jiraKey, "APP-8"));
    const entries = await drift.list(manager, "default", "2026-03-08");
    expect(entries).toHaveLength(1);
    expect(entries[0].jiraKey).toBe("APP-8");
  });

  it("ignores links to issues missing from the synced issue table", async () => {
    const row = await taskService.create({ title: "Unsynced link" }, manager);
    await db.insert(taskLinks).values({ taskId: row.id, workspaceId: "default", kind: "jira", ref: "GHOST-1", role: "primary", createdAt: new Date().toISOString() });
    expect(await drift.list(manager, "default", "2026-03-08")).toHaveLength(0);
  });

  it("scopes drift to the workspace and the manager's visible tasks", async () => {
    await seedIssue("APP-9", "done");
    await linkedTask("Visible drift", "APP-9");
    const otherManager: TaskPrincipal = { type: "manager", accountId: "manager-2", workspaceId: "default" };

    // Another manager's private task with drift is not visible to manager-1.
    const privateRow = await taskService.create({ title: "Private drift", ownerType: "manager", ownerId: "manager-2" }, otherManager);
    await taskService.addLink(privateRow.taskKey, { kind: "jira", ref: "APP-9", role: "primary" }, otherManager);

    const entries = await drift.list(manager, "default", "2026-03-08");
    expect(entries.map((entry) => entry.title)).toEqual(["Visible drift"]);
    expect((await drift.list(otherManager, "default", "2026-03-08")).map((entry) => entry.title)).toEqual(["Private drift"]);

    // A row in another workspace never surfaces.
    await seedIssue("WS-1", "done", "workspace_other");
    await db.insert(configTable).values({ key: "tasks_phase1_enabled", value: "true", workspaceId: "workspace_other" });
    const foreign = await taskService.create({ title: "Foreign", ownerType: "manager", ownerId: "manager-1" }, { ...manager, workspaceId: "workspace_other" });
    await db.insert(taskLinks).values({ taskId: foreign.id, workspaceId: "workspace_other", kind: "jira", ref: "WS-1", role: "primary", createdAt: new Date().toISOString() });
    expect(await drift.list(manager, "default", "2026-03-08")).toHaveLength(1);
  });

  it("developers only see drift on tasks they own", async () => {
    await db.insert(developers).values({ accountId: "dev-1", displayName: "Alice", isActive: 1 });
    await seedIssue("APP-10", "done");
    await linkedTask("Manager task", "APP-10");
    const devRow = await taskService.create({ title: "Dev drift", ownerType: "developer", ownerId: "dev-1" }, manager);
    await taskService.addLink(devRow.taskKey, { kind: "jira", ref: "APP-10", role: "primary" }, manager);

    const developer: TaskPrincipal = { type: "developer", accountId: "dev-1", workspaceId: "default" };
    const entries = await drift.list(developer, "default", "2026-03-08");
    expect(entries.map((entry) => entry.title)).toEqual(["Dev drift"]);
  });
});
