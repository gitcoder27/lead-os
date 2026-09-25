import { and, eq, like } from "drizzle-orm";
import { isSystemTaskLabel, TASK_LABEL_COLORS, type TaskLabel } from "shared/types";
import { db } from "../db/connection";
import { taskLabels, tasks } from "../db/schema";
import { runInTransaction } from "../db/transaction";
import { HttpError } from "../middleware/errorHandler";
import { normalizeWorkspaceId } from "./workspace.service";
import { TaskEventsService } from "./task-events.service";
import { TaskKeysService } from "./task-keys.service";

type LabelRow = typeof taskLabels.$inferSelect;

const NAME_PATTERN = /^[a-z0-9][a-z0-9:_-]{0,49}$/;

function mapRow(row: LabelRow): TaskLabel {
  return { name: row.name, color: row.color, system: Boolean(row.system), createdAt: row.createdAt };
}

/** Lowercase/trim a label name; throws 400 on invalid input. */
export function normalizeLabelName(raw: string): string {
  const name = raw.trim().toLowerCase();
  if (!NAME_PATTERN.test(name)) {
    throw new HttpError(400, "Label names must be 1-50 chars of [a-z0-9:_-], starting with a letter or digit");
  }
  return name;
}

function parseLabels(json: string | null): string[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json) as unknown;
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

/**
 * Phase 3 (P3-D13): registry of workspace labels. Task rows still carry the
 * raw string list in `labels_json`; this service owns registration, recolor,
 * rename (transactional rewrite + per-task events) and delete.
 */
export class TaskLabelsService {
  constructor(
    private readonly keys = new TaskKeysService(),
    private readonly events = new TaskEventsService(),
  ) {}

  /** Register a name if absent; returns the row. System-ness is derived. */
  private async upsert(scope: string, name: string, color?: string): Promise<LabelRow> {
    const existing = (await db.select().from(taskLabels).where(and(eq(taskLabels.workspaceId, scope), eq(taskLabels.name, name))).limit(1))[0];
    if (existing) return existing;
    const now = new Date().toISOString();
    const rows = await db.insert(taskLabels)
      .values({ workspaceId: scope, name, color: color ?? "slate", system: isSystemTaskLabel(name), createdAt: now })
      .onConflictDoNothing({ target: [taskLabels.workspaceId, taskLabels.name] })
      .returning();
    if (rows[0]) return rows[0];
    return (await db.select().from(taskLabels).where(and(eq(taskLabels.workspaceId, scope), eq(taskLabels.name, name))).limit(1))[0]!;
  }

  /**
   * Seed the registry from every `labels_json` string already on tasks.
   * Idempotent; runs when the Phase 3 flag is enabled and is safe to re-run.
   */
  async seedFromTasks(workspaceId?: string): Promise<number> {
    const scope = normalizeWorkspaceId(workspaceId);
    const rows = await db.select({ labelsJson: tasks.labelsJson }).from(tasks).where(eq(tasks.workspaceId, scope));
    const names = new Set<string>();
    for (const row of rows) {
      for (const name of parseLabels(row.labelsJson)) names.add(name);
    }
    for (const name of ["category:follow_up", "kind:decision", "kind:waiting", ...names]) {
      if (NAME_PATTERN.test(name)) await this.upsert(scope, name);
    }
    return names.size;
  }

  /** Register any not-yet-known names (used when tasks set labels directly). */
  async ensureRegistered(workspaceId: string | undefined, names: string[]): Promise<void> {
    const scope = normalizeWorkspaceId(workspaceId);
    for (const raw of names) {
      const name = raw.trim().toLowerCase();
      if (NAME_PATTERN.test(name)) await this.upsert(scope, name);
    }
  }

  async list(workspaceId?: string): Promise<TaskLabel[]> {
    const scope = normalizeWorkspaceId(workspaceId);
    await this.keys.assertPhase3Enabled(scope);
    await this.seedFromTasks(scope);
    const rows = await db.select().from(taskLabels).where(eq(taskLabels.workspaceId, scope)).orderBy(taskLabels.name);
    return rows.map(mapRow);
  }

  async create(workspaceId: string | undefined, input: { name: string; color?: string }): Promise<TaskLabel> {
    const scope = normalizeWorkspaceId(workspaceId);
    await this.keys.assertPhase3Enabled(scope);
    const name = normalizeLabelName(input.name);
    if (input.color && !(TASK_LABEL_COLORS as readonly string[]).includes(input.color)) {
      throw new HttpError(400, `Color must be one of: ${TASK_LABEL_COLORS.join(", ")}`);
    }
    const existing = (await db.select().from(taskLabels).where(and(eq(taskLabels.workspaceId, scope), eq(taskLabels.name, name))).limit(1))[0];
    if (existing) throw new HttpError(409, `Label "${name}" already exists`);
    const row = await this.upsert(scope, name, input.color);
    return mapRow(row);
  }

  async update(workspaceId: string | undefined, rawName: string, input: { name?: string; color?: string }, actorAccountId?: string): Promise<TaskLabel> {
    const scope = normalizeWorkspaceId(workspaceId);
    await this.keys.assertPhase3Enabled(scope);
    const name = normalizeLabelName(rawName);
    const row = (await db.select().from(taskLabels).where(and(eq(taskLabels.workspaceId, scope), eq(taskLabels.name, name))).limit(1))[0];
    if (!row) throw new HttpError(404, "Label not found");
    if (input.color && !(TASK_LABEL_COLORS as readonly string[]).includes(input.color)) {
      throw new HttpError(400, `Color must be one of: ${TASK_LABEL_COLORS.join(", ")}`);
    }
    const renameTo = input.name !== undefined ? normalizeLabelName(input.name) : undefined;
    if (row.system && renameTo && renameTo !== name) {
      throw new HttpError(403, `System label "${name}" cannot be renamed`);
    }
    if (renameTo && renameTo !== name) {
      const clash = (await db.select({ id: taskLabels.id }).from(taskLabels).where(and(eq(taskLabels.workspaceId, scope), eq(taskLabels.name, renameTo))).limit(1))[0];
      if (clash) throw new HttpError(409, `Label "${renameTo}" already exists`);
    }

    const affected = renameTo && renameTo !== name
      ? await db.select({ id: tasks.id, taskKey: tasks.taskKey, labelsJson: tasks.labelsJson }).from(tasks)
          .where(and(eq(tasks.workspaceId, scope), like(tasks.labelsJson, `%"${name}"%`)))
      : [];

    const result = await runInTransaction(async () => {
      if (renameTo && renameTo !== name) {
        for (const task of affected) {
          const labels = parseLabels(task.labelsJson).map((l) => (l === name ? renameTo : l));
          await db.update(tasks).set({ labelsJson: JSON.stringify([...new Set(labels)]) }).where(eq(tasks.id, task.id));
        }
        await db.update(taskLabels).set({ name: renameTo }).where(eq(taskLabels.id, row.id));
      }
      if (input.color) {
        await db.update(taskLabels).set({ color: input.color }).where(eq(taskLabels.id, row.id));
      }
      return (await db.select().from(taskLabels).where(eq(taskLabels.id, row.id)).limit(1))[0]!;
    });

    // One private `update` event per rewritten task (P3 §3.3). Authored by the
    // acting manager so it stays visible to them — system-authored private
    // events are hidden from everyone.
    const actor = { type: "manager" as const, accountId: actorAccountId ?? "system" };
    if (renameTo && renameTo !== name) {
      for (const task of affected) {
        await this.events.append({
          taskKey: task.taskKey,
          workspaceId: scope,
          type: "update",
          body: `Label renamed: "${name}" → "${renameTo}"`,
          meta: { labelRenamed: { from: name, to: renameTo } },
          visibility: "private",
          dedupeKey: `p3:label-rename:${scope}:${name}->${renameTo}:${task.taskKey}`,
        }, actor);
      }
    }
    return mapRow(result);
  }

  async remove(workspaceId: string | undefined, rawName: string, actorAccountId?: string): Promise<void> {
    const scope = normalizeWorkspaceId(workspaceId);
    await this.keys.assertPhase3Enabled(scope);
    const name = normalizeLabelName(rawName);
    const row = (await db.select().from(taskLabels).where(and(eq(taskLabels.workspaceId, scope), eq(taskLabels.name, name))).limit(1))[0];
    if (!row) throw new HttpError(404, "Label not found");
    if (row.system) throw new HttpError(403, `System label "${name}" cannot be deleted`);

    const affected = await db.select({ id: tasks.id, taskKey: tasks.taskKey, labelsJson: tasks.labelsJson }).from(tasks)
      .where(and(eq(tasks.workspaceId, scope), like(tasks.labelsJson, `%"${name}"%`)));

    await runInTransaction(async () => {
      for (const task of affected) {
        const labels = parseLabels(task.labelsJson).filter((l) => l !== name);
        await db.update(tasks).set({ labelsJson: JSON.stringify(labels) }).where(eq(tasks.id, task.id));
      }
      await db.delete(taskLabels).where(eq(taskLabels.id, row.id));
    });

    for (const task of affected) {
      await this.events.append({
        taskKey: task.taskKey,
        workspaceId: scope,
        type: "update",
        body: `Label removed: "${name}"`,
        meta: { labelRemoved: { name } },
        visibility: "private",
        dedupeKey: `p3:label-remove:${scope}:${name}:${task.taskKey}`,
      }, { type: "manager", accountId: actorAccountId ?? "system" });
    }
  }
}
