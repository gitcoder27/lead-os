import { and, desc, eq, gte, inArray, lt, lte } from "drizzle-orm";
import type {
  TrackerDeveloperStatus,
  TrackerItemState,
  TrackerDeveloperDay,
  TrackerDeveloperSignals,
  TrackerWorkItem,
  TrackerCheckIn,
  TeamTrackerBoardResponse,
  TrackerBoardSummary,
  TrackerAttentionItem,
  TrackerAttentionActionItem,
  TrackerAttentionReason,
  TrackerAttentionReasonCode,
  TrackerAttentionQuickAction,
  TrackerCarryForwardContextResponse,
  TrackerCarryForwardPreviewGroup,
  TrackerCarryForwardPreviewResponse,
  Developer,
  TrackerIssueAssignment,
  IssueTrackerAssignmentSummary,
  UserRole,
  TeamTrackerBoardQuery,
  TeamTrackerBoardResolvedQuery,
  TeamTrackerBoardSort,
  TeamTrackerBoardGroupBy,
  TrackerBoardSummaryFilter,
  TrackerDeveloperGroup,
  TeamTrackerSavedView,
  TeamTrackerViewMode,
  MyDayViewMode,
} from "shared/types";
import { db } from "../db/connection";
import {
  developers,
  issues,
  managerDeskItems,
  teamTrackerDays,
  teamTrackerItems,
  teamTrackerCheckIns,
  teamTrackerSavedViews,
  checkinTaskRefs,
  developerNotes,
  dayFocus,
} from "../db/schema";
import { getEffectiveDueDate } from "./issue-rules";
import { HttpError } from "../middleware/errorHandler";
import { SettingsService } from "./settings.service";
import { DeveloperAvailabilityService } from "./developer-availability.service";
import { runInTransaction } from "../db/transaction";
import {
  normalizeBoardSearchQuery,
  normalizeSavedViewQuery as normalizeSavedViewQueryInput,
  resolveUnsavedBoardQuery,
} from "./team-tracker-board-query";
import { normalizeWorkspaceId } from "./workspace.service";
import { isoDatePart, todayIsoDate } from "../utils/date";
import { TaskKeysService } from "./task-keys.service";
import { TaskEventsService, type TaskEventActor, type TaskEventInput } from "./task-events.service";
import { TaskService, type TaskPrincipal, type TaskRow } from "./task.service";
import { surfaceTaskToWorkItem } from "./task-view-models";
import { TASK_KEY_PATTERN } from "shared/types";
import type { SurfaceTask, TaskStatus } from "shared/types";

interface TrackerSignalConfig {
  staleThresholdHours: number;
  noCurrentThresholdHours: number;
  statusFollowUpThresholdHours: number;
}

interface CarryForwardSourceItem {
  developerAccountId: string;
  item: typeof teamTrackerItems.$inferSelect;
}

interface CarryForwardPlanEntry {
  developer: Developer;
  developerAccountId: string;
  originDate: string;
  item: typeof teamTrackerItems.$inferSelect;
  trackerItem: TrackerWorkItem;
}

interface CarryForwardPlan {
  entries: CarryForwardPlanEntry[];
}

interface CarryForwardExecutionOptions {
  itemIds?: number[];
  actor?: TaskEventActor;
  carryManagerDeskItems?: (params: {
    fromDate: string;
    toDate: string;
    itemIds: number[];
  }) => Promise<number>;
}

interface TeamTrackerSavedViewInput {
  name: string;
  q?: string;
  summaryFilter?: TrackerBoardSummaryFilter;
  sortBy?: TeamTrackerBoardSort;
  groupBy?: TeamTrackerBoardGroupBy;
}

interface TeamTrackerSavedViewUpdate {
  name?: string;
  q?: string;
  summaryFilter?: TrackerBoardSummaryFilter;
  sortBy?: TeamTrackerBoardSort;
  groupBy?: TeamTrackerBoardGroupBy;
}

interface DeveloperDayView {
  day: TrackerDeveloperDay;
  viewMode: MyDayViewMode;
}

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

function normalizeOptionalText(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeJiraIssueKey(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed.toUpperCase() : undefined;
}

function normalizeJiraIssueKeys(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const value of values) {
    const key = normalizeJiraIssueKey(value);
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    normalized.push(key);
  }

  return normalized;
}

function parseRelatedIssueKeys(value: string | null | undefined): string[] {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return normalizeJiraIssueKeys(
      parsed.filter((key): key is string => typeof key === "string")
    );
  } catch {
    return [];
  }
}

function serializeRelatedIssueKeys(keys: string[]): string | null {
  const normalized = normalizeJiraIssueKeys(keys);
  return normalized.length > 0 ? JSON.stringify(normalized) : null;
}

function resolveTrackerIssueKeys(params: {
  jiraKey?: string | null;
  relatedIssueKeys?: string[];
}): {
  jiraKey?: string;
  relatedIssueKeys: string[];
  allIssueKeys: string[];
} {
  const jiraKey = normalizeJiraIssueKey(params.jiraKey);
  const seen = new Set<string>();
  if (jiraKey) {
    seen.add(jiraKey);
  }

  const relatedIssueKeys: string[] = [];
  for (const key of normalizeJiraIssueKeys(params.relatedIssueKeys ?? [])) {
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    relatedIssueKeys.push(key);
  }

  return {
    jiraKey,
    relatedIssueKeys,
    allIssueKeys: jiraKey ? [jiraKey, ...relatedIssueKeys] : relatedIssueKeys,
  };
}

function requiresStatusRationale(status: TrackerDeveloperStatus): boolean {
  return status === "blocked" || status === "at_risk";
}

const TRACKER_STATUS_LABELS: Record<TrackerDeveloperStatus, string> = {
  on_track: "On Track",
  at_risk: "At Risk",
  blocked: "Blocked",
  waiting: "Waiting",
  done_for_today: "Done for Today",
};

const BLOCKED_FIRST_STATUS_ORDER: Record<TrackerDeveloperStatus, number> = {
  blocked: 0,
  at_risk: 1,
  waiting: 2,
  on_track: 3,
  done_for_today: 4,
};
const SMART_CARRY_FORWARD_LOOKBACK_DAYS = 30;
const RECENT_CHECKIN_LOOKBACK_DAYS = 7;
const RECENT_CHECKIN_LIMIT = 5;

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

function addDaysToIsoDate(value: string, days: number): string {
  const parts = parseIsoDate(value);
  const utcDate = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  utcDate.setUTCDate(utcDate.getUTCDate() + days);
  return formatIsoDateUtc(utcDate);
}

function assertForwardDateRange(fromDate: string, toDate: string): void {
  if (toDate <= fromDate) {
    throw new HttpError(400, "toDate must be after fromDate");
  }
}

function endOfIsoDate(date: string): Date {
  return new Date(`${date}T23:59:59.999`);
}

function getTrackerViewMode(date: string): TeamTrackerViewMode {
  return date < localTodayIso() ? "history" : "live";
}

function getMyDayViewMode(date: string): MyDayViewMode {
  const today = localTodayIso();
  if (date < today) {
    return "history";
  }
  if (date > today) {
    return "planning";
  }
  return "live";
}

function getSeededStatus(status: string | null | undefined): TrackerDeveloperStatus {
  if (
    status === "blocked" ||
    status === "at_risk" ||
    status === "waiting" ||
    status === "on_track"
  ) {
    return status;
  }

  return "on_track";
}

function buildStatusUpdateSummary(params: {
  status: TrackerDeveloperStatus;
  rationale?: string;
  summary?: string;
}): string {
  return (
    params.summary ??
    params.rationale ??
    `Status updated to ${TRACKER_STATUS_LABELS[params.status]}.`
  );
}

function mapSavedView(
  row: typeof teamTrackerSavedViews.$inferSelect
): TeamTrackerSavedView {
  return {
    id: row.id,
    name: row.name,
    q: row.searchQuery ?? "",
    summaryFilter: row.summaryFilter as TrackerBoardSummaryFilter,
    sortBy: row.sortBy as TeamTrackerBoardSort,
    groupBy: row.groupBy as TeamTrackerBoardGroupBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function getHoursSince(value: string | null | undefined, now = new Date()): number | undefined {
  if (!value) {
    return undefined;
  }

  const diff = now.getTime() - new Date(value).getTime();
  return Math.max(0, Math.round((diff / (60 * 60 * 1000)) * 10) / 10);
}

function hasOpenRiskStatus(status: TrackerDeveloperStatus): boolean {
  return status === "blocked" || status === "at_risk" || status === "waiting";
}

function buildSignals(params: {
  date: string;
  status: TrackerDeveloperStatus;
  lastCheckInAt?: string | null;
  statusUpdatedAt?: string | null;
  updatedAt: string;
  currentItem?: TrackerWorkItem;
  plannedItems: TrackerWorkItem[];
  capacityUnits?: number;
  config: TrackerSignalConfig;
  now?: Date;
}): TrackerDeveloperSignals {
  const now = params.now ?? new Date();
  const hoursSinceCheckIn = getHoursSince(params.lastCheckInAt, now);
  const effectiveStatusUpdatedAt =
    params.statusUpdatedAt ??
    (params.status !== "on_track" ? params.updatedAt : null);
  const hoursSinceStatusChange = getHoursSince(effectiveStatusUpdatedAt, now);
  const staleByTime =
    hoursSinceCheckIn === undefined ||
    hoursSinceCheckIn >= params.config.staleThresholdHours;
  const noCurrentWork =
    !params.currentItem && params.status !== "done_for_today";
  const openRisk = hasOpenRiskStatus(params.status);
  const staleWithoutCurrentWork =
    noCurrentWork &&
    (hoursSinceCheckIn === undefined ||
      hoursSinceCheckIn >= params.config.noCurrentThresholdHours);
  const overdueLinkedCount = [params.currentItem, ...params.plannedItems].filter(
    (item): item is TrackerWorkItem =>
      Boolean(item?.jiraDueDate && item.jiraDueDate < params.date)
  ).length;
  const assignedTodayCount =
    (params.currentItem ? 1 : 0) + params.plannedItems.length;
  const capacityDelta = params.capacityUnits
    ? assignedTodayCount - params.capacityUnits
    : 0;
  const hasFollowUpAfterStatusChange = Boolean(
    effectiveStatusUpdatedAt &&
      params.lastCheckInAt &&
      new Date(params.lastCheckInAt).getTime() >=
        new Date(effectiveStatusUpdatedAt).getTime()
  );
  const statusChangeWithoutFollowUp = Boolean(
    effectiveStatusUpdatedAt &&
      openRisk &&
      !hasFollowUpAfterStatusChange &&
      (hoursSinceStatusChange ?? 0) >= params.config.statusFollowUpThresholdHours
  );

  return {
    freshness: {
      staleThresholdHours: params.config.staleThresholdHours,
      noCurrentThresholdHours: params.config.noCurrentThresholdHours,
      statusFollowUpThresholdHours: params.config.statusFollowUpThresholdHours,
      hoursSinceCheckIn,
      hoursSinceStatusChange,
      staleByTime,
      staleWithOpenRisk: staleByTime && openRisk,
      staleWithoutCurrentWork,
      statusChangeWithoutFollowUp,
    },
    risk: {
      openRisk,
      overdueLinkedWork: overdueLinkedCount > 0,
      overdueLinkedCount,
      overCapacity: capacityDelta > 0,
      capacityDelta: Math.max(0, capacityDelta),
    },
  };
}

type TrackerIssueContext = Pick<
  typeof issues.$inferSelect,
  "jiraKey" | "summary" | "priorityName" | "dueDate" | "developmentDueDate"
>;

function mapItem(
  row: typeof teamTrackerItems.$inferSelect,
  issueContext?: TrackerIssueContext,
  originDate?: string
): TrackerWorkItem {
  const relatedIssueKeys = parseRelatedIssueKeys(row.relatedJiraKeys).filter(
    (key) => key !== normalizeJiraIssueKey(row.jiraKey)
  );

  return {
    id: row.id,
    dayId: row.dayId,
    originDate: originDate ?? isoDatePart(row.createdAt) ?? "",
    taskKey: row.taskKey,
    ...(row.createdByType && { createdBy: { type: row.createdByType as NonNullable<TrackerWorkItem["createdBy"]>["type"], ...(row.createdById && { id: row.createdById }) } }),
    managerDeskItemId: row.managerDeskItemId ?? undefined,
    lifecycle: row.managerDeskItemId === null ? "tracker_only" : "manager_desk_linked",
    itemType: row.jiraKey ? "jira" : "custom",
    jiraKey: row.jiraKey ?? undefined,
    ...(relatedIssueKeys.length > 0 && { relatedIssueKeys }),
    jiraSummary: issueContext?.summary ?? undefined,
    jiraPriorityName: issueContext?.priorityName ?? undefined,
    jiraDueDate: issueContext
      ? getEffectiveDueDate(issueContext) ?? undefined
      : undefined,
    title: row.title,
    state: row.state as TrackerItemState,
    position: row.position,
    note: row.note ?? undefined,
    completedAt: row.completedAt ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapCheckIn(
  row: typeof teamTrackerCheckIns.$inferSelect
): TrackerCheckIn {
  return {
    id: row.id,
    dayId: row.dayId,
    summary: row.summary,
    createdAt: row.createdAt,
    authorType: row.authorType as UserRole,
    authorAccountId: row.authorAccountId ?? undefined,
    status: (row.status as TrackerDeveloperStatus | null) ?? undefined,
    rationale: row.rationale ?? undefined,
    nextFollowUpAt: row.nextFollowUpAt ?? undefined,
    taskKeys: [],
  };
}

function mapAttentionActionItem(item: TrackerWorkItem): TrackerAttentionActionItem {
  return {
    id: item.id,
    ...(item.taskKey && { taskKey: item.taskKey }),
    title: item.title,
    jiraKey: item.jiraKey,
    ...(item.relatedIssueKeys && { relatedIssueKeys: item.relatedIssueKeys }),
    lifecycle: item.lifecycle,
  };
}

function getAttentionQuickActions(day: TrackerDeveloperDay): TrackerAttentionQuickAction[] {
  const actions: TrackerAttentionQuickAction[] = [
    "update_status",
    "mark_inactive",
    "capture_follow_up",
  ];

  if (!day.currentItem && day.plannedItems.length > 0) {
    actions.push("set_current");
  }

  return actions;
}

function mapDeveloper(row: typeof developers.$inferSelect): Developer {
  return {
    accountId: row.accountId,
    displayName: row.displayName,
    email: row.email ?? undefined,
    avatarUrl: row.avatarUrl ?? undefined,
    isActive: row.isActive === 1,
  };
}

function buildCarryForwardKey(
  item: Pick<
    typeof teamTrackerItems.$inferSelect,
    "jiraKey" | "relatedJiraKeys" | "title"
  >
): string {
  return JSON.stringify([
    item.jiraKey ?? null,
    parseRelatedIssueKeys(item.relatedJiraKeys),
    item.title,
  ]);
}

// Keyed rows keep one stable identity across days regardless of title/note
// edits, so carry-forward dedupe must count them by task_key when present.
function buildCarryForwardIdentity(
  item: Pick<
    typeof teamTrackerItems.$inferSelect,
    "taskKey" | "jiraKey" | "relatedJiraKeys" | "title"
  >
): string {
  if (item.taskKey) {
    return `task:${item.taskKey}`;
  }
  return buildCarryForwardKey(item);
}

function buildLiveWorkspaceItemKey(
  item: Pick<
    typeof teamTrackerItems.$inferSelect,
    "managerDeskItemId" | "taskKey" | "jiraKey" | "relatedJiraKeys" | "title"
  >
): string {
  if (item.taskKey) return `task:${item.taskKey}`;
  if (item.managerDeskItemId !== null) {
    return `manager_desk:${item.managerDeskItemId}`;
  }

  return `tracker:${buildCarryForwardKey(item)}`;
}

function compareTrackerRowsByRecency(
  left: typeof teamTrackerItems.$inferSelect,
  right: typeof teamTrackerItems.$inferSelect,
  dayById: Map<number, typeof teamTrackerDays.$inferSelect>
): number {
  const leftDate = dayById.get(left.dayId)?.date ?? "";
  const rightDate = dayById.get(right.dayId)?.date ?? "";
  if (leftDate !== rightDate) {
    return leftDate.localeCompare(rightDate);
  }

  const updatedDiff =
    new Date(left.updatedAt).getTime() - new Date(right.updatedAt).getTime();
  if (updatedDiff !== 0) {
    return updatedDiff;
  }

  const createdDiff =
    new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
  if (createdDiff !== 0) {
    return createdDiff;
  }

  return left.id - right.id;
}

function compareLiveOpenItems(
  left: TrackerWorkItem,
  right: TrackerWorkItem
): number {
  const leftStateRank = left.state === "in_progress" ? 0 : 1;
  const rightStateRank = right.state === "in_progress" ? 0 : 1;
  if (leftStateRank !== rightStateRank) {
    return leftStateRank - rightStateRank;
  }

  const leftCreated = new Date(left.createdAt).getTime();
  const rightCreated = new Date(right.createdAt).getTime();
  if (leftCreated !== rightCreated) {
    return leftCreated - rightCreated;
  }

  if (left.position !== right.position) {
    return left.position - right.position;
  }

  return left.id - right.id;
}

function compareLiveCurrentItems(
  left: TrackerWorkItem,
  right: TrackerWorkItem
): number {
  const updatedDiff =
    new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
  if (updatedDiff !== 0) {
    return updatedDiff;
  }

  const originDiff = right.originDate.localeCompare(left.originDate);
  if (originDiff !== 0) {
    return originDiff;
  }

  const createdDiff =
    new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
  if (createdDiff !== 0) {
    return createdDiff;
  }

  return right.id - left.id;
}

function isCarryForwardEligibleItem(
  item: Pick<typeof teamTrackerItems.$inferSelect, "state">
): boolean {
  return item.state === "planned" || item.state === "in_progress";
}

const ATTENTION_REASON_META: Record<
  TrackerAttentionReasonCode,
  { label: string; priority: number }
> = {
  blocked: { label: "Blocked", priority: 1 },
  stale_with_open_risk: { label: "Stale with risk", priority: 2 },
  overdue_linked_work: { label: "Overdue linked work", priority: 3 },
  at_risk: { label: "At Risk", priority: 4 },
  status_change_without_follow_up: { label: "Status changed, no follow-up", priority: 5 },
  stale_without_current_work: { label: "Stale without current work", priority: 6 },
  over_capacity: { label: "Over capacity", priority: 7 },
  stale_by_time: { label: "Stale by time", priority: 8 },
  no_current: { label: "No current item", priority: 9 },
  waiting: { label: "Waiting", priority: 10 },
};

function buildAttentionReasons(
  day: TrackerDeveloperDay
): TrackerAttentionReason[] {
  const reasons: TrackerAttentionReasonCode[] = [];

  if (day.status === "blocked") {
    reasons.push("blocked");
  }
  if (day.signals.freshness.staleWithOpenRisk) {
    reasons.push("stale_with_open_risk");
  }
  if (day.signals.risk.overdueLinkedWork) {
    reasons.push("overdue_linked_work");
  }
  if (day.status === "at_risk") {
    reasons.push("at_risk");
  }
  if (day.signals.freshness.statusChangeWithoutFollowUp) {
    reasons.push("status_change_without_follow_up");
  }
  if (day.signals.freshness.staleWithoutCurrentWork) {
    reasons.push("stale_without_current_work");
  }
  if (day.signals.risk.overCapacity) {
    reasons.push("over_capacity");
  }
  if (
    day.signals.freshness.staleByTime &&
    !day.signals.freshness.staleWithOpenRisk &&
    !day.signals.freshness.staleWithoutCurrentWork
  ) {
    reasons.push("stale_by_time");
  }
  if (!day.currentItem && day.status !== "done_for_today") {
    reasons.push("no_current");
  }
  if (day.status === "waiting") {
    reasons.push("waiting");
  }

  return reasons.map((code) => ({
    code,
    label: ATTENTION_REASON_META[code].label,
    priority: ATTENTION_REASON_META[code].priority,
  }));
}

function getAttentionSortTuple(item: TrackerAttentionItem): [number, number, number, string] {
  const highestPriority = item.reasons[0]?.priority ?? Number.MAX_SAFE_INTEGER;
  const lastCheckInTime = item.lastCheckInAt
    ? new Date(item.lastCheckInAt).getTime()
    : 0;

  return [
    highestPriority,
    -item.reasons.length,
    lastCheckInTime,
    item.developer.displayName.toLowerCase(),
  ];
}

function compareAttentionTuples(
  left: [number, number, number, string],
  right: [number, number, number, string]
): number {
  if (left[0] !== right[0]) {
    return left[0] - right[0];
  }
  if (left[1] !== right[1]) {
    return left[1] - right[1];
  }
  if (left[2] !== right[2]) {
    return left[2] - right[2];
  }

  return left[3].localeCompare(right[3]);
}

function getDeveloperAttentionSortTuple(
  day: TrackerDeveloperDay
): [number, number, number, string] {
  return getAttentionSortTuple({
    developer: day.developer,
    status: day.status,
    reasons: buildAttentionReasons(day),
    lastCheckInAt: day.lastCheckInAt,
    nextFollowUpAt: day.nextFollowUpAt,
    isStale: day.isStale,
    signals: day.signals,
    hasCurrentItem: Boolean(day.currentItem),
    currentItem: day.currentItem ? mapAttentionActionItem(day.currentItem) : undefined,
    plannedCount: day.plannedItems.length,
    availableQuickActions: getAttentionQuickActions(day),
    setCurrentCandidates: !day.currentItem
      ? day.plannedItems.map(mapAttentionActionItem)
      : [],
  });
}

function getLastActivityTimestamp(day: TrackerDeveloperDay): number {
  const source =
    day.lastCheckInAt ??
    day.statusUpdatedAt ??
    day.updatedAt ??
    day.createdAt;

  return new Date(source).getTime();
}

function matchesSummaryFilter(
  day: TrackerDeveloperDay,
  filter: TrackerBoardSummaryFilter
): boolean {
  switch (filter) {
    case "stale":
      return day.signals.freshness.staleByTime;
    case "blocked":
      return day.status === "blocked";
    case "at_risk":
      return day.status === "at_risk";
    case "waiting":
      return day.status === "waiting";
    case "overdue_linked":
      return day.signals.risk.overdueLinkedWork;
    case "over_capacity":
      return day.signals.risk.overCapacity;
    case "status_follow_up":
      return day.signals.freshness.statusChangeWithoutFollowUp;
    case "no_current":
      return !day.currentItem && day.status !== "done_for_today";
    case "done_for_today":
      return day.status === "done_for_today";
    case "all":
    default:
      return true;
  }
}

function matchesDaySearch(day: TrackerDeveloperDay, normalizedQuery: string): boolean {
  if (!normalizedQuery) {
    return true;
  }

  const haystacks = [
    day.developer.displayName,
    day.managerNotes,
    ...day.checkIns.map((checkIn) => checkIn.summary),
    ...(day.currentItem ? [day.currentItem] : []),
    ...day.plannedItems,
    ...day.completedItems,
    ...day.droppedItems,
  ]
    .flatMap((value) => {
      if (typeof value === "string" || value === undefined) {
        return [value];
      }

      return [
        value.title,
        value.jiraKey,
        ...(value.relatedIssueKeys ?? []),
        value.jiraSummary,
        value.note,
      ];
    })
    .filter((value): value is string => Boolean(value))
    .map((value) => value.toLowerCase());

  return haystacks.some((value) => value.includes(normalizedQuery));
}

function matchesInactiveDeveloperSearch(
  item: {
    developer: Developer;
    availability: { note?: string };
  },
  normalizedQuery: string
): boolean {
  if (!normalizedQuery) {
    return true;
  }

  const haystacks = [
    item.developer.displayName,
    item.availability.note,
  ]
    .filter((value): value is string => Boolean(value))
    .map((value) => value.toLowerCase());

  return haystacks.some((value) => value.includes(normalizedQuery));
}

function sortDeveloperDays(
  days: TrackerDeveloperDay[],
  sortBy: TeamTrackerBoardSort
): TrackerDeveloperDay[] {
  return [...days].sort((left, right) => {
    if (sortBy === "name") {
      return left.developer.displayName.localeCompare(right.developer.displayName);
    }

    if (sortBy === "attention") {
      return compareAttentionTuples(
        getDeveloperAttentionSortTuple(left),
        getDeveloperAttentionSortTuple(right)
      );
    }

    if (sortBy === "stale_age") {
      const timestampDiff = getLastActivityTimestamp(left) - getLastActivityTimestamp(right);
      if (timestampDiff !== 0) {
        return timestampDiff;
      }

      return left.developer.displayName.localeCompare(right.developer.displayName);
    }

    if (sortBy === "load") {
      const leftOpenCount = (left.currentItem ? 1 : 0) + left.plannedItems.length;
      const rightOpenCount = (right.currentItem ? 1 : 0) + right.plannedItems.length;
      const capacityDeltaDiff =
        right.signals.risk.capacityDelta - left.signals.risk.capacityDelta;

      if (capacityDeltaDiff !== 0) {
        return capacityDeltaDiff;
      }
      if (rightOpenCount !== leftOpenCount) {
        return rightOpenCount - leftOpenCount;
      }

      return left.developer.displayName.localeCompare(right.developer.displayName);
    }

    const statusDiff =
      BLOCKED_FIRST_STATUS_ORDER[left.status] - BLOCKED_FIRST_STATUS_ORDER[right.status];
    if (statusDiff !== 0) {
      return statusDiff;
    }

    const attentionDiff = compareAttentionTuples(
      getDeveloperAttentionSortTuple(left),
      getDeveloperAttentionSortTuple(right)
    );
    if (attentionDiff !== 0) {
      return attentionDiff;
    }

    return left.developer.displayName.localeCompare(right.developer.displayName);
  });
}

function buildDeveloperGroups(
  days: TrackerDeveloperDay[],
  groupBy: TeamTrackerBoardGroupBy
): TrackerDeveloperGroup[] {
  if (days.length === 0) {
    return [];
  }

  if (groupBy === "none") {
    return [
      {
        key: "all",
        label: "All Developers",
        count: days.length,
        developers: days,
      },
    ];
  }

  if (groupBy === "status") {
    const orderedStatuses: TrackerDeveloperStatus[] = [
      "blocked",
      "at_risk",
      "waiting",
      "on_track",
      "done_for_today",
    ];

    const groups: TrackerDeveloperGroup[] = [];
    for (const status of orderedStatuses) {
      const developers = days.filter((day) => day.status === status);
      if (developers.length === 0) {
        continue;
      }

      groups.push({
        key: status,
        label: TRACKER_STATUS_LABELS[status],
        count: developers.length,
        developers,
      });
    }

    return groups;
  }

  const needsAttention = days.filter((day) => buildAttentionReasons(day).length > 0);
  const stable = days.filter((day) => buildAttentionReasons(day).length === 0);
  const groups: TrackerDeveloperGroup[] = [];

  if (needsAttention.length > 0) {
    groups.push({
      key: "needs_attention",
      label: "Needs Attention",
      count: needsAttention.length,
      developers: needsAttention,
    });
  }

  if (stable.length > 0) {
    groups.push({
      key: "stable",
      label: "Stable",
      count: stable.length,
      developers: stable,
    });
  }

  return groups;
}

export class TeamTrackerService {
  constructor(
    private readonly settings = new SettingsService(),
    private readonly availability = new DeveloperAvailabilityService()
  ) {}

  private readonly taskKeys = new TaskKeysService();
  private readonly tasks = new TaskService();
  private readonly eventsService = new TaskEventsService(this.taskKeys);

  private async emit(row: { taskKey: string | null; workspaceId: string; id: number }, event: Omit<TaskEventInput, "taskKey" | "workspaceId">, actor: TaskEventActor = { type: "system" }): Promise<void> {
    if (row.taskKey && await this.taskKeys.enabled(row.workspaceId)) await this.eventsService.append({ ...event, taskKey: row.taskKey, workspaceId: row.workspaceId, sourceTable: "team_tracker_items", sourceId: row.id } as TaskEventInput, actor);
  }

  private async decorateDayEvents(days: TrackerDeveloperDay[], viewer: { kind: "manager" | "developer"; accountId: string; workspaceId: string }): Promise<void> {
    if (!(await this.taskKeys.enabled(viewer.workspaceId))) return;
    const items = days.flatMap((day) => [day.currentItem, ...day.plannedItems, ...day.completedItems, ...day.droppedItems]).filter((item): item is TrackerWorkItem => Boolean(item));
    const keys = [...new Set(items.map((item) => item.taskKey).filter((key): key is string => Boolean(key)))];
    const summaries = await this.eventsService.latestForKeys(keys, viewer);
    const origins = await this.taskKeys.canonicalEnabled(viewer.workspaceId)
      ? items.map((item) => ({ taskKey: item.taskKey ?? null, createdAt: item.createdAt }))
      : keys.length ? await db.select({ taskKey: teamTrackerItems.taskKey, createdAt: teamTrackerItems.createdAt }).from(teamTrackerItems).where(and(eq(teamTrackerItems.workspaceId, viewer.workspaceId), inArray(teamTrackerItems.taskKey, keys))) : [];
    const firstByKey = new Map<string, string>();
    for (const row of origins) if (row.taskKey && (!firstByKey.has(row.taskKey) || row.createdAt < firstByKey.get(row.taskKey)!)) firstByKey.set(row.taskKey, row.createdAt);
    const now = todayIsoDate();
    for (const item of items) if (item.taskKey) {
      item.latestEvent = summaries.get(item.taskKey);
      const first = firstByKey.get(item.taskKey);
      if (first) item.ageDays = Math.max(0, Math.round((Date.parse(`${now}T12:00:00Z`) - Date.parse(`${todayIsoDate(new Date(first))}T12:00:00Z`)) / 86400000));
    }
    const checkIns = days.flatMap((day) => [...day.checkIns, ...day.recentCheckIns]);
    const ids = [...new Set(checkIns.map((checkIn) => checkIn.id))];
    if (ids.length) {
      const refs = await db.select().from(checkinTaskRefs).where(and(eq(checkinTaskRefs.workspaceId, viewer.workspaceId), inArray(checkinTaskRefs.checkinId, ids)));
      for (const checkIn of checkIns) checkIn.taskKeys = refs.filter((ref) => ref.checkinId === checkIn.id).map((ref) => ref.taskKey);
    }
  }

  async getBoard(
    date: string,
    options?: {
      workspaceId?: string;
      managerAccountId?: string;
      query?: TeamTrackerBoardQuery;
    }
  ): Promise<TeamTrackerBoardResponse> {
    const workspaceId = normalizeWorkspaceId(options?.workspaceId);
    const query = await this.resolveBoardQuery(
      options?.managerAccountId,
      options?.query,
      workspaceId
    );
    const viewMode = getTrackerViewMode(date);
    const signalConfig = await this.getSignalConfig(workspaceId);
    const devRows = await db
      .select()
      .from(developers)
      .where(and(eq(developers.workspaceId, workspaceId), eq(developers.isActive, 1)));

    const devList: Developer[] = devRows.map(mapDeveloper);
    const availabilityByAccountId = await this.availability.getAvailabilityMapForDate(
      devList.map((dev) => dev.accountId),
      date,
      workspaceId
    );
    const activeDevelopers = devList
      .map((developer) => ({
        ...developer,
        availability: availabilityByAccountId.get(developer.accountId) ?? { state: "active" as const },
      }))
      .filter((developer) => developer.availability?.state !== "inactive");
    const inactiveDevelopers = devList
      .map((developer) => ({
        developer,
        availability: availabilityByAccountId.get(developer.accountId) ?? { state: "active" as const },
      }))
      .filter((item) => item.availability.state === "inactive")
      .sort((left, right) => left.developer.displayName.localeCompare(right.developer.displayName));

    const canonical = await this.taskKeys.canonicalEnabled(workspaceId);
    const viewer: TaskPrincipal = { type: "manager", accountId: options?.managerAccountId ?? "", workspaceId };
    const devDays = viewMode === "history"
      ? await Promise.all(
          activeDevelopers.map((developer) =>
            this.buildHistoricalDeveloperDay(date, developer, signalConfig, workspaceId, viewer)
          )
        )
      : await this.buildLiveDeveloperDays(date, activeDevelopers, signalConfig, workspaceId, viewer);
    await this.decorateDayEvents(devDays, { kind: "manager", accountId: options?.managerAccountId ?? "", workspaceId });

    const summary = this.computeSummary(devDays);
    const normalizedQuery = query.q.toLowerCase();
    const visibleDevelopers = sortDeveloperDays(
      devDays.filter(
        (day) =>
          matchesSummaryFilter(day, query.summaryFilter) &&
          matchesDaySearch(day, normalizedQuery)
      ),
      query.sortBy
    );
    const visibleSummary = this.computeSummary(visibleDevelopers);
    const groups = buildDeveloperGroups(visibleDevelopers, query.groupBy);
    const filteredInactiveDevelopers = inactiveDevelopers.filter((item) =>
      matchesInactiveDeveloperSearch(item, normalizedQuery)
    );
    const attentionQueue =
      viewMode === "history" ? [] : this.computeAttentionQueue(visibleDevelopers);

    return {
      date,
      viewMode,
      ...(canonical && { taskModel: "canonical" as const }),
      developers: visibleDevelopers,
      inactiveDevelopers: filteredInactiveDevelopers,
      summary,
      visibleSummary,
      groups,
      query,
      attentionQueue,
    };
  }

  async listSavedViews(managerAccountId: string, workspaceId?: string): Promise<TeamTrackerSavedView[]> {
    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    const rows = await db
      .select()
      .from(teamTrackerSavedViews)
      .where(and(eq(teamTrackerSavedViews.workspaceId, normalizedWorkspaceId), eq(teamTrackerSavedViews.managerAccountId, managerAccountId)));

    return rows
      .sort(
        (left, right) =>
          right.updatedAt.localeCompare(left.updatedAt) || right.id - left.id
      )
      .map(mapSavedView);
  }

  async createSavedView(
    managerAccountId: string,
    input: TeamTrackerSavedViewInput,
    workspaceId?: string
  ): Promise<TeamTrackerSavedView> {
    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    const name = input.name.trim();
    if (!name) {
      throw new HttpError(400, "name is required");
    }

    await this.assertSavedViewNameAvailable(managerAccountId, name, undefined, normalizedWorkspaceId);

    const now = nowIso();
    const query = this.normalizeSavedViewQuery(input);
    const inserted = await db
      .insert(teamTrackerSavedViews)
      .values({
        workspaceId: normalizedWorkspaceId,
        managerAccountId,
        name,
        searchQuery: query.q || null,
        summaryFilter: query.summaryFilter,
        sortBy: query.sortBy,
        groupBy: query.groupBy,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    return mapSavedView(inserted[0]!);
  }

  async updateSavedView(
    managerAccountId: string,
    viewId: number,
    input: TeamTrackerSavedViewUpdate,
    workspaceId?: string
  ): Promise<TeamTrackerSavedView> {
    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    const existing = await this.getOwnedSavedViewRow(managerAccountId, viewId, normalizedWorkspaceId);
    const nextName =
      input.name !== undefined ? input.name.trim() : existing.name;

    if (!nextName) {
      throw new HttpError(400, "name is required");
    }

    await this.assertSavedViewNameAvailable(managerAccountId, nextName, viewId, normalizedWorkspaceId);

    const merged = this.normalizeSavedViewQuery({
      q: input.q !== undefined ? input.q : existing.searchQuery ?? "",
      summaryFilter:
        input.summaryFilter !== undefined
          ? input.summaryFilter
          : (existing.summaryFilter as TrackerBoardSummaryFilter),
      sortBy:
        input.sortBy !== undefined
          ? input.sortBy
          : (existing.sortBy as TeamTrackerBoardSort),
      groupBy:
        input.groupBy !== undefined
          ? input.groupBy
          : (existing.groupBy as TeamTrackerBoardGroupBy),
    });

    const now = nowIso();
    await db
      .update(teamTrackerSavedViews)
      .set({
        name: nextName,
        searchQuery: merged.q || null,
        summaryFilter: merged.summaryFilter,
        sortBy: merged.sortBy,
        groupBy: merged.groupBy,
        updatedAt: now,
      })
      .where(eq(teamTrackerSavedViews.id, viewId));

    const updated = await this.getOwnedSavedViewRow(managerAccountId, viewId, normalizedWorkspaceId);
    return mapSavedView(updated);
  }

  async deleteSavedView(managerAccountId: string, viewId: number, workspaceId?: string): Promise<void> {
    await this.getOwnedSavedViewRow(managerAccountId, viewId, workspaceId);

    await db
      .delete(teamTrackerSavedViews)
      .where(eq(teamTrackerSavedViews.id, viewId));
  }

  async resolveBoardQuery(
    managerAccountId: string | undefined,
    rawQuery?: TeamTrackerBoardQuery,
    workspaceId?: string
  ): Promise<TeamTrackerBoardResolvedQuery> {
    const normalizedRawQuery = rawQuery ?? {};

    if (!normalizedRawQuery.viewId) {
      return resolveUnsavedBoardQuery(normalizedRawQuery);
    }

    if (!managerAccountId) {
      throw new HttpError(400, "managerAccountId is required when resolving a saved view");
    }

    const savedView = await this.getOwnedSavedViewRow(
      managerAccountId,
      normalizedRawQuery.viewId,
      workspaceId
    );

    return {
      q:
        normalizedRawQuery.q !== undefined
          ? normalizeBoardSearchQuery(normalizedRawQuery.q)
          : savedView.searchQuery ?? "",
      summaryFilter:
        normalizedRawQuery.summaryFilter ??
        (savedView.summaryFilter as TrackerBoardSummaryFilter),
      sortBy:
        normalizedRawQuery.sortBy ??
        (savedView.sortBy as TeamTrackerBoardSort),
      groupBy:
        normalizedRawQuery.groupBy ??
        (savedView.groupBy as TeamTrackerBoardGroupBy),
      viewId: savedView.id,
    };
  }

  async getDeveloperDay(
    date: string,
    developerAccountId: string,
    options?: { includeManagerNotes?: boolean },
    workspaceId?: string
  ): Promise<TrackerDeveloperDay> {
    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    const signalConfig = await this.getSignalConfig(normalizedWorkspaceId);
    const developer = await this.getDeveloperByAccountId(developerAccountId, normalizedWorkspaceId);
    const availability = await this.availability.getAvailabilityForDate(developerAccountId, date, normalizedWorkspaceId);
    const day = await this.buildDeveloperDay(
      date,
      {
        ...developer,
        availability,
      },
      signalConfig,
      normalizedWorkspaceId
    );

    if (options?.includeManagerNotes === false) {
      return {
        ...day,
        managerNotes: undefined,
      };
    }

    return day;
  }

  async getDeveloperDayView(
    date: string,
    developerAccountId: string,
    options: { viewer: { kind: "manager" | "developer"; accountId: string } },
    workspaceId?: string
  ): Promise<DeveloperDayView> {
    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    const viewMode = getMyDayViewMode(date);
    const signalConfig = await this.getSignalConfig(normalizedWorkspaceId);
    const developer = await this.getDeveloperByAccountId(developerAccountId, normalizedWorkspaceId);
    const availability = await this.availability.getAvailabilityForDate(developerAccountId, date, normalizedWorkspaceId);
    const developerWithAvailability = {
      ...developer,
      availability,
    };
    const viewer: TaskPrincipal = { type: options.viewer.kind, accountId: options.viewer.accountId, workspaceId: normalizedWorkspaceId };
    const day =
      viewMode === "live"
        ? await this.buildLiveDeveloperDay(
            date,
            developerWithAvailability,
            signalConfig,
            normalizedWorkspaceId,
            viewer
          )
        : await this.buildHistoricalDeveloperDay(
            date,
            developerWithAvailability,
            signalConfig,
            normalizedWorkspaceId,
            viewer
          );
    await this.decorateDayEvents([day], { ...options.viewer, workspaceId: normalizedWorkspaceId });

    return {
      viewMode,
      day:
        options.viewer.kind === "developer"
          ? {
              ...day,
              managerNotes: undefined,
            }
          : day,
    };
  }

  async getAvailabilityForDate(accountId: string, date: string, workspaceId?: string) {
    return this.availability.getAvailabilityForDate(accountId, date, workspaceId);
  }

  async updateAvailability(
    accountId: string,
    params: {
      effectiveDate: string;
      state: "active" | "inactive";
      note?: string;
    },
    workspaceId?: string
  ) {
    return this.availability.setAvailability({ accountId, workspaceId, ...params });
  }

  async ensureDay(
    date: string,
    developerAccountId: string,
    workspaceId?: string
  ): Promise<typeof teamTrackerDays.$inferSelect> {
    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    const now = nowIso();
    const priorDay =
      date === localTodayIso()
        ? await this.findLatestPriorDay(date, developerAccountId, normalizedWorkspaceId)
        : undefined;
    const seededStatus = getSeededStatus(priorDay?.status);
    await db
      .insert(teamTrackerDays)
      .values({
        workspaceId: normalizedWorkspaceId,
        date,
        developerAccountId,
        status: seededStatus,
        capacityUnits: priorDay?.capacityUnits ?? null,
        managerNotes: priorDay?.managerNotes ?? null,
        nextFollowUpAt: priorDay?.nextFollowUpAt ?? null,
        statusUpdatedAt:
          seededStatus === priorDay?.status && priorDay?.statusUpdatedAt
            ? priorDay.statusUpdatedAt
            : now,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing({
        target: [teamTrackerDays.workspaceId, teamTrackerDays.date, teamTrackerDays.developerAccountId],
      });

    const rows = await db
      .select()
      .from(teamTrackerDays)
      .where(
        and(
          eq(teamTrackerDays.date, date),
          eq(teamTrackerDays.workspaceId, normalizedWorkspaceId),
          eq(teamTrackerDays.developerAccountId, developerAccountId)
        )
      )
      .limit(1);

    if (!rows[0]) {
      throw new Error(
        `Failed to initialize tracker day for ${developerAccountId} on ${date}`
      );
    }

    return rows[0];
  }

  async updateDay(
    accountId: string,
    date: string,
    updates: {
      status?: TrackerDeveloperStatus;
      capacityUnits?: number | null;
      managerNotes?: string;
    },
    workspaceId?: string
  ): Promise<typeof teamTrackerDays.$inferSelect> {
    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    await this.availability.assertAvailableForDate(accountId, date, normalizedWorkspaceId);
    const day = await this.ensureDay(date, accountId, normalizedWorkspaceId);
    const now = nowIso();
    const canonical = await this.taskKeys.canonicalEnabled(normalizedWorkspaceId);
    if (canonical && updates.managerNotes !== undefined) {
      await db.insert(developerNotes).values({ workspaceId: normalizedWorkspaceId, developerAccountId: accountId, body: updates.managerNotes, updatedAt: now })
        .onConflictDoUpdate({ target: [developerNotes.workspaceId, developerNotes.developerAccountId], set: { body: updates.managerNotes, updatedAt: now } });
    }
    const nextStatus = updates.status;
    const statusChanged =
      nextStatus !== undefined && nextStatus !== day.status;

    await db
      .update(teamTrackerDays)
      .set({
        ...(nextStatus !== undefined && { status: nextStatus }),
        ...(statusChanged && { statusUpdatedAt: now }),
        ...(updates.capacityUnits !== undefined && {
          capacityUnits: updates.capacityUnits,
        }),
        ...(!canonical && updates.managerNotes !== undefined && {
          managerNotes: updates.managerNotes,
        }),
        updatedAt: now,
      })
      .where(eq(teamTrackerDays.id, day.id));

    const updated = await db
      .select()
      .from(teamTrackerDays)
      .where(eq(teamTrackerDays.id, day.id))
      .limit(1);
    return updated[0]!;
  }

  async addItem(
    accountId: string,
    date: string,
    params: {
      jiraKey?: string;
      relatedIssueKeys?: string[];
      title: string;
      note?: string;
      managerDeskItemId?: number;
      actor?: TaskEventActor;
      source?: "tracker" | "my_day" | "note" | "copilot" | "today";
    },
    workspaceId?: string
  ): Promise<TrackerWorkItem> {
    return runInTransaction(async () => {
    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    await this.availability.assertAvailableForDate(accountId, date, normalizedWorkspaceId);
    const day = await this.ensureDay(date, accountId, normalizedWorkspaceId);
    if (await this.taskKeys.canonicalEnabled(normalizedWorkspaceId)) {
      const actor = this.tasks.principal(normalizedWorkspaceId, params.actor);
      if (params.note !== undefined) await this.taskKeys.assertLegacyFieldsAllowed(normalizedWorkspaceId);
      const task = await this.tasks.create(actor.type === "developer" ? { title: params.title, scheduledOn: date } : { title: params.title, ownerType: "developer", ownerId: accountId, scheduledOn: date }, actor);
      const issueKeys = normalizeJiraIssueKeys([params.jiraKey ?? "", ...(params.relatedIssueKeys ?? [])]);
      for (const [index, ref] of issueKeys.entries()) {
        await this.tasks.addLink(task.taskKey, { kind: "jira", ref, role: index === 0 ? "primary" : "related" }, { ...actor, type: "manager" });
      }
      if (params.note?.trim()) await this.eventsService.append({ workspaceId: normalizedWorkspaceId, taskKey: task.taskKey, type: "update", body: params.note, meta: { via: "note_field" } }, params.actor!);
      return surfaceTaskToWorkItem(await this.tasks.surfaceDto(task, { date, principal: actor }));
    }
    const { jiraKey, relatedIssueKeys, allIssueKeys } = resolveTrackerIssueKeys({
      jiraKey: params.jiraKey,
      relatedIssueKeys: params.relatedIssueKeys,
    });
    await this.assertIssueKeysAvailable(allIssueKeys, normalizedWorkspaceId);

    // Get next position
    const existing = await db
      .select()
      .from(teamTrackerItems)
      .where(eq(teamTrackerItems.dayId, day.id));
    const maxPosition = existing.reduce(
      (max, i) => Math.max(max, i.position),
      -1
    );

    const now = nowIso();
    const desk = params.managerDeskItemId ? (await db.select({ taskKey: managerDeskItems.taskKey }).from(managerDeskItems).where(and(eq(managerDeskItems.workspaceId, normalizedWorkspaceId), eq(managerDeskItems.id, params.managerDeskItemId))).limit(1))[0] : undefined;
    if (params.managerDeskItemId && !desk) throw new HttpError(404, "Manager Desk item not found");
    const taskKey = await this.taskKeys.enabled(normalizedWorkspaceId) ? desk?.taskKey ?? this.taskKeys.allocate(normalizedWorkspaceId) : null;
    const actor = params.actor ?? { type: "system" as const };
    const inserted = await db
      .insert(teamTrackerItems)
      .values({
        workspaceId: normalizedWorkspaceId,
        dayId: day.id,
        managerDeskItemId: params.managerDeskItemId ?? null,
        taskKey,
        createdByType: params.source === "note" || params.source === "today" ? params.source : params.actor?.type ?? "unknown",
        createdById: params.actor?.accountId ?? null,
        itemType: jiraKey ? "jira" : "custom",
        jiraKey: jiraKey ?? null,
        relatedJiraKeys: serializeRelatedIssueKeys(relatedIssueKeys),
        title: params.title,
        state: "planned",
        position: maxPosition + 1,
        note: params.note ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    await this.emit(inserted[0]!, { type: "created", body: null, meta: { source: params.source ?? "tracker", ownerType: "developer", ownerId: accountId, title: params.title, ...(allIssueKeys.length && { jiraKeys: allIssueKeys }) } }, { type: "system", accountId: actor.accountId });
    if (params.note?.trim()) await this.emit(inserted[0]!, { type: "update", body: params.note, meta: { via: "note_field" } }, actor);
    return this.getItemById(inserted[0]!.id, normalizedWorkspaceId);
    });
  }

  async syncManagerDeskItem(params: {
    workspaceId?: string;
    managerDeskItemId: number;
    assigneeDeveloperAccountId?: string | null;
    date: string;
    title: string;
    issueKeys: string[];
    note?: string | null;
    outcome?: "done" | "dropped";
    reopened?: boolean;
    actor?: TaskEventActor;
  }): Promise<void> {
    return runInTransaction(async () => {
    const workspaceId = normalizeWorkspaceId(params.workspaceId);
    const system: TaskEventActor = { type: "system", accountId: params.actor?.accountId };
    const existing = await this.getManagerDeskTrackerItem(params.managerDeskItemId, workspaceId);
    const desk = (await db.select({ taskKey: managerDeskItems.taskKey }).from(managerDeskItems).where(and(eq(managerDeskItems.workspaceId, workspaceId), eq(managerDeskItems.id, params.managerDeskItemId))).limit(1))[0];

    if (params.outcome) {
      if (!existing) {
        return;
      }
      const nextState = params.outcome;
      if (existing.state !== nextState) {
        const now = nowIso();
        const setFields: Record<string, unknown> = {
          state: nextState,
          updatedAt: now,
        };
        if (nextState === "done" && existing.state !== "done") {
          setFields.completedAt = now;
        }
        await db
          .update(teamTrackerItems)
          .set(setFields)
          .where(eq(teamTrackerItems.id, existing.id));
        await this.emit(existing, { type: "status", body: null, meta: { domain: "tracker_state", from: existing.state, to: nextState, reason: "desk_sync" } }, system);
      }
      return;
    }

    if (!params.assigneeDeveloperAccountId) {
      if (existing) {
        await db
          .update(teamTrackerItems)
          .set({ state: "dropped", updatedAt: nowIso() })
          .where(eq(teamTrackerItems.id, existing.id));
        if (existing.state !== "dropped") await this.emit(existing, { type: "status", body: null, meta: { domain: "tracker_state", from: existing.state, to: "dropped", reason: "desk_sync" } }, system);
      }
      return;
    }

    await this.getDeveloperByAccountId(params.assigneeDeveloperAccountId, workspaceId);

    const normalizedIssueKeys = normalizeJiraIssueKeys(params.issueKeys);
    const jiraKey = normalizedIssueKeys[0];
    const relatedIssueKeys = normalizedIssueKeys.slice(1);
    await this.assertIssueKeysAvailable(normalizedIssueKeys, workspaceId);

    if (existing) {
      await this.availability.assertAvailableForDate(
        params.assigneeDeveloperAccountId,
        params.date,
        workspaceId
      );
      const targetDay = await this.ensureDay(
        params.date,
        params.assigneeDeveloperAccountId,
        workspaceId
      );
      const now = nowIso();
      const oldDay = await this.getDayById(existing.dayId, workspaceId);
      const setFields: Record<string, unknown> = {
        taskKey: desk?.taskKey ?? existing.taskKey,
        itemType: jiraKey ? "jira" : "custom",
        jiraKey: jiraKey ?? null,
        relatedJiraKeys: serializeRelatedIssueKeys(relatedIssueKeys),
        title: params.title,
        updatedAt: now,
      };

      if (existing.dayId !== targetDay.id) {
        setFields.dayId = targetDay.id;
        const targetRows = await db
          .select({ position: teamTrackerItems.position })
          .from(teamTrackerItems)
          .where(eq(teamTrackerItems.dayId, targetDay.id));
        setFields.position =
          targetRows.reduce((max, row) => Math.max(max, row.position), -1) + 1;
      }

      if (params.reopened && (existing.state === "done" || existing.state === "dropped")) {
        setFields.state = "planned";
        setFields.completedAt = null;
      }

      await db
        .update(teamTrackerItems)
        .set(setFields)
        .where(eq(teamTrackerItems.id, existing.id));
      const keyed = { ...existing, taskKey: desk?.taskKey ?? existing.taskKey };
      const resetTo = setFields.state !== undefined && setFields.state !== existing.state ? String(setFields.state) : null;
      if (oldDay?.developerAccountId !== params.assigneeDeveloperAccountId) await this.emit(keyed, { type: "assign", body: null, meta: { fromType: "developer", fromId: oldDay?.developerAccountId ?? null, toType: "developer", toId: params.assigneeDeveloperAccountId, ...(resetTo && { stateReset: { from: existing.state, to: resetTo } }) } }, system);
      if (oldDay?.date !== params.date) await this.emit(keyed, { type: "schedule", body: null, meta: { field: "day", from: oldDay?.date ?? null, to: params.date, via: "reschedule" } }, system);
      if (existing.title !== params.title) await this.emit(keyed, { type: "title", body: null, meta: { from: existing.title, to: params.title } }, system);
      if (setFields.state && setFields.state !== existing.state) await this.emit(keyed, { type: "status", body: null, meta: { domain: "tracker_state", from: existing.state, to: String(setFields.state), reason: "desk_sync" } }, system);
      return;
    }

    await this.addItem(params.assigneeDeveloperAccountId, params.date, {
      jiraKey,
      relatedIssueKeys,
      title: params.title,
      note: params.note ?? undefined,
      managerDeskItemId: params.managerDeskItemId,
      actor: params.actor,
    }, workspaceId);
    });
  }

  async unlinkManagerDeskItem(managerDeskItemId: number, workspaceId?: string): Promise<void> {
    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    const existing = await this.getManagerDeskTrackerItem(managerDeskItemId, normalizedWorkspaceId);
    if (!existing) {
      return;
    }

    await db
      .update(teamTrackerItems)
      .set({
        managerDeskItemId: null,
        updatedAt: nowIso(),
      })
      .where(eq(teamTrackerItems.id, existing.id));
  }

  async cancelManagerDeskItem(managerDeskItemId: number, workspaceId?: string, actor: TaskEventActor = { type: "system" }): Promise<boolean> {
    return runInTransaction(async () => {
    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    const existing = await this.getManagerDeskTrackerItem(managerDeskItemId, normalizedWorkspaceId);
    if (!existing) {
      return false;
    }

    await db
      .update(teamTrackerItems)
      .set({ state: "dropped", updatedAt: nowIso() })
      .where(eq(teamTrackerItems.id, existing.id));
    if (existing.state !== "dropped") await this.emit(existing, { type: "status", body: null, meta: { domain: "tracker_state", from: existing.state, to: "dropped", reason: "desk_sync" } }, { type: "system", accountId: actor.accountId });
    return true;
    });
  }

  async updateItem(
    itemId: number,
    updates: {
      title?: string;
      state?: TrackerItemState;
      note?: string | null;
      position?: number;
    },
    workspaceId?: string,
    actor: TaskEventActor = { type: "system" }
  ): Promise<TrackerWorkItem> {
    return runInTransaction(async () => {
    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    if (await this.taskKeys.canonicalEnabled(normalizedWorkspaceId)) {
      const principal = this.tasks.principal(normalizedWorkspaceId, actor);
      const task = await this.tasks.resolve("team_tracker_items", itemId, normalizedWorkspaceId);
      if (updates.note !== undefined) await this.taskKeys.assertLegacyFieldsAllowed(normalizedWorkspaceId);
      const status = updates.state === "in_progress" ? "active" : updates.state === "planned" ? "open" : updates.state;
      const updated = await this.tasks.update(task.taskKey, { ...(updates.title !== undefined && { title: updates.title }), ...(status && { status: status as TaskStatus }) }, principal);
      if (updates.position !== undefined && updated.ownerId) {
        await db.update(dayFocus).set({ position: updates.position }).where(and(eq(dayFocus.workspaceId, normalizedWorkspaceId), eq(dayFocus.taskId, task.id), eq(dayFocus.ownerId, updated.ownerId), eq(dayFocus.date, todayIsoDate())));
      }
      if (updates.note?.trim()) await this.eventsService.append({ workspaceId: normalizedWorkspaceId, taskKey: task.taskKey, type: "update", body: updates.note, meta: { via: "note_field" } }, actor);
      return surfaceTaskToWorkItem(await this.tasks.surfaceDto(updated, { date: todayIsoDate(), principal }));
    }
    const existing = await this.getItemRow(itemId, normalizedWorkspaceId);
    if (existing.managerDeskItemId !== null && updates.title !== undefined) {
      throw new HttpError(409, "Linked delegated tasks must be renamed from Manager Desk");
    }

    const now = nowIso();
    const setFields: Record<string, unknown> = { updatedAt: now };
    const linkedManagerDeskItemIds = new Set<number>();

    if (updates.title !== undefined) setFields.title = updates.title;
    if (updates.note !== undefined) {
      setFields.note = updates.note;
      if (existing.managerDeskItemId !== null) {
        linkedManagerDeskItemIds.add(existing.managerDeskItemId);
      }
    }
    if (updates.state !== undefined) {
      if (updates.state === "in_progress") {
        const currentDay = await this.getDayById(existing.dayId, normalizedWorkspaceId);
        if (!currentDay) {
          throw new Error(`Tracker day ${existing.dayId} was not found`);
        }

        for (const managerDeskItemId of await this.setSingleInProgressForDay(
          currentDay.developerAccountId,
          currentDay.id,
          itemId,
          now,
          undefined,
          normalizedWorkspaceId,
          actor
        )) {
          linkedManagerDeskItemIds.add(managerDeskItemId);
        }
      }
      setFields.state = updates.state;
      if (updates.state === "done") {
        setFields.completedAt = now;
      } else {
        setFields.completedAt = null;
      }
      if (existing.managerDeskItemId !== null) {
        linkedManagerDeskItemIds.add(existing.managerDeskItemId);
      }
    }

    if (updates.position !== undefined) {
      await this.reorderItem(existing, updates.position, now);
    }

    if (Object.keys(setFields).length > 1) {
      await db
        .update(teamTrackerItems)
        .set(setFields)
        .where(eq(teamTrackerItems.id, itemId));
    }

    if (linkedManagerDeskItemIds.size > 0) {
      await this.touchManagerDeskItems([...linkedManagerDeskItemIds], now);
    }
    if (updates.title !== undefined && updates.title !== existing.title) await this.emit(existing, { type: "title", body: null, meta: { from: existing.title, to: updates.title } }, { type: "system", accountId: actor.accountId });
    if (updates.note?.trim() && updates.note !== existing.note) await this.emit(existing, { type: "update", body: updates.note, meta: { via: "note_field" } }, actor);
    if (updates.state !== undefined && updates.state !== existing.state) {
      await this.emit(existing, { type: "status", body: null, meta: { domain: "tracker_state", from: existing.state, to: updates.state, reason: "user" } }, { type: "system", accountId: actor.accountId });
      if (updates.state === "in_progress") {
        const day = await this.getDayById(existing.dayId, normalizedWorkspaceId);
        if (day) await this.emit(existing, { type: "focus", body: null, meta: { action: "set_current", date: day.date } }, { type: "system", accountId: actor.accountId });
      }
    }

    return this.getItemById(itemId, normalizedWorkspaceId);
    });
  }

  async reassignItem(itemId: number, toAccountId: string, date: string, requestId: string, workspaceId?: string, actorId?: string): Promise<TrackerWorkItem> {
    return runInTransaction(async () => {
      const scope = normalizeWorkspaceId(workspaceId);
      if (await this.taskKeys.canonicalEnabled(scope)) {
        const task = await this.tasks.resolve("team_tracker_items", itemId, scope);
        const principal = this.tasks.principal(scope, undefined, actorId);
        const updated = await this.tasks.update(task.taskKey, { ownerType: "developer", ownerId: toAccountId, scheduledOn: date }, principal);
        return surfaceTaskToWorkItem(await this.tasks.surfaceDto(updated, { date, principal }));
      }
      await this.taskKeys.assertEnabled(scope);
      const item = await this.getItemRow(itemId, scope);
      const replay = await this.eventsService.getByRequestId(requestId, { kind: "manager", accountId: actorId ?? "", workspaceId: scope });
      if (replay) {
        const day = await this.getDayById(item.dayId, scope);
        if (replay.sourceId !== itemId || replay.event.taskKey !== item.taskKey || !(["assign", "schedule"] as string[]).includes(replay.event.type) || day?.developerAccountId !== toAccountId || day.date !== date) throw new HttpError(409, "requestId was already used with a different payload");
        return this.getItemById(itemId, scope);
      }
      if (item.managerDeskItemId !== null) throw new HttpError(409, "Reassign delegated tasks from Manager Desk");
      if (item.state === "done" || item.state === "dropped") throw new HttpError(409, "Reopen closed work before reassigning");
      await this.availability.assertAvailableForDate(toAccountId, date, scope);
      const oldDay = await this.getDayById(item.dayId, scope);
      if (!oldDay) throw new HttpError(404, "Tracker day not found");
      if (oldDay.developerAccountId === toAccountId && oldDay.date === date) return this.getItemById(itemId, scope);
      const day = await this.ensureDay(date, toAccountId, scope);
      const siblings = await db.select({ position: teamTrackerItems.position }).from(teamTrackerItems).where(eq(teamTrackerItems.dayId, day.id));
      const position = siblings.reduce((max, sibling) => Math.max(max, sibling.position), -1) + 1;
      const state = item.state === "in_progress" ? "planned" : item.state;
      await db.update(teamTrackerItems).set({ dayId: day.id, position, state, updatedAt: nowIso() }).where(eq(teamTrackerItems.id, itemId));
      if (oldDay.developerAccountId !== toAccountId) await this.emit(item, { type: "assign", body: null, meta: { fromType: "developer", fromId: oldDay.developerAccountId, toType: "developer", toId: toAccountId, ...(state !== item.state && { stateReset: { from: item.state, to: state } }) }, requestId }, { type: "system", accountId: actorId });
      if (oldDay.date !== date) await this.emit(item, { type: "schedule", body: null, meta: { field: "day", from: oldDay.date, to: date, via: "reassign" }, ...((oldDay.developerAccountId === toAccountId) && { requestId }) }, { type: "system", accountId: actorId });
      if (state !== item.state) await this.emit(item, { type: "status", body: null, meta: { domain: "tracker_state", from: item.state, to: state, reason: "reassigned" } }, { type: "system", accountId: actorId });
      return this.getItemById(itemId, scope);
    });
  }

  async deleteItem(
    itemId: number,
    options?: { allowLinkedManagerDeskDelete?: boolean },
    workspaceId?: string,
    actor: TaskEventActor = { type: "system" }
  ): Promise<void> {
    return runInTransaction(async () => {
    if (await this.taskKeys.canonicalEnabled(workspaceId)) {
      const task = await this.tasks.resolve("team_tracker_items", itemId, workspaceId);
      await this.tasks.remove(task.taskKey, this.tasks.principal(workspaceId, actor));
      return;
    }
    const existing = await this.getItemRow(itemId, workspaceId);
    if (existing.managerDeskItemId !== null && !options?.allowLinkedManagerDeskDelete) {
      throw new HttpError(
        409,
        "Linked delegated tasks cannot be deleted; mark them dropped instead"
      );
    }

    await this.emit(existing, { type: "status", body: null, meta: { domain: "tracker_state", from: existing.state, to: "deleted", reason: "user" } }, { type: "system", accountId: actor.accountId });
    await db
      .delete(teamTrackerItems)
      .where(eq(teamTrackerItems.id, itemId));
    });
  }

  async setCurrentItem(itemId: number, options: { ifNoCurrent?: boolean } = {}, workspaceId?: string, actor: TaskEventActor = { type: "system" }): Promise<TrackerWorkItem> {
    return runInTransaction(async () => {
    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    if (await this.taskKeys.canonicalEnabled(normalizedWorkspaceId)) {
      const task = await this.tasks.resolve("team_tracker_items", itemId, normalizedWorkspaceId);
      const principal = this.tasks.principal(normalizedWorkspaceId, actor);
      const updated = await this.tasks.setCurrent(task.taskKey, principal, options.ifNoCurrent);
      return surfaceTaskToWorkItem(await this.tasks.surfaceDto(updated, { date: todayIsoDate(), principal }));
    }
    const item = await this.getItemRow(itemId, normalizedWorkspaceId);
    const day = await this.getDayById(item.dayId, normalizedWorkspaceId);
    if (!day) {
      throw new Error(`Tracker day ${item.dayId} was not found`);
    }
    const now = nowIso();

    const linkedManagerDeskItemIds = await this.setSingleInProgressForDay(
      day.developerAccountId,
      day.id,
      itemId,
      now,
      options,
      normalizedWorkspaceId,
      actor
    );
    if (linkedManagerDeskItemIds.length > 0) {
      await this.touchManagerDeskItems(linkedManagerDeskItemIds, now);
    }

    const updated = await db
      .select()
      .from(teamTrackerItems)
      .where(eq(teamTrackerItems.id, itemId))
      .limit(1);

    if (!updated[0]) throw new Error("Item not found after update");
    if (item.state !== "in_progress") await this.emit(item, { type: "status", body: null, meta: { domain: "tracker_state", from: item.state, to: "in_progress", reason: "user" } }, { type: "system", accountId: actor.accountId });
    await this.emit(item, { type: "focus", body: null, meta: { action: "set_current", date: day.date } }, { type: "system", accountId: actor.accountId });
    return this.getItemById(updated[0].id, normalizedWorkspaceId);
    });
  }

  async addCheckIn(
    accountId: string,
    date: string,
    params: {
      summary: string;
      status?: TrackerDeveloperStatus;
      rationale?: string;
      nextFollowUpAt?: string | null;
      taskKeys?: string[];
    },
    actor?: {
      type: UserRole;
      accountId?: string;
    },
    workspaceId?: string
  ): Promise<TrackerCheckIn> {
    return runInTransaction(async () => {
    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    await this.availability.assertAvailableForDate(accountId, date, normalizedWorkspaceId);
    const day = await this.ensureDay(date, accountId, normalizedWorkspaceId);
    const now = nowIso();
    const summary = params.summary.trim();
    const rationale = normalizeOptionalText(params.rationale);
    const nextFollowUpAt = params.nextFollowUpAt ?? null;

    if (!summary) {
      throw new HttpError(400, "summary is required");
    }

    const inserted = await db
      .insert(teamTrackerCheckIns)
      .values({
        workspaceId: normalizedWorkspaceId,
        dayId: day.id,
        summary,
        status: params.status ?? null,
        rationale: rationale ?? null,
        nextFollowUpAt,
        authorType: actor?.type ?? "manager",
        authorAccountId: actor?.accountId ?? null,
        createdAt: now,
      })
      .returning();

    const checkInRow = inserted[0]!;

    // Update last check-in time on the day row
    const dayUpdates: Record<string, unknown> = {
      lastCheckInAt: now,
      nextFollowUpAt,
      updatedAt: now,
    };
    if (params.status) {
      dayUpdates.status = params.status;
      if (params.status !== day.status) {
        dayUpdates.statusUpdatedAt = now;
      }
    }
    await db
      .update(teamTrackerDays)
      .set(dayUpdates)
      .where(eq(teamTrackerDays.id, day.id));

    const taskKeys = new Set<string>();
    if (await this.taskKeys.enabled(normalizedWorkspaceId)) {
      for (const raw of params.taskKeys ?? []) {
        if (!TASK_KEY_PATTERN.test(raw)) throw new HttpError(400, "Invalid task key");
        const key = await this.taskKeys.resolve(normalizedWorkspaceId, raw);
        if (!key) throw new HttpError(400, "Unknown task key");
        try {
          const task = await this.taskKeys.resolveTask(normalizedWorkspaceId, key);
          if (task.deleted) throw new HttpError(400, "Deleted task key");
          if (actor?.type === "developer") await this.eventsService.list(key, { kind: "developer", accountId, workspaceId: normalizedWorkspaceId }, { limit: 1 });
        } catch {
          throw new HttpError(400, "Unknown or unowned task key");
        }
        taskKeys.add(key);
      }
      for (const match of summary.matchAll(/\bT-\d{1,9}\b/gi)) {
        const key = await this.taskKeys.resolve(normalizedWorkspaceId, match[0]);
        if (!key || taskKeys.has(key)) continue;
        try {
          const task = await this.taskKeys.resolveTask(normalizedWorkspaceId, key);
          if (task.deleted) continue;
          if (actor?.type === "developer") await this.eventsService.list(key, { kind: "developer", accountId, workspaceId: normalizedWorkspaceId }, { limit: 1 });
          taskKeys.add(key);
        } catch { continue; }
      }
      for (const key of taskKeys) {
        const taskId = await this.taskKeys.canonicalEnabled(normalizedWorkspaceId) ? (await this.tasks.getByKey(key, normalizedWorkspaceId))?.id : undefined;
        await db.insert(checkinTaskRefs).values({ workspaceId: normalizedWorkspaceId, checkinId: checkInRow.id, taskKey: key, taskId, createdAt: now });
        await this.eventsService.append({ workspaceId: normalizedWorkspaceId, taskKey: key, type: "checkin_ref", body: null, meta: { checkInId: checkInRow.id, date, developerAccountId: accountId, excerpt: summary.slice(0, 200) }, sourceTable: "team_tracker_checkins", sourceId: checkInRow.id }, { type: actor?.type === "developer" ? "developer" : "manager", accountId: actor?.accountId });
      }
    }
    return { ...mapCheckIn(checkInRow), taskKeys: [...taskKeys] };
    });
  }

  async recordStatusUpdate(
    accountId: string,
    date: string,
    params: {
      status: TrackerDeveloperStatus;
      rationale?: string;
      summary?: string;
      nextFollowUpAt?: string | null;
      taskKey?: string;
    },
    actor?: {
      type: UserRole;
      accountId?: string;
    },
    workspaceId?: string
  ): Promise<TrackerDeveloperDay> {
    return runInTransaction(async () => {
    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    const rationale = normalizeOptionalText(params.rationale);
    const summary = normalizeOptionalText(params.summary);

    if ((requiresStatusRationale(params.status) || (params.taskKey && params.status === "waiting")) && !rationale) {
      throw new HttpError(
        400,
        params.status === "waiting" ? "rationale is required for a waiting task blocker" : "rationale is required when status is blocked or at_risk"
      );
    }

    const resolution = params.taskKey ? await this.taskKeys.resolveTask(normalizedWorkspaceId, params.taskKey) : null;
    if (resolution && resolution.developer?.accountId !== accountId) throw new HttpError(400, "Task is not owned by this developer");
    const checkIn = await this.addCheckIn(
      accountId,
      date,
      {
        summary: buildStatusUpdateSummary({
          status: params.status,
          rationale,
          summary,
        }),
        status: params.status,
        rationale,
        nextFollowUpAt: params.nextFollowUpAt ?? null,
        taskKeys: resolution ? [resolution.taskKey] : undefined,
      },
      actor,
      normalizedWorkspaceId
    );
    if (resolution) {
      const raising = (["blocked", "at_risk", "waiting"] as string[]).includes(params.status);
      const latest = raising ? null : await this.eventsService.latestOfType(resolution.taskKey, "blocker", { kind: "manager", accountId: actor?.accountId ?? "", workspaceId: normalizedWorkspaceId });
      if (raising || (latest?.meta && typeof latest.meta === "object" && "action" in latest.meta && latest.meta.action === "raised")) {
        await this.eventsService.append({ workspaceId: normalizedWorkspaceId, taskKey: resolution.taskKey, type: "blocker", body: raising ? rationale! : null, meta: { action: raising ? "raised" : "cleared", ...(raising && { developerDayStatus: params.status }), checkInId: checkIn.id } }, { type: "system", accountId: actor?.accountId });
      }
    }
    return this.getDeveloperDay(date, accountId, undefined, normalizedWorkspaceId);
    });
  }

  async assertItemBelongsToDeveloper(
    itemId: number,
    developerAccountId: string,
    workspaceId?: string
  ): Promise<{ ownerAccountId: string; date: string }> {
    if (await this.taskKeys.canonicalEnabled(workspaceId)) {
      const task = await this.tasks.resolve("team_tracker_items", itemId, workspaceId);
      await this.tasks.requireTask(task.taskKey, { type: "developer", accountId: developerAccountId, workspaceId });
      return { ownerAccountId: developerAccountId, date: task.scheduledOn ?? todayIsoDate() };
    }
    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    const rows = await db
      .select({
        ownerAccountId: teamTrackerDays.developerAccountId,
        date: teamTrackerDays.date,
      })
      .from(teamTrackerItems)
      .innerJoin(teamTrackerDays, eq(teamTrackerDays.id, teamTrackerItems.dayId))
      .where(and(eq(teamTrackerItems.workspaceId, normalizedWorkspaceId), eq(teamTrackerItems.id, itemId)))
      .limit(1);

    const row = rows[0];
    if (!row) {
      throw new HttpError(404, "Item not found");
    }

    if (row.ownerAccountId !== developerAccountId) {
      throw new HttpError(403, "Item does not belong to authenticated developer");
    }

    return row;
  }

  async getIssueAssignments(
    jiraKey: string,
    date: string,
    workspaceId?: string
  ): Promise<TrackerIssueAssignment[]> {
    const normalizedJiraKey = jiraKey.trim();
    if (!normalizedJiraKey) {
      return [];
    }

    return (await this.getActiveIssueAssignmentsForDate(date, workspaceId)).filter(
      (assignment) => assignment.jiraKey === normalizedJiraKey
    );
  }

  async getIssueAssignmentSummaryMap(
    date: string,
    workspaceId?: string
  ): Promise<Map<string, IssueTrackerAssignmentSummary>> {
    const assignments = await this.getActiveIssueAssignmentsForDate(date, workspaceId);
    const summaryMap = new Map<string, IssueTrackerAssignmentSummary>();

    for (const assignment of assignments) {
      const summary = summaryMap.get(assignment.jiraKey);
      if (summary) {
        summary.activeCount += 1;
        if (!summary.developerNames.includes(assignment.developer.displayName)) {
          summary.developerNames.push(assignment.developer.displayName);
        }
        continue;
      }

      summaryMap.set(assignment.jiraKey, {
        activeCount: 1,
        developerNames: [assignment.developer.displayName],
      });
    }

    return summaryMap;
  }

  async getItemDetailContext(itemId: number, workspaceId?: string): Promise<{
    date: string;
    developer: Developer;
    trackerItem: TrackerWorkItem;
    task?: SurfaceTask;
  }> {
    if (await this.taskKeys.canonicalEnabled(workspaceId)) {
      const scope = normalizeWorkspaceId(workspaceId);
      const task = await this.tasks.resolve("team_tracker_items", itemId, scope);
      const surface = await this.tasks.surfaceDto(task, { date: task.scheduledOn ?? todayIsoDate(), principal: { type: "manager", accountId: "", workspaceId: scope } });
      return { date: surface.originDate, developer: await this.getDeveloperByAccountId(task.ownerId!, scope), trackerItem: surfaceTaskToWorkItem(surface), task: surface };
    }
    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    const rows = await db
      .select({
        item: teamTrackerItems,
        date: teamTrackerDays.date,
        developer: developers,
      })
      .from(teamTrackerItems)
      .innerJoin(teamTrackerDays, eq(teamTrackerDays.id, teamTrackerItems.dayId))
      .innerJoin(developers, and(eq(developers.workspaceId, normalizedWorkspaceId), eq(developers.accountId, teamTrackerDays.developerAccountId)))
      .where(and(eq(teamTrackerItems.workspaceId, normalizedWorkspaceId), eq(teamTrackerItems.id, itemId)))
      .limit(1);

    const row = rows[0];
    if (!row) {
      throw new HttpError(404, "Item not found");
    }

    const issueContextMap = await this.getIssueContextMap(
      row.item.jiraKey ? [row.item.jiraKey] : [],
      normalizedWorkspaceId
    );

    return {
      date: row.date,
      developer: mapDeveloper(row.developer),
      trackerItem: mapItem(
        row.item,
        row.item.jiraKey ? issueContextMap.get(row.item.jiraKey) : undefined
      ),
    };
  }

  async getItemDetailContextForManagerDeskItem(
    managerDeskItemId: number,
    workspaceId?: string
  ): Promise<
    | {
        date: string;
        developer: Developer;
        trackerItem: TrackerWorkItem;
        task?: SurfaceTask;
      }
    | null
  > {
    if (await this.taskKeys.canonicalEnabled(workspaceId)) {
      const scope = normalizeWorkspaceId(workspaceId);
      const task = await this.tasks.resolve("manager_desk_items", managerDeskItemId, scope);
      if (task.ownerType !== "developer") return null;
      const surface = await this.tasks.surfaceDto(task, { date: task.scheduledOn ?? todayIsoDate(), principal: { type: "manager", accountId: "", workspaceId: scope } });
      return { date: surface.originDate, developer: await this.getDeveloperByAccountId(task.ownerId!, scope), trackerItem: surfaceTaskToWorkItem(surface), task: surface };
    }
    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    const rows = await db
      .select({
        item: teamTrackerItems,
        date: teamTrackerDays.date,
        developer: developers,
      })
      .from(teamTrackerItems)
      .innerJoin(teamTrackerDays, eq(teamTrackerDays.id, teamTrackerItems.dayId))
      .innerJoin(developers, and(eq(developers.workspaceId, normalizedWorkspaceId), eq(developers.accountId, teamTrackerDays.developerAccountId)))
      .where(and(eq(teamTrackerItems.workspaceId, normalizedWorkspaceId), eq(teamTrackerItems.managerDeskItemId, managerDeskItemId)))
      .limit(1);

    const row = rows[0];
    if (!row) {
      return null;
    }

    const issueContextMap = await this.getIssueContextMap(
      row.item.jiraKey ? [row.item.jiraKey] : [],
      normalizedWorkspaceId
    );

    return {
      date: row.date,
      developer: mapDeveloper(row.developer),
      trackerItem: mapItem(
        row.item,
        row.item.jiraKey ? issueContextMap.get(row.item.jiraKey) : undefined
      ),
    };
  }

  async linkManagerDeskItem(
    itemId: number,
    managerDeskItemId: number,
    workspaceId?: string
  ): Promise<TrackerWorkItem> {
    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    await this.getItemRow(itemId, normalizedWorkspaceId);

    await db
      .update(teamTrackerItems)
      .set({ managerDeskItemId })
      .where(eq(teamTrackerItems.id, itemId));

    return this.getItemById(itemId, normalizedWorkspaceId);
  }

  async previewCarryForward(
    fromDate: string,
    toDate: string,
    workspaceId?: string
  ): Promise<TrackerCarryForwardPreviewResponse> {
    if (await this.taskKeys.canonicalEnabled(workspaceId)) return { carryable: 0, developers: [] };
    const plan = await this.buildCarryForwardPlan(fromDate, toDate, workspaceId);
    return this.buildCarryForwardPreview(plan.entries);
  }

  async getCarryForwardContext(
    toDate: string,
    lookbackDays = SMART_CARRY_FORWARD_LOOKBACK_DAYS,
    workspaceId?: string
  ): Promise<TrackerCarryForwardContextResponse> {
    if (await this.taskKeys.canonicalEnabled(workspaceId)) return { toDate, carryable: 0, developers: [] };
    const fromDate = await this.resolveLatestCarryForwardSourceDate(toDate, lookbackDays, workspaceId);
    if (!fromDate) {
      return {
        fromDate: undefined,
        toDate,
        carryable: 0,
        developers: [],
      };
    }

    const preview = await this.previewCarryForward(fromDate, toDate, workspaceId);
    return {
      fromDate,
      toDate,
      carryable: preview.carryable,
      developers: preview.developers,
    };
  }

  async carryForward(
    fromDate: string,
    toDate: string,
    options?: CarryForwardExecutionOptions,
    workspaceId?: string
  ): Promise<number> {
    assertForwardDateRange(fromDate, toDate);
    return runInTransaction(async () => {
    if (await this.taskKeys.canonicalEnabled(workspaceId)) {
      const principal = this.tasks.principal(workspaceId, options?.actor);
      const rows = options?.itemIds
        ? await Promise.all(options.itemIds.map((id) => this.tasks.resolve("team_tracker_items", id, workspaceId)))
        : await this.tasks.list(principal, { view: "developer", date: fromDate });
      let moved = 0;
      for (const row of rows) {
        if (["done", "dropped"].includes(row.status)) continue;
        await this.tasks.update(row.taskKey, { scheduledOn: toDate }, principal);
        moved++;
      }
      return moved;
    }
    const plan = await this.buildCarryForwardPlan(fromDate, toDate, workspaceId);
    const selectedEntries = await this.selectCarryForwardEntries(
      fromDate,
      plan.entries,
      options?.itemIds,
      workspaceId
    );
    const trackerOnlyItems = selectedEntries
      .filter((entry) => entry.item.managerDeskItemId === null)
      .map((entry) => ({
        developerAccountId: entry.developerAccountId,
        item: entry.item,
      }));
    let carried = await this.carryForwardTrackerOnlyItems(
      trackerOnlyItems,
      toDate,
      workspaceId,
      options?.actor
    );
    const managerDeskItemIds = selectedEntries
      .map((entry) => entry.item.managerDeskItemId)
      .filter((itemId): itemId is number => typeof itemId === "number");

    if (managerDeskItemIds.length > 0) {
      if (!options?.carryManagerDeskItems) {
        throw new Error("Manager Desk carry-forward handler is required for linked tracker items");
      }

      carried += await options.carryManagerDeskItems({
        fromDate,
        toDate,
        itemIds: managerDeskItemIds,
      });
    }

    return carried;
    });
  }

  private computeSummary(days: TrackerDeveloperDay[]): TrackerBoardSummary {
    return {
      total: days.length,
      stale: days.filter((d) => d.signals.freshness.staleByTime).length,
      blocked: days.filter((d) => d.status === "blocked").length,
      atRisk: days.filter((d) => d.status === "at_risk").length,
      waiting: days.filter((d) => d.status === "waiting").length,
      noCurrent: days.filter((d) => !d.currentItem && d.status !== "done_for_today").length,
      overdueLinkedWork: days.filter((d) => d.signals.risk.overdueLinkedWork).length,
      overCapacity: days.filter((d) => d.signals.risk.overCapacity).length,
      statusFollowUp: days.filter((d) => d.signals.freshness.statusChangeWithoutFollowUp).length,
      doneForToday: days.filter((d) => d.status === "done_for_today").length,
    };
  }

  private computeAttentionQueue(days: TrackerDeveloperDay[]): TrackerAttentionItem[] {
    const queue: TrackerAttentionItem[] = [];

    for (const day of days) {
      const reasons = buildAttentionReasons(day);
      if (reasons.length === 0) {
        continue;
      }

      queue.push({
        developer: day.developer,
        status: day.status,
        reasons,
        lastCheckInAt: day.lastCheckInAt,
        nextFollowUpAt: day.nextFollowUpAt,
        isStale: day.isStale,
        signals: day.signals,
        hasCurrentItem: Boolean(day.currentItem),
        currentItem: day.currentItem ? mapAttentionActionItem(day.currentItem) : undefined,
        plannedCount: day.plannedItems.length,
        availableQuickActions: getAttentionQuickActions(day),
        setCurrentCandidates: !day.currentItem
          ? day.plannedItems.map(mapAttentionActionItem)
          : [],
      });
    }

    return queue.sort((left, right) => {
      const [leftPriority, leftReasonCount, leftCheckInTime, leftName] =
        getAttentionSortTuple(left);
      const [rightPriority, rightReasonCount, rightCheckInTime, rightName] =
        getAttentionSortTuple(right);

      if (leftPriority !== rightPriority) {
        return leftPriority - rightPriority;
      }
      if (leftReasonCount !== rightReasonCount) {
        return leftReasonCount - rightReasonCount;
      }
      if (leftCheckInTime !== rightCheckInTime) {
        return leftCheckInTime - rightCheckInTime;
      }

      return leftName.localeCompare(rightName);
    });
  }

  private async getDeveloperByAccountId(accountId: string, workspaceId?: string): Promise<Developer> {
    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    const rows = await db
      .select()
      .from(developers)
      .where(and(eq(developers.workspaceId, normalizedWorkspaceId), eq(developers.accountId, accountId)))
      .limit(1);

    const row = rows[0];
    if (!row) {
      throw new HttpError(404, `Developer ${accountId} not found`);
    }

    return mapDeveloper(row);
  }

  private async buildDeveloperDay(
    date: string,
    developer: Developer,
    signalConfig: TrackerSignalConfig,
    workspaceId?: string,
    viewer?: TaskPrincipal
  ): Promise<TrackerDeveloperDay> {
    if (await this.taskKeys.canonicalEnabled(workspaceId)) return this.buildCanonicalDeveloperDay(date, developer, signalConfig, workspaceId, date < todayIsoDate(), viewer);
    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    const day = await this.ensureDay(date, developer.accountId, normalizedWorkspaceId);
    const items = await db
      .select()
      .from(teamTrackerItems)
      .where(eq(teamTrackerItems.dayId, day.id));
    const checkIns = await db
      .select()
      .from(teamTrackerCheckIns)
      .where(eq(teamTrackerCheckIns.dayId, day.id));
    const recentCheckInsByDeveloper = await this.getRecentCheckInsByDeveloper(
      [developer.accountId],
      date,
      normalizedWorkspaceId
    );

    const mapped = (await this.mapItemsWithIssueContext(
      items,
      normalizedWorkspaceId
    )).sort(
      (a, b) => a.position - b.position
    );
    const currentItem = mapped.find((i) => i.state === "in_progress");
    const plannedItems = mapped.filter((i) => i.state === "planned");
    const completedItems = mapped.filter((i) => i.state === "done");
    const droppedItems = mapped.filter((i) => i.state === "dropped");
    const signals = buildSignals({
      date,
      status: day.status as TrackerDeveloperStatus,
      lastCheckInAt: day.lastCheckInAt,
      statusUpdatedAt: day.statusUpdatedAt,
      updatedAt: day.updatedAt,
      currentItem,
      plannedItems,
      capacityUnits: day.capacityUnits ?? undefined,
      config: signalConfig,
    });

    return {
      id: day.id,
      date,
      developer,
      availability: developer.availability ?? { state: "active" },
      status: day.status as TrackerDeveloperStatus,
      capacityUnits: day.capacityUnits ?? undefined,
      managerNotes: day.managerNotes ?? undefined,
      lastCheckInAt: day.lastCheckInAt ?? undefined,
      nextFollowUpAt: day.nextFollowUpAt ?? undefined,
      currentItem,
      plannedItems,
      completedItems,
      droppedItems,
      checkIns: checkIns.map(mapCheckIn),
      recentCheckIns: recentCheckInsByDeveloper.get(developer.accountId) ?? [],
      isStale: signals.freshness.staleByTime,
      signals,
      statusUpdatedAt: day.statusUpdatedAt ?? undefined,
      createdAt: day.createdAt,
      updatedAt: day.updatedAt,
    };
  }

  private async buildHistoricalDeveloperDay(
    date: string,
    developer: Developer,
    signalConfig: TrackerSignalConfig,
    workspaceId?: string,
    viewer?: TaskPrincipal
  ): Promise<TrackerDeveloperDay> {
    if (await this.taskKeys.canonicalEnabled(workspaceId)) return this.buildCanonicalDeveloperDay(date, developer, signalConfig, workspaceId, true, viewer);
    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    const day = await this.findDay(date, developer.accountId, normalizedWorkspaceId);
    const items = day
      ? await db
          .select()
          .from(teamTrackerItems)
          .where(eq(teamTrackerItems.dayId, day.id))
      : [];
    const checkIns = day
      ? await db
          .select()
          .from(teamTrackerCheckIns)
          .where(eq(teamTrackerCheckIns.dayId, day.id))
      : [];
    const recentCheckInsByDeveloper = await this.getRecentCheckInsByDeveloper(
      [developer.accountId],
      date,
      normalizedWorkspaceId
    );

    const mapped = (await this.mapItemsWithIssueContext(
      items,
      normalizedWorkspaceId
    )).sort(
      (a, b) => a.position - b.position
    );
    const currentItem = mapped.find((item) => item.state === "in_progress");
    const plannedItems = mapped.filter((item) => item.state === "planned");
    const completedItems = mapped.filter((item) => item.state === "done");
    const droppedItems = mapped.filter((item) => item.state === "dropped");
    const signals = buildSignals({
      date,
      status: (day?.status as TrackerDeveloperStatus | undefined) ?? "on_track",
      lastCheckInAt: day?.lastCheckInAt,
      statusUpdatedAt: day?.statusUpdatedAt,
      updatedAt: day?.updatedAt ?? `${date}T00:00:00.000Z`,
      currentItem,
      plannedItems,
      capacityUnits: day?.capacityUnits ?? undefined,
      config: signalConfig,
      now: endOfIsoDate(date),
    });

    return {
      id: day?.id ?? 0,
      date,
      developer,
      availability: developer.availability ?? { state: "active" },
      status: (day?.status as TrackerDeveloperStatus | undefined) ?? "on_track",
      capacityUnits: day?.capacityUnits ?? undefined,
      managerNotes: day?.managerNotes ?? undefined,
      lastCheckInAt: day?.lastCheckInAt ?? undefined,
      nextFollowUpAt: day?.nextFollowUpAt ?? undefined,
      currentItem,
      plannedItems,
      completedItems,
      droppedItems,
      checkIns: checkIns.map(mapCheckIn),
      recentCheckIns: recentCheckInsByDeveloper.get(developer.accountId) ?? [],
      isStale: signals.freshness.staleByTime,
      signals,
      statusUpdatedAt: day?.statusUpdatedAt ?? undefined,
      createdAt: day?.createdAt ?? `${date}T00:00:00.000Z`,
      updatedAt: day?.updatedAt ?? `${date}T00:00:00.000Z`,
    };
  }

  private async buildLiveDeveloperDay(
    date: string,
    developer: Developer,
    signalConfig: TrackerSignalConfig,
    workspaceId?: string,
    viewer?: TaskPrincipal
  ): Promise<TrackerDeveloperDay> {
    if (await this.taskKeys.canonicalEnabled(workspaceId)) return this.buildCanonicalDeveloperDay(date, developer, signalConfig, workspaceId, false, viewer);
    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    const exactDay = await this.findDay(date, developer.accountId, normalizedWorkspaceId);
    const allRelevantDays = await db
      .select()
      .from(teamTrackerDays)
      .where(and(eq(teamTrackerDays.workspaceId, normalizedWorkspaceId), eq(teamTrackerDays.developerAccountId, developer.accountId)));
    const eligibleDays = allRelevantDays
      .filter((day) => day.date <= date)
      .sort((left, right) => left.date.localeCompare(right.date));
    const latestDay = eligibleDays[eligibleDays.length - 1];
    const dayById = new Map(eligibleDays.map((day) => [day.id, day]));
    const itemRows =
      eligibleDays.length > 0
        ? await db
            .select()
            .from(teamTrackerItems)
            .where(inArray(teamTrackerItems.dayId, eligibleDays.map((day) => day.id)))
        : [];
    const canonicalItemRows = this.getLiveCanonicalItemRows(itemRows, dayById);
    const mappedCanonicalItems = (await this.mapItemsWithIssueContext(
      canonicalItemRows,
      normalizedWorkspaceId
    )).sort(
      compareLiveOpenItems
    );
    const currentItem = mappedCanonicalItems
      .filter((item) => item.state === "in_progress")
      .sort(compareLiveCurrentItems)[0];
    const plannedItems = mappedCanonicalItems.filter(
      (item) => item.state === "planned" || (item.state === "in_progress" && item.id !== currentItem?.id)
    );
    const completedItems = mappedCanonicalItems.filter(
      (item) => item.state === "done" && isoDatePart(item.completedAt) === date
    );
    const droppedItems = mappedCanonicalItems.filter(
      (item) => item.state === "dropped" && isoDatePart(item.updatedAt) === date
    );
    const checkIns = exactDay
      ? await db
          .select()
          .from(teamTrackerCheckIns)
          .where(eq(teamTrackerCheckIns.dayId, exactDay.id))
      : [];
    const recentCheckInsByDeveloper = await this.getRecentCheckInsByDeveloper(
      [developer.accountId],
      date,
      normalizedWorkspaceId
    );
    const effectiveDay = exactDay ?? latestDay;
    const signals = buildSignals({
      date,
      status: (effectiveDay?.status as TrackerDeveloperStatus | undefined) ?? "on_track",
      lastCheckInAt: effectiveDay?.lastCheckInAt,
      statusUpdatedAt: effectiveDay?.statusUpdatedAt,
      updatedAt: effectiveDay?.updatedAt ?? `${date}T00:00:00.000Z`,
      currentItem,
      plannedItems,
      capacityUnits: effectiveDay?.capacityUnits ?? undefined,
      config: signalConfig,
    });

    return {
      id: exactDay?.id ?? effectiveDay?.id ?? 0,
      date,
      developer,
      availability: developer.availability ?? { state: "active" },
      status: (effectiveDay?.status as TrackerDeveloperStatus | undefined) ?? "on_track",
      capacityUnits: effectiveDay?.capacityUnits ?? undefined,
      managerNotes: effectiveDay?.managerNotes ?? undefined,
      lastCheckInAt: effectiveDay?.lastCheckInAt ?? undefined,
      nextFollowUpAt: effectiveDay?.nextFollowUpAt ?? undefined,
      currentItem,
      plannedItems,
      completedItems,
      droppedItems,
      checkIns: checkIns.map(mapCheckIn),
      recentCheckIns: recentCheckInsByDeveloper.get(developer.accountId) ?? [],
      isStale: signals.freshness.staleByTime,
      signals,
      statusUpdatedAt: effectiveDay?.statusUpdatedAt ?? undefined,
      createdAt: effectiveDay?.createdAt ?? `${date}T00:00:00.000Z`,
      updatedAt: effectiveDay?.updatedAt ?? `${date}T00:00:00.000Z`,
    };
  }

  private async buildLiveDeveloperDays(
    date: string,
    developerList: Developer[],
    signalConfig: TrackerSignalConfig,
    workspaceId?: string,
    viewer?: TaskPrincipal
  ): Promise<TrackerDeveloperDay[]> {
    if (await this.taskKeys.canonicalEnabled(workspaceId)) return this.buildCanonicalDeveloperDays(date, developerList, signalConfig, workspaceId, viewer);
    if (developerList.length === 0) {
      return [];
    }

    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    const developerAccountIds = developerList.map((developer) => developer.accountId);
    const allRelevantDays = await db
      .select()
      .from(teamTrackerDays)
      .where(
        and(
          eq(teamTrackerDays.workspaceId, normalizedWorkspaceId),
          inArray(teamTrackerDays.developerAccountId, developerAccountIds),
          lte(teamTrackerDays.date, date)
        )
      );
    const daysByDeveloper = new Map<string, Array<typeof teamTrackerDays.$inferSelect>>();
    const dayById = new Map<number, typeof teamTrackerDays.$inferSelect>();

    for (const day of allRelevantDays) {
      dayById.set(day.id, day);
      const developerDays = daysByDeveloper.get(day.developerAccountId) ?? [];
      developerDays.push(day);
      daysByDeveloper.set(day.developerAccountId, developerDays);
    }
    for (const developerDays of daysByDeveloper.values()) {
      developerDays.sort((left, right) => left.date.localeCompare(right.date));
    }

    const dayIds = allRelevantDays.map((day) => day.id);
    const itemRows = dayIds.length > 0
      ? await db
          .select()
          .from(teamTrackerItems)
          .where(
            and(
              eq(teamTrackerItems.workspaceId, normalizedWorkspaceId),
              inArray(teamTrackerItems.dayId, dayIds)
            )
          )
      : [];
    const itemRowsByDeveloper = new Map<string, Array<typeof teamTrackerItems.$inferSelect>>();

    for (const item of itemRows) {
      const developerAccountId = dayById.get(item.dayId)?.developerAccountId;
      if (!developerAccountId) {
        continue;
      }
      const developerItems = itemRowsByDeveloper.get(developerAccountId) ?? [];
      developerItems.push(item);
      itemRowsByDeveloper.set(developerAccountId, developerItems);
    }

    const canonicalRowsByDeveloper = new Map<string, Array<typeof teamTrackerItems.$inferSelect>>();
    const canonicalRows: Array<typeof teamTrackerItems.$inferSelect> = [];
    for (const developer of developerList) {
      const rows = this.getLiveCanonicalItemRows(
        itemRowsByDeveloper.get(developer.accountId) ?? [],
        dayById
      );
      canonicalRowsByDeveloper.set(developer.accountId, rows);
      canonicalRows.push(...rows);
    }

    const issueContextMap = await this.getIssueContextMap(
      canonicalRows
        .map((row) => row.jiraKey)
        .filter((jiraKey): jiraKey is string => Boolean(jiraKey)),
      normalizedWorkspaceId
    );
    const exactDays = allRelevantDays.filter((day) => day.date === date);
    const exactDayIds = exactDays.map((day) => day.id);
    const checkInRows = exactDayIds.length > 0
      ? await db
          .select()
          .from(teamTrackerCheckIns)
          .where(
            and(
              eq(teamTrackerCheckIns.workspaceId, normalizedWorkspaceId),
              inArray(teamTrackerCheckIns.dayId, exactDayIds)
            )
          )
      : [];
    const checkInsByDayId = new Map<number, Array<typeof teamTrackerCheckIns.$inferSelect>>();
    for (const checkIn of checkInRows) {
      const dayCheckIns = checkInsByDayId.get(checkIn.dayId) ?? [];
      dayCheckIns.push(checkIn);
      checkInsByDayId.set(checkIn.dayId, dayCheckIns);
    }
    const recentCheckInsByDeveloper = await this.getRecentCheckInsByDeveloper(
      developerAccountIds,
      date,
      normalizedWorkspaceId
    );

    return developerList.map((developer) => {
      const eligibleDays = daysByDeveloper.get(developer.accountId) ?? [];
      const exactDay = eligibleDays.find((day) => day.date === date);
      const latestDay = eligibleDays[eligibleDays.length - 1];
      const effectiveDay = exactDay ?? latestDay;
      const mappedCanonicalItems = (canonicalRowsByDeveloper.get(developer.accountId) ?? [])
        .map((row) =>
          mapItem(
            row,
            row.jiraKey ? issueContextMap.get(row.jiraKey) : undefined
          )
        )
        .sort(compareLiveOpenItems);
      const currentItem = mappedCanonicalItems
        .filter((item) => item.state === "in_progress")
        .sort(compareLiveCurrentItems)[0];
      const plannedItems = mappedCanonicalItems.filter(
        (item) => item.state === "planned" || (item.state === "in_progress" && item.id !== currentItem?.id)
      );
      const completedItems = mappedCanonicalItems.filter(
        (item) => item.state === "done" && isoDatePart(item.completedAt) === date
      );
      const droppedItems = mappedCanonicalItems.filter(
        (item) => item.state === "dropped" && isoDatePart(item.updatedAt) === date
      );
      const checkIns = exactDay ? checkInsByDayId.get(exactDay.id) ?? [] : [];
      const recentCheckIns = recentCheckInsByDeveloper.get(developer.accountId) ?? [];
      const signals = buildSignals({
        date,
        status: (effectiveDay?.status as TrackerDeveloperStatus | undefined) ?? "on_track",
        lastCheckInAt: effectiveDay?.lastCheckInAt,
        statusUpdatedAt: effectiveDay?.statusUpdatedAt,
        updatedAt: effectiveDay?.updatedAt ?? `${date}T00:00:00.000Z`,
        currentItem,
        plannedItems,
        capacityUnits: effectiveDay?.capacityUnits ?? undefined,
        config: signalConfig,
      });

      return {
        id: exactDay?.id ?? effectiveDay?.id ?? 0,
        date,
        developer,
        availability: developer.availability ?? { state: "active" },
        status: (effectiveDay?.status as TrackerDeveloperStatus | undefined) ?? "on_track",
        capacityUnits: effectiveDay?.capacityUnits ?? undefined,
        managerNotes: effectiveDay?.managerNotes ?? undefined,
        lastCheckInAt: effectiveDay?.lastCheckInAt ?? undefined,
        nextFollowUpAt: effectiveDay?.nextFollowUpAt ?? undefined,
        currentItem,
        plannedItems,
        completedItems,
        droppedItems,
        checkIns: checkIns.map(mapCheckIn),
        recentCheckIns,
        isStale: signals.freshness.staleByTime,
        signals,
        statusUpdatedAt: effectiveDay?.statusUpdatedAt ?? undefined,
        createdAt: effectiveDay?.createdAt ?? `${date}T00:00:00.000Z`,
        updatedAt: effectiveDay?.updatedAt ?? `${date}T00:00:00.000Z`,
      };
    });
  }

  private async buildCanonicalDeveloperDay(date: string, developer: Developer, config: TrackerSignalConfig, workspaceId: string | undefined, history: boolean, viewer?: TaskPrincipal): Promise<TrackerDeveloperDay> {
    const principal = viewer ?? { type: "manager" as const, accountId: "", workspaceId };
    if (!history) return (await this.buildCanonicalDeveloperDays(date, [developer], config, workspaceId, principal))[0]!;
    const scope = normalizeWorkspaceId(workspaceId);
    const dayRows = await db.select().from(teamTrackerDays).where(and(eq(teamTrackerDays.workspaceId, scope), eq(teamTrackerDays.developerAccountId, developer.accountId), lte(teamTrackerDays.date, date))).orderBy(desc(teamTrackerDays.date)).limit(1);
    const day = dayRows[0];
    const exact = day?.date === date ? day : undefined;
    const projected = history
      ? await this.tasks.projectDeveloperHistoryDay(developer.accountId, date, scope)
      : await this.tasks.projectDeveloperBoardDay(developer.accountId, date, scope);
    const taskRows = (await Promise.all(projected.map(async (projection) => {
      const task = await this.tasks.getByKey(projection.taskKey, scope);
      return task ? { ...task, title: projection.title, status: projection.status, ownerType: "developer" as const, ownerId: developer.accountId } : undefined;
    }))).filter((task): task is NonNullable<typeof task> => Boolean(task));
    const surfaceTasks = (await this.tasks.surfaceDtos(taskRows, { date, principal })).sort((left, right) => left.position - right.position);
    const mapped = surfaceTasks.map(surfaceTaskToWorkItem);
    const currentItem = mapped.find((item) => item.state === "in_progress");
    const plannedItems = mapped.filter((item) => item.state === "planned");
    const checkIns = exact ? await db.select().from(teamTrackerCheckIns).where(eq(teamTrackerCheckIns.dayId, exact.id)) : [];
    const notes = (await db.select().from(developerNotes).where(and(eq(developerNotes.workspaceId, scope), eq(developerNotes.developerAccountId, developer.accountId))).limit(1))[0];
    const effective = history ? exact : day;
    const status = (effective?.status ?? "on_track") as TrackerDeveloperStatus;
    const signals = buildSignals({ date, status, lastCheckInAt: effective?.lastCheckInAt, statusUpdatedAt: effective?.statusUpdatedAt, updatedAt: effective?.updatedAt ?? `${date}T00:00:00Z`, currentItem, plannedItems, capacityUnits: effective?.capacityUnits ?? undefined, config, ...(history && { now: endOfIsoDate(date) }) });
    return { id: exact?.id ?? 0, date, developer, availability: developer.availability ?? { state: "active" }, status,
      capacityUnits: effective?.capacityUnits ?? undefined, managerNotes: notes?.body, lastCheckInAt: effective?.lastCheckInAt ?? undefined,
      nextFollowUpAt: effective?.nextFollowUpAt ?? undefined, currentItem, plannedItems, completedItems: mapped.filter((item) => item.state === "done"), droppedItems: mapped.filter((item) => item.state === "dropped"),
      tasks: surfaceTasks,
      checkIns: checkIns.map(mapCheckIn), recentCheckIns: (await this.getRecentCheckInsByDeveloper([developer.accountId], date, scope)).get(developer.accountId) ?? [],
      signals, isStale: signals.freshness.staleByTime, statusUpdatedAt: effective?.statusUpdatedAt ?? undefined, createdAt: effective?.createdAt ?? `${date}T00:00:00Z`, updatedAt: effective?.updatedAt ?? `${date}T00:00:00Z` };
  }

  private async buildCanonicalDeveloperDays(date: string, developerList: Developer[], config: TrackerSignalConfig, workspaceId?: string, viewer?: TaskPrincipal): Promise<TrackerDeveloperDay[]> {
    if (!developerList.length) return [];
    const scope = normalizeWorkspaceId(workspaceId);
    const principal = viewer ?? { type: "manager" as const, accountId: "", workspaceId: scope };
    const ownerIds = developerList.map((developer) => developer.accountId);
    const [taskRows, days, notes, recent] = await Promise.all([
      this.tasks.developerBoardRows(ownerIds, date, scope),
      db.select().from(teamTrackerDays).where(and(eq(teamTrackerDays.workspaceId, scope), inArray(teamTrackerDays.developerAccountId, ownerIds), lte(teamTrackerDays.date, date))).orderBy(desc(teamTrackerDays.date)),
      db.select().from(developerNotes).where(and(eq(developerNotes.workspaceId, scope), inArray(developerNotes.developerAccountId, ownerIds))),
      this.getRecentCheckInsByDeveloper(ownerIds, date, scope),
    ]);
    const exactIds = days.filter((day) => day.date === date).map((day) => day.id);
    const [surfaceTasks, checkIns] = await Promise.all([
      this.tasks.surfaceDtos(taskRows, { date, principal }),
      exactIds.length ? db.select().from(teamTrackerCheckIns).where(and(eq(teamTrackerCheckIns.workspaceId, scope), inArray(teamTrackerCheckIns.dayId, exactIds))) : Promise.resolve([]),
    ]);
    const surfaceByOwner = new Map<string, SurfaceTask[]>();
    const itemsByOwner = new Map<string, TrackerWorkItem[]>();
    for (const surfaceTask of surfaceTasks) {
      const tasks = surfaceByOwner.get(surfaceTask.ownerId!) ?? [];
      tasks.push(surfaceTask);
      surfaceByOwner.set(surfaceTask.ownerId!, tasks);
      const items = itemsByOwner.get(surfaceTask.ownerId!) ?? [];
      items.push(surfaceTaskToWorkItem(surfaceTask));
      itemsByOwner.set(surfaceTask.ownerId!, items);
    }
    const effectiveDayByOwner = new Map<string, typeof teamTrackerDays.$inferSelect>();
    for (const day of days) if (!effectiveDayByOwner.has(day.developerAccountId)) effectiveDayByOwner.set(day.developerAccountId, day);
    const notesByOwner = new Map(notes.map((note) => [note.developerAccountId, note.body]));
    const checkInsByDay = new Map<number, TrackerCheckIn[]>();
    for (const checkIn of checkIns) {
      const entries = checkInsByDay.get(checkIn.dayId) ?? [];
      entries.push(mapCheckIn(checkIn));
      checkInsByDay.set(checkIn.dayId, entries);
    }
    return developerList.map((developer) => {
      const day = effectiveDayByOwner.get(developer.accountId);
      const exact = day?.date === date ? day : undefined;
      const mapped = (itemsByOwner.get(developer.accountId) ?? []).sort((left, right) => left.position - right.position);
      const currentItem = mapped.find((item) => item.state === "in_progress");
      const plannedItems = mapped.filter((item) => item.state === "planned");
      const status = (day?.status ?? "on_track") as TrackerDeveloperStatus;
      const signals = buildSignals({ date, status, lastCheckInAt: day?.lastCheckInAt, statusUpdatedAt: day?.statusUpdatedAt, updatedAt: day?.updatedAt ?? `${date}T00:00:00Z`, currentItem, plannedItems, capacityUnits: day?.capacityUnits ?? undefined, config });
      return { id: exact?.id ?? 0, date, developer, availability: developer.availability ?? { state: "active" }, status, capacityUnits: day?.capacityUnits ?? undefined,
        managerNotes: notesByOwner.get(developer.accountId), lastCheckInAt: day?.lastCheckInAt ?? undefined, nextFollowUpAt: day?.nextFollowUpAt ?? undefined,
        currentItem, plannedItems, completedItems: mapped.filter((item) => item.state === "done"), droppedItems: mapped.filter((item) => item.state === "dropped"),
        tasks: (surfaceByOwner.get(developer.accountId) ?? []).sort((left, right) => left.position - right.position),
        checkIns: exact ? checkInsByDay.get(exact.id) ?? [] : [], recentCheckIns: recent.get(developer.accountId) ?? [], signals, isStale: signals.freshness.staleByTime,
        statusUpdatedAt: day?.statusUpdatedAt ?? undefined, createdAt: day?.createdAt ?? `${date}T00:00:00Z`, updatedAt: day?.updatedAt ?? `${date}T00:00:00Z` };
    });
  }

  private async getSignalConfig(workspaceId?: string): Promise<TrackerSignalConfig> {
    const [
      staleThresholdHours,
      noCurrentThresholdHours,
      statusFollowUpThresholdHours,
    ] = await Promise.all([
      this.settings.getTeamTrackerStaleThresholdHours(workspaceId),
      this.settings.getTeamTrackerNoCurrentThresholdHours(workspaceId),
      this.settings.getTeamTrackerStatusFollowUpThresholdHours(workspaceId),
    ]);

    return {
      staleThresholdHours,
      noCurrentThresholdHours,
      statusFollowUpThresholdHours,
    };
  }

  private normalizeSavedViewQuery(input: {
    q?: string;
    summaryFilter?: TrackerBoardSummaryFilter;
    sortBy?: TeamTrackerBoardSort;
    groupBy?: TeamTrackerBoardGroupBy;
  }): Omit<TeamTrackerBoardResolvedQuery, "viewId"> {
    return normalizeSavedViewQueryInput(input);
  }

  private async getOwnedSavedViewRow(
    managerAccountId: string,
    viewId: number,
    workspaceId?: string
  ): Promise<typeof teamTrackerSavedViews.$inferSelect> {
    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    const rows = await db
      .select()
      .from(teamTrackerSavedViews)
      .where(
        and(
          eq(teamTrackerSavedViews.id, viewId),
          eq(teamTrackerSavedViews.workspaceId, normalizedWorkspaceId),
          eq(teamTrackerSavedViews.managerAccountId, managerAccountId)
        )
      )
      .limit(1);

    const row = rows[0];
    if (!row) {
      throw new HttpError(404, "Saved view not found");
    }

    return row;
  }

  private async assertSavedViewNameAvailable(
    managerAccountId: string,
    name: string,
    excludeViewId?: number,
    workspaceId?: string
  ): Promise<void> {
    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    const rows = await db
      .select()
      .from(teamTrackerSavedViews)
      .where(
        and(
          eq(teamTrackerSavedViews.workspaceId, normalizedWorkspaceId),
          eq(teamTrackerSavedViews.managerAccountId, managerAccountId),
          eq(teamTrackerSavedViews.name, name)
        )
      )
      .limit(1);

    const existing = rows[0];
    if (existing && existing.id !== excludeViewId) {
      throw new HttpError(409, `Saved view "${name}" already exists`);
    }
  }

  private async getItemRow(
    itemId: number,
    workspaceId?: string
  ): Promise<typeof teamTrackerItems.$inferSelect> {
    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    const rows = await db
      .select()
      .from(teamTrackerItems)
      .where(and(eq(teamTrackerItems.workspaceId, normalizedWorkspaceId), eq(teamTrackerItems.id, itemId)))
      .limit(1);

    if (!rows[0]) throw new HttpError(404, "Item not found");
    return rows[0];
  }

  private async assertIssueKeysAvailable(issueKeys: string[], workspaceId?: string): Promise<void> {
    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    const normalizedIssueKeys = normalizeJiraIssueKeys(issueKeys);
    if (normalizedIssueKeys.length === 0) {
      return;
    }

    const rows = await db
      .select({ jiraKey: issues.jiraKey })
      .from(issues)
      .where(and(eq(issues.workspaceId, normalizedWorkspaceId), inArray(issues.jiraKey, normalizedIssueKeys)));
    const found = new Set(rows.map((row) => normalizeJiraIssueKey(row.jiraKey)));
    const missing = normalizedIssueKeys.filter((key) => !found.has(key));

    if (missing.length > 0) {
      throw new HttpError(
        400,
        `Jira issue ${missing[0]} is not available in synced issues`
      );
    }
  }

  private async getItemById(itemId: number, workspaceId?: string): Promise<TrackerWorkItem> {
    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    if (await this.taskKeys.canonicalEnabled(normalizedWorkspaceId)) {
      const task = await this.tasks.resolve("team_tracker_items", itemId, normalizedWorkspaceId);
      return surfaceTaskToWorkItem(await this.tasks.surfaceDto(task, { date: task.scheduledOn ?? todayIsoDate(), principal: { type: "manager", accountId: "", workspaceId: normalizedWorkspaceId } }));
    }
    const row = await this.getItemRow(itemId, normalizedWorkspaceId);
    const issueContextMap = await this.getIssueContextMap(
      row.jiraKey ? [row.jiraKey] : [],
      normalizedWorkspaceId
    );
    return { ...mapItem(
      row,
      row.jiraKey ? issueContextMap.get(row.jiraKey) : undefined
    ), ...(await this.taskKeys.canonicalEnabled(workspaceId) && { canonicalTask: true, canRename: true }) };
  }

  private async mapItemsWithIssueContext(
    rows: Array<typeof teamTrackerItems.$inferSelect>,
    workspaceId?: string
  ): Promise<TrackerWorkItem[]> {
    const jiraKeys = rows
      .map((row) => row.jiraKey)
      .filter((jiraKey): jiraKey is string => Boolean(jiraKey));
    const issueContextMap = await this.getIssueContextMap(jiraKeys, workspaceId);
    const canonicalTask = await this.taskKeys.canonicalEnabled(workspaceId);

    return rows.map((row) =>
      ({ ...mapItem(
        row,
        row.jiraKey ? issueContextMap.get(row.jiraKey) : undefined
      ), ...(canonicalTask && { canonicalTask: true, canRename: true }) })
    );
  }

  private async getRecentCheckInsByDeveloper(
    developerAccountIds: string[],
    date: string,
    workspaceId: string
  ): Promise<Map<string, TrackerCheckIn[]>> {
    const recentCheckIns = new Map<string, TrackerCheckIn[]>();
    if (developerAccountIds.length === 0) {
      return recentCheckIns;
    }

    const rows = await db
      .select({
        checkIn: teamTrackerCheckIns,
        date: teamTrackerDays.date,
        developerAccountId: teamTrackerDays.developerAccountId,
      })
      .from(teamTrackerCheckIns)
      .innerJoin(
        teamTrackerDays,
        eq(teamTrackerCheckIns.dayId, teamTrackerDays.id)
      )
      .where(
        and(
          eq(teamTrackerDays.workspaceId, workspaceId),
          inArray(teamTrackerDays.developerAccountId, developerAccountIds),
          lt(teamTrackerDays.date, date),
          gte(teamTrackerDays.date, addDaysToIsoDate(date, -RECENT_CHECKIN_LOOKBACK_DAYS))
        )
      )
      .orderBy(desc(teamTrackerDays.date), desc(teamTrackerCheckIns.createdAt));

    for (const row of rows) {
      const entries = recentCheckIns.get(row.developerAccountId) ?? [];
      if (entries.length >= RECENT_CHECKIN_LIMIT) {
        continue;
      }
      entries.push({ ...mapCheckIn(row.checkIn), date: row.date });
      recentCheckIns.set(row.developerAccountId, entries);
    }

    return recentCheckIns;
  }

  private async getManagerDeskTrackerItem(
    managerDeskItemId: number,
    workspaceId?: string
  ): Promise<typeof teamTrackerItems.$inferSelect | undefined> {
    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    const rows = await db
      .select()
      .from(teamTrackerItems)
      .where(and(eq(teamTrackerItems.workspaceId, normalizedWorkspaceId), eq(teamTrackerItems.managerDeskItemId, managerDeskItemId)))
      .limit(1);

    return rows[0];
  }

  private async findDay(
    date: string,
    developerAccountId: string,
    workspaceId?: string
  ): Promise<typeof teamTrackerDays.$inferSelect | undefined> {
    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    const rows = await db
      .select()
      .from(teamTrackerDays)
      .where(
        and(
          eq(teamTrackerDays.date, date),
          eq(teamTrackerDays.workspaceId, normalizedWorkspaceId),
          eq(teamTrackerDays.developerAccountId, developerAccountId)
        )
      )
      .limit(1);

    return rows[0];
  }

  private async findLatestPriorDay(
    date: string,
    developerAccountId: string,
    workspaceId?: string
  ): Promise<typeof teamTrackerDays.$inferSelect | undefined> {
    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    const rows = await db
      .select()
      .from(teamTrackerDays)
      .where(
        and(
          eq(teamTrackerDays.workspaceId, normalizedWorkspaceId),
          eq(teamTrackerDays.developerAccountId, developerAccountId)
        )
      );

    return rows
      .filter((day) => day.date < date)
      .sort((left, right) => right.date.localeCompare(left.date))[0];
  }

  private async getDayById(
    dayId: number,
    workspaceId?: string
  ): Promise<typeof teamTrackerDays.$inferSelect | undefined> {
    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    const rows = await db
      .select()
      .from(teamTrackerDays)
      .where(and(eq(teamTrackerDays.workspaceId, normalizedWorkspaceId), eq(teamTrackerDays.id, dayId)))
      .limit(1);

    return rows[0];
  }

  private getLiveCanonicalItemRows(
    itemRows: Array<typeof teamTrackerItems.$inferSelect>,
    dayById: Map<number, typeof teamTrackerDays.$inferSelect>
  ): Array<typeof teamTrackerItems.$inferSelect> {
    const latestByKey = new Map<string, typeof teamTrackerItems.$inferSelect>();

    for (const row of itemRows) {
      const key = buildLiveWorkspaceItemKey(row);
      const existing = latestByKey.get(key);
      if (!existing) {
        latestByKey.set(key, row);
        continue;
      }

      if (compareTrackerRowsByRecency(existing, row, dayById) < 0) {
        latestByKey.set(key, row);
      }
    }

    return Array.from(latestByKey.values());
  }

  private async getIssueContextMap(
    jiraKeys: string[],
    workspaceId?: string
  ): Promise<Map<string, TrackerIssueContext>> {
    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    const uniqueKeys = [...new Set(jiraKeys)];
    if (uniqueKeys.length === 0) {
      return new Map();
    }

    const rows = await db
      .select({
        jiraKey: issues.jiraKey,
        summary: issues.summary,
        priorityName: issues.priorityName,
        dueDate: issues.dueDate,
        developmentDueDate: issues.developmentDueDate,
      })
      .from(issues)
      .where(and(eq(issues.workspaceId, normalizedWorkspaceId), inArray(issues.jiraKey, uniqueKeys)));

    return new Map(rows.map((row) => [row.jiraKey, row]));
  }

  private async getActiveIssueAssignmentsForDate(
    date: string,
    workspaceId?: string
  ): Promise<TrackerIssueAssignment[]> {
    if (await this.taskKeys.canonicalEnabled(workspaceId)) {
      const board = await this.getBoard(date, { workspaceId });
      return board.developers.flatMap((day) => [day.currentItem, ...day.plannedItems].flatMap((item) => item?.jiraKey ? [{ date, jiraKey: item.jiraKey, itemId: item.id, title: item.title, state: item.state, developer: day.developer }] : []));
    }
    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    const viewMode = getTrackerViewMode(date);
    const dayRows = await db
      .select()
      .from(teamTrackerDays)
      .where(eq(teamTrackerDays.workspaceId, normalizedWorkspaceId));
    const relevantDayRows =
      viewMode === "history"
        ? dayRows.filter((row) => row.date === date)
        : dayRows.filter((row) => row.date <= date);

    if (relevantDayRows.length === 0) {
      return [];
    }

    const dayById = new Map(relevantDayRows.map((row) => [row.id, row]));
    const accountIds = [...new Set(relevantDayRows.map((row) => row.developerAccountId))];
    const availabilityByAccountId = await this.availability.getAvailabilityMapForDate(
      accountIds,
      date,
      normalizedWorkspaceId
    );
    const developerRows = await db
      .select()
      .from(developers)
      .where(and(eq(developers.workspaceId, normalizedWorkspaceId), inArray(developers.accountId, accountIds)));
    const developerMap = new Map(
      developerRows.map((row) => [row.accountId, mapDeveloper(row)])
    );
    const itemRows = await db
      .select()
      .from(teamTrackerItems)
      .where(inArray(teamTrackerItems.dayId, relevantDayRows.map((row) => row.id)));
    const rowsByDeveloper = new Map<string, Array<typeof teamTrackerItems.$inferSelect>>();

    for (const row of itemRows) {
      const developerAccountId = dayById.get(row.dayId)?.developerAccountId;
      if (!developerAccountId) {
        continue;
      }

      const existing = rowsByDeveloper.get(developerAccountId);
      if (existing) {
        existing.push(row);
      } else {
        rowsByDeveloper.set(developerAccountId, [row]);
      }
    }

    const matches = Array.from(rowsByDeveloper.entries()).flatMap(([developerAccountId, rows]) => {
      const scopedRows =
        viewMode === "history"
          ? rows
          : this.getLiveCanonicalItemRows(
              rows,
              new Map(
                relevantDayRows
                  .filter((day) => day.developerAccountId === developerAccountId)
                  .map((day) => [day.id, day])
              )
            );

      return scopedRows
        .filter(
          (item) =>
            Boolean(item.jiraKey) &&
            (item.state === "planned" || item.state === "in_progress")
        )
        .sort((left, right) => {
          const stateDiff =
            (left.state === "in_progress" ? 0 : 1) -
            (right.state === "in_progress" ? 0 : 1);
          if (stateDiff !== 0) {
            return stateDiff;
          }

          const dayComparison =
            (dayById.get(left.dayId)?.date ?? "").localeCompare(dayById.get(right.dayId)?.date ?? "");
          if (dayComparison !== 0) {
            return dayComparison;
          }

          if (left.position !== right.position) {
            return left.position - right.position;
          }

          return left.id - right.id;
        })
        .map((item) => ({ developerAccountId, item }));
    });

    return matches.flatMap(({ developerAccountId, item: match }) => {
      const jiraKey = match.jiraKey?.trim();
      if (!jiraKey) {
        return [];
      }

      const developer = developerMap.get(developerAccountId);
      if (!developer || availabilityByAccountId.get(developerAccountId)?.state === "inactive") {
        return [];
      }

      return [
        {
          date,
          jiraKey,
          itemId: match.id,
          title: match.title,
          state: match.state as TrackerItemState,
          developer,
        },
      ];
    });
  }

  private buildRemainingCarryForwardMap(
    sourceItems: Array<
      Pick<
        typeof teamTrackerItems.$inferSelect,
        "taskKey" | "jiraKey" | "relatedJiraKeys" | "title"
      >
    >,
    targetItems: Array<
      Pick<
        typeof teamTrackerItems.$inferSelect,
        "taskKey" | "jiraKey" | "relatedJiraKeys" | "title"
      >
    >
  ): Map<string, number> {
    const targetCounts = new Map<string, number>();
    for (const item of targetItems) {
      const key = buildCarryForwardIdentity(item);
      targetCounts.set(key, (targetCounts.get(key) ?? 0) + 1);
    }

    const sourceCounts = new Map<string, number>();
    for (const item of sourceItems) {
      const key = buildCarryForwardIdentity(item);
      sourceCounts.set(key, (sourceCounts.get(key) ?? 0) + 1);
    }

    const remainingToCarry = new Map<string, number>();
    for (const [key, count] of sourceCounts.entries()) {
      remainingToCarry.set(
        key,
        Math.max(0, count - (targetCounts.get(key) ?? 0))
      );
    }

    return remainingToCarry;
  }

  private async getTargetCarryForwardItems(
    toDate: string,
    developerAccountId: string,
    workspaceId?: string
  ): Promise<Array<typeof teamTrackerItems.$inferSelect>> {
    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    const targetDayRows = await db
      .select()
      .from(teamTrackerDays)
      .where(
        and(
          eq(teamTrackerDays.date, toDate),
          eq(teamTrackerDays.workspaceId, normalizedWorkspaceId),
          eq(teamTrackerDays.developerAccountId, developerAccountId)
        )
      )
      .limit(1);

    const targetDay = targetDayRows[0];
    if (!targetDay) {
      return [];
    }

    const items = await db
      .select()
      .from(teamTrackerItems)
      .where(eq(teamTrackerItems.dayId, targetDay.id));

    return items;
  }

  private async buildCarryForwardPlan(
    fromDate: string,
    toDate: string,
    workspaceId?: string
  ): Promise<CarryForwardPlan> {
    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    const dayRows = await db
      .select({
        day: teamTrackerDays,
        developer: developers,
      })
      .from(teamTrackerDays)
      .innerJoin(
        developers,
        and(eq(developers.workspaceId, normalizedWorkspaceId), eq(developers.accountId, teamTrackerDays.developerAccountId))
      )
      .where(and(eq(teamTrackerDays.workspaceId, normalizedWorkspaceId), eq(teamTrackerDays.date, fromDate)));

    const plannedEntries: Array<{
      developer: Developer;
      developerAccountId: string;
      originDate: string;
      item: typeof teamTrackerItems.$inferSelect;
    }> = [];

    for (const dayRow of dayRows) {
      const items = await db
        .select()
        .from(teamTrackerItems)
        .where(eq(teamTrackerItems.dayId, dayRow.day.id));

      const unfinished = items
        .filter(isCarryForwardEligibleItem)
        .sort((a, b) => a.position - b.position);

      if (unfinished.length === 0) {
        continue;
      }

      const targetItems = await this.getTargetCarryForwardItems(
        toDate,
        dayRow.day.developerAccountId,
        normalizedWorkspaceId
      );
      const remainingToCarry = this.buildRemainingCarryForwardMap(
        unfinished,
        targetItems
      );

      for (const item of unfinished) {
        const key = buildCarryForwardIdentity(item);
        const remaining = remainingToCarry.get(key) ?? 0;
        if (remaining === 0) {
          continue;
        }

        plannedEntries.push({
          developer: mapDeveloper(dayRow.developer),
          developerAccountId: dayRow.day.developerAccountId,
          originDate: dayRow.day.date,
          item,
        });

        remainingToCarry.set(key, remaining - 1);
      }
    }

    const issueContextMap = await this.getIssueContextMap(
      plannedEntries
        .map((entry) => entry.item.jiraKey)
        .filter((jiraKey): jiraKey is string => Boolean(jiraKey)),
      normalizedWorkspaceId
    );

    return {
      entries: plannedEntries.map((entry) => ({
        ...entry,
        trackerItem: mapItem(
          entry.item,
          entry.item.jiraKey
            ? issueContextMap.get(entry.item.jiraKey)
            : undefined,
          entry.originDate
        ),
      })),
    };
  }

  private buildCarryForwardPreview(
    entries: CarryForwardPlanEntry[]
  ): TrackerCarryForwardPreviewResponse {
    const groups = new Map<string, TrackerCarryForwardPreviewGroup>();
    const orderedEntries = [...entries].sort((left, right) => {
      const nameComparison = left.developer.displayName.localeCompare(
        right.developer.displayName
      );
      if (nameComparison !== 0) {
        return nameComparison;
      }

      const accountComparison = left.developer.accountId.localeCompare(
        right.developer.accountId
      );
      if (accountComparison !== 0) {
        return accountComparison;
      }

      if (left.item.position !== right.item.position) {
        return left.item.position - right.item.position;
      }

      return left.item.id - right.item.id;
    });

    for (const entry of orderedEntries) {
      const existing = groups.get(entry.developer.accountId);
      if (existing) {
        existing.items.push(entry.trackerItem);
        continue;
      }

      groups.set(entry.developer.accountId, {
        developer: entry.developer,
        items: [entry.trackerItem],
      });
    }

    return {
      carryable: entries.length,
      developers: Array.from(groups.values()),
    };
  }

  private async selectCarryForwardEntries(
    fromDate: string,
    entries: CarryForwardPlanEntry[],
    itemIds?: number[],
    workspaceId?: string
  ): Promise<CarryForwardPlanEntry[]> {
    if (!itemIds) {
      return entries;
    }

    if (itemIds.length === 0) {
      return [];
    }

    const requestedIds = new Set(itemIds);
    if (requestedIds.size !== itemIds.length) {
      throw new HttpError(400, "itemIds must not contain duplicates");
    }

    const sourceRows = await db
      .select({ id: teamTrackerItems.id })
      .from(teamTrackerItems)
      .innerJoin(teamTrackerDays, eq(teamTrackerDays.id, teamTrackerItems.dayId))
      .where(
        and(
          eq(teamTrackerItems.workspaceId, normalizeWorkspaceId(workspaceId)),
          eq(teamTrackerDays.date, fromDate),
          inArray(teamTrackerItems.id, Array.from(requestedIds))
        )
      );

    if (sourceRows.length !== requestedIds.size) {
      throw new HttpError(
        404,
        "One or more Team Tracker items were not found for the source date"
      );
    }

    return entries.filter((entry) => requestedIds.has(entry.item.id));
  }

  private async carryForwardTrackerOnlyItems(
    items: CarryForwardSourceItem[],
    toDate: string,
    workspaceId?: string,
    actor: TaskEventActor = { type: "system" }
  ): Promise<number> {
    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    if (items.length === 0) {
      return 0;
    }

    let carried = 0;
    const itemsByDeveloper = new Map<string, Array<typeof teamTrackerItems.$inferSelect>>();

    for (const entry of items) {
      const existing = itemsByDeveloper.get(entry.developerAccountId) ?? [];
      existing.push(entry.item);
      itemsByDeveloper.set(entry.developerAccountId, existing);
    }

    for (const [developerAccountId, sourceItems] of itemsByDeveloper.entries()) {
      const newDay = await this.ensureDay(toDate, developerAccountId, normalizedWorkspaceId);
      const targetItems = await db
        .select()
        .from(teamTrackerItems)
        .where(eq(teamTrackerItems.dayId, newDay.id));

      let nextPosition =
        targetItems.reduce((max, item) => Math.max(max, item.position), -1) + 1;
      const now = nowIso();

      for (const item of sourceItems.sort((a, b) => a.position - b.position)) {
        const sourceDay = await this.getDayById(item.dayId, normalizedWorkspaceId);
        await db
          .update(teamTrackerItems)
          .set({
            dayId: newDay.id,
            position: nextPosition,
            updatedAt: now,
          })
          .where(eq(teamTrackerItems.id, item.id));
        nextPosition += 1;
        carried += 1;
        if (sourceDay) {
          await this.emit(item, {
            type: "schedule",
            body: null,
            meta: { field: "day", from: sourceDay.date, to: toDate, via: "carry_forward" },
          }, { type: "system", accountId: actor.accountId });
        }
      }
    }

    return carried;
  }

  private async resolveLatestCarryForwardSourceDate(
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
      const plan = await this.buildCarryForwardPlan(candidateDate, toDate, workspaceId);
      if (plan.entries.length > 0) {
        return candidateDate;
      }
    }

    return undefined;
  }

  private async reorderItem(
    item: typeof teamTrackerItems.$inferSelect,
    targetPosition: number,
    now: string
  ): Promise<void> {
    const siblings = await db
      .select()
      .from(teamTrackerItems)
      .where(eq(teamTrackerItems.dayId, item.dayId));

    const ordered = [...siblings].sort(
      (left, right) => left.position - right.position || left.id - right.id
    );
    const currentIndex = ordered.findIndex((candidate) => candidate.id === item.id);
    if (currentIndex === -1) {
      throw new Error("Item not found");
    }

    const boundedIndex = Math.max(0, Math.min(targetPosition, ordered.length - 1));
    if (currentIndex === boundedIndex) {
      return;
    }

    const [moved] = ordered.splice(currentIndex, 1);
    if (!moved) {
      throw new Error("Item not found");
    }
    ordered.splice(boundedIndex, 0, moved);

    for (const [index, sibling] of ordered.entries()) {
      if (sibling.position === index) {
        continue;
      }

      await db
        .update(teamTrackerItems)
        .set({ position: index, updatedAt: now })
        .where(eq(teamTrackerItems.id, sibling.id));
    }
  }

  private async touchManagerDeskItems(itemIds: number[], now: string): Promise<void> {
    const uniqueItemIds = [...new Set(itemIds)];
    if (uniqueItemIds.length === 0) {
      return;
    }

    await db
      .update(managerDeskItems)
      .set({ updatedAt: now })
      .where(inArray(managerDeskItems.id, uniqueItemIds));
  }

  private async setSingleInProgressForDay(
    developerAccountId: string,
    dayId: number,
    itemId: number,
    now: string,
    options: { ifNoCurrent?: boolean } = {},
    workspaceId?: string,
    actor: TaskEventActor = { type: "system" }
  ): Promise<number[]> {
    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    const dayRows = await db
      .select({ id: teamTrackerDays.id })
      .from(teamTrackerDays)
      .where(
        and(
          eq(teamTrackerDays.id, dayId),
          eq(teamTrackerDays.developerAccountId, developerAccountId)
        )
      )
      .limit(1);

    if (!dayRows[0]) {
      return [];
    }

    const affectedRows = await db
      .select({
        managerDeskItemId: teamTrackerItems.managerDeskItemId,
      })
      .from(teamTrackerItems)
      .where(
        and(
          eq(teamTrackerItems.dayId, dayId),
          eq(teamTrackerItems.id, itemId)
        )
      );
    const currentRows = await db
      .select({ item: teamTrackerItems, date: teamTrackerDays.date })
      .from(teamTrackerItems)
      .innerJoin(teamTrackerDays, eq(teamTrackerItems.dayId, teamTrackerDays.id))
      .where(
        and(
          eq(teamTrackerDays.developerAccountId, developerAccountId),
          eq(teamTrackerDays.workspaceId, normalizedWorkspaceId),
          eq(teamTrackerItems.state, "in_progress")
        )
      );
    if (options.ifNoCurrent && currentRows.some((row) => row.item.id !== itemId)) {
      throw new HttpError(409, "Current work changed. Refresh Today before setting current work.");
    }

    const staleCurrentIds = currentRows
      .map((row) => row.item.id)
      .filter((id) => id !== itemId);
    if (staleCurrentIds.length > 0) {
      await db
        .update(teamTrackerItems)
        .set({ state: "planned", updatedAt: now })
        .where(inArray(teamTrackerItems.id, staleCurrentIds));
      for (const row of currentRows.filter((current) => current.item.id !== itemId)) {
        await this.emit(row.item, { type: "status", body: null, meta: { domain: "tracker_state", from: "in_progress", to: "planned", reason: "single_current" } }, { type: "system", accountId: actor.accountId });
        await this.emit(row.item, { type: "focus", body: null, meta: { action: "unset_current", date: row.date } }, { type: "system", accountId: actor.accountId });
      }
    }

    await db
      .update(teamTrackerItems)
      .set({ state: "in_progress", updatedAt: now, completedAt: null })
      .where(eq(teamTrackerItems.id, itemId));

    return [...currentRows.map((row) => row.item), ...affectedRows]
      .map((row) => row.managerDeskItemId)
      .filter((managerDeskItemId): managerDeskItemId is number => managerDeskItemId !== null);
  }
}
