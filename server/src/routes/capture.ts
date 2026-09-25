import { Router } from "express";
import { z } from "zod";
import { validate } from "../middleware/validate";
import { CaptureService } from "../services/capture.service";

const bodySchema = z.object({
  text: z.string().min(1).max(4000),
  clientToday: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  confirm: z.boolean().optional(),
  requestId: z.string().min(1).max(100).optional(),
}).strict();

/**
 * Phase 3 (P3-D8, §4.3): `POST /api/capture` — the single capture endpoint.
 * Manager-only; the service gates on `tasks_phase3_enabled`.
 */
export function createCaptureRouter(capture: CaptureService): Router {
  const router = Router();

  router.post("/", validate(z.object({ body: bodySchema, params: z.any().optional(), query: z.any().optional() })), async (req, res, next) => {
    try {
      const user = req.auth!.user;
      res.json(await capture.run(req.body, { type: "manager", accountId: user.accountId, workspaceId: user.workspaceId }));
    } catch (error) { next(error); }
  });

  return router;
}
