import { Router, type Request } from "express";
import { z } from "zod";
import { WEEKLY_REVIEW_LIMITS, WEEKLY_REVIEW_STEPS, TASK_KEY_PATTERN, type SaveWeeklyReviewRequest } from "shared/types";
import { validate } from "../middleware/validate";
import { HttpError } from "../middleware/errorHandler";
import type { TaskKeysService } from "../services/task-keys.service";
import { WeeklyReviewService } from "../services/weekly-review.service";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "week must be YYYY-MM-DD").refine(
  (value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().startsWith(value),
  "week must be a real date",
);

const weekQuerySchema = z.object({
  query: z.object({
    week: isoDate.optional(),
    // The manager's IANA zone (as Today); an unknown one falls back to the Attention-rules zone.
    tz: z.string().max(64).optional(),
  }),
  body: z.any().optional(),
  params: z.any().optional(),
});

const lineId = z.string().trim().min(1).max(WEEKLY_REVIEW_LIMITS.lineIdChars);

const saveSchema = z.object({
  params: z.object({ weekStart: isoDate }),
  query: z.any().optional(),
  body: z
    .object({
      step: z.enum(WEEKLY_REVIEW_STEPS).optional(),
      // `{ taskKey: action }`; null removes a decision (Undo).
      decisions: z
        .record(
          z.string().regex(TASK_KEY_PATTERN, "invalid task key"),
          z.string().regex(/^[A-Za-z0-9_:.-]{1,40}$/, "invalid action").nullable(),
        )
        .refine((value) => Object.keys(value).length <= WEEKLY_REVIEW_LIMITS.decisions, "too many decisions")
        .optional(),
      excluded: z.array(lineId).max(WEEKLY_REVIEW_LIMITS.excluded).optional(),
      reportMarkdown: z.string().max(WEEKLY_REVIEW_LIMITS.reportChars).nullable().optional(),
      completed: z.boolean().optional(),
      dismissed: z.boolean().optional(),
    })
    .strict(),
});

const weeksQuerySchema = z.object({
  query: z.object({ limit: z.coerce.number().int().min(1).max(52).optional() }),
  body: z.any().optional(),
  params: z.any().optional(),
});

/**
 * docs/59 §9: the weekly review's read model. Manager-only (the mount adds `requireManager`) and
 * on the Tasks workspace, so it 404s until Phase 3 like `/api/task-views`.
 */
export function createReviewRouter(keys: TaskKeysService, service = new WeeklyReviewService()): Router {
  const router = Router();
  const principalOf = (req: Request) => ({ type: "manager" as const, accountId: req.auth!.user.accountId, workspaceId: req.auth!.user.workspaceId });
  const assertEnabled = async (req: Request) => {
    if (!(await keys.phase3Enabled(req.auth!.user.workspaceId))) throw new HttpError(404, "The weekly review is not enabled");
  };

  router.get("/week", validate(weekQuerySchema), async (req, res, next) => {
    try {
      await assertEnabled(req);
      res.json(await service.build(principalOf(req), { week: req.query.week as string | undefined, tz: req.query.tz as string | undefined }));
    } catch (error) {
      next(error);
    }
  });

  // Save progress for one week (a Monday); the record is the caller's own, addressed by week.
  router.put("/week/:weekStart", validate(saveSchema), async (req, res, next) => {
    try {
      await assertEnabled(req);
      const saved = await service.save(principalOf(req), String(req.params.weekStart), req.body as SaveWeeklyReviewRequest);
      res.json({ saved });
    } catch (error) {
      next(error);
    }
  });

  router.get("/weeks", validate(weeksQuerySchema), async (req, res, next) => {
    try {
      await assertEnabled(req);
      res.json({ weeks: await service.listWeeks(principalOf(req), req.query.limit as number | undefined) });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
