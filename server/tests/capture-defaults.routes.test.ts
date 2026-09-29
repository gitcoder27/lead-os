import { beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import express from "express";
import { dueAtForDate } from "shared/types";
import { db, resetDatabase } from "./helpers/db";
import { invoke } from "./helpers/http";
import { configTable, dailyNoteTaskRefs, dailyNotes, developers, issues, taskEvents, tasks } from "../src/db/schema";
import { errorHandler, notFoundHandler } from "../src/middleware/errorHandler";
import { requireManager } from "../src/middleware/auth";
import { createCaptureRouter } from "../src/routes/capture";
import { createTasksRouter } from "../src/routes/tasks";
import { AuthService, serializeSessionCookie } from "../src/services/auth.service";
import { CaptureService } from "../src/services/capture.service";
import { TaskEventsService } from "../src/services/task-events.service";
import { TaskKeysService } from "../src/services/task-keys.service";
import { isoDatePart, todayIsoDate } from "../src/utils/date";

/** docs/57 §3 (P3-05): `POST /api/capture` `defaults` — structured context that only fills what the text leaves open. */
const auth = new AuthService();
const keys = new TaskKeysService();
const app = express();
app.use("/api/tasks", requireManager(auth), createTasksRouter(keys, new TaskEventsService(keys)));
app.use("/api/capture", requireManager(auth), createCaptureRouter(new CaptureService()));
app.use(notFoundHandler);
app.use(errorHandler);

const today = todayIsoDate();
const tomorrow = new Date(Date.parse(`${today}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
const COLON_ID = "557058:ab-12";
let headers: { cookie: string };

async function cookie(name: string): Promise<string> {
  const { sessionId } = await auth.authenticate(name, "secret123");
  return serializeSessionCookie(sessionId, auth.sessionMaxAgeSeconds);
}

const capture = (text: string, defaults?: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  invoke(app, { method: "POST", url: "/api/capture", headers, body: { text, clientToday: today, ...(defaults ? { defaults } : {}), ...extra } });

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

beforeEach(async () => {
  await resetDatabase();
  await db.insert(configTable).values([
    { key: "tasks_phase1_enabled", value: "true" },
    { key: "tasks_phase2_stage", value: "2c" },
    { key: "tasks_phase3_enabled", value: "true" },
  ]);
  await db.insert(developers).values([
    { accountId: "dev-1", displayName: "Dev One", isActive: 1 },
    { accountId: "dev-2", displayName: "Dev Two", isActive: 1 },
    { accountId: COLON_ID, displayName: "Jira Person", isActive: 1 },
  ]);
  await auth.createUser({ username: "manager-a", displayName: "A", password: "secret123", role: "manager" });
  headers = { cookie: await cookie("manager-a") };
});

describe("defaults.ownerAccountId", () => {
  it("assigns a developer whose account id contains a colon, with no @ in the text", async () => {
    const res = await capture("Fix the handoff", { ownerAccountId: COLON_ID });
    expect(res.status).toBe(200);
    expect(res.body.blocked).toBeUndefined();
    expect(res.body.task).toMatchObject({ title: "Fix the handoff", ownerType: "developer", ownerId: COLON_ID, needsTriage: false });
    // Delegating to a developer puts it on their day (decision 4).
    expect(res.body.task.scheduledOn).toBe(today);
  });

  it("an @owner typed in the text wins", async () => {
    const res = await capture("@dev-2 Ship it", { ownerAccountId: "dev-1" });
    expect(res.body.task.ownerId).toBe("dev-2");
  });

  it("null leaves the task unowned (the Inbox lens)", async () => {
    const res = await capture("No one yet", { ownerAccountId: null });
    expect(res.body.task.ownerType).toBeNull();
    expect(res.body.task.ownerId).toBeNull();
  });

  it("rejects an unknown or inactive developer and creates nothing", async () => {
    await db.update(developers).set({ isActive: 0 }).where(eq(developers.accountId, "dev-2"));
    expect((await capture("Ghost", { ownerAccountId: "nobody" })).status).toBe(400);
    expect((await capture("Retired", { ownerAccountId: "dev-2" })).status).toBe(400);
    expect(await db.select().from(tasks)).toHaveLength(0);
  });

  it("is ignored for a Later task (developer tasks cannot be Later)", async () => {
    const res = await capture("Park it /later", { ownerAccountId: "dev-1" });
    expect(res.status).toBe(200);
    expect(res.body.task).toMatchObject({ later: true, ownerType: "manager" });
  });
});

describe("defaults.scheduledOn / later / triage", () => {
  it("fills the plan date; a typed !date wins", async () => {
    const dated = (await capture("Group task", { scheduledOn: tomorrow })).body.task;
    expect(dated.scheduledOn).toBe(tomorrow);
    expect(dated.needsTriage).toBe(false);
    const typed = (await capture(`Typed !${today}`, { scheduledOn: tomorrow })).body.task;
    expect(typed.scheduledOn).toBe(today);
  });

  it("an explicit null date is a decision: undated, not Inbox", async () => {
    const undated = (await capture("Deliberately undated", { scheduledOn: null })).body.task;
    expect(undated.scheduledOn).toBeNull();
    expect(undated.needsTriage).toBe(false);
    // Without defaults a bare capture is still untriaged.
    expect((await capture("Bare")).body.task.needsTriage).toBe(true);
  });

  it("a default /later parks the task, but a typed date or owner beats it", async () => {
    expect((await capture("Parked", { later: true })).body.task).toMatchObject({ later: true, scheduledOn: null, needsTriage: false });
    const dated = (await capture(`Actually soon !${tomorrow}`, { later: true })).body.task;
    expect(dated).toMatchObject({ later: false, scheduledOn: tomorrow });
    const owned = (await capture("@dev-1 Delegate", { later: true })).body.task;
    expect(owned).toMatchObject({ later: false, ownerId: "dev-1" });
  });

  it("status, kind and priority defaults apply; typed !! and /m stay", async () => {
    const blocked = (await capture("Stuck", { status: "blocked" })).body.task;
    expect(blocked.status).toBe("blocked");
    expect(blocked.needsTriage).toBe(false);
    expect((await capture("Sync", { kind: "meeting" })).body.task.kind).toBe("meeting");
    expect((await capture("Urgent", { priority: "high" })).body.task.priority).toBe("high");
    expect((await capture("!! Typed high", { priority: "normal" })).body.task.priority).toBe("high");
  });

  it("a deadline default is kept apart from the plan date, and !due: beats it", async () => {
    const dueAt = dueAtForDate(tomorrow);
    const fromDefault = (await capture("Contract", { dueAt })).body.task;
    expect(isoDatePart(fromDefault.dueAt)).toBe(tomorrow);
    expect(fromDefault.scheduledOn).toBeNull();
    expect(fromDefault.needsTriage).toBe(false);
    const typed = (await capture(`Contract !due:${today}`, { dueAt })).body.task;
    expect(isoDatePart(typed.dueAt)).toBe(today);
  });
});

describe("defaults.waitingOn / followUpAt", () => {
  it("waits on a developer by default; a typed /w wins", async () => {
    const byDefault = (await capture("Reply", { waitingOn: { type: "developer", ref: "dev-1" } })).body.task;
    expect(byDefault.waitingOn).toMatchObject({ type: "developer", ref: "dev-1" });
    expect(byDefault.ownerType).toBe("manager");
    expect(byDefault.needsTriage).toBe(false);
    const typed = (await capture("/w @dev-2 Reply", { waitingOn: { type: "developer", ref: "dev-1" } })).body.task;
    expect(typed.waitingOn).toMatchObject({ ref: "dev-2" });
  });

  it("waits on free text", async () => {
    const res = await capture("Contract", { waitingOn: { type: "text", label: "Legal" } });
    expect(res.body.task.waitingOn).toMatchObject({ type: "text", label: "Legal" });
  });

  it("keeps the time of a follow-up timestamp", async () => {
    const at = new Date(`${tomorrow}T15:30:00`).toISOString();
    const res = await capture("Chase", { followUpAt: at, labels: ["category:follow_up"] });
    expect(res.body.task.followUpAt).toBe(at);
    expect(res.body.task.labels).toContain("category:follow_up");
    expect(res.body.task.needsTriage).toBe(false);
  });
});

describe("defaults.parentKey / labels / meeting fields", () => {
  it("makes a child of the parent task, and a typed ^parent beats it", async () => {
    const parent = (await capture("Parent", { scheduledOn: today })).body.task;
    const other = (await capture("Other parent", { scheduledOn: today })).body.task;
    const child = await capture("Subtask", { parentKey: parent.taskKey });
    expect(child.body.task.parentId).toBe(parent.id);
    expect(child.body.task.ownerType).toBe("manager");
    const typed = await capture(`Subtask ^${other.taskKey}`, { parentKey: parent.taskKey });
    expect(typed.body.task.parentId).toBe(other.id);
  });

  it("400s for an unknown parent", async () => {
    expect((await capture("Orphan", { parentKey: "T-9999" })).status).toBe(400);
  });

  it("unions default labels with typed ones", async () => {
    const res = await capture("Tagged +typed", { labels: ["category:follow_up", "typed"] });
    expect([...res.body.task.labels].sort()).toEqual(["category:follow_up", "typed"]);
  });

  it("carries meeting times, attendees and next action", async () => {
    const startsAt = new Date(`${tomorrow}T10:00:00`).toISOString();
    const endsAt = new Date(`${tomorrow}T10:30:00`).toISOString();
    const res = await capture("Design review", { kind: "meeting", startsAt, endsAt, participants: "Ayan, QA", nextAction: "Send summary", scheduledOn: tomorrow });
    expect(res.body.task).toMatchObject({ kind: "meeting", startsAt, endsAt, participants: "Ayan, QA", nextAction: "Send summary" });
  });
});

describe("defaults.links / contextNote", () => {
  it("links Jira issues (first is primary) and developers, and skips the owner's duplicate person link", async () => {
    await seedIssue("LEAD-1");
    await seedIssue("LEAD-2");
    const res = await capture("Follow up on the outage", {
      ownerAccountId: "dev-1",
      links: { jiraKeys: ["LEAD-1", "lead-2"], developerAccountIds: ["dev-1", "dev-2"] },
    });
    expect(res.status).toBe(200);
    const links = res.body.task.links as { kind: string; ref: string; role: string | null }[];
    expect(links.filter((link) => link.kind === "jira").map((link) => [link.ref, link.role])).toEqual([["LEAD-1", "primary"], ["LEAD-2", "related"]]);
    expect(links.filter((link) => link.kind === "person").map((link) => link.ref)).toEqual(["dev-2"]);
  });

  it("does not duplicate a #KEY typed in the text", async () => {
    await seedIssue("LEAD-1");
    const res = await capture("Look at #LEAD-1", { links: { jiraKeys: ["LEAD-1"] } });
    expect((res.body.task.links as { kind: string }[]).filter((link) => link.kind === "jira")).toHaveLength(1);
  });

  it("rolls the task back when a linked issue does not exist", async () => {
    expect((await capture("Broken link", { links: { jiraKeys: ["NOPE-1"] } })).status).toBe(404);
    expect(await db.select().from(tasks)).toHaveLength(0);
  });

  it("saves the context note as the first update", async () => {
    const res = await capture("With context", { contextNote: "  Why this matters  " });
    const updates = (await db.select().from(taskEvents).where(and(eq(taskEvents.taskKey, res.body.task.taskKey), eq(taskEvents.type, "update"))));
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({ body: "Why this matters" });
    expect(JSON.parse(updates[0]!.metaJson ?? "{}")).toMatchObject({ via: "context_note_field" });
  });
});

describe("defaults.source (a daily note)", () => {
  it("writes the created-from reference the notes list reads", async () => {
    await db.insert(dailyNotes).values({ workspaceId: "default", managerAccountId: "manager-a", date: today, kind: "scratchpad", body: "call Sam", revision: 1, createdAt: "2026-03-07T08:00:00.000Z", updatedAt: "2026-03-07T08:00:00.000Z" });
    const res = await capture("Call Sam", { source: { type: "note", noteDate: today }, labels: ["category:follow_up"] });
    expect(res.status).toBe(200);
    const refs = await db.select().from(dailyNoteTaskRefs).where(eq(dailyNoteTaskRefs.taskKey, res.body.task.taskKey));
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({ relation: "created_from", taskId: res.body.task.id });
    const noteRef = (await db.select().from(taskEvents).where(eq(taskEvents.taskKey, res.body.task.taskKey))).find((event) => event.type === "note_ref");
    expect(JSON.parse(noteRef!.metaJson ?? "{}")).toMatchObject({ noteDate: today, relation: "created_from" });
  });

  it("404s and creates nothing when the note does not exist", async () => {
    const res = await capture("Orphan", { source: { type: "note", noteDate: today } });
    expect(res.status).toBe(404);
    expect(await db.select().from(tasks)).toHaveLength(0);
  });
});

describe("request shape", () => {
  it("rejects unknown default keys and malformed values", async () => {
    expect((await capture("x", { ownerId: "dev-1" })).status).toBe(400);
    expect((await capture("x", { scheduledOn: "tomorrow" })).status).toBe(400);
    expect((await capture("x", { parentKey: "nope" })).status).toBe(400);
    expect((await capture("x", { status: "done" })).status).toBe(400);
    expect((await capture("x", { links: { jiraKeys: [""] } })).status).toBe(400);
  });

  it("replays a retried requestId to the same task, defaults included", async () => {
    const body = { requestId: "req-1" };
    const first = await capture("Once only", { ownerAccountId: "dev-1" }, body);
    const second = await capture("Once only", { ownerAccountId: "dev-1" }, body);
    expect(second.body.task.taskKey).toBe(first.body.task.taskKey);
    expect(await db.select().from(tasks)).toHaveLength(1);
  });

  it("defaults do nothing for an update or a note", async () => {
    const created = (await capture("Target", { scheduledOn: today })).body.task;
    const update = await capture(`${created.taskKey}: progress`, { ownerAccountId: "dev-1", scheduledOn: tomorrow });
    expect(update.status).toBe(200);
    expect(update.body.intent).toBe("update");
    expect((await db.select().from(tasks)).find((row) => row.taskKey === created.taskKey)).toMatchObject({ ownerType: "manager", scheduledOn: today });
  });
});
