import type { TaskPlacementContext, TodayResponse } from "shared/types";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "../db/connection";
import { tasks } from "../db/schema";
import { normalizeWorkspaceId } from "./workspace.service";
import { readTaskPlacements } from "./task-placements.service";
import type { TaskPrincipal } from "./task.service";

/** Enrich the already-ranked response. No membership, ordering, or pin changes. */
export const addTodayProjectContext = async (today: TodayResponse, actor: TaskPrincipal) => {
  const keys = new Set<string>();
  const collect = (value: unknown): void => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach(collect);
      return;
    }
    const row = value as Record<string, unknown>;
    const target = row.target as { taskKey?: string; context?: { taskKey?: string } } | undefined;
    const key = typeof row.taskKey === "string" ? row.taskKey : (target?.taskKey ?? target?.context?.taskKey);
    if (typeof row.title === "string" && key) keys.add(key);
    Object.values(row).forEach(collect);
  };
  collect(today);
  if (!keys.size) return;
  const rows = await db
    .select({ id: tasks.id, taskKey: tasks.taskKey })
    .from(tasks)
    .where(
      and(
        eq(tasks.workspaceId, normalizeWorkspaceId(actor.workspaceId)),
        inArray(tasks.taskKey, [...keys]),
        isNull(tasks.deletedAt),
      ),
    );
  const placements = await readTaskPlacements(
    actor,
    rows.map((row) => row.id),
  );
  const byKey = new Map<string, TaskPlacementContext>();
  for (const row of rows) {
    const placement = placements.get(row.id);
    if (placement) byKey.set(row.taskKey, placement);
  }
  const visit = (value: unknown): void => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    const row = value as Record<string, unknown>;
    const target = row.target as { taskKey?: string; context?: { taskKey?: string } } | undefined;
    const key = typeof row.taskKey === "string" ? row.taskKey : (target?.taskKey ?? target?.context?.taskKey);
    if (typeof row.title === "string" && key && byKey.has(key)) row.placement = byKey.get(key);
    for (const [field, child] of Object.entries(row)) if (field !== "placement") visit(child);
  };
  visit(today);
};
