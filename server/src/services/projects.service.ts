import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { Project, ProjectTrack, ProjectWrite, TaskPlacement } from "shared/types";
import { db } from "../db/connection";
import { projects, projectTracks } from "../db/schema";
import { runInTransaction } from "../db/transaction";
import { HttpError } from "../middleware/errorHandler";
import type { TaskPrincipal } from "./task.service";
import { normalizeWorkspaceId } from "./workspace.service";

export const projectWriteSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    outcome: z.string().trim().max(4000).nullable().optional(),
    summary: z.string().trim().max(10000).nullable().optional(),
    archived: z.boolean().optional(),
  })
  .strict();
export const placementSchema = z
  .object({ projectId: z.number().int().positive(), trackId: z.number().int().positive().nullable() })
  .strict();

export class ProjectsService {
  scope(actor: TaskPrincipal) {
    if (actor.type === "developer") throw new HttpError(403, "Manager access required");
    return { workspaceId: normalizeWorkspaceId(actor.workspaceId), managerAccountId: actor.accountId };
  }
  async list(actor: TaskPrincipal, archived = false): Promise<Project[]> {
    const scope = this.scope(actor);
    const rows = await db
      .select()
      .from(projects)
      .where(and(eq(projects.workspaceId, scope.workspaceId), eq(projects.managerAccountId, scope.managerAccountId)))
      .orderBy(projects.name);
    return rows.filter((row) => Boolean(row.archivedAt) === archived);
  }
  async requireProject(actor: TaskPrincipal, id: number) {
    const scope = this.scope(actor);
    const [row] = await db
      .select()
      .from(projects)
      .where(
        and(
          eq(projects.workspaceId, scope.workspaceId),
          eq(projects.managerAccountId, scope.managerAccountId),
          eq(projects.id, id),
        ),
      );
    if (!row) throw new HttpError(404, "Project unavailable");
    return row;
  }
  async requireTrack(actor: TaskPrincipal, id: number) {
    const scope = this.scope(actor);
    const [row] = await db
      .select()
      .from(projectTracks)
      .where(
        and(
          eq(projectTracks.workspaceId, scope.workspaceId),
          eq(projectTracks.managerAccountId, scope.managerAccountId),
          eq(projectTracks.id, id),
        ),
      );
    if (!row) throw new HttpError(404, "Track unavailable");
    return row;
  }
  async tracks(actor: TaskPrincipal, projectId: number): Promise<ProjectTrack[]> {
    await this.requireProject(actor, projectId);
    const scope = this.scope(actor);
    return db
      .select()
      .from(projectTracks)
      .where(
        and(
          eq(projectTracks.workspaceId, scope.workspaceId),
          eq(projectTracks.managerAccountId, scope.managerAccountId),
          eq(projectTracks.projectId, projectId),
        ),
      )
      .orderBy(projectTracks.name);
  }
  async validateDestination(actor: TaskPrincipal, placement: TaskPlacement | null) {
    if (!placement) return;
    const project = await this.requireProject(actor, placement.projectId);
    if (project.archivedAt) throw new HttpError(409, "Project is archived");
    if (placement.trackId !== null) {
      const track = await this.requireTrack(actor, placement.trackId);
      if (track.projectId !== project.id) throw new HttpError(400, "Track belongs to another project");
      if (track.archivedAt) throw new HttpError(409, "Track is archived");
    }
  }
  async write(
    actor: TaskPrincipal,
    input: ProjectWrite,
    id?: number,
    projectId?: number,
  ): Promise<Project | ProjectTrack> {
    const parsed = projectWriteSchema.safeParse(input);
    if (!parsed.success) throw new HttpError(400, "Invalid project information");
    const data = parsed.data;
    return runInTransaction(async () => {
      const scope = this.scope(actor);
      const table = projectId !== undefined ? projectTracks : projects;
      const current = id
        ? projectId !== undefined
          ? await this.requireTrack(actor, id)
          : await this.requireProject(actor, id)
        : null;
      if (projectId !== undefined) {
        const parent = await this.requireProject(actor, projectId);
        if (!id && parent.archivedAt) throw new HttpError(409, "Project is archived");
      }
      if (!id && !data.name) throw new HttpError(400, "Name is required");
      const name = data.name ?? current!.name;
      const duplicate = await db
        .select({ id: table.id })
        .from(table)
        .where(
          and(
            eq(table.workspaceId, scope.workspaceId),
            eq(table.managerAccountId, scope.managerAccountId),
            eq(table.name, name),
            projectId !== undefined ? eq(projectTracks.projectId, projectId) : undefined,
          ),
        );
      if (duplicate.some((row) => row.id !== id)) throw new HttpError(409, "This name is already in use");
      const now = new Date().toISOString();
      const values = {
        name,
        updatedAt: now,
        ...(data.outcome !== undefined && { outcome: data.outcome || null }),
        ...(data.summary !== undefined && { summary: data.summary || null, summaryUpdatedAt: now }),
        ...(data.archived !== undefined && { archivedAt: data.archived ? now : null }),
      };
      if (id)
        return (
          await db
            .update(table)
            .set(values)
            .where(
              and(
                eq(table.id, id),
                eq(table.workspaceId, scope.workspaceId),
                eq(table.managerAccountId, scope.managerAccountId),
              ),
            )
            .returning()
        )[0]!;
      if (projectId !== undefined)
        return (
          await db
            .insert(projectTracks)
            .values({ ...scope, ...values, createdAt: now, projectId })
            .returning()
        )[0]!;
      return (
        await db
          .insert(projects)
          .values({ ...scope, ...values, createdAt: now })
          .returning()
      )[0]!;
    });
  }
  async clear(actor: TaskPrincipal) {
    const scope = this.scope(actor);
    await db
      .delete(projects)
      .where(and(eq(projects.workspaceId, scope.workspaceId), eq(projects.managerAccountId, scope.managerAccountId)));
  }
}
