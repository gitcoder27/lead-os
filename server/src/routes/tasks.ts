import { Router } from "express";
import { z } from "zod";
import { validate } from "../middleware/validate";
import { HttpError } from "../middleware/errorHandler";
import { TaskEventsService } from "../services/task-events.service";
import { TaskKeysService } from "../services/task-keys.service";
import { TaskService, taskCreateSchema, taskUpdateSchema, taskLinkSchema, type TaskPrincipal } from "../services/task.service";
import type { Request } from "express";

const key = z.string().trim().regex(/^[Tt]-\d{1,9}$/);
const params = z.object({ key });
const eventParams = params.extend({ eventId: z.string().regex(/^\d+$/) });
const add = z.object({
  params, query: z.any().optional(),
  body: z.object({
    type: z.enum(["update", "instruction", "decision", "blocker"]),
    body: z.string().trim().min(1).max(4000),
    visibility: z.enum(["shared", "private"]).optional(),
    blockerAction: z.enum(["raised", "cleared"]).optional(),
    via: z.enum(["standup", "task_drawer"]).optional(),
    requestId: z.string().uuid(),
  }).superRefine((body, ctx) => {
    if (body.type === "blocker" && !body.blockerAction) ctx.addIssue({ code: "custom", message: "blockerAction required" });
    if (body.type !== "blocker" && body.blockerAction) ctx.addIssue({ code: "custom", message: "blockerAction only applies to blockers" });
  }),
});

export function createTasksRouter(keys: TaskKeysService, events: TaskEventsService): Router {
  const router = Router();
  const tasks = new TaskService();
  const principal = (req: Request): TaskPrincipal => ({ type: "manager", accountId: req.auth!.user.accountId, workspaceId: req.auth!.user.workspaceId });
  const assertCanonical = async (req: Request) => {
    if (!(await keys.canonicalEnabled(req.auth!.user.workspaceId))) throw new HttpError(404, "Canonical tasks are not enabled");
  };
  router.get("/", validate(z.object({ params: z.any().optional(), body: z.any().optional(), query: z.object({ view: z.enum(["desk", "follow-ups", "meetings", "developer", "all"]).optional(), ownerId: z.string().optional(), date: z.string().optional(), closedFrom: z.string().optional(), closedTo: z.string().optional() }) })), async (req, res, next) => {
    try {
      await assertCanonical(req);
      const actor = principal(req);
      const rows = await tasks.list(actor, req.query as Parameters<TaskService["list"]>[1]);
      res.json({ tasks: await Promise.all(rows.map((row) => tasks.toDto(row, actor))) });
    } catch (error) { next(error); }
  });
  router.post("/", validate(z.object({ body: taskCreateSchema, params: z.any().optional(), query: z.any().optional() })), async (req, res, next) => {
    try { await assertCanonical(req); const actor = principal(req); res.status(201).json(await tasks.toDto(await tasks.create(req.body, actor), actor)); } catch (error) { next(error); }
  });
  router.get("/:key/detail", validate(z.object({ params, body: z.any().optional(), query: z.any().optional() })), async (req, res, next) => {
    try { await assertCanonical(req); const actor = principal(req); res.json(await tasks.toDto(await tasks.requireTask(req.params.key as string, actor), actor)); } catch (error) { next(error); }
  });
  router.patch("/:key", validate(z.object({ params, body: taskUpdateSchema, query: z.any().optional() })), async (req, res, next) => {
    try { await assertCanonical(req); const actor = principal(req); res.json(await tasks.toDto(await tasks.update(req.params.key as string, req.body, actor), actor)); } catch (error) { next(error); }
  });
  router.delete("/:key", validate(z.object({ params, body: z.any().optional(), query: z.any().optional() })), async (req, res, next) => {
    try { await assertCanonical(req); await tasks.remove(req.params.key as string, principal(req)); res.json({ deleted: true }); } catch (error) { next(error); }
  });
  router.post("/:key/links", validate(z.object({ params, body: taskLinkSchema, query: z.any().optional() })), async (req, res, next) => {
    try { await assertCanonical(req); res.status(201).json(await tasks.addLink(req.params.key as string, req.body, principal(req))); } catch (error) { next(error); }
  });
  router.delete("/:key/links/:linkId", validate(z.object({ params: params.extend({ linkId: z.coerce.number().int().positive() }), body: z.any().optional(), query: z.any().optional() })), async (req, res, next) => {
    try { await assertCanonical(req); await tasks.removeLink(req.params.key as string, Number(req.params.linkId), principal(req)); res.json({ deleted: true }); } catch (error) { next(error); }
  });
  router.get("/:key", validate(z.object({ params, body: z.any().optional(), query: z.any().optional() })), async (req, res, next) => {
    try {
      const task = await keys.resolveTask(req.auth!.user.workspaceId, req.params.key as string);
      res.status(task.deleted ? 410 : 200).json(task);
    } catch (error) { next(error); }
  });
  router.get("/:key/events", validate(z.object({ params, body: z.any().optional(), query: z.object({ cursor: z.string().regex(/^\d+$/).optional(), limit: z.coerce.number().int().min(1).max(100).optional() }) })), async (req, res, next) => {
    try {
      await keys.resolveTask(req.auth!.user.workspaceId, req.params.key as string);
      res.json(await events.list(req.params.key as string, { kind: "manager", accountId: req.auth!.user.accountId, workspaceId: req.auth!.user.workspaceId }, { cursor: req.query.cursor as string | undefined, limit: req.query.limit ? Number(req.query.limit) : undefined }));
    } catch (error) { next(error); }
  });
  router.post("/:key/events", validate(add), async (req, res, next) => {
    try {
      const resolved = await keys.resolveTask(req.auth!.user.workspaceId, req.params.key as string);
      if (resolved.deleted) throw new HttpError(410, "Task was deleted");
      const { type, body, visibility, blockerAction, via, requestId } = req.body;
      const meta = type === "blocker" ? { action: blockerAction } : { via };
      const { event, replayed } = await events.appendWithReplay({ workspaceId: req.auth!.user.workspaceId, taskKey: resolved.taskKey, type, body, meta, visibility, requestId }, { type: "manager", accountId: req.auth!.user.accountId });
      res.status(replayed ? 200 : 201).json(event);
    } catch (error) { next(error); }
  });
  router.patch("/:key/events/:eventId", validate(z.object({ params: eventParams, body: z.object({ visibility: z.enum(["shared", "private"]) }), query: z.any().optional() })), async (req, res, next) => {
    try {
      const resolved = await keys.resolveTask(req.auth!.user.workspaceId, req.params.key as string);
      res.json(await events.changeVisibility(resolved.taskKey, Number(req.params.eventId), req.auth!.user.accountId, req.body.visibility, req.auth!.user.workspaceId));
    } catch (error) { next(error); }
  });
  router.delete("/:key/events/:eventId", validate(z.object({ params: eventParams, body: z.any().optional(), query: z.any().optional() })), async (req, res, next) => {
    try {
      const resolved = await keys.resolveTask(req.auth!.user.workspaceId, req.params.key as string);
      await events.redact(resolved.taskKey, Number(req.params.eventId), req.auth!.user.accountId, req.auth!.user.workspaceId);
      res.json({ redacted: true });
    } catch (error) { next(error); }
  });
  return router;
}
