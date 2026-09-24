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
  view: z.enum(["work", "team", "desk", "follow-ups", "meetings", "settings"]),
  issueKey: z.string().optional(),
  relatedIssueKeys: z.array(z.string()).optional(),
  developerAccountId: z.string().optional(),
  managerDeskItemId: z.number().int().positive().optional(),
  trackerItemId: z.number().int().positive().optional(),
  taskKey: z.string().trim().regex(/^[Tt]-\d{1,9}$/).optional(),
  date: z.string().regex(dateRegex, "target date must be YYYY-MM-DD").optional(),
  filter: z.string().optional(),
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
  ]),
  label: z.string().min(1),
  target: actionTargetSchema,
  confirm: z.boolean().optional(),
});

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
