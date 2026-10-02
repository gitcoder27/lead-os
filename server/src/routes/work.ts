import { Router } from "express";
import { z } from "zod";
import { validate } from "../middleware/validate";
import { WorkSavedViewsService } from "../services/work-saved-views.service";

const workFilterSchema = z.enum([
  "all",
  "new",
  "recentlyAssigned",
  "inProgress",
  "reopened",
  "unassigned",
  "dueToday",
  "dueThisWeek",
  "noDueDate",
  "overdue",
  "blocked",
  "stale",
  "highPriority",
  "outOfTeam",
  'excluded',
]);

const createSavedViewSchema = z.object({
  body: z.object({
    name: z.string().trim().min(1).max(120),
    filter: workFilterSchema.optional(),
    developerAccountId: z.string().trim().min(1).max(200).nullable().optional(),
    tagId: z.number().int().positive().nullable().optional(),
    noTagsFilter: z.boolean().optional(),
  }),
  params: z.any().optional(),
  query: z.any().optional(),
});

const updateSavedViewSchema = z.object({
  params: z.object({
    viewId: z.string().regex(/^\d+$/, "Invalid view id"),
  }),
  body: z
    .object({
      name: z.string().trim().min(1).max(120).optional(),
      filter: workFilterSchema.optional(),
      developerAccountId: z.string().trim().min(1).max(200).nullable().optional(),
      tagId: z.number().int().positive().nullable().optional(),
      noTagsFilter: z.boolean().optional(),
    })
    .refine((value) => Object.keys(value).length > 0, {
      message: "At least one field is required",
    }),
  query: z.any().optional(),
});

const deleteSavedViewSchema = z.object({
  params: z.object({
    viewId: z.string().regex(/^\d+$/, "Invalid view id"),
  }),
  body: z.any().optional(),
  query: z.any().optional(),
});

export function createWorkSavedViewsRouter(workSavedViewsService: WorkSavedViewsService): Router {
  const router = Router();

  router.get("/views", async (req, res, next) => {
    try {
      const views = await workSavedViewsService.listSavedViews(
        req.auth!.user.accountId,
        req.auth!.user.workspaceId
      );
      res.json({ views });
    } catch (error) {
      next(error);
    }
  });

  router.post("/views", validate(createSavedViewSchema), async (req, res, next) => {
    try {
      const view = await workSavedViewsService.createSavedView(
        req.auth!.user.accountId,
        req.body,
        req.auth!.user.workspaceId
      );
      res.status(201).json(view);
    } catch (error) {
      next(error);
    }
  });

  router.patch("/views/:viewId", validate(updateSavedViewSchema), async (req, res, next) => {
    try {
      const viewId = parseInt(req.params.viewId as string, 10);
      const view = await workSavedViewsService.updateSavedView(
        req.auth!.user.accountId,
        viewId,
        req.body,
        req.auth!.user.workspaceId
      );
      res.json(view);
    } catch (error) {
      next(error);
    }
  });

  router.delete("/views/:viewId", validate(deleteSavedViewSchema), async (req, res, next) => {
    try {
      const viewId = parseInt(req.params.viewId as string, 10);
      await workSavedViewsService.deleteSavedView(
        req.auth!.user.accountId,
        viewId,
        req.auth!.user.workspaceId
      );
      res.json({ deleted: true });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
