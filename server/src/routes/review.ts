import { Router } from "express";
import { z } from "zod";
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

/**
 * docs/59 §9: the weekly review's read model. Manager-only (the mount adds `requireManager`) and
 * on the Tasks workspace, so it 404s until Phase 3 like `/api/task-views`.
 */
export function createReviewRouter(keys: TaskKeysService, service = new WeeklyReviewService()): Router {
  const router = Router();

  router.get("/week", validate(weekQuerySchema), async (req, res, next) => {
    try {
      const user = req.auth!.user;
      if (!(await keys.phase3Enabled(user.workspaceId))) throw new HttpError(404, "The weekly review is not enabled");
      res.json(
        await service.build(
          { type: "manager", accountId: user.accountId, workspaceId: user.workspaceId },
          { week: req.query.week as string | undefined, tz: req.query.tz as string | undefined },
        ),
      );
    } catch (error) {
      next(error);
    }
  });

  return router;
}
