import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import express from "express";
import { db, resetDatabase } from "./helpers/db";
import { invoke } from "./helpers/http";
import { configTable, developers, taskEvents, tasks } from "../src/db/schema";
import { errorHandler, notFoundHandler } from "../src/middleware/errorHandler";
import { requireManager } from "../src/middleware/auth";
import { createTasksRouter } from "../src/routes/tasks";
import { createTaskViewsRouter } from "../src/routes/task-views";
import { createCaptureRouter } from "../src/routes/capture";
import { createContactsRouter } from "../src/routes/contacts";
import { AuthService, serializeSessionCookie } from "../src/services/auth.service";
import { CaptureService } from "../src/services/capture.service";
import { TaskKeysService } from "../src/services/task-keys.service";
import { TaskEventsService } from "../src/services/task-events.service";
import { TaskService } from "../src/services/task.service";
import { todayIsoDate } from "../src/utils/date";

/** docs/57 §2–§4 (P3-03): waiting-on, contacts, `/w` capture, and the Waiting lens. */
const auth = new AuthService();
const keys = new TaskKeysService();
const events = new TaskEventsService(keys);
const app = express();
app.use("/api/tasks", requireManager(auth), createTasksRouter(keys, events));
app.use("/api/task-views", requireManager(auth), createTaskViewsRouter(keys));
app.use("/api/capture", requireManager(auth), createCaptureRouter(new CaptureService()));
app.use("/api/contacts", requireManager(auth), createContactsRouter());
app.use(notFoundHandler);
app.use(errorHandler);

const today = todayIsoDate();
function shift(days: number): string {
  return new Date(Date.parse(`${today}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}
type Headers = { cookie: string };

async function cookie(name: string): Promise<string> {
  const { sessionId } = await auth.authenticate(name, "secret123");
  return serializeSessionCookie(sessionId, auth.sessionMaxAgeSeconds);
}

function encodeViewDef(definition: unknown): string {
  return encodeURIComponent(Buffer.from(JSON.stringify(definition), "utf8").toString("base64url"));
}

async function createTask(headers: Headers, body: Record<string, unknown>) {
  const response = await invoke(app, { method: "POST", url: "/api/tasks", headers, body });
  expect(response.status).toBe(201);
  return response.body as { id: number; taskKey: string; waitingOn: { type: string; ref: string | null; label: string; since: string | null } | null };
}

async function runView(headers: Headers, id: string) {
  const list = await invoke(app, { method: "GET", url: `/api/task-views?today=${today}`, headers });
  const definition = (list.body.views as { id: string; definition: unknown }[]).find((view) => view.id === id)!.definition;
  const response = await invoke(app, { method: "GET", url: `/api/tasks?viewDef=${encodeViewDef(definition)}&today=${today}`, headers });
  expect(response.status).toBe(200);
  return response.body.tasks as { title: string; taskKey: string; followUpAt: string | null; signals: Record<string, unknown> }[];
}

const titles = (rows: { title: string }[]) => rows.map((row) => row.title);

async function makeQuiet(taskId: number, days = 9) {
  const old = `${shift(-days)}T09:00:00.000Z`;
  await db.update(tasks).set({ updatedAt: old }).where(eq(tasks.id, taskId));
  await db.update(taskEvents).set({ occurredAt: old }).where(eq(taskEvents.taskId, taskId));
}

async function createContact(headers: Headers, body: Record<string, unknown>) {
  return invoke(app, { method: "POST", url: "/api/contacts", headers, body });
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
  ]);
  await auth.createUser({ username: "manager-a", displayName: "A", password: "secret123", role: "manager" });
  await auth.createUser({ username: "manager-b", displayName: "B", password: "secret123", role: "manager", workspaceId: "default" });
  await auth.createUser({ username: "dev-user", displayName: "Dev", password: "secret123", role: "developer", developerAccountId: "dev-1" });
});

describe("/api/contacts (docs/57 §2)", () => {
  it("creates contacts with derived, unique handles; explicit duplicates 409", async () => {
    const headers = { cookie: await cookie("manager-a") };
    const first = await createContact(headers, { displayName: "Acme Legal" });
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({ displayName: "Acme Legal", handle: "acme-legal" });
    expect((await createContact(headers, { displayName: "Acme Legal" })).body.handle).toBe("acme-legal-2");
    expect((await createContact(headers, { displayName: "Vendor", handle: "acme-legal" })).status).toBe(409);
    expect((await createContact(headers, { displayName: "Bad", handle: "has space" })).status).toBe(400);
    const list = await invoke(app, { method: "GET", url: "/api/contacts", headers });
    expect(list.body.contacts.map((contact: { handle: string }) => contact.handle)).toEqual(["acme-legal", "acme-legal-2"]);
  });

  // docs/56 P3-03 review: an archived contact frees its handle; a create race is a 409, never a 500.
  it("reuses an archived contact's handle and answers concurrent creates cleanly", async () => {
    const headers = { cookie: await cookie("manager-a") };
    const first = await createContact(headers, { displayName: "Acme Legal", handle: "acme" });
    expect((await invoke(app, { method: "DELETE", url: `/api/contacts/${first.body.id}`, headers })).status).toBe(200);
    const again = await createContact(headers, { displayName: "Acme Legal (new)", handle: "acme" });
    expect(again.status).toBe(201);
    expect(again.body.handle).toBe("acme");

    const explicit = await Promise.all([
      createContact(headers, { displayName: "Vendor", handle: "vendor" }),
      createContact(headers, { displayName: "Vendor", handle: "vendor" }),
    ]);
    expect(explicit.map((res) => res.status).sort()).toEqual([201, 409]);

    const derived = await Promise.all([createContact(headers, { displayName: "Board" }), createContact(headers, { displayName: "Board" })]);
    expect(derived.map((res) => res.status)).toEqual([201, 201]);
    expect(derived.map((res) => res.body.handle).sort()).toEqual(["board", "board-2"]);
  });

  it("is private to the owning manager and manager-only", async () => {
    const a = { cookie: await cookie("manager-a") };
    const b = { cookie: await cookie("manager-b") };
    const created = await createContact(a, { displayName: "Acme Legal" });
    expect((await invoke(app, { method: "GET", url: "/api/contacts", headers: b })).body.contacts).toEqual([]);
    expect((await invoke(app, { method: "DELETE", url: `/api/contacts/${created.body.id}`, headers: b })).status).toBe(404);
    const dev = { cookie: await cookie("dev-user") };
    expect((await invoke(app, { method: "GET", url: "/api/contacts", headers: dev })).status).toBe(403);
    // Archiving hides it from the list.
    expect((await invoke(app, { method: "DELETE", url: `/api/contacts/${created.body.id}`, headers: a })).status).toBe(200);
    expect((await invoke(app, { method: "GET", url: "/api/contacts", headers: a })).body.contacts).toEqual([]);
  });
});

describe("waiting-on writes (docs/57 §2)", () => {
  it("resolves developers, own contacts and free text; rejects others", async () => {
    const a = { cookie: await cookie("manager-a") };
    const b = { cookie: await cookie("manager-b") };
    const contact = (await createContact(a, { displayName: "Acme Legal" })).body as { id: number };
    const dev = await createTask(a, { title: "Wait on dev", waitingOn: { type: "developer", ref: "dev-2" } });
    expect(dev.waitingOn).toMatchObject({ type: "developer", ref: "dev-2", label: "Dev Two" });
    expect(dev.waitingOn!.since).toBeTruthy();
    const external = await createTask(a, { title: "Wait on legal", waitingOn: { type: "contact", ref: String(contact.id) } });
    expect(external.waitingOn).toMatchObject({ type: "contact", ref: String(contact.id), label: "Acme Legal" });
    const text = await createTask(a, { title: "Wait on finance", waitingOn: { type: "text", label: "Finance team" } });
    expect(text.waitingOn).toMatchObject({ type: "text", ref: null, label: "Finance team" });

    const bad = async (headers: Headers, waitingOn: unknown) => (await invoke(app, { method: "POST", url: "/api/tasks", headers, body: { title: "x", waitingOn } })).status;
    expect(await bad(a, { type: "developer", ref: "nobody" })).toBe(400);
    expect(await bad(a, { type: "text" })).toBe(400);
    expect(await bad(b, { type: "contact", ref: String(contact.id) })).toBe(400);
    expect(await bad(a, { type: "developer", ref: "dev-1", since: "2020-01-01" })).toBe(400);
  });

  it("keeps `since` for the same party, restarts it on a new one, clears it with the party", async () => {
    const headers = { cookie: await cookie("manager-a") };
    const task = await createTask(headers, { title: "Chase", waitingOn: { type: "developer", ref: "dev-1" } });
    await db.update(tasks).set({ waitingSince: "2026-01-01T00:00:00.000Z" }).where(eq(tasks.id, task.id));
    const patch = (body: unknown) => invoke(app, { method: "PATCH", url: `/api/tasks/${task.taskKey}`, headers, body });
    expect((await patch({ waitingOn: { type: "developer", ref: "dev-1" } })).body.waitingOn.since).toBe("2026-01-01T00:00:00.000Z");
    expect((await patch({ waitingOn: { type: "developer", ref: "dev-2" } })).body.waitingOn.since).not.toBe("2026-01-01T00:00:00.000Z");
    expect((await patch({ waitingOn: null })).body.waitingOn).toBeNull();
    const row = (await db.select().from(tasks).where(eq(tasks.id, task.id)))[0]!;
    expect(row).toMatchObject({ waitingOnType: null, waitingOnRef: null, waitingOnLabel: null, waitingSince: null });
    // The change history is private: developers never see who a task waits on.
    const history = await db.select().from(taskEvents).where(eq(taskEvents.taskId, task.id));
    const waitingEvents = history.filter((event) => event.metaJson?.includes('"waiting_on"'));
    expect(waitingEvents.length).toBeGreaterThanOrEqual(2);
    expect(waitingEvents.every((event) => event.visibility === "private")).toBe(true);
  });

  it("never exposes waiting-on or contact links to developers", async () => {
    const headers = { cookie: await cookie("manager-a") };
    const contact = (await createContact(headers, { displayName: "Acme Legal" })).body as { id: number };
    const task = await createTask(headers, { title: "Dev task", ownerType: "developer", ownerId: "dev-1", waitingOn: { type: "contact", ref: String(contact.id) } });
    const linked = await invoke(app, { method: "POST", url: `/api/tasks/${task.taskKey}/links`, headers, body: { kind: "contact", ref: String(contact.id) } });
    expect(linked.status).toBe(201);
    const service = new TaskService();
    const row = (await service.getByKey(task.taskKey))!;
    const developer = { type: "developer" as const, accountId: "dev-1", workspaceId: "default" };
    const dto = await service.toDto(row, developer);
    expect(dto).not.toHaveProperty("waitingOn");
    expect(dto.links.some((link) => link.kind === "contact")).toBe(false);
    const surface = await service.surfaceDto(row, { date: today, principal: developer });
    expect(surface).not.toHaveProperty("waitingOn");
    expect(surface.links.some((link) => link.kind === "contact")).toBe(false);
    const linkEvents = (await db.select().from(taskEvents).where(eq(taskEvents.taskId, task.id))).filter((event) => event.type === "link");
    expect(linkEvents.every((event) => event.visibility === "private")).toBe(true);
    // Only my own contacts can be linked.
    const other = { cookie: await cookie("manager-b") };
    const otherContact = (await createContact(other, { displayName: "Not yours" })).body as { id: number };
    expect((await invoke(app, { method: "POST", url: `/api/tasks/${task.taskKey}/links`, headers, body: { kind: "contact", ref: String(otherContact.id) } })).status).toBe(404);
  });
});

describe("Waiting lens (docs/57 §4)", () => {
  it("includes explicit waits, quiet or due delegated work and legacy waits; excludes the rest", async () => {
    const headers = { cookie: await cookie("manager-a") };
    await createTask(headers, { title: "Mine waiting on legal", waitingOn: { type: "text", label: "Legal" } });
    await createTask(headers, { title: "Fresh delegated", ownerType: "developer", ownerId: "dev-1" });
    const quiet = await createTask(headers, { title: "Quiet delegated", ownerType: "developer", ownerId: "dev-2" });
    await makeQuiet(quiet.id);
    await createTask(headers, { title: "Check due delegated", ownerType: "developer", ownerId: "dev-1", followUpAt: `${shift(-1)}T09:00:00.000Z` });
    await createTask(headers, { title: "Legacy waiting label", labels: ["kind:waiting"] });
    await createTask(headers, { title: "My follow-up", followUpAt: `${shift(2)}T09:00:00.000Z` });
    const parked = await createTask(headers, { title: "Parked wait", later: true, waitingOn: { type: "text", label: "Legal" } });
    expect(parked.taskKey).toBeTruthy();

    const rows = await runView(headers, "waiting");
    expect(titles(rows).sort()).toEqual(["Check due delegated", "Legacy waiting label", "Mine waiting on legal", "Quiet delegated"]);
    // Check-by first (oldest due first), then longest waiting.
    expect(titles(rows)[0]).toBe("Check due delegated");
    const byTitle = new Map(rows.map((row) => [row.title, row.signals]));
    expect(byTitle.get("Quiet delegated")).toMatchObject({ stale: true, waitingDays: 9 });
    expect(byTitle.get("Mine waiting on legal")).toMatchObject({ waitingDays: 0 });
  });

  it("waiting tasks leave Planned today and are never Inbox", async () => {
    const headers = { cookie: await cookie("manager-a") };
    await createTask(headers, { title: "Planned", scheduledOn: today });
    await createTask(headers, { title: "Planned but waiting", scheduledOn: today, waitingOn: { type: "developer", ref: "dev-1" } });
    expect(titles(await runView(headers, "today"))).toEqual(["Planned"]);
    const lane = await invoke(app, { method: "GET", url: `/api/tasks?viewDef=${encodeViewDef({ filters: { lane: "waiting" } })}&today=${today}`, headers });
    expect(titles(lane.body.tasks)).toEqual(["Planned but waiting"]);
  });

  // docs/56 P3-03 review: unowned rows are visible to every manager, but the party stays private.
  it("another manager never sees my unowned task as waiting", async () => {
    const a = { cookie: await cookie("manager-a") };
    const b = { cookie: await cookie("manager-b") };
    const task = await createTask(a, { title: "Unowned wait", waitingOn: { type: "text", label: "Legal" } });
    await db.update(tasks).set({ ownerType: null, ownerId: null }).where(eq(tasks.id, task.id));

    expect(titles(await runView(a, "waiting"))).toEqual(["Unowned wait"]);
    expect(titles(await runView(b, "waiting"))).toEqual([]);
    const byFilter = async (headers: Headers, filters: Record<string, unknown>) =>
      titles((await invoke(app, { method: "GET", url: `/api/tasks?viewDef=${encodeViewDef({ filters })}&today=${today}`, headers })).body.tasks);
    expect(await byFilter(b, { waitingOn: true })).toEqual([]);
    expect(await byFilter(b, { waitingOn: false })).toEqual(["Unowned wait"]);
    expect(await byFilter(b, { lane: "waiting" })).toEqual([]);
    expect(await byFilter(a, { waitingOn: true })).toEqual(["Unowned wait"]);
    expect(await byFilter(a, { lane: "waiting" })).toEqual(["Unowned wait"]);
    const counts = await invoke(app, { method: "GET", url: `/api/tasks/view-counts?today=${today}`, headers: b });
    expect(counts.body.counts.waiting.count).toBe(0);
  });

  it("counts match the list for the Waiting view", async () => {
    const headers = { cookie: await cookie("manager-a") };
    await createTask(headers, { title: "Wait", waitingOn: { type: "text", label: "Legal" } });
    const quiet = await createTask(headers, { title: "Quiet", ownerType: "developer", ownerId: "dev-1" });
    await makeQuiet(quiet.id);
    const counts = await invoke(app, { method: "GET", url: `/api/tasks/view-counts?today=${today}`, headers });
    expect(counts.body.counts.waiting.count).toBe((await runView(headers, "waiting")).length);
  });
});

describe("capture: /w and /f @who (docs/57 §3)", () => {
  const capture = (headers: Headers, text: string) =>
    invoke(app, { method: "POST", url: "/api/capture", headers, body: { text, clientToday: today } });

  it("/w @dev !date waits on the developer with a check-by, owned by me and triaged", async () => {
    const headers = { cookie: await cookie("manager-a") };
    const res = await capture(headers, "Review the RFC /w @dev-1 !+2d");
    expect(res.status).toBe(200);
    expect(res.body.task).toMatchObject({ title: "Review the RFC", ownerType: "manager", scheduledOn: null, needsTriage: false });
    expect(res.body.task.waitingOn).toMatchObject({ type: "developer", ref: "dev-1", label: "Dev One" });
    expect(res.body.task.followUpAt).toBe(new Date(`${shift(2)}T09:00:00`).toISOString());
    expect(titles(await runView(headers, "waiting"))).toEqual(["Review the RFC"]);
  });

  it("/w resolves my contacts; unknown people are blocked with a contact suggestion", async () => {
    const headers = { cookie: await cookie("manager-a") };
    const unknown = await capture(headers, "NDA /w @acme-legal");
    expect(unknown.body.blocked).toBe(true);
    expect(unknown.body.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: "unknown-person", suggestContact: "acme-legal" })]));
    const contact = (await createContact(headers, { displayName: "Acme Legal" })).body as { id: number };
    const res = await capture(headers, "NDA /w @acme-legal");
    expect(res.body.task.waitingOn).toMatchObject({ type: "contact", ref: String(contact.id), label: "Acme Legal" });
    // Another manager's contacts are not in scope.
    const other = { cookie: await cookie("manager-b") };
    expect((await capture(other, "NDA /w @acme-legal")).body.blocked).toBe(true);
  });

  it("/f @dev is the same as /w; a contact @ without /w links", async () => {
    const headers = { cookie: await cookie("manager-a") };
    const delegated = await capture(headers, "Rollout status /f @dev-2");
    expect(delegated.body.task.waitingOn).toMatchObject({ type: "developer", ref: "dev-2" });
    expect(delegated.body.task.labels).toContain("category:follow_up");
    const contact = (await createContact(headers, { displayName: "Acme Legal" })).body as { id: number };
    const linked = await capture(headers, "Contract notes @acme-legal");
    expect(linked.body.task.ownerType).toBe("manager");
    expect(linked.body.task.links).toEqual([expect.objectContaining({ kind: "contact", ref: String(contact.id) })]);
  });
});
