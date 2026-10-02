import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db, resetDatabase } from "./helpers/db";
import { rawDb } from "../src/db/connection";
import {
  appUsers,
  configTable,
  developers,
  managerSelfLinks,
  oneOnOneAgendaItems,
  oneOnOneSeries,
  taskEvents,
  taskInbox,
  tasks,
} from "../src/db/schema";
import { TaskService } from "../src/services/task.service";
import { TaskEventsService } from "../src/services/task-events.service";
import { TeamTrackerService } from "../src/services/team-tracker.service";
import { TaskInboxService } from "../src/services/task-inbox.service";
import { WorkspaceMaintenanceService } from "../src/services/workspace-maintenance.service";
import type { AuthUser } from "shared/types";

const manager = { type: "manager" as const, accountId: "lead", workspaceId: "default" };
const developer = { type: "developer" as const, accountId: "dev-1", workspaceId: "default" };
const lead: AuthUser = {
  username: "lead",
  accountId: "lead",
  workspaceId: "default",
  displayName: "Lead",
  role: "manager",
};
const dev: AuthUser = {
  username: "dev-user",
  accountId: "dev-1",
  developerAccountId: "dev-1",
  workspaceId: "default",
  displayName: "Developer",
  role: "developer",
};
const second: AuthUser = { ...dev, username: "second-user", accountId: "dev-2", developerAccountId: "dev-2" };
const other: AuthUser = { ...lead, username: "other", accountId: "other" };
const service = new TaskService();
const events = new TaskEventsService();
const inbox = new TaskInboxService();
const assign = () =>
  service.create(
    { title: "Ship release", ownerType: "developer", ownerId: "dev-1", nextAction: "Private next action" },
    manager,
  );
const instruction = (taskKey: string, visibility: "shared" | "private" = "shared", requestId = randomUUID()) =>
  events.append(
    {
      taskKey,
      type: "instruction",
      body: "Review release checklist",
      meta: { via: "task_drawer" },
      visibility,
      requestId,
    },
    manager,
  );

beforeEach(async () => {
  await resetDatabase();
  await db.insert(configTable).values([
    { key: "tasks_phase1_enabled", value: "true" },
    { key: "tasks_phase2_stage", value: "2b" },
    { key: "team_mode", value: "collab" },
  ]);
  await db.insert(developers).values([
    { accountId: "dev-1", displayName: "One", isActive: 1 },
    { accountId: "dev-2", displayName: "Two", isActive: 1 },
  ]);
  await db.insert(appUsers).values(
    [lead, other, dev, second].map((user) => ({
      username: user.username,
      displayName: user.displayName,
      role: user.role,
      developerAccountId: user.developerAccountId ?? null,
      passwordHash: "test-only",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })),
  );
});

describe("durable task inbox", () => {
  it("delivers both sides, deduplicates request retries and persists read/unread without changing history", async () => {
    const task = await assign();
    expect((await inbox.list(dev)).events[0]).toMatchObject({
      kind: "assignment",
      taskKey: task.taskKey,
      actorName: "Lead",
      readAt: null,
    });
    expect((await inbox.list(lead)).unreadCount).toBe(0);
    expect((await inbox.list(other)).events).toEqual([]);
    const requestId = randomUUID();
    const sent = await instruction(task.taskKey, "shared", requestId);
    expect((await instruction(task.taskKey, "shared", requestId)).id).toBe(sent.id);
    const reply = await events.append(
      {
        taskKey: task.taskKey,
        type: "update",
        body: "Checklist is ready",
        meta: { via: "my_day" },
        requestId: randomUUID(),
      },
      developer,
    );
    await events.append(
      { taskKey: task.taskKey, type: "blocker", body: "Release key is missing", meta: { action: "raised" } },
      developer,
    );
    await events.append({ taskKey: task.taskKey, type: "blocker", body: null, meta: { action: "cleared" } }, developer);
    expect((await inbox.list(lead)).events.map((item) => item.kind)).toEqual(["blocker_cleared", "blocker", "reply"]);
    const response = await inbox.list(dev);
    expect(response.unreadCount).toBe(2);
    expect(response.events[0]?.href).toBe(`/t/${task.taskKey}?event=${sent.id}`);
    expect(JSON.stringify(response)).not.toContain("Private next action");
    const id = response.events[0]!.id;
    await inbox.markRead(dev, { ids: [id], read: true });
    const readAt = (await new TaskInboxService().list(dev)).events[0]?.readAt;
    expect(readAt).toBeTruthy();
    await inbox.markRead(dev, { ids: [id], read: true });
    expect((await inbox.list(dev)).events[0]?.readAt).toBe(readAt);
    expect((await inbox.list(dev, { unreadOnly: true })).events.map((item) => item.kind)).toEqual(["assignment"]);
    await inbox.markRead(dev, { ids: [id], read: false });
    expect((await inbox.list(dev)).unreadCount).toBe(2);
    expect((await inbox.targetEvent(lead, reply.id, task.taskKey)).event.body).toBe("Checklist is ready");
    expect((await inbox.targetEvent(dev, sent.id, task.taskKey)).event).toMatchObject({
      id: sent.id,
      author: { displayName: "Lead" },
    });
  });

  it("rechecks recipient, current ownership, workspace and task deletion on every operation", async () => {
    const task = await assign();
    const event = await instruction(task.taskKey);
    const delivery = (await inbox.list(dev)).events[0]!;
    await expect(inbox.markRead(second, { ids: [delivery.id], read: true })).rejects.toMatchObject({ status: 404 });
    await expect(inbox.targetEvent(second, event.id, task.taskKey)).rejects.toMatchObject({ status: 404 });
    await expect(inbox.list({ ...dev, workspaceId: "elsewhere" })).rejects.toMatchObject({ status: 401 });
    await service.update(task.taskKey, { ownerType: "developer", ownerId: "dev-2" }, manager);
    expect((await inbox.list(dev)).unreadCount).toBe(0);
    await expect(inbox.markRead(dev, { ids: [delivery.id], read: true })).rejects.toMatchObject({ status: 404 });
    await expect(inbox.targetEvent(dev, event.id, task.taskKey)).rejects.toMatchObject({ status: 404 });
    expect((await inbox.list(second)).events.map((item) => item.kind)).toEqual(["assignment"]);
    await service.remove(task.taskKey, manager);
    expect((await inbox.list(second)).events).toEqual([]);
  });

  it("never delivers private notes or 1:1 preparation, hides redacted events and deduplicates sharing", async () => {
    const task = await assign();
    const privateEvent = await instruction(task.taskKey, "private");
    expect((await inbox.list(dev)).unreadCount).toBe(1);
    await events.changeVisibility(task.taskKey, privateEvent.id, "lead", "shared");
    const delivery = (await inbox.list(dev)).events[0]!;
    expect(delivery.eventId).toBe(privateEvent.id);
    await events.changeVisibility(task.taskKey, privateEvent.id, "lead", "private");
    expect((await inbox.list(dev)).unreadCount).toBe(1);
    await expect(inbox.targetEvent(dev, privateEvent.id, task.taskKey)).rejects.toMatchObject({ status: 404 });
    await events.changeVisibility(task.taskKey, privateEvent.id, "lead", "shared");
    expect((await inbox.list(dev)).unreadCount).toBe(2);
    await events.redact(task.taskKey, privateEvent.id, "lead");
    expect((await inbox.list(dev)).unreadCount).toBe(1);
    await expect(inbox.markRead(dev, { ids: [delivery.id], read: true })).rejects.toMatchObject({ status: 404 });
    const prep = await service.create(
      { title: "Private preparation", ownerType: "developer", ownerId: "dev-1" },
      manager,
      { source: "one_on_one" },
    );
    await instruction(prep.taskKey);
    await events.append(
      {
        taskKey: task.taskKey,
        type: "note_ref",
        body: null,
        meta: { noteId: 1, noteDate: "2026-10-03", relation: "mentioned", excerpt: "Secret note" },
      },
      { type: "system", accountId: "lead" },
    );
    expect((await inbox.list(dev)).events).toHaveLength(1);
    expect((await db.select().from(taskInbox)).filter((row) => row.eventId === privateEvent.id)).toHaveLength(1);
  });

  it("revokes an earlier delivery when a task becomes private agenda material", async () => {
    const task = await assign();
    const delivery = (await inbox.list(dev)).events[0]!;
    const [series] = await db
      .insert(oneOnOneSeries)
      .values({ developerAccountId: "dev-1", cadence: "weekly", createdAt: new Date().toISOString() })
      .returning();
    await db
      .insert(oneOnOneAgendaItems)
      .values({ seriesId: series!.id, taskId: task.id, position: 0, addedAt: new Date().toISOString() });
    expect((await inbox.list(dev)).events).toEqual([]);
    await expect(inbox.targetEvent(dev, delivery.eventId, task.taskKey)).rejects.toMatchObject({ status: 404 });
    await instruction(task.taskKey);
    expect(await db.select().from(taskInbox)).toHaveLength(1);
  });

  it("keeps solo and nonparticipating behavior, without retrospective delivery on mode changes", async () => {
    await db.update(configTable).set({ value: "solo" }).where(eq(configTable.key, "team_mode"));
    const task = await assign();
    await instruction(task.taskKey);
    expect(await inbox.list(dev)).toMatchObject({ enabled: false, unreadCount: 0, events: [] });
    expect(await db.select().from(taskInbox)).toEqual([]);
    await db.update(configTable).set({ value: "collab" }).where(eq(configTable.key, "team_mode"));
    expect((await inbox.list(dev)).events).toEqual([]);
    await db.update(appUsers).set({ isActive: 0 }).where(eq(appUsers.username, dev.username));
    await instruction(task.taskKey);
    expect(await db.select().from(taskInbox)).toEqual([]);
    await expect(inbox.list(dev)).rejects.toMatchObject({ status: 401 });
    await db.update(appUsers).set({ isActive: 1 }).where(eq(appUsers.username, dev.username));
    await db.update(developers).set({ isActive: 0 }).where(eq(developers.accountId, "dev-1"));
    await instruction(task.taskKey);
    expect(await db.select().from(taskInbox)).toEqual([]);
  });

  it("avoids self chasing while delivering another manager's assignment to a linked manager", async () => {
    await db
      .insert(managerSelfLinks)
      .values({ managerAccountId: "lead", developerAccountId: "dev-1", updatedAt: new Date().toISOString() });
    const task = await assign();
    expect((await inbox.list(lead)).events).toEqual([]);
    expect((await inbox.list(dev)).events).toEqual([]);
    await instruction(task.taskKey);
    expect((await inbox.list(dev)).events).toEqual([]);
    await events.append({ taskKey: task.taskKey, type: "update", body: "My own update", meta: null }, developer);
    expect((await inbox.list(lead)).events).toEqual([]);
    await service.create(
      { title: "For the lead", ownerType: "developer", ownerId: "dev-1" },
      { ...manager, accountId: "other" },
    );
    expect((await inbox.list(lead)).events.map((item) => item.title)).toEqual(["For the lead"]);
  });

  it("retains the manager actor when a login collides with a developer account id", async () => {
    await db.insert(developers).values({ accountId: "future", displayName: "Collision developer", isActive: 1 });
    const stamp = new Date().toISOString();
    await db.insert(appUsers).values([
      {
        username: "future-dev",
        displayName: "Collision developer",
        role: "developer",
        developerAccountId: "future",
        passwordHash: "test-only",
        createdAt: stamp,
        updatedAt: stamp,
      },
      {
        username: "future",
        displayName: "Future Manager",
        role: "manager",
        passwordHash: "test-only",
        createdAt: stamp,
        updatedAt: stamp,
      },
    ]);
    const principal = { ...manager, accountId: "future" };
    const task = await service.create(
      { title: "From another lead", ownerType: "developer", ownerId: "dev-1" },
      principal,
    );
    await new TeamTrackerService().recordStatusUpdate(
      "dev-1",
      service.today(),
      { status: "blocked", rationale: "Missing release key", taskKey: task.taskKey },
      { type: "manager", accountId: "future" },
      "default",
    );
    expect((await inbox.list(dev)).events[0]).toMatchObject({ kind: "blocker", actorName: "Future Manager" });
    expect((await inbox.list({ ...lead, username: "future", accountId: "future" })).events).toEqual([]);
  });

  it("bounds pagination, keeps total unread independent of pages and resolves old exact targets", async () => {
    const task = await assign();
    const oldest = await instruction(task.taskKey);
    for (let i = 0; i < 23; i++) await instruction(task.taskKey);
    const first = await inbox.list(dev, { limit: 5 });
    expect(first.events).toHaveLength(5);
    expect(first.unreadCount).toBe(25);
    const secondPage = await inbox.list(dev, { cursor: first.nextCursor!, limit: 5 });
    expect(secondPage.events.map((item) => item.id).some((id) => first.events.some((item) => item.id === id))).toBe(
      false,
    );
    expect((await inbox.targetEvent(dev, oldest.id, task.taskKey)).event.id).toBe(oldest.id);
    await expect(inbox.targetEvent(dev, oldest.id, "T-999")).rejects.toMatchObject({ status: 404 });
    await expect(inbox.list(dev, { cursor: "-1" })).rejects.toMatchObject({ status: 400 });
    await expect(inbox.markRead(dev, { ids: [first.events[0]!.id, 999999], read: true })).rejects.toMatchObject({
      status: 404,
    });
    expect((await inbox.list(dev)).unreadCount).toBe(25);
    await expect(inbox.markRead(dev, { ids: [-1], read: true })).rejects.toMatchObject({ status: 400 });
  });

  it("commits task, event and delivery atomically, and clears deliveries with canonical reset", async () => {
    rawDb.exec(
      "CREATE TRIGGER reject_inbox BEFORE INSERT ON task_inbox BEGIN SELECT RAISE(ABORT, 'test delivery failure'); END",
    );
    try {
      await expect(assign()).rejects.toThrow("test delivery failure");
    } finally {
      rawDb.exec("DROP TRIGGER reject_inbox");
    }
    expect(await db.select().from(tasks)).toEqual([]);
    expect(await db.select().from(taskEvents)).toEqual([]);
    await assign();
    expect((await inbox.list(dev)).unreadCount).toBe(1);
    await new WorkspaceMaintenanceService().reset("lead", "workspace", "default");
    expect(await db.select().from(taskInbox)).toEqual([]);
  });

  it("isolates equal developer ids in other workspaces and keeps their deliveries inaccessible", async () => {
    const outsideLead = { ...lead, username: "outside-lead", accountId: "outside-lead", workspaceId: "outside" };
    const outsideDev = { ...dev, username: "outside-dev", workspaceId: "outside" };
    await db.insert(configTable).values([
      { workspaceId: "outside", key: "tasks_phase1_enabled", value: "true" },
      { workspaceId: "outside", key: "tasks_phase2_stage", value: "2b" },
      { workspaceId: "outside", key: "team_mode", value: "collab" },
    ]);
    await db
      .insert(developers)
      .values({ workspaceId: "outside", accountId: "dev-1", displayName: "Outside", isActive: 1 });
    await db.insert(appUsers).values(
      [outsideLead, outsideDev].map((user) => ({
        workspaceId: user.workspaceId,
        username: user.username,
        displayName: user.displayName,
        role: user.role,
        developerAccountId: user.developerAccountId ?? null,
        passwordHash: "test-only",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })),
    );
    const task = await service.create(
      { title: "Other workspace", ownerType: "developer", ownerId: "dev-1" },
      { ...manager, accountId: "outside-lead", workspaceId: "outside" },
    );
    const delivered = (await inbox.list(outsideDev)).events[0]!;
    expect(delivered.title).toBe("Other workspace");
    expect((await inbox.list(dev)).events).toEqual([]);
    await expect(inbox.markRead(dev, { ids: [delivered.id], read: true })).rejects.toMatchObject({ status: 404 });
    await expect(inbox.targetEvent(dev, delivered.eventId, task.taskKey)).rejects.toMatchObject({ status: 404 });
  });

  it("delivers a developer's direct blocked status to the tracking manager without self or other-manager chasing", async () => {
    const task = await assign();
    await service.update(task.taskKey, { status: "blocked" }, developer);
    const delivered = (await inbox.list(lead)).events[0]!;
    expect(delivered).toMatchObject({ kind: "blocker", actorName: "Developer", taskKey: task.taskKey });
    expect((await inbox.list(other)).events).toEqual([]);
    expect((await inbox.list(dev)).events.map((item) => item.kind)).toEqual(["assignment"]);
    await db.update(appUsers).set({ isActive: 0 }).where(eq(appUsers.username, dev.username));
    await expect(inbox.targetEvent(dev, delivered.eventId, task.taskKey)).rejects.toMatchObject({ status: 401 });
  });

  it("does not backfill imported history or deliver before canonical cutover", async () => {
    const task = await assign();
    await events.append(
      {
        taskKey: task.taskKey,
        type: "update",
        body: "Historical note",
        meta: {
          imported: {
            field: "tracker_note",
            sourceTable: "team_tracker_items",
            sourceId: 1,
            sectionDate: null,
            approximateTime: true,
          },
        },
      },
      manager,
    );
    expect((await inbox.list(dev)).unreadCount).toBe(1);
    await db
      .update(configTable)
      .set({ value: "2a" })
      .where(and(eq(configTable.workspaceId, "default"), eq(configTable.key, "tasks_phase2_stage")));
    expect((await inbox.list(dev)).enabled).toBe(false);
  });
});
