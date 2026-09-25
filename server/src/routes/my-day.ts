import { Router } from "express";
import { z } from "zod";
import { requireDeveloper } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { AuthService } from "../services/auth.service";
import { IssueService } from "../services/issue.service";
import { MyDayService } from "../services/my-day.service";
import { taskCreateSchema, taskUpdateSchema, TaskService } from "../services/task.service";

const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD");

const dateQuerySchema = z.object({
  query: z.object({
    date: isoDateSchema,
  }),
  body: z.any().optional(),
  params: z.any().optional(),
});

const patchDaySchema = z.object({
  body: z.object({
    date: isoDateSchema,
    status: z
      .enum(["on_track", "at_risk", "blocked", "waiting", "done_for_today"])
      .optional(),
  }).refine((value) => value.status !== undefined, { message: "At least one day field is required" }),
  query: z.any().optional(),
  params: z.any().optional(),
});

const addItemSchema = z.object({
  body: z.object({
    date: isoDateSchema,
    jiraKey: z.string().trim().optional(),
    relatedIssueKeys: z.array(z.string().trim().min(1)).max(20).optional(),
    title: z.string().trim().min(1).max(500),
    note: z.string().trim().max(2000).optional(),
  }),
  query: z.any().optional(),
  params: z.any().optional(),
});

const updateItemSchema = z.object({
  params: z.object({
    itemId: z.string().regex(/^(\d+|[Tt]-\d{1,9})$/, "Invalid item id or task key"),
  }),
  body: z.object({
    date: isoDateSchema,
    title: z.string().trim().min(1).max(500).optional(),
    state: z.enum(["planned", "in_progress", "done", "dropped"]).optional(),
    note: z.string().trim().max(2000).nullable().optional(),
    position: z.number().int().min(0).optional(),
  }).refine(
    (value) =>
      value.title !== undefined ||
      value.state !== undefined ||
      value.note !== undefined ||
      value.position !== undefined,
    { message: "At least one item field is required" }
  ),
  query: z.any().optional(),
});

const deleteItemSchema = z.object({
  params: z.object({
    itemId: z.string().regex(/^(\d+|[Tt]-\d{1,9})$/, "Invalid item id or task key"),
  }),
  query: z.object({
    date: isoDateSchema,
  }),
  body: z.any().optional(),
});

const setCurrentSchema = z.object({
  params: z.object({
    itemId: z.string().regex(/^(\d+|[Tt]-\d{1,9})$/, "Invalid item id or task key"),
  }),
  body: z.object({
    date: isoDateSchema,
  }),
  query: z.any().optional(),
});

const addCheckInSchema = z.object({
  body: z.object({
    date: isoDateSchema,
    summary: z.string().trim().min(1).max(2000),
    status: z
      .enum(["on_track", "at_risk", "blocked", "waiting", "done_for_today"])
      .optional(),
    taskKeys: z.array(z.string().trim().regex(/^[Tt]-\d{1,9}$/)).max(10).optional(),
  }),
  query: z.any().optional(),
  params: z.any().optional(),
});

export function createMyDayRouter(
  myDayService: MyDayService,
  authService: AuthService,
  issueService: IssueService
): Router {
  const router = Router();
  const tasks = new TaskService();
  const itemRefToId = (ref: string, workspaceId?: string) =>
    tasks.surfaceIdForRef("team_tracker_items", ref, workspaceId);

  router.use(requireDeveloper(authService));
  router.get("/tasks", validate(dateQuerySchema), async (req, res, next) => {
    try { res.json(await myDayService.nativeTasks(req.auth!.user.developerAccountId!, req.query.date as string, req.auth!.user.workspaceId)); } catch (error) { next(error); }
  });
  router.post("/tasks", validate(z.object({ body: taskCreateSchema.extend({ date: isoDateSchema }), query: z.any().optional(), params: z.any().optional() })), async (req, res, next) => {
    try { const { date, ...input } = req.body; res.status(201).json(await myDayService.mutateTask(req.auth!.user.developerAccountId!, date, input, req.auth!.user.workspaceId)); } catch (error) { next(error); }
  });
  router.patch("/tasks/:key", validate(z.object({ body: taskUpdateSchema.extend({ date: isoDateSchema }), query: z.any().optional(), params: z.object({ key: z.string().regex(/^[Tt]-\d{1,9}$/) }) })), async (req, res, next) => {
    try { const { date, ...input } = req.body; res.json(await myDayService.mutateTask(req.auth!.user.developerAccountId!, date, input, req.auth!.user.workspaceId, req.params.key as string)); } catch (error) { next(error); }
  });

  const taskParams = z.object({ key: z.string().trim().regex(/^[Tt]-\d{1,9}$/) });
  router.get("/tasks/:key", validate(z.object({ params: taskParams, body: z.any().optional(), query: z.any().optional() })), async (req, res, next) => {
    try { res.json(await myDayService.resolveTask(req.auth!.user.developerAccountId!, req.params.key as string, req.auth!.user.workspaceId)); } catch (error) { next(error); }
  });
  router.get("/tasks/:key/events", validate(z.object({ params: taskParams, body: z.any().optional(), query: z.object({ cursor: z.string().regex(/^\d+$/).optional(), limit: z.coerce.number().int().min(1).max(100).optional() }) })), async (req, res, next) => {
    try { res.json(await myDayService.getTaskEvents(req.auth!.user.developerAccountId!, req.params.key as string, { cursor: req.query.cursor as string | undefined, limit: req.query.limit ? Number(req.query.limit) : undefined }, req.auth!.user.workspaceId)); } catch (error) { next(error); }
  });
  router.post("/tasks/:key/events", validate(z.object({ params: taskParams, query: z.any().optional(), body: z.object({ date: isoDateSchema, type: z.enum(["update", "blocker", "instruction", "decision"]), body: z.string().trim().min(1).max(4000), blockerAction: z.enum(["raised", "cleared"]).optional(), visibility: z.enum(["shared", "private"]).optional(), requestId: z.string().uuid() }).superRefine((body, ctx) => { if (body.type === "blocker" && !body.blockerAction) ctx.addIssue({ code: "custom", message: "blockerAction required" }); }) })), async (req, res, next) => {
    try {
      const { event, replayed } = await myDayService.addTaskEvent(req.auth!.user.developerAccountId!, req.params.key as string, req.body, req.auth!.user.workspaceId);
      res.status(replayed ? 200 : 201).json(event);
    } catch (error) { next(error); }
  });

  router.get("/issues", async (req, res, next) => {
    try {
      const accountId = req.auth!.user.developerAccountId!;
      const issues = await issueService.getAll({ assignee: accountId }, req.auth!.user.workspaceId);
      res.json({ issues });
    } catch (error) {
      next(error);
    }
  });

  router.get("/", validate(dateQuerySchema), async (req, res, next) => {
    try {
      const date = req.query.date as string;
      const accountId = req.auth!.user.developerAccountId!;
      const day = await myDayService.getMyDay(accountId, date, req.auth!.user.workspaceId);
      if (day.taskModel === "canonical") {
        day.currentItem = undefined;
        day.plannedItems = [];
        day.completedItems = [];
        day.droppedItems = [];
      }
      res.json(day);
    } catch (error) {
      next(error);
    }
  });

  router.patch("/", validate(patchDaySchema), async (req, res, next) => {
    try {
      const accountId = req.auth!.user.developerAccountId!;
      const { date, status } = req.body;
      const day = await myDayService.updateStatus(accountId, date, status, req.auth!.user.workspaceId);
      res.json(day);
    } catch (error) {
      next(error);
    }
  });

  router.post("/items", validate(addItemSchema), async (req, res, next) => {
    try {
      const accountId = req.auth!.user.developerAccountId!;
      const item = await myDayService.addItem(accountId, req.body, req.auth!.user.workspaceId);
      res.status(201).json(item);
    } catch (error) {
      next(error);
    }
  });

  router.patch("/items/:itemId", validate(updateItemSchema), async (req, res, next) => {
    try {
      const accountId = req.auth!.user.developerAccountId!;
      const itemId = await itemRefToId(req.params.itemId as string, req.auth!.user.workspaceId);
      const { date, ...updates } = req.body;
      const item = await myDayService.updateItem(accountId, itemId, date, updates, req.auth!.user.workspaceId);
      res.json(item);
    } catch (error) {
      next(error);
    }
  });

  router.delete("/items/:itemId", validate(deleteItemSchema), async (req, res, next) => {
    try {
      const accountId = req.auth!.user.developerAccountId!;
      const itemId = await itemRefToId(req.params.itemId as string, req.auth!.user.workspaceId);
      await myDayService.deleteItem(accountId, itemId, req.query.date as string, req.auth!.user.workspaceId);
      res.json({ deleted: true });
    } catch (error) {
      next(error);
    }
  });

  router.post(
    "/items/:itemId/set-current",
    validate(setCurrentSchema),
    async (req, res, next) => {
      try {
        const accountId = req.auth!.user.developerAccountId!;
        const itemId = await itemRefToId(req.params.itemId as string, req.auth!.user.workspaceId);
        const item = await myDayService.setCurrentItem(accountId, itemId, req.body.date, req.auth!.user.workspaceId);
        res.json(item);
      } catch (error) {
        next(error);
      }
    }
  );

  router.post("/checkins", validate(addCheckInSchema), async (req, res, next) => {
    try {
      const accountId = req.auth!.user.developerAccountId!;
      const { date, summary, status, taskKeys } = req.body;
      const checkIn = await myDayService.addCheckIn(accountId, date, {
        summary,
        status,
        taskKeys,
      }, req.auth!.user.workspaceId);
      res.status(201).json(checkIn);
    } catch (error) {
      next(error);
    }
  });

  return router;
}
