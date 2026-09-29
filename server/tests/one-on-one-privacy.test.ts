import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import express from "express";
import { and, eq } from "drizzle-orm";
import { db, resetDatabase } from "./helpers/db";
import { invoke } from "./helpers/http";
import { configTable, dayFocus, developers, oneOnOneAgendaItems, oneOnOneSeries, taskLinks, tasks } from "../src/db/schema";
import { errorHandler, notFoundHandler } from "../src/middleware/errorHandler";
import { requireManager } from "../src/middleware/auth";
import { createOneOnOnesRouter } from "../src/routes/one-on-ones";
import { createMyDayRouter } from "../src/routes/my-day";
import { AuthService, serializeSessionCookie } from "../src/services/auth.service";
import { IssueService } from "../src/services/issue.service";
import { MyDayService } from "../src/services/my-day.service";
import { OneOnOneService } from "../src/services/one-on-one.service";
import { OneOnOneTopicCleanupService } from "../src/services/one-on-one-topic-cleanup.service";
import { TaskEventsService } from "../src/services/task-events.service";
import { TaskService, type TaskPrincipal } from "../src/services/task.service";
import { TeamTrackerService } from "../src/services/team-tracker.service";
import { WorkloadService } from "../src/services/workload.service";
import { todayIsoDate } from "../src/utils/date";

/**
 * docs/56 P0-S5: private 1:1 topics must never be visible to developers and
 * never count in developer load or attention signals.
 */
const auth = new AuthService();
const oneOnOneService = new OneOnOneService();
const taskService = new TaskService();
const events = new TaskEventsService();
const cleanup = new OneOnOneTopicCleanupService();
const today = todayIsoDate();

const app = express();
app.use("/api/one-on-ones", requireManager(auth), createOneOnOnesRouter(oneOnOneService));
app.use("/api/my-day", createMyDayRouter(new MyDayService(new TeamTrackerService()), auth, new IssueService()));
app.use(notFoundHandler);
app.use(errorHandler);

async function cookie(name: string): Promise<string> {
  const { sessionId } = await auth.authenticate(name, "secret123");
  return serializeSessionCookie(sessionId, auth.sessionMaxAgeSeconds);
}

let managerPrincipal: TaskPrincipal;

async function seedDeveloper(accountId: string, displayName: string) {
  await db.insert(developers).values({ workspaceId: "default", accountId, displayName, email: null, avatarUrl: null, source: "jira", jiraAccountId: accountId, isActive: 1 });
}

beforeEach(async () => {
  await resetDatabase();
  await seedDeveloper("dev-1", "Alice One");
  await seedDeveloper("dev-2", "Bob Two");
  const manager = await auth.createUser({ username: "manager-a", displayName: "A", password: "secret123", role: "manager" });
  managerPrincipal = { type: "manager", accountId: manager.accountId, workspaceId: "default" };
  await auth.createUser({ username: "alice", displayName: "Alice", password: "secret123", role: "developer", developerAccountId: "dev-1" });
  await auth.createUser({ username: "bob", displayName: "Bob", password: "secret123", role: "developer", developerAccountId: "dev-2" });
  await db.insert(configTable).values([
    { key: "tasks_phase1_enabled", value: "true" },
    { key: "tasks_phase2_stage", value: "2c" },
    { key: "tasks_phase3_enabled", value: "true" },
    { key: "one_on_one_enabled", value: "true" },
  ]);
});

async function managerCall(method: string, url: string, body?: unknown) {
  return invoke(app, { method, url, body, headers: { cookie: await cookie("manager-a") } });
}

async function developerCall(user: string, method: string, url: string, body?: unknown) {
  return invoke(app, { method, url, body, headers: { cookie: await cookie(user) } });
}

async function startSeries(developerAccountId = "dev-1") {
  const created = await managerCall("POST", "/api/one-on-ones", { developerAccountId, cadence: "weekly" });
  expect(created.status).toBe(201);
  return { seriesId: created.body.series.id as number, sessionId: created.body.upcoming.id as number };
}

async function addTopic(seriesId: number, title: string) {
  const res = await managerCall("POST", `/api/one-on-ones/${seriesId}/agenda`, { title });
  expect(res.status).toBe(201);
  return res.body.item.task as { taskKey: string; taskId: number; ownerType: string; ownerId: string };
}

/** Everything a developer principal can read about a task key. Nothing should resolve. */
async function expectHiddenFromDeveloper(user: string, taskKey: string, title: string) {
  for (const url of [
    `/api/my-day/tasks/${taskKey}`,
    `/api/my-day/tasks/${taskKey}/detail`,
    `/api/my-day/tasks/${taskKey}/events`,
  ]) {
    expect((await developerCall(user, "GET", url)).status, url).toBe(404);
  }
  expect((await developerCall(user, "PATCH", `/api/my-day/tasks/${taskKey}`, { date: today, status: "done" })).status).toBe(404);
  expect(
    (await developerCall(user, "POST", `/api/my-day/tasks/${taskKey}/events`, { date: today, type: "update", body: "hi", requestId: randomUUID() })).status,
  ).toBe(404);

  const day = await developerCall(user, "GET", `/api/my-day?date=${today}`);
  expect(day.status).toBe(200);
  expect(day.body.plannedItems).toEqual([]);
  expect(day.body.currentItem ?? null).toBeNull();
  const list = await developerCall(user, "GET", `/api/my-day/tasks?date=${today}`);
  expect(list.status).toBe(200);
  expect(list.body.tasks).toEqual([]);
  // Belt and braces: the title appears nowhere in either payload.
  expect(JSON.stringify(day.body)).not.toContain(title);
  expect(JSON.stringify(list.body)).not.toContain(title);
}

describe("P0-S5: agenda topics are private to the manager", () => {
  it("creates a topic as a manager-owned task linked to the developer", async () => {
    const { seriesId } = await startSeries();
    const topic = await addTopic(seriesId, "Performance concerns");
    expect(topic.ownerType).toBe("manager");
    expect(topic.ownerId).toBe(managerPrincipal.accountId);

    const row = (await db.select().from(tasks).where(eq(tasks.id, topic.taskId)))[0]!;
    expect(row.trackedByManagerId).toBe(managerPrincipal.accountId);
    // Undated: a topic is not a Today commitment, and it has no developer plan row.
    expect(row.scheduledOn).toBeNull();
    expect(await db.select().from(dayFocus).where(eq(dayFocus.taskId, row.id))).toEqual([]);
    const links = await db.select().from(taskLinks).where(eq(taskLinks.taskId, row.id));
    expect(links.map((link) => [link.kind, link.ref])).toEqual([["person", "dev-1"]]);
  });

  it("is invisible to the developer on every My Day read and write route", async () => {
    const { seriesId } = await startSeries();
    const topic = await addTopic(seriesId, "Performance concerns");
    await expectHiddenFromDeveloper("alice", topic.taskKey, "Performance concerns");
    // Another developer cannot see it either.
    await expectHiddenFromDeveloper("bob", topic.taskKey, "Performance concerns");
  });

  it("does not appear in developer load, up next or attention signals", async () => {
    const { seriesId } = await startSeries();
    const workload = new WorkloadService();
    const control = await taskService.create({ title: "Real work", ownerType: "developer", ownerId: "dev-2" }, managerPrincipal);
    expect(control.ownerId).toBe("dev-2");

    await addTopic(seriesId, "Performance concerns");
    await addTopic(seriesId, "Career growth");

    const team = await workload.getTeamWorkload(today, "default");
    const alice = team.find((entry) => entry.developer.accountId === "dev-1")!;
    expect(alice.plannedCount).toBe(0);
    expect(alice.currentCount).toBe(0);
    expect(alice.assignedTodayCount).toBe(0);
    expect(alice.signals.noCurrentItem).toBe(false);
    expect(alice.signals.idle).toBe(true);
    // The control proves the counters do count real developer-owned work.
    const bob = team.find((entry) => entry.developer.accountId === "dev-2")!;
    expect(bob.plannedCount).toBe(1);

    const board = await new TeamTrackerService().getBoard(today, { workspaceId: "default" });
    const aliceDay = board.developers.find((entry) => entry.developer.accountId === "dev-1")!;
    expect(aliceDay.plannedItems).toEqual([]);
    expect(aliceDay.currentItem ?? null).toBeNull();
  });

  it("stays fully visible to the manager through /api/one-on-ones", async () => {
    const { seriesId } = await startSeries();
    await addTopic(seriesId, "Performance concerns");
    const agenda = await managerCall("GET", `/api/one-on-ones/${seriesId}/agenda`);
    expect(agenda.body.items.map((item: { task: { title: string; status: string } }) => item.task.title)).toEqual(["Performance concerns"]);
    const detail = await managerCall("GET", `/api/one-on-ones/${seriesId}`);
    expect(detail.body.agenda).toHaveLength(1);
    const list = await managerCall("GET", "/api/one-on-ones");
    expect(list.body.series[0].openAgendaCount).toBe(1);
  });

  it("keeps attaching an existing developer task working (it was already the developer's)", async () => {
    const { seriesId } = await startSeries();
    const owned = await taskService.create({ title: "Real work", ownerType: "developer", ownerId: "dev-1" }, managerPrincipal);
    const res = await managerCall("POST", `/api/one-on-ones/${seriesId}/agenda`, { taskKey: owned.taskKey });
    expect(res.status).toBe(201);
    const row = (await db.select().from(tasks).where(eq(tasks.id, owned.id)))[0]!;
    expect(row.ownerType).toBe("developer");
    expect((await developerCall("alice", "GET", `/api/my-day/tasks/${owned.taskKey}`)).status).toBe(200);
  });
});

describe("P0-S5: session actions default to private, developer assignment is explicit", () => {
  it("defaults an action to manager-owned and hides it from the developer", async () => {
    const { seriesId, sessionId } = await startSeries();
    const res = await managerCall("POST", `/api/one-on-ones/${seriesId}/sessions/${sessionId}/actions`, { title: "Discuss promotion timeline" });
    expect(res.status).toBe(201);
    expect(res.body.item.task.ownerType).toBe("manager");
    expect(res.body.item.task.ownerId).toBe(managerPrincipal.accountId);
    await expectHiddenFromDeveloper("alice", res.body.item.task.taskKey, "Discuss promotion timeline");

    const alice = (await new WorkloadService().getTeamWorkload(today, "default")).find((entry) => entry.developer.accountId === "dev-1")!;
    expect(alice.assignedTodayCount).toBe(0);
    const agenda = await managerCall("GET", `/api/one-on-ones/${seriesId}/agenda`);
    expect(agenda.body.items).toHaveLength(1);
  });

  it("makes an action developer-visible only when the manager explicitly assigns it", async () => {
    const { seriesId, sessionId } = await startSeries();
    const res = await managerCall("POST", `/api/one-on-ones/${seriesId}/sessions/${sessionId}/actions`, { title: "Write the RFC", ownerType: "developer" });
    expect(res.status).toBe(201);
    expect(res.body.item.task.ownerType).toBe("developer");
    expect(res.body.item.task.ownerId).toBe("dev-1");
    expect((await developerCall("alice", "GET", `/api/my-day/tasks/${res.body.item.task.taskKey}`)).status).toBe(200);
    expect((await developerCall("bob", "GET", `/api/my-day/tasks/${res.body.item.task.taskKey}`)).status).toBe(404);
    const alice = (await new WorkloadService().getTeamWorkload(today, "default")).find((entry) => entry.developer.accountId === "dev-1")!;
    expect(alice.plannedCount).toBe(1);
  });

  it("refuses to assign a 1:1 action to a developer other than the series developer", async () => {
    const { seriesId, sessionId } = await startSeries();
    const res = await managerCall("POST", `/api/one-on-ones/${seriesId}/sessions/${sessionId}/actions`, { title: "Leaky", ownerType: "developer", ownerId: "dev-2" });
    expect(res.status).toBe(400);
    expect(await db.select().from(oneOnOneAgendaItems).where(eq(oneOnOneAgendaItems.seriesId, seriesId))).toEqual([]);
  });
});

describe("P0-S5: cleanup of rows created before the fix", () => {
  /** What the pre-fix code did: a developer-owned task created with source one_on_one. */
  async function legacyTopic(seriesId: number, title: string, status: "open" | "done" = "open") {
    const task = await taskService.create({ title, ownerType: "developer", ownerId: "dev-1", status }, managerPrincipal, { source: "one_on_one" });
    await db.insert(oneOnOneAgendaItems).values({ workspaceId: "default", seriesId, taskId: task.id, position: 0, addedAt: new Date().toISOString() });
    return task;
  }

  it("leaks before cleanup, then hides only the picked candidates", async () => {
    const { seriesId } = await startSeries();
    const topic = await legacyTopic(seriesId, "Legacy performance topic");
    const other = await legacyTopic(seriesId, "Legacy action, assigned on purpose");
    const engaged = await legacyTopic(seriesId, "Developer already replied here");
    await events.append({ taskKey: engaged.taskKey, type: "update", body: "on it", meta: { via: "my_day" } }, { type: "developer", accountId: "dev-1" });
    const closed = await legacyTopic(seriesId, "Already done", "done");
    const ordinary = await taskService.create({ title: "Ordinary developer work", ownerType: "developer", ownerId: "dev-1" }, managerPrincipal);
    await db.insert(oneOnOneAgendaItems).values({ workspaceId: "default", seriesId, taskId: ordinary.id, position: 9, addedAt: new Date().toISOString() });

    // The bug: the developer sees the legacy topic.
    expect((await developerCall("alice", "GET", `/api/my-day/tasks/${topic.taskKey}`)).status).toBe(200);

    const candidates = await cleanup.listCandidates("default");
    expect(candidates.map((entry) => entry.taskKey)).toEqual([topic.taskKey, other.taskKey]);
    expect(candidates).not.toContainEqual(expect.objectContaining({ taskKey: engaged.taskKey }));
    expect(candidates).not.toContainEqual(expect.objectContaining({ taskKey: closed.taskKey }));
    expect(candidates).not.toContainEqual(expect.objectContaining({ taskKey: ordinary.taskKey }));
    // Listing is read-only.
    expect((await taskService.getByKey(topic.taskKey))!.ownerType).toBe("developer");

    const result = await cleanup.moveToManager([topic.taskKey.toLowerCase(), engaged.taskKey, ordinary.taskKey, "T-99999"]);
    expect(result.moved).toEqual([topic.taskKey]);
    expect(result.skipped.map((entry) => entry.taskKey).sort()).toEqual([engaged.taskKey, ordinary.taskKey, "T-99999"].sort());

    const moved = (await taskService.getByKey(topic.taskKey))!;
    expect(moved.ownerType).toBe("manager");
    expect(moved.ownerId).toBe(managerPrincipal.accountId);
    expect(await db.select().from(dayFocus).where(and(eq(dayFocus.taskId, moved.id), eq(dayFocus.ownerType, "developer")))).toEqual([]);
    expect((await db.select().from(taskLinks).where(eq(taskLinks.taskId, moved.id))).map((link) => link.ref)).toEqual(["dev-1"]);

    // Picked topic is gone from the developer; the un-picked ones are untouched.
    for (const url of [`/api/my-day/tasks/${topic.taskKey}`, `/api/my-day/tasks/${topic.taskKey}/events`, `/api/my-day/tasks/${topic.taskKey}/detail`]) {
      expect((await developerCall("alice", "GET", url)).status, url).toBe(404);
    }
    const day = await developerCall("alice", "GET", `/api/my-day?date=${today}`);
    expect(JSON.stringify(day.body)).not.toContain("Legacy performance topic");
    expect((await taskService.getByKey(other.taskKey))!.ownerType).toBe("developer");
    expect((await taskService.getByKey(engaged.taskKey))!.ownerType).toBe("developer");

    // The manager still has it on the agenda; a second run is a no-op.
    const agenda = await managerCall("GET", `/api/one-on-ones/${seriesId}/agenda`);
    expect(agenda.body.items.map((item: { task: { taskKey: string } }) => item.task.taskKey)).toContain(topic.taskKey);
    expect((await cleanup.moveToManager([topic.taskKey])).moved).toEqual([]);
    expect((await cleanup.listCandidates("default")).map((entry) => entry.taskKey)).toEqual([other.taskKey]);
  });

  it("ignores series rows for another developer and other workspaces", async () => {
    const { seriesId } = await startSeries();
    const task = await taskService.create({ title: "Belongs to dev-2", ownerType: "developer", ownerId: "dev-2" }, managerPrincipal, { source: "one_on_one" });
    await db.insert(oneOnOneAgendaItems).values({ workspaceId: "default", seriesId, taskId: task.id, position: 0, addedAt: new Date().toISOString() });
    expect(await cleanup.listCandidates("default")).toEqual([]);
    expect(await cleanup.listCandidates("other-workspace")).toEqual([]);
    expect((await db.select().from(oneOnOneSeries)).length).toBe(1);
  });
});
