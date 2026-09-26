import { Router } from "express";
import type { Request } from "express";
import { z } from "zod";
import {
  oneOnOneAgendaAttachSchema,
  oneOnOneAgendaReorderSchema,
  oneOnOneSeriesCreateSchema,
  oneOnOneSeriesUpdateSchema,
  oneOnOneSessionActionSchema,
  oneOnOneSessionCreateSchema,
  oneOnOneSessionUpdateSchema,
} from "shared/types";
import { validate } from "../middleware/validate";
import { OneOnOneService } from "../services/one-on-one.service";
import type { TaskPrincipal } from "../services/task.service";

const idParams = z.object({ params: z.object({ id: z.coerce.number().int().positive() }), body: z.any().optional(), query: z.any().optional() });
const sessionParams = z.object({ params: z.object({ id: z.coerce.number().int().positive(), sid: z.coerce.number().int().positive() }), body: z.any().optional(), query: z.any().optional() });
const agendaItemParams = z.object({ params: z.object({ id: z.coerce.number().int().positive(), itemId: z.coerce.number().int().positive() }), body: z.any().optional(), query: z.any().optional() });
const seriesCreate = z.object({ params: z.any().optional(), body: oneOnOneSeriesCreateSchema, query: z.any().optional() });
const seriesUpdate = z.object({ params: z.object({ id: z.coerce.number().int().positive() }), body: oneOnOneSeriesUpdateSchema, query: z.any().optional() });
const sessionCreate = z.object({ params: z.object({ id: z.coerce.number().int().positive() }), body: oneOnOneSessionCreateSchema, query: z.any().optional() });
const sessionUpdate = z.object({ params: z.object({ id: z.coerce.number().int().positive(), sid: z.coerce.number().int().positive() }), body: oneOnOneSessionUpdateSchema, query: z.any().optional() });
const agendaAttach = z.object({ params: z.object({ id: z.coerce.number().int().positive() }), body: oneOnOneAgendaAttachSchema, query: z.any().optional() });
const agendaReorder = z.object({ params: z.object({ id: z.coerce.number().int().positive() }), body: oneOnOneAgendaReorderSchema, query: z.any().optional() });
const sessionAction = z.object({ params: z.object({ id: z.coerce.number().int().positive(), sid: z.coerce.number().int().positive() }), body: oneOnOneSessionActionSchema, query: z.any().optional() });

/**
 * docs/48 §3: the manager-private 1:1 workspace API. Mounted behind
 * `requireManager` in app.ts; every route additionally asserts the
 * `one_on_one_enabled` flag so flag-off = 404 (OO §0 parity rule).
 */
export function createOneOnOnesRouter(service = new OneOnOneService()): Router {
  const router = Router();
  const workspaceId = (req: Request) => req.auth!.user.workspaceId;
  const principal = (req: Request): TaskPrincipal => ({
    type: "manager",
    accountId: req.auth!.user.accountId,
    workspaceId: req.auth!.user.workspaceId,
  });

  router.use(async (req, _res, next) => {
    try {
      await service.assertEnabled(req.auth?.user.workspaceId);
      next();
    } catch (error) {
      next(error);
    }
  });

  router.get("/", async (req, res, next) => {
    try {
      res.json({ series: await service.listSeries(workspaceId(req)) });
    } catch (error) {
      next(error);
    }
  });

  router.post("/", validate(seriesCreate), async (req, res, next) => {
    try {
      res.status(201).json(await service.createSeries(req.body, workspaceId(req)));
    } catch (error) {
      next(error);
    }
  });

  router.get("/:id", validate(idParams), async (req, res, next) => {
    try {
      res.json(await service.getDetail(Number(req.params.id), workspaceId(req)));
    } catch (error) {
      next(error);
    }
  });

  router.patch("/:id", validate(seriesUpdate), async (req, res, next) => {
    try {
      res.json(await service.updateSeries(Number(req.params.id), req.body, workspaceId(req)));
    } catch (error) {
      next(error);
    }
  });

  router.post("/:id/sessions", validate(sessionCreate), async (req, res, next) => {
    try {
      res.status(201).json(await service.createSession(Number(req.params.id), req.body, workspaceId(req)));
    } catch (error) {
      next(error);
    }
  });

  router.patch("/:id/sessions/:sid", validate(sessionUpdate), async (req, res, next) => {
    try {
      res.json(
        await service.updateSession(Number(req.params.id), Number(req.params.sid), req.body, workspaceId(req)),
      );
    } catch (error) {
      next(error);
    }
  });

  router.get("/:id/agenda", validate(idParams), async (req, res, next) => {
    try {
      res.json({ items: await service.listAgenda(Number(req.params.id), workspaceId(req)) });
    } catch (error) {
      next(error);
    }
  });

  router.post("/:id/agenda", validate(agendaAttach), async (req, res, next) => {
    try {
      res.status(201).json({ item: await service.attachAgenda(Number(req.params.id), req.body, principal(req), workspaceId(req)) });
    } catch (error) {
      next(error);
    }
  });

  router.patch("/:id/agenda", validate(agendaReorder), async (req, res, next) => {
    try {
      res.json({ items: await service.reorderAgenda(Number(req.params.id), req.body, workspaceId(req)) });
    } catch (error) {
      next(error);
    }
  });

  router.delete("/:id/agenda/:itemId", validate(agendaItemParams), async (req, res, next) => {
    try {
      await service.detachAgenda(Number(req.params.id), Number(req.params.itemId), workspaceId(req));
      res.json({ deleted: true });
    } catch (error) {
      next(error);
    }
  });

  router.post("/:id/sessions/:sid/actions", validate(sessionAction), async (req, res, next) => {
    try {
      res.status(201).json(await service.createSessionAction(Number(req.params.id), Number(req.params.sid), req.body, principal(req), workspaceId(req)));
    } catch (error) {
      next(error);
    }
  });

  return router;
}
