import { Router } from "express";
import { z } from "zod";
import { validate } from "../middleware/validate";
import type { NavPreferencesService } from "../services/nav-preferences.service";

const navPageIdSchema = z.enum(["work", "team", "desk", "follow-ups", "notes", "meetings"]);

const saveNavigationSchema = z.object({
  body: z.object({
    topNav: z.array(navPageIdSchema).max(12),
    moreNav: z.array(navPageIdSchema).max(12),
  }),
  params: z.any().optional(),
  query: z.any().optional(),
});

export function createPreferencesRouter(service: NavPreferencesService): Router {
  const router = Router();

  router.use((_req, res, next) => {
    res.setHeader("Cache-Control", "private, no-store");
    next();
  });

  router.get("/navigation", async (req, res, next) => {
    try {
      const preferences = await service.get(req.auth!.user.accountId, req.auth!.user.workspaceId);
      res.json({ preferences });
    } catch (error) {
      next(error);
    }
  });

  router.put("/navigation", validate(saveNavigationSchema), async (req, res, next) => {
    try {
      const preferences = await service.save(req.auth!.user.accountId, req.body, req.auth!.user.workspaceId);
      res.json({ preferences });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
