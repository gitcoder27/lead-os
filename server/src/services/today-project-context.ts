import type { TaskPlacementContext, TodayResponse } from "shared/types";
import { visibleTaskRows } from "./task-visibility";
import { readTaskPlacements } from "./task-placements.service";
import type { TaskPrincipal } from "./task.service";

/** Enrich the already-ranked response. No membership, ordering, or pin changes. */
export const addTodayProjectContext = async (today: TodayResponse, actor: TaskPrincipal) => {
  const rows = await visibleTaskRows(actor);
  const placements = await readTaskPlacements(actor, rows.map((row) => row.id));
  const byKey = new Map<string, TaskPlacementContext>();
  for (const row of rows) { const placement = placements.get(row.id); if (placement) byKey.set(row.taskKey, placement); }
  const visit = (value: unknown): void => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) { value.forEach(visit); return; }
    const row = value as Record<string, unknown>;
    const target = row.target as { taskKey?: string; context?: { taskKey?: string } } | undefined;
    const key = typeof row.taskKey === "string" ? row.taskKey : target?.taskKey ?? target?.context?.taskKey;
    if (typeof row.title === "string" && key && byKey.has(key)) row.placement = byKey.get(key);
    for (const [field, child] of Object.entries(row)) if (field !== "placement") visit(child);
  };
  visit(today);
};
