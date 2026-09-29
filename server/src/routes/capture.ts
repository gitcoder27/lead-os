import { Router } from "express";
import { z } from "zod";
import { validate } from "../middleware/validate";
import { CaptureService } from "../services/capture.service";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const timestamp = z.string().datetime({ offset: true });
const taskKey = z.string().regex(/^[Tt]-\d{1,9}$/);

/** docs/57 §3 (P3-05): structured context that only fills what the text leaves open. */
const defaultsSchema = z.object({
  ownerAccountId: z.string().trim().min(1).max(200).nullable().optional(),
  waitingOn: z.object({
    type: z.enum(["developer", "contact", "text"]),
    ref: z.string().trim().min(1).max(128).nullable().optional(),
    label: z.string().trim().min(1).max(200).nullable().optional(),
  }).strict().nullable().optional(),
  scheduledOn: isoDate.nullable().optional(),
  followUpAt: timestamp.nullable().optional(),
  dueAt: timestamp.nullable().optional(),
  startsAt: timestamp.nullable().optional(),
  endsAt: timestamp.nullable().optional(),
  later: z.boolean().optional(),
  kind: z.enum(["task", "meeting"]).optional(),
  status: z.enum(["open", "active", "blocked"]).optional(),
  priority: z.enum(["normal", "high"]).optional(),
  parentKey: taskKey.optional(),
  labels: z.array(z.string().trim().min(1).max(100)).max(50).optional(),
  participants: z.string().max(4000).optional(),
  nextAction: z.string().max(4000).optional(),
  contextNote: z.string().max(20000).optional(),
  links: z.object({
    jiraKeys: z.array(z.string().trim().min(1).max(64)).max(20).optional(),
    developerAccountIds: z.array(z.string().trim().min(1).max(200)).max(20).optional(),
  }).strict().optional(),
  source: z.object({
    type: z.literal("note"),
    noteDate: isoDate,
    noteKind: z.enum(["scratchpad", "standup"]).optional(),
  }).strict().optional(),
}).strict();

const bodySchema = z.object({
  text: z.string().min(1).max(4000),
  defaults: defaultsSchema.optional(),
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
