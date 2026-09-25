import { Router } from "express";
import { z } from "zod";
import { validate } from "../middleware/validate";
import { HttpError } from "../middleware/errorHandler";
import { ManagerDeskService } from "../services/manager-desk.service";
import { TaskService } from "../services/task.service";
import { TeamTrackerService } from "../services/team-tracker.service";

const isoDateTimeSchema = z.string().datetime({ offset: true });
const trackerStatusSchema = z.enum([
  "on_track",
  "at_risk",
  "blocked",
  "waiting",
  "done_for_today",
]);
const trackerSummaryFilterSchema = z.enum([
  "all",
  "stale",
  "blocked",
  "at_risk",
  "waiting",
  "overdue_linked",
  "over_capacity",
  "status_follow_up",
  "no_current",
  "done_for_today",
]);
const trackerSortSchema = z.enum([
  "name",
  "attention",
  "stale_age",
  "load",
  "blocked_first",
]);
const trackerGroupBySchema = z.enum([
  "none",
  "status",
  "attention_state",
]);

const dateQuerySchema = z.object({
  query: z.object({
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD"),
    q: z.string().max(200).optional(),
    summaryFilter: trackerSummaryFilterSchema.optional(),
    sortBy: trackerSortSchema.optional(),
    groupBy: trackerGroupBySchema.optional(),
    viewId: z.string().regex(/^\d+$/, "viewId must be a positive integer").optional(),
  }),
  body: z.any().optional(),
  params: z.any().optional(),
});

const createSavedViewSchema = z.object({
  body: z.object({
    name: z.string().trim().min(1).max(120),
    q: z.string().max(200).optional(),
    summaryFilter: trackerSummaryFilterSchema.optional(),
    sortBy: trackerSortSchema.optional(),
    groupBy: trackerGroupBySchema.optional(),
  }),
  params: z.any().optional(),
  query: z.any().optional(),
});

const updateSavedViewSchema = z.object({
  params: z.object({
    viewId: z.string().regex(/^\d+$/, "Invalid view id"),
  }),
  body: z
    .object({
      name: z.string().trim().min(1).max(120).optional(),
      q: z.string().max(200).optional(),
      summaryFilter: trackerSummaryFilterSchema.optional(),
      sortBy: trackerSortSchema.optional(),
      groupBy: trackerGroupBySchema.optional(),
    })
    .refine((value) => Object.keys(value).length > 0, {
      message: "At least one field is required",
    }),
  query: z.any().optional(),
});

const deleteSavedViewSchema = z.object({
  params: z.object({
    viewId: z.string().regex(/^\d+$/, "Invalid view id"),
  }),
  body: z.any().optional(),
  query: z.any().optional(),
});

const updateDaySchema = z.object({
  params: z.object({
    accountId: z.string().regex(/^[A-Za-z0-9:_-]+$/, "Invalid account id"),
  }),
  body: z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    status: trackerStatusSchema.optional(),
    capacityUnits: z.number().int().min(1).nullable().optional(),
    managerNotes: z.string().trim().optional(),
  }).refine((value) => value.status !== undefined || value.capacityUnits !== undefined || value.managerNotes !== undefined, {
    message: "At least one day field is required",
  }),
  query: z.any().optional(),
});

const updateAvailabilitySchema = z.object({
  params: z.object({
    accountId: z.string().regex(/^[A-Za-z0-9:_-]+$/, "Invalid account id"),
  }),
  body: z.object({
    effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    state: z.enum(["active", "inactive"]),
    note: z.string().trim().max(500).optional(),
  }),
  query: z.any().optional(),
});

const addItemSchema = z.object({
  params: z.object({
    accountId: z.string().regex(/^[A-Za-z0-9:_-]+$/, "Invalid account id"),
  }),
  body: z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    jiraKey: z.string().trim().optional(),
    relatedIssueKeys: z.array(z.string().trim().min(1)).max(20).optional(),
    title: z.string().trim().min(1).max(500),
    note: z.string().trim().max(2000).optional(),
  }),
  query: z.any().optional(),
});

const carryForwardPreviewSchema = z.object({
  query: z.object({
    fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  }),
  body: z.any().optional(),
  params: z.any().optional(),
});

const carryForwardContextSchema = z.object({
  query: z.object({
    toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    lookbackDays: z.coerce.number().int().min(1).max(30).optional(),
  }),
  body: z.any().optional(),
  params: z.any().optional(),
});

const issueAssignmentSchema = z.object({
  params: z.object({
    jiraKey: z.string().min(1, "jiraKey is required"),
  }),
  query: z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  }),
  body: z.any().optional(),
});

const itemRefSchema = z.string().regex(/^(\d+|[Tt]-\d{1,9})$/, "Invalid item id or task key");

const updateItemSchema = z.object({
  params: z.object({
    itemId: itemRefSchema,
  }),
  body: z.object({
    title: z.string().trim().min(1).max(500).optional(),
    state: z.enum(["planned", "in_progress", "done", "dropped"]).optional(),
    note: z.string().trim().max(2000).nullable().optional(),
    position: z.number().int().min(0).optional(),
  }).refine((value) => Object.keys(value).length > 0, { message: "At least one item field is required" }),
  query: z.any().optional(),
});

const reassignItemSchema = z.object({
  params: z.object({ itemId: itemRefSchema }),
  body: z.object({ toAccountId: z.string().min(1), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), requestId: z.string().uuid() }),
  query: z.any().optional(),
});

const deleteItemSchema = z.object({
  params: z.object({
    itemId: itemRefSchema,
  }),
  body: z.any().optional(),
  query: z.any().optional(),
});

const setCurrentSchema = z.object({
  params: z.object({
    itemId: itemRefSchema,
  }),
  body: z.object({
    ifNoCurrent: z.boolean().optional(),
  }).optional(),
  query: z.any().optional(),
});

const addCheckInSchema = z.object({
  params: z.object({
    accountId: z.string().regex(/^[A-Za-z0-9:_-]+$/, "Invalid account id"),
  }),
  body: z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    summary: z.string().trim().min(1).max(2000),
    status: trackerStatusSchema.optional(),
    taskKeys: z.array(z.string().trim().regex(/^[Tt]-\d{1,9}$/)).max(10).optional(),
  }),
  query: z.any().optional(),
});

const statusUpdateSchema = z
  .object({
    params: z.object({
      accountId: z.string().regex(/^[A-Za-z0-9:_-]+$/, "Invalid account id"),
    }),
    body: z.object({
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      status: trackerStatusSchema,
      rationale: z.string().trim().max(2000).optional(),
      summary: z.string().trim().max(2000).optional(),
      nextFollowUpAt: isoDateTimeSchema.nullable().optional(),
      taskKey: z.string().trim().regex(/^[Tt]-\d{1,9}$/).optional(),
    }),
    query: z.any().optional(),
  })
  .superRefine((value, ctx) => {
    const { status, rationale } = value.body;
    if ((status === "blocked" || status === "at_risk") && !rationale?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["body", "rationale"],
        message: "rationale is required when status is blocked or at_risk",
      });
    }
  });

const carryForwardSchema = z.object({
  body: z.object({
    fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    itemIds: z.array(z.number().int().positive()).optional(),
  }),
  params: z.any().optional(),
  query: z.any().optional(),
});

export function createTeamTrackerRouter(
  trackerService: TeamTrackerService,
  managerDeskService?: ManagerDeskService
): Router {
  const router = Router();
  const tasks = new TaskService();
  const itemRefToId = (ref: string, workspaceId?: string) =>
    tasks.surfaceIdForRef("team_tracker_items", ref, workspaceId);

  // GET /api/team-tracker?date=YYYY-MM-DD
  router.get("/", validate(dateQuerySchema), async (req, res, next) => {
    try {
      const date = req.query.date as string;
      const board = await trackerService.getBoard(date, {
        workspaceId: req.auth!.user.workspaceId,
        managerAccountId: req.auth?.user.accountId,
        query: {
          q: req.query.q as string | undefined,
          summaryFilter: req.query.summaryFilter as
            | "all"
            | "stale"
            | "blocked"
            | "at_risk"
            | "waiting"
            | "overdue_linked"
            | "over_capacity"
            | "status_follow_up"
            | "no_current"
            | "done_for_today"
            | undefined,
          sortBy: req.query.sortBy as
            | "name"
            | "attention"
            | "stale_age"
            | "load"
            | "blocked_first"
            | undefined,
          groupBy: req.query.groupBy as
            | "none"
            | "status"
            | "attention_state"
            | undefined,
          viewId: req.query.viewId
            ? parseInt(req.query.viewId as string, 10)
            : undefined,
        },
      });
      // Phase 2c: canonical transport empties the legacy per-day item arrays;
      // canonical surface tasks ride `developers[].tasks`.
      res.json(
        board.taskModel === "canonical"
          ? {
              ...board,
              developers: board.developers.map((day) => ({
                ...day,
                currentItem: undefined,
                plannedItems: [],
                completedItems: [],
                droppedItems: [],
              })),
            }
          : board
      );
    } catch (error) {
      next(error);
    }
  });

  // Phase 3 (P3-D5/D6, §6.1): rolling-window standup feed per developer.
  // 404 while the Phase 3 flag is off so the endpoint can't leak early.
  router.get(
    "/standup/feed",
    validate(z.object({ query: z.object({ accountId: z.string().min(1) }) })),
    async (req, res, next) => {
      try {
        const feed = await trackerService.getStandupFeed(
          req.query.accountId as string,
          req.auth!.user.workspaceId
        );
        res.json(feed);
      } catch (error) {
        next(error);
      }
    }
  );

  router.get("/views", async (req, res, next) => {
    try {
      const views = await trackerService.listSavedViews(req.auth!.user.accountId, req.auth!.user.workspaceId);
      res.json({ views });
    } catch (error) {
      next(error);
    }
  });

  router.post("/views", validate(createSavedViewSchema), async (req, res, next) => {
    try {
      const view = await trackerService.createSavedView(req.auth!.user.accountId, req.body, req.auth!.user.workspaceId);
      res.status(201).json(view);
    } catch (error) {
      next(error);
    }
  });

  router.patch(
    "/views/:viewId",
    validate(updateSavedViewSchema),
    async (req, res, next) => {
      try {
        const viewId = parseInt(req.params.viewId as string, 10);
        const view = await trackerService.updateSavedView(
          req.auth!.user.accountId,
          viewId,
          req.body,
          req.auth!.user.workspaceId
        );
        res.json(view);
      } catch (error) {
        next(error);
      }
    }
  );

  router.delete(
    "/views/:viewId",
    validate(deleteSavedViewSchema),
    async (req, res, next) => {
      try {
        const viewId = parseInt(req.params.viewId as string, 10);
        await trackerService.deleteSavedView(req.auth!.user.accountId, viewId, req.auth!.user.workspaceId);
        res.json({ deleted: true });
      } catch (error) {
        next(error);
      }
    }
  );

  router.get(
    "/issues/:jiraKey/assignment",
    validate(issueAssignmentSchema),
    async (req, res, next) => {
      try {
        const jiraKey = req.params.jiraKey as string;
        const date = req.query.date as string;
        const assignments = await trackerService.getIssueAssignments(jiraKey, date, req.auth!.user.workspaceId);
        res.json({ assignments });
      } catch (error) {
        next(error);
      }
    }
  );

  // PATCH /api/team-tracker/:accountId/day
  router.patch(
    "/:accountId/day",
    validate(updateDaySchema),
    async (req, res, next) => {
      try {
        const accountId = req.params.accountId as string;
        const { date, status, capacityUnits, managerNotes } = req.body;
        const day = await trackerService.updateDay(accountId, date, {
          status,
          capacityUnits,
          managerNotes,
        }, req.auth!.user.workspaceId);
        res.json(day);
      } catch (error) {
        next(error);
      }
    }
  );

  router.patch(
    "/:accountId/availability",
    validate(updateAvailabilitySchema),
    async (req, res, next) => {
      try {
        const accountId = req.params.accountId as string;
        const availability = await trackerService.updateAvailability(accountId, req.body, req.auth!.user.workspaceId);
        res.json(availability);
      } catch (error) {
        next(error);
      }
    }
  );

  // POST /api/team-tracker/:accountId/items
  router.post(
    "/:accountId/items",
    validate(addItemSchema),
    async (req, res, next) => {
      try {
        const accountId = req.params.accountId as string;
        const { date, jiraKey, relatedIssueKeys, title, note } = req.body;
        const item = await trackerService.addItem(accountId, date, {
          jiraKey,
          relatedIssueKeys,
          title,
          note,
          actor: { type: "manager", accountId: req.auth!.user.accountId },
        }, req.auth!.user.workspaceId);
        res.status(201).json(item);
      } catch (error) {
        next(error);
      }
    }
  );

  // PATCH /api/team-tracker/items/:itemId
  router.patch(
    "/items/:itemId",
    validate(updateItemSchema),
    async (req, res, next) => {
      try {
        const itemId = await itemRefToId(req.params.itemId as string, req.auth!.user.workspaceId);
        const item = await trackerService.updateItem(itemId, req.body, req.auth!.user.workspaceId, { type: "manager", accountId: req.auth!.user.accountId });
        res.json(item);
      } catch (error) {
        next(error);
      }
    }
  );

  router.post("/items/:itemId/reassign", validate(reassignItemSchema), async (req, res, next) => {
    try {
      res.json(await trackerService.reassignItem(await itemRefToId(req.params.itemId as string, req.auth!.user.workspaceId), req.body.toAccountId, req.body.date, req.body.requestId, req.auth!.user.workspaceId, req.auth!.user.accountId));
    } catch (error) { next(error); }
  });

  // DELETE /api/team-tracker/items/:itemId
  router.delete(
    "/items/:itemId",
    validate(deleteItemSchema),
    async (req, res, next) => {
      try {
        const itemId = await itemRefToId(req.params.itemId as string, req.auth!.user.workspaceId);
        await trackerService.deleteItem(itemId, undefined, req.auth!.user.workspaceId, { type: "manager", accountId: req.auth!.user.accountId });
        res.json({ deleted: true });
      } catch (error) {
        next(error);
      }
    }
  );

  // POST /api/team-tracker/items/:itemId/set-current
  router.post(
    "/items/:itemId/set-current",
    validate(setCurrentSchema),
    async (req, res, next) => {
      try {
        const itemId = await itemRefToId(req.params.itemId as string, req.auth!.user.workspaceId);
        const item = await trackerService.setCurrentItem(itemId, {
          ifNoCurrent: req.body?.ifNoCurrent,
        }, req.auth!.user.workspaceId, { type: "manager", accountId: req.auth!.user.accountId });
        res.json(item);
      } catch (error) {
        next(error);
      }
    }
  );

  // POST /api/team-tracker/:accountId/checkins
  router.post(
    "/:accountId/checkins",
    validate(addCheckInSchema),
    async (req, res, next) => {
      try {
        const accountId = req.params.accountId as string;
        const { date, summary, status, taskKeys } = req.body;
        const checkIn = await trackerService.addCheckIn(accountId, date, {
          summary,
          status,
          taskKeys,
        }, {
          type: req.auth?.user.role ?? "manager",
          accountId: req.auth?.user.accountId,
        }, req.auth!.user.workspaceId);
        res.status(201).json(checkIn);
      } catch (error) {
        next(error);
      }
    }
  );

  router.post(
    "/:accountId/status-update",
    validate(statusUpdateSchema),
    async (req, res, next) => {
      try {
        const accountId = req.params.accountId as string;
        const { date, status, rationale, summary, nextFollowUpAt, taskKey } = req.body;
        const day = await trackerService.recordStatusUpdate(
          accountId,
          date,
          {
            status,
            rationale,
            summary,
            nextFollowUpAt,
            taskKey,
          },
          {
            type: req.auth?.user.role ?? "manager",
            accountId: req.auth?.user.accountId,
          },
          req.auth!.user.workspaceId
        );
        res.status(201).json(day);
      } catch (error) {
        next(error);
      }
    }
  );

  // POST /api/team-tracker/carry-forward
  router.get(
    "/carry-forward-context",
    validate(carryForwardContextSchema),
    async (req, res, next) => {
      try {
        const preview = await trackerService.getCarryForwardContext(
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
        const preview = await trackerService.previewCarryForward(
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

  router.post(
    "/carry-forward",
    validate(carryForwardSchema),
    async (req, res, next) => {
      try {
        const { fromDate, toDate, itemIds } = req.body;
        const carried = await trackerService.carryForward(fromDate, toDate, {
          itemIds,
          actor: { type: "manager", accountId: req.auth!.user.accountId },
          carryManagerDeskItems: async (params) => {
            if (!managerDeskService) {
              throw new HttpError(
                500,
                "Manager Desk service is required to carry forward linked tracker items"
              );
            }
            if (!req.auth?.user.accountId) {
              throw new HttpError(
                401,
                "Authentication required to carry forward linked tracker items"
              );
            }

            return managerDeskService.moveLinkedItemsToDate(req.auth.user.accountId, params, req.auth.user.workspaceId);
          },
        }, req.auth!.user.workspaceId);
        res.json({ carried });
      } catch (error) {
        next(error);
      }
    }
  );

  return router;
}
