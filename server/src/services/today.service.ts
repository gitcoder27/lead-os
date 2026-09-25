import { TaskKeysService } from "./task-keys.service";
import { TaskService } from "./task.service";
import { JiraDriftService, type JiraDriftEntry } from "./jira-drift.service";
import { performance } from "node:perf_hooks";
import type {
  FilterType,
  ManagerActionCommandRequest,
  ManagerActionCommandResponse,
  ManagerActionResponse,
  ManagerActionSnoozePreset,
  ManagerActionSurface,
  ManagerActionTarget,
  ManagerDeskItem,
  SyncStatus,
  TeamTrackerBoardResponse,
  TodayActionCommand,
  TodayActionGroup,
  TodayActionItem,
  TodayActionItemType,
  TodayActionSeverity,
  TodayActionTarget,
  TodayMeetingPrompt,
  TodayPromiseItem,
  TodayResponse,
  TodayRhythmState,
  TodayStandupPrompt,
  TodaySourceStatus,
  TodaySummaryMetric,
  TodayTeamPulseItem,
  TrackerAttentionActionItem,
  TrackerAttentionItem,
  TrackerDeveloperDay,
  TrackerWorkItem,
  UserRole,
} from "shared/types";
import { HttpError } from "../middleware/errorHandler";
import { IssueService, type TodayIssue } from "./issue.service";
import { ManagerDeskService } from "./manager-desk.service";
import { TeamTrackerService } from "./team-tracker.service";
import { normalizeWorkspaceId } from "./workspace.service";
import { logger } from "../utils/logger";

type SyncStatusSource = {
  getLastSyncLog: (workspaceId?: string) => Promise<{ completedAt: string | null; status: string; issuesSynced: number; errorMessage: string | null } | undefined>;
  getRuntimeStatus: (workspaceId?: string) => { status: "idle" | "syncing" | "error"; errorMessage?: string };
  isAutoSyncEnabled?: (workspaceId?: string) => Promise<boolean>;
};

type TodayCacheEntry = {
  expiresAt: number;
  promise: Promise<TodayBuildResult>;
};

type TodaySourceTimings = {
  issues: number;
  team: number;
  desk: number;
  sync: number;
  drift: number;
};

type TimedSourceResult<T> =
  | { status: "fulfilled"; value: T; durationMs: number }
  | { status: "rejected"; reason: unknown; durationMs: number };

type TodayBuildResult = {
  today: TodayResponse;
  sourceTimings: TodaySourceTimings;
  buildDurationMs: number;
};

export type TodayRequestResult = TodayBuildResult & {
  cacheStatus: "hit" | "miss";
  requestDurationMs: number;
};

type TodayServiceOptions = {
  todayCacheTtlMs?: number;
};

const defaultTodayCacheTtlMs = 10_000;

const openDeskStatuses = new Set<ManagerDeskItem["status"]>([
  "inbox",
  "planned",
  "in_progress",
  "waiting",
  "backlog",
]);
const carryForwardDeskStatuses = new Set<ManagerDeskItem["status"]>([
  "inbox",
  "planned",
  "in_progress",
  "waiting",
]);

const severityWeight: Record<TodayActionSeverity, number> = {
  critical: 5,
  warning: 4,
  info: 3,
  neutral: 2,
  success: 1,
};

const statusLabels: Record<string, string> = {
  on_track: "On track",
  at_risk: "At risk",
  blocked: "Blocked",
  waiting: "Waiting",
  done_for_today: "Done",
};

export class TodayService {
  private readonly todayCache = new Map<string, TodayCacheEntry>();
  private readonly todayCacheTtlMs: number;

  constructor(
    private readonly issueService: IssueService,
    private readonly teamTrackerService: TeamTrackerService,
    private readonly managerDeskService: ManagerDeskService,
    private readonly syncStatusSource?: SyncStatusSource,
    options: TodayServiceOptions = {},
  ) {
    this.todayCacheTtlMs = Math.max(0, options.todayCacheTtlMs ?? defaultTodayCacheTtlMs);
  }

  async getToday(managerAccountId: string, date: string, workspaceId?: string): Promise<TodayResponse> {
    return (await this.getTodayWithMetadata(managerAccountId, date, workspaceId)).today;
  }

  async getTodayWithMetadata(managerAccountId: string, date: string, workspaceId?: string): Promise<TodayRequestResult> {
    const requestStartedAt = performance.now();
    const cacheKey = this.todayCacheKey(managerAccountId, date, workspaceId);
    const cached = this.getCachedToday(cacheKey);
    if (cached) {
      const result = await cached;
      return {
        ...result,
        cacheStatus: "hit",
        requestDurationMs: performance.now() - requestStartedAt,
      };
    }

    const promise = this.buildToday(managerAccountId, date, workspaceId).catch((error) => {
      if (this.todayCache.get(cacheKey)?.promise === promise) {
        this.todayCache.delete(cacheKey);
      }
      throw error;
    });

    if (this.todayCacheTtlMs > 0) {
      this.todayCache.set(cacheKey, {
        expiresAt: Date.now() + this.todayCacheTtlMs,
        promise,
      });
    }

    const result = await promise;
    return {
      ...result,
      cacheStatus: "miss",
      requestDurationMs: performance.now() - requestStartedAt,
    };
  }

  clearTodayCache(workspaceId?: string): void {
    if (!workspaceId) {
      this.todayCache.clear();
      return;
    }

    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    for (const key of this.todayCache.keys()) {
      if (key.startsWith(`${normalizedWorkspaceId}:`)) {
        this.todayCache.delete(key);
      }
    }
  }

  private getCachedToday(cacheKey: string): Promise<TodayBuildResult> | undefined {
    if (this.todayCacheTtlMs <= 0) {
      return undefined;
    }

    const cached = this.todayCache.get(cacheKey);
    if (!cached) {
      return undefined;
    }

    if (cached.expiresAt <= Date.now()) {
      this.todayCache.delete(cacheKey);
      return undefined;
    }

    return cached.promise;
  }

  private todayCacheKey(managerAccountId: string, date: string, workspaceId?: string): string {
    return [
      normalizeWorkspaceId(workspaceId),
      managerAccountId,
      date,
    ].join(":");
  }

  private async buildToday(managerAccountId: string, date: string, workspaceId?: string): Promise<TodayBuildResult> {
    const buildStartedAt = performance.now();
    const [issueResult, teamResult, deskResult, syncResult, driftResult] = await Promise.all([
      measureSource(() => this.issueService.getTodaySnapshot(date, workspaceId)),
      measureSource(() => this.teamTrackerService.getBoard(date, { managerAccountId, workspaceId })),
      measureSource(() => this.managerDeskService.getTodayItems(managerAccountId, date, workspaceId)),
      measureSource(() => this.getSyncStatus(workspaceId)),
      // §8.1: the Jira drift signal only exists once Phase 3 is enabled — the
      // attention items deep-link into the canonical task drawer.
      measureSource(async () => (await new TaskKeysService().phase3Enabled(workspaceId))
        ? new JiraDriftService().list({ type: "manager", accountId: managerAccountId }, workspaceId, date)
        : []),
    ]);
    const sourceStatus: TodaySourceStatus = {
      issues: issueResult.status === "fulfilled" ? "ready" : "unavailable",
      team: teamResult.status === "fulfilled" ? "ready" : "unavailable",
      desk: deskResult.status === "fulfilled" ? "ready" : "unavailable",
      sync: syncResult.status === "fulfilled" ? "ready" : "unavailable",
      drift: driftResult.status === "fulfilled" ? "ready" : "unavailable",
    };
    const unavailableSources = Object.entries(sourceStatus)
      .filter(([, status]) => status === "unavailable")
      .map(([source]) => source);
    if (unavailableSources.length > 0) {
      logger.warn(
        { workspaceId: normalizeWorkspaceId(workspaceId), date, unavailableSources },
        "Today snapshot source unavailable"
      );
    }
    if (
      issueResult.status === "rejected" &&
      teamResult.status === "rejected" &&
      deskResult.status === "rejected"
    ) {
      throw new AggregateError(
        [issueResult.reason, teamResult.reason, deskResult.reason],
        "Today core sources are unavailable"
      );
    }

    const issueSnapshot = issueResult.status === "fulfilled"
      ? issueResult.value
      : { issues: [], activeDefects: 0, dueToday: 0 };
    const teamBoard = teamResult.status === "fulfilled" ? teamResult.value : emptyTeamBoard(date);
    const deskItems = deskResult.status === "fulfilled" ? deskResult.value : [];
    const syncStatus = syncResult.status === "fulfilled" ? syncResult.value : undefined;
    const jiraDrift = driftResult.status === "fulfilled" ? driftResult.value : [];
    const issues = issueSnapshot.issues;

    const followUps = getDueFollowUps(deskItems, date);
    const meetings = getMeetingPrompts(deskItems, date);
    const actionItems = rankActionItems([
      ...buildDeveloperActions(teamBoard, date),
      ...buildIssueActions(issues, date),
      ...buildFollowUpActions(followUps, date),
      ...buildMeetingActions(meetings),
      ...buildDeskCarryForwardActions(deskItems, date),
      ...buildJiraDriftActions(jiraDrift),
      ...buildSyncActions(syncStatus),
    ]);
    const visibleActions = actionItems.slice(0, 20);

    const today: TodayResponse = {
      date,
      generatedAt: new Date().toISOString(),
      rhythm: getRhythmState(new Date()),
      summary: buildSummary({
        attentionCount: visibleActions.filter((item) => item.type !== "calm").length,
        activeDefects: issueSnapshot.activeDefects,
        teamSize: teamBoard.summary.total,
        staleCheckIns: teamBoard.summary.stale,
        dueToday: issueSnapshot.dueToday,
        followUpsDue: followUps.length,
        syncStatus,
        issuesAvailable: sourceStatus.issues === "ready",
        teamAvailable: sourceStatus.team === "ready",
        deskAvailable: sourceStatus.desk === "ready",
      }),
      currentPriority: visibleActions[0] ?? buildCalmAction(date),
      actionItems: visibleActions.length > 0 ? visibleActions : [buildCalmAction(date)],
      teamPulse: buildTeamPulse(teamBoard, date).slice(0, 10),
      promises: followUps.map((item) => buildPromiseItem(item, date)).slice(0, 10),
      standupPrompts: buildStandupPrompts(teamBoard, issues, followUps, date).slice(0, 8),
      meetingPrompts: meetings.map((item) => buildMeetingPrompt(item)).slice(0, 8),
      syncStatus,
      isPartial: unavailableSources.length > 0,
      sourceStatus,
    };
    const buildDurationMs = performance.now() - buildStartedAt;
    const sourceTimings = {
      issues: issueResult.durationMs,
      team: teamResult.durationMs,
      desk: deskResult.durationMs,
      sync: syncResult.durationMs,
      drift: driftResult.durationMs,
    };

    if (buildDurationMs >= 1_000) {
      logger.warn(
        {
          workspaceId: normalizeWorkspaceId(workspaceId),
          date,
          buildDurationMs: Math.round(buildDurationMs),
          sourceTimings: roundSourceTimings(sourceTimings),
          issueCount: issues.length,
          developerCount: teamBoard.developers.length,
          deskItemCount: deskItems.length,
        },
        "Slow Today snapshot build"
      );
    }

    return { today, sourceTimings, buildDurationMs };
  }

  async getManagerActions(
    managerAccountId: string,
    date: string,
    params: { surface?: ManagerActionSurface; limit?: number } = {},
    workspaceId?: string,
  ): Promise<ManagerActionResponse> {
    const surface = params.surface ?? "header";
    const today = await this.getToday(managerAccountId, date, workspaceId);
    const actionable = today.actionItems.filter((item) => item.type !== "calm");
    const source = surface === "header" ? actionable : today.actionItems;
    const limit = Math.max(1, Math.min(params.limit ?? (surface === "header" ? 8 : 20), 50));

    return {
      date,
      generatedAt: today.generatedAt,
      surface,
      actions: source.slice(0, limit),
      urgentCount: actionable.filter((item) => item.severity === "critical" || item.severity === "warning").length,
      totalCount: actionable.length,
    };
  }

  async executeCommand(
    managerAccountId: string,
    request: ManagerActionCommandRequest,
    actor: { type: UserRole; accountId?: string },
    workspaceId?: string,
  ): Promise<ManagerActionCommandResponse> {
    const response = await this.executeCommandInternal(managerAccountId, request, actor, workspaceId);
    this.clearTodayCache(workspaceId);
    return response;
  }

  private async executeCommandInternal(
    managerAccountId: string,
    request: ManagerActionCommandRequest,
    actor: { type: UserRole; accountId?: string },
    workspaceId?: string,
  ): Promise<ManagerActionCommandResponse> {
    const { command, date } = request;
    const { target: actionTarget } = command;
    if (actionTarget.taskKey && await new TaskKeysService().canonicalEnabled(workspaceId)) {
      const tasks = new TaskService();
      const principal = { type: "manager" as const, accountId: managerAccountId, workspaceId };
      if (command.kind === "mark_done" || command.kind === "set_current_work" || command.kind === "snooze" || command.kind === "carry_forward" || command.kind === "capture_meeting_outcome") {
        const updates = command.kind === "mark_done" ? { status: "done" as const }
          : command.kind === "set_current_work" ? { status: "active" as const }
          : command.kind === "snooze" ? { followUpAt: buildSnoozeIso(date, request.preset ?? "tomorrow") }
          : command.kind === "capture_meeting_outcome" ? { outcome: requireTrimmedText(request.outcome, "outcome") }
          : { scheduledOn: date };
        const result = command.kind === "set_current_work" ? await tasks.setCurrent(actionTarget.taskKey, principal, true) : await tasks.update(actionTarget.taskKey, updates, principal);
        return commandResponse(command.kind, actionTarget, await tasks.toDto(result, principal));
      }
    }

    switch (command.kind) {
      case "open":
      case "assign_owner":
      case "ask_check_in":
        return commandResponse(command.kind, actionTarget);

      case "mark_done": {
        const itemId = requireManagerDeskItemId(actionTarget, command.kind);
        const result = await this.managerDeskService.updateItem(
          managerAccountId,
          itemId,
          { status: "done" },
          workspaceId,
        );
        return commandResponse(command.kind, actionTarget, result);
      }

      case "snooze": {
        const itemId = requireManagerDeskItemId(actionTarget, command.kind);
        const result = await this.managerDeskService.updateItem(
          managerAccountId,
          itemId,
          { followUpAt: buildSnoozeIso(date, request.preset ?? "tomorrow") },
          workspaceId,
          undefined,
          { scheduleVia: "snooze" },
        );
        return commandResponse(command.kind, actionTarget, result);
      }

      case "add_check_in": {
        const developerAccountId = requireDeveloperAccountId(actionTarget, command.kind);
        const summary = requireTrimmedText(request.summary, "summary");
        const result = await this.teamTrackerService.addCheckIn(
          developerAccountId,
          date,
          { summary, taskKeys: request.taskKeys },
          actor,
          workspaceId,
        );
        return commandResponse(command.kind, actionTarget, result);
      }

      case "set_current_work": {
        const itemId = requireTrackerItemId(actionTarget, command.kind);
        const result = await this.teamTrackerService.setCurrentItem(
          itemId,
          { ifNoCurrent: true },
          workspaceId,
          { type: "system", accountId: actor.accountId ?? managerAccountId },
        );
        return commandResponse(command.kind, actionTarget, result);
      }

      case "capture_follow_up": {
        const title = requireTrimmedText(request.title, "title");
        const result = await this.managerDeskService.createItem(
          managerAccountId,
          { ...buildFollowUpCreateParams(date, actionTarget, title), source: "today", actor: { type: "manager", accountId: managerAccountId } },
          workspaceId,
        );
        return commandResponse(command.kind, actionTarget, result);
      }

      case "carry_forward": {
        const itemId = requireManagerDeskItemId(actionTarget, command.kind);
        const result = await this.managerDeskService.carryForward(
          managerAccountId,
          {
            fromDate: actionTarget.date ?? date,
            toDate: date,
            itemIds: [itemId],
          },
          workspaceId,
        );
        return commandResponse(command.kind, actionTarget, { updated: result });
      }

      case "capture_meeting_outcome": {
        const itemId = requireManagerDeskItemId(actionTarget, command.kind);
        const outcome = requireTrimmedText(request.outcome, "outcome");
        const result = await this.managerDeskService.updateItem(
          managerAccountId,
          itemId,
          { outcome, status: "done" },
          workspaceId,
        );
        return commandResponse(command.kind, actionTarget, result);
      }

      default:
        throw new HttpError(400, "Unsupported manager action command");
    }
  }

  private async getSyncStatus(workspaceId?: string): Promise<SyncStatus | undefined> {
    if (!this.syncStatusSource) {
      return undefined;
    }

    const [latest, runtime, autoSyncEnabled] = await Promise.all([
      this.syncStatusSource.getLastSyncLog(workspaceId),
      Promise.resolve(this.syncStatusSource.getRuntimeStatus(workspaceId)),
      this.syncStatusSource.isAutoSyncEnabled?.(workspaceId) ?? Promise.resolve(true),
    ]);
    const status = runtime.status === "syncing" || runtime.status === "error"
      ? runtime.status
      : latest?.status === "error"
      ? "error"
      : "idle";

    return {
      lastSyncedAt: latest?.completedAt ?? undefined,
      status,
      issuesSynced: latest?.issuesSynced,
      errorMessage: runtime.errorMessage ?? latest?.errorMessage ?? undefined,
      autoSyncEnabled,
    };
  }
}

function buildSummary(params: {
  attentionCount: number;
  activeDefects: number;
  teamSize: number;
  staleCheckIns: number;
  dueToday: number;
  followUpsDue: number;
  syncStatus?: SyncStatus;
  issuesAvailable: boolean;
  teamAvailable: boolean;
  deskAvailable: boolean;
}): TodaySummaryMetric[] {
  const metrics: Array<TodaySummaryMetric | undefined> = [
    metric("attention", "Attention", params.attentionCount, "action rows", params.attentionCount > 0 ? "warning" : "success"),
    params.issuesAvailable
      ? metric("work", "Active defects", params.activeDefects, "in Work", "neutral", target("view", "work"))
      : undefined,
    params.teamAvailable
      ? metric("team", "People", params.teamSize, "on team", "info", target("view", "team"))
      : undefined,
    params.teamAvailable
      ? metric("stale", "Stale check-ins", params.staleCheckIns, "need update", params.staleCheckIns > 0 ? "warning" : "neutral", target("view", "team"))
      : undefined,
    params.issuesAvailable
      ? metric("due-work", "Due today", params.dueToday, "defects", params.dueToday > 0 ? "warning" : "neutral", target("view", "work", { filter: "dueToday" }))
      : undefined,
    params.deskAvailable
      ? metric("promises", "Follow-ups", params.followUpsDue, "due now", params.followUpsDue > 0 ? "warning" : "neutral", target("view", "follow-ups"))
      : undefined,
  ];

  return metrics.filter((item): item is TodaySummaryMetric => Boolean(item)).concat(params.syncStatus?.status === "error"
    ? [metric("sync", "Sync", 1, "needs review", "critical", target("view", "settings"))]
    : []);
}

function emptyTeamBoard(date: string): TeamTrackerBoardResponse {
  const summary = {
    total: 0,
    blocked: 0,
    atRisk: 0,
    waiting: 0,
    stale: 0,
    noCurrent: 0,
    overdueLinkedWork: 0,
    statusFollowUp: 0,
    doneForToday: 0,
  };
  return {
    date,
    viewMode: "live",
    developers: [],
    inactiveDevelopers: [],
    summary,
    visibleSummary: summary,
    groups: [],
    query: { q: "", summaryFilter: "all", sortBy: "attention", groupBy: "none" },
    attentionQueue: [],
  };
}

function metric(
  id: string,
  label: string,
  value: number,
  detail: string,
  severity: TodayActionSeverity,
  actionTarget?: TodayActionTarget,
): TodaySummaryMetric {
  return { id, label, value, detail, severity, target: actionTarget };
}

function buildDeveloperActions(board: TeamTrackerBoardResponse, date: string): TodayActionItem[] {
  const dayByDeveloper = new Map(board.developers.map((day) => [day.developer.accountId, day]));

  return board.attentionQueue.map((item) => {
    const day = dayByDeveloper.get(item.developer.accountId);
    const reasons = item.reasons.map((reason) => reason.label);
    const leadReason = item.reasons[0]?.code;
    const severity: TodayActionSeverity = item.status === "blocked" || item.signals.risk.openRisk ? "critical" : "warning";
    const actionType: TodayActionItemType = item.isStale ? "stale_check_in" : "developer_attention";
    const currentWork = item.currentItem?.jiraKey
      ? `${item.currentItem.jiraKey} ${item.currentItem.title}`
      : item.currentItem?.title ?? "No current work";
    const primary = getDeveloperAttentionPrimary(item, date, day);
    const actionTarget = primary.target;

    return action({
      id: `today-dev-${item.developer.accountId}-${leadReason ?? "attention"}`,
      type: actionType,
      title: item.developer.displayName,
      context: currentWork,
      signal: reasons.slice(0, 2).join(" / ") || "Needs attention",
      severity,
      priority: item.status === "blocked" ? 100 : item.isStale && !item.hasCurrentItem ? 78 : 86,
      group: severity === "critical" ? "now" : "next",
      target: actionTarget,
      primaryKind: primary.kind,
      primaryLabel: primary.label,
      secondaryKinds: primary.secondaryKinds,
      freshness: formatFreshness(day?.lastCheckInAt ?? item.lastCheckInAt),
      actionPreview: primary.actionPreview,
    });
  });
}

function getDeveloperAttentionPrimary(
  item: TrackerAttentionItem,
  date: string,
  day?: TrackerDeveloperDay,
): {
  kind: TodayActionCommand["kind"];
  label: string;
  target: TodayActionTarget;
  secondaryKinds: TodayActionCommand["kind"][];
  actionPreview?: string;
} {
  const currentTarget = target("developer", "team", {
    developerAccountId: item.developer.accountId,
    trackerItemId: item.currentItem?.id,
    taskKey: item.currentItem?.taskKey ?? undefined,
    issueKey: item.currentItem?.jiraKey,
    relatedIssueKeys: item.currentItem?.relatedIssueKeys,
    date,
  });
  const setCurrentCandidate = !item.hasCurrentItem ? item.setCurrentCandidates[0] : undefined;

  if (setCurrentCandidate) {
    return {
      kind: "set_current_work",
      label: "Set current",
      target: target("tracker_item", "team", {
        developerAccountId: item.developer.accountId,
        trackerItemId: setCurrentCandidate.id,
        taskKey: setCurrentCandidate.taskKey ?? undefined,
        issueKey: setCurrentCandidate.jiraKey,
        relatedIssueKeys: setCurrentCandidate.relatedIssueKeys,
        date,
      }),
      secondaryKinds: ["open", "capture_follow_up"],
      actionPreview: formatSetCurrentPreview(setCurrentCandidate),
    };
  }

  if (shouldRequestDeveloperCheckIn({
    date,
    day,
    lastCheckInAt: day?.lastCheckInAt ?? item.lastCheckInAt,
    isStale: item.isStale,
    status: item.status,
  })) {
    return {
      kind: "add_check_in",
      label: "Add check-in",
      target: currentTarget,
      secondaryKinds: ["capture_follow_up", "open"],
    };
  }

  return {
    kind: "open",
    label: "Open developer",
    target: currentTarget,
    secondaryKinds: ["capture_follow_up"],
  };
}

function getDeveloperPulsePrimary(
  day: TrackerDeveloperDay,
  attentionItem: TrackerAttentionItem | undefined,
  date: string,
): {
  kind: TodayActionCommand["kind"];
  label: string;
  target: TodayActionTarget;
  secondaryKinds: TodayActionCommand["kind"][];
  actionPreview?: string;
} {
  const openTarget = target("developer", "team", {
    developerAccountId: day.developer.accountId,
    trackerItemId: day.currentItem?.id,
    taskKey: day.currentItem?.taskKey ?? undefined,
    issueKey: day.currentItem?.jiraKey,
    relatedIssueKeys: day.currentItem?.relatedIssueKeys,
    date,
  });
  const setCurrentCandidate = attentionItem?.setCurrentCandidates[0] ?? (!day.currentItem ? day.plannedItems[0] : undefined);

  if (!day.currentItem && setCurrentCandidate) {
    return {
      kind: "set_current_work",
      label: "Set current",
      target: target("tracker_item", "team", {
        developerAccountId: day.developer.accountId,
        trackerItemId: setCurrentCandidate.id,
        taskKey: setCurrentCandidate.taskKey ?? undefined,
        issueKey: setCurrentCandidate.jiraKey,
        relatedIssueKeys: setCurrentCandidate.relatedIssueKeys,
        date,
      }),
      secondaryKinds: ["open", "capture_follow_up"],
      actionPreview: formatSetCurrentPreview(setCurrentCandidate),
    };
  }

  if (shouldRequestDeveloperCheckIn({
    date,
    day,
    lastCheckInAt: day.lastCheckInAt,
    isStale: day.isStale || Boolean(attentionItem?.isStale),
    status: day.status,
  })) {
    return {
      kind: "add_check_in",
      label: "Check-in",
      target: openTarget,
      secondaryKinds: ["capture_follow_up", "open"],
    };
  }

  return {
    kind: "open",
    label: "Open",
    target: openTarget,
    secondaryKinds: ["capture_follow_up"],
  };
}

function buildIssueActions(issues: TodayIssue[], date: string): TodayActionItem[] {
  return issues
    .filter((issue) => issue.statusCategory.toLowerCase() !== "done")
    .filter((issue) => isOverdue(issueDueDate(issue), date) || isDueToday(issueDueDate(issue), date) || !issue.assigneeId || isHighPriority(issue))
    .map((issue) => {
      const dueDate = issueDueDate(issue);
      const overdue = isOverdue(dueDate, date);
      const dueToday = isDueToday(dueDate, date);
      const unassigned = !issue.assigneeId;
      const severity: TodayActionSeverity = overdue ? "critical" : dueToday ? "warning" : unassigned ? "info" : "warning";
      const itemType: TodayActionItemType = overdue ? "overdue_issue" : dueToday ? "due_issue" : unassigned ? "unassigned_issue" : "manual_work";
      const filter: FilterType = overdue ? "overdue" : dueToday ? "dueToday" : unassigned ? "unassigned" : "highPriority";
      const actionTarget = target("issue", "work", { issueKey: issue.jiraKey, filter, date });
      const signals = [
        overdue ? "Overdue" : undefined,
        dueToday ? "Due today" : undefined,
        unassigned ? "Unassigned" : undefined,
        isHighPriority(issue) ? "High priority" : undefined,
      ].filter(Boolean).join(" / ");

      return action({
        id: `today-issue-${issue.jiraKey}`,
        type: itemType,
        title: `${issue.jiraKey} ${issue.summary}`,
        context: issue.assigneeName ? `${issue.assigneeName} / ${issue.statusName}` : issue.statusName,
        signal: signals,
        severity,
        priority: overdue && !unassigned ? 92 : overdue ? 90 : dueToday ? 72 : unassigned ? 70 : 66,
        group: overdue || dueToday ? "now" : "next",
        target: actionTarget,
        primaryKind: unassigned ? "assign_owner" : "open",
        primaryLabel: unassigned ? "Assign owner" : "Open issue",
        secondaryKinds: ["capture_follow_up"],
      });
    });
}

function buildFollowUpActions(items: ManagerDeskItem[], date: string): TodayActionItem[] {
  return items.map((item) => {
    const actionTarget = target("follow_up", "follow-ups", {
      managerDeskItemId: item.id,
      taskKey: item.taskKey ?? undefined,
      date: item.originDate || date,
    });

    return action({
      id: `today-follow-up-${item.id}`,
      type: "follow_up_due",
      title: item.title,
      context: getLinkedContext(item) ?? item.nextAction ?? "Manager follow-up",
      signal: isOverdue(item.followUpAt, date) ? "Overdue follow-up" : "Due follow-up",
      severity: isOverdue(item.followUpAt, date) ? "critical" : "warning",
      priority: isOverdue(item.followUpAt, date) ? 96 : 88,
      group: "now",
      target: actionTarget,
      primaryKind: "mark_done",
      primaryLabel: "Done",
      secondaryKinds: ["snooze", "open"],
      freshness: item.followUpAt ? formatIsoDateSignal(item.followUpAt, date) : undefined,
    });
  });
}

function buildMeetingActions(items: ManagerDeskItem[]): TodayActionItem[] {
  return items.map((item) => {
    const actionTarget = target("meeting", "meetings", {
      managerDeskItemId: item.id,
      taskKey: item.taskKey ?? undefined,
      date: item.originDate,
    });

    return action({
      id: `today-meeting-${item.id}`,
      type: "meeting_outcome",
      title: item.title,
      context: item.participants || item.nextAction || "Meeting memory",
      signal: "Needs outcome",
      severity: item.priority === "critical" || item.priority === "high" ? "warning" : "info",
      priority: 62,
      group: "later",
      target: actionTarget,
      primaryKind: "capture_meeting_outcome",
      primaryLabel: "Capture outcome",
      secondaryKinds: ["capture_follow_up", "open"],
    });
  });
}

function buildDeskCarryForwardActions(items: ManagerDeskItem[], date: string): TodayActionItem[] {
  return items
    .filter((item) => isCarryForwardDeskItem(item))
    .filter((item) => item.kind !== "meeting" && item.category !== "follow_up")
    .filter((item) => isBeforeDay(item.originDate, date) || isBeforeDay(item.plannedEndAt, date) || isBeforeDay(item.plannedStartAt, date))
    .map((item) => {
      const actionTarget = target("manager_desk_item", "desk", {
        managerDeskItemId: item.id,
        taskKey: item.taskKey ?? undefined,
        date: item.originDate,
      });

      return action({
        id: `today-desk-carry-${item.id}`,
        type: "desk_carry_forward",
        title: item.title,
        context: getLinkedContext(item) ?? item.contextNote ?? "Open Manager Desk item",
        signal: "Carry forward",
        severity: item.priority === "critical" ? "critical" : "info",
        priority: item.priority === "critical" ? 74 : 58,
        group: "next",
        target: actionTarget,
        primaryKind: "carry_forward",
        primaryLabel: "Carry forward",
        secondaryKinds: ["mark_done", "open"],
      });
    });
}

/**
 * §8.1: read-only Jira drift signals — one attention item per drifted task.
 * The signal never writes; the manager resolves the disagreement manually.
 */
function buildJiraDriftActions(entries: JiraDriftEntry[]): TodayActionItem[] {
  return entries.slice(0, 5).map((entry) =>
    action({
      id: `jira-drift-${entry.taskKey}`,
      type: "jira_drift",
      title: `${entry.taskKey} ${entry.title}`,
      context:
        entry.direction === "jira_done_task_open"
          ? `${entry.jiraKey} is done in Jira — this task is still open`
          : `${entry.jiraKey} is still open in Jira — this task was closed`,
      signal: entry.direction === "jira_done_task_open" ? "Done in Jira, open here" : "Closed here, open in Jira",
      severity: "warning",
      priority: 55,
      group: "next",
      target: target("view", "tasks", { taskKey: entry.taskKey }),
      primaryKind: "open",
      primaryLabel: "Open task",
      secondaryKinds: [],
    }),
  );
}

function buildSyncActions(syncStatus?: SyncStatus): TodayActionItem[] {
  if (syncStatus?.status !== "error") {
    return [];
  }

  return [
    action({
      id: "today-sync-error",
      type: "sync_attention",
      title: "Jira sync needs review",
      context: syncStatus.errorMessage ?? "Last sync failed",
      signal: "Sync issue",
      severity: "critical",
      priority: 98,
      group: "now",
      target: target("view", "settings"),
      primaryKind: "open",
      primaryLabel: "Open settings",
      secondaryKinds: [],
    }),
  ];
}

function buildTeamPulse(board: TeamTrackerBoardResponse, date: string): TodayTeamPulseItem[] {
  const attentionByDeveloper = new Map(board.attentionQueue.map((item) => [item.developer.accountId, item]));

  return board.developers
    .filter((day) => attentionByDeveloper.has(day.developer.accountId) || day.isStale || !day.currentItem)
    .sort((left, right) => {
      const leftAttention = attentionByDeveloper.get(left.developer.accountId);
      const rightAttention = attentionByDeveloper.get(right.developer.accountId);
      return (rightAttention ? 1 : 0) - (leftAttention ? 1 : 0) || left.developer.displayName.localeCompare(right.developer.displayName);
    })
    .map((day) => {
      const attentionItem = attentionByDeveloper.get(day.developer.accountId);
      const pulseTarget = target("developer", "team", {
        developerAccountId: day.developer.accountId,
        trackerItemId: day.currentItem?.id,
    taskKey: day.currentItem?.taskKey ?? undefined,
        issueKey: day.currentItem?.jiraKey,
        relatedIssueKeys: day.currentItem?.relatedIssueKeys,
        date,
      });
      const primary = getDeveloperPulsePrimary(day, attentionItem, date);

      return {
        accountId: day.developer.accountId,
        displayName: day.developer.displayName,
        initials: getInitials(day.developer.displayName),
        status: statusLabels[day.status] ?? day.status.replace(/_/g, " "),
        tone: day.status === "blocked" ? "critical" : day.status === "at_risk" || day.isStale ? "warning" : !day.currentItem ? "info" : "neutral",
        detail: attentionItem?.reasons[0]?.label ?? (day.isStale ? "Stale check-in" : "Needs current work"),
        currentWork: day.currentItem?.jiraKey
          ? `${day.currentItem.jiraKey} ${day.currentItem.title}`
          : day.currentItem?.title ?? "No current work",
        lastUpdate: formatFreshness(day.lastCheckInAt) ?? "No check-in",
        target: primary.target,
        primaryAction: command(primary.kind, primary.label, primary.target),
        secondaryActions: primary.secondaryKinds.map((kind) => command(kind, commandLabel(kind), pulseTarget)),
        actionPreview: primary.actionPreview,
      };
    });
}

function buildPromiseItem(item: ManagerDeskItem, date: string): TodayPromiseItem {
  const promiseTarget = target("follow_up", "follow-ups", {
    managerDeskItemId: item.id,
    taskKey: item.taskKey ?? undefined,
    date: item.originDate || date,
  });

  return {
    id: `promise-${item.id}`,
    title: item.title,
    detail: item.followUpAt ? formatIsoDateSignal(item.followUpAt, date) : "Due now",
    severity: isOverdue(item.followUpAt, date) ? "critical" : "warning",
    target: promiseTarget,
    primaryAction: command("mark_done", "Done", promiseTarget),
    secondaryActions: [command("snooze", "Snooze", promiseTarget), command("open", "Open", promiseTarget)],
  };
}

function buildMeetingPrompt(item: ManagerDeskItem): TodayMeetingPrompt {
  const meetingTarget = target("meeting", "meetings", {
    managerDeskItemId: item.id,
    taskKey: item.taskKey ?? undefined,
    date: item.originDate,
  });

  return {
    id: `meeting-${item.id}`,
    title: item.title,
    detail: item.participants || "Needs captured outcome",
    severity: item.priority === "critical" || item.priority === "high" ? "warning" : "info",
    target: meetingTarget,
    primaryAction: command("capture_meeting_outcome", "Outcome", meetingTarget),
    secondaryActions: [command("capture_follow_up", "Follow up", meetingTarget), command("open", "Open", meetingTarget)],
  };
}

function buildStandupPrompts(
  board: TeamTrackerBoardResponse,
  issues: TodayIssue[],
  followUps: ManagerDeskItem[],
  date: string,
): TodayStandupPrompt[] {
  const dayByDeveloper = new Map(board.developers.map((day) => [day.developer.accountId, day]));
  const peoplePrompts = board.attentionQueue.slice(0, 3).map((item) => {
    const day = dayByDeveloper.get(item.developer.accountId);
    const primary = getDeveloperAttentionPrimary(item, date, day);

    return {
      id: `standup-dev-${item.developer.accountId}`,
      title: item.developer.displayName,
      detail: item.reasons[0]?.label ?? "Needs manager attention",
      severity: item.status === "blocked" ? "critical" as const : "warning" as const,
      target: primary.target,
      primaryAction: command(primary.kind, primary.label, primary.target),
    };
  });
  const issuePrompts = issues
    .filter((issue) => isOverdue(issueDueDate(issue), date) || isDueToday(issueDueDate(issue), date))
    .slice(0, 3)
    .map((issue) => {
      const issueTarget = target("issue", "work", { issueKey: issue.jiraKey, filter: isOverdue(issueDueDate(issue), date) ? "overdue" : "dueToday", date });
      return {
        id: `standup-issue-${issue.jiraKey}`,
        title: issue.jiraKey,
        detail: issue.summary,
        severity: isOverdue(issueDueDate(issue), date) ? "critical" as const : "warning" as const,
        target: issueTarget,
        primaryAction: command("open", "Open", issueTarget),
      };
    });
  const promisePrompts = followUps.slice(0, 2).map((item) => {
    const promiseTarget = target("follow_up", "follow-ups", { managerDeskItemId: item.id, taskKey: item.taskKey ?? undefined, date: item.originDate || date });
    return {
      id: `standup-follow-up-${item.id}`,
      title: item.title,
      detail: "Promise due",
      severity: isOverdue(item.followUpAt, date) ? "critical" as const : "warning" as const,
      target: promiseTarget,
      primaryAction: command("open", "Open", promiseTarget),
    };
  });

  return [...peoplePrompts, ...issuePrompts, ...promisePrompts];
}

function getMeetingPrompts(items: ManagerDeskItem[], date: string): ManagerDeskItem[] {
  return items
    .filter((item) => isOpenDeskItem(item))
    .filter((item) => item.kind === "meeting")
    .filter((item) => !item.outcome?.trim())
    .filter((item) => !isAfterDay(item.originDate, date))
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

function getDueFollowUps(items: ManagerDeskItem[], date: string): ManagerDeskItem[] {
  return items
    .filter((item) => isOpenDeskItem(item))
    .filter((item) => item.category === "follow_up" || Boolean(item.followUpAt))
    .filter((item) => !item.followUpAt || !isAfterDay(item.followUpAt, date))
    .sort((left, right) => (left.followUpAt ?? left.createdAt).localeCompare(right.followUpAt ?? right.createdAt));
}

function action(params: {
  id: string;
  type: TodayActionItemType;
  title: string;
  context: string;
  signal: string;
  severity: TodayActionSeverity;
  priority: number;
  group: TodayActionGroup;
  target: TodayActionTarget;
  primaryKind: TodayActionCommand["kind"];
  primaryLabel: string;
  secondaryKinds: TodayActionCommand["kind"][];
  freshness?: string;
  actionPreview?: string;
}): TodayActionItem {
  return {
    id: params.id,
    type: params.type,
    title: compactText(params.title, 120),
    context: compactText(params.context, 140),
    signal: compactText(params.signal, 80),
    severity: params.severity,
    priority: params.priority,
    group: params.group,
    target: params.target,
    primaryAction: command(params.primaryKind, params.primaryLabel, params.target),
    secondaryActions: params.secondaryKinds.map((kind) => command(kind, commandLabel(kind), params.target)),
    freshness: params.freshness,
    actionPreview: params.actionPreview ? compactText(params.actionPreview, 140) : undefined,
  };
}

function formatSetCurrentPreview(item: TrackerAttentionActionItem | TrackerWorkItem): string {
  return item.jiraKey ? `${item.jiraKey} ${item.title}` : item.title;
}

function command(kind: TodayActionCommand["kind"], label: string, actionTarget: TodayActionTarget): TodayActionCommand {
  return { kind, label, target: actionTarget, confirm: kind === "mark_done" || kind === "carry_forward" };
}

function commandLabel(kind: TodayActionCommand["kind"]): string {
  switch (kind) {
    case "add_check_in":
      return "Add check-in";
    case "ask_check_in":
      return "Ask check-in";
    case "assign_owner":
      return "Assign owner";
    case "capture_follow_up":
      return "Follow up";
    case "snooze":
      return "Snooze";
    case "mark_done":
      return "Done";
    case "carry_forward":
      return "Carry";
    case "capture_meeting_outcome":
      return "Outcome";
    case "set_current_work":
      return "Set current";
    default:
      return "Open";
  }
}

function target(type: TodayActionTarget["type"], view: TodayActionTarget["view"], extra: Partial<TodayActionTarget> = {}): TodayActionTarget {
  return { type, view, ...extra };
}

function rankActionItems(items: TodayActionItem[]): TodayActionItem[] {
  return items.sort((left, right) =>
    right.priority - left.priority ||
    severityWeight[right.severity] - severityWeight[left.severity] ||
    Number(hasDirectWriteAction(right)) - Number(hasDirectWriteAction(left)) ||
    left.title.localeCompare(right.title)
  );
}

function hasDirectWriteAction(item: TodayActionItem): boolean {
  return item.primaryAction.kind !== "open" && item.primaryAction.kind !== "assign_owner";
}

function buildCalmAction(date: string): TodayActionItem {
  const calmTarget = target("view", "team", { date });
  return action({
    id: "today-calm",
    type: "calm",
    title: "Team is calm",
    context: "No urgent signals",
    signal: "Clear",
    severity: "success",
    priority: 0,
    group: "later",
    target: calmTarget,
    primaryKind: "open",
    primaryLabel: "Open Team",
    secondaryKinds: [],
  });
}

function getRhythmState(now: Date): TodayRhythmState {
  const hour = now.getHours();
  if (hour < 10) {
    return { stage: "morning_plan", label: "Morning plan", detail: "Set direction" };
  }
  if (hour < 12) {
    return { stage: "standup_window", label: "Standup window", detail: "Clear blockers" };
  }
  if (hour < 16) {
    return { stage: "midday_check", label: "Midday check", detail: "Keep flow moving" };
  }
  return { stage: "wrap_up", label: "Wrap-up", detail: "Close loops" };
}

function issueDueDate(issue: TodayIssue): string | undefined {
  return issue.developmentDueDate ?? issue.dueDate;
}

function isHighPriority(issue: TodayIssue): boolean {
  return ["high", "highest"].includes(issue.priorityName.toLowerCase());
}

function isOpenDeskItem(item: ManagerDeskItem): boolean {
  return openDeskStatuses.has(item.status);
}

function isCarryForwardDeskItem(item: ManagerDeskItem): boolean {
  return carryForwardDeskStatuses.has(item.status);
}

function isDueToday(value: string | undefined, date: string): boolean {
  return toIsoDay(value) === date;
}

function isOverdue(value: string | undefined, date: string): boolean {
  const day = toIsoDay(value);
  return Boolean(day && day < date);
}

function isBeforeDay(value: string | undefined, date: string): boolean {
  const day = toIsoDay(value);
  return Boolean(day && day < date);
}

function isAfterDay(value: string | undefined, date: string): boolean {
  const day = toIsoDay(value);
  return Boolean(day && day > date);
}

function shouldRequestDeveloperCheckIn(params: {
  date: string;
  day?: TrackerDeveloperDay;
  lastCheckInAt?: string;
  isStale: boolean;
  status: TrackerDeveloperDay["status"];
}): boolean {
  if (hasTrackerCheckInForDate(params.day, params.lastCheckInAt, params.date)) {
    return false;
  }

  return params.isStale || params.status === "blocked" || params.status === "at_risk" || params.status === "waiting";
}

function hasTrackerCheckInForDate(day: TrackerDeveloperDay | undefined, lastCheckInAt: string | undefined, date: string): boolean {
  if ((day?.checkIns.length ?? 0) > 0) {
    return true;
  }

  return isDueToday(lastCheckInAt, date);
}

function toIsoDay(value?: string): string | undefined {
  if (!value) {
    return undefined;
  }
  return value.slice(0, 10);
}

function formatIsoDateSignal(value: string, date: string): string {
  const day = toIsoDay(value);
  if (!day) {
    return "Due";
  }
  if (day === date) {
    return "Due today";
  }
  if (day < date) {
    return `Overdue ${day}`;
  }
  return `Due ${day}`;
}

function formatFreshness(value?: string): string | undefined {
  if (!value) {
    return undefined;
  }

  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) {
    return undefined;
  }

  const hours = Math.max(Math.floor((Date.now() - timestamp) / 3_600_000), 0);
  if (hours < 1) {
    return "Just now";
  }
  if (hours < 24) {
    return `${hours}h ago`;
  }
  return `${Math.floor(hours / 24)}d ago`;
}

function getInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "??";
}

function getLinkedContext(item: ManagerDeskItem): string | undefined {
  const issueLink = item.links.find((link) => link.linkType === "issue" && link.issueKey);
  if (issueLink?.issueKey) {
    return issueLink.issueKey;
  }

  const developerLink = item.links.find((link) => link.linkType === "developer");
  return developerLink?.displayLabel;
}

function compactText(value: string, limit: number): string {
  if (value.length <= limit) {
    return value;
  }
  return `${value.slice(0, limit - 3).trim()}...`;
}

function commandResponse(
  kind: TodayActionCommand["kind"],
  actionTarget: ManagerActionTarget,
  result?: unknown,
): ManagerActionCommandResponse {
  return {
    success: true,
    command: kind,
    target: actionTarget,
    result,
  };
}

async function measureSource<T>(operation: () => Promise<T>): Promise<TimedSourceResult<T>> {
  const startedAt = performance.now();
  try {
    const value = await operation();
    return { status: "fulfilled", value, durationMs: performance.now() - startedAt };
  } catch (reason) {
    return { status: "rejected", reason, durationMs: performance.now() - startedAt };
  }
}

function roundSourceTimings(timings: TodaySourceTimings): TodaySourceTimings {
  return {
    drift: Math.round(timings.drift),
    issues: Math.round(timings.issues),
    team: Math.round(timings.team),
    desk: Math.round(timings.desk),
    sync: Math.round(timings.sync),
  };
}

function requireManagerDeskItemId(target: ManagerActionTarget, kind: TodayActionCommand["kind"]): number {
  if (!target.managerDeskItemId) {
    throw new HttpError(400, `${kind} requires a Manager Desk item target`);
  }
  return target.managerDeskItemId;
}

function requireDeveloperAccountId(target: ManagerActionTarget, kind: TodayActionCommand["kind"]): string {
  if (!target.developerAccountId?.trim()) {
    throw new HttpError(400, `${kind} requires a developer target`);
  }
  return target.developerAccountId;
}

function requireTrackerItemId(target: ManagerActionTarget, kind: TodayActionCommand["kind"]): number {
  if (!target.trackerItemId) {
    throw new HttpError(400, `${kind} requires a tracker item target`);
  }
  return target.trackerItemId;
}

function requireTrimmedText(value: string | undefined, field: string): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new HttpError(400, `${field} is required`);
  }
  return trimmed;
}

function buildSnoozeIso(date: string, preset: ManagerActionSnoozePreset): string {
  const base = new Date(`${date}T09:00:00`);
  if (preset === "later_today") {
    base.setHours(17, 0, 0, 0);
    return base.toISOString();
  }
  if (preset === "next_week") {
    base.setDate(base.getDate() + 7);
    return base.toISOString();
  }
  base.setDate(base.getDate() + 1);
  return base.toISOString();
}

function buildFollowUpCreateParams(date: string, actionTarget: ManagerActionTarget, title: string) {
  const links: Array<
    | { linkType: "developer"; developerAccountId: string }
    | { linkType: "issue"; issueKey: string }
  > = [];

  if (actionTarget.developerAccountId) {
    links.push({ linkType: "developer", developerAccountId: actionTarget.developerAccountId });
  }

  for (const issueKey of uniqueIssueKeys(actionTarget)) {
    links.push({ linkType: "issue", issueKey });
  }

  return {
    date,
    title,
    kind: "action" as const,
    category: "follow_up" as const,
    status: "planned" as const,
    priority: "medium" as const,
    contextNote: actionTarget.taskKey ? `Follow-up for ${actionTarget.taskKey}` : undefined,
    links,
  };
}

function uniqueIssueKeys(actionTarget: ManagerActionTarget): string[] {
  const issueKeys = [actionTarget.issueKey, ...(actionTarget.relatedIssueKeys ?? [])]
    .map((issueKey) => issueKey?.trim())
    .filter((issueKey): issueKey is string => Boolean(issueKey));

  return [...new Set(issueKeys)];
}
