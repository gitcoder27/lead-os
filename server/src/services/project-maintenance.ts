import { and, eq } from "drizzle-orm";
import { db } from "../db/connection";
import { projects, projectTracks, taskPlacements } from "../db/schema";
export const projectDataCounts = async (workspaceId: string, managerAccountId?: string) => {
  const [containers, tracks, memberships] = await Promise.all([
    db
      .select({ id: projects.id })
      .from(projects)
      .where(
        and(
          eq(projects.workspaceId, workspaceId),
          managerAccountId !== undefined ? eq(projects.managerAccountId, managerAccountId) : undefined,
        ),
      ),
    db
      .select({ id: projectTracks.id })
      .from(projectTracks)
      .where(
        and(
          eq(projectTracks.workspaceId, workspaceId),
          managerAccountId !== undefined ? eq(projectTracks.managerAccountId, managerAccountId) : undefined,
        ),
      ),
    db
      .select({ id: taskPlacements.taskId })
      .from(taskPlacements)
      .where(
        and(
          eq(taskPlacements.workspaceId, workspaceId),
          managerAccountId !== undefined ? eq(taskPlacements.managerAccountId, managerAccountId) : undefined,
        ),
      ),
  ]);
  return { projects: containers.length, tracks: tracks.length, memberships: memberships.length };
};
/** FK cascades remove tracks and all memberships in the chosen private scope. */
export const clearProjectData = async (workspaceId: string, managerAccountId?: string) => {
  await db
    .delete(projects)
    .where(
      and(
        eq(projects.workspaceId, workspaceId),
        managerAccountId !== undefined ? eq(projects.managerAccountId, managerAccountId) : undefined,
      ),
    );
};
