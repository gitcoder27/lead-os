import { SelfIdentityService } from "./self-identity.service";
import { and, eq, inArray } from "drizzle-orm";
import type { PlacementBulkRequest, PlacementBulkResponse, PlacementPreview, PlacementPreviewRequest, TaskPlacement, TaskPlacementContext } from "shared/types";
import { db } from "../db/connection";
import { projects, projectTracks, taskPlacements, tasks } from "../db/schema";
import { runInTransaction } from "../db/transaction";
import { HttpError } from "../middleware/errorHandler";
import { ProjectsService } from "./projects.service";
import type { TaskPrincipal, TaskRow } from "./task.service";
import { taskVisibilityPredicate, visibleTaskRows } from "./task-visibility";
import { normalizeWorkspaceId } from "./workspace.service";

export const readTaskPlacements = async (actor: TaskPrincipal, ids: number[]): Promise<Map<number, TaskPlacementContext>> => {
  if (!ids.length || actor.type === "developer") return new Map();
  const selfDeveloperId = actor.selfDeveloperId ?? await new SelfIdentityService().linkedDeveloperId(actor.accountId, actor.workspaceId);
  const rows = await db.select({ taskId: taskPlacements.taskId, projectId: projects.id, projectName: projects.name, trackId: taskPlacements.trackId, trackName: projectTracks.name }).from(taskPlacements)
    .innerJoin(tasks, eq(tasks.id, taskPlacements.taskId)).innerJoin(projects, eq(projects.id, taskPlacements.projectId)).leftJoin(projectTracks, eq(projectTracks.id, taskPlacements.trackId))
    .where(and(eq(taskPlacements.workspaceId, normalizeWorkspaceId(actor.workspaceId)), eq(taskPlacements.managerAccountId, actor.accountId), inArray(taskPlacements.taskId, ids), taskVisibilityPredicate({ ...actor, selfDeveloperId: selfDeveloperId ?? undefined })));
  return new Map(rows.map(({ taskId, ...placement }) => [taskId, placement]));
};
const placementOf = (placement: TaskPlacement | null | undefined): TaskPlacement | null => placement ? { projectId: placement.projectId, trackId: placement.trackId } : null;
const same = (a: TaskPlacement | null, b: TaskPlacement | null) => a?.projectId === b?.projectId && a?.trackId === b?.trackId;

export class TaskPlacementsService {
  private readonly containers = new ProjectsService();
  async preview(actor: TaskPrincipal, input: PlacementPreviewRequest): Promise<PlacementPreview> {
    this.containers.scope(actor);
    const rows = await visibleTaskRows(actor);
    const byKey = new Map(rows.map((row) => [row.taskKey.toUpperCase(), row]));
    const keys = [...new Set(input.keys.map((key) => key.toUpperCase()))].sort();
    const selected = new Map<number, TaskRow>();
    for (const key of keys) {
      const row = byKey.get(key);
      if (!row) throw new HttpError(404, "Task unavailable");
      selected.set(row.id, row);
    }
    if (input.includeSubtasks) {
      // Traverse visible edges only: a hidden parent's children are never disclosed.
      let added = true;
      while (added) {
        added = false;
        for (const row of rows) if (row.parentId && selected.has(row.parentId) && !selected.has(row.id)) { selected.set(row.id, row); added = true; }
      }
    }
    if (!selected.size || selected.size > 200) throw new HttpError(400, "Select between 1 and 200 visible tasks");
    const placements = await readTaskPlacements(actor, [...selected.keys()]);
    return { keys, includeSubtasks: input.includeSubtasks ?? false, tasks: [...selected.values()].sort((a, b) => a.taskKey.localeCompare(b.taskKey)).map((row) => ({ taskKey: row.taskKey, title: row.title, placement: placementOf(placements.get(row.id)) })) };
  }
  async set(actor: TaskPrincipal, taskId: number, placement: TaskPlacement | null) {
    const scope = this.containers.scope(actor);
    await this.containers.validateDestination(actor, placement);
    await db.delete(taskPlacements).where(and(eq(taskPlacements.workspaceId, scope.workspaceId), eq(taskPlacements.managerAccountId, scope.managerAccountId), eq(taskPlacements.taskId, taskId)));
    if (placement) await db.insert(taskPlacements).values({ ...scope, taskId, ...placement });
  }
  async bulk(actor: TaskPrincipal, input: PlacementBulkRequest): Promise<PlacementBulkResponse> {
    return runInTransaction(async () => {
      const current = await this.preview(actor, input.preview);
      if (current.tasks.length !== input.preview.tasks.length || current.tasks.some((task, index) => task.taskKey !== input.preview.tasks[index]?.taskKey || !same(task.placement, input.preview.tasks[index]!.placement))) throw new HttpError(409, "Placement preview changed. Nothing was moved.");
      const destinations = input.restore ?? current.tasks.map((task) => ({ taskKey: task.taskKey, placement: input.placement ?? null }));
      if (destinations.length !== current.tasks.length || new Set(destinations.map((task) => task.taskKey)).size !== current.tasks.length || destinations.some((task) => !current.tasks.some((entry) => entry.taskKey === task.taskKey))) throw new HttpError(400, "Destinations must match the preview");
      for (const target of destinations) await this.containers.validateDestination(actor, target.placement);
      const rows = await visibleTaskRows(actor);
      for (const target of destinations) await this.set(actor, rows.find((row) => row.taskKey === target.taskKey)!.id, target.placement);
      const post = await this.preview(actor, { keys: current.tasks.map((task) => task.taskKey) });
      return { count: current.tasks.length, undo: { preview: post, restore: current.tasks.map(({ taskKey, placement }) => ({ taskKey, placement })) } };
    });
  }
}
