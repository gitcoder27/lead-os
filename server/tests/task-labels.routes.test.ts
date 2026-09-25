import { beforeEach, describe, expect, it } from "vitest";
import express from "express";
import { db, resetDatabase } from "./helpers/db";
import { invoke } from "./helpers/http";
import { configTable, developers } from "../src/db/schema";
import { errorHandler, notFoundHandler } from "../src/middleware/errorHandler";
import { requireManager } from "../src/middleware/auth";
import { createTasksRouter } from "../src/routes/tasks";
import { createTaskLabelsRouter } from "../src/routes/task-labels";
import { createMyDayRouter } from "../src/routes/my-day";
import { createAuthRouter } from "../src/routes/auth";
import { AuthService, serializeSessionCookie } from "../src/services/auth.service";
import { TaskKeysService } from "../src/services/task-keys.service";
import { TaskEventsService } from "../src/services/task-events.service";
import { TaskLabelsService } from "../src/services/task-labels.service";
import { TeamTrackerService } from "../src/services/team-tracker.service";
import { MyDayService } from "../src/services/my-day.service";
import { IssueService } from "../src/services/issue.service";

const auth = new AuthService();
const keys = new TaskKeysService();
const events = new TaskEventsService(keys);
const tracker = new TeamTrackerService();
const app = express();
app.use("/api/tasks", requireManager(auth), createTasksRouter(keys, events));
app.use("/api/task-labels", requireManager(auth), createTaskLabelsRouter(new TaskLabelsService()));
app.use("/api/my-day", createMyDayRouter(new MyDayService(tracker), auth, new IssueService()));
app.use("/api/auth", createAuthRouter(auth));
app.use(notFoundHandler);
app.use(errorHandler);

async function cookie(name: string): Promise<string> {
  const { sessionId } = await auth.authenticate(name, "secret123");
  return serializeSessionCookie(sessionId, auth.sessionMaxAgeSeconds);
}

async function enablePhase3() {
  await db.insert(configTable).values([
    { key: "tasks_phase2_stage", value: "2c" },
    { key: "tasks_phase3_enabled", value: "true" },
  ]);
}

beforeEach(async () => {
  await resetDatabase();
  await db.insert(configTable).values({ key: "tasks_phase1_enabled", value: "true" });
  await db.insert(developers).values([{ accountId: "dev-1", displayName: "One", isActive: 1 }]);
  await auth.createUser({ username: "manager-a", displayName: "A", password: "secret123", role: "manager" });
  await auth.createUser({ username: "dev-user", displayName: "Dev", password: "secret123", role: "developer", developerAccountId: "dev-1" });
});

describe("task label routes (P3-D13)", () => {
  it("404s every endpoint while the flag is off", async () => {
    const headers = { cookie: await cookie("manager-a") };
    await db.insert(configTable).values({ key: "tasks_phase2_stage", value: "2c" });
    expect((await invoke(app, { method: "GET", url: "/api/task-labels", headers })).status).toBe(404);
    expect((await invoke(app, { method: "POST", url: "/api/task-labels", headers, body: { name: "x" } })).status).toBe(404);
    expect((await invoke(app, { method: "DELETE", url: "/api/task-labels/x", headers })).status).toBe(404);
  });

  it("lists system + seeded labels, creates, renames, recolors and deletes", async () => {
    await enablePhase3();
    const headers = { cookie: await cookie("manager-a") };
    await invoke(app, { method: "POST", url: "/api/tasks", headers, body: { title: "Tagged", labels: ["category:follow_up", "qa"] } });
    const listed = await invoke(app, { method: "GET", url: "/api/task-labels", headers });
    expect(listed.status).toBe(200);
    const names = listed.body.labels.map((l: { name: string }) => l.name);
    expect(names).toEqual(expect.arrayContaining(["category:follow_up", "kind:decision", "kind:waiting", "qa"]));
    expect(listed.body.labels.find((l: { name: string }) => l.name === "category:follow_up").system).toBe(true);

    const created = await invoke(app, { method: "POST", url: "/api/task-labels", headers, body: { name: "sprint-1", color: "violet" } });
    expect(created.status).toBe(201);
    expect((await invoke(app, { method: "POST", url: "/api/task-labels", headers, body: { name: "sprint-1" } })).status).toBe(409);
    expect((await invoke(app, { method: "PATCH", url: "/api/task-labels/sprint-1", headers, body: { color: "blue" } })).body.color).toBe("blue");
    expect((await invoke(app, { method: "PATCH", url: "/api/task-labels/qa", headers, body: { name: "qa-passed" } })).body.name).toBe("qa-passed");
    expect((await invoke(app, { method: "PATCH", url: "/api/task-labels/category:follow_up", headers, body: { name: "renamed" } })).status).toBe(403);
    expect((await invoke(app, { method: "DELETE", url: "/api/task-labels/category:follow_up", headers })).status).toBe(403);
    expect((await invoke(app, { method: "DELETE", url: "/api/task-labels/sprint-1", headers })).status).toBe(200);
  });

  it("renaming rewrites labels on the tasks that carry it", async () => {
    await enablePhase3();
    const headers = { cookie: await cookie("manager-a") };
    const task = await invoke(app, { method: "POST", url: "/api/tasks", headers, body: { title: "Tagged", labels: ["old-name", "keep"] } });
    expect(task.status).toBe(201);
    const renamed = await invoke(app, { method: "PATCH", url: "/api/task-labels/old-name", headers, body: { name: "new-name" } });
    expect(renamed.status).toBe(200);
    const detail = await invoke(app, { method: "GET", url: `/api/tasks/${task.body.taskKey}/detail`, headers });
    expect(detail.body.labels.sort()).toEqual(["keep", "new-name"].sort());
  });
});

describe("task detail routes under Phase 3 (P3-D2/D3)", () => {
  it("returns children and parent refs and serves manager tombstones", async () => {
    await enablePhase3();
    const headers = { cookie: await cookie("manager-a") };
    const parent = await invoke(app, { method: "POST", url: "/api/tasks", headers, body: { title: "Meeting", kind: "meeting" } });
    const child = await invoke(app, { method: "POST", url: "/api/tasks", headers, body: { title: "Action", parentId: parent.body.id, ownerType: "developer", ownerId: "dev-1" } });
    expect(child.status).toBe(201);

    const detail = await invoke(app, { method: "GET", url: `/api/tasks/${parent.body.taskKey}/detail`, headers });
    expect(detail.body.children.map((c: { taskKey: string }) => c.taskKey)).toEqual([child.body.taskKey]);

    const childDetail = await invoke(app, { method: "GET", url: `/api/tasks/${child.body.taskKey}/detail`, headers });
    expect(childDetail.body.parent.taskKey).toBe(parent.body.taskKey);

    // Delete the parent — the manager still gets a tombstone detail.
    await invoke(app, { method: "DELETE", url: `/api/tasks/${parent.body.taskKey}`, headers });
    const tombstone = await invoke(app, { method: "GET", url: `/api/tasks/${parent.body.taskKey}/detail`, headers });
    expect(tombstone.status).toBe(200);
    expect(tombstone.body.deletedAt).toBeTruthy();
  });

  it("serves the developer detail DTO with private fields and children scoped", async () => {
    await enablePhase3();
    const headers = { cookie: await cookie("manager-a") };
    const devHeaders = { cookie: await cookie("dev-user") };
    const parent = await invoke(app, { method: "POST", url: "/api/tasks", headers, body: { title: "Tracked", labels: ["secret-label"], nextAction: "private" } });
    const owned = await invoke(app, { method: "POST", url: "/api/tasks", headers, body: { title: "Dev owned", parentId: parent.body.id, ownerType: "developer", ownerId: "dev-1", labels: ["hidden-from-dev"] } });
    expect(owned.status).toBe(201);

    const detail = await invoke(app, { method: "GET", url: `/api/my-day/tasks/${owned.body.taskKey}/detail`, headers: devHeaders });
    expect(detail.status).toBe(200);
    expect(detail.body.taskKey).toBe(owned.body.taskKey);
    expect(detail.body.parent.taskKey).toBe(parent.body.taskKey);
    expect(detail.body).not.toHaveProperty("labels");
    expect(detail.body).not.toHaveProperty("nextAction");
    expect(detail.body).not.toHaveProperty("trackedByManagerId");
    // Developer can't open the parent task.
    expect((await invoke(app, { method: "GET", url: `/api/my-day/tasks/${parent.body.taskKey}/detail`, headers: devHeaders })).status).toBe(404);
  });

  it("exposes features.tasksPhase3 on the session payload", async () => {
    const headers = { cookie: await cookie("manager-a") };
    let me = await invoke(app, { method: "GET", url: "/api/auth/me", headers });
    expect(me.body.features.tasksPhase3).toBe(false);
    await enablePhase3();
    me = await invoke(app, { method: "GET", url: "/api/auth/me", headers });
    expect(me.body.features.tasksPhase3).toBe(true);
    // And for the developer session too.
    me = await invoke(app, { method: "GET", url: "/api/auth/me", headers: { cookie: await cookie("dev-user") } });
    expect(me.body.features.tasksPhase3).toBe(true);
  });
});
