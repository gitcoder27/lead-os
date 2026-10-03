import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import express from "express";
import type { ManagerTask } from "shared/types";
import { db, resetDatabase } from "./helpers/db";
import { invoke } from "./helpers/http";
import { appUsers, configTable, developers, tasks } from "../src/db/schema";
import { canonicalTaskTools } from "../src/assistant/task-tools";
import type { AssistantToolContext } from "../src/assistant/tools";
import { AuthService, serializeSessionCookie } from "../src/services/auth.service";
import { TaskService } from "../src/services/task.service";
import { TaskViewsService, builtinTaskViews } from "../src/services/task-views.service";
import { TodayPlanService } from "../src/services/today-plan.service";
import { TaskKeysService } from "../src/services/task-keys.service";
import { TaskEventsService } from "../src/services/task-events.service";
import { createTasksRouter } from "../src/routes/tasks";
import { requireManager } from "../src/middleware/auth";
import { errorHandler } from "../src/middleware/errorHandler";

const manager = { type: "manager" as const, accountId: "ayan", workspaceId: "default" };
const copilot = { ...manager, type: "copilot" as const };
const date = "2026-10-03";
const service = new TaskService();
const auth = new AuthService();
const tools = canonicalTaskTools();
const context = { managerAccountId: manager.accountId, workspaceId: manager.workspaceId } as AssistantToolContext;
const app = express();
app.use("/api/tasks", requireManager(auth), createTasksRouter(new TaskKeysService(), new TaskEventsService()));
app.use(errorHandler);

const runTool = async (name: string, args: Record<string, unknown>) =>
  tools.find((tool) => tool.name === name)!.execute(args, context);

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-03T08:30:00.000Z"));
  await resetDatabase();
  await db.insert(configTable).values([
    { key: "tasks_phase1_enabled", value: "true" },
    { key: "tasks_phase2_stage", value: "2c" },
    { key: "tasks_phase3_enabled", value: "true" },
  ]);
  await db.insert(developers).values([
    { accountId: "roster-ayan", displayName: "Ayan", isActive: 1 },
    { accountId: "linked-manager", displayName: "Linked", isActive: 1 },
  ]);
  await auth.createUser({ username: "ayan", displayName: "Ayan", password: "secret123", role: "manager" });
  await auth.createUser({ username: "other", displayName: "Other", password: "secret123", role: "manager", workspaceId: "default" });
});

afterEach(() => vi.useRealTimers());

describe("manager task ownership", () => {
  it("defaults Copilot tasks to the manager and shows them in Tasks and Today's plan", async () => {
    const result = await runTool("create_task", { title: "My commitment", scheduledOn: date }) as { result: ManagerTask; summary: string };
    expect(result.summary).toBe("Create task");
    expect(result.result).toMatchObject({ ownerType: "manager", ownerId: "ayan", createdByType: "copilot", trackedByManagerId: "ayan" });
    expect(result.result.legacyDeskItemId).toBe(result.result.id);
    const { sessionId } = await auth.authenticate("ayan", "secret123");
    const headers = { cookie: serializeSessionCookie(sessionId, auth.sessionMaxAgeSeconds) };
    for (const id of ["today", "my-tasks", "attention", "inbox"]) {
      const definition = builtinTaskViews(date).find((view) => view.id === id)!.definition;
      const encoded = Buffer.from(JSON.stringify(definition)).toString("base64url");
      const response = await invoke(app, { method: "GET", url: `/api/tasks?viewDef=${encoded}&today=${date}&tz=Asia%2FKolkata`, headers });
      expect(response.status).toBe(200);
      expect(response.body.tasks.some((task: ManagerTask) => task.taskKey === result.result.taskKey)).toBe(["today", "my-tasks"].includes(id));
    }
    expect((await new TodayPlanService().build(manager, date, "Asia/Kolkata")).items.map((task) => task.taskKey)).toContain(result.result.taskKey);
  });

  it("rejects the reported pairing through Copilot without leaving a task or event", async () => {
    await expect(runTool("create_task", { title: "Mistaken owner", ownerType: "manager", ownerId: "roster-ayan", scheduledOn: date })).rejects.toMatchObject({ status: 400, message: expect.stringContaining('omit ownerId') });
    expect(await db.select().from(tasks)).toEqual([]);
    expect(await new TaskEventsService().listRawForWorkspace()).toEqual([]);
  });

  it("rejects bad owner changes through the API and preserves the existing task", async () => {
    const row = await service.create({ title: "Keep mine" }, manager);
    const { sessionId } = await auth.authenticate("ayan", "secret123");
    const headers = { cookie: serializeSessionCookie(sessionId, auth.sessionMaxAgeSeconds) };
    const created = await invoke(app, { method: "POST", url: "/api/tasks", headers, body: { title: "Wrong identity", ownerType: "manager", ownerId: "roster-ayan" } });
    expect(created.status).toBe(400);
    expect(created.body).toMatchObject({ status: 400, error: expect.stringContaining('omit ownerId') });
    const response = await invoke(app, { method: "PATCH", url: `/api/tasks/${row.taskKey}`, headers, body: { ownerId: "roster-ayan" } });
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ status: 400, error: expect.stringContaining('ownerType="developer"') });
    expect(await service.requireTask(row.taskKey, manager)).toMatchObject({ ownerId: "ayan" });
  });

  it("allows actual manager identities, including legacy linked session IDs", async () => {
    expect(await service.create({ title: "Other manager", ownerType: "manager", ownerId: "other" }, copilot)).toMatchObject({ ownerId: "other" });
    await auth.createUser({ username: "linked", displayName: "Linked", password: "secret123", role: "manager", developerAccountId: "linked-manager", workspaceId: "default" });
    expect(await service.create({ title: "Legacy linked", ownerType: "manager", ownerId: "linked-manager" }, manager)).toMatchObject({ ownerId: "linked-manager" });
    await expect(service.create({ title: "Wrong login", ownerType: "manager", ownerId: "linked" }, manager)).rejects.toMatchObject({ status: 400 });
  });

  it("rejects missing, inactive, developer-only and other-workspace manager IDs", async () => {
    await auth.createUser({ username: "elsewhere", displayName: "Elsewhere", password: "secret123", role: "manager" });
    await auth.createUser({ username: "dev-login", displayName: "Developer", password: "secret123", role: "developer", developerAccountId: "roster-ayan", workspaceId: "default" });
    await db.update(appUsers).set({ isActive: 0 }).where(eq(appUsers.username, "other"));
    for (const ownerId of ["unknown", "other", "roster-ayan", "elsewhere"]) {
      await expect(service.create({ title: "Invalid", ownerType: "manager", ownerId }, manager)).rejects.toMatchObject({ status: 400 });
    }
    expect(await db.select().from(tasks)).toEqual([]);
  });

  it("assigns developer work to me without needing an ID and records the reassignment", async () => {
    const row = await service.create({ title: "Take over", ownerType: "developer", ownerId: "roster-ayan", status: "active", scheduledOn: date }, manager);
    const result = await runTool("update_task", { taskKey: row.taskKey, ownerType: "manager" }) as { result: ManagerTask };
    expect(result.result).toMatchObject({ ownerType: "manager", ownerId: "ayan", status: "open" });
    const assignment = (await new TaskEventsService().listRawForWorkspace()).find((event) => event.type === "assign");
    expect(JSON.parse(assignment!.metaJson!)).toMatchObject({ fromType: "developer", fromId: "roster-ayan", toType: "manager", toId: "ayan" });
  });

  it("repairs an old malformed row by T-number without guessing and keeps cleanup available", async () => {
    const row = await service.create({ title: "Old mistake", scheduledOn: date }, copilot);
    await db.update(tasks).set({ ownerId: "roster-ayan" }).where(eq(tasks.id, row.id));
    // Unrelated edits do not strand older malformed tasks behind the new write validation.
    await service.update(row.taskKey, { title: "Repair me" }, manager);
    const result = await runTool("update_task", { taskKey: row.taskKey, ownerType: "manager" }) as { result: ManagerTask };
    expect(result.result.ownerId).toBe("ayan");
    const definition = builtinTaskViews(date).find((view) => view.id === "today")!.definition;
    expect((await new TaskViewsService().run(manager, definition, date)).map((task) => task.taskKey)).toContain(row.taskKey);
    await db.update(tasks).set({ ownerId: "roster-ayan" }).where(eq(tasks.id, row.id));
    await runTool("delete_task", { taskKey: row.taskKey });
    expect((await service.getById(row.id, "default"))!.deletedAt).not.toBeNull();
  });

  it("keeps explicit null ownership and correct developer assignments unchanged", async () => {
    expect(await service.create({ title: "Unowned", ownerType: null, ownerId: null }, manager)).toMatchObject({ ownerType: null, ownerId: null });
    expect(await service.create({ title: "Roster work", ownerType: "developer", ownerId: "roster-ayan" }, copilot)).toMatchObject({ ownerType: "developer", ownerId: "roster-ayan" });
    await expect(service.create({ title: "Missing pair", ownerType: "manager", ownerId: null }, manager)).rejects.toMatchObject({ status: 400 });
  });
});
