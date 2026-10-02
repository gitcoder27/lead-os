import { Router } from "express";
import { z } from "zod";
import { validate } from "../middleware/validate";
import { TaskInboxService } from "../services/task-inbox.service";
const positive = z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export function createTaskInboxRouter(service = new TaskInboxService()): Router {
  const router = Router();
  router.get(
    "/",
    validate(
      z.object({
        params: z.any().optional(),
        body: z.any().optional(),
        query: z
          .object({
            cursor: z.string().regex(/^\d+$/).optional(),
            limit: positive.max(50).optional(),
            unread: z.enum(["true", "false"]).optional(),
          })
          .strict(),
      }),
    ),
    async (req, res, next) => {
      try {
        res.json(
          await service.list(req.auth!.user, {
            cursor: req.query.cursor as string | undefined,
            limit: req.query.limit ? Number(req.query.limit) : undefined,
            unreadOnly: req.query.unread === "true",
          }),
        );
      } catch (error) {
        next(error);
      }
    },
  );
  router.post(
    "/read",
    validate(
      z.object({
        params: z.any().optional(),
        query: z.any().optional(),
        body: z
          .object({
            ids: z
              .array(z.number().int().positive().max(Number.MAX_SAFE_INTEGER))
              .min(1)
              .max(100)
              .refine((ids) => new Set(ids).size === ids.length),
            read: z.boolean(),
          })
          .strict(),
      }),
    ),
    async (req, res, next) => {
      try {
        res.json(await service.markRead(req.auth!.user, req.body));
      } catch (error) {
        next(error);
      }
    },
  );
  router.get(
    "/events/:eventId",
    validate(
      z.object({
        params: z.object({ eventId: positive }),
        query: z.object({ taskKey: z.string().regex(/^T-\d{1,9}$/) }).strict(),
        body: z.any().optional(),
      }),
    ),
    async (req, res, next) => {
      try {
        res.json(await service.targetEvent(req.auth!.user, Number(req.params.eventId), req.query.taskKey as string));
      } catch (error) {
        next(error);
      }
    },
  );
  return router;
}
