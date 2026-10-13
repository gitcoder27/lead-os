import { TaskEventsService } from "./task-events.service";
import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { ManagerTask, MeetingActionDraft, MeetingCaptureRequest, MeetingCaptureResponse, MeetingDocument } from "shared/types";
import { db } from "../db/connection";
import { meetingCaptureReceipts, taskLinks, taskPlacements, tasks } from "../db/schema";
import { runInTransaction } from "../db/transaction";
import { HttpError } from "../middleware/errorHandler";
import { CaptureService } from "./capture.service";
import { currentBody, emptyMeetingBody, MeetingWorkspaceService, serializeMeeting } from "./meeting-workspace.service";
import type { TaskPrincipal } from "./task.service";
import { normalizeWorkspaceId } from "./workspace.service";
import { isValidTimeZone } from "./today-clock";
import { todayIsoDate } from "../utils/date";

type TaskRow = typeof tasks.$inferSelect;
interface UndoSnapshot { before: TaskRow; document: MeetingDocument | null; afterRevision: number; fingerprints: Array<{ key: string; value: string }>; created: string[]; expiresAt: string }
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value, (_key, item) => item && typeof item === "object" && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map((key) => [key, item[key]])) : item)).digest("hex");

export class MeetingCaptureService {
  constructor(private readonly workspace = new MeetingWorkspaceService(), private readonly capture = new CaptureService()) {}

  async run(input: MeetingCaptureRequest, principal: TaskPrincipal): Promise<MeetingCaptureResponse> {
    return serializeMeeting(principal, input.meetingKey, async () => {
      const before = await this.workspace.requireMeeting(input.meetingKey, principal);
      const receipt = await this.receipt(input.requestId, principal);
      const payloadHash = hash(input);
      if (receipt) {
        if (receipt.payloadHash !== payloadHash) throw new HttpError(409, "requestId was already used with a different payload");
        return JSON.parse(receipt.responseJson) as MeetingCaptureResponse;
      }
      const document = await this.workspace.document(before.id, principal);
      this.workspace.assertRevision(document, input);
      this.assertClock(input);
      if (input.operation === "meeting-repeat") return this.repeat(input, before, document, principal, payloadHash);
      if (!document?.outcome.trim() && !document?.noDecisions && !before.outcome?.trim()) throw new HttpError(400, "Record a brief outcome or choose No decisions to record");
      if (before.status === "dropped") throw new HttpError(409, "Reopen a dropped meeting first");
      const prepared: Array<Awaited<ReturnType<CaptureService["prepareCreate"]>> & { action: MeetingActionDraft }> = [];
      for (const action of document?.actions ?? []) {
        if (!action.text.trim()) throw new HttpError(400, "Action titles cannot be empty");
        prepared.push({ action, ...await this.capture.prepareCreate({ text: action.text, clientToday: input.clientToday, tz: input.tz }, principal) });
      }
      const diagnostics = prepared.flatMap((item) => item.resolved.diagnostics);
      if (prepared.some((item) => item.resolved.blocked)) return { operation: input.operation, diagnostics, blocked: true };
      if (prepared.some((item) => item.resolved.confirmRequired) && !input.confirm) return { operation: input.operation, diagnostics, confirmRequired: true };
      return runInTransaction(async () => {
        this.workspace.assertRevision(await this.workspace.document(before.id, principal), input);
        const actions: ManagerTask[] = [];
        for (const { action, resolved, clock } of prepared) {
          actions.push(await this.capture.applyCreate(resolved, principal, `meeting:${hash([normalizeWorkspaceId(principal.workspaceId), principal.accountId, input.requestId, action.id])}`, {
            parentKey: before.taskKey, scheduledOn: action.scheduledOn ?? null,
            ...(action.ownerAccountId ? { ownerAccountId: action.ownerAccountId } : {}),
            dueAt: action.dueAt ?? null, followUpAt: action.followUpAt ?? null, waitingOn: action.waitingOn ?? null,
          }, clock));
        }
        const after = await this.workspace.tasks.update(before.taskKey, { status: "done" }, principal);
        const saved = await this.workspace.write(before.id, principal, { ...currentBody(document ?? { ...emptyMeetingBody(), id: "", revision: 0, previousMeetingKey: null, updatedAt: "" }), actions: [] }, document);
        const response: MeetingCaptureResponse = { operation: input.operation, diagnostics, task: await this.workspace.tasks.toDto(after, principal) as ManagerTask, actions, document: saved };
        return this.record(input, principal, payloadHash, before, document, saved.revision, response, actions.map((task) => task.taskKey));
      });
    });
  }

  private assertClock(input: MeetingCaptureRequest) {
    if (!isValidTimeZone(input.tz)) throw new HttpError(400, "A valid time zone is required");
    const reference = todayIsoDate(new Date(), input.tz);
    const parsed = Date.parse(`${input.clientToday}T00:00:00Z`);
    if (!Number.isFinite(parsed) || Math.abs(Date.parse(`${reference}T00:00:00Z`) - parsed) > 86400000) throw new HttpError(400, "Client today is out of sync");
  }

  private async repeat(input: MeetingCaptureRequest, before: TaskRow, document: MeetingDocument | null, principal: TaskPrincipal, payloadHash: string) {
    if (before.status !== "done") throw new HttpError(409, "Finish this meeting before meeting again");
    if (!input.scheduledOn || !/^\d{4}-\d{2}-\d{2}$/.test(input.scheduledOn) || (!Number.isFinite(Date.parse(`${input.scheduledOn}T00:00:00Z`)) || new Date(`${input.scheduledOn}T00:00:00Z`).toISOString().slice(0, 10) !== input.scheduledOn)) throw new HttpError(400, "Choose a valid next date");
    return runInTransaction(async () => {
      const dto = await this.workspace.tasks.toDto(before, principal) as ManagerTask;
      const row = await this.workspace.tasks.create({ title: before.title, kind: "meeting", participants: before.participants, scheduledOn: input.scheduledOn, startsAt: input.startsAt ?? null, endsAt: input.endsAt ?? null }, principal, { source: "capture", placement: dto.placement ? { projectId: dto.placement.projectId, trackId: dto.placement.trackId } : null });
      for (const link of dto.links) await this.workspace.tasks.addLink(row.taskKey, { kind: link.kind, ref: link.ref, role: link.role }, principal);
      const next = await this.workspace.write(row.id, principal, { ...emptyMeetingBody(), agenda: document?.agenda ?? "" }, null, before.taskKey);
      const response: MeetingCaptureResponse = { operation: input.operation, diagnostics: [], task: await this.workspace.tasks.toDto(row, principal) as ManagerTask, document: next };
      return this.record(input, principal, payloadHash, before, document, document?.revision ?? 0, response, [row.taskKey]);
    });
  }

  private receipt(requestId: string, principal: TaskPrincipal) {
    return db.select().from(meetingCaptureReceipts).where(and(eq(meetingCaptureReceipts.workspaceId, normalizeWorkspaceId(principal.workspaceId)), eq(meetingCaptureReceipts.managerAccountId, principal.accountId), eq(meetingCaptureReceipts.requestId, requestId))).limit(1).then((rows) => rows[0]);
  }

  private async fingerprint(key: string, principal: TaskPrincipal) {
    const row = await this.workspace.tasks.requireTask(key, principal);
    const scope = normalizeWorkspaceId(principal.workspaceId);
    const events = await new TaskEventsService().mutationFingerprint(scope, row.id);
    const links = await db.select().from(taskLinks).where(and(eq(taskLinks.workspaceId, scope), eq(taskLinks.taskId, row.id)));
    const placements = await db.select().from(taskPlacements).where(and(eq(taskPlacements.workspaceId, scope), eq(taskPlacements.taskId, row.id)));
    const children = await db.select().from(tasks).where(and(eq(tasks.workspaceId, scope), eq(tasks.parentId, row.id)));
    const doc = await this.workspace.document(row.id, principal);
    return hash({ row, events, links, placements, children, doc });
  }

  private async record(input: MeetingCaptureRequest, principal: TaskPrincipal, payloadHash: string, before: TaskRow, document: MeetingDocument | null, afterRevision: number, response: MeetingCaptureResponse, created: string[]) {
    const expiresAt = new Date(Date.now() + 6000).toISOString();
    const fingerprints = [];
    for (const key of [before.taskKey, ...created]) fingerprints.push({ key, value: await this.fingerprint(key, principal) });
    const snapshot: UndoSnapshot = { before, document, afterRevision, fingerprints, created, expiresAt };
    response.undo = { requestId: input.requestId, expiresAt };
    await db.insert(meetingCaptureReceipts).values({ workspaceId: normalizeWorkspaceId(principal.workspaceId), managerAccountId: principal.accountId, requestId: input.requestId, taskId: before.id, payloadHash, responseJson: JSON.stringify(response), undoJson: JSON.stringify(snapshot) });
    return response;
  }

  async undo(key: string, requestId: string, principal: TaskPrincipal) {
    return serializeMeeting(principal, key, () => runInTransaction(async () => {
      const meeting = await this.workspace.requireMeeting(key, principal);
      const receipt = await this.receipt(requestId, principal);
      if (!receipt || receipt.taskId !== meeting.id) throw new HttpError(404, "Meeting receipt not found");
      if (receipt.undoneAt) return { undone: true };
      const snapshot = JSON.parse(receipt.undoJson) as UndoSnapshot;
      if (Date.now() > Date.parse(snapshot.expiresAt)) throw new HttpError(409, "Undo window expired");
      for (const item of snapshot.fingerprints) if (await this.fingerprint(item.key, principal) !== item.value) throw new HttpError(409, "Meeting or actions changed; Undo is no longer available");
      for (const child of snapshot.created) await this.workspace.tasks.remove(child, principal);
      const response = JSON.parse(receipt.responseJson) as MeetingCaptureResponse;
      if (response.operation === "meeting-finish") {
        await this.workspace.tasks.update(key, { status: snapshot.before.status as "open" | "active" | "blocked" | "done" }, principal);
        const doc = await this.workspace.document(meeting.id, principal);
        await this.workspace.write(meeting.id, principal, snapshot.document ? currentBody(snapshot.document) : emptyMeetingBody(), doc);
      }
      await db.update(meetingCaptureReceipts).set({ undoneAt: new Date().toISOString() }).where(and(eq(meetingCaptureReceipts.workspaceId, normalizeWorkspaceId(principal.workspaceId)), eq(meetingCaptureReceipts.managerAccountId, principal.accountId), eq(meetingCaptureReceipts.requestId, requestId)));
      return { undone: true };
    }));
  }
}
