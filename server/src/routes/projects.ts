import { ProjectFactsService } from "../services/project-facts.service";
import { isValidTimeZone } from "../services/today-clock";
import { Router, type Request } from "express";
import { z } from "zod";
import { validate } from "../middleware/validate";
import { ProjectsService, projectWriteSchema } from "../services/projects.service";
import type { TaskPrincipal } from "../services/task.service";

export const projectActor = (req: Request): TaskPrincipal => ({ type: "manager", accountId: req.auth!.user.accountId, workspaceId: req.auth!.user.workspaceId });
const params = z.object({ id: z.coerce.number().int().positive() });
const write = z.object({ params, body: projectWriteSchema, query: z.any().optional() });
export function createProjectsRouter() {
  const router = Router();
  const service = new ProjectsService();
  const facts = new ProjectFactsService();
  const zone = (req: Request) => isValidTimeZone(req.query.tz as string) ? req.query.tz as string : undefined;
  router.get("/", async (req, res, next) => { try { res.json({ projects: await facts.list(projectActor(req), req.query.archived === "true", req.query.today as string | undefined, zone(req)) }); } catch (error) { next(error); } });
  router.get("/:id", validate(z.object({ params, query: z.any().optional(), body: z.any().optional() })), async (req, res, next) => { try { const actor = projectActor(req); res.json(await facts.detail(actor, Number(req.params.id), req.query.today as string | undefined, zone(req))); } catch (error) { next(error); } });
  router.post("/", validate(z.object({ body: projectWriteSchema.extend({ name: z.string().trim().min(1).max(120) }), params: z.any().optional(), query: z.any().optional() })), async (req, res, next) => { try { res.status(201).json(await service.write(projectActor(req), req.body)); } catch (error) { next(error); } });
  router.patch("/:id", validate(write), async (req, res, next) => { try { res.json(await service.write(projectActor(req), req.body, Number(req.params.id))); } catch (error) { next(error); } });
  router.post("/:id/tracks", validate(write), async (req, res, next) => { try { res.status(201).json(await service.write(projectActor(req), req.body, undefined, Number(req.params.id))); } catch (error) { next(error); } });
  return router;
}
export function createProjectTracksRouter() {
  const router = Router();
  const service = new ProjectsService();
  router.patch("/:id", validate(write), async (req, res, next) => { try { const actor = projectActor(req); const track = await service.requireTrack(actor, Number(req.params.id)); res.json(await service.write(actor, req.body, track.id, track.projectId)); } catch (error) { next(error); } });
  return router;
}
