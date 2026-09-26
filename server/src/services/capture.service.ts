import { and, eq, inArray, ne } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import {
  parseCapture,
  resolveCapture,
  type CaptureLookups,
  type CaptureRequestBody,
  type CaptureResponseBody,
  type ParsedCapture,
  type ResolvedCapture,
} from "shared/capture-grammar";
import { db } from "../db/connection";
import { runInTransaction } from "../db/transaction";
import { developers, issues, tasks } from "../db/schema";
import { HttpError } from "../middleware/errorHandler";
import { todayIsoDate } from "../utils/date";
import { DailyNotesService } from "./daily-notes.service";
import { TaskEventsService } from "./task-events.service";
import { TaskKeysService } from "./task-keys.service";
import { TaskService, type TaskPrincipal } from "./task.service";
import { normalizeWorkspaceId } from "./workspace.service";
import type { ManagerTask } from "shared/types";

/**
 * Phase 3 (P3-D7/D8, §4.3): `POST /api/capture` — the single capture box.
 * Re-parses the text server-side (the client preview is never trusted),
 * resolves tokens against workspace data, then dispatches to task creation,
 * a task event, or today's daily note.
 */
export class CaptureService {
  constructor(
    private readonly keys = new TaskKeysService(),
    private readonly taskService = new TaskService(),
    private readonly events = new TaskEventsService(),
    private readonly notes = new DailyNotesService(),
  ) {}

  async run(input: CaptureRequestBody, principal: TaskPrincipal): Promise<CaptureResponseBody> {
    const scope = normalizeWorkspaceId(principal.workspaceId);
    await this.keys.assertPhase3Enabled(scope);

    const serverToday = todayIsoDate();
    if (input.clientToday) {
      const drift = Math.abs(Date.parse(`${serverToday}T00:00:00Z`) - Date.parse(`${input.clientToday}T00:00:00Z`));
      if (Number.isNaN(drift) || drift > 86_400_000) {
        throw new HttpError(400, `Client today (${input.clientToday}) is out of sync with server today (${serverToday})`);
      }
    }

    const parsed = parseCapture(input.text, serverToday);
    const resolved = await this.resolve(parsed, scope);
    const base = { intent: resolved.intent, diagnostics: resolved.diagnostics };

    if (resolved.blocked) return { ...base, blocked: true };
    if (resolved.confirmRequired && !input.confirm) return { ...base, confirmRequired: true };

    switch (resolved.intent) {
      case "update":
        return { ...base, event: await this.applyUpdate(resolved, input.requestId ?? randomUUID(), principal) };
      case "note":
        return { ...base, note: await this.notes.append(principal.accountId, serverToday, { text: resolved.title, requestId: input.requestId ?? randomUUID() }, scope) };
      default:
        return { ...base, task: await this.applyCreate(resolved, principal, input.requestId ?? randomUUID()) };
    }
  }

  /** Fetch the candidates the shared resolver needs, then resolve synchronously. */
  private async resolve(parsed: ParsedCapture, workspaceId: string): Promise<ResolvedCapture> {
    const keys = [
      ...new Set(
        parsed.tokens
          .filter((token) => ["taskref", "parent", "command"].includes(token.kind) && token.value)
          .map((token) => token.value!),
      ),
    ];
    const jiraKeys = [...new Set(parsed.tokens.filter((token) => token.kind === "jira" && token.value).map((token) => token.value!))];

    const [peopleRows, jiraRows] = await Promise.all([
      db.select({ accountId: developers.accountId, displayName: developers.displayName })
        .from(developers)
        .where(and(eq(developers.workspaceId, workspaceId), eq(developers.isActive, 1))),
      jiraKeys.length
        ? db.select({ jiraKey: issues.jiraKey }).from(issues)
            .where(and(eq(issues.workspaceId, workspaceId), inArray(issues.jiraKey, jiraKeys), eq(issues.excluded, 0), ne(issues.syncScopeState, "out_of_scope")))
        : Promise.resolve([]),
    ]);

    // Resolve key aliases first, then look up live state.
    const taskStateByKey = new Map<string, "ok" | "deleted">();
    for (const rawKey of keys) {
      const resolvedKey = await this.keys.resolve(workspaceId, rawKey);
      if (!resolvedKey) continue;
      const row = (await db.select({ deletedAt: tasks.deletedAt }).from(tasks)
        .where(and(eq(tasks.workspaceId, workspaceId), eq(tasks.taskKey, resolvedKey))).limit(1))[0];
      if (row) taskStateByKey.set(rawKey, row.deletedAt ? "deleted" : "ok");
    }
    const synced = new Set(jiraRows.map((row) => row.jiraKey));

    const lookups: CaptureLookups = {
      people: peopleRows,
      jiraSynced: (key) => synced.has(key),
      taskState: (key) => taskStateByKey.get(key) ?? "unknown",
    };
    return resolveCapture(parsed, lookups);
  }

  /** `T-n: text` — a shared update event on the target task. */
  private async applyUpdate(resolved: ResolvedCapture, requestId: string, principal: TaskPrincipal) {
    const scope = normalizeWorkspaceId(principal.workspaceId);
    const key = await this.keys.resolve(scope, resolved.updateTargetKey!);
    if (!key) throw new HttpError(404, "Task not found");
    const { event } = await this.events.appendWithReplay(
      {
        workspaceId: scope,
        taskKey: key,
        type: "update",
        body: resolved.title,
        meta: { via: "capture" },
        visibility: "shared",
        requestId,
      },
      { type: principal.type, accountId: principal.accountId },
    );
    return event;
  }

  /**
   * create intent — TaskService.create plus link writes for #, ^ and T-n,
   * all in one transaction. `requestId` replays to the originally created
   * task (the `created` event carries the `req:` dedupe key), so a transport
   * retry does not duplicate the task.
   */
  private async applyCreate(resolved: ResolvedCapture, principal: TaskPrincipal, requestId: string) {
    const scope = normalizeWorkspaceId(principal.workspaceId);
    const existing = await this.events.getByRequestId(requestId, { kind: "manager", accountId: principal.accountId, workspaceId: scope });
    if (existing?.event.type === "created" && existing.event.taskKey) {
      const replayed = await this.taskService.getByKey(existing.event.taskKey, scope);
      if (replayed && !replayed.deletedAt) return (await this.taskService.toDto(replayed, principal)) as ManagerTask;
    }
    return runInTransaction(async () => {
      const today = todayIsoDate();
      let parentId: number | null = null;
      if (resolved.parentKey) {
        const parentKey = await this.keys.resolve(scope, resolved.parentKey);
        const parent = parentKey ? await this.taskService.getByKey(parentKey, scope) : undefined;
        if (!parent || parent.deletedAt) throw new HttpError(400, "Parent task not found");
        parentId = parent.id;
      }
      const row = await this.taskService.create(
        {
          title: resolved.title,
          kind: resolved.meeting ? "meeting" : "task",
          // P3-D7: no @person → the manager owns it (create() defaults to me).
          ownerType: resolved.owner ? "developer" : undefined,
          ownerId: resolved.owner?.accountId,
          priority: resolved.priority,
          labels: resolved.labels,
          later: resolved.later,
          scheduledOn: resolved.later ? null : (resolved.scheduledOn ?? today),
          // §4.1: `/f` with a date stores a local-time morning timestamp
          // (the buildSnoozeIso convention); dateless `/f` leaves follow_up_at
          // NULL — the injected `category:follow_up` label carries the follow-up.
          followUpAt: resolved.followUpAt ? new Date(`${resolved.followUpAt}T09:00:00`).toISOString() : null,
          parentId,
        },
        principal,
        { requestId, source: "capture" },
      );
      for (const link of resolved.jiraLinks) {
        await this.taskService.addLink(row.taskKey, { kind: "jira", ref: link.key, role: link.primary ? "primary" : "related" }, principal);
      }
      for (const person of resolved.peopleLinks) {
        await this.taskService.addLink(row.taskKey, { kind: "person", ref: person.accountId }, principal);
      }
      for (const key of resolved.taskLinks) {
        const target = await this.keys.resolve(scope, key);
        if (target) await this.taskService.addLink(row.taskKey, { kind: "task", ref: target }, principal);
      }
      // Capture runs under a manager/copilot principal, so the DTO is always the
      // manager projection.
      return (await this.taskService.toDto(row, principal)) as ManagerTask;
    });
  }
}
