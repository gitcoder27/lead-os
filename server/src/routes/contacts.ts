import { Router } from "express";
import { z } from "zod";
import { validate } from "../middleware/validate";
import { ContactsService, createContactSchema } from "../services/contacts.service";

/**
 * docs/57 §2 (P3-03): `/api/contacts` — the manager's private external
 * stakeholders (who a task can wait on). Manager-only; every call is scoped to
 * the signed-in manager.
 */
export function createContactsRouter(service = new ContactsService()): Router {
  const router = Router();

  router.get("/", async (req, res, next) => {
    try {
      const user = req.auth!.user;
      res.json({ contacts: await service.list(user.accountId, user.workspaceId) });
    } catch (error) { next(error); }
  });

  router.post("/", validate(z.object({ body: createContactSchema, params: z.any().optional(), query: z.any().optional() })), async (req, res, next) => {
    try {
      const user = req.auth!.user;
      res.status(201).json(await service.create(user.accountId, req.body, user.workspaceId));
    } catch (error) { next(error); }
  });

  router.delete("/:id", validate(z.object({ params: z.object({ id: z.coerce.number().int().positive() }), body: z.any().optional(), query: z.any().optional() })), async (req, res, next) => {
    try {
      const user = req.auth!.user;
      await service.archive(user.accountId, Number(req.params.id), user.workspaceId);
      res.json({ archived: true });
    } catch (error) { next(error); }
  });

  return router;
}
