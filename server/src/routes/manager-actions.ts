import { Router } from "express";
import { z } from "zod";
import type { ManagerActionCommandRequest, ManagerActionSurface } from "shared/types";
import { validate } from "../middleware/validate";
import { TodayService } from "../services/today.service";

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

const getActionsSchema = z.object({
  query: z.object({
    date: z.string().regex(dateRegex, "date must be YYYY-MM-DD"),
    surface: z.enum(["today", "header"]).optional(),
    limit: z.coerce.number().int().min(1).max(50).optional(),
  }),
  body: z.any().optional(),
  params: z.any().optional(),
});

const actionTargetContextSchema = z.object({
  trackerItemId: z.number().int().positive().optional(),
  taskKey: z.string().trim().regex(/^[Tt]-\d{1,9}$/).optional(),
  issueKey: z.string().optional(),
  relatedIssueKeys: z.array(z.string()).optional(),
});

const actionTargetSchema = z.object({
  type: z.enum([
    "issue",
    "developer",
    "manager_desk_item",
    "tracker_item",
    "follow_up",
    "meeting",
    "view",
  ]),
  view: z.enum(["work", "team", "desk", "tasks", "follow-ups", "meetings", "notes", "settings"]),
  issueKey: z.string().optional(),
  relatedIssueKeys: z.array(z.string()).optional(),
  developerAccountId: z.string().optional(),
  managerDeskItemId: z.number().int().positive().optional(),
  trackerItemId: z.number().int().positive().optional(),
  taskKey: z.string().trim().regex(/^[Tt]-\d{1,9}$/).optional(),
  date: z.string().regex(dateRegex, "target date must be YYYY-MM-DD").optional(),
  filter: z.string().optional(),
  panel: z.string().optional(),
  mode: z.literal("standup").optional(),
  context: actionTargetContextSchema.optional(),
});

const actionCommandSchema = z.object({
  kind: z.enum([
    "open",
    "ask_check_in",
    "add_check_in",
    "set_current_work",
    "assign_owner",
    "capture_follow_up",
    "snooze",
    "mark_done",
    "carry_forward",
    "capture_meeting_outcome",
    "restore",
  ]),
  label: z.string().min(1),
  target: actionTargetSchema,
  confirm: z.boolean().optional(),
  undoable: z.boolean().optional(),
  toDate: z.string().regex(dateRegex, "toDate must be YYYY-MM-DD").optional(),
});

// Restores echo the stored value back, whatever its legacy shape.
const isoOrNull = z.string().max(40).nullable();

// docs/53 F11: the inverse patches a prior response issued — deliberately
// narrow (status / followUpAt / outcome / scheduledOn, or delete a created row).
const restoreSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("desk_item"),
    managerDeskItemId: z.number().int().positive(),
    patch: z.object({
      status: z.enum(["inbox", "planned", "in_progress", "waiting", "backlog", "done", "cancelled"]).optional(),
      followUpAt: isoOrNull.optional(),
      outcome: z.string().nullable().optional(),
    }).strict(),
    alsoDeleteDeskItemId: z.number().int().positive().optional(),
  }),
  z.object({
    type: z.literal("task"),
    taskKey: z.string().trim().regex(/^[Tt]-\d{1,9}$/),
    patch: z.object({
      status: z.enum(["open", "active", "blocked", "done", "dropped"]).optional(),
      followUpAt: isoOrNull.optional(),
      outcome: z.string().nullable().optional(),
      scheduledOn: z.string().regex(dateRegex).nullable().optional(),
    }).strict(),
    alsoDeleteDeskItemId: z.number().int().positive().optional(),
  }),
  z.object({ type: z.literal("delete_desk_item"), managerDeskItemId: z.number().int().positive() }),
  z.object({ type: z.literal("check_in_ask"), askId: z.number().int().positive() }),
]);

const commandSchema = z.object({
  query: z.any().optional(),
  params: z.any().optional(),
  body: z.object({
    command: actionCommandSchema,
    date: z.string().regex(dateRegex, "date must be YYYY-MM-DD"),
    title: z.string().optional(),
    outcome: z.string().optional(),
    preset: z.enum(["later_today", "tomorrow", "next_week"]).optional(),
    summary: z.string().optional(),
    taskKeys: z.array(z.string().trim().regex(/^[Tt]-\d{1,9}$/)).max(10).optional(),
    tz: z.string().max(64).optional(),
    nextAction: z.string().max(500).optional(),
    nextActionOwnerAccountId: z.string().max(128).optional(),
    restore: restoreSchema.optional(),
  }).refine((body) => body.command.kind !== "restore" || Boolean(body.restore), {
    message: "restore requires a restore patch",
    path: ["restore"],
  }),
});

export function createManagerActionsRouter(todayService: TodayService): Router {
  const router = Router();

  router.get("/", validate(getActionsSchema), async (req, res, next) => {
    try {
      const actions = await todayService.getManagerActions(
        req.auth!.user.accountId,
        req.query.date as string,
        {
          surface: req.query.surface as ManagerActionSurface | undefined,
          limit: req.query.limit as number | undefined,
        },
        req.auth!.user.workspaceId,
      );
      res.json(actions);
    } catch (error) {
      next(error);
    }
  });

  router.post("/commands", validate(commandSchema), async (req, res, next) => {
    try {
      const result = await todayService.executeCommand(
        req.auth!.user.accountId,
        req.body as ManagerActionCommandRequest,
        {
          type: req.auth!.user.role,
          accountId: req.auth!.user.accountId,
        },
        req.auth!.user.workspaceId,
      );
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  return router;
}
