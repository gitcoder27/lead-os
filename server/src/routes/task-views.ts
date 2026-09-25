import { Router } from "express";
import { z } from "zod";
import { validate } from "../middleware/validate";
import { HttpError } from "../middleware/errorHandler";
import { TaskKeysService } from "../services/task-keys.service";
import { TaskViewsService } from "../services/task-views.service";

const idParam = z.object({ id: z.coerce.number().int().positive() });
const saveBody = z.object({ name: z.string().trim().min(1).max(120), definition: z.unknown() }).strict();
const updateBody = z.object({ name: z.string().trim().min(1).max(120).optional(), definition: z.unknown().optional(), position: z.number().int().min(0).optional() }).strict();

/**
 * Phase 3 (P3-D9/D10, §5.2): task saved views — private per manager, listed
 * alongside the built-ins. All routes require the Phase 3 flag.
 */
export function createTaskViewsRouter(keys: TaskKeysService): Router {
  const router = Router();
  const service = new TaskViewsService();

  const scope = (req: Parameters<Parameters<Router["get"]>[1]>[0]) => ({
    accountId: req.auth!.user.accountId,
    workspaceId: req.auth!.user.workspaceId,
  });
  const assertPhase3 = async (workspaceId?: string) => {
    if (!(await keys.phase3Enabled(workspaceId))) throw new HttpError(404, "Task views are not enabled");
  };

  router.get("/", validate(z.object({ params: z.any().optional(), body: z.any().optional(), query: z.any().optional() })), async (req, res, next) => {
    try {
      await assertPhase3(req.auth!.user.workspaceId);
      const { accountId, workspaceId } = scope(req);
      res.json({ views: await service.list(accountId, workspaceId) });
    } catch (error) { next(error); }
  });

  router.post("/", validate(z.object({ body: saveBody, params: z.any().optional(), query: z.any().optional() })), async (req, res, next) => {
    try {
      await assertPhase3(req.auth!.user.workspaceId);
      const { accountId, workspaceId } = scope(req);
      res.status(201).json({ view: await service.create(accountId, req.body, workspaceId) });
    } catch (error) { next(error); }
  });

  router.patch("/:id", validate(z.object({ params: idParam, body: updateBody, query: z.any().optional() })), async (req, res, next) => {
    try {
      await assertPhase3(req.auth!.user.workspaceId);
      const { accountId, workspaceId } = scope(req);
      res.json({ view: await service.update(accountId, Number(req.params.id), req.body, workspaceId) });
    } catch (error) { next(error); }
  });

  router.delete("/:id", validate(z.object({ params: idParam, body: z.any().optional(), query: z.any().optional() })), async (req, res, next) => {
    try {
      await assertPhase3(req.auth!.user.workspaceId);
      const { accountId, workspaceId } = scope(req);
      await service.remove(accountId, Number(req.params.id), workspaceId);
      res.json({ deleted: true });
    } catch (error) { next(error); }
  });

  return router;
}
