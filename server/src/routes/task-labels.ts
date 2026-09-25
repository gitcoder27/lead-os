import { Router } from "express";
import { z } from "zod";
import { TASK_LABEL_COLORS } from "shared/types";
import { validate } from "../middleware/validate";
import { TaskLabelsService } from "../services/task-labels.service";

const nameParam = z.string().trim().min(1).max(50);
const colorSchema = z.enum(TASK_LABEL_COLORS).optional();

/** Phase 3 (P3-D13): workspace label registry. Manager-only, flag-gated in the service. */
export function createTaskLabelsRouter(labels: TaskLabelsService): Router {
  const router = Router();

  router.get("/", validate(z.object({ params: z.any().optional(), body: z.any().optional(), query: z.any().optional() })), async (req, res, next) => {
    try {
      res.json({ labels: await labels.list(req.auth!.user.workspaceId) });
    } catch (error) { next(error); }
  });

  router.post("/", validate(z.object({
    body: z.object({ name: z.string().trim().min(1).max(50), color: colorSchema }).strict(),
    params: z.any().optional(),
    query: z.any().optional(),
  })), async (req, res, next) => {
    try {
      res.status(201).json(await labels.create(req.auth!.user.workspaceId, req.body));
    } catch (error) { next(error); }
  });

  router.patch("/:name", validate(z.object({
    params: z.object({ name: nameParam }),
    body: z.object({ name: z.string().trim().min(1).max(50).optional(), color: colorSchema }).strict()
      .refine((body) => body.name !== undefined || body.color !== undefined, { message: "Nothing to update" }),
    query: z.any().optional(),
  })), async (req, res, next) => {
    try {
      res.json(await labels.update(req.auth!.user.workspaceId, req.params.name as string, req.body, req.auth!.user.accountId));
    } catch (error) { next(error); }
  });

  router.delete("/:name", validate(z.object({ params: z.object({ name: nameParam }), body: z.any().optional(), query: z.any().optional() })), async (req, res, next) => {
    try {
      await labels.remove(req.auth!.user.workspaceId, req.params.name as string, req.auth!.user.accountId);
      res.json({ deleted: true });
    } catch (error) { next(error); }
  });

  return router;
}
