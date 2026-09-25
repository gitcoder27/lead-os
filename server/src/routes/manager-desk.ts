import { Router } from "express";
import { z } from "zod";
import { requireManager } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { AuthService } from "../services/auth.service";
import { ManagerDeskService } from "../services/manager-desk.service";
import { TaskService } from "../services/task.service";

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
const isoDateTimeSchema = z.string().datetime({ offset: true });

const managerDeskEnums = {
  kind: z.enum(["action", "meeting", "decision", "waiting"]),
  category: z.enum([
    "analysis",
    "design",
    "team_management",
    "cross_team",
    "follow_up",
    "escalation",
    "admin",
    "planning",
    "other",
  ]),
  status: z.enum(["inbox", "planned", "in_progress", "waiting", "backlog", "done", "cancelled"]),
  priority: z.enum(["low", "medium", "high", "critical"]),
  linkType: z.enum(["issue", "developer", "external_group"]),
};

const managerDeskLinkSchema = z
  .object({
    linkType: managerDeskEnums.linkType,
    issueKey: z.string().trim().min(1).max(100).optional(),
    developerAccountId: z.string().trim().min(1).max(200).optional(),
    externalLabel: z.string().trim().min(1).max(300).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.linkType === "issue") {
      if (!value.issueKey) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["issueKey"],
          message: "issueKey is required for issue links",
        });
      }
      if (value.developerAccountId || value.externalLabel) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["linkType"],
          message: "Issue links may only include issueKey",
        });
      }
    }

    if (value.linkType === "developer") {
      if (!value.developerAccountId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["developerAccountId"],
          message: "developerAccountId is required for developer links",
        });
      }
      if (value.issueKey || value.externalLabel) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["linkType"],
          message: "Developer links may only include developerAccountId",
        });
      }
    }

    if (value.linkType === "external_group") {
      if (!value.externalLabel) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["externalLabel"],
          message: "externalLabel is required for external_group links",
        });
      }
      if (value.issueKey || value.developerAccountId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["linkType"],
          message: "External group links may only include externalLabel",
        });
      }
    }
  });

const dateQuerySchema = z.object({
  query: z.object({
    date: z.string().regex(dateRegex, "date must be YYYY-MM-DD"),
  }),
  params: z.any().optional(),
  body: z.any().optional(),
});

const createItemSchema = z.object({
  body: z
    .object({
      date: z.string().regex(dateRegex, "date must be YYYY-MM-DD"),
      title: z.string().min(1).max(500),
      kind: managerDeskEnums.kind.optional(),
      category: managerDeskEnums.category.optional(),
      status: managerDeskEnums.status.optional(),
      priority: managerDeskEnums.priority.optional(),
      assigneeDeveloperAccountId: z.string().trim().min(1).max(200).nullable().optional(),
      participants: z.string().max(500).nullable().optional(),
      contextNote: z.string().max(5000).nullable().optional(),
      nextAction: z.string().max(2000).nullable().optional(),
      outcome: z.string().max(5000).nullable().optional(),
      plannedStartAt: isoDateTimeSchema.nullable().optional(),
      plannedEndAt: isoDateTimeSchema.nullable().optional(),
      followUpAt: isoDateTimeSchema.nullable().optional(),
      links: z.array(managerDeskLinkSchema).optional(),
    })
    .superRefine((value, ctx) => {
      if (value.plannedStartAt && value.plannedEndAt) {
        if (new Date(value.plannedEndAt).getTime() < new Date(value.plannedStartAt).getTime()) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["plannedEndAt"],
            message: "plannedEndAt must be greater than or equal to plannedStartAt",
          });
        }
      }
    }),
  params: z.any().optional(),
  query: z.any().optional(),
});

const itemIdParamSchema = z.object({
  params: z.object({
    itemId: z.string().regex(/^(\d+|[Tt]-\d{1,9})$/, "Invalid item id or task key"),
  }),
  body: z.any().optional(),
  query: z.any().optional(),
});

const trackerItemIdParamSchema = z.object({
  params: z.object({
    trackerItemId: z.string().regex(/^(\d+|[Tt]-\d{1,9})$/, "Invalid tracker item id or task key"),
  }),
  body: z.any().optional(),
  query: z.any().optional(),
});

const updateItemSchema = z.object({
  params: z.object({
    itemId: z.string().regex(/^(\d+|[Tt]-\d{1,9})$/, "Invalid item id or task key"),
  }),
  body: z
    .object({
      title: z.string().min(1).max(500).optional(),
      kind: managerDeskEnums.kind.optional(),
      category: managerDeskEnums.category.optional(),
      status: managerDeskEnums.status.optional(),
      priority: managerDeskEnums.priority.optional(),
      assigneeDeveloperAccountId: z.string().trim().min(1).max(200).nullable().optional(),
      participants: z.string().max(500).nullable().optional(),
      contextNote: z.string().max(5000).nullable().optional(),
      nextAction: z.string().max(2000).nullable().optional(),
      outcome: z.string().max(5000).nullable().optional(),
      plannedStartAt: isoDateTimeSchema.nullable().optional(),
      plannedEndAt: isoDateTimeSchema.nullable().optional(),
      followUpAt: isoDateTimeSchema.nullable().optional(),
    })
    .refine((value) => Object.keys(value).length > 0, {
      message: "At least one field is required",
    })
    .superRefine((value, ctx) => {
      if (value.plannedStartAt && value.plannedEndAt) {
        if (new Date(value.plannedEndAt).getTime() < new Date(value.plannedStartAt).getTime()) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["plannedEndAt"],
            message: "plannedEndAt must be greater than or equal to plannedStartAt",
          });
        }
      }
    }),
  query: z.any().optional(),
});

const linkSchema = z.object({
  params: z.object({
    itemId: z.string().regex(/^(\d+|[Tt]-\d{1,9})$/, "Invalid item id or task key"),
  }),
  body: managerDeskLinkSchema,
  query: z.any().optional(),
});

const deleteLinkSchema = z.object({
  params: z.object({
    itemId: z.string().regex(/^(\d+|[Tt]-\d{1,9})$/, "Invalid item id or task key"),
    linkId: z.string().regex(/^\d+$/, "Invalid link id"),
  }),
  body: z.any().optional(),
  query: z.any().optional(),
});

const carryForwardSchema = z.object({
  body: z.object({
    fromDate: z.string().regex(dateRegex, "fromDate must be YYYY-MM-DD"),
    toDate: z.string().regex(dateRegex, "toDate must be YYYY-MM-DD"),
    itemIds: z.array(z.number().int().positive()).optional(),
  }),
  params: z.any().optional(),
  query: z.any().optional(),
});

const carryForwardPreviewSchema = z.object({
  query: z.object({
    fromDate: z.string().regex(dateRegex, "fromDate must be YYYY-MM-DD"),
    toDate: z.string().regex(dateRegex, "toDate must be YYYY-MM-DD"),
  }),
  params: z.any().optional(),
  body: z.any().optional(),
});

const carryForwardContextSchema = z.object({
  query: z.object({
    toDate: z.string().regex(dateRegex, "toDate must be YYYY-MM-DD"),
    lookbackDays: z.coerce.number().int().min(1).max(30).optional(),
  }),
  params: z.any().optional(),
  body: z.any().optional(),
});

const lookupSchema = z.object({
  query: z.object({
    q: z.string().max(200),
    date: z.string().regex(dateRegex, "date must be YYYY-MM-DD").optional(),
    includeUnavailable: z.enum(["true", "false"]).optional(),
  }),
  params: z.any().optional(),
  body: z.any().optional(),
});

export function createManagerDeskRouter(
  managerDeskService: ManagerDeskService,
  authService: AuthService
): Router {
  const router = Router();
  const tasks = new TaskService();
  const itemRefToId = (ref: string, workspaceId?: string) =>
    tasks.surfaceIdForRef("manager_desk_items", ref, workspaceId);
  const trackerItemRefToId = (ref: string, workspaceId?: string) =>
    tasks.surfaceIdForRef("team_tracker_items", ref, workspaceId);

  router.use(requireManager(authService));

  router.get("/", validate(dateQuerySchema), async (req, res, next) => {
    try {
      const day = await managerDeskService.getDay(req.auth!.user.accountId, req.query.date as string, req.auth!.user.workspaceId);
      if (day.taskModel === "canonical") {
        day.items = [];
        day.createdThatDayItems = [];
      }
      res.json(day);
    } catch (error) {
      next(error);
    }
  });

  router.get(
    "/tracker-items/:trackerItemId/detail",
    validate(trackerItemIdParamSchema),
    async (req, res, next) => {
      try {
        const detail = await managerDeskService.getTrackerTaskDetail(
          req.auth!.user.accountId,
          await trackerItemRefToId(req.params.trackerItemId as string, req.auth!.user.workspaceId),
          req.auth!.user.workspaceId
        );
        res.json(detail);
      } catch (error) {
        next(error);
      }
    }
  );

  router.post(
    "/tracker-items/:trackerItemId/promote",
    validate(trackerItemIdParamSchema),
    async (req, res, next) => {
      try {
        const detail = await managerDeskService.promoteTrackerTask(
          req.auth!.user.accountId,
          await trackerItemRefToId(req.params.trackerItemId as string, req.auth!.user.workspaceId),
          req.auth!.user.workspaceId
        );
        res.json(detail);
      } catch (error) {
        next(error);
      }
    }
  );

  router.get("/items/:itemId/detail", validate(itemIdParamSchema), async (req, res, next) => {
    try {
      const detail = await managerDeskService.getTaskDetailByItemId(
        req.auth!.user.accountId,
        await itemRefToId(req.params.itemId as string, req.auth!.user.workspaceId),
        req.auth!.user.workspaceId
      );
      res.json(detail);
    } catch (error) {
      next(error);
    }
  });

  router.post("/items", validate(createItemSchema), async (req, res, next) => {
    try {
      const item = await managerDeskService.createItem(req.auth!.user.accountId, req.body, req.auth!.user.workspaceId);
      res.status(201).json(item);
    } catch (error) {
      next(error);
    }
  });

  router.patch("/items/:itemId", validate(updateItemSchema), async (req, res, next) => {
    try {
      const item = await managerDeskService.updateItem(
        req.auth!.user.accountId,
        await itemRefToId(req.params.itemId as string, req.auth!.user.workspaceId),
        req.body,
        req.auth!.user.workspaceId
      );
      res.json(item);
    } catch (error) {
      next(error);
    }
  });

  router.delete("/items/:itemId", validate(itemIdParamSchema), async (req, res, next) => {
    try {
      await managerDeskService.deleteItem(
        req.auth!.user.accountId,
        await itemRefToId(req.params.itemId as string, req.auth!.user.workspaceId),
        req.auth!.user.workspaceId
      );
      res.json({ deleted: true });
    } catch (error) {
      next(error);
    }
  });

  router.post(
    "/items/:itemId/cancel-delegated-task",
    validate(itemIdParamSchema),
    async (req, res, next) => {
      try {
        const item = await managerDeskService.cancelDelegatedTask(
          req.auth!.user.accountId,
          await itemRefToId(req.params.itemId as string, req.auth!.user.workspaceId),
          req.auth!.user.workspaceId
        );
        res.json(item);
      } catch (error) {
        next(error);
      }
    }
  );

  router.post("/items/:itemId/links", validate(linkSchema), async (req, res, next) => {
    try {
      const link = await managerDeskService.addLink(
        req.auth!.user.accountId,
        await itemRefToId(req.params.itemId as string, req.auth!.user.workspaceId),
        req.body,
        req.auth!.user.workspaceId
      );
      res.status(201).json(link);
    } catch (error) {
      next(error);
    }
  });

  router.delete(
    "/items/:itemId/links/:linkId",
    validate(deleteLinkSchema),
    async (req, res, next) => {
      try {
        await managerDeskService.deleteLink(
          req.auth!.user.accountId,
          await itemRefToId(req.params.itemId as string, req.auth!.user.workspaceId),
          parseInt(req.params.linkId as string, 10),
          req.auth!.user.workspaceId
        );
        res.json({ deleted: true });
      } catch (error) {
        next(error);
      }
    }
  );

  router.get(
    "/carry-forward-context",
    validate(carryForwardContextSchema),
    async (req, res, next) => {
      try {
        const preview = await managerDeskService.getCarryForwardContext(
          req.auth!.user.accountId,
          req.query.toDate as string,
          req.query.lookbackDays as number | undefined,
          req.auth!.user.workspaceId
        );
        res.json(preview);
      } catch (error) {
        next(error);
      }
    }
  );

  router.get(
    "/carry-forward-preview",
    validate(carryForwardPreviewSchema),
    async (req, res, next) => {
      try {
        const { fromDate, toDate } = req.query as {
          fromDate: string;
          toDate: string;
        };
        const preview = await managerDeskService.previewCarryForward(
          req.auth!.user.accountId,
          fromDate,
          toDate,
          req.auth!.user.workspaceId
        );
        res.json(preview);
      } catch (error) {
        next(error);
      }
    }
  );

  router.post("/carry-forward", validate(carryForwardSchema), async (req, res, next) => {
    try {
    const created = await managerDeskService.carryForward(req.auth!.user.accountId, req.body, req.auth!.user.workspaceId);
      res.json({ created });
    } catch (error) {
      next(error);
    }
  });

  router.get("/lookups/issues", validate(lookupSchema), async (req, res, next) => {
    try {
      const items = await managerDeskService.lookupIssues(req.query.q as string, req.auth!.user.workspaceId);
      res.json({ items });
    } catch (error) {
      next(error);
    }
  });

  router.get("/lookups/developers", validate(lookupSchema), async (req, res, next) => {
    try {
      const items = await managerDeskService.lookupDevelopers(
        req.query.q as string,
        req.query.date as string | undefined,
        { includeUnavailable: req.query.includeUnavailable === "true" },
        req.auth!.user.workspaceId
      );
      res.json({ items });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
