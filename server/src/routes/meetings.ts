import { MeetingCaptureService } from "../services/meeting-capture.service";
import { Router } from "express";
import { z } from "zod";
import { validate } from "../middleware/validate";
import { MeetingWorkspaceService, meetingSaveSchema } from "../services/meeting-workspace.service";

export function createMeetingsRouter(workspace = new MeetingWorkspaceService()) {
  const router = Router();
  const params = z.object({ key: z.string().regex(/^[Tt]-\d{1,9}$/) });
  router.get("/:key/workspace", validate(z.object({ params })), async (req, res, next) => {
    try { res.json(await workspace.get(req.params.key!, { type: "manager", accountId: req.auth!.user.accountId, workspaceId: req.auth!.user.workspaceId })); }
    catch (error) { next(error); }
  });
  router.put("/:key/workspace", validate(z.object({ params, body: meetingSaveSchema })), async (req, res, next) => {
    try { res.json({ document: await workspace.save(req.params.key!, req.body, { type: "manager", accountId: req.auth!.user.accountId, workspaceId: req.auth!.user.workspaceId }) }); }
    catch (error) { next(error); }
  });
  router.post("/:key/undo", validate(z.object({ params, body: z.object({ requestId: z.string().min(1).max(100) }).strict() })), async (req, res, next) => {
    try { res.json(await new MeetingCaptureService(workspace).undo(req.params.key!, req.body.requestId, { type: "manager", accountId: req.auth!.user.accountId, workspaceId: req.auth!.user.workspaceId })); }
    catch (error) { next(error); }
  });
  return router;
}
