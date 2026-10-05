import { Router } from "express";
import { z } from "zod";
import { validate } from "../middleware/validate";
import { placementSchema } from "../services/projects.service";
import { TaskPlacementsService } from "../services/task-placements.service";
import { projectActor } from "./projects";
const key = z.string().regex(/^T-\d{1,9}$/i);
const selection = z.object({ keys: z.array(key).min(1).max(200), includeSubtasks: z.boolean().optional() }).strict();
const task = z.object({ taskKey: key, title: z.string().max(500), placement: placementSchema.nullable() }).strict();
export function createTaskPlacementsRouter() {
  const router = Router();
  const service = new TaskPlacementsService();
  router.post(
    "/preview",
    validate(z.object({ body: selection, params: z.any().optional(), query: z.any().optional() })),
    async (req, res, next) => {
      try {
        res.json(await service.preview(projectActor(req), req.body));
      } catch (error) {
        next(error);
      }
    },
  );
  const bulk = z
    .object({
      preview: selection.extend({ tasks: z.array(task).min(1).max(200) }),
      placement: placementSchema.nullable().optional(),
      restore: z
        .array(task.omit({ title: true }))
        .min(1)
        .max(200)
        .optional(),
    })
    .strict()
    .refine((body) => (body.placement !== undefined) !== (body.restore !== undefined), "Supply placement or restore");
  router.post(
    "/bulk",
    validate(z.object({ body: bulk, params: z.any().optional(), query: z.any().optional() })),
    async (req, res, next) => {
      try {
        res.json(await service.bulk(projectActor(req), req.body));
      } catch (error) {
        next(error);
      }
    },
  );
  return router;
}
