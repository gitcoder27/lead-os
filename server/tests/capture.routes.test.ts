import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import express from "express";
import { db, resetDatabase } from "./helpers/db";
import { invoke } from "./helpers/http";
import { configTable, developers, issues, taskLabels, tasks } from "../src/db/schema";
import { errorHandler, notFoundHandler } from "../src/middleware/errorHandler";
import { requireManager } from "../src/middleware/auth";
import { createTasksRouter } from "../src/routes/tasks";
import { createCaptureRouter } from "../src/routes/capture";
import { AuthService, serializeSessionCookie } from "../src/services/auth.service";
import { CaptureService } from "../src/services/capture.service";
import { TaskKeysService } from "../src/services/task-keys.service";
import { TaskEventsService } from "../src/services/task-events.service";
import { isoDatePart, todayIsoDate } from "../src/utils/date";
import { dueAtForDate } from "shared/types";
import { TaskViewsService, builtinTaskViews } from "../src/services/task-views.service";
import type { TaskPrincipal } from "../src/services/task.service";

function shiftIso(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

// A manager's account id is their username (AuthService maps it onto the session).
async function managerPrincipal(): Promise<TaskPrincipal> {
  return { type: "manager", accountId: "manager-a" };
}

const auth = new AuthService();
const keys = new TaskKeysService();
const events = new TaskEventsService(keys);
const app = express();
app.use("/api/tasks", requireManager(auth), createTasksRouter(keys, events));
app.use("/api/capture", requireManager(auth), createCaptureRouter(new CaptureService()));
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

async function seedIssue(jiraKey: string) {
  await db.insert(issues).values({
    jiraKey, summary: "Synced issue", description: null, aspenSeverity: null,
    priorityName: "Medium", priorityId: "2", statusName: "In Progress", statusCategory: "indeterminate",
    assigneeId: "dev-1", assigneeName: "Dev One", teamScopeState: "in_team", syncScopeState: "active",
    reporterName: "Lead", component: null, labels: "[]", dueDate: null, developmentDueDate: null,
    flagged: 0, createdAt: "2026-03-07T08:00:00.000Z", updatedAt: "2026-03-07T08:00:00.000Z",
    syncedAt: "2026-03-07T08:00:00.000Z", lastSeenInScopedSyncAt: "2026-03-07T08:00:00.000Z",
    lastReconciledAt: "2026-03-07T08:00:00.000Z", scopeChangedAt: null, analysisNotes: null, excluded: 0,
  });
}

const capture = (headers: Record<string, string>, text: string, extra: Record<string, unknown> = {}) =>
  invoke(app, { method: "POST", url: "/api/capture", headers, body: { text, clientToday: todayIsoDate(), ...extra } });

beforeEach(async () => {
  await resetDatabase();
  await db.insert(configTable).values({ key: "tasks_phase1_enabled", value: "true" });
  await db.insert(developers).values([
    { accountId: "dev-1", displayName: "Dev One", isActive: 1 },
    { accountId: "dev-2", displayName: "Dev Two", isActive: 1 },
  ]);
  await auth.createUser({ username: "manager-a", displayName: "A", password: "secret123", role: "manager" });
  await auth.createUser({ username: "dev-user", displayName: "Dev", password: "secret123", role: "developer", developerAccountId: "dev-1" });
});

describe("POST /api/capture (P3-D7/D8)", () => {
  it("404s while the Phase 3 flag is off", async () => {
    const headers = { cookie: await cookie("manager-a") };
    await db.insert(configTable).values({ key: "tasks_phase2_stage", value: "2c" });
    expect((await capture(headers, "hello")).status).toBe(404);
  });

  it("rejects developer principals", async () => {
    await enablePhase3();
    const headers = { cookie: await cookie("dev-user") };
    expect((await capture(headers, "hello")).status).toBe(403);
  });

  it("a bare capture is mine, open, undated and untriaged (docs/57 P3-02)", async () => {
    await enablePhase3();
    const headers = { cookie: await cookie("manager-a") };
    const res = await capture(headers, "Prep board review");
    expect(res.status).toBe(200);
    expect(res.body.intent).toBe("create");
    expect(res.body.task.title).toBe("Prep board review");
    expect(res.body.task.ownerType).toBe("manager");
    expect(res.body.task.status).toBe("open");
    expect(res.body.task.scheduledOn).toBeNull();
    expect(res.body.task.needsTriage).toBe(true);
  });

  it("lands a bare capture in Inbox, never Overdue, until it is triaged (P3-02)", async () => {
    await enablePhase3();
    const headers = { cookie: await cookie("manager-a") };
    const key = (await capture(headers, "Untriaged thought")).body.task.taskKey as string;
    const dated = (await capture(headers, "Planned thing !tomorrow")).body.task;
    expect(dated.needsTriage).toBe(false);
    expect(dated.scheduledOn).not.toBeNull();

    const views = new TaskViewsService();
    const manager = await managerPrincipal();
    const today = todayIsoDate();
    const inbox = () => views.run(manager, builtinTaskViews(today).find((view) => view.id === "inbox")!.definition, today);
    expect((await inbox()).map((task) => task.taskKey)).toEqual([key]);
    const attention = await views.run(manager, builtinTaskViews(today).find((view) => view.id === "attention")!.definition, today);
    expect(attention.map((task) => task.taskKey)).not.toContain(key);
    // Keeping it undated is a triage decision: it leaves Inbox.
    const patched = await invoke(app, { method: "PATCH", url: `/api/tasks/${key}`, headers, body: { scheduledOn: null } });
    expect(patched.status).toBe(200);
    expect(await inbox()).toEqual([]);
    // Undo can put it back.
    await invoke(app, { method: "PATCH", url: `/api/tasks/${key}`, headers, body: { triaged: false } });
    expect((await inbox()).map((task) => task.taskKey)).toEqual([key]);
    const counts = await views.counts(manager, today);
    expect(counts.inbox!.count).toBe(1);
  });

  it("unowned tasks stay in Inbox even when dated (legacy Desk inbox rows)", async () => {
    await enablePhase3();
    const headers = { cookie: await cookie("manager-a") };
    const created = await invoke(app, { method: "POST", url: "/api/tasks", headers, body: { title: "Unowned", ownerType: null, ownerId: null } });
    expect(created.status).toBe(201);
    expect(created.body.scheduledOn).toBe(todayIsoDate());
    const today = todayIsoDate();
    const inbox = await new TaskViewsService().run(await managerPrincipal(), builtinTaskViews(today).find((view) => view.id === "inbox")!.definition, today);
    expect(inbox.map((task) => task.taskKey)).toEqual([created.body.taskKey]);
  });

  it("resolves dates and stored clock times in the client's zone, not the server's (docs/56 review)", async () => {
    await enablePhase3();
    const headers = { cookie: await cookie("manager-a") };
    // Only Date is faked: faking timers stalls Express once an error reaches its handler.
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      // 20:30Z on the 7th is already 09:30 on the 8th in Auckland (UTC+13 in March).
      vi.setSystemTime(new Date("2026-03-07T20:30:00.000Z"));
      const tz = "Pacific/Auckland";
      const due = (await capture(headers, "Ship it !today !due:2026-03-10", { tz, clientToday: undefined })).body.task;
      expect(due.scheduledOn).toBe("2026-03-08");
      // End of the 10th in Auckland.
      expect(due.dueAt).toBe("2026-03-10T10:59:59.999Z");

      const chase = (await capture(headers, "Chase vendor /f !2026-03-09", { tz, clientToday: undefined })).body.task;
      // 09:00 on the 9th in Auckland.
      expect(chase.followUpAt).toBe("2026-03-08T20:00:00.000Z");

      // The same text in Honolulu (UTC-10): still the 7th.
      const honolulu = (await capture(headers, "Ship it too !today", { tz: "Pacific/Honolulu", clientToday: undefined })).body.task;
      expect(honolulu.scheduledOn).toBe("2026-03-07");
    } finally {
      vi.useRealTimers();
    }
  });

  it("!due: stores the deadline as the end of that day and leaves the plan date alone (P3-04)", async () => {
    await enablePhase3();
    const headers = { cookie: await cookie("manager-a") };
    const due = todayIsoDate(new Date(Date.now() + 3 * 86_400_000));
    const both = (await capture(headers, `Send contract !${todayIsoDate()} !due:${due}`)).body.task;
    expect(both.scheduledOn).toBe(todayIsoDate());
    // Local end of day: every local-date reader agrees on the day.
    expect(both.dueAt).toBeTruthy();
    expect(isoDatePart(both.dueAt)).toBe(due);
    expect(new Date(both.dueAt).getHours()).toBe(23);
    expect(both.needsTriage).toBe(false);

    const dueOnly = (await capture(headers, `Renew licence !due:${due}`)).body.task;
    expect(dueOnly.scheduledOn).toBeNull();
    expect(isoDatePart(dueOnly.dueAt)).toBe(due);
    // A deadline is a triage decision: it does not sit in Inbox.
    expect(dueOnly.needsTriage).toBe(false);

    const none = (await capture(headers, "No deadline here")).body.task;
    expect(none.dueAt).toBeNull();
  });

  it("the drawer's PATCH can set and clear the deadline without touching the plan date (P3-04)", async () => {
    await enablePhase3();
    const headers = { cookie: await cookie("manager-a") };
    const created = (await capture(headers, `Draft plan !${todayIsoDate()}`)).body.task;
    const due = todayIsoDate(new Date(Date.now() + 5 * 86_400_000));
    const set = await invoke(app, { method: "PATCH", url: `/api/tasks/${created.taskKey}`, headers, body: { dueAt: dueAtForDate(due) } });
    expect(set.status).toBe(200);
    expect(isoDatePart(set.body.dueAt)).toBe(due);
    expect(set.body.scheduledOn).toBe(todayIsoDate());
    const cleared = await invoke(app, { method: "PATCH", url: `/api/tasks/${created.taskKey}`, headers, body: { dueAt: null } });
    expect(cleared.body.dueAt).toBeNull();
    expect(cleared.body.scheduledOn).toBe(todayIsoDate());
  });

  it("@dev without a date keeps landing on the developer's day (decision 4)", async () => {
    await enablePhase3();
    const headers = { cookie: await cookie("manager-a") };
    const res = await capture(headers, "Fix the flaky test @dev-1");
    expect(res.body.task.ownerType).toBe("developer");
    expect(res.body.task.scheduledOn).toBe(todayIsoDate());
    expect(res.body.task.needsTriage).toBe(false);
  });

  it("@person makes a developer the owner; !date, !!, +label, /m and /f apply", async () => {
    await enablePhase3();
    const headers = { cookie: await cookie("manager-a") };
    const res = await capture(headers, "Review PR @dev-1 !tomorrow !! +urgent /f");
    expect(res.status).toBe(200);
    const task = res.body.task;
    expect(task.ownerType).toBe("developer");
    expect(task.ownerId).toBe("dev-1");
    expect(task.trackedByManagerId).toBeTruthy();
    expect(task.priority).toBe("high");
    expect(task.labels).toEqual(expect.arrayContaining(["urgent", "category:follow_up"]));
    // G6: the trailing /f has no attached date, so follow_up_at stays NULL —
    // the category:follow_up label carries the follow-up flag.
    expect(task.followUpAt).toBeNull();
    const tomorrow = new Date(Date.parse(`${todayIsoDate()}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
    expect(task.scheduledOn).toBe(tomorrow);
    // The label auto-registered.
    const labelRows = await db.select().from(taskLabels);
    expect(labelRows.map((row) => row.name)).toContain("urgent");
  });

  it("/meeting + /later and ^parent / T-n link tokens apply", async () => {
    await enablePhase3();
    const headers = { cookie: await cookie("manager-a") };
    const parent = await invoke(app, { method: "POST", url: "/api/tasks", headers, body: { title: "Parent" } });
    const linked = await invoke(app, { method: "POST", url: "/api/tasks", headers, body: { title: "Linked" } });
    const res = await capture(headers, `Sync up /m ^${parent.body.taskKey} ${linked.body.taskKey}`);
    expect(res.status).toBe(200);
    expect(res.body.task.kind).toBe("meeting");
    expect(res.body.task.parentId).toBe(parent.body.id);
    const links = res.body.task.links.map((l: { kind: string; ref: string }) => `${l.kind}:${l.ref}`);
    expect(links).toContain(`task:${linked.body.taskKey}`);

    const later = await capture(headers, "Someday idea /later");
    expect(later.body.task.later).toBe(true);
  });

  it("T-n: appends a shared update event to the task", async () => {
    await enablePhase3();
    const headers = { cookie: await cookie("manager-a") };
    const task = await invoke(app, { method: "POST", url: "/api/tasks", headers, body: { title: "Watched" } });
    const res = await capture(headers, `${task.body.taskKey}: spoke with support`);
    expect(res.status).toBe(200);
    expect(res.body.intent).toBe("update");
    expect(res.body.event.body).toBe("spoke with support");
    expect(res.body.event.visibility).toBe("shared");
    const list = await invoke(app, { method: "GET", url: `/api/tasks/${task.body.taskKey}/events`, headers });
    expect(list.body.events.some((e: { type: string; body: string }) => e.type === "update" && e.body === "spoke with support")).toBe(true);
  });

  it("/note appends to today's daily note", async () => {
    await enablePhase3();
    const headers = { cookie: await cookie("manager-a") };
    const res = await capture(headers, "/note waiting on design review");
    expect(res.status).toBe(200);
    expect(res.body.intent).toBe("note");
    expect(res.body.note.note.date).toBe(todayIsoDate());
    expect(res.body.note.note.body).toContain("waiting on design review");
  });

  it("blocks on ambiguous and unknown @person matches", async () => {
    await enablePhase3();
    const headers = { cookie: await cookie("manager-a") };
    const ambiguous = await capture(headers, "Ping @dev about this");
    expect(ambiguous.body.blocked).toBe(true);
    expect(ambiguous.body.diagnostics.some((d: { code: string }) => d.code === "ambiguous-person")).toBe(true);
    const unknown = await capture(headers, "Ping @ghost about this");
    expect(unknown.body.diagnostics.some((d: { code: string }) => d.code === "unknown-person")).toBe(true);
    // Nothing was created.
    const all = await db.select().from(tasks);
    expect(all).toHaveLength(0);
  });

  it("keeps an unsynced #KEY as title text with a warning", async () => {
    await enablePhase3();
    const headers = { cookie: await cookie("manager-a") };
    const res = await capture(headers, "Investigate #LEAD-99 today");
    expect(res.status).toBe(200);
    expect(res.body.task.title).toBe("Investigate #LEAD-99 today");
    expect(res.body.task.links).toHaveLength(0);
    expect(res.body.diagnostics.some((d: { code: string }) => d.code === "jira-not-synced")).toBe(true);
  });

  it("links a synced #KEY primary-first", async () => {
    await enablePhase3();
    await seedIssue("LEAD-42");
    const headers = { cookie: await cookie("manager-a") };
    const res = await capture(headers, "Fix #LEAD-42 regression");
    expect(res.status).toBe(200);
    expect(res.body.task.links).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "jira", ref: "LEAD-42", role: "primary" })]),
    );
  });

  it("past dates need a confirm step", async () => {
    await enablePhase3();
    const headers = { cookie: await cookie("manager-a") };
    const first = await capture(headers, "Old task !2020-01-01");
    expect(first.status).toBe(200);
    expect(first.body.confirmRequired).toBe(true);
    expect(first.body.task).toBeUndefined();
    const confirmed = await capture(headers, "Old task !2020-01-01", { confirm: true });
    expect(confirmed.body.task.scheduledOn).toBe("2020-01-01");
  });

  it("rejects a clientToday drift of more than one day", async () => {
    await enablePhase3();
    const headers = { cookie: await cookie("manager-a") };
    expect((await capture(headers, "Anything", { clientToday: "1999-01-01" })).status).toBe(400);
  });

  it("T-n: on a missing task is blocked", async () => {
    await enablePhase3();
    const headers = { cookie: await cookie("manager-a") };
    const res = await capture(headers, "T-999: nobody home");
    expect(res.body.blocked).toBe(true);
    expect(res.body.diagnostics.some((d: { code: string }) => d.code === "bad-update-target")).toBe(true);
  });

  it("/later !date stores a resurface date and /later @person links, not owns (P3-02)", async () => {
    await enablePhase3();
    const headers = { cookie: await cookie("manager-a") };
    const dated = await capture(headers, "Idea /later !+3d");
    expect(dated.status).toBe(200);
    expect(dated.body.task.later).toBe(true);
    expect(dated.body.task.scheduledOn).toBeNull();
    expect(dated.body.task.hideUntil).toBe(shiftIso(todayIsoDate(), 3));
    const linked = await capture(headers, "Idea /later @dev-1");
    expect(linked.status).toBe(200);
    expect(linked.body.task.ownerType).toBe("manager");
    expect(linked.body.task.later).toBe(true);
    expect(linked.body.task.links).toEqual([expect.objectContaining({ kind: "person", ref: "dev-1" })]);
  });

  it("a parked task resurfaces in Inbox on its hideUntil date (P3-02)", async () => {
    await enablePhase3();
    const headers = { cookie: await cookie("manager-a") };
    const key = (await capture(headers, "Revisit vendor /later !+3d")).body.task.taskKey as string;
    const views = new TaskViewsService();
    const manager = await managerPrincipal();
    const run = (id: string, today: string) => views.run(manager, builtinTaskViews(today).find((view) => view.id === id)!.definition, today);
    const today = todayIsoDate();
    const resurface = shiftIso(today, 3);
    expect((await run("later", today)).map((task) => task.taskKey)).toEqual([key]);
    expect(await run("inbox", today)).toEqual([]);
    expect(await run("later", resurface)).toEqual([]);
    expect((await run("inbox", resurface)).map((task) => task.taskKey)).toEqual([key]);
    expect((await run("my-tasks", resurface)).map((task) => task.taskKey)).toContain(key);
    // Scheduling it triages it and clears the parked state and resurface date.
    const res = await invoke(app, { method: "PATCH", url: `/api/tasks/${key}`, headers, body: { scheduledOn: resurface, later: false } });
    expect(res.status).toBe(200);
    expect(res.body.hideUntil).toBeNull();
    expect(await run("inbox", resurface)).toEqual([]);
  });

  it("rejects a resurface date without Later", async () => {
    await enablePhase3();
    const headers = { cookie: await cookie("manager-a") };
    const key = (await capture(headers, "Plain task !tomorrow")).body.task.taskKey as string;
    const res = await invoke(app, { method: "PATCH", url: `/api/tasks/${key}`, headers, body: { hideUntil: "2030-01-01" } });
    expect(res.status).toBe(409);
  });

  it("/later stores scheduled_on as NULL (G2)", async () => {
    await enablePhase3();
    const headers = { cookie: await cookie("manager-a") };
    const res = await capture(headers, "Someday idea /later");
    expect(res.status).toBe(200);
    expect(res.body.task.later).toBe(true);
    expect(res.body.task.scheduledOn).toBeNull();
    const row = (await db.select().from(tasks).where(eq(tasks.taskKey, res.body.task.taskKey)))[0]!;
    expect(row.scheduledOn).toBeNull();
  });

  it("dateless /f keeps the follow_up label with follow_up_at NULL (G6)", async () => {
    await enablePhase3();
    const headers = { cookie: await cookie("manager-a") };
    const res = await capture(headers, "Circle back with Sam /f");
    expect(res.status).toBe(200);
    expect(res.body.task.labels).toContain("category:follow_up");
    expect(res.body.task.followUpAt).toBeNull();
  });

  it("/f with a date stores a local 9am follow-up timestamp (G6)", async () => {
    await enablePhase3();
    const headers = { cookie: await cookie("manager-a") };
    const res = await capture(headers, "Check in on the rollout /f !tomorrow");
    expect(res.status).toBe(200);
    const tomorrow = new Date(Date.parse(`${todayIsoDate()}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
    // Local-time convention: 09:00 local on the follow-up date, not UTC.
    expect(res.body.task.followUpAt).toBe(new Date(`${tomorrow}T09:00:00`).toISOString());
    expect(res.body.task.labels).toContain("category:follow_up");
  });

  it("replays a repeated requestId to the same task (nit: requestId on create)", async () => {
    await enablePhase3();
    const headers = { cookie: await cookie("manager-a") };
    const requestId = "3f4c2a1e-9b1d-4c8a-b7e2-0a1b2c3d4e5f";
    const first = await capture(headers, "Retry-safe task", { requestId });
    expect(first.status).toBe(200);
    const second = await capture(headers, "Retry-safe task", { requestId });
    expect(second.status).toBe(200);
    expect(second.body.task.taskKey).toBe(first.body.task.taskKey);
    expect((await db.select().from(tasks))).toHaveLength(1);
  });

  it("records meta.source:'capture' on the created event", async () => {
    await enablePhase3();
    const headers = { cookie: await cookie("manager-a") };
    const res = await capture(headers, "Source-tagged task");
    const eventsList = await invoke(app, { method: "GET", url: `/api/tasks/${res.body.task.taskKey}/events`, headers });
    const created = eventsList.body.events.find((event: { type: string }) => event.type === "created");
    expect(created).toBeTruthy();
    expect(created.meta).toMatchObject({ source: "capture" });
  });

  it("rolls back the task row when a link write fails mid-transaction", async () => {
    await enablePhase3();
    const headers = { cookie: await cookie("manager-a") };
    const target = await invoke(app, { method: "POST", url: "/api/tasks", headers, body: { title: "Link target" } });
    const before = await db.select().from(tasks);

    // A TaskService whose link write throws inside the transaction must take
    // the whole create (task + created event + links) down with it.
    const { CaptureService } = await import("../src/services/capture.service");
    const { TaskService } = await import("../src/services/task.service");
    const { HttpError } = await import("../src/middleware/errorHandler");
    class FailingLinkService extends TaskService {
      override async addLink(): Promise<never> {
        throw new HttpError(500, "simulated link failure");
      }
    }
    const service = new CaptureService(new TaskKeysService(), new FailingLinkService(), new TaskEventsService());
    await expect(service.run(
      { text: `Rollmeback ${target.body.taskKey}`, clientToday: todayIsoDate() },
      { type: "manager", accountId: "manager-a", workspaceId: "default" },
    )).rejects.toMatchObject({ status: 500 });

    expect((await db.select().from(tasks))).toHaveLength(before.length);
  });
});
