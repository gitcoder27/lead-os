import { Router } from "express";
import { z } from "zod";
import type { TodayRhythmBoundaries } from "shared/types";
import { validate } from "../middleware/validate";
import { TodayService } from "../services/today.service";

const clockTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "must be HH:MM (24h)");

const dateQuerySchema = z.object({
  query: z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD"),
    // docs/53 F5: manager IANA zone; an unknown zone falls back to the server's.
    tz: z.string().max(64).optional(),
  }),
  body: z.any().optional(),
  params: z.any().optional(),
});

const rhythmSettingsSchema = z.object({
  query: z.any().optional(),
  params: z.any().optional(),
  body: z.object({
    boundaries: z.object({
      standupStart: clockTime,
      middayStart: clockTime,
      wrapUpStart: clockTime,
    }),
  }),
});

export function createTodayRouter(todayService: TodayService): Router {
  const router = Router();

  router.get("/", validate(dateQuerySchema), async (req, res, next) => {
    try {
      const result = await todayService.getTodayWithMetadata(
        req.auth!.user.accountId,
        req.query.date as string,
        req.auth!.user.workspaceId,
        { tz: req.query.tz as string | undefined, recordVisit: true },
      );
      res.setHeader("X-Today-Cache", result.cacheStatus);
      res.setHeader("Server-Timing", [
        `today;dur=${result.requestDurationMs.toFixed(1)}`,
        `today-build;dur=${result.cacheStatus === "miss" ? result.buildDurationMs.toFixed(1) : "0.0"}`,
        `today-issues;dur=${result.cacheStatus === "miss" ? result.sourceTimings.issues.toFixed(1) : "0.0"}`,
        `today-team;dur=${result.cacheStatus === "miss" ? result.sourceTimings.team.toFixed(1) : "0.0"}`,
        `today-desk;dur=${result.cacheStatus === "miss" ? result.sourceTimings.desk.toFixed(1) : "0.0"}`,
        `today-sync;dur=${result.cacheStatus === "miss" ? result.sourceTimings.sync.toFixed(1) : "0.0"}`,
        `today-state;dur=${result.cacheStatus === "miss" ? result.sourceTimings.state.toFixed(1) : "0.0"}`,
      ].join(", "));
      res.json(result.today);
    } catch (error) {
      next(error);
    }
  });

  // docs/53 F6: stage boundaries are a workspace setting (standup time is team-specific).
  router.get("/settings", async (req, res, next) => {
    try {
      res.json(await todayService.getRhythmSettings(req.auth!.user.workspaceId));
    } catch (error) {
      next(error);
    }
  });

  router.put("/settings", validate(rhythmSettingsSchema), async (req, res, next) => {
    try {
      const { boundaries } = req.body as { boundaries: TodayRhythmBoundaries };
      res.json(await todayService.updateRhythmSettings(boundaries, req.auth!.user.workspaceId));
    } catch (error) {
      next(error);
    }
  });

  return router;
}
