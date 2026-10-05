import type { ManagerTask } from "shared/types";
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, resetDatabase } from "./helpers/db";
import { configTable, tasks, taskPlacements } from "../src/db/schema";
import { ProjectsService } from "../src/services/projects.service";
import { TaskPlacementsService } from "../src/services/task-placements.service";
import { TaskService } from "../src/services/task.service";
import { TaskViewsService } from "../src/services/task-views.service";
import { ProjectFactsService } from "../src/services/project-facts.service";
const a = { type: "manager" as const, accountId: "a", workspaceId: "default" };
const b = { ...a, accountId: "b" };
const containers = new ProjectsService();
const placements = new TaskPlacementsService();
const service = new TaskService();
beforeEach(async () => {
  await resetDatabase();
  await db.insert(configTable).values([
    { key: "tasks_phase1_enabled", value: "true" },
    { key: "tasks_phase2_stage", value: "2c" },
    { key: "tasks_phase3_enabled", value: "true" },
  ]);
});
describe("private project placement", () => {
  it("isolates two managers, workspaces and developer DTOs without task activity", async () => {
    const task = await service.create({ title: "Shared inbox", ownerType: null, ownerId: null }, a);
    const pa = await containers.write(a, { name: "A" });
    const pb = await containers.write(b, { name: "B" });
    await placements.bulk(a, {
      preview: await placements.preview(a, { keys: [task.taskKey] }),
      placement: { projectId: pa.id, trackId: null },
    });
    await placements.bulk(b, {
      preview: await placements.preview(b, { keys: [task.taskKey] }),
      placement: { projectId: pb.id, trackId: null },
    });
    expect(((await service.toDto(task, a)) as ManagerTask).placement?.projectName).toBe("A");
    expect(((await service.toDto(task, b)) as ManagerTask).placement?.projectName).toBe("B");
    expect(await service.toDto(task, { ...a, type: "developer" })).not.toHaveProperty("placement");
    await expect(containers.requireProject({ ...a, workspaceId: "other" }, pa.id)).rejects.toMatchObject({
      status: 404,
    });
    expect((await service.getById(task.id))!.updatedAt).toBe(task.updatedAt);
  });
  it("deduplicates descendants and rejects stale previews atomically and guarded undo", async () => {
    const parent = await service.create({ title: "Parent" }, a);
    const child = await service.create({ title: "Child", parentId: parent.id }, a);
    const hidden = await service.create({ title: "Private child", parentId: parent.id }, b);
    const project = await containers.write(a, { name: "Project" });
    const preview = await placements.preview(a, { keys: [parent.taskKey, child.taskKey], includeSubtasks: true });
    expect(preview.tasks.map((task) => task.taskKey)).not.toContain(hidden.taskKey);
    expect(preview.tasks).toHaveLength(2);
    const receipt = await placements.bulk(a, { preview, placement: { projectId: project.id, trackId: null } });
    await expect(placements.bulk(a, { preview, placement: null })).rejects.toMatchObject({ status: 409 });
    await containers.write(a, { archived: true }, project.id);
    await placements.bulk(a, receipt.undo);
    expect(await db.select().from(taskPlacements)).toHaveLength(0);
    await expect(
      placements.bulk(a, {
        preview: await placements.preview(a, { keys: [parent.taskKey] }),
        placement: { projectId: project.id, trackId: null },
      }),
    ).rejects.toMatchObject({ status: 409 });
  });
  it("filters lists and counts with distinct facts and Later resurfacing", async () => {
    const project = await containers.write(a, { name: "Facts" });
    const track = await containers.write(a, { name: "Track" }, undefined, project.id);
    const one = await service.create(
      { title: "Blocked", status: "blocked", scheduledOn: "2026-10-01", followUpAt: "2026-10-05T00:00:00Z" },
      a,
    );
    const parked = await service.create(
      { title: "Parked", later: true, hideUntil: "2026-10-06", scheduledOn: null, followUpAt: "2026-10-05T00:00:00Z" },
      a,
    );
    await placements.bulk(a, {
      preview: await placements.preview(a, { keys: [one.taskKey] }),
      placement: { projectId: project.id, trackId: track.id },
    });
    await placements.bulk(a, {
      preview: await placements.preview(a, { keys: [parked.taskKey] }),
      placement: { projectId: project.id, trackId: null },
    });
    const views = new TaskViewsService();
    expect(await views.count(a, { filters: { project: project.id } }, "2026-10-05")).toBe(2);
    expect(await views.run(a, { filters: { project: project.id, track: "none" } }, "2026-10-05")).toHaveLength(1);
    expect((await new ProjectFactsService().detail(a, project.id, "2026-10-05", "Asia/Kolkata")).facts).toMatchObject({
      open: 2,
      blocked: 1,
      overdue: 1,
      followUpDue: 1,
    });
    expect((await new ProjectFactsService().detail(a, project.id, "2026-10-06")).facts.followUpDue).toBe(2);
    await db.update(tasks).set({ trackedByManagerId: "b", ownerId: "b" }).where(eq(tasks.id, one.id));
    expect(await views.run(a, { filters: { project: project.id } })).toHaveLength(1);
    expect(((await service.toDto((await service.getById(one.id))!, a)) as ManagerTask).placement).toBeNull();
    expect(await db.select().from(taskPlacements)).toHaveLength(2);
  });
});

it("creates with capture placement, inherits children, clears explicitly and replays once", async () => {
  const { CaptureService } = await import("../src/services/capture.service");
  const capture = new CaptureService();
  const project = await containers.write(a, { name: "Capture" });
  const request = {
    text: "Rehearsal",
    requestId: "placement-replay",
    clientToday: "2026-10-05",
    tz: "Asia/Kolkata",
    defaults: { placement: { projectId: project.id, trackId: null } },
  };
  const first = await capture.run(request, a);
  expect(first.task?.placement?.projectId).toBe(project.id);
  expect((await capture.run(request, a)).task?.taskKey).toBe(first.task?.taskKey);
  const child = await capture.run({ text: "Child", defaults: { parentKey: first.task!.taskKey } }, a);
  expect(child.task?.placement?.projectId).toBe(project.id);
  const clear = await capture.run(
    { text: "Direct child", defaults: { parentKey: first.task!.taskKey, placement: null } },
    a,
  );
  expect(clear.task?.placement).toBeNull();
  await containers.write(a, { archived: true }, project.id);
  await expect(
    capture.run({ text: "Must rollback", defaults: { parentKey: first.task!.taskKey } }, a),
  ).rejects.toMatchObject({ status: 409 });
  expect((await db.select().from(tasks)).map((task) => task.title)).not.toContain("Must rollback");
  expect((await capture.run(request, a)).task?.taskKey).toBe(first.task?.taskKey);
  expect(await db.select().from(tasks)).toHaveLength(3);
});

it("counts only visible direct children and excludes dropped work", async () => {
  const parent = await service.create({ title: "Ordinary parent" }, a);
  await service.create({ title: "Done", status: "done", parentId: parent.id }, a);
  await service.create({ title: "Dropped", status: "dropped", parentId: parent.id }, a);
  await service.create({ title: "Hidden", parentId: parent.id }, b);
  const rows = await new TaskViewsService().run(a, {});
  expect(rows.find((task) => task.id === parent.id)?.signals.actions).toEqual({ done: 1, total: 1 });
  const detail = await service.detail(parent.taskKey, a);
  expect("children" in detail && detail.children.map((task) => task.title)).toEqual(["Done", "Dropped"]);
});

it("purges membership with tasks and respects manager, team and workspace reset scopes", async () => {
  const { WorkspaceMaintenanceService } = await import("../src/services/workspace-maintenance.service");
  const pa = await containers.write(a, { name: "A" });
  const pb = await containers.write(b, { name: "B" });
  const task = await service.create({ title: "Owned" }, a);
  await placements.set(a, task.id, { projectId: pa.id, trackId: null });
  const maintenance = new WorkspaceMaintenanceService();
  expect((await maintenance.getResetPreview(a.accountId)).projectData?.workspace.projects).toBe(2);
  await maintenance.reset(a.accountId, "team_tracker");
  expect(await containers.list(a)).toHaveLength(1);
  await service.purge([task.id]);
  expect(await db.select().from(taskPlacements)).toHaveLength(0);
  await maintenance.reset(a.accountId, "manager_desk");
  expect(await containers.list(a)).toHaveLength(0);
  expect((await containers.list(b))[0]?.id).toBe(pb.id);
  await maintenance.reset(a.accountId, "workspace");
  expect(await containers.list(b)).toHaveLength(0);
});

it("rejects changed descendant sets, invalid tracks and undo into archived destinations", async () => {
  const parent = await service.create({ title: "Parent" }, a);
  const pa = await containers.write(a, { name: "A" });
  const pb = await containers.write(a, { name: "B" });
  const track = await containers.write(a, { name: "Security" }, undefined, pb.id);
  const preview = await placements.preview(a, { keys: [parent.taskKey], includeSubtasks: true });
  await service.create({ title: "New child", parentId: parent.id }, a);
  await expect(placements.bulk(a, { preview, placement: { projectId: pa.id, trackId: null } })).rejects.toMatchObject({
    status: 409,
  });
  const single = await placements.preview(a, { keys: [parent.taskKey] });
  await expect(
    placements.bulk(a, { preview: single, placement: { projectId: pa.id, trackId: track.id } }),
  ).rejects.toMatchObject({ status: 400 });
  await placements.bulk(a, { preview: single, placement: { projectId: pa.id, trackId: null } });
  const moved = await placements.bulk(a, {
    preview: await placements.preview(a, { keys: [parent.taskKey] }),
    placement: { projectId: pb.id, trackId: null },
  });
  await containers.write(a, { archived: true }, pa.id);
  await expect(placements.bulk(a, moved.undo)).rejects.toMatchObject({ status: 409 });
  expect(((await service.toDto(parent, a)) as ManagerTask).placement?.projectId).toBe(pb.id);
  await containers.write(a, { archived: true }, track.id, pb.id);
  await containers.write(a, { archived: true }, pb.id);
  await containers.write(a, { archived: false }, pb.id);
  expect((await containers.requireTrack(a, track.id)).archivedAt).not.toBeNull();
  await expect(containers.write(a, { name: "Security" }, undefined, pb.id)).rejects.toMatchObject({ status: 409 });
});

it("private-data deletion previews and purges the selected manager's containers", async () => {
  const { AuthService } = await import("../src/services/auth.service");
  const { AuthUserMaintenanceService } = await import("../src/services/auth-user-maintenance.service");
  const auth = new AuthService();
  await auth.createUser({
    username: "owner",
    displayName: "Owner",
    password: "secret123",
    role: "manager",
    workspaceId: "default",
  });
  await auth.createUser({
    username: "extra",
    displayName: "Extra",
    password: "secret123",
    role: "manager",
    workspaceId: "default",
  });
  const extra = { ...a, accountId: "extra" };
  const project = await containers.write(extra, { name: "Private" });
  const inbox = await service.create({ title: "Inbox", ownerType: null, ownerId: null }, a);
  await placements.set(extra, inbox.id, { projectId: project.id, trackId: null });
  const maintenance = new AuthUserMaintenanceService();
  const params = { username: "extra", workspaceId: "default", role: "manager" as const, purgePrivateData: true };
  expect((await maintenance.getDeletionPreview(params)).privateData).toMatchObject({
    projectCount: 1,
    placementCount: 1,
  });
  await maintenance.deleteUser(params);
  expect(await containers.list(extra)).toHaveLength(0);
  expect(await service.getById(inbox.id)).toBeDefined();
});

it("additive migrations and isolated backup restoration preserve private membership", async () => {
  const { rawDb } = await import("../src/db/connection");
  const { migrate } = await import("../src/db/migrate");
  const { default: Database } = await import("better-sqlite3");
  const fs = await import("node:fs");
  const path = await import("node:path");
  const { runScratchPath } = await import("./helpers/tmp");
  const project = await containers.write(a, { name: "Snapshot" });
  const task = await service.create({ title: "Keep" }, a);
  await placements.set(a, task.id, { projectId: project.id, trackId: null });
  migrate(rawDb);
  expect(await placements.preview(a, { keys: [task.taskKey] })).toMatchObject({
    tasks: [{ placement: { projectId: project.id } }],
  });
  const dir = runScratchPath("projects-backup");
  fs.mkdirSync(dir, { recursive: true });
  const snapshot = path.join(dir, "snapshot.db");
  const restored = path.join(dir, "restored.db");
  await rawDb.backup(snapshot);
  fs.copyFileSync(snapshot, restored);
  const copy = new Database(restored);
  try {
    migrate(copy);
    expect(copy.prepare("SELECT name FROM projects").get()).toEqual({ name: "Snapshot" });
    expect(copy.prepare("SELECT project_id FROM task_placements").get()).toEqual({ project_id: project.id });
    expect(copy.pragma("foreign_key_check")).toEqual([]);
  } finally {
    copy.close();
  }
});

it("keeps placement out of former-owner details and uses local-day facts", async () => {
  const { developers } = await import("../src/db/schema");
  await db.insert(developers).values({ accountId: "dev", displayName: "Developer", isActive: 1 });
  const project = await containers.write(a, { name: "Local clock" });
  const task = await service.create(
    {
      title: "Local due",
      ownerType: "developer",
      ownerId: "dev",
      scheduledOn: null,
      dueAt: "2026-10-04T21:00:00Z",
      followUpAt: "2026-10-05T20:00:00Z",
    },
    a,
  );
  await placements.set(a, task.id, { projectId: project.id, trackId: null });
  const facts = new ProjectFactsService();
  expect((await facts.detail(a, project.id, "2026-10-05", "Asia/Kolkata")).facts).toMatchObject({
    overdue: 0,
    followUpDue: 0,
  });
  expect((await facts.detail(a, project.id, "2026-10-05", "UTC")).facts).toMatchObject({ overdue: 1, followUpDue: 1 });
  const { TaskEventsService } = await import("../src/services/task-events.service");
  await new TaskEventsService().append(
    {
      workspaceId: "default",
      taskKey: task.taskKey,
      type: "update",
      body: "Progress recorded",
      meta: {},
      visibility: "shared",
    },
    { type: "developer", accountId: "dev" },
  );
  await service.update(task.taskKey, { status: "active" }, { ...a, type: "developer", accountId: "dev" });
  await service.update(task.taskKey, { ownerType: null, ownerId: null }, a);
  expect(await service.detail(task.taskKey, { ...a, type: "developer", accountId: "dev" })).toEqual({
    taskKey: task.taskKey,
    title: task.title,
    status: "open",
    access: "former-owner",
  });
  const meeting = await service.create({ title: "Past meeting", kind: "meeting", scheduledOn: "2026-10-01" }, a);
  await placements.set(a, meeting.id, { projectId: project.id, trackId: null });
  expect((await facts.detail(a, project.id, "2026-10-05", "Asia/Kolkata")).facts.overdue).toBe(0);
});

it("caps expanded placements at 200 and refuses an entire multi-task stale change", async () => {
  const parent = await service.create({ title: "Parent" }, a);
  const { id: _id, ...columns } = parent;
  await db
    .insert(tasks)
    .values(
      Array.from({ length: 200 }, (_, index) => ({ ...columns, taskKey: `T-${index + 2}`, parentId: parent.id })),
    );
  await expect(placements.preview(a, { keys: [parent.taskKey], includeSubtasks: true })).rejects.toMatchObject({
    status: 400,
  });
  const project = await containers.write(a, { name: "Atomic" });
  const preview = await placements.preview(a, { keys: ["T-1", "T-2"] });
  await placements.set(a, parent.id, { projectId: project.id, trackId: null });
  await expect(
    placements.bulk(a, { preview, placement: { projectId: project.id, trackId: null } }),
  ).rejects.toMatchObject({ status: 409 });
  expect(await db.select().from(taskPlacements)).toHaveLength(1);
});

it("never returns hidden descendants and includes visible descendants across hidden ancestry", async () => {
  const parent = await service.create({ title: "Visible parent" }, a);
  const hidden = await service.create({ title: "Hidden child", parentId: parent.id }, b);
  const grandchild = await service.create({ title: "Visible grandchild", parentId: hidden.id }, a);
  const preview = await placements.preview(a, { keys: [parent.taskKey], includeSubtasks: true });
  expect(preview.tasks.map((task) => task.taskKey)).toEqual([parent.taskKey, grandchild.taskKey]);
  const project = await containers.write(a, { name: "Private" });
  await expect(placements.set(a, hidden.id, { projectId: project.id, trackId: null })).rejects.toMatchObject({
    status: 404,
  });
  expect(await db.select().from(taskPlacements)).toHaveLength(0);
});

it("uses visible private follow-ups and orders checks by instant across offsets", async () => {
  const privateTask = await service.create({ title: "Unowned shared task", ownerType: null, ownerId: null, followUpAt: "2026-10-05T00:00:00Z" }, a);
  const pb = await containers.write(b, { name: "B" });
  await placements.set(b, privateTask.id, { projectId: pb.id, trackId: null });
  expect((await new ProjectFactsService().detail(b, pb.id, "2026-10-05")).facts).toMatchObject({ followUpDue: 0, nextCheck: null });
  const pa = await containers.write(a, { name: "Checks" });
  const early = await service.create({ title: "First check", followUpAt: "2026-10-05T09:30:00+05:30" }, a);
  const later = await service.create({ title: "Later check", followUpAt: "2026-10-05T05:00:00Z" }, a);
  await placements.bulk(a, { preview: await placements.preview(a, { keys: [early.taskKey, later.taskKey] }), placement: { projectId: pa.id, trackId: null } });
  expect((await new ProjectFactsService().detail(a, pa.id, "2026-10-05")).facts.nextCheck?.taskKey).toBe(early.taskKey);
});
