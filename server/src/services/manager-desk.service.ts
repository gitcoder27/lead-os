import { and, desc, eq, inArray, like, or } from "drizzle-orm";
import type {
  ManagerDeskAssignee,
  ManagerDeskCategory,
  ManagerDeskCarryForwardPreviewItem,
  ManagerDeskCarryForwardContextResponse,
  ManagerDeskCarryForwardPreviewResponse,
  ManagerDeskCarryForwardTimeMode,
  ManagerDeskCarryForwardWarningCode,
  ManagerDeskDayResponse,
  ManagerDeskDelegatedExecution,
  ManagerDeskDeveloperLookupItem,
  ManagerDeskIssueLookupItem,
  ManagerDeskItem,
  ManagerDeskItemKind,
  ManagerDeskLink,
  ManagerDeskLinkType,
  ManagerDeskPriority,
  ManagerDeskStatus,
  ManagerDeskSummary,
  ManagerDeskViewMode,
  TrackerItemState,
  TrackerSharedTaskDetailResponse,
  TrackerWorkItem,
} from "shared/types";
import { db } from "../db/connection";
import {
  developers,
  issues,
  managerDeskDays,
  managerDeskItemHistory,
  managerDeskItems,
  managerDeskLinks,
  teamTrackerItems,
} from "../db/schema";
import { HttpError } from "../middleware/errorHandler";
import { TeamTrackerService } from "./team-tracker.service";
import { DeveloperAvailabilityService } from "./developer-availability.service";
import { runInTransaction } from "../db/transaction";
import { normalizeWorkspaceId } from "./workspace.service";
import { isoDatePart } from "../utils/date";
import { TaskKeysService } from "./task-keys.service";
import { TaskEventsService, type TaskEventActor, type TaskEventInput } from "./task-events.service";

export interface ManagerDeskLinkInput {
  linkType: ManagerDeskLinkType;
  issueKey?: string;
  developerAccountId?: string;
  externalLabel?: string;
}

export interface CreateManagerDeskItemParams {
  date: string;
  title: string;
  kind?: ManagerDeskItemKind;
  category?: ManagerDeskCategory;
  status?: ManagerDeskStatus;
  priority?: ManagerDeskPriority;
  assigneeDeveloperAccountId?: string | null;
  participants?: string | null;
  contextNote?: string | null;
  nextAction?: string | null;
  outcome?: string | null;
  plannedStartAt?: string | null;
  plannedEndAt?: string | null;
  followUpAt?: string | null;
  links?: ManagerDeskLinkInput[];
  actor?: TaskEventActor;
  source?: "desk" | "note" | "today" | "copilot" | "promote";
  taskKey?: string;
}

export interface UpdateManagerDeskItemParams {
  title?: string;
  kind?: ManagerDeskItemKind;
  category?: ManagerDeskCategory;
  status?: ManagerDeskStatus;
  priority?: ManagerDeskPriority;
  assigneeDeveloperAccountId?: string | null;
  participants?: string | null;
  contextNote?: string | null;
  nextAction?: string | null;
  outcome?: string | null;
  plannedStartAt?: string | null;
  plannedEndAt?: string | null;
  followUpAt?: string | null;
}

interface CarryForwardParams {
  fromDate: string;
  toDate: string;
  itemIds?: number[];
}

interface NormalizedManagerDeskLink {
  linkType: ManagerDeskLinkType;
  issueKey?: string;
  developerAccountId?: string;
  externalLabel?: string;
}

interface ManagerDeskCarryForwardPlanEntry {
  item: ManagerDeskItemRow;
  rawLinks: ManagerDeskLinkRow[];
  normalizedLinks: NormalizedManagerDeskLink[];
  trackerNote: string | null;
  rebasedPlannedStartAt: string | null;
  rebasedPlannedEndAt: string | null;
  rebasedFollowUpAt: string | null;
  warningCodes: ManagerDeskCarryForwardWarningCode[];
}

interface ManagerDeskHistoryEntry {
  itemId: number;
  managerAccountId: string;
  eventType: "upsert" | "deleted";
  snapshot: ManagerDeskItem;
  recordedAt: string;
}

interface LegacyCarryForwardCleanupChain {
  managerAccountId: string;
  rootItemId: number;
  keptItemId: number;
  removedItemIds: number[];
  title: string;
  skippedBecauseTrackerLinked: boolean;
}

interface LegacyCarryForwardCleanupResult {
  dryRun: boolean;
  scannedChains: number;
  collapsedChains: number;
  removedItems: number;
  skippedChains: number;
  chains: LegacyCarryForwardCleanupChain[];
}

type ManagerDeskItemRow = typeof managerDeskItems.$inferSelect;
type ManagerDeskLinkRow = typeof managerDeskLinks.$inferSelect;
type ManagerDeskItemHistoryRow = typeof managerDeskItemHistory.$inferSelect;
type TrackerItemRow = typeof teamTrackerItems.$inferSelect;

const MANAGER_DESK_CARRY_FORWARD_TIME_MODE: ManagerDeskCarryForwardTimeMode =
  "rebase_to_target_date";
const SMART_CARRY_FORWARD_LOOKBACK_DAYS = 30;

function nowIso(): string {
  return new Date().toISOString();
}

function localTodayIso(): string {
  const now = new Date();
  const year = String(now.getFullYear()).padStart(4, "0");
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseIsoDate(value: string): { year: number; month: number; day: number } {
  const match = /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})$/.exec(value);
  if (!match?.groups) {
    throw new Error(`Invalid ISO date: ${value}`);
  }

  return {
    year: Number(match.groups.year),
    month: Number(match.groups.month),
    day: Number(match.groups.day),
  };
}

function formatIsoDateUtc(date: Date): string {
  const year = String(date.getUTCFullYear()).padStart(4, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function diffIsoDatesInDays(left: string, right: string): number {
  const leftParts = parseIsoDate(left);
  const rightParts = parseIsoDate(right);
  const leftUtc = Date.UTC(leftParts.year, leftParts.month - 1, leftParts.day);
  const rightUtc = Date.UTC(rightParts.year, rightParts.month - 1, rightParts.day);
  return Math.round((leftUtc - rightUtc) / (24 * 60 * 60 * 1000));
}

function addDaysToIsoDate(value: string, days: number): string {
  const parts = parseIsoDate(value);
  const utcDate = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  utcDate.setUTCDate(utcDate.getUTCDate() + days);
  return formatIsoDateUtc(utcDate);
}

function splitIsoDateTime(value: string): { datePart: string; timePart: string } {
  const match = /^(?<date>\d{4}-\d{2}-\d{2})(?<time>T.*)$/.exec(value);
  if (!match?.groups) {
    throw new Error(`Invalid ISO datetime: ${value}`);
  }

  const datePart = match.groups.date;
  const timePart = match.groups.time;
  if (!datePart || !timePart) {
    throw new Error(`Invalid ISO datetime: ${value}`);
  }

  return {
    datePart,
    timePart,
  };
}

function rebaseTimestampToTargetDate(
  timestamp: string | null | undefined,
  sourceDate: string,
  targetDate: string
): string | null | undefined {
  if (timestamp === undefined) {
    return undefined;
  }
  if (timestamp === null) {
    return null;
  }

  const { datePart, timePart } = splitIsoDateTime(timestamp);
  const dayOffset = diffIsoDatesInDays(datePart, sourceDate);
  return `${addDaysToIsoDate(targetDate, dayOffset)}${timePart}`;
}

function getCarryForwardWarningCodes(params: {
  rebasedPlannedEndAt: string | null;
  rebasedFollowUpAt: string | null;
  now: number;
}): ManagerDeskCarryForwardWarningCode[] {
  const warningCodes: ManagerDeskCarryForwardWarningCode[] = [];

  if (
    params.rebasedFollowUpAt &&
    new Date(params.rebasedFollowUpAt).getTime() < params.now
  ) {
    warningCodes.push("follow_up_overdue_on_arrival");
  }

  if (
    params.rebasedPlannedEndAt &&
    new Date(params.rebasedPlannedEndAt).getTime() < params.now
  ) {
    warningCodes.push("planned_end_overdue_on_arrival");
  }

  return warningCodes;
}

function normalizeRequiredTitle(title: string): string {
  const normalized = title.trim();
  if (!normalized) {
    throw new HttpError(400, "title is required");
  }
  return normalized;
}

function normalizeOptionalText(value: string | null | undefined): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }

  const normalized = value.trim();
  return normalized ? normalized : null;
}

function buildLinkIdentity(link: NormalizedManagerDeskLink): string {
  switch (link.linkType) {
    case "issue":
      return `issue:${link.issueKey}`;
    case "developer":
      return `developer:${link.developerAccountId}`;
    case "external_group":
      return `external_group:${link.externalLabel}`;
  }
}

function isOpenStatus(status: ManagerDeskStatus): boolean {
  return status !== "backlog" && status !== "done" && status !== "cancelled";
}

function endOfIsoDate(date: string): string {
  return new Date(`${date}T23:59:59.999`).toISOString();
}

function getViewMode(date: string): ManagerDeskViewMode {
  const today = localTodayIso();
  if (date < today) {
    return "history";
  }
  if (date > today) {
    return "planning";
  }
  return "live";
}

function getItemSortTimestamp(item: {
  plannedStartAt?: string | null;
  followUpAt?: string | null;
  createdAt: string;
}): number {
  return new Date(item.plannedStartAt ?? item.followUpAt ?? item.createdAt).getTime();
}

function compareItemRows(left: ManagerDeskItemRow, right: ManagerDeskItemRow): number {
  return getItemSortTimestamp(left) - getItemSortTimestamp(right) || left.id - right.id;
}

function compareDeskItems(
  left: Pick<ManagerDeskItem, "plannedStartAt" | "followUpAt" | "createdAt" | "id">,
  right: Pick<ManagerDeskItem, "plannedStartAt" | "followUpAt" | "createdAt" | "id">
): number {
  return (
    getItemSortTimestamp(left) - getItemSortTimestamp(right) ||
    left.id - right.id
  );
}

function compareLineageCandidates(left: ManagerDeskItemRow, right: ManagerDeskItemRow): number {
  const createdDiff =
    new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
  if (createdDiff !== 0) {
    return createdDiff;
  }

  const updatedDiff =
    new Date(left.updatedAt).getTime() - new Date(right.updatedAt).getTime();
  if (updatedDiff !== 0) {
    return updatedDiff;
  }

  return left.id - right.id;
}

function getCarryForwardStatus(status: ManagerDeskStatus): ManagerDeskStatus {
  if (status === "in_progress") {
    return "planned";
  }
  return status;
}

function getLegacyTrackerManagerDeskStatus(state: TrackerItemState): ManagerDeskStatus {
  if (state === "in_progress") {
    return "in_progress";
  }
  return "planned";
}

export class ManagerDeskService {
  constructor(
    private readonly trackerService = new TeamTrackerService(),
    private readonly availability = new DeveloperAvailabilityService()
  ) {}

  private readonly taskKeys = new TaskKeysService();
  private readonly eventsService = new TaskEventsService(this.taskKeys);

  private async emit(item: ManagerDeskItemRow, event: Omit<TaskEventInput, "taskKey" | "workspaceId">, actor: TaskEventActor = { type: "system" }): Promise<void> {
    if (item.taskKey && await this.taskKeys.enabled(item.workspaceId)) await this.eventsService.append({ ...event, taskKey: item.taskKey, workspaceId: item.workspaceId, sourceTable: "manager_desk_items", sourceId: item.id } as TaskEventInput, actor);
  }

  async getDay(managerAccountId: string, date: string, workspaceId?: string): Promise<ManagerDeskDayResponse> {
    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    await this.ensureDay(managerAccountId, date, normalizedWorkspaceId);

    const viewMode = getViewMode(date);
    if (viewMode === "history") {
      return this.buildHistoricalDayView(managerAccountId, date, normalizedWorkspaceId);
    }
    if (viewMode === "planning") {
      return this.buildPlanningDayView(managerAccountId, date, normalizedWorkspaceId);
    }
    return this.buildLiveDayView(managerAccountId, date, normalizedWorkspaceId);
  }

  async getTodayItems(managerAccountId: string, date: string, workspaceId?: string): Promise<ManagerDeskItem[]> {
    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    const days = await db
      .select()
      .from(managerDeskDays)
      .where(
        and(
          eq(managerDeskDays.workspaceId, normalizedWorkspaceId),
          eq(managerDeskDays.managerAccountId, managerAccountId)
        )
      );
    if (days.length === 0) {
      return [];
    }

    const dayById = new Map(days.map((day) => [day.id, day]));
    const itemRows = await db
      .select()
      .from(managerDeskItems)
      .where(
        and(
          eq(managerDeskItems.workspaceId, normalizedWorkspaceId),
          inArray(managerDeskItems.dayId, days.map((day) => day.id))
        )
      );
    const candidateRows = this.dedupeCurrentLineageRows(itemRows).filter((item) => {
      const status = item.status as ManagerDeskStatus;
      if (status === "done" || status === "cancelled") {
        return false;
      }

      const originDate = dayById.get(item.dayId)?.date ?? date;
      const plannedStartDate = isoDatePart(item.plannedStartAt ?? undefined);
      const plannedEndDate = isoDatePart(item.plannedEndAt ?? undefined);
      const isFollowUp = item.category === "follow_up" || Boolean(item.followUpAt);
      const isDueFollowUp = isFollowUp && (!item.followUpAt || isoDatePart(item.followUpAt)! <= date);
      const isMeeting = item.kind === "meeting" && !item.outcome?.trim() && originDate <= date;
      const isCarryForward = status !== "backlog" && !isFollowUp && item.kind !== "meeting" && (
        originDate < date ||
        Boolean(plannedStartDate && plannedStartDate < date) ||
        Boolean(plannedEndDate && plannedEndDate < date)
      );
      return isDueFollowUp || isMeeting || isCarryForward;
    });
    const linksByItemId = await this.getLinksByItemIds(
      candidateRows.map((item) => item.id),
      normalizedWorkspaceId
    );

    return candidateRows
      .sort(compareItemRows)
      .map((item) =>
        this.mapItem(
          item,
          linksByItemId.get(item.id) ?? [],
          undefined,
          undefined,
          dayById.get(item.dayId)?.date ?? date
        )
      );
  }

  async createItem(
    managerAccountId: string,
    params: CreateManagerDeskItemParams,
    workspaceId?: string
  ): Promise<ManagerDeskItem> {
    return runInTransaction(async () => {
    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    const day = await this.ensureDay(managerAccountId, params.date, normalizedWorkspaceId);
    const title = normalizeRequiredTitle(params.title);
    const plannedStartAt = params.plannedStartAt ?? null;
    const plannedEndAt = params.plannedEndAt ?? null;
    const followUpAt = params.followUpAt ?? null;

    this.assertTimeRange(plannedStartAt, plannedEndAt);

    const normalizedLinks = await this.normalizeLinkInputs(params.links ?? [], normalizedWorkspaceId);
    this.assertNoDuplicateLinks(normalizedLinks);
    const assigneeDeveloperAccountId = await this.normalizeAssigneeAccountId(
      params.assigneeDeveloperAccountId,
      normalizedWorkspaceId
    );

    const now = nowIso();
    const taskKey = await this.taskKeys.enabled(normalizedWorkspaceId) ? params.taskKey ?? this.taskKeys.allocate(normalizedWorkspaceId) : null;
    const inserted = await db
      .insert(managerDeskItems)
      .values({
        workspaceId: normalizedWorkspaceId,
        dayId: day.id,
        sourceItemId: null,
        taskKey,
        createdByType: params.source === "note" || params.source === "today" ? params.source : params.actor?.type ?? "unknown",
        createdById: params.actor?.accountId ?? null,
        title,
        kind: params.kind ?? "action",
        category: params.category ?? "other",
        status: params.status ?? "inbox",
        priority: params.priority ?? "medium",
        assigneeDeveloperAccountId,
        participants: normalizeOptionalText(params.participants) ?? null,
        contextNote: normalizeOptionalText(params.contextNote) ?? null,
        nextAction: normalizeOptionalText(params.nextAction) ?? null,
        outcome: normalizeOptionalText(params.outcome) ?? null,
        plannedStartAt,
        plannedEndAt,
        followUpAt,
        completedAt:
          (params.status ?? "inbox") === "done" || (params.status ?? "inbox") === "cancelled"
            ? now
            : null,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    const item = inserted[0];
    if (!item) {
      throw new Error("Failed to create manager desk item");
    }

    await this.emit(item, { type: "created", body: null, meta: { source: params.source ?? "desk", ownerType: assigneeDeveloperAccountId ? "developer" : "manager", ownerId: assigneeDeveloperAccountId ?? managerAccountId, title } }, { type: "system", accountId: params.actor?.accountId ?? managerAccountId });
    if (item.contextNote) await this.emit(item, { type: "update", body: item.contextNote, meta: { via: "context_note_field" } }, params.actor ?? { type: "manager", accountId: managerAccountId });
    for (const link of normalizedLinks) {
      await db.insert(managerDeskLinks).values({
        workspaceId: normalizedWorkspaceId,
        itemId: item.id,
        linkType: link.linkType,
        issueKey: link.issueKey ?? null,
        developerAccountId: link.developerAccountId ?? null,
        externalLabel: link.externalLabel ?? null,
        createdAt: now,
      });
    }

    await this.syncTrackerAssignment(
      item.id,
      assigneeDeveloperAccountId,
      params.date,
      title,
      normalizedLinks,
      item.status as ManagerDeskStatus
      ,
      undefined,
      normalizedWorkspaceId
    );
    await this.recordHistorySnapshotForItem(managerAccountId, item.id, "upsert", normalizedWorkspaceId);
    return this.getItemById(managerAccountId, item.id, normalizedWorkspaceId);
    });
  }

  async updateItem(
    managerAccountId: string,
    itemId: number,
    updates: UpdateManagerDeskItemParams,
    workspaceId?: string,
    actor: TaskEventActor = { type: "manager", accountId: managerAccountId }
  ): Promise<ManagerDeskItem> {
    return runInTransaction(async () => {
    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    const existing = await this.getOwnedItemRow(managerAccountId, itemId, normalizedWorkspaceId);
    const linkedTrackerContext =
      await this.trackerService.getItemDetailContextForManagerDeskItem(itemId, normalizedWorkspaceId);

    if (linkedTrackerContext && updates.status === "backlog") {
      throw new HttpError(
        409,
        "Linked delegated tasks must be removed from your desk or cancelled before moving to Later"
      );
    }
    if (linkedTrackerContext && updates.status === "cancelled") {
      throw new HttpError(
        409,
        "Linked delegated tasks must be cancelled with the dedicated cancel action"
      );
    }

    const nextPlannedStartAt =
      updates.plannedStartAt !== undefined ? updates.plannedStartAt : existing.plannedStartAt;
    const nextPlannedEndAt =
      updates.plannedEndAt !== undefined ? updates.plannedEndAt : existing.plannedEndAt;
    this.assertTimeRange(nextPlannedStartAt, nextPlannedEndAt);

    const now = nowIso();
    const setFields: Partial<typeof managerDeskItems.$inferInsert> = {
      updatedAt: now,
    };

    if (updates.title !== undefined) {
      setFields.title = normalizeRequiredTitle(updates.title);
    }
    if (updates.kind !== undefined) {
      setFields.kind = updates.kind;
    }
    if (updates.category !== undefined) {
      setFields.category = updates.category;
    }
    if (updates.priority !== undefined) {
      setFields.priority = updates.priority;
    }
    if (updates.assigneeDeveloperAccountId !== undefined) {
      setFields.assigneeDeveloperAccountId = await this.normalizeAssigneeAccountId(
        updates.assigneeDeveloperAccountId,
        normalizedWorkspaceId
      );
    }
    if (updates.participants !== undefined) {
      setFields.participants = normalizeOptionalText(updates.participants) ?? null;
    }
    if (updates.contextNote !== undefined) {
      setFields.contextNote = normalizeOptionalText(updates.contextNote) ?? null;
    }
    if (updates.nextAction !== undefined) {
      setFields.nextAction = normalizeOptionalText(updates.nextAction) ?? null;
    }
    if (updates.outcome !== undefined) {
      setFields.outcome = normalizeOptionalText(updates.outcome) ?? null;
    }
    if (updates.plannedStartAt !== undefined) {
      setFields.plannedStartAt = updates.plannedStartAt ?? null;
    }
    if (updates.plannedEndAt !== undefined) {
      setFields.plannedEndAt = updates.plannedEndAt ?? null;
    }
    if (updates.followUpAt !== undefined) {
      setFields.followUpAt = updates.followUpAt ?? null;
    }
    if (updates.status !== undefined) {
      setFields.status = updates.status;
      if (updates.status === "done" || updates.status === "cancelled") {
        setFields.completedAt = existing.completedAt ?? now;
      } else if (existing.status === "done" || existing.status === "cancelled") {
        setFields.completedAt = null;
      }
    }

    await db
      .update(managerDeskItems)
      .set(setFields)
      .where(eq(managerDeskItems.id, itemId));

    const updatedItem = await this.getOwnedItemRow(managerAccountId, itemId, normalizedWorkspaceId);
    const updatedLinks = await this.getNormalizedLinksByItemId(itemId, normalizedWorkspaceId);
    const day = await this.getDayById(updatedItem.dayId, normalizedWorkspaceId);
    if (!day) {
      throw new Error(`Manager desk day ${updatedItem.dayId} was not found`);
    }

    // Fallback note used only if the linked tracker row is missing and must be
    // recreated; existing rows keep their own note through moves.
    const trackerNote = linkedTrackerContext?.trackerItem.note ?? null;
    const reopened =
      !isOpenStatus(existing.status as ManagerDeskStatus) &&
      isOpenStatus(updatedItem.status as ManagerDeskStatus);

    await this.syncTrackerAssignment(
      itemId,
      updatedItem.assigneeDeveloperAccountId,
      day.date,
      updatedItem.title,
      updatedLinks,
      updatedItem.status as ManagerDeskStatus,
      trackerNote,
      normalizedWorkspaceId,
      reopened
    );
    await this.recordHistorySnapshotForItem(managerAccountId, itemId, "upsert", normalizedWorkspaceId);
    const system = { type: "system" as const, accountId: managerAccountId };
    if (existing.title !== updatedItem.title) await this.emit(existing, { type: "title", body: null, meta: { from: existing.title, to: updatedItem.title } }, system);
    if (existing.status !== updatedItem.status) await this.emit(existing, { type: "status", body: null, meta: { domain: "desk_status", from: existing.status, to: updatedItem.status, reason: "user" } }, system);
    if (existing.assigneeDeveloperAccountId !== updatedItem.assigneeDeveloperAccountId) await this.emit(existing, { type: "assign", body: null, meta: { fromType: existing.assigneeDeveloperAccountId ? "developer" : "manager", fromId: existing.assigneeDeveloperAccountId ?? managerAccountId, toType: updatedItem.assigneeDeveloperAccountId ? "developer" : "manager", toId: updatedItem.assigneeDeveloperAccountId ?? managerAccountId } }, system);
    for (const field of ["plannedStartAt", "plannedEndAt", "followUpAt"] as const) {
      if (existing[field] !== updatedItem[field]) await this.emit(existing, { type: "schedule", body: null, meta: { field: field === "plannedStartAt" ? "planned_start_at" : field === "plannedEndAt" ? "planned_end_at" : "follow_up_at", from: existing[field], to: updatedItem[field], via: "edit" } }, system);
    }
    if (updatedItem.contextNote && existing.contextNote !== updatedItem.contextNote) await this.emit(existing, { type: "update", body: updatedItem.contextNote, meta: { via: "context_note_field" } }, actor);
    if (updatedItem.outcome && existing.outcome !== updatedItem.outcome) await this.emit(existing, { type: "decision", body: updatedItem.outcome, meta: null }, actor);
    return this.getItemById(managerAccountId, itemId, normalizedWorkspaceId);
    });
  }

  async deleteItem(managerAccountId: string, itemId: number, workspaceId?: string): Promise<void> {
    return runInTransaction(async () => {
    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    const existing = await this.getOwnedItemRow(managerAccountId, itemId, normalizedWorkspaceId);
    const snapshot = await this.getItemById(managerAccountId, itemId, normalizedWorkspaceId);
    await this.insertHistoryRow(managerAccountId, existing.id, snapshot, "deleted", normalizedWorkspaceId);
    await this.trackerService.unlinkManagerDeskItem(itemId, normalizedWorkspaceId);
    await this.emit(existing, { type: "status", body: null, meta: { domain: "desk_status", from: existing.status, to: "deleted", reason: "user" } }, { type: "system", accountId: managerAccountId });
    await db.delete(managerDeskLinks).where(eq(managerDeskLinks.itemId, itemId));
    await db.delete(managerDeskItems).where(eq(managerDeskItems.id, itemId));
    });
  }

  async cancelDelegatedTask(
    managerAccountId: string,
    itemId: number,
    workspaceId?: string
  ): Promise<ManagerDeskItem> {
    return runInTransaction(async () => {
    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    const existing = await this.getOwnedItemRow(managerAccountId, itemId, normalizedWorkspaceId);
    const cancelled = await this.trackerService.cancelManagerDeskItem(itemId, normalizedWorkspaceId);

    if (!cancelled) {
      throw new HttpError(409, "Task has no linked delegated work to cancel");
    }

    const now = nowIso();
    await db
      .update(managerDeskItems)
      .set({
        status: "cancelled",
        completedAt: existing.completedAt ?? now,
        updatedAt: now,
      })
      .where(eq(managerDeskItems.id, itemId));

    await this.recordHistorySnapshotForItem(managerAccountId, itemId, "upsert", normalizedWorkspaceId);
    await this.emit(existing, { type: "status", body: null, meta: { domain: "desk_status", from: existing.status, to: "cancelled", reason: "user" } }, { type: "system", accountId: managerAccountId });
    return this.getItemById(managerAccountId, itemId, normalizedWorkspaceId);
    });
  }

  async addLink(
    managerAccountId: string,
    itemId: number,
    payload: ManagerDeskLinkInput,
    workspaceId?: string
  ): Promise<ManagerDeskLink> {
    return runInTransaction(async () => {
    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    await this.getOwnedItemRow(managerAccountId, itemId, normalizedWorkspaceId);
    const normalizedLink = await this.normalizeLinkInput(payload, normalizedWorkspaceId);
    await this.assertItemDoesNotAlreadyHaveLink(itemId, normalizedLink, normalizedWorkspaceId);

    const now = nowIso();
    const inserted = await db
      .insert(managerDeskLinks)
      .values({
        workspaceId: normalizedWorkspaceId,
        itemId,
        linkType: normalizedLink.linkType,
        issueKey: normalizedLink.issueKey ?? null,
        developerAccountId: normalizedLink.developerAccountId ?? null,
        externalLabel: normalizedLink.externalLabel ?? null,
        createdAt: now,
      })
      .returning();

    const insertedLink = inserted[0];
    if (!insertedLink) {
      throw new Error("Failed to create manager desk link");
    }

    const linksByItemId = await this.getLinksByItemIds([itemId], normalizedWorkspaceId);
    const createdLink = (linksByItemId.get(itemId) ?? []).find(
      (link) => link.id === insertedLink.id
    );
    if (!createdLink) {
      throw new Error("Failed to load manager desk link after insert");
    }

    const item = await this.getOwnedItemRow(managerAccountId, itemId, normalizedWorkspaceId);
    const day = await this.getDayById(item.dayId, normalizedWorkspaceId);
    if (day) {
      await this.syncTrackerAssignment(
        itemId,
        item.assigneeDeveloperAccountId,
        day.date,
        item.title,
        await this.getNormalizedLinksByItemId(itemId, normalizedWorkspaceId),
        item.status as ManagerDeskStatus,
        undefined,
        normalizedWorkspaceId
      );
    }

    await this.recordHistorySnapshotForItem(managerAccountId, itemId, "upsert", normalizedWorkspaceId);
    await this.emit(item, { type: "link", body: null, meta: { action: "added", kind: normalizedLink.linkType === "issue" ? "jira" : normalizedLink.linkType === "developer" ? "person" : "external", ref: normalizedLink.issueKey ?? normalizedLink.developerAccountId ?? normalizedLink.externalLabel ?? "" } }, { type: "system", accountId: managerAccountId });
    return createdLink;
    });
  }

  async deleteLink(
    managerAccountId: string,
    itemId: number,
    linkId: number,
    workspaceId?: string
  ): Promise<void> {
    return runInTransaction(async () => {
    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    await this.getOwnedItemRow(managerAccountId, itemId, normalizedWorkspaceId);
    const rows = await db
      .select()
      .from(managerDeskLinks)
      .where(and(eq(managerDeskLinks.workspaceId, normalizedWorkspaceId), eq(managerDeskLinks.id, linkId), eq(managerDeskLinks.itemId, itemId)))
      .limit(1);

    if (!rows[0]) {
      throw new HttpError(404, "Link not found");
    }

    await db.delete(managerDeskLinks).where(eq(managerDeskLinks.id, linkId));

    const item = await this.getOwnedItemRow(managerAccountId, itemId, normalizedWorkspaceId);
    const day = await this.getDayById(item.dayId, normalizedWorkspaceId);
    if (day) {
      await this.syncTrackerAssignment(
        itemId,
        item.assigneeDeveloperAccountId,
        day.date,
        item.title,
        await this.getNormalizedLinksByItemId(itemId, normalizedWorkspaceId),
        item.status as ManagerDeskStatus,
        undefined,
        normalizedWorkspaceId
      );
    }

    await this.recordHistorySnapshotForItem(managerAccountId, itemId, "upsert", normalizedWorkspaceId);
    const removed = rows[0];
    await this.emit(item, { type: "link", body: null, meta: { action: "removed", kind: removed.linkType === "issue" ? "jira" : removed.linkType === "developer" ? "person" : "external", ref: removed.issueKey ?? removed.developerAccountId ?? removed.externalLabel ?? "" } }, { type: "system", accountId: managerAccountId });
    });
  }

  async previewCarryForward(
    managerAccountId: string,
    fromDate: string,
    toDate: string,
    workspaceId?: string
  ): Promise<ManagerDeskCarryForwardPreviewResponse> {
    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    this.assertCarryForwardDateOrder(fromDate, toDate);

    const plan = await this.buildCarryForwardPlan(managerAccountId, {
      fromDate,
      toDate,
    }, normalizedWorkspaceId);

    if (plan.length === 0) {
      return {
        fromDate,
        toDate,
        carryable: 0,
        overdueOnArrivalCount: 0,
        timeMode: MANAGER_DESK_CARRY_FORWARD_TIME_MODE,
        items: [],
      };
    }

    const items = await this.buildCarryForwardPreviewItems(plan, toDate, normalizedWorkspaceId);
    return {
      fromDate,
      toDate,
      carryable: items.length,
      overdueOnArrivalCount: items.filter((item) => item.warningCodes.length > 0).length,
      timeMode: MANAGER_DESK_CARRY_FORWARD_TIME_MODE,
      items,
    };
  }

  async getCarryForwardContext(
    managerAccountId: string,
    toDate: string,
    lookbackDays = SMART_CARRY_FORWARD_LOOKBACK_DAYS,
    workspaceId?: string
  ): Promise<ManagerDeskCarryForwardContextResponse> {
    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    const fromDate = await this.resolveLatestCarryForwardSourceDate(
      managerAccountId,
      toDate,
      lookbackDays,
      normalizedWorkspaceId
    );

    if (!fromDate) {
      return {
        fromDate: undefined,
        toDate,
        carryable: 0,
        overdueOnArrivalCount: 0,
        timeMode: MANAGER_DESK_CARRY_FORWARD_TIME_MODE,
        items: [],
      };
    }

    const preview = await this.previewCarryForward(managerAccountId, fromDate, toDate, normalizedWorkspaceId);
    return {
      fromDate,
      toDate,
      carryable: preview.carryable,
      overdueOnArrivalCount: preview.overdueOnArrivalCount,
      timeMode: preview.timeMode,
      items: preview.items,
    };
  }

  async carryForward(
    managerAccountId: string,
    params: CarryForwardParams,
    workspaceId?: string
  ): Promise<number> {
    return runInTransaction(async () => {
    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    this.assertCarryForwardDateOrder(params.fromDate, params.toDate);

    const plan = await this.buildCarryForwardPlan(managerAccountId, params, normalizedWorkspaceId);
    if (plan.length === 0) {
      return 0;
    }

    const targetDay = await this.ensureDay(managerAccountId, params.toDate, normalizedWorkspaceId);
    let updated = 0;
    const now = nowIso();

    for (const entry of plan) {
      await db
        .update(managerDeskItems)
        .set({
          dayId: targetDay.id,
          plannedStartAt: entry.rebasedPlannedStartAt,
          plannedEndAt: entry.rebasedPlannedEndAt,
          followUpAt: entry.rebasedFollowUpAt,
          updatedAt: now,
        })
        .where(eq(managerDeskItems.id, entry.item.id));

      await this.syncTrackerAssignment(
        entry.item.id,
        entry.item.assigneeDeveloperAccountId,
        params.toDate,
        entry.item.title,
        entry.normalizedLinks,
        entry.item.status as ManagerDeskStatus,
        entry.trackerNote,
        normalizedWorkspaceId
      );

      await this.recordHistorySnapshotForItem(managerAccountId, entry.item.id, "upsert", normalizedWorkspaceId);
      await this.emit(entry.item, { type: "schedule", body: null, meta: { field: "day", from: params.fromDate, to: params.toDate, via: "carry_forward" } }, { type: "system", accountId: managerAccountId });
      for (const [field, from, to] of [["planned_start_at", entry.item.plannedStartAt, entry.rebasedPlannedStartAt], ["planned_end_at", entry.item.plannedEndAt, entry.rebasedPlannedEndAt], ["follow_up_at", entry.item.followUpAt, entry.rebasedFollowUpAt]] as const) {
        if (from !== to) await this.emit(entry.item, { type: "schedule", body: null, meta: { field, from, to, via: "carry_forward" } }, { type: "system", accountId: managerAccountId });
      }

      updated += 1;
    }

    return updated;
    });
  }

  async moveLinkedItemsToDate(
    managerAccountId: string,
    params: CarryForwardParams,
    workspaceId?: string
  ): Promise<number> {
    return runInTransaction(async () => {
    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    this.assertCarryForwardDateOrder(params.fromDate, params.toDate);

    const uniqueIds = [...new Set(params.itemIds ?? [])];
    if (uniqueIds.length === 0) {
      return 0;
    }

    const targetDay = await this.ensureDay(managerAccountId, params.toDate, normalizedWorkspaceId);
    const trackerNotesByItemId = await this.getTrackerNotesByManagerDeskItemIds(uniqueIds, normalizedWorkspaceId);
    const now = nowIso();
    let moved = 0;
    for (const itemId of uniqueIds) {
      const item = await this.getOwnedItemRow(managerAccountId, itemId, normalizedWorkspaceId);
      if (!isOpenStatus(item.status as ManagerDeskStatus)) {
        continue;
      }

      const sourceDay = await this.getDayById(item.dayId, normalizedWorkspaceId);
      const sourceDate = sourceDay?.date ?? params.fromDate;
      const rebasedPlannedStartAt =
        rebaseTimestampToTargetDate(item.plannedStartAt, sourceDate, params.toDate) ?? null;
      const rebasedPlannedEndAt =
        rebaseTimestampToTargetDate(item.plannedEndAt, sourceDate, params.toDate) ?? null;
      const rebasedFollowUpAt =
        rebaseTimestampToTargetDate(item.followUpAt, sourceDate, params.toDate) ?? null;
      this.assertTimeRange(rebasedPlannedStartAt, rebasedPlannedEndAt);

      await db
        .update(managerDeskItems)
        .set({
          dayId: targetDay.id,
          plannedStartAt: rebasedPlannedStartAt,
          plannedEndAt: rebasedPlannedEndAt,
          followUpAt: rebasedFollowUpAt,
          updatedAt: now,
        })
        .where(eq(managerDeskItems.id, itemId));

      const links = await this.getNormalizedLinksByItemId(itemId, normalizedWorkspaceId);
      await this.syncTrackerAssignment(
        itemId,
        item.assigneeDeveloperAccountId,
        params.toDate,
        item.title,
        links,
        item.status as ManagerDeskStatus,
        trackerNotesByItemId.get(itemId) ?? null,
        normalizedWorkspaceId
      );
      await this.recordHistorySnapshotForItem(managerAccountId, itemId, "upsert", normalizedWorkspaceId);
      await this.emit(item, { type: "schedule", body: null, meta: { field: "day", from: sourceDate, to: params.toDate, via: "reschedule" } }, { type: "system", accountId: managerAccountId });
      for (const [field, from, to] of [["planned_start_at", item.plannedStartAt, rebasedPlannedStartAt], ["planned_end_at", item.plannedEndAt, rebasedPlannedEndAt], ["follow_up_at", item.followUpAt, rebasedFollowUpAt]] as const) {
        if (from !== to) await this.emit(item, { type: "schedule", body: null, meta: { field, from, to, via: "reschedule" } }, { type: "system", accountId: managerAccountId });
      }
      moved += 1;
    }

    return moved;
    });
  }

  async cleanupLegacyCarryForwardChains(options?: {
    dryRun?: boolean;
    managerAccountId?: string;
  }): Promise<LegacyCarryForwardCleanupResult> {
    const dryRun = options?.dryRun ?? true;
    const allDays = await db.select().from(managerDeskDays);
    const scopedDays = options?.managerAccountId
      ? allDays.filter((day) => day.managerAccountId === options.managerAccountId)
      : allDays;

    if (scopedDays.length === 0) {
      return {
        dryRun,
        scannedChains: 0,
        collapsedChains: 0,
        removedItems: 0,
        skippedChains: 0,
        chains: [],
      };
    }

    const dayById = new Map(scopedDays.map((day) => [day.id, day]));
    const itemRows = await db
      .select()
      .from(managerDeskItems)
      .where(inArray(managerDeskItems.dayId, scopedDays.map((day) => day.id)));

    const groupedByManager = new Map<string, ManagerDeskItemRow[]>();
    for (const row of itemRows) {
      const managerAccountId = dayById.get(row.dayId)?.managerAccountId;
      if (!managerAccountId) {
        continue;
      }

      const bucket = groupedByManager.get(managerAccountId);
      if (bucket) {
        bucket.push(row);
      } else {
        groupedByManager.set(managerAccountId, [row]);
      }
    }

    const result: LegacyCarryForwardCleanupResult = {
      dryRun,
      scannedChains: 0,
      collapsedChains: 0,
      removedItems: 0,
      skippedChains: 0,
      chains: [],
    };

    for (const [managerAccountId, managerRows] of groupedByManager.entries()) {
      for (const [rootItemId, lineageRows] of this.groupRowsByLineage(managerRows).entries()) {
        if (lineageRows.length <= 1) {
          continue;
        }

        result.scannedChains += 1;
        const keptRow = this.selectCanonicalLineageRow(lineageRows);
        const removedRows = lineageRows
          .filter((row) => row.id !== keptRow.id)
          .sort(compareLineageCandidates);
        const removedItemIds = removedRows.map((row) => row.id);

        if (removedItemIds.length === 0) {
          continue;
        }

        const linkedTrackerRows = await db
          .select({
            id: teamTrackerItems.id,
          })
          .from(teamTrackerItems)
          .where(inArray(teamTrackerItems.managerDeskItemId, removedItemIds));
        const skippedBecauseTrackerLinked = linkedTrackerRows.length > 0;

        result.chains.push({
          managerAccountId,
          rootItemId,
          keptItemId: keptRow.id,
          removedItemIds,
          title: keptRow.title,
          skippedBecauseTrackerLinked,
        });

        if (skippedBecauseTrackerLinked) {
          result.skippedChains += 1;
          continue;
        }

        if (!dryRun) {
          if (keptRow.sourceItemId !== null) {
            await db
              .update(managerDeskItems)
              .set({
                sourceItemId: null,
                updatedAt: nowIso(),
              })
              .where(eq(managerDeskItems.id, keptRow.id));
            await this.recordHistorySnapshotForItem(managerAccountId, keptRow.id);
          }

          for (const removedRow of removedRows) {
            const snapshot = await this.getItemById(managerAccountId, removedRow.id);
            await this.insertHistoryRow(managerAccountId, removedRow.id, snapshot, "deleted");
          }

          await db
            .delete(managerDeskLinks)
            .where(inArray(managerDeskLinks.itemId, removedItemIds));
          await db
            .delete(managerDeskItems)
            .where(inArray(managerDeskItems.id, removedItemIds));
        }

        result.collapsedChains += 1;
        result.removedItems += removedItemIds.length;
      }
    }

    return result;
  }

  async lookupIssues(query: string, workspaceId?: string): Promise<ManagerDeskIssueLookupItem[]> {
    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    const normalizedQuery = query.trim();
    if (!normalizedQuery) {
      return [];
    }

    const pattern = `%${normalizedQuery}%`;
    const rows = await db
      .select({
        jiraKey: issues.jiraKey,
        summary: issues.summary,
        priorityName: issues.priorityName,
        statusName: issues.statusName,
        assigneeName: issues.assigneeName,
      })
      .from(issues)
      .where(and(eq(issues.workspaceId, normalizedWorkspaceId), or(like(issues.jiraKey, pattern), like(issues.summary, pattern))))
      .orderBy(desc(issues.updatedAt))
      .limit(20);

    return rows.map((row) => ({
      jiraKey: row.jiraKey,
      summary: row.summary,
      priorityName: row.priorityName,
      statusName: row.statusName,
      assigneeName: row.assigneeName ?? undefined,
    }));
  }

  async lookupDevelopers(
    query: string,
    date?: string,
    options?: { includeUnavailable?: boolean },
    workspaceId?: string
  ): Promise<ManagerDeskDeveloperLookupItem[]> {
    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    const normalizedQuery = query.trim();
    const pattern = `%${normalizedQuery}%`;
    const rows = await db
      .select({
        accountId: developers.accountId,
        displayName: developers.displayName,
        email: developers.email,
        avatarUrl: developers.avatarUrl,
      })
      .from(developers)
      .where(
        normalizedQuery
          ? and(
              eq(developers.workspaceId, normalizedWorkspaceId),
              eq(developers.isActive, 1),
              or(
                like(developers.accountId, pattern),
                like(developers.displayName, pattern),
                like(developers.email, pattern)
              )
            )
          : and(eq(developers.workspaceId, normalizedWorkspaceId), eq(developers.isActive, 1))
      )
      .limit(normalizedQuery ? 20 : 200);

    const availabilityByAccountId = date
      ? await this.availability.getAvailabilityMapForDate(
          rows.map((row) => row.accountId),
          date,
          normalizedWorkspaceId
        )
      : new Map();

    return rows
      .map((row) => ({
        accountId: row.accountId,
        displayName: row.displayName,
        email: row.email ?? undefined,
        avatarUrl: row.avatarUrl ?? undefined,
        availability: availabilityByAccountId.get(row.accountId),
      }))
      .filter((item) => options?.includeUnavailable || item.availability?.state !== "inactive")
      .sort((left, right) => {
        const leftInactive = left.availability?.state === "inactive" ? 1 : 0;
        const rightInactive = right.availability?.state === "inactive" ? 1 : 0;
        return leftInactive - rightInactive || left.displayName.localeCompare(right.displayName);
      });
  }

  async getTrackerTaskDetail(
    managerAccountId: string,
    trackerItemId: number,
    workspaceId?: string
  ): Promise<TrackerSharedTaskDetailResponse> {
    const trackerContext = await this.trackerService.getItemDetailContext(trackerItemId, workspaceId);
    return this.buildTrackerTaskDetailResponse(managerAccountId, trackerContext, workspaceId);
  }

  async promoteTrackerTask(
    managerAccountId: string,
    trackerItemId: number,
    workspaceId?: string
  ): Promise<TrackerSharedTaskDetailResponse> {
    return runInTransaction(async () => {
    const trackerContext = await this.trackerService.getItemDetailContext(trackerItemId, workspaceId);

    if (!trackerContext.trackerItem.managerDeskItemId) {
      await this.createManagerDeskItemFromTrackerItem(managerAccountId, trackerContext, workspaceId);
    }

    const linkedTrackerContext = await this.trackerService.getItemDetailContext(trackerItemId, workspaceId);
    return this.buildTrackerTaskDetailResponse(managerAccountId, linkedTrackerContext, workspaceId);
    });
  }

  async getTaskDetailByItemId(
    managerAccountId: string,
    itemId: number,
    workspaceId?: string
  ): Promise<TrackerSharedTaskDetailResponse> {
    const managerDeskItem = await this.getItemById(managerAccountId, itemId, workspaceId);
    const trackerContext =
      await this.trackerService.getItemDetailContextForManagerDeskItem(itemId, workspaceId);

    if (!trackerContext) {
      throw new HttpError(404, "Task is no longer assigned in Team Tracker");
    }

    return {
      date: trackerContext.date,
      developer: trackerContext.developer,
      lifecycle: "manager_desk_linked",
      managerDeskItem,
      trackerItem: trackerContext.trackerItem,
    };
  }

  /** Full detail for any desk item — links, assignee, and delegated tracker task when present. */
  async getItemDetail(
    managerAccountId: string,
    itemId: number,
    workspaceId?: string
  ): Promise<{ item: ManagerDeskItem; trackerItem?: TrackerWorkItem }> {
    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    const item = await this.getItemById(managerAccountId, itemId, normalizedWorkspaceId);
    const trackerContext = await this.trackerService.getItemDetailContextForManagerDeskItem(
      itemId,
      normalizedWorkspaceId
    );
    return { item, trackerItem: trackerContext?.trackerItem };
  }

  async ensureDay(
    managerAccountId: string,
    date: string,
    workspaceId?: string
  ): Promise<typeof managerDeskDays.$inferSelect> {
    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    const now = nowIso();
    await db
      .insert(managerDeskDays)
      .values({
        workspaceId: normalizedWorkspaceId,
        date,
        managerAccountId,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing({
        target: [managerDeskDays.workspaceId, managerDeskDays.date, managerDeskDays.managerAccountId],
      });

    const day = await this.findDay(managerAccountId, date, normalizedWorkspaceId);
    if (!day) {
      throw new Error(`Failed to initialize manager desk day for ${managerAccountId} on ${date}`);
    }

    return day;
  }

  private async buildLiveDayView(
    managerAccountId: string,
    date: string,
    workspaceId?: string
  ): Promise<ManagerDeskDayResponse> {
    const items = await this.getCurrentItemsForManager(managerAccountId, date, workspaceId);
    const visible = items.filter((item) => {
      if (item.status === "backlog") {
        return true;
      }
      if (isOpenStatus(item.status)) {
        // Open work stays on the desk until done or dropped — but an item
        // carried to a future day is scheduled, not today's work.
        return item.originDate <= date;
      }
      return isoDatePart(item.completedAt) === date;
    });

    return {
      date,
      viewMode: "live",
      items: visible,
      summary: this.buildSummary(visible),
    };
  }

  private async buildPlanningDayView(
    managerAccountId: string,
    date: string,
    workspaceId?: string
  ): Promise<ManagerDeskDayResponse> {
    const items = await this.getCurrentItemsForManager(managerAccountId, date, workspaceId);
    const visible = items.filter((item) => this.isRelevantToPlanningDate(item, date));

    return {
      date,
      viewMode: "planning",
      items: visible,
      summary: this.buildSummary(visible),
    };
  }

  private async buildHistoricalDayView(
    managerAccountId: string,
    date: string,
    workspaceId?: string
  ): Promise<ManagerDeskDayResponse> {
    const history = await this.getHistoricalItemsForDate(managerAccountId, date, workspaceId);
    const createdThatDayItems = history.filter((item) => isoDatePart(item.createdAt) === date);

    return {
      date,
      viewMode: "history",
      items: history,
      summary: this.buildSummary(history),
      createdThatDayItems,
    };
  }

  private async getCurrentItemsForManager(
    managerAccountId: string,
    date: string,
    workspaceId?: string
  ): Promise<ManagerDeskItem[]> {
    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    const days = await db
      .select()
      .from(managerDeskDays)
      .where(and(eq(managerDeskDays.workspaceId, normalizedWorkspaceId), eq(managerDeskDays.managerAccountId, managerAccountId)));

    if (days.length === 0) {
      return [];
    }

    const dayById = new Map(days.map((day) => [day.id, day]));
    const itemRows = await db
      .select()
      .from(managerDeskItems)
      .where(inArray(managerDeskItems.dayId, days.map((day) => day.id)));

    const dedupedRows = this.dedupeCurrentLineageRows(itemRows);
    const linksByItemId = await this.getLinksByItemIds(dedupedRows.map((item) => item.id), normalizedWorkspaceId);
    const delegatedExecutionByItemId = await this.getDelegatedExecutionByManagerDeskItemIds(
      dedupedRows.map((item) => item.id),
      normalizedWorkspaceId
    );
    const assigneesByAccountId = await this.getAssigneeMap(dedupedRows, date, normalizedWorkspaceId);

    return dedupedRows
      .sort(compareItemRows)
      .map((item) =>
        this.mapItem(
          item,
          linksByItemId.get(item.id) ?? [],
          delegatedExecutionByItemId.get(item.id),
          item.assigneeDeveloperAccountId
            ? assigneesByAccountId.get(item.assigneeDeveloperAccountId) ?? undefined
            : undefined,
          dayById.get(item.dayId)?.date ?? date
        )
      );
  }

  private dedupeCurrentLineageRows(itemRows: ManagerDeskItemRow[]): ManagerDeskItemRow[] {
    const grouped = this.groupRowsByLineage(itemRows);
    return [...grouped.values()]
      .map((lineageRows) => this.selectCanonicalLineageRow(lineageRows))
      .sort(compareItemRows);
  }

  private groupRowsByLineage(itemRows: ManagerDeskItemRow[]): Map<number, ManagerDeskItemRow[]> {
    const itemById = new Map(itemRows.map((row) => [row.id, row]));
    const grouped = new Map<number, ManagerDeskItemRow[]>();

    for (const row of itemRows) {
      const rootId = this.resolveLineageRootId(row, itemById);
      const bucket = grouped.get(rootId);
      if (bucket) {
        bucket.push(row);
      } else {
        grouped.set(rootId, [row]);
      }
    }

    return grouped;
  }

  private resolveLineageRootId(
    row: ManagerDeskItemRow,
    itemById: Map<number, ManagerDeskItemRow>
  ): number {
    let current = row;
    const visited = new Set<number>([row.id]);

    while (typeof current.sourceItemId === "number") {
      const parent = itemById.get(current.sourceItemId);
      if (!parent || visited.has(parent.id)) {
        break;
      }
      visited.add(parent.id);
      current = parent;
    }

    return current.id;
  }

  private selectCanonicalLineageRow(lineageRows: ManagerDeskItemRow[]): ManagerDeskItemRow {
    return lineageRows.reduce((best, candidate) => {
      return compareLineageCandidates(best, candidate) >= 0 ? best : candidate;
    });
  }

  private async getHistoricalItemsForDate(
    managerAccountId: string,
    date: string,
    workspaceId?: string
  ): Promise<ManagerDeskItem[]> {
    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    const historyRows = await db
      .select()
      .from(managerDeskItemHistory)
      .where(and(eq(managerDeskItemHistory.workspaceId, normalizedWorkspaceId), eq(managerDeskItemHistory.managerAccountId, managerAccountId)));

    const cutoff = endOfIsoDate(date);
    const latestByItemId = new Map<number, ManagerDeskHistoryEntry>();

    for (const row of historyRows) {
      if (row.recordedAt > cutoff) {
        continue;
      }

      const parsed = this.parseHistoryRow(row);
      const existing = latestByItemId.get(parsed.itemId);
      if (!existing || existing.recordedAt < parsed.recordedAt) {
        latestByItemId.set(parsed.itemId, parsed);
      }
    }

    const snapshotItems = [...latestByItemId.values()]
      .filter((entry) => entry.eventType !== "deleted")
      .map((entry) => entry.snapshot)
      .sort(compareDeskItems);

    if (snapshotItems.length > 0) {
      return snapshotItems;
    }

    return this.getLegacyHistoricalItemsForDate(managerAccountId, date, normalizedWorkspaceId);
  }

  private async getLegacyHistoricalItemsForDate(
    managerAccountId: string,
    date: string,
    workspaceId?: string
  ): Promise<ManagerDeskItem[]> {
    const items = await this.getCurrentItemsForManager(managerAccountId, date, workspaceId);
    const cutoff = endOfIsoDate(date);

    return items.filter((item) => {
      if (item.createdAt > cutoff) {
        return false;
      }
      if (!item.completedAt) {
        return true;
      }
      return item.completedAt <= cutoff || isOpenStatus(item.status);
    });
  }

  private isRelevantToPlanningDate(item: ManagerDeskItem, date: string): boolean {
    if (!isOpenStatus(item.status)) {
      return false;
    }

    return (
      item.originDate === date ||
      isoDatePart(item.plannedStartAt) === date ||
      isoDatePart(item.plannedEndAt) === date ||
      isoDatePart(item.followUpAt) === date
    );
  }

  private buildSummary(items: ManagerDeskItem[]): ManagerDeskSummary {
    const now = Date.now();

    return {
      totalOpen: items.filter((item) => isOpenStatus(item.status)).length,
      inbox: items.filter((item) => item.status === "inbox").length,
      planned: items.filter((item) => item.status === "planned").length,
      inProgress: items.filter((item) => item.status === "in_progress").length,
      waiting: items.filter((item) => item.status === "waiting").length,
      overdueFollowUps: items.filter((item) => {
        if (!item.followUpAt || !isOpenStatus(item.status)) {
          return false;
        }
        return new Date(item.followUpAt).getTime() < now;
      }).length,
      meetings: items.filter((item) => item.kind === "meeting").length,
      completed: items.filter((item) => item.status === "done").length,
    };
  }

  private async findDay(
    managerAccountId: string,
    date: string,
    workspaceId?: string
  ): Promise<typeof managerDeskDays.$inferSelect | undefined> {
    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    const rows = await db
      .select()
      .from(managerDeskDays)
      .where(
        and(
          eq(managerDeskDays.workspaceId, normalizedWorkspaceId),
          eq(managerDeskDays.managerAccountId, managerAccountId),
          eq(managerDeskDays.date, date)
        )
      )
      .limit(1);

    return rows[0];
  }

  private async getItemById(
    managerAccountId: string,
    itemId: number,
    workspaceId?: string
  ): Promise<ManagerDeskItem> {
    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    const item = await this.getOwnedItemRow(managerAccountId, itemId, normalizedWorkspaceId);
    const day = await this.getDayById(item.dayId, normalizedWorkspaceId);
    const linksByItemId = await this.getLinksByItemIds([item.id], normalizedWorkspaceId);
    const delegatedExecutionByItemId = await this.getDelegatedExecutionByManagerDeskItemIds([
      item.id,
    ], normalizedWorkspaceId);
    const assigneesByAccountId = await this.getAssigneeMap([item], day?.date, normalizedWorkspaceId);
    return this.mapItem(
      item,
      linksByItemId.get(item.id) ?? [],
      delegatedExecutionByItemId.get(item.id),
      item.assigneeDeveloperAccountId
        ? assigneesByAccountId.get(item.assigneeDeveloperAccountId) ?? undefined
        : undefined,
      day?.date ?? localTodayIso()
    );
  }

  private async getOwnedItemRow(
    managerAccountId: string,
    itemId: number,
    workspaceId?: string
  ): Promise<ManagerDeskItemRow> {
    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    const item = await this.getItemRow(itemId, normalizedWorkspaceId);
    const day = await this.getDayById(item.dayId, normalizedWorkspaceId);

    if (!day || day.managerAccountId !== managerAccountId) {
      throw new HttpError(404, "Item not found");
    }

    return item;
  }

  private async getItemRow(itemId: number, workspaceId?: string): Promise<ManagerDeskItemRow> {
    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    const rows = await db
      .select()
      .from(managerDeskItems)
      .where(and(eq(managerDeskItems.workspaceId, normalizedWorkspaceId), eq(managerDeskItems.id, itemId)))
      .limit(1);

    const row = rows[0];
    if (!row) {
      throw new HttpError(404, "Item not found");
    }

    return row;
  }

  private async getDayById(dayId: number, workspaceId?: string): Promise<typeof managerDeskDays.$inferSelect | undefined> {
    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    const rows = await db
      .select()
      .from(managerDeskDays)
      .where(and(eq(managerDeskDays.workspaceId, normalizedWorkspaceId), eq(managerDeskDays.id, dayId)))
      .limit(1);

    return rows[0];
  }

  private assertCarryForwardDateOrder(fromDate: string, toDate: string): void {
    if (toDate <= fromDate) {
      throw new HttpError(400, "toDate must be after fromDate");
    }
  }

  private async buildCarryForwardPlan(
    managerAccountId: string,
    params: CarryForwardParams,
    workspaceId?: string
  ): Promise<ManagerDeskCarryForwardPlanEntry[]> {
    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    const sourceDay = await this.findDay(managerAccountId, params.fromDate, normalizedWorkspaceId);
    if (!sourceDay) {
      return [];
    }

    let sourceItems = await db
      .select()
      .from(managerDeskItems)
      .where(eq(managerDeskItems.dayId, sourceDay.id));

    if (params.itemIds && params.itemIds.length > 0) {
      const requestedIds = new Set(params.itemIds);
      sourceItems = sourceItems.filter((item) => requestedIds.has(item.id));
      if (sourceItems.length !== requestedIds.size) {
        const foundIds = new Set(sourceItems.map((item) => item.id));
        const missingIds = params.itemIds.filter((itemId) => !foundIds.has(itemId));
        const missingRows = await Promise.all(
          missingIds.map(async (itemId) => {
            try {
              const item = await this.getOwnedItemRow(managerAccountId, itemId, normalizedWorkspaceId);
              const day = await this.getDayById(item.dayId, normalizedWorkspaceId);
              return {
                itemId,
                dayDate: day?.date,
              };
            } catch {
              return {
                itemId,
                dayDate: undefined,
              };
            }
          })
        );

        const alreadyMovedToTarget = missingRows.every((row) => row.dayDate === params.toDate);
        if (!alreadyMovedToTarget) {
          throw new HttpError(404, "One or more items were not found for the source date");
        }
      }
    }

    const eligibleItems = sourceItems
      .filter((item) => isOpenStatus(item.status as ManagerDeskStatus))
      .sort(compareItemRows);

    if (eligibleItems.length === 0) {
      return [];
    }

    const targetDay = await this.ensureDay(managerAccountId, params.toDate, normalizedWorkspaceId);
    const targetItems = await db
      .select({
        sourceItemId: managerDeskItems.sourceItemId,
      })
      .from(managerDeskItems)
      .where(eq(managerDeskItems.dayId, targetDay.id));
    const existingSourceItemIds = new Set(
      targetItems
        .map((item) => item.sourceItemId)
        .filter((itemId): itemId is number => typeof itemId === "number")
    );

    const sourceLinksByItemId = await this.getRawLinksByItemIds(
      eligibleItems.map((item) => item.id),
      normalizedWorkspaceId
    );
    const sourceTrackerNotesByItemId = await this.getTrackerNotesByManagerDeskItemIds(
      eligibleItems.map((item) => item.id),
      normalizedWorkspaceId
    );
    const now = Date.now();

    return eligibleItems
      .filter((item) => !existingSourceItemIds.has(item.id))
      .map((item) => {
        const rebasedPlannedStartAt =
          rebaseTimestampToTargetDate(item.plannedStartAt, params.fromDate, params.toDate) ?? null;
        const rebasedPlannedEndAt =
          rebaseTimestampToTargetDate(item.plannedEndAt, params.fromDate, params.toDate) ?? null;
        const rebasedFollowUpAt =
          rebaseTimestampToTargetDate(item.followUpAt, params.fromDate, params.toDate) ?? null;
        this.assertTimeRange(rebasedPlannedStartAt, rebasedPlannedEndAt);

        const rawLinks = [...(sourceLinksByItemId.get(item.id) ?? [])].sort(
          (left, right) => left.id - right.id
        );
        return {
          item,
          rawLinks,
          normalizedLinks: rawLinks.map((link) => ({
            linkType: link.linkType as ManagerDeskLinkType,
            issueKey: link.issueKey ?? undefined,
            developerAccountId: link.developerAccountId ?? undefined,
            externalLabel: link.externalLabel ?? undefined,
          })),
          trackerNote: sourceTrackerNotesByItemId.get(item.id) ?? null,
          rebasedPlannedStartAt,
          rebasedPlannedEndAt,
          rebasedFollowUpAt,
          warningCodes: getCarryForwardWarningCodes({
            rebasedPlannedEndAt,
            rebasedFollowUpAt,
            now,
          }),
        };
      });
  }

  private async resolveLatestCarryForwardSourceDate(
    managerAccountId: string,
    toDate: string,
    lookbackDays: number,
    workspaceId?: string
  ): Promise<string | undefined> {
    const boundedLookbackDays = Math.max(
      1,
      Math.min(SMART_CARRY_FORWARD_LOOKBACK_DAYS, Math.trunc(lookbackDays))
    );

    for (let dayOffset = 1; dayOffset <= boundedLookbackDays; dayOffset += 1) {
      const candidateDate = addDaysToIsoDate(toDate, -dayOffset);
      const plan = await this.buildCarryForwardPlan(managerAccountId, {
        fromDate: candidateDate,
        toDate,
      }, workspaceId);

      if (plan.length > 0) {
        return candidateDate;
      }
    }

    return undefined;
  }

  private async buildCarryForwardPreviewItems(
    plan: ManagerDeskCarryForwardPlanEntry[],
    date: string,
    workspaceId?: string
  ): Promise<ManagerDeskCarryForwardPreviewItem[]> {
    if (plan.length === 0) {
      return [];
    }

    const itemIds = plan.map((entry) => entry.item.id);
    const linksByItemId = await this.getLinksByItemIds(itemIds, workspaceId);
    const delegatedExecutionByItemId = await this.getDelegatedExecutionByManagerDeskItemIds(itemIds, workspaceId);
    const assigneesByAccountId = await this.getAssigneeMap(plan.map((entry) => entry.item), date, workspaceId);

    return plan.map((entry) => ({
      item: this.mapItem(
        entry.item,
        linksByItemId.get(entry.item.id) ?? [],
        delegatedExecutionByItemId.get(entry.item.id),
        entry.item.assigneeDeveloperAccountId
          ? assigneesByAccountId.get(entry.item.assigneeDeveloperAccountId) ?? undefined
          : undefined,
        date
      ),
      rebasedPlannedStartAt: entry.rebasedPlannedStartAt ?? undefined,
      rebasedPlannedEndAt: entry.rebasedPlannedEndAt ?? undefined,
      rebasedFollowUpAt: entry.rebasedFollowUpAt ?? undefined,
      warningCodes: entry.warningCodes,
    }));
  }

  private async getLinksByItemIds(itemIds: number[], workspaceId?: string): Promise<Map<number, ManagerDeskLink[]>> {
    const rawLinksByItemId = await this.getRawLinksByItemIds(itemIds, workspaceId);
    const allLinkRows = [...rawLinksByItemId.values()].flat();
    if (allLinkRows.length === 0) {
      return new Map(itemIds.map((itemId) => [itemId, []]));
    }

    const developerIds = [...new Set(
      allLinkRows
        .map((link) => link.developerAccountId)
        .filter((accountId): accountId is string => Boolean(accountId))
    )];
    const developerNames = await this.getDeveloperDisplayNameMap(developerIds, workspaceId);

    const mapped = new Map<number, ManagerDeskLink[]>();
    for (const [itemId, rows] of rawLinksByItemId.entries()) {
      mapped.set(
        itemId,
        rows
          .sort((left, right) => left.id - right.id)
          .map((row) => this.mapLink(row, developerNames))
      );
    }

    return mapped;
  }

  private async getRawLinksByItemIds(itemIds: number[], workspaceId?: string): Promise<Map<number, ManagerDeskLinkRow[]>> {
    if (itemIds.length === 0) {
      return new Map();
    }
    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);

    const rows = await db
      .select()
      .from(managerDeskLinks)
      .where(and(eq(managerDeskLinks.workspaceId, normalizedWorkspaceId), inArray(managerDeskLinks.itemId, itemIds)));

    const grouped = new Map<number, ManagerDeskLinkRow[]>();
    for (const itemId of itemIds) {
      grouped.set(itemId, []);
    }
    for (const row of rows) {
      const bucket = grouped.get(row.itemId);
      if (bucket) {
        bucket.push(row);
      } else {
        grouped.set(row.itemId, [row]);
      }
    }

    return grouped;
  }

  private async getDeveloperDisplayNameMap(
    developerIds: string[],
    workspaceId?: string
  ): Promise<Map<string, string>> {
    if (developerIds.length === 0) {
      return new Map();
    }

    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    const rows = await db
      .select({
        accountId: developers.accountId,
        displayName: developers.displayName,
      })
      .from(developers)
      .where(and(eq(developers.workspaceId, normalizedWorkspaceId), inArray(developers.accountId, developerIds)));

    return new Map(rows.map((row) => [row.accountId, row.displayName]));
  }

  private async getAssigneeMap(
    items: Pick<ManagerDeskItemRow, "assigneeDeveloperAccountId">[],
    date?: string,
    workspaceId?: string
  ): Promise<Map<string, ManagerDeskAssignee>> {
    const assigneeIds = [...new Set(
      items
        .map((item) => item.assigneeDeveloperAccountId)
        .filter((accountId): accountId is string => Boolean(accountId))
    )];

    if (assigneeIds.length === 0) {
      return new Map();
    }

    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    const rows = await db
      .select({
        accountId: developers.accountId,
        displayName: developers.displayName,
        avatarUrl: developers.avatarUrl,
      })
      .from(developers)
      .where(and(eq(developers.workspaceId, normalizedWorkspaceId), inArray(developers.accountId, assigneeIds)));

    const availabilityByAccountId = date
      ? await this.availability.getAvailabilityMapForDate(assigneeIds, date, normalizedWorkspaceId)
      : new Map();

    return new Map(
      rows.map((row) => [
        row.accountId,
        {
          accountId: row.accountId,
          displayName: row.displayName,
          avatarUrl: row.avatarUrl ?? undefined,
          availability: availabilityByAccountId.get(row.accountId),
        },
      ])
    );
  }

  private parseHistoryRow(row: ManagerDeskItemHistoryRow): ManagerDeskHistoryEntry {
    const parsed = JSON.parse(row.snapshotJson) as ManagerDeskItem;
    return {
      itemId: row.itemId,
      managerAccountId: row.managerAccountId,
      eventType: row.eventType as "upsert" | "deleted",
      snapshot: parsed,
      recordedAt: row.recordedAt,
    };
  }

  private async recordHistorySnapshotForItem(
    managerAccountId: string,
    itemId: number,
    eventType: "upsert" | "deleted" = "upsert",
    workspaceId?: string
  ): Promise<void> {
    const snapshot = await this.getItemById(managerAccountId, itemId, workspaceId);
    await this.insertHistoryRow(managerAccountId, itemId, snapshot, eventType, workspaceId);
  }

  private async insertHistoryRow(
    managerAccountId: string,
    itemId: number,
    snapshot: ManagerDeskItem,
    eventType: "upsert" | "deleted",
    workspaceId?: string
  ): Promise<void> {
    await db.insert(managerDeskItemHistory).values({
      workspaceId: normalizeWorkspaceId(workspaceId),
      itemId,
      managerAccountId,
      eventType,
      snapshotJson: JSON.stringify(snapshot),
      recordedAt: nowIso(),
    });
  }

  private mapItem(
    item: ManagerDeskItemRow,
    links: ManagerDeskLink[],
    delegatedExecution?: ManagerDeskDelegatedExecution,
    assignee?: ManagerDeskAssignee,
    originDate?: string
  ): ManagerDeskItem {
    return {
      id: item.id,
      dayId: item.dayId,
      originDate: originDate ?? localTodayIso(),
      taskKey: item.taskKey,
      ...(item.createdByType && { createdBy: { type: item.createdByType as NonNullable<ManagerDeskItem["createdBy"]>["type"], ...(item.createdById && { id: item.createdById }) } }),
      title: item.title,
      kind: item.kind as ManagerDeskItemKind,
      category: item.category as ManagerDeskCategory,
      status: item.status as ManagerDeskStatus,
      priority: item.priority as ManagerDeskPriority,
      assigneeDeveloperAccountId: item.assigneeDeveloperAccountId ?? undefined,
      participants: item.participants ?? undefined,
      contextNote: item.contextNote ?? undefined,
      nextAction: item.nextAction ?? undefined,
      outcome: item.outcome ?? undefined,
      plannedStartAt: item.plannedStartAt ?? undefined,
      plannedEndAt: item.plannedEndAt ?? undefined,
      followUpAt: item.followUpAt ?? undefined,
      completedAt: item.completedAt ?? undefined,
      delegatedExecution,
      assignee,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      links,
    };
  }

  private mapLink(
    link: ManagerDeskLinkRow,
    developerNames: Map<string, string>
  ): ManagerDeskLink {
    return {
      id: link.id,
      itemId: link.itemId,
      linkType: link.linkType as ManagerDeskLinkType,
      issueKey: link.issueKey ?? undefined,
      developerAccountId: link.developerAccountId ?? undefined,
      externalLabel: link.externalLabel ?? undefined,
      displayLabel: this.getLinkDisplayLabel(link, developerNames),
      createdAt: link.createdAt,
    };
  }

  private getLinkDisplayLabel(
    link: Pick<
      ManagerDeskLinkRow,
      "linkType" | "issueKey" | "developerAccountId" | "externalLabel"
    >,
    developerNames: Map<string, string>
  ): string {
    if (link.linkType === "issue") {
      return link.issueKey ?? "Issue";
    }

    if (link.linkType === "developer") {
      return developerNames.get(link.developerAccountId ?? "") ?? link.developerAccountId ?? "Developer";
    }

    return link.externalLabel ?? "External Group";
  }

  private assertTimeRange(
    plannedStartAt: string | null | undefined,
    plannedEndAt: string | null | undefined
  ): void {
    if (!plannedStartAt || !plannedEndAt) {
      return;
    }

    if (new Date(plannedEndAt).getTime() < new Date(plannedStartAt).getTime()) {
      throw new HttpError(400, "plannedEndAt must be greater than or equal to plannedStartAt");
    }
  }

  private async normalizeLinkInputs(
    links: ManagerDeskLinkInput[],
    workspaceId?: string
  ): Promise<NormalizedManagerDeskLink[]> {
    const normalized: NormalizedManagerDeskLink[] = [];
    for (const link of links) {
      normalized.push(await this.normalizeLinkInput(link, workspaceId));
    }
    return normalized;
  }

  private async getNormalizedLinksByItemId(itemId: number, workspaceId?: string): Promise<NormalizedManagerDeskLink[]> {
    const rows = (await this.getRawLinksByItemIds([itemId], workspaceId)).get(itemId) ?? [];
    return [...rows].sort((left, right) => left.id - right.id).map((row) => ({
      linkType: row.linkType as ManagerDeskLinkType,
      issueKey: row.issueKey ?? undefined,
      developerAccountId: row.developerAccountId ?? undefined,
      externalLabel: row.externalLabel ?? undefined,
    }));
  }

  private async normalizeAssigneeAccountId(
    accountId: string | null | undefined,
    workspaceId?: string
  ): Promise<string | null | undefined> {
    if (accountId === undefined) {
      return undefined;
    }
    if (accountId === null) {
      return null;
    }

    const normalized = accountId.trim();
    if (!normalized) {
      return null;
    }

    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    const rows = await db
      .select({ accountId: developers.accountId })
      .from(developers)
      .where(and(eq(developers.workspaceId, normalizedWorkspaceId), eq(developers.accountId, normalized), eq(developers.isActive, 1)))
      .limit(1);

    if (!rows[0]) {
      throw new HttpError(400, `Active team member ${normalized} was not found`);
    }

    return normalized;
  }

  private async syncTrackerAssignment(
    managerDeskItemId: number,
    assigneeDeveloperAccountId: string | null | undefined,
    date: string,
    title: string,
    links: NormalizedManagerDeskLink[],
    status: ManagerDeskStatus,
    note?: string | null,
    workspaceId?: string,
    reopened?: boolean
  ): Promise<void> {
    await this.trackerService.syncManagerDeskItem({
      workspaceId: normalizeWorkspaceId(workspaceId),
      managerDeskItemId,
      assigneeDeveloperAccountId: isOpenStatus(status) ? assigneeDeveloperAccountId : null,
      date,
      title,
      issueKeys: links
        .filter((link) => link.linkType === "issue" && link.issueKey)
        .map((link) => link.issueKey!),
      note,
      outcome: status === "done" ? "done" : isOpenStatus(status) ? undefined : "dropped",
      reopened,
    });
  }

  private async getTrackerNotesByManagerDeskItemIds(
    itemIds: number[],
    workspaceId?: string
  ): Promise<Map<number, string | null>> {
    if (itemIds.length === 0) {
      return new Map();
    }

    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    const rows = await db
      .select({
        managerDeskItemId: teamTrackerItems.managerDeskItemId,
        note: teamTrackerItems.note,
      })
      .from(teamTrackerItems)
      .where(and(eq(teamTrackerItems.workspaceId, normalizedWorkspaceId), inArray(teamTrackerItems.managerDeskItemId, itemIds)));

    return new Map(
      rows
        .filter((row): row is { managerDeskItemId: number; note: string | null } => {
          return row.managerDeskItemId !== null;
        })
        .map((row) => [row.managerDeskItemId, row.note])
    );
  }

  private async getDelegatedExecutionByManagerDeskItemIds(
    itemIds: number[],
    workspaceId?: string
  ): Promise<Map<number, ManagerDeskDelegatedExecution>> {
    if (itemIds.length === 0) {
      return new Map();
    }

    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    const rows = await db
      .select()
      .from(teamTrackerItems)
      .where(and(eq(teamTrackerItems.workspaceId, normalizedWorkspaceId), inArray(teamTrackerItems.managerDeskItemId, itemIds)));

    return new Map(
      rows
        .filter((row): row is TrackerItemRow & { managerDeskItemId: number } => {
          return row.managerDeskItemId !== null;
        })
        .map((row) => [
          row.managerDeskItemId,
          {
            trackerItemId: row.id,
            state: row.state as TrackerItemState,
            note: row.note ?? undefined,
            completedAt: row.completedAt ?? undefined,
            updatedAt: row.updatedAt,
          },
        ])
    );
  }

  private async createManagerDeskItemFromTrackerItem(
    managerAccountId: string,
    trackerContext: Awaited<ReturnType<TeamTrackerService["getItemDetailContext"]>>,
    workspaceId?: string
  ): Promise<number> {
    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    const day = await this.ensureDay(managerAccountId, trackerContext.date, normalizedWorkspaceId);
    const now = nowIso();
    const inserted = await db
      .insert(managerDeskItems)
      .values({
        workspaceId: normalizedWorkspaceId,
        dayId: day.id,
        sourceItemId: null,
        taskKey: trackerContext.trackerItem.taskKey,
        createdByType: "manager",
        createdById: managerAccountId,
        assigneeDeveloperAccountId: trackerContext.developer.accountId,
        title: trackerContext.trackerItem.title,
        kind: "action",
        category: "other",
        status: getLegacyTrackerManagerDeskStatus(trackerContext.trackerItem.state),
        priority: "medium",
        participants: null,
        contextNote: trackerContext.trackerItem.note ?? null,
        nextAction: null,
        outcome: null,
        plannedStartAt: null,
        plannedEndAt: null,
        followUpAt: null,
        completedAt: null,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    const item = inserted[0];
    if (!item) {
      throw new Error("Failed to create manager desk item from tracker item");
    }

    const issueKeys = [
      trackerContext.trackerItem.jiraKey,
      ...(trackerContext.trackerItem.relatedIssueKeys ?? []),
    ]
      .map((key) => key?.trim())
      .filter((key): key is string => Boolean(key));
    const uniqueIssueKeys = Array.from(new Set(issueKeys));
    if (uniqueIssueKeys.length > 0) {
      await db.insert(managerDeskLinks).values(
        uniqueIssueKeys.map((issueKey) => ({
          workspaceId: normalizedWorkspaceId,
          itemId: item.id,
          linkType: "issue",
          issueKey,
          developerAccountId: null,
          externalLabel: null,
          createdAt: now,
        }))
      );
    }

    await this.trackerService.linkManagerDeskItem(trackerContext.trackerItem.id, item.id, normalizedWorkspaceId);
    await this.emit(item, { type: "created", body: null, meta: { source: "promote", ownerType: "developer", ownerId: trackerContext.developer.accountId, title: item.title } }, { type: "system", accountId: managerAccountId });
    await this.recordHistorySnapshotForItem(managerAccountId, item.id, "upsert", normalizedWorkspaceId);

    return item.id;
  }

  private async buildTrackerTaskDetailResponse(
    managerAccountId: string,
    trackerContext: Awaited<ReturnType<TeamTrackerService["getItemDetailContext"]>>,
    workspaceId?: string
  ): Promise<TrackerSharedTaskDetailResponse> {
    const managerDeskItemId = trackerContext.trackerItem.managerDeskItemId;

    if (!managerDeskItemId) {
      return {
        date: trackerContext.date,
        developer: trackerContext.developer,
        lifecycle: "tracker_only",
        trackerItem: trackerContext.trackerItem,
      };
    }

    return {
      date: trackerContext.date,
      developer: trackerContext.developer,
      lifecycle: "manager_desk_linked",
      managerDeskItem: await this.getItemById(managerAccountId, managerDeskItemId, workspaceId),
      trackerItem: trackerContext.trackerItem,
    };
  }

  private async normalizeLinkInput(
    link: ManagerDeskLinkInput,
    workspaceId?: string
  ): Promise<NormalizedManagerDeskLink> {
    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    if (link.linkType === "issue") {
      const issueKey = link.issueKey?.trim().toUpperCase();
      if (!issueKey) {
        throw new HttpError(400, "issueKey is required for issue links");
      }

      const issueRows = await db
        .select({ jiraKey: issues.jiraKey })
        .from(issues)
        .where(and(eq(issues.workspaceId, normalizedWorkspaceId), eq(issues.jiraKey, issueKey)))
        .limit(1);
      if (!issueRows[0]) {
        throw new HttpError(400, `Jira issue ${issueKey} is not available in synced issues`);
      }

      return {
        linkType: "issue",
        issueKey,
      };
    }

    if (link.linkType === "developer") {
      const developerAccountId = link.developerAccountId?.trim();
      if (!developerAccountId) {
        throw new HttpError(400, "developerAccountId is required for developer links");
      }

      const developerRows = await db
        .select({ accountId: developers.accountId })
        .from(developers)
        .where(and(eq(developers.workspaceId, normalizedWorkspaceId), eq(developers.accountId, developerAccountId)))
        .limit(1);
      if (!developerRows[0]) {
        throw new HttpError(400, `Developer ${developerAccountId} was not found`);
      }

      return {
        linkType: "developer",
        developerAccountId,
      };
    }

    const externalLabel = link.externalLabel?.trim();
    if (!externalLabel) {
      throw new HttpError(400, "externalLabel is required for external_group links");
    }

    return {
      linkType: "external_group",
      externalLabel,
    };
  }

  private assertNoDuplicateLinks(links: NormalizedManagerDeskLink[]): void {
    const seen = new Set<string>();

    for (const link of links) {
      const identity = buildLinkIdentity(link);
      if (seen.has(identity)) {
        throw new HttpError(409, "Duplicate links are not allowed on the same item");
      }
      seen.add(identity);
    }
  }

  private async assertItemDoesNotAlreadyHaveLink(
    itemId: number,
    link: NormalizedManagerDeskLink,
    workspaceId?: string
  ): Promise<void> {
    const existingLinks = (await this.getRawLinksByItemIds([itemId], workspaceId)).get(itemId) ?? [];
    const existingIdentities = new Set(
      existingLinks.map((existingLink) =>
        buildLinkIdentity({
          linkType: existingLink.linkType as ManagerDeskLinkType,
          issueKey: existingLink.issueKey ?? undefined,
          developerAccountId: existingLink.developerAccountId ?? undefined,
          externalLabel: existingLink.externalLabel ?? undefined,
        })
      )
    );

    if (existingIdentities.has(buildLinkIdentity(link))) {
      throw new HttpError(409, "Identical link already exists for this item");
    }
  }
}
