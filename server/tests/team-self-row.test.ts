import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import express from "express";
import { configTable, developers, oneOnOneAgendaItems, oneOnOneSeries, oneOnOneSessions, tasks } from "../src/db/schema";
import { createTeamTrackerRouter } from "../src/routes/team-tracker";
import { ManagerDeskService } from "../src/services/manager-desk.service";
import { invoke } from "./helpers/http";
import { SelfIdentityService } from "../src/services/self-identity.service";
import { TaskService, type TaskPrincipal } from "../src/services/task.service";
import { TeamTrackerService } from "../src/services/team-tracker.service";
import { db, resetDatabase } from "./helpers/db";
import { enableCollabParticipation } from "./helpers/team-mode";
import { pinAttentionTimeZone } from "./helpers/attention";

const trackerService = new TeamTrackerService();
const taskService = new TaskService();
const self = new SelfIdentityService();

const DATE = "2026-03-07";
const ayan: TaskPrincipal = { type: "manager", accountId: "ayan", workspaceId: "default" };

async function boardFor(managerAccountId = "ayan") {
  return trackerService.getBoard(DATE, { managerAccountId, timeZone: "UTC" });
}

function row(board: Awaited<ReturnType<typeof boardFor>>, accountId: string) {
  return board.developers.find((entry) => entry.developer.accountId === accountId)!;
}

describe("the manager's own row on the Team board", () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-07T08:00:00.000Z"));
    await resetDatabase();
    await pinAttentionTimeZone();
    await db.insert(configTable).values([
      { key: "tasks_phase1_enabled", value: "true" },
      { key: "tasks_phase2_stage", value: "2c" },
      { key: "tasks_phase2_id_seed", value: "0" },
    ]);
    await db.insert(developers).values([
      { accountId: "dev-ayan", displayName: "Ayan Saha", isActive: 1 },
      { accountId: "dev-priya", displayName: "Priya", isActive: 1 },
    ]);
  });

  afterEach(() => vi.useRealTimers());

  it("lists the tasks assigned to me next to my roster work, only once linked", async () => {
    await taskService.create({ title: "MS java upgrade" }, ayan);
    await taskService.create({ title: "Liberty 21 upgrade" }, ayan);
    await taskService.create({ title: "Roster work", ownerType: "developer", ownerId: "dev-ayan", scheduledOn: DATE }, ayan);

    expect(row(await boardFor(), "dev-ayan").plannedItems.map((item) => item.title)).toEqual(["Roster work"]);

    await self.set("ayan", "dev-ayan", "default");
    const mine = row(await boardFor(), "dev-ayan");
    expect(mine.developer.isSelf).toBe(true);
    expect(mine.plannedItems.map((item) => item.title).sort()).toEqual(["Liberty 21 upgrade", "MS java upgrade", "Roster work"]);
    expect(mine.tasks?.map((task) => task.title)).toContain("MS java upgrade");
    // Other people's rows are untouched.
    expect(row(await boardFor(), "dev-priya").developer.isSelf).toBeUndefined();
    expect(row(await boardFor(), "dev-priya").plannedItems).toEqual([]);
  });

  it("keeps my private tasks off every other manager's board", async () => {
    await taskService.create({ title: "Private plan" }, ayan);
    await self.set("ayan", "dev-ayan", "default");
    // Another manager looking at the same roster sees Ayan as an ordinary teammate.
    const other = row(await boardFor("other-manager"), "dev-ayan");
    expect(other.developer.isSelf).toBeUndefined();
    expect(other.plannedItems).toEqual([]);
  });

  it("leaves parked, waiting, meeting, 1:1 and other-person tasks off my row", async () => {
    await taskService.create({ title: "Plain task" }, ayan);
    const parked = await taskService.create({ title: "Parked" }, ayan);
    await taskService.update(parked.taskKey, { later: true, hideUntil: "2026-04-01" } as never, ayan);
    await taskService.create({ title: "Waiting on vendor", waitingOn: { type: "text", label: "Vendor" } } as never, ayan);
    await taskService.create({ title: "Weekly sync", kind: "meeting" } as never, ayan);
    const topic = await taskService.create({ title: "1:1 topic for Priya" }, ayan);
    const series = (await db.insert(oneOnOneSeries).values({ workspaceId: "default", developerAccountId: "dev-priya", cadence: "weekly", createdAt: "2026-03-01T00:00:00Z" }).returning())[0]!;
    await db.insert(oneOnOneAgendaItems).values({ workspaceId: "default", seriesId: series.id, taskId: (await taskService.getByKey(topic.taskKey))!.id, position: 0, addedAt: "2026-03-01T00:00:00Z" });
    const aboutPriya = await taskService.create({ title: "Perf review for Priya" }, ayan);
    await taskService.addLink(aboutPriya.taskKey, { kind: "person", ref: "dev-priya" }, ayan);
    const aboutMe = await taskService.create({ title: "My own goals" }, ayan);
    await taskService.addLink(aboutMe.taskKey, { kind: "person", ref: "dev-ayan" }, ayan);

    await self.set("ayan", "dev-ayan", "default");
    expect(row(await boardFor(), "dev-ayan").plannedItems.map((item) => item.title).sort()).toEqual(["My own goals", "Plain task"]);
  });

  it("shows what I finished today", async () => {
    const done = await taskService.create({ title: "Shipped it" }, ayan);
    await taskService.update(done.taskKey, { status: "done" }, ayan);
    await self.set("ayan", "dev-ayan", "default");
    expect(row(await boardFor(), "dev-ayan").completedItems.map((item) => item.title)).toEqual(["Shipped it"]);
  });

  it("does not chase me: no stale, untouched or no-current flags, even when collaborating", async () => {
    await enableCollabParticipation(["dev-ayan", "dev-priya"]);
    vi.setSystemTime(new Date("2026-03-07T17:00:00.000Z"));
    await self.set("ayan", "dev-ayan", "default");
    const board = await boardFor();
    const mine = row(board, "dev-ayan");
    expect(mine.participates).toBe(false);
    expect(mine.isStale).toBe(false);
    expect(mine.signals.freshness).toMatchObject({ staleByTime: false, staleWithOpenRisk: false, staleWithoutCurrentWork: false, statusChangeWithoutFollowUp: false, noCurrentTracked: false });
    expect(board.attentionQueue.map((item) => item.developer.accountId)).not.toContain("dev-ayan");
    // A teammate on the check-in clock still shows as quiet.
    expect(row(board, "dev-priya").participates).toBe(true);
  });

  it("does not touch past days", async () => {
    await taskService.create({ title: "Private plan" }, ayan);
    await self.set("ayan", "dev-ayan", "default");
    const past = await trackerService.getBoard("2026-03-05", { managerAccountId: "ayan", timeZone: "UTC" });
    expect(past.viewMode).toBe("history");
    expect(row(past, "dev-ayan").plannedItems).toEqual([]);
    expect(row(past, "dev-ayan").developer.isSelf).toBeUndefined();
  });

  it("lets me change my own task from the board row", async () => {
    const created = await taskService.create({ title: "Do the thing" }, ayan);
    await self.set("ayan", "dev-ayan", "default");
    const item = row(await boardFor(), "dev-ayan").plannedItems[0]!;
    const updated = await trackerService.updateItem(item.id, { state: "in_progress" }, "default", { type: "manager", accountId: "ayan" });
    expect(updated.state).toBe("in_progress");
    expect((await db.select().from(tasks).where(eq(tasks.taskKey, created.taskKey)))[0]!.status).toBe("active");
    expect(row(await boardFor(), "dev-ayan").currentItem?.title).toBe("Do the thing");
  });

  it("never shows a 1:1 as due with myself, but still shows one for a teammate", async () => {
    await db.insert(configTable).values({ key: "one_on_one_enabled", value: "true" });
    for (const developerAccountId of ["dev-ayan", "dev-priya"]) {
      const series = (await db.insert(oneOnOneSeries).values({ workspaceId: "default", developerAccountId, cadence: "weekly", createdAt: "2026-03-01T00:00:00Z" }).returning())[0]!;
      await db.insert(oneOnOneSessions).values({ workspaceId: "default", seriesId: series.id, scheduledFor: "2026-03-05", status: "scheduled", createdAt: "2026-03-01T00:00:00Z" });
    }
    await self.set("ayan", "dev-ayan", "default");
    const app = express();
    app.use((req, _res, next) => {
      req.auth = { sessionId: "s", user: { username: "ayan", accountId: "ayan", workspaceId: "default", displayName: "Ayan", role: "manager" } };
      next();
    });
    app.use("/api/team-tracker", createTeamTrackerRouter(trackerService, new ManagerDeskService(trackerService)));
    const response = await invoke(app, { method: "GET", url: `/api/team-tracker?date=${DATE}&tz=UTC` });
    expect(response.status).toBe(200);
    const byId = new Map<string, { oneOnOne?: unknown }>(response.body.developers.map((entry: { developer: { accountId: string }; oneOnOne?: unknown }) => [entry.developer.accountId, entry]));
    expect(byId.get("dev-ayan")?.oneOnOne).toBeUndefined();
    expect(byId.get("dev-priya")?.oneOnOne).toBeDefined();
  });
});
