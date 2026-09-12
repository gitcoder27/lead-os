import { Router } from "express";
import { z } from "zod";
import { validate } from "../middleware/validate";
import type { DailyNotesService } from "../services/daily-notes.service";

const MAX_BODY_LENGTH = 50000;

function isRealDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

const dateSchema = z.string().refine(isRealDate, "date must be a real YYYY-MM-DD calendar date");

const listQuerySchema = z.object({
  query: z.object({
    q: z.string().max(200).optional(),
    before: dateSchema.optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
  }),
  params: z.any().optional(),
  body: z.any().optional(),
});

const sourcesQuerySchema = z.object({
  query: z.object({
    itemIds: z.string().min(1).transform((raw, ctx) => {
      const parts = raw.split(",").map((part) => part.trim());
      if (parts.length > 100) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "itemIds supports at most 100 ids" });
        return z.NEVER;
      }
      const ids = parts.map((part) => Number(part));
      if (ids.some((id, index) => !/^\d+$/.test(parts[index]!) || !Number.isSafeInteger(id) || id <= 0)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "itemIds must be comma-separated positive integers" });
        return z.NEVER;
      }
      return ids;
    }),
  }),
  params: z.any().optional(),
  body: z.any().optional(),
});

const dateParamSchema = z.object({
  params: z.object({ date: dateSchema }),
  body: z.any().optional(),
  query: z.any().optional(),
});

const saveNoteSchema = z.object({
  params: z.object({ date: dateSchema }),
  body: z.object({
    body: z.string().max(MAX_BODY_LENGTH),
    revision: z.number().int().min(0),
  }),
  query: z.any().optional(),
});

const appendNoteSchema = z.object({
  params: z.object({ date: dateSchema }),
  body: z.object({
    text: z.string().trim().min(1).max(MAX_BODY_LENGTH),
    requestId: z.string().uuid(),
  }),
  query: z.any().optional(),
});

const createFollowUpSchema = z.object({
  params: z.object({ date: dateSchema }),
  body: z.object({
    date: dateSchema,
    title: z.string().trim().min(1).max(500),
    followUpAt: z.string().datetime({ offset: true }),
    requestId: z.string().uuid(),
  }),
  query: z.any().optional(),
});

export function createNotesRouter(service: DailyNotesService): Router {
  const router = Router();

  router.use((_req, res, next) => {
    res.setHeader("Cache-Control", "private, no-store");
    next();
  });

  router.get("/", validate(listQuerySchema), async (req, res, next) => {
    try {
      const result = await service.list(
        req.auth!.user.accountId,
        {
          q: req.query.q as string | undefined,
          before: req.query.before as string | undefined,
          limit: req.query.limit as number | undefined,
        },
        req.auth!.user.workspaceId
      );
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  router.get("/sources", validate(sourcesQuerySchema), async (req, res, next) => {
    try {
      const result = await service.getSources(
        req.auth!.user.accountId,
        req.query.itemIds as unknown as number[],
        req.auth!.user.workspaceId
      );
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  router.get("/:date", validate(dateParamSchema), async (req, res, next) => {
    try {
      const result = await service.getDay(
        req.auth!.user.accountId,
        req.params.date as string,
        req.auth!.user.workspaceId
      );
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  router.put("/:date", validate(saveNoteSchema), async (req, res, next) => {
    try {
      const result = await service.save(
        req.auth!.user.accountId,
        req.params.date as string,
        req.body,
        req.auth!.user.workspaceId
      );
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  router.post("/:date/append", validate(appendNoteSchema), async (req, res, next) => {
    try {
      const result = await service.append(
        req.auth!.user.accountId,
        req.params.date as string,
        req.body,
        req.auth!.user.workspaceId
      );
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  router.post("/:date/follow-ups", validate(createFollowUpSchema), async (req, res, next) => {
    try {
      const result = await service.createFollowUp(
        req.auth!.user.accountId,
        req.params.date as string,
        req.body,
        req.auth!.user.workspaceId
      );
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  return router;
}
