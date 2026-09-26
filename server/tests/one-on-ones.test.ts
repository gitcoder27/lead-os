import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import { eq } from "drizzle-orm";
import { db, resetDatabase } from "./helpers/db";
import { invoke } from "./helpers/http";
import { configTable, developers, oneOnOneAgendaItems, tasks, workspaces } from "../src/db/schema";
import { errorHandler, notFoundHandler } from "../src/middleware/errorHandler";
import { requireManager } from "../src/middleware/auth";
import { createOneOnOnesRouter } from "../src/routes/one-on-ones";
import { createAuthRouter } from "../src/routes/auth";
import { AuthService, serializeSessionCookie } from "../src/services/auth.service";
import { OneOnOneService, addDaysIso, nextSessionDate } from "../src/services/one-on-one.service";
import { TaskService, type TaskPrincipal } from "../src/services/task.service";
import { todayIsoDate } from "../src/utils/date";

const auth = new AuthService();
const service = new OneOnOneService();
const taskService = new TaskService();
const app = express();
app.use("/api/one-on-ones", requireManager(auth), createOneOnOnesRouter(service));
app.use("/api/auth", createAuthRouter(auth));
app.use(notFoundHandler);
app.use(errorHandler);

const manager: TaskPrincipal = { type: "manager", accountId: "manager-1", workspaceId: "default" };

async function cookie(name: string): Promise<string> {
  const { sessionId } = await auth.authenticate(name, "secret123");
  return serializeSessionCookie(sessionId, auth.sessionMaxAgeSeconds);
}

async function enableFlag(workspaceId = "default") {
  await db
    .insert(configTable)
    .values({ workspaceId, key: "one_on_one_enabled", value: "true" });
}

async function seedDeveloper(accountId: string, displayName: string, workspaceId = "default") {
  await db.insert(developers).values({
    workspaceId,
    accountId,
    displayName,
    email: null,
    avatarUrl: null,
    source: "jira",
    jiraAccountId: accountId,
    isActive: 1,
  });
}

beforeEach(async () => {
  await resetDatabase();
  await seedDeveloper("dev-1", "Dev One");
  await seedDeveloper("dev-2", "Dev Two");
  await seedDeveloper("dev-3", "Dev Three");
  await auth.createUser({ username: "manager-a", displayName: "A", password: "secret123", role: "manager" });
  await auth.createUser({
    username: "dev-user",
    displayName: "Dev",
    password: "secret123",
    role: "developer",
    developerAccountId: "dev-1",
  });
  // Canonical tasks (phase 1) are the agenda backing store — same seed as the
  // task-labels suite.
  await db.insert(configTable).values({ key: "tasks_phase1_enabled", value: "true" });
  await enableFlag();
});

async function createSeries(developerAccountId = "dev-1", cadence = "weekly", extra: Record<string, unknown> = {}) {
  const headers = { cookie: await cookie("manager-a") };
  return invoke(app, {
    method: "POST",
    url: "/api/one-on-ones",
    headers,
    body: { developerAccountId, cadence, ...extra },
  });
}

describe("one-on-one routes: gating", () => {
  it("404s every endpoint while the flag is off", async () => {
    await db.delete(configTable).where(eq(configTable.key, "one_on_one_enabled"));
    const headers = { cookie: await cookie("manager-a") };
    expect((await invoke(app, { method: "GET", url: "/api/one-on-ones", headers })).status).toBe(404);
    expect(
      (await invoke(app, { method: "POST", url: "/api/one-on-ones", headers, body: { developerAccountId: "dev-1", cadence: "weekly" } })).status,
    ).toBe(404);
    expect((await invoke(app, { method: "GET", url: "/api/one-on-ones/1", headers })).status).toBe(404);
    expect((await invoke(app, { method: "PATCH", url: "/api/one-on-ones/1", headers, body: {} })).status).toBe(404);
    expect((await invoke(app, { method: "POST", url: "/api/one-on-ones/1/sessions", headers, body: {} })).status).toBe(404);
    expect((await invoke(app, { method: "PATCH", url: "/api/one-on-ones/1/sessions/1", headers, body: {} })).status).toBe(404);
    expect((await invoke(app, { method: "GET", url: "/api/one-on-ones/1/agenda", headers })).status).toBe(404);
    expect((await invoke(app, { method: "POST", url: "/api/one-on-ones/1/agenda", headers, body: { title: "x" } })).status).toBe(404);
    expect((await invoke(app, { method: "PATCH", url: "/api/one-on-ones/1/agenda", headers, body: { itemIds: [1] } })).status).toBe(404);
    expect((await invoke(app, { method: "DELETE", url: "/api/one-on-ones/1/agenda/1", headers })).status).toBe(404);
    expect((await invoke(app, { method: "POST", url: "/api/one-on-ones/1/sessions/1/actions", headers, body: { title: "x" } })).status).toBe(404);
  });

  it("403s for developer principals even with the flag on", async () => {
    const headers = { cookie: await cookie("dev-user") };
    expect((await invoke(app, { method: "GET", url: "/api/one-on-ones", headers })).status).toBe(403);
    expect(
      (await invoke(app, { method: "POST", url: "/api/one-on-ones", headers, body: { developerAccountId: "dev-1", cadence: "weekly" } })).status,
    ).toBe(403);
    expect((await invoke(app, { method: "GET", url: "/api/one-on-ones/1/agenda", headers })).status).toBe(403);
  });

  it("401s without a session", async () => {
    expect((await invoke(app, { method: "GET", url: "/api/one-on-ones" })).status).toBe(401);
  });
});

describe("one-on-one routes: series CRUD", () => {
  it("creates, lists, reads and updates a series", async () => {
    const headers = { cookie: await cookie("manager-a") };
    const created = await createSeries();
    expect(created.status).toBe(201);
    expect(created.body.series.developerAccountId).toBe("dev-1");
    expect(created.body.series.developerName).toBe("Dev One");
    expect(created.body.series.cadence).toBe("weekly");
    expect(created.body.series.active).toBe(true);
    const seriesId = created.body.series.id;

    // Weekly series lazily materializes the first session on read.
    expect(created.body.upcoming.status).toBe("scheduled");
    expect(created.body.upcoming.scheduledFor).toBe(todayIsoDate());

    const listed = await invoke(app, { method: "GET", url: "/api/one-on-ones", headers });
    expect(listed.body.series).toHaveLength(1);
    expect(listed.body.series[0].nextSessionDate).toBe(todayIsoDate());

    const detail = await invoke(app, { method: "GET", url: `/api/one-on-ones/${seriesId}`, headers });
    expect(detail.status).toBe(200);
    expect(detail.body.agenda).toEqual([]);

    const updated = await invoke(app, {
      method: "PATCH",
      url: `/api/one-on-ones/${seriesId}`,
      headers,
      body: { cadence: "biweekly", preferredWeekday: 3 },
    });
    expect(updated.body.series.cadence).toBe("biweekly");
    expect(updated.body.series.preferredWeekday).toBe(3);
  });

  it("enforces one series per developer and validates the developer", async () => {
    expect((await createSeries()).status).toBe(201);
    expect((await createSeries()).status).toBe(409);
    expect((await createSeries("nobody")).status).toBe(404);
    expect((await createSeries("dev-1", "fortnightly" as string)).status).toBe(400);
  });

  it("stops scheduling when the series is deactivated", async () => {
    const headers = { cookie: await cookie("manager-a") };
    const created = await createSeries();
    const seriesId = created.body.series.id;
    const sessionId = created.body.upcoming.id;
    const updated = await invoke(app, {
      method: "PATCH",
      url: `/api/one-on-ones/${seriesId}`,
      headers,
      body: { active: false },
    });
    expect(updated.body.series.active).toBe(false);
    await invoke(app, { method: "PATCH", url: `/api/one-on-ones/${seriesId}/sessions/${sessionId}`, headers, body: { status: "done" } });
    const detail = await invoke(app, { method: "GET", url: `/api/one-on-ones/${seriesId}`, headers });
    expect(detail.body.upcoming).toBeNull();
  });
});

describe("one-on-one routes: sessions", () => {
  it("ad_hoc series schedules nothing automatically; manual create + conflict", async () => {
    const headers = { cookie: await cookie("manager-a") };
    const created = await createSeries("dev-1", "ad_hoc");
    expect(created.body.upcoming).toBeNull();
    const seriesId = created.body.series.id;

    const session = await invoke(app, { method: "POST", url: `/api/one-on-ones/${seriesId}/sessions`, headers, body: { scheduledFor: "2030-05-04" } });
    expect(session.status).toBe(201);
    expect(session.body.upcoming.scheduledFor).toBe("2030-05-04");

    // A second scheduled session conflicts.
    expect((await invoke(app, { method: "POST", url: `/api/one-on-ones/${seriesId}/sessions`, headers, body: {} })).status).toBe(409);
  });

  it("saves notes, starts, reschedules, completes and skips sessions", async () => {
    const headers = { cookie: await cookie("manager-a") };
    const created = await createSeries();
    const seriesId = created.body.series.id;
    const sessionId = created.body.upcoming.id;

    const noted = await invoke(app, {
      method: "PATCH",
      url: `/api/one-on-ones/${seriesId}/sessions/${sessionId}`,
      headers,
      body: { notes: "Discussed onboarding", scheduledFor: "2030-01-15" },
    });
    expect(noted.body.upcoming.notes).toBe("Discussed onboarding");
    expect(noted.body.upcoming.scheduledFor).toBe("2030-01-15");

    const started = await invoke(app, {
      method: "PATCH",
      url: `/api/one-on-ones/${seriesId}/sessions/${sessionId}`,
      headers,
      body: { started: true },
    });
    expect(started.body.upcoming.startedAt).not.toBeNull();

    const done = await invoke(app, {
      method: "PATCH",
      url: `/api/one-on-ones/${seriesId}/sessions/${sessionId}`,
      headers,
      body: { status: "done" },
    });
    const closed = done.body.sessions.find((row: { id: number }) => row.id === sessionId);
    expect(closed.status).toBe("done");
    expect(closed.completedAt).not.toBeNull();
    // Cadence schedules the next session from the rescheduled date.
    expect(done.body.upcoming.id).not.toBe(sessionId);
    expect(done.body.upcoming.scheduledFor).toBe("2030-01-22");

    // Closing the new one as skipped also auto-schedules.
    const skipped = await invoke(app, {
      method: "PATCH",
      url: `/api/one-on-ones/${seriesId}/sessions/${done.body.upcoming.id}`,
      headers,
      body: { status: "skipped" },
    });
    expect(skipped.body.sessions.find((row: { id: number }) => row.id === done.body.upcoming.id).status).toBe("skipped");
    expect(skipped.body.upcoming.scheduledFor).toBe("2030-01-29");
  });

  it("rejects status changes on closed sessions and re-closing", async () => {
    const headers = { cookie: await cookie("manager-a") };
    const created = await createSeries();
    const { id: seriesId } = created.body.series;
    const sessionId = created.body.upcoming.id;
    await invoke(app, { method: "PATCH", url: `/api/one-on-ones/${seriesId}/sessions/${sessionId}`, headers, body: { status: "done" } });
    expect(
      (await invoke(app, { method: "PATCH", url: `/api/one-on-ones/${seriesId}/sessions/${sessionId}`, headers, body: { status: "skipped" } })).status,
    ).toBe(409);
    expect(
      (await invoke(app, { method: "PATCH", url: `/api/one-on-ones/${seriesId}/sessions/${sessionId}`, headers, body: { started: true } })).status,
    ).toBe(409);
  });
});

describe("one-on-one routes: agenda", () => {
  it("attaches existing tasks by id and key, freeform titles create tasks", async () => {
    const headers = { cookie: await cookie("manager-a") };
    const created = await createSeries();
    const seriesId = created.body.series.id;
    const task = await taskService.create({ title: "Existing" }, manager);
    const owned = await taskService.create({ title: "Owned", ownerType: "developer", ownerId: "dev-2" }, manager);

    const byId = await invoke(app, { method: "POST", url: `/api/one-on-ones/${seriesId}/agenda`, headers, body: { taskId: task.id } });
    expect(byId.status).toBe(201);
    expect(byId.body.item.task.taskKey).toBe(task.taskKey);
    expect(byId.body.item.carriedFrom).toBeNull();

    const byKey = await invoke(app, { method: "POST", url: `/api/one-on-ones/${seriesId}/agenda`, headers, body: { taskKey: owned.taskKey } });
    expect(byKey.status).toBe(201);

    const freeform = await invoke(app, { method: "POST", url: `/api/one-on-ones/${seriesId}/agenda`, headers, body: { title: "Talk about growth" } });
    expect(freeform.status).toBe(201);
    expect(freeform.body.item.task.title).toBe("Talk about growth");
    // OO-D8: freeform capture defaults the task owner to the series developer.
    expect(freeform.body.item.task.ownerType).toBe("developer");
    expect(freeform.body.item.task.ownerId).toBe("dev-1");

    const agenda = await invoke(app, { method: "GET", url: `/api/one-on-ones/${seriesId}/agenda`, headers });
    expect(agenda.body.items.map((item: { task: { title: string } }) => item.task.title)).toEqual(["Existing", "Owned", "Talk about growth"]);

    // Duplicate attach is a conflict.
    expect((await invoke(app, { method: "POST", url: `/api/one-on-ones/${seriesId}/agenda`, headers, body: { taskId: task.id } })).status).toBe(409);
    expect((await invoke(app, { method: "POST", url: `/api/one-on-ones/${seriesId}/agenda`, headers, body: { taskKey: "T-999" } })).status).toBe(404);
  });

  it("reorders and detaches agenda items", async () => {
    const headers = { cookie: await cookie("manager-a") };
    const created = await createSeries();
    const seriesId = created.body.series.id;
    const ids: number[] = [];
    for (const title of ["A", "B", "C"]) {
      const res = await invoke(app, { method: "POST", url: `/api/one-on-ones/${seriesId}/agenda`, headers, body: { title } });
      ids.push(res.body.item.id);
    }

    const reordered = await invoke(app, {
      method: "PATCH",
      url: `/api/one-on-ones/${seriesId}/agenda`,
      headers,
      body: { itemIds: [ids[2], ids[0], ids[1]] },
    });
    expect(reordered.status).toBe(200);
    expect(reordered.body.items.map((item: { task: { title: string } }) => item.task.title)).toEqual(["C", "A", "B"]);

    // Non-permutation payloads are rejected.
    expect((await invoke(app, { method: "PATCH", url: `/api/one-on-ones/${seriesId}/agenda`, headers, body: { itemIds: [ids[0]] } })).status).toBe(400);
    expect(
      (await invoke(app, { method: "PATCH", url: `/api/one-on-ones/${seriesId}/agenda`, headers, body: { itemIds: [ids[0], ids[1], 99999] } })).status,
    ).toBe(400);

    const detached = await invoke(app, { method: "DELETE", url: `/api/one-on-ones/${seriesId}/agenda/${ids[0]}`, headers });
    expect(detached.status).toBe(200);
    const agenda = await invoke(app, { method: "GET", url: `/api/one-on-ones/${seriesId}/agenda`, headers });
    expect(agenda.body.items.map((item: { id: number }) => item.id)).toEqual([ids[2], ids[1]]);
    expect((await invoke(app, { method: "DELETE", url: `/api/one-on-ones/${seriesId}/agenda/${ids[0]}`, headers })).status).toBe(404);
  });
});

describe("one-on-one routes: carry semantics", () => {
  it("marks open agenda items carried after done and skipped sessions", async () => {
    const headers = { cookie: await cookie("manager-a") };
    const created = await createSeries();
    const seriesId = created.body.series.id;
    const first = created.body.upcoming;

    const attached = await invoke(app, { method: "POST", url: `/api/one-on-ones/${seriesId}/agenda`, headers, body: { title: "Carried topic" } });
    const itemId = attached.body.item.id;

    await invoke(app, { method: "PATCH", url: `/api/one-on-ones/${seriesId}/sessions/${first.id}`, headers, body: { status: "done" } });
    let agenda = await invoke(app, { method: "GET", url: `/api/one-on-ones/${seriesId}/agenda`, headers });
    expect(agenda.body.items.find((item: { id: number }) => item.id === itemId).carriedFrom).toBe(first.scheduledFor);

    // Skipping the next session keeps the carried marker (now from the newer date).
    const detail = await invoke(app, { method: "GET", url: `/api/one-on-ones/${seriesId}`, headers });
    const second = detail.body.upcoming;
    await invoke(app, { method: "PATCH", url: `/api/one-on-ones/${seriesId}/sessions/${second.id}`, headers, body: { status: "skipped" } });
    agenda = await invoke(app, { method: "GET", url: `/api/one-on-ones/${seriesId}/agenda`, headers });
    expect(agenda.body.items.find((item: { id: number }) => item.id === itemId).carriedFrom).toBe(second.scheduledFor);
  });

  it("closed tasks stay linked but stop counting as open agenda", async () => {
    const headers = { cookie: await cookie("manager-a") };
    const created = await createSeries();
    const seriesId = created.body.series.id;
    const task = await taskService.create({ title: "Will close" }, manager);
    await invoke(app, { method: "POST", url: `/api/one-on-ones/${seriesId}/agenda`, headers, body: { taskId: task.id } });
    await taskService.update(task.taskKey, { status: "done" }, manager);

    const detail = await invoke(app, { method: "GET", url: `/api/one-on-ones/${seriesId}`, headers });
    expect(detail.body.agenda).toHaveLength(1);
    expect(detail.body.agenda[0].task.status).toBe("done");
    expect(detail.body.series.openAgendaCount).toBe(0);
  });

  it("reopenCarried=false detaches open items on completion", async () => {
    const headers = { cookie: await cookie("manager-a") };
    const created = await createSeries();
    const seriesId = created.body.series.id;
    await invoke(app, { method: "POST", url: `/api/one-on-ones/${seriesId}/agenda`, headers, body: { title: "Open" } });
    const closedTask = await taskService.create({ title: "Closed", status: "done" }, manager);
    await invoke(app, { method: "POST", url: `/api/one-on-ones/${seriesId}/agenda`, headers, body: { taskId: closedTask.id } });

    const done = await invoke(app, {
      method: "PATCH",
      url: `/api/one-on-ones/${seriesId}/sessions/${created.body.upcoming.id}`,
      headers,
      body: { status: "done", reopenCarried: false },
    });
    // Open item detached; the closed-task link stays for history.
    expect(done.body.agenda.map((item: { task: { title: string } }) => item.task.title)).toEqual(["Closed"]);
    const tasks_ = await invoke(app, { method: "GET", url: `/api/one-on-ones/${seriesId}/agenda`, headers });
    expect(tasks_.body.items).toHaveLength(1);
  });
});

describe("one-on-one routes: session action items", () => {
  it("creates a canonical task and attaches it atomically", async () => {
    const headers = { cookie: await cookie("manager-a") };
    const created = await createSeries();
    const seriesId = created.body.series.id;
    const sessionId = created.body.upcoming.id;

    const action = await invoke(app, {
      method: "POST",
      url: `/api/one-on-ones/${seriesId}/sessions/${sessionId}/actions`,
      headers,
      body: { title: "Ship the perf fix", scheduledOn: "2030-02-01" },
    });
    expect(action.status).toBe(201);
    expect(action.body.item.task.title).toBe("Ship the perf fix");
    expect(action.body.item.task.ownerType).toBe("developer");
    expect(action.body.item.task.ownerId).toBe("dev-1");
    expect(action.body.item.task.taskKey).toMatch(/^T-/);

    const agenda = await invoke(app, { method: "GET", url: `/api/one-on-ones/${seriesId}/agenda`, headers });
    expect(agenda.body.items).toHaveLength(1);
  });

  it("rolls the task back when the agenda attach fails", async () => {
    const created = await createSeries();
    const seriesId = created.body.series.id;
    const sessionId = created.body.upcoming.id;
    const before = (await db.select({ id: tasks.id }).from(tasks)).length;

    const spy = vi.spyOn(service as unknown as { attachTask: () => Promise<never> }, "attachTask").mockRejectedValue(new Error("boom"));
    await expect(
      service.createSessionAction(seriesId, sessionId, { title: "Atomic" }, manager, "default"),
    ).rejects.toThrow("boom");
    spy.mockRestore();

    expect((await db.select({ id: tasks.id }).from(tasks)).length).toBe(before);
    expect(
      (await db.select({ id: oneOnOneAgendaItems.id }).from(oneOnOneAgendaItems).where(eq(oneOnOneAgendaItems.seriesId, seriesId))).length,
    ).toBe(0);
  });

  it("rejects action items on closed sessions", async () => {
    const headers = { cookie: await cookie("manager-a") };
    const created = await createSeries();
    const seriesId = created.body.series.id;
    const sessionId = created.body.upcoming.id;
    await invoke(app, { method: "PATCH", url: `/api/one-on-ones/${seriesId}/sessions/${sessionId}`, headers, body: { status: "done" } });
    expect(
      (
        await invoke(app, {
          method: "POST",
          url: `/api/one-on-ones/${seriesId}/sessions/${sessionId}/actions`,
          headers,
          body: { title: "Too late" },
        })
      ).status,
    ).toBe(409);
  });
});

describe("one-on-one service: cadence scheduling", () => {
  it("nextSessionDate advances per cadence and never lands in the past", () => {
    expect(nextSessionDate("ad_hoc", null, null, "2026-01-05")).toBeNull();
    expect(nextSessionDate("weekly", null, null, "2026-01-05")).toBe("2026-01-05");
    expect(nextSessionDate("weekly", null, "2026-01-05", "2026-01-05")).toBe("2026-01-12");
    expect(nextSessionDate("biweekly", null, "2026-01-05", "2026-01-05")).toBe("2026-01-19");
    // Late completions keep the rhythm: step the anchor forward past today.
    expect(nextSessionDate("weekly", null, "2026-01-05", "2026-01-20")).toBe("2026-01-26");
    // Monthly clamps to the target month length.
    expect(nextSessionDate("monthly", null, "2026-01-31", "2026-01-31")).toBe("2026-02-28");
    // Preferred weekday snaps the candidate forward.
    expect(nextSessionDate("weekly", 3, null, "2026-01-05")).toBe("2026-01-07"); // Mon → Wed
    expect(nextSessionDate("weekly", 1, "2026-01-07", "2026-01-07")).toBe("2026-01-19"); // Wed+7=Wed → next Mon
    expect(nextSessionDate("weekly", 3, "2026-01-07", "2026-01-07")).toBe("2026-01-14"); // already Wednesday
  });

  it("lazily schedules the next session on read for weekly/biweekly/monthly", async () => {
    const today = todayIsoDate();
    for (const [cadence, days] of [["weekly", 7], ["biweekly", 14]] as const) {
      const { series, upcoming } = await service.createSeries({ developerAccountId: cadence === "weekly" ? "dev-1" : "dev-2", cadence }, "default");
      expect(upcoming?.scheduledFor).toBe(today);
      await service.updateSession(series.id, upcoming!.id, { status: "done" }, "default", today);
      const detail = await service.getDetail(series.id, "default", today);
      expect(detail.upcoming?.scheduledFor).toBe(addDaysIso(today, days));
    }

    const { series, upcoming } = await service.createSeries({ developerAccountId: "dev-3", cadence: "monthly" }, "default");
    await service.updateSession(series.id, upcoming!.id, { status: "done" }, "default", today);
    const detail = await service.getDetail(series.id, "default", today);
    const [y, m, d] = today.split("-").map(Number);
    const lastDay = new Date(Date.UTC(y!, m! + 1, 0)).getUTCDate();
    expect(detail.upcoming?.scheduledFor).toBe(new Date(Date.UTC(y!, m!, Math.min(d!, lastDay))).toISOString().slice(0, 10));
  });

  it("workspace isolation: series and sessions do not leak across workspaces", async () => {
    const headers = { cookie: await cookie("manager-a") };
    const created = await createSeries();
    const seriesId = created.body.series.id;

    // Same developer account id in another workspace gets its own series.
    const now = new Date().toISOString();
    await db.insert(workspaces).values({ id: "other", name: "Other", createdAt: now, updatedAt: now }).onConflictDoNothing();
    await seedDeveloper("dev-1", "Dev One", "other");
    await enableFlag("other");
    const other = await service.createSeries({ developerAccountId: "dev-1", cadence: "monthly" }, "other");
    expect(other.series.id).not.toBe(seriesId);

    // Cross-workspace reads/mutations 404 rather than leak.
    expect((await invoke(app, { method: "GET", url: `/api/one-on-ones/${other.series.id}`, headers })).status).toBe(404);
    await expect(service.getDetail(seriesId, "other")).rejects.toMatchObject({ status: 404 });
    await expect(service.attachAgenda(seriesId, { title: "leak" }, manager, "other")).rejects.toMatchObject({ status: 404 });
    const list = await service.listSeries("other");
    expect(list.map((row) => row.id)).toEqual([other.series.id]);
  });
});

