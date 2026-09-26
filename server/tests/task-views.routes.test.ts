import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import express from "express";
import { db, resetDatabase } from "./helpers/db";
import { invoke } from "./helpers/http";
import { configTable, developers, issues, tasks, taskSavedViews } from "../src/db/schema";
import { errorHandler, notFoundHandler } from "../src/middleware/errorHandler";
import { requireManager } from "../src/middleware/auth";
import { createTasksRouter } from "../src/routes/tasks";
import { createTaskViewsRouter } from "../src/routes/task-views";
import { createAuthRouter } from "../src/routes/auth";
import { AuthService, serializeSessionCookie } from "../src/services/auth.service";
import { TaskKeysService } from "../src/services/task-keys.service";
import { TaskEventsService } from "../src/services/task-events.service";

const auth = new AuthService();
const keys = new TaskKeysService();
const events = new TaskEventsService(keys);
const app = express();
app.use("/api/tasks", requireManager(auth), createTasksRouter(keys, events));
app.use("/api/task-views", requireManager(auth), createTaskViewsRouter(keys));
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

function encodeViewDef(definition: unknown): string {
  return encodeURIComponent(Buffer.from(JSON.stringify(definition), "utf8").toString("base64url"));
}

async function createTask(headers: { cookie: string }, body: Record<string, unknown>) {
  const response = await invoke(app, { method: "POST", url: "/api/tasks", headers, body });
  expect(response.status).toBe(201);
  return response.body;
}

beforeEach(async () => {
  await resetDatabase();
  await db.insert(configTable).values({ key: "tasks_phase1_enabled", value: "true" });
  await db.insert(developers).values([{ accountId: "dev-1", displayName: "One", isActive: 1 }]);
  await auth.createUser({ username: "manager-a", displayName: "A", password: "secret123", role: "manager" });
  // Second manager joins the same workspace (default would mint a new one).
  await auth.createUser({ username: "manager-b", displayName: "B", password: "secret123", role: "manager", workspaceId: "default" });
});

describe("task saved view routes (P3-D9/D10)", () => {
  it("404s while the flag is off", async () => {
    const headers = { cookie: await cookie("manager-a") };
    await db.insert(configTable).values({ key: "tasks_phase2_stage", value: "2c" });
    expect((await invoke(app, { method: "GET", url: "/api/task-views", headers })).status).toBe(404);
    expect((await invoke(app, { method: "POST", url: "/api/task-views", headers, body: { name: "x", definition: {} } })).status).toBe(404);
    expect((await invoke(app, { method: "PATCH", url: "/api/task-views/1", headers, body: { name: "x" } })).status).toBe(404);
    expect((await invoke(app, { method: "DELETE", url: "/api/task-views/1", headers })).status).toBe(404);
  });

  it("lists the built-in views", async () => {
    await enablePhase3();
    const headers = { cookie: await cookie("manager-a") };
    const response = await invoke(app, { method: "GET", url: "/api/task-views", headers });
    expect(response.status).toBe(200);
    const ids = response.body.views.map((view: { id: string }) => view.id);
    for (const builtin of ["today-plan", "my-tasks", "watching", "inbox", "follow-ups", "meetings", "blocked", "stale", "jira-drift", "later", "closed-week"]) {
      expect(ids).toContain(builtin);
    }
    expect(response.body.views.every((view: { builtin: boolean }) => view.builtin)).toBe(true);
  });

  it("creates, lists, renames, reorders, and deletes private saved views", async () => {
    await enablePhase3();
    const headers = { cookie: await cookie("manager-a") };
    const definition = { filters: { status: ["blocked"] }, sort: "updated", group: "owner" };
    const created = await invoke(app, { method: "POST", url: "/api/task-views", headers, body: { name: "Escalations", definition } });
    expect(created.status).toBe(201);
    expect(created.body.view.name).toBe("Escalations");
    expect(created.body.view.definition.sort).toBe("updated");

    const listed = await invoke(app, { method: "GET", url: "/api/task-views", headers });
    const saved = listed.body.views.find((view: { id: string }) => view.id === `saved:${created.body.view.id}`);
    expect(saved).toBeTruthy();
    expect(saved.builtin).toBe(false);

    const renamed = await invoke(app, { method: "PATCH", url: `/api/task-views/${created.body.view.id}`, headers, body: { name: "Escalations v2", position: 0 } });
    expect(renamed.status).toBe(200);
    expect(renamed.body.view.name).toBe("Escalations v2");

    expect((await invoke(app, { method: "DELETE", url: `/api/task-views/${created.body.view.id}`, headers })).status).toBe(200);
    const after = await invoke(app, { method: "GET", url: "/api/task-views", headers });
    expect(after.body.views.some((view: { id: string }) => view.id === `saved:${created.body.view.id}`)).toBe(false);
  });

  it("keeps saved views private to the owning manager (P3-D10)", async () => {
    await enablePhase3();
    const headersA = { cookie: await cookie("manager-a") };
    const headersB = { cookie: await cookie("manager-b") };
    const created = await invoke(app, { method: "POST", url: "/api/task-views", headers: headersA, body: { name: "Private", definition: {} } });
    expect(created.status).toBe(201);
    const id = created.body.view.id;

    const listedB = await invoke(app, { method: "GET", url: "/api/task-views", headers: headersB });
    expect(listedB.body.views.some((view: { id: string }) => view.id === `saved:${id}`)).toBe(false);
    expect((await invoke(app, { method: "PATCH", url: `/api/task-views/${id}`, headers: headersB, body: { name: "hijack" } })).status).toBe(404);
    expect((await invoke(app, { method: "DELETE", url: `/api/task-views/${id}`, headers: headersB })).status).toBe(404);
  });

  it("scopes saved views to the workspace", async () => {
    await enablePhase3();
    const headers = { cookie: await cookie("manager-a") };
    await invoke(app, { method: "POST", url: "/api/task-views", headers, body: { name: "Scoped", definition: {} } });
    // A row in another workspace with the same manager never surfaces.
    await db.insert(taskSavedViews).values({
      workspaceId: "workspace_other",
      managerAccountId: "manager-a",
      name: "Elsewhere",
      definitionJson: "{}",
      position: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const listed = await invoke(app, { method: "GET", url: "/api/task-views", headers });
    const names = listed.body.views.map((view: { name: string }) => view.name);
    expect(names).toContain("Scoped");
    expect(names).not.toContain("Elsewhere");
  });

  it("validates definitions and enforces unique names", async () => {
    await enablePhase3();
    const headers = { cookie: await cookie("manager-a") };
    expect((await invoke(app, { method: "POST", url: "/api/task-views", headers, body: { name: "bad", definition: { filters: { status: ["nope"] } } } })).status).toBe(400);
    expect((await invoke(app, { method: "POST", url: "/api/task-views", headers, body: { name: "bad", definition: { sort: "sideways" } } })).status).toBe(400);
    expect((await invoke(app, { method: "POST", url: "/api/task-views", headers, body: { name: "bad", definition: { rogue: true } } })).status).toBe(400);
    const first = await invoke(app, { method: "POST", url: "/api/task-views", headers, body: { name: "dup", definition: {} } });
    expect(first.status).toBe(201);
    expect((await invoke(app, { method: "POST", url: "/api/task-views", headers, body: { name: "dup", definition: {} } })).status).toBe(409);
  });
});

describe("GET /api/tasks?viewDef (P3-D9)", () => {
  it("404s while the flag is off", async () => {
    const headers = { cookie: await cookie("manager-a") };
    await db.insert(configTable).values({ key: "tasks_phase2_stage", value: "2c" });
    const response = await invoke(app, { method: "GET", url: `/api/tasks?viewDef=${encodeViewDef({})}`, headers });
    expect(response.status).toBe(404);
  });

  it("rejects malformed or invalid viewDef payloads", async () => {
    await enablePhase3();
    const headers = { cookie: await cookie("manager-a") };
    expect((await invoke(app, { method: "GET", url: "/api/tasks?viewDef=%%%not-base64%%%", headers })).status).toBe(400);
    expect((await invoke(app, { method: "GET", url: `/api/tasks?viewDef=${encodeViewDef({ filters: { status: ["nope"] } })}`, headers })).status).toBe(400);
  });

  it("filters by owner, status, labels, later, and jira links", async () => {
    await enablePhase3();
    const headers = { cookie: await cookie("manager-a") };
    await createTask(headers, { title: "Mine open" });
    await createTask(headers, { title: "Mine blocked", status: "blocked", labels: ["escalation"] });
    await createTask(headers, { title: "Dev task", ownerType: "developer", ownerId: "dev-1" });
    await createTask(headers, { title: "Later item", later: true });
    await createTask(headers, { title: "Inbox item", ownerType: null, ownerId: null });

    const mine = await invoke(app, { method: "GET", url: `/api/tasks?viewDef=${encodeViewDef({ filters: { owner: "me", status: ["open"] } })}`, headers });
    // "me" = my owned tasks only; unowned inbox items live under owner:"inbox".
    expect(mine.body.tasks.map((t: { title: string }) => t.title)).toEqual(expect.arrayContaining(["Mine open", "Later item"]));
    expect(mine.body.tasks.some((t: { title: string }) => t.title === "Inbox item")).toBe(false);

    const labeled = await invoke(app, { method: "GET", url: `/api/tasks?viewDef=${encodeViewDef({ filters: { labels: ["escalation"] } })}`, headers });
    expect(labeled.body.tasks.map((t: { title: string }) => t.title)).toEqual(["Mine blocked"]);

    const team = await invoke(app, { method: "GET", url: `/api/tasks?viewDef=${encodeViewDef({ filters: { owner: "team" } })}`, headers });
    expect(team.body.tasks.map((t: { title: string }) => t.title)).toEqual(["Dev task"]);

    const inbox = await invoke(app, { method: "GET", url: `/api/tasks?viewDef=${encodeViewDef({ filters: { owner: "inbox" } })}`, headers });
    expect(inbox.body.tasks.map((t: { title: string }) => t.title)).toEqual(["Inbox item"]);

    const later = await invoke(app, { method: "GET", url: `/api/tasks?viewDef=${encodeViewDef({ filters: { later: true } })}`, headers });
    expect(later.body.tasks.map((t: { title: string }) => t.title)).toEqual(["Later item"]);
  });

  it("applies later/followUp/linkedJira bidirectionally (G4)", async () => {
    await enablePhase3();
    const headers = { cookie: await cookie("manager-a") };
    const now = new Date().toISOString();
    await db.insert(issues).values([
      { jiraKey: "APP-9", summary: "Linked", priorityName: "High", priorityId: "1", statusName: "Open", statusCategory: "new", createdAt: now, updatedAt: now, syncedAt: now, labels: "[]" },
    ]);
    await createTask(headers, { title: "Plain open" });
    await createTask(headers, { title: "Later parked", later: true });
    await createTask(headers, { title: "Follow-up task", labels: ["category:follow_up"] });
    const linked = await createTask(headers, { title: "Jira linked" });
    await invoke(app, { method: "POST", url: `/api/tasks/${linked.taskKey}/links`, headers, body: { kind: "jira", ref: "APP-9", role: "primary" } });
    const titles = (res: { body: { tasks: { title: string }[] } }) => res.body.tasks.map((t) => t.title).sort();

    // later:false keeps everything except my parked rows.
    const notLater = await invoke(app, { method: "GET", url: `/api/tasks?viewDef=${encodeViewDef({ filters: { later: false } })}`, headers });
    expect(titles(notLater)).toEqual(["Follow-up task", "Jira linked", "Plain open"]);

    // followUp:false excludes both the labeled task and follow_up_at rows.
    const notFollowUp = await invoke(app, { method: "GET", url: `/api/tasks?viewDef=${encodeViewDef({ filters: { followUp: false } })}`, headers });
    expect(titles(notFollowUp)).toEqual(["Jira linked", "Later parked", "Plain open"]);

    // linkedJira both ways.
    const linkedOnly = await invoke(app, { method: "GET", url: `/api/tasks?viewDef=${encodeViewDef({ filters: { linkedJira: true } })}`, headers });
    expect(titles(linkedOnly)).toEqual(["Jira linked"]);
    const unlinkedOnly = await invoke(app, { method: "GET", url: `/api/tasks?viewDef=${encodeViewDef({ filters: { linkedJira: false } })}`, headers });
    expect(titles(unlinkedOnly)).toEqual(["Follow-up task", "Later parked", "Plain open"]);
  });

  it("rejects a closed filter with no bounds (G5)", async () => {
    await enablePhase3();
    const headers = { cookie: await cookie("manager-a") };
    expect((await invoke(app, { method: "GET", url: `/api/tasks?viewDef=${encodeViewDef({ filters: { closed: {} } })}`, headers })).status).toBe(400);
    // One bound is enough — an open-ended range is valid.
    const res = await invoke(app, { method: "GET", url: `/api/tasks?viewDef=${encodeViewDef({ filters: { closed: { from: "2000-01-01" } } })}`, headers });
    expect(res.status).toBe(200);
  });

  it("the today-plan built-in excludes Later tasks (G3)", async () => {
    await enablePhase3();
    const headers = { cookie: await cookie("manager-a") };
    await createTask(headers, { title: "Today's work" });
    await createTask(headers, { title: "Parked", later: true });

    const listed = await invoke(app, { method: "GET", url: "/api/task-views", headers });
    const todayPlan = listed.body.views.find((view: { id: string }) => view.id === "today-plan");
    expect(todayPlan).toBeTruthy();

    const res = await invoke(app, {
      method: "GET",
      url: `/api/tasks?viewDef=${encodeViewDef(todayPlan.definition)}`,
      headers,
    });
    const titles = res.body.tasks.map((t: { title: string }) => t.title);
    expect(titles).toContain("Today's work");
    expect(titles).not.toContain("Parked");
  });

  it("only returns closed tasks inside an explicit closed range", async () => {
    await enablePhase3();
    const headers = { cookie: await cookie("manager-a") };
    await createTask(headers, { title: "Open task" });
    await createTask(headers, { title: "Done task", status: "done" });
    const today = new Date().toISOString().slice(0, 10);

    const openOnly = await invoke(app, { method: "GET", url: `/api/tasks?viewDef=${encodeViewDef({ filters: {} })}`, headers });
    expect(openOnly.body.tasks.some((t: { title: string }) => t.title === "Done task")).toBe(false);

    const closed = await invoke(app, { method: "GET", url: `/api/tasks?viewDef=${encodeViewDef({ filters: { closed: { from: "2000-01-01", to: today } } })}`, headers });
    expect(closed.body.tasks.map((t: { title: string }) => t.title)).toEqual(["Done task"]);
  });

  it("matches the follow-up predicate via label and followUpAt", async () => {
    await enablePhase3();
    const headers = { cookie: await cookie("manager-a") };
    await createTask(headers, { title: "Plain" });
    await createTask(headers, { title: "Labeled", labels: ["category:follow_up"] });
    await createTask(headers, { title: "Scheduled follow-up", followUpAt: `${new Date().toISOString().slice(0, 10)}T17:00:00.000Z` });

    const response = await invoke(app, { method: "GET", url: `/api/tasks?viewDef=${encodeViewDef({ filters: { followUp: true } })}`, headers });
    expect(response.body.tasks.map((t: { title: string }) => t.title).sort()).toEqual(["Labeled", "Scheduled follow-up"]);
  });

  it("filters to drifted Jira-linked tasks (§8.1)", async () => {
    await enablePhase3();
    const headers = { cookie: await cookie("manager-a") };
    const now = new Date().toISOString();
    await db.insert(issues).values([
      { jiraKey: "APP-1", summary: "Done in Jira", priorityName: "High", priorityId: "1", statusName: "Done", statusCategory: "done", createdAt: now, updatedAt: now, syncedAt: now, labels: "[]" },
      { jiraKey: "APP-2", summary: "Aligned", priorityName: "High", priorityId: "1", statusName: "Open", statusCategory: "new", createdAt: now, updatedAt: now, syncedAt: now, labels: "[]" },
    ]);
    const drifted = await createTask(headers, { title: "Drifted" });
    await invoke(app, { method: "POST", url: `/api/tasks/${drifted.taskKey}/links`, headers, body: { kind: "jira", ref: "APP-1", role: "primary" } });
    const aligned = await createTask(headers, { title: "Aligned" });
    await invoke(app, { method: "POST", url: `/api/tasks/${aligned.taskKey}/links`, headers, body: { kind: "jira", ref: "APP-2", role: "primary" } });
    await createTask(headers, { title: "Unlinked" });

    const response = await invoke(app, { method: "GET", url: `/api/tasks?viewDef=${encodeViewDef({ filters: { jiraDrift: true } })}`, headers });
    expect(response.status).toBe(200);
    expect(response.body.tasks.map((t: { title: string }) => t.title)).toEqual(["Drifted"]);
  });

  it("surfaces recently closed drifted tasks but not stale ones", async () => {
    await enablePhase3();
    const headers = { cookie: await cookie("manager-a") };
    const now = new Date().toISOString();
    await db.insert(issues).values([
      { jiraKey: "APP-3", summary: "Open in Jira", priorityName: "High", priorityId: "1", statusName: "Open", statusCategory: "new", createdAt: now, updatedAt: now, syncedAt: now, labels: "[]" },
      { jiraKey: "APP-4", summary: "Old", priorityName: "High", priorityId: "1", statusName: "Open", statusCategory: "new", createdAt: now, updatedAt: now, syncedAt: now, labels: "[]" },
    ]);
    const recent = await createTask(headers, { title: "Recent done" });
    await invoke(app, { method: "POST", url: `/api/tasks/${recent.taskKey}/links`, headers, body: { kind: "jira", ref: "APP-3", role: "primary" } });
    await invoke(app, { method: "PATCH", url: `/api/tasks/${recent.taskKey}`, headers, body: { status: "done" } });
    const stale = await createTask(headers, { title: "Stale done" });
    await invoke(app, { method: "POST", url: `/api/tasks/${stale.taskKey}/links`, headers, body: { kind: "jira", ref: "APP-4", role: "primary" } });
    await invoke(app, { method: "PATCH", url: `/api/tasks/${stale.taskKey}`, headers, body: { status: "done" } });
    await db.update(tasks).set({ closedAt: "2000-01-01T00:00:00.000Z" }).where(eq(tasks.taskKey, stale.taskKey));

    const response = await invoke(app, { method: "GET", url: `/api/tasks?viewDef=${encodeViewDef({ filters: { jiraDrift: true } })}`, headers });
    expect(response.body.tasks.map((t: { title: string }) => t.title)).toEqual(["Recent done"]);
  });

  it("does not leak another manager's private tasks", async () => {
    await enablePhase3();
    const headersA = { cookie: await cookie("manager-a") };
    const headersB = { cookie: await cookie("manager-b") };
    await createTask(headersA, { title: "A's task" });
    await createTask(headersB, { title: "B's task" });

    const response = await invoke(app, { method: "GET", url: `/api/tasks?viewDef=${encodeViewDef({})}`, headers: headersA });
    const titles = response.body.tasks.map((t: { title: string }) => t.title);
    expect(titles).toContain("A's task");
    expect(titles).not.toContain("B's task");
  });
});
