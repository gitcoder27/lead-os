import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { ManagerTask, MeetingContext, MeetingDocument, MeetingDocumentBody, MeetingDocumentSave, MeetingWorkspaceResponse } from "shared/types";
import { db } from "../db/connection";
import { meetingDocuments, issues } from "../db/schema";
import { runInTransaction } from "../db/transaction";
import { HttpError } from "../middleware/errorHandler";
import { TaskService, type TaskPrincipal } from "./task.service";
import { TaskKeysService } from "./task-keys.service";
import { visibleTaskRows } from "./task-visibility";
import { normalizeWorkspaceId } from "./workspace.service";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const meetingBodySchema = z.object({
  agenda: z.string().max(50000), notes: z.string().max(50000), outcome: z.string().max(4000),
  noDecisions: z.boolean(),
  actions: z.array(z.object({
    id: z.string().min(1).max(100), text: z.string().max(4000),
    ownerAccountId: z.string().min(1).max(200).nullable().optional(), scheduledOn: date.nullable().optional(),
    dueAt: z.string().datetime({ offset: true }).nullable().optional(), followUpAt: z.string().datetime({ offset: true }).nullable().optional(),
    waitingOn: z.object({ type: z.enum(["developer", "contact", "text"]), ref: z.string().nullable().optional(), label: z.string().nullable().optional() }).strict().nullable().optional(),
  }).strict()).max(30).refine((rows) => new Set(rows.map((row) => row.id)).size === rows.length, "Duplicate action ids"),
}).strict();
export const meetingSaveSchema = meetingBodySchema.extend({ documentId: z.string().nullable(), revision: z.number().int().min(0) }).strict();
export const emptyMeetingBody = (): MeetingDocumentBody => ({ agenda: "", notes: "", outcome: "", noDecisions: false, actions: [] });

// All writes to a meeting share a queue, including saves, repeat, finish and Undo.
const writes = new Map<string, Promise<unknown>>();
export async function serializeMeeting<T>(principal: TaskPrincipal, key: string, work: () => Promise<T>): Promise<T> {
  const identity = JSON.stringify([normalizeWorkspaceId(principal.workspaceId), principal.accountId, key.toUpperCase()]);
  const previous = writes.get(identity) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(work);
  writes.set(identity, next);
  try { return await next; }
  finally { if (writes.get(identity) === next) writes.delete(identity); }
}

export class MeetingWorkspaceService {
  constructor(readonly tasks = new TaskService()) {}

  async requireMeeting(key: string, principal: TaskPrincipal) {
    if (principal.type !== "manager") throw new HttpError(403, "Manager access required");
    await new TaskKeysService().assertPhase3Enabled(principal.workspaceId);
    const row = (await visibleTaskRows(principal)).find((task) => task.taskKey === key.toUpperCase());
    if (!row || row.kind !== "meeting") throw new HttpError(404, "Meeting not found");
    return row;
  }

  async document(taskId: number, principal: TaskPrincipal): Promise<MeetingDocument | null> {
    const row = (await db.select().from(meetingDocuments).where(and(
      eq(meetingDocuments.workspaceId, normalizeWorkspaceId(principal.workspaceId)),
      eq(meetingDocuments.managerAccountId, principal.accountId), eq(meetingDocuments.taskId, taskId),
    )).limit(1))[0];
    return row ? { ...JSON.parse(row.bodyJson) as MeetingDocumentBody, id: row.id, revision: row.revision, previousMeetingKey: row.previousMeetingKey, updatedAt: row.updatedAt } : null;
  }

  assertRevision(document: MeetingDocument | null, input: { documentId: string | null; revision: number }) {
    if ((document?.id ?? null) !== input.documentId || (document?.revision ?? 0) !== input.revision)
      throw new HttpError(409, "Meeting changed. Reconcile your draft with the saved version.");
  }

  async write(taskId: number, principal: TaskPrincipal, body: MeetingDocumentBody, current: MeetingDocument | null, previousMeetingKey = current?.previousMeetingKey ?? null): Promise<MeetingDocument> {
    const document = { ...body, id: current?.id ?? randomUUID(), revision: (current?.revision ?? 0) + 1, previousMeetingKey, updatedAt: new Date().toISOString() };
    const row = { id: document.id, workspaceId: normalizeWorkspaceId(principal.workspaceId), managerAccountId: principal.accountId, taskId, bodyJson: JSON.stringify(body), revision: document.revision, previousMeetingKey, updatedAt: document.updatedAt };
    if (current) await db.update(meetingDocuments).set(row).where(eq(meetingDocuments.id, current.id));
    else await db.insert(meetingDocuments).values(row);
    return document;
  }

  async save(key: string, input: MeetingDocumentSave, principal: TaskPrincipal) {
    const parsed = meetingSaveSchema.parse(input);
    return serializeMeeting(principal, key, () => runInTransaction(async () => {
      const task = await this.requireMeeting(key, principal);
      const current = await this.document(task.id, principal);
      // Identity is checked even for identical text; deletion/recreation is never a retry.
      if ((current?.id ?? null) !== parsed.documentId) this.assertRevision(current, parsed);
      const body = meetingBodySchema.parse({ agenda: parsed.agenda, notes: parsed.notes, outcome: parsed.outcome, noDecisions: parsed.noDecisions, actions: parsed.actions });
      if (current && JSON.stringify(meetingBodySchema.parse(currentBody(current))) === JSON.stringify(body)) return current;
      this.assertRevision(current, parsed);
      return this.write(task.id, principal, body, current);
    }));
  }

  async get(key: string, principal: TaskPrincipal): Promise<MeetingWorkspaceResponse> {
    const row = await this.requireMeeting(key, principal);
    const document = await this.document(row.id, principal);
    const task = await this.tasks.toDto(row, principal) as ManagerTask;
    try { return { task, document, context: await this.context(task, document, principal), contextError: null }; }
    catch { return { task, document, context: null, contextError: "Could not load preparation context." }; }
  }

  private async context(task: ManagerTask, document: MeetingDocument | null, principal: TaskPrincipal): Promise<MeetingContext> {
    const visible = await visibleTaskRows(principal);
    const byKey = new Map(visible.map((row) => [row.taskKey, row]));
    const history = new Set([task.id]);
    let previous: MeetingContext["previous"] = null;
    let cursor = document?.previousMeetingKey;
    while (cursor) {
      const row = byKey.get(cursor);
      if (!row || history.has(row.id) || row.kind !== "meeting") break;
      history.add(row.id);
      const doc = await this.document(row.id, principal);
      previous ??= { taskKey: row.taskKey, title: row.title, outcome: doc?.outcome || row.outcome || "", noDecisions: doc?.noDecisions ?? false };
      cursor = doc?.previousMeetingKey;
    }
    const open = visible.filter((row) => !["done", "dropped"].includes(row.status));
    const actions = open.filter((row) => row.parentId && history.has(row.parentId));
    const people = new Set(task.links.filter((link) => link.kind === "person").map((link) => link.ref));
    const commitments = open.filter((row) => row.id !== task.id && row.ownerType === "developer" && people.has(row.ownerId ?? ""));
    const dto = await this.tasks.toDtos(open.filter((row) => row.status === "blocked" && row.id !== task.id), principal) as ManagerTask[];
    const jiraKeys = task.links.filter((link) => link.kind === "jira").map((link) => link.ref);
    const issueRows = jiraKeys.length ? await db.select().from(issues).where(and(eq(issues.workspaceId, normalizeWorkspaceId(principal.workspaceId)), inArray(issues.jiraKey, jiraKeys))) : [];
    return {
      previous, openActions: await this.tasks.toDtos(actions, principal) as ManagerTask[],
      commitments: await this.tasks.toDtos(commitments, principal) as ManagerTask[],
      blockers: dto.filter((row) => task.links.some((link) => link.kind === "task" && link.ref === row.taskKey) || Boolean(task.placement && row.placement?.projectId === task.placement.projectId)),
      issues: issueRows.map((row) => ({ key: row.jiraKey, summary: row.summary, status: row.statusName })),
    };
  }
}
export const currentBody = (doc: MeetingDocument): MeetingDocumentBody => ({ agenda: doc.agenda, notes: doc.notes, outcome: doc.outcome, noDecisions: doc.noDecisions, actions: doc.actions });
