import { Router } from "express";
import { z } from "zod";
import { validate } from "../middleware/validate";
import { SearchService } from "../services/search.service";

const searchQuerySchema = z.object({
  query: z.object({
    q: z.string().trim().min(1).max(200),
  }),
  body: z.any().optional(),
  params: z.any().optional(),
});

export function createSearchRouter(searchService: SearchService): Router {
  const router = Router();

  router.use((_req, res, next) => {
    res.setHeader("Cache-Control", "private, no-store");
    next();
  });

  router.get("/", validate(searchQuerySchema), async (req, res, next) => {
    try {
      const results = await searchService.search(
        req.query.q as string,
        req.auth!.user.workspaceId,
        req.auth!.user.accountId
      );
      res.json(results);
    } catch (error) {
      next(error);
    }
  });

  return router;
}
