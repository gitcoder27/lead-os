import { TaskKeysService } from "./task-keys.service";
import { TaskService } from "./task.service";
import { JiraDriftService, type JiraDriftEntry } from "./jira-drift.service";
import { OneOnOneService } from "./one-on-one.service";
import { performance } from "node:perf_hooks";
import type {
  FilterType,
  ManagerActionCommandRequest,
  ManagerActionCommandResponse,
  ManagerActionResponse,
  ManagerActionSnoozePreset,
  ManagerActionSurface,
  ManagerActionRestore,
  ManagerActionTarget,
  ManagerActionUndo,
  ManagerDeskItem,
  SyncStatus,
  TeamTrackerAttentionSnapshot,
  TodayActionCommand,
  TodayActionGroup,
  TodayActionItem,
  TodayActionItemType,
  TodayActionSeverity,
  TodayActionTarget,
  TodayCheckInAsk,
  TodayDelta,
  TodayDeltaIssue,
  TodayFocus,
  TodayFocusPerson,
  TodayMeetingPrompt,
  OneOnOneDueSignal,
  TodayPromiseItem,
  TodayResponse,
  TodayRhythmBoundaries,
  TodayRhythmSettings,
  TodayRhythmState,
  TodayStandupFocus,
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
import { isStaleIssue } from "./issue-rules";
import { ManagerDeskService } from "./manager-desk.service";
import { TeamTrackerService } from "./team-tracker.service";
import { normalizeWorkspaceId } from "./workspace.service";
import { logger } from "../utils/logger";
import { addDaysToIsoDay, getRhythmState, resolveTimeZone, toZonedIsoDay, zonedTimeToUtc } from "./today-clock";
import { parseInstant, TodayStateService, type CheckInSince, type StandupSessionSummary } from "./today-state.service";

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
  one_on_one: number;
  state: number;
};

type TodayBuildContext = {
  tz: string;
  /** Delta anchor — last activity before the current visit. */
  baselineAt?: string;
  /** Only the `/` page's own read computes the since-last-visit delta. */
  withDelta: boolean;
};

type TodayStateSnapshot = {
  phase3: boolean;
  rhythm: TodayRhythmSettings;
  standup?: StandupSessionSummary;
  asks: TodayCheckInAsk[];
  delta?: { checkIns: CheckInSince[]; resolvedCount: number };
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
  oneOnOneService?: OneOnOneService;
  stateService?: TodayStateService;
};

const defaultTodayCacheTtlMs = 25_000;
const VISIBLE_ACTION_LIMIT = 20;
/** docs/53 F13: rows past the visible cut shipped for in-place expansion. */
const OVERFLOW_ACTION_LIMIT = 80;
/** Delta lists stay short — counts carry the full number. */
const DELTA_ITEM_LIMIT = 5;
/** docs/53 §5: midday "due soon" window. */
const DUE_SOON_MS = 2 * 60 * 60 * 1000;

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

export type TodayRequestOptions = {
  /** Manager IANA zone (docs/53 F5); invalid/absent → server zone. */
  tz?: string;
  /** Touch the since-last-visit anchor (only the `/` page's own read does). */
  recordVisit?: boolean;
};

export class TodayService {
  private readonly todayCache = new Map<string, TodayCacheEntry>();
  private readonly todayCacheTtlMs: number;
  private readonly oneOnOneService?: OneOnOneService;
  private readonly stateService: TodayStateService;

  constructor(
    private readonly issueService: IssueService,
    private readonly teamTrackerService: TeamTrackerService,
    private readonly managerDeskService: ManagerDeskService,
    private readonly syncStatusSource?: SyncStatusSource,
    options: TodayServiceOptions = {},
  ) {
    this.todayCacheTtlMs = Math.max(0, options.todayCacheTtlMs ?? defaultTodayCacheTtlMs);
    this.oneOnOneService = options.oneOnOneService;
    this.stateService = options.stateService ?? new TodayStateService();
  }

  get state(): TodayStateService {
    return this.stateService;
  }

  async getToday(managerAccountId: string, date: string, workspaceId?: string, options: TodayRequestOptions = {}): Promise<TodayResponse> {
    return (await this.getTodayWithMetadata(managerAccountId, date, workspaceId, options)).today;
  }

  async getTodayWithMetadata(
    managerAccountId: string,
    date: string,
    workspaceId?: string,
    options: TodayRequestOptions = {},
  ): Promise<TodayRequestResult> {
    const requestStartedAt = performance.now();
    const tz = resolveTimeZone(options.tz);
    // The visit anchor only moves on a new visit, so it is part of the cache
    // key without defeating the cache between polls.
    const baselineAt = options.recordVisit
      ? await this.stateService.recordVisit(managerAccountId, workspaceId).catch((error: unknown) => {
        logger.warn({ err: error }, "Today visit anchor unavailable");
        return undefined;
      })
      : undefined;
    const context: TodayBuildContext = { tz, baselineAt, withDelta: Boolean(options.recordVisit) };
    const cacheKey = this.todayCacheKey(managerAccountId, date, workspaceId, context);
    const cached = this.getCachedToday(cacheKey);
    if (cached) {
      const result = await cached;
      return {
        ...result,
        cacheStatus: "hit",
        requestDurationMs: performance.now() - requestStartedAt,
      };
    }

    const promise = this.buildToday(managerAccountId, date, workspaceId, context).catch((error) => {
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

  async getRhythmSettings(workspaceId?: string): Promise<TodayRhythmSettings> {
    return this.stateService.getRhythmSettings(workspaceId);
  }

  async updateRhythmSettings(boundaries: TodayRhythmBoundaries, workspaceId?: string): Promise<TodayRhythmSettings> {
    const settings = await this.stateService.updateRhythmSettings(boundaries, workspaceId);
    this.clearTodayCache(workspaceId);
    return settings;
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

  private todayCacheKey(managerAccountId: string, date: string, workspaceId: string | undefined, context: TodayBuildContext): string {
    return [
      normalizeWorkspaceId(workspaceId),
      managerAccountId,
      date,
      context.tz,
      context.withDelta ? context.baselineAt ?? "first" : "no-delta",
    ].join(":");
  }

  private async buildToday(
    managerAccountId: string,
    date: string,
    workspaceId: string | undefined,
    context: TodayBuildContext,
  ): Promise<TodayBuildResult> {
    const buildStartedAt = performance.now();
    const now = new Date();
    const clock: DayClock = { date, tz: context.tz, nowMs: now.getTime() };
    const taskKeys = new TaskKeysService();
    const phase3Promise = taskKeys.phase3Enabled(workspaceId).catch(() => false);
    const canonicalPromise = taskKeys.canonicalEnabled(workspaceId).catch(() => false);
    const [issueResult, teamResult, deskResult, syncResult, driftResult, oneOnOneResult, stateResult] = await Promise.all([
      measureSource(() => this.issueService.getTodaySnapshot(date, workspaceId)),
      measureSource(() => this.teamTrackerService.getAttentionSnapshot(date, { managerAccountId, workspaceId })),
      // Due follow-ups are re-filtered against now below; the horizon feeds midday "due soon".
      measureSource(() => this.managerDeskService.getTodayItems(managerAccountId, date, workspaceId, { followUpHorizonMs: DUE_SOON_MS })),
      measureSource(() => this.getSyncStatus(workspaceId)),
      // §8.1: the Jira drift signal only exists once Phase 3 is enabled — the
      // attention items deep-link into the canonical task drawer.
      measureSource(async () => (await phase3Promise)
        ? new JiraDriftService().list({ type: "manager", accountId: managerAccountId }, workspaceId, date)
        : []),
      // docs/48 §4.4: read-only due/overdue 1:1 sessions — empty when the flag
      // is off or the service wasn't wired.
      measureSource(async () =>
        this.oneOnOneService && (await this.oneOnOneService.enabled(workspaceId))
          ? this.oneOnOneService.dueSignals(workspaceId, date)
          : [],
      ),
      // docs/53 §8.5-7: rhythm settings, standup sessions, check-in asks and
      // the delta reads. Additive — a failure only drops focus/delta/asks.
      measureSource(() => this.loadTodayState(managerAccountId, date, workspaceId, context, phase3Promise)),
    ]);
    const canonical = await canonicalPromise;
    const sourceStatus: TodaySourceStatus = {
      issues: issueResult.status === "fulfilled" ? "ready" : "unavailable",
      team: teamResult.status === "fulfilled" ? "ready" : "unavailable",
      desk: deskResult.status === "fulfilled" ? "ready" : "unavailable",
      sync: syncResult.status === "fulfilled" ? "ready" : "unavailable",
      drift: driftResult.status === "fulfilled" ? "ready" : "unavailable",
      one_on_one: oneOnOneResult.status === "fulfilled" ? "ready" : "unavailable",
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
    if (stateResult.status === "rejected") {
      logger.warn({ workspaceId: normalizeWorkspaceId(workspaceId), date, err: stateResult.reason }, "Today state source unavailable");
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
      : { issues: [], activeDefects: 0, dueToday: 0, staleThresholdHours: 24 };
    const teamBoard = teamResult.status === "fulfilled" ? teamResult.value : emptyTeamBoard(date);
    const deskItems = deskResult.status === "fulfilled" ? deskResult.value : [];
    const syncStatus = syncResult.status === "fulfilled" ? syncResult.value : undefined;
    const jiraDrift = driftResult.status === "fulfilled" ? driftResult.value : [];
    const oneOnOneSignals = oneOnOneResult.status === "fulfilled" ? oneOnOneResult.value : [];
    const state = stateResult.status === "fulfilled" ? stateResult.value : undefined;
    const issues = issueSnapshot.issues;
    const asks = state?.asks ?? [];
    const openAsks = unansweredAsks(asks, teamBoard);
    const rhythm = getRhythmState(now, context.tz, state?.rhythm.boundaries);
    const standup = state?.phase3 && sourceStatus.team === "ready"
      ? buildStandupFocus(state.standup, teamBoard, date)
      : undefined;

    const followUps = getDueFollowUps(deskItems, clock.nowMs);
    const meetings = getMeetingPrompts(deskItems, clock);
    const carryActions = buildDeskCarryForwardActions(deskItems, clock, { canonical });
    const oneOnOneActions = buildOneOnOneActions(oneOnOneSignals);
    const actionItems = rankActionItems([
      ...buildStandupActions(standup, rhythm, teamBoard),
      ...buildDeveloperActions(teamBoard, clock, openAsks),
      ...buildIssueActions(issues, clock, issueSnapshot.staleThresholdHours),
      ...buildFollowUpActions(followUps, clock),
      ...buildMeetingActions(meetings),
      ...carryActions,
      ...buildJiraDriftActions(jiraDrift),
      ...oneOnOneActions,
      ...buildSyncActions(syncStatus),
    ]);
    const visibleActions = actionItems.slice(0, VISIBLE_ACTION_LIMIT);
    const overflowActions = actionItems.slice(VISIBLE_ACTION_LIMIT, VISIBLE_ACTION_LIMIT + OVERFLOW_ACTION_LIMIT);
    const promiseItems = followUps.map((item) => buildPromiseItem(item, clock));

    const today: TodayResponse = {
      date,
      generatedAt: now.toISOString(),
      rhythm,
      summary: buildSummary({
        // docs/53 F13: honest total, not the visible slice.
        attentionCount: actionItems.length,
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
      teamPulse: buildTeamPulse(teamBoard, clock, openAsks).slice(0, 10),
      promises: promiseItems.slice(0, 10),
      standupPrompts: buildStandupPrompts(teamBoard, issues, followUps, clock).slice(0, 8),
      meetingPrompts: meetings.map((item) => buildMeetingPrompt(item)).slice(0, 8),
      syncStatus,
      isPartial: unavailableSources.length > 0,
      sourceStatus,
      totalCount: actionItems.length,
      groupCounts: countGroups(actionItems),
      ...(overflowActions.length > 0 ? { overflowActionItems: overflowActions } : {}),
      focus: buildFocus({
        rhythm,
        standup,
        clock,
        actionItems,
        oneOnOneActions,
        teamBoard,
        teamAvailable: sourceStatus.team === "ready",
        deskItems,
        promiseItems,
        carryActions,
        openAsks,
      }),
      ...(state ? { checkInAsks: [...openAsks.values()] } : {}),
      ...(state?.delta
        ? {
          delta: buildDelta({
            since: context.baselineAt,
            clock,
            issues,
            deskItems,
            checkIns: state.delta.checkIns,
            resolvedCount: state.delta.resolvedCount,
            issuesAvailable: sourceStatus.issues === "ready",
          }),
        }
        : {}),
    };
    const buildDurationMs = performance.now() - buildStartedAt;
    const sourceTimings = {
      issues: issueResult.durationMs,
      team: teamResult.durationMs,
      desk: deskResult.durationMs,
      sync: syncResult.durationMs,
      drift: driftResult.durationMs,
      one_on_one: oneOnOneResult.durationMs,
      state: stateResult.durationMs,
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

  private async loadTodayState(
    managerAccountId: string,
    date: string,
    workspaceId: string | undefined,
    context: TodayBuildContext,
    phase3Promise: Promise<boolean>,
  ): Promise<TodayStateSnapshot> {
    const phase3 = await phase3Promise;
    const since = context.withDelta ? context.baselineAt : undefined;
    const [rhythm, standup, asks, checkIns, resolvedCount] = await Promise.all([
      this.stateService.getRhythmSettings(workspaceId),
      phase3 ? this.stateService.getStandupSummary(managerAccountId, date, workspaceId) : Promise.resolve(undefined),
      this.stateService.listCheckInAsks(managerAccountId, date, workspaceId),
      since ? this.stateService.listDeveloperCheckInsSince(since, workspaceId) : Promise.resolve([]),
      since ? this.stateService.countIssuesResolvedSince(since, workspaceId) : Promise.resolve(0),
    ]);
    return {
      phase3,
      rhythm,
      standup,
      asks,
      delta: context.withDelta ? { checkIns, resolvedCount } : undefined,
    };
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
      totalCount: today.totalCount ?? actionable.length,
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
    const tz = resolveTimeZone(request.tz);

    if (command.kind === "restore") {
      return this.executeRestore(managerAccountId, request, workspaceId);
    }

    if (actionTarget.taskKey && await new TaskKeysService().canonicalEnabled(workspaceId)) {
      const tasks = new TaskService();
      const principal = { type: "manager" as const, accountId: managerAccountId, workspaceId };
      if (command.kind === "mark_done" || command.kind === "set_current_work" || command.kind === "snooze" || command.kind === "carry_forward" || command.kind === "capture_meeting_outcome") {
        const before = await tasks.getByKey(actionTarget.taskKey, workspaceId);
        const outcome = command.kind === "capture_meeting_outcome" ? requireTrimmedText(request.outcome, "outcome") : undefined;
        const updates = command.kind === "mark_done" ? { status: "done" as const }
          : command.kind === "set_current_work" ? { status: "active" as const }
          : command.kind === "snooze" ? { followUpAt: buildSnoozeIso(date, request.preset ?? "tomorrow", tz) }
          : command.kind === "capture_meeting_outcome" ? { outcome }
          : { scheduledOn: command.toDate ?? date };
        const result = command.kind === "set_current_work" ? await tasks.setCurrent(actionTarget.taskKey, principal, true) : await tasks.update(actionTarget.taskKey, updates, principal);
        const nextAction = command.kind === "capture_meeting_outcome"
          ? await this.createMeetingNextAction(managerAccountId, request, tz, workspaceId)
          : undefined;
        const undo = before && command.kind !== "set_current_work"
          ? taskUndo(date, actionTarget, before, updates, nextAction)
          : undefined;
        return commandResponse(command.kind, actionTarget, await tasks.toDto(result, principal), undo);
      }
    }

    switch (command.kind) {
      case "open":
      case "assign_owner":
        return commandResponse(command.kind, actionTarget);

      case "ask_check_in":
        return this.askForCheckIn(managerAccountId, request, workspaceId);

      case "mark_done": {
        const itemId = requireManagerDeskItemId(actionTarget, command.kind);
        const before = await this.getDeskItemSafe(managerAccountId, itemId, workspaceId);
        const result = await this.managerDeskService.updateItem(
          managerAccountId,
          itemId,
          { status: "done" },
          workspaceId,
        );
        return commandResponse(
          command.kind,
          actionTarget,
          result,
          before ? deskUndo(date, actionTarget, itemId, { status: before.status }) : undefined,
        );
      }

      case "snooze": {
        const itemId = requireManagerDeskItemId(actionTarget, command.kind);
        const before = await this.getDeskItemSafe(managerAccountId, itemId, workspaceId);
        const result = await this.managerDeskService.updateItem(
          managerAccountId,
          itemId,
          { followUpAt: buildSnoozeIso(date, request.preset ?? "tomorrow", tz) },
          workspaceId,
          undefined,
          { scheduleVia: "snooze" },
        );
        return commandResponse(
          command.kind,
          actionTarget,
          result,
          before ? deskUndo(date, actionTarget, itemId, { followUpAt: before.followUpAt ?? null }) : undefined,
        );
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
          { ...buildFollowUpCreateParams(date, actionTarget, title, request.preset, tz), source: "today", actor: { type: "manager", accountId: managerAccountId } },
          workspaceId,
        );
        return commandResponse(command.kind, actionTarget, result, {
          label: "Undo",
          request: restoreRequest(date, actionTarget, { type: "delete_desk_item", managerDeskItemId: result.id }),
        });
      }

      case "carry_forward": {
        const itemId = requireManagerDeskItemId(actionTarget, command.kind);
        const result = await this.managerDeskService.carryForward(
          managerAccountId,
          {
            fromDate: actionTarget.date ?? date,
            toDate: command.toDate ?? date,
            itemIds: [itemId],
          },
          workspaceId,
        );
        // Legacy carry moves the item's day forward and cannot move it back —
        // the command stays confirm-gated there and returns no undo.
        return commandResponse(command.kind, actionTarget, { updated: result });
      }

      case "capture_meeting_outcome": {
        const itemId = requireManagerDeskItemId(actionTarget, command.kind);
        const outcome = requireTrimmedText(request.outcome, "outcome");
        const before = await this.getDeskItemSafe(managerAccountId, itemId, workspaceId);
        const result = await this.managerDeskService.updateItem(
          managerAccountId,
          itemId,
          { outcome, status: "done" },
          workspaceId,
        );
        const nextAction = await this.createMeetingNextAction(managerAccountId, request, tz, workspaceId);
        const undo = before
          ? deskUndo(date, actionTarget, itemId, { status: before.status, outcome: before.outcome ?? null }, nextAction)
          : undefined;
        return commandResponse(command.kind, actionTarget, { ...result, ...(nextAction ? { nextActionFollowUp: nextAction } : {}) }, undo);
      }

      default:
        throw new HttpError(400, "Unsupported manager action command");
    }
  }

  /** Pre-write snapshot for the undo patch; a missing item simply yields no undo. */
  private async getDeskItemSafe(managerAccountId: string, itemId: number, workspaceId?: string): Promise<ManagerDeskItem | undefined> {
    try {
      return (await this.managerDeskService.getItemDetail(managerAccountId, itemId, workspaceId)).item;
    } catch (error) {
      if (error instanceof HttpError && error.status === 404) return undefined;
      throw error;
    }
  }

  /**
   * docs/53 F14: the outcome dialog's optional "Next action" becomes a real
   * follow-up linked to the meeting (and its owner), due tomorrow 09:00 local.
   */
  private async createMeetingNextAction(
    managerAccountId: string,
    request: ManagerActionCommandRequest,
    tz: string,
    workspaceId?: string,
  ): Promise<ManagerDeskItem | undefined> {
    const title = request.nextAction?.trim();
    if (!title) return undefined;
    const meetingTarget = request.command.target;
    const ownerId = request.nextActionOwnerAccountId?.trim() || undefined;
    const canonical = await new TaskKeysService().canonicalEnabled(workspaceId);
    const followUp = await this.managerDeskService.createItem(
      managerAccountId,
      {
        date: request.date,
        title,
        kind: "action",
        category: "follow_up",
        status: "planned",
        priority: "medium",
        followUpAt: buildSnoozeIso(request.date, "tomorrow", tz),
        // Canonical tasks link by parent (below); legacy rows carry a note.
        ...(!canonical && meetingTarget.managerDeskItemId ? { contextNote: `Next action from meeting #${meetingTarget.managerDeskItemId}` } : {}),
        links: ownerId ? [{ linkType: "developer", developerAccountId: ownerId }] : [],
        source: "today",
        actor: { type: "manager", accountId: managerAccountId },
      },
      workspaceId,
    );
    if (canonical && meetingTarget.taskKey && followUp.taskKey) {
      const tasks = new TaskService();
      const meeting = await tasks.getByKey(meetingTarget.taskKey, workspaceId);
      if (meeting) {
        await tasks.update(followUp.taskKey, { parentId: meeting.id }, { type: "manager", accountId: managerAccountId, workspaceId });
      }
    }
    return followUp;
  }

  /**
   * docs/53 F15: "Ask for update" puts a manager-authored "Check-in request: …"
   * task on the developer's My Day and records asked_at for the pulse row.
   * Re-asking the same developer on the same day returns the open ask.
   */
  private async askForCheckIn(
    managerAccountId: string,
    request: ManagerActionCommandRequest,
    workspaceId?: string,
  ): Promise<ManagerActionCommandResponse> {
    const { command, date } = request;
    const developerAccountId = requireDeveloperAccountId(command.target, command.kind);
    const existing = await this.stateService.findOpenAsk(managerAccountId, developerAccountId, date, workspaceId);
    if (existing) {
      return commandResponse(command.kind, command.target, { ask: existing, reused: true });
    }
    const title = buildCheckInRequestTitle(command.target, request.title);
    const item = await this.teamTrackerService.addItem(
      developerAccountId,
      date,
      { title, actor: { type: "manager", accountId: managerAccountId }, source: "today" },
      workspaceId,
    );
    const ask = await this.stateService.createCheckInAsk(
      {
        managerAccountId,
        developerAccountId,
        date,
        title,
        trackerItemId: item.id,
        taskKey: item.taskKey ?? undefined,
      },
      workspaceId,
    );
    return commandResponse(command.kind, command.target, { ask, item }, {
      label: "Undo",
      request: restoreRequest(date, command.target, { type: "check_in_ask", askId: ask.id }),
    });
  }

  /** docs/53 F11: apply a server-issued inverse patch. Never itself undoable. */
  private async executeRestore(
    managerAccountId: string,
    request: ManagerActionCommandRequest,
    workspaceId?: string,
  ): Promise<ManagerActionCommandResponse> {
    const restore = request.restore;
    if (!restore) throw new HttpError(400, "restore requires a restore patch");
    const { command } = request;

    switch (restore.type) {
      case "desk_item": {
        const result = await this.managerDeskService.updateItem(managerAccountId, restore.managerDeskItemId, restore.patch, workspaceId);
        await this.deleteRestoredFollowUp(managerAccountId, request, workspaceId);
        return commandResponse("restore", command.target, result);
      }
      case "task": {
        const tasks = new TaskService();
        const principal = { type: "manager" as const, accountId: managerAccountId, workspaceId };
        const existing = await tasks.getByKey(restore.taskKey, workspaceId);
        if (!existing || existing.deletedAt || existing.trackedByManagerId !== managerAccountId) {
          throw new HttpError(404, "Task not found");
        }
        const result = await tasks.update(restore.taskKey, restore.patch, principal);
        await this.deleteRestoredFollowUp(managerAccountId, request, workspaceId);
        return commandResponse("restore", command.target, await tasks.toDto(result, principal));
      }
      case "delete_desk_item": {
        await this.managerDeskService.deleteItem(managerAccountId, restore.managerDeskItemId, workspaceId);
        return commandResponse("restore", command.target, { deleted: restore.managerDeskItemId });
      }
      case "check_in_ask": {
        const ask = await this.stateService.getCheckInAsk(managerAccountId, restore.askId, workspaceId);
        if (!ask.cancelled) {
          if (ask.trackerItemId !== undefined) {
            try {
              await this.teamTrackerService.deleteItem(ask.trackerItemId, undefined, workspaceId, { type: "manager", accountId: managerAccountId });
            } catch (error) {
              // Already removed by the developer — the ask still cancels.
              if (!(error instanceof HttpError && error.status === 404)) throw error;
            }
          }
          await this.stateService.cancelCheckInAsk(managerAccountId, restore.askId, workspaceId);
        }
        return commandResponse("restore", command.target, { cancelled: restore.askId });
      }
      default:
        throw new HttpError(400, "Unsupported restore patch");
    }
  }

  /** A restore carrying `alsoDeleteDeskItemId` removes the follow-up created with the write. */
  private async deleteRestoredFollowUp(managerAccountId: string, request: ManagerActionCommandRequest, workspaceId?: string): Promise<void> {
    const restore = request.restore;
    const id = restore && (restore.type === "desk_item" || restore.type === "task") ? restore.alsoDeleteDeskItemId : undefined;
    if (!id) return;
    try {
      await this.managerDeskService.deleteItem(managerAccountId, id, workspaceId);
    } catch (error) {
      if (!(error instanceof HttpError && error.status === 404)) throw error;
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

function emptyTeamBoard(date: string): TeamTrackerAttentionSnapshot {
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
    summary,
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

function buildDeveloperActions(
  board: TeamTrackerAttentionSnapshot,
  clock: DayClock,
  openAsks: Map<string, TodayCheckInAsk> = new Map(),
): TodayActionItem[] {
  const date = clock.date;
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
    const ask = openAsks.get(item.developer.accountId);
    const primary = getDeveloperAttentionPrimary(item, clock, day, ask);
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
      askedAt: ask?.askedAt,
    });
  });
}

function getDeveloperAttentionPrimary(
  item: TrackerAttentionItem,
  clock: DayClock,
  day?: TrackerDeveloperDay,
  ask?: TodayCheckInAsk,
): {
  kind: TodayActionCommand["kind"];
  label: string;
  target: TodayActionTarget;
  secondaryKinds: TodayActionCommand["kind"][];
  actionPreview?: string;
} {
  const date = clock.date;
  const currentTarget = target("developer", "team", {
    developerAccountId: item.developer.accountId,
    date,
    context: {
      trackerItemId: item.currentItem?.id,
      taskKey: item.currentItem?.taskKey ?? undefined,
      issueKey: item.currentItem?.jiraKey,
      relatedIssueKeys: item.currentItem?.relatedIssueKeys,
    },
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
    clock,
    day,
    lastCheckInAt: day?.lastCheckInAt ?? item.lastCheckInAt,
    isStale: item.isStale,
    status: item.status,
  })) {
    return {
      kind: "add_check_in",
      label: "Add check-in",
      target: currentTarget,
      // docs/53 F15: asking is usually the real move; hidden while an ask is open.
      secondaryKinds: ask ? ["capture_follow_up", "open"] : ["ask_check_in", "capture_follow_up", "open"],
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
  clock: DayClock,
  ask?: TodayCheckInAsk,
): {
  kind: TodayActionCommand["kind"];
  label: string;
  target: TodayActionTarget;
  secondaryKinds: TodayActionCommand["kind"][];
  actionPreview?: string;
} {
  const date = clock.date;
  const openTarget = target("developer", "team", {
    developerAccountId: day.developer.accountId,
    date,
    context: {
      trackerItemId: day.currentItem?.id,
      taskKey: day.currentItem?.taskKey ?? undefined,
      issueKey: day.currentItem?.jiraKey,
      relatedIssueKeys: day.currentItem?.relatedIssueKeys,
    },
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
    clock,
    day,
    lastCheckInAt: day.lastCheckInAt,
    isStale: day.isStale || Boolean(attentionItem?.isStale),
    status: day.status,
  })) {
    return {
      kind: "add_check_in",
      label: "Check-in",
      target: openTarget,
      secondaryKinds: ask ? ["capture_follow_up", "open"] : ["ask_check_in", "capture_follow_up", "open"],
    };
  }

  return {
    kind: "open",
    label: "Open",
    target: openTarget,
    secondaryKinds: ["capture_follow_up"],
  };
}

const MAX_PRIORITY_ISSUE_ROWS = 3;

/**
 * docs/53 F12: high-priority issues only surface when they still need a
 * manager decision — unassigned (handled by the unassigned bucket), not
 * started, or stale. Beyond a few rows the rest fold into one aggregate row
 * that deep-links to the filtered Work view.
 */
function buildIssueActions(issues: TodayIssue[], clock: DayClock, staleThresholdHours: number): TodayActionItem[] {
  const date = clock.date;
  const now = new Date();
  const rows: TodayActionItem[] = [];
  const priorityIssues: TodayIssue[] = [];

  for (const issue of issues) {
    if (issue.statusCategory.toLowerCase() === "done") {
      continue;
    }

    const dueDate = issueDueDate(issue);
    const overdue = isOverdue(dueDate, clock);
    const dueToday = isDueToday(dueDate, clock);
    const unassigned = !issue.assigneeId;
    const highPriority = isHighPriority(issue);

    if (!(overdue || dueToday || unassigned || highPriority)) {
      continue;
    }

    if (!overdue && !dueToday && !unassigned) {
      // High-priority only counts if it is also not started or has gone stale.
      const notStarted = issue.statusCategory === "new";
      const stale = isStaleIssue(issue, staleThresholdHours, now);
      if (!notStarted && !stale) {
        continue;
      }
      priorityIssues.push(issue);
      continue;
    }

    const severity: TodayActionSeverity = overdue ? "critical" : dueToday ? "warning" : "info";
    const itemType: TodayActionItemType = overdue ? "overdue_issue" : dueToday ? "due_issue" : "unassigned_issue";
    const filter: FilterType = overdue ? "overdue" : dueToday ? "dueToday" : "unassigned";
    const actionTarget = target("issue", "work", { issueKey: issue.jiraKey, filter, date });
    const signals = [
      overdue ? "Overdue" : undefined,
      dueToday ? "Due today" : undefined,
      unassigned ? "Unassigned" : undefined,
      highPriority ? "High priority" : undefined,
    ].filter(Boolean).join(" / ");

    rows.push(
      action({
        id: `today-issue-${issue.jiraKey}`,
        type: itemType,
        title: `${issue.jiraKey} ${issue.summary}`,
        context: issue.assigneeName ? `${issue.assigneeName} / ${issue.statusName}` : issue.statusName,
        signal: signals,
        severity,
        priority: overdue && !unassigned ? 92 : overdue ? 90 : dueToday ? 72 : 70,
        group: overdue || dueToday ? "now" : "next",
        target: actionTarget,
        primaryKind: unassigned ? "assign_owner" : "open",
        primaryLabel: unassigned ? "Assign owner" : "Open issue",
        secondaryKinds: ["capture_follow_up"],
      }),
    );
  }

  for (const issue of priorityIssues.slice(0, MAX_PRIORITY_ISSUE_ROWS)) {
    const stale = isStaleIssue(issue, staleThresholdHours, now);
    const notStarted = issue.statusCategory === "new";
    const actionTarget = target("issue", "work", { issueKey: issue.jiraKey, filter: "highPriority", date });
    rows.push(
      action({
        id: `today-issue-${issue.jiraKey}`,
        type: "high_priority_issue",
        title: `${issue.jiraKey} ${issue.summary}`,
        context: issue.assigneeName ? `${issue.assigneeName} / ${issue.statusName}` : issue.statusName,
        signal: ["High priority", notStarted ? "Not started" : undefined, stale ? "Stale" : undefined].filter(Boolean).join(" / "),
        severity: "warning",
        priority: 66,
        group: "next",
        target: actionTarget,
        primaryKind: "open",
        primaryLabel: "Open issue",
        secondaryKinds: ["capture_follow_up"],
      }),
    );
  }

  if (priorityIssues.length > MAX_PRIORITY_ISSUE_ROWS) {
    const aggregateTarget = target("view", "work", { filter: "highPriority", date });
    rows.push(
      action({
        id: "today-issue-priority-backlog",
        type: "high_priority_issue",
        title: `${priorityIssues.length} high-priority defects`,
        context: "Open the high-priority Work filter to triage the rest",
        signal: "High priority",
        severity: "info",
        priority: 64,
        group: "next",
        target: aggregateTarget,
        primaryKind: "open",
        primaryLabel: "Open Work",
        secondaryKinds: [],
      }),
    );
  }

  return rows;
}

function buildFollowUpActions(items: ManagerDeskItem[], clock: DayClock): TodayActionItem[] {
  const date = clock.date;
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
      signal: isOverdue(item.followUpAt, clock) ? "Overdue follow-up" : "Due follow-up",
      severity: isOverdue(item.followUpAt, clock) ? "critical" : "warning",
      priority: isOverdue(item.followUpAt, clock) ? 96 : 88,
      group: "now",
      target: actionTarget,
      primaryKind: "mark_done",
      primaryLabel: "Done",
      secondaryKinds: ["snooze", "open"],
      freshness: item.followUpAt ? formatIsoDateSignal(item.followUpAt, clock) : undefined,
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

function buildDeskCarryForwardActions(
  items: ManagerDeskItem[],
  clock: DayClock,
  options: { canonical?: boolean } = {},
): TodayActionItem[] {
  const date = clock.date;
  return items
    .filter((item) => isCarryForwardDeskItem(item))
    .filter((item) => item.kind !== "meeting" && item.category !== "follow_up")
    .filter((item) => isBeforeDay(item.originDate, clock) || isBeforeDay(item.plannedEndAt, clock) || isBeforeDay(item.plannedStartAt, clock))
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
        // docs/53 F11: canonical carry is a scheduledOn patch (undoable);
        // legacy carry moves the row's day and stays confirm-gated.
        commandOptions: { carry_forward: options.canonical ? { confirm: false, undoable: true } : { confirm: true, undoable: false } },
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

/** docs/48 §4.4: read-only 1:1 signals deep-link to /team?dev=<id>&panel=one-on-one. */
function buildOneOnOneActions(signals: OneOnOneDueSignal[]): TodayActionItem[] {
  return signals.map((signal) => {
    const overdue = signal.overdueDays > 0;
    return action({
      id: `one-on-one-${signal.sessionId}`,
      type: "one_on_one",
      title: overdue ? `1:1 with ${signal.developerName} overdue` : `1:1 with ${signal.developerName} today`,
      context: overdue
        ? `Scheduled ${signal.scheduledFor} — ${signal.overdueDays}d overdue`
        : "Scheduled for today",
      signal: overdue ? `Overdue ${signal.overdueDays}d` : "1:1 today",
      severity: overdue ? "warning" : "info",
      priority: overdue ? 82 + Math.min(signal.overdueDays, 10) : 74,
      group: "next",
      target: target("developer", "team", {
        developerAccountId: signal.developerAccountId,
        date: signal.scheduledFor,
        panel: "one-on-one",
      }),
      primaryKind: "open",
      primaryLabel: "Open 1:1",
      secondaryKinds: [],
    });
  });
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

function buildTeamPulse(
  board: TeamTrackerAttentionSnapshot,
  clock: DayClock,
  openAsks: Map<string, TodayCheckInAsk> = new Map(),
): TodayTeamPulseItem[] {
  const date = clock.date;
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
        date,
        context: {
          trackerItemId: day.currentItem?.id,
          taskKey: day.currentItem?.taskKey ?? undefined,
          issueKey: day.currentItem?.jiraKey,
          relatedIssueKeys: day.currentItem?.relatedIssueKeys,
        },
      });
      const ask = openAsks.get(day.developer.accountId);
      const primary = getDeveloperPulsePrimary(day, attentionItem, clock, ask);

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
        ...(ask ? { askedAt: ask.askedAt } : {}),
      };
    });
}

function buildPromiseItem(item: ManagerDeskItem, clock: DayClock): TodayPromiseItem {
  const date = clock.date;
  const promiseTarget = target("follow_up", "follow-ups", {
    managerDeskItemId: item.id,
    taskKey: item.taskKey ?? undefined,
    date: item.originDate || date,
  });

  return {
    id: `promise-${item.id}`,
    title: item.title,
    detail: item.followUpAt ? formatIsoDateSignal(item.followUpAt, clock) : "Due now",
    severity: isOverdue(item.followUpAt, clock) ? "critical" : "warning",
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
  board: TeamTrackerAttentionSnapshot,
  issues: TodayIssue[],
  followUps: ManagerDeskItem[],
  clock: DayClock,
): TodayStandupPrompt[] {
  const date = clock.date;
  const dayByDeveloper = new Map(board.developers.map((day) => [day.developer.accountId, day]));
  const peoplePrompts = board.attentionQueue.slice(0, 3).map((item) => {
    const day = dayByDeveloper.get(item.developer.accountId);
    const primary = getDeveloperAttentionPrimary(item, clock, day);

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
    .filter((issue) => isOverdue(issueDueDate(issue), clock) || isDueToday(issueDueDate(issue), clock))
    .slice(0, 3)
    .map((issue) => {
      const issueTarget = target("issue", "work", { issueKey: issue.jiraKey, filter: isOverdue(issueDueDate(issue), clock) ? "overdue" : "dueToday", date });
      return {
        id: `standup-issue-${issue.jiraKey}`,
        title: issue.jiraKey,
        detail: issue.summary,
        severity: isOverdue(issueDueDate(issue), clock) ? "critical" as const : "warning" as const,
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
      severity: isOverdue(item.followUpAt, clock) ? "critical" as const : "warning" as const,
      target: promiseTarget,
      primaryAction: command("open", "Open", promiseTarget),
    };
  });

  return [...peoplePrompts, ...issuePrompts, ...promisePrompts];
}

function getMeetingPrompts(items: ManagerDeskItem[], clock: DayClock): ManagerDeskItem[] {
  const date = clock.date;
  return items
    .filter((item) => isOpenDeskItem(item))
    .filter((item) => item.kind === "meeting")
    .filter((item) => !item.outcome?.trim())
    .filter((item) => !isAfterDay(item.originDate, clock))
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

function getDueFollowUps(items: ManagerDeskItem[], nowMs: number): ManagerDeskItem[] {
  return items
    .filter((item) => isOpenDeskItem(item))
    .filter((item) => item.category === "follow_up" || Boolean(item.followUpAt))
    // docs/53 F1: follow-ups are due by timestamp, not by day — a same-day
    // future followUpAt (e.g. a "Later today" snooze) is not due yet.
    .filter((item) => !item.followUpAt || Date.parse(item.followUpAt) <= nowMs)
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
  askedAt?: string;
  commandOptions?: Partial<Record<TodayActionCommand["kind"], CommandOptions>>;
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
    primaryAction: command(params.primaryKind, params.primaryLabel, params.target, params.commandOptions?.[params.primaryKind]),
    secondaryActions: params.secondaryKinds.map((kind) => command(kind, commandLabel(kind), params.target, params.commandOptions?.[kind])),
    freshness: params.freshness,
    actionPreview: params.actionPreview ? compactText(params.actionPreview, 140) : undefined,
    ...(params.askedAt ? { askedAt: params.askedAt } : {}),
  };
}

function formatSetCurrentPreview(item: TrackerAttentionActionItem | TrackerWorkItem): string {
  return item.jiraKey ? `${item.jiraKey} ${item.title}` : item.title;
}

type CommandOptions = { confirm?: boolean; undoable?: boolean };

/**
 * docs/53 F11: reversible writes run optimistically with an Undo toast (the
 * response carries the inverse); confirm is kept only for irreversible ones.
 */
const undoableKinds = new Set<TodayActionCommand["kind"]>([
  "mark_done",
  "snooze",
  "capture_follow_up",
  "capture_meeting_outcome",
  "ask_check_in",
]);

function command(
  kind: TodayActionCommand["kind"],
  label: string,
  actionTarget: TodayActionTarget,
  options: CommandOptions = {},
): TodayActionCommand {
  const undoable = options.undoable ?? undoableKinds.has(kind);
  const confirm = options.confirm ?? (kind === "carry_forward" && !undoable);
  return { kind, label, target: actionTarget, confirm, ...(undoable ? { undoable: true } : {}) };
}

function commandLabel(kind: TodayActionCommand["kind"]): string {
  switch (kind) {
    case "add_check_in":
      return "Add check-in";
    case "ask_check_in":
      return "Ask for update";
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

/**
 * docs/53 F5: "today" is the manager's calendar day in their zone — date-only
 * values (Jira due dates) compare as-is, timestamps convert through `tz`.
 */
type DayClock = { date: string; tz: string; nowMs: number };

function isDueToday(value: string | undefined, clock: DayClock): boolean {
  return toZonedIsoDay(value, clock.tz) === clock.date;
}

function isOverdue(value: string | undefined, clock: DayClock): boolean {
  const day = toZonedIsoDay(value, clock.tz);
  return Boolean(day && day < clock.date);
}

function isBeforeDay(value: string | undefined, clock: DayClock): boolean {
  const day = toZonedIsoDay(value, clock.tz);
  return Boolean(day && day < clock.date);
}

function isAfterDay(value: string | undefined, clock: DayClock): boolean {
  const day = toZonedIsoDay(value, clock.tz);
  return Boolean(day && day > clock.date);
}

function shouldRequestDeveloperCheckIn(params: {
  clock: DayClock;
  day?: TrackerDeveloperDay;
  lastCheckInAt?: string;
  isStale: boolean;
  status: TrackerDeveloperDay["status"];
}): boolean {
  if (hasTrackerCheckInForDate(params.day, params.lastCheckInAt, params.clock)) {
    return false;
  }

  return params.isStale || params.status === "blocked" || params.status === "at_risk" || params.status === "waiting";
}

function hasTrackerCheckInForDate(day: TrackerDeveloperDay | undefined, lastCheckInAt: string | undefined, clock: DayClock): boolean {
  if ((day?.checkIns.length ?? 0) > 0) {
    return true;
  }

  return isDueToday(lastCheckInAt, clock);
}

function formatIsoDateSignal(value: string, clock: DayClock): string {
  const day = toZonedIsoDay(value, clock.tz);
  if (!day) {
    return "Due";
  }
  if (day === clock.date) {
    return "Due today";
  }
  if (day < clock.date) {
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
  undo?: ManagerActionUndo,
): ManagerActionCommandResponse {
  return {
    success: true,
    command: kind,
    target: actionTarget,
    result,
    ...(undo ? { undo } : {}),
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
    one_on_one: Math.round(timings.one_on_one),
    state: Math.round(timings.state),
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

function buildSnoozeIso(date: string, preset: ManagerActionSnoozePreset, tz: string): string {
  // docs/53 F1: "later today" is relative to now (rounded to the half hour)
  // rather than a fixed time, so the snooze is meaningful whenever it runs.
  if (preset === "later_today") {
    const target = new Date(Date.now() + 3 * 60 * 60 * 1000);
    target.setTime(Math.round(target.getTime() / 1_800_000) * 1_800_000);
    return target.toISOString();
  }

  // docs/53 F5: 09:00 on the manager's wall clock, not the server's.
  return zonedTimeToUtc(addDaysToIsoDay(date, preset === "next_week" ? 7 : 1), 9, 0, tz).toISOString();
}

function buildFollowUpCreateParams(date: string, actionTarget: ManagerActionTarget, title: string, preset: ManagerActionSnoozePreset | undefined, tz: string) {
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

  const contextTaskKey = actionTarget.taskKey ?? actionTarget.context?.taskKey;
  return {
    date,
    title,
    kind: "action" as const,
    category: "follow_up" as const,
    status: "planned" as const,
    priority: "medium" as const,
    // docs/53 F3: a captured follow-up must never be due immediately — the
    // default is tomorrow 09:00 local; presets shift it.
    followUpAt: buildSnoozeIso(date, preset ?? "tomorrow", tz),
    contextNote: contextTaskKey ? `Follow-up for ${contextTaskKey}` : undefined,
    links,
  };
}

function uniqueIssueKeys(actionTarget: ManagerActionTarget): string[] {
  const issueKeys = [
    actionTarget.issueKey,
    actionTarget.context?.issueKey,
    ...(actionTarget.relatedIssueKeys ?? []),
    ...(actionTarget.context?.relatedIssueKeys ?? []),
  ]
    .map((issueKey) => issueKey?.trim())
    .filter((issueKey): issueKey is string => Boolean(issueKey));

  return [...new Set(issueKeys)];
}

// ── docs/53 §8.5-7: stage focus, standup, delta, asks, undo ────────────────

/**
 * An ask stays open until the developer posts their own check-in after it —
 * manager-authored check-ins don't answer it.
 */
function unansweredAsks(asks: TodayCheckInAsk[], board: TeamTrackerAttentionSnapshot): Map<string, TodayCheckInAsk> {
  const dayByDeveloper = new Map(board.developers.map((day) => [day.developer.accountId, day]));
  const open = new Map<string, TodayCheckInAsk>();
  for (const ask of asks) {
    if (open.has(ask.developerAccountId)) continue;
    const askedMs = Date.parse(ask.askedAt);
    const answered = (dayByDeveloper.get(ask.developerAccountId)?.checkIns ?? []).some((checkIn) =>
      checkIn.authorType === "developer" && Date.parse(checkIn.createdAt) > askedMs,
    );
    if (!answered) open.set(ask.developerAccountId, ask);
  }
  return open;
}

function buildCheckInRequestTitle(actionTarget: ManagerActionTarget, custom?: string): string {
  const detail = custom?.trim()
    || (actionTarget.context?.issueKey ?? actionTarget.issueKey
      ? `update on ${actionTarget.context?.issueKey ?? actionTarget.issueKey}`
      : "quick status update");
  return compactText(`Check-in request: ${detail}`, 160);
}

function askCommand(accountId: string, date: string, context?: TodayActionTarget["context"]): TodayActionCommand {
  return command("ask_check_in", "Ask for update", target("developer", "team", {
    developerAccountId: accountId,
    date,
    ...(context ? { context } : {}),
  }));
}

function focusPerson(day: TrackerDeveloperDay, date: string, openAsks: Map<string, TodayCheckInAsk>): TodayFocusPerson {
  const ask = openAsks.get(day.developer.accountId);
  return {
    accountId: day.developer.accountId,
    displayName: day.developer.displayName,
    target: target("developer", "team", { developerAccountId: day.developer.accountId, date }),
    ...(ask
      ? { askedAt: ask.askedAt }
      : { primaryAction: askCommand(day.developer.accountId, date, day.currentItem?.jiraKey ? { issueKey: day.currentItem.jiraKey } : undefined) }),
  };
}

function buildStandupFocus(
  summary: StandupSessionSummary | undefined,
  board: TeamTrackerAttentionSnapshot,
  date: string,
): TodayStandupFocus {
  if (!summary) {
    return {
      status: "not_started",
      date,
      sessionCount: 0,
      reviewedCount: 0,
      flaggedCount: 0,
      flagged: [],
      target: target("view", "team", { mode: "standup", date }),
    };
  }
  const names = new Map(board.developers.map((day) => [day.developer.accountId, day.developer.displayName]));
  const flagged: TodayFocusPerson[] = summary.flagged.map((accountId) => ({
    accountId,
    displayName: names.get(accountId) ?? accountId,
    target: target("developer", "team", { developerAccountId: accountId, date }),
  }));
  return {
    status: "completed",
    date,
    startedAt: summary.startedAt,
    endedAt: summary.endedAt,
    sessionCount: summary.sessionCount,
    reviewedCount: summary.reviewed.length,
    flaggedCount: flagged.length,
    flagged,
    target: flagged.length === 1 ? flagged[0]!.target : target("view", "team", { date }),
  };
}

/**
 * docs/53 F7: before and during the standup window a not-yet-run standup is
 * one "Start standup" row → `/team?mode=standup`. Once a round is sealed the
 * quiet status line lives in `focus.*.standup`, not in the queue.
 */
function buildStandupActions(
  standup: TodayStandupFocus | undefined,
  rhythm: TodayRhythmState,
  board: TeamTrackerAttentionSnapshot,
): TodayActionItem[] {
  if (!standup || standup.status !== "not_started" || board.summary.total === 0) return [];
  if (rhythm.stage !== "morning_plan" && rhythm.stage !== "standup_window") return [];
  const inWindow = rhythm.stage === "standup_window";
  const signals = [
    board.summary.blocked ? `${board.summary.blocked} blocked` : undefined,
    board.summary.stale ? `${board.summary.stale} stale` : undefined,
  ].filter(Boolean);
  return [
    action({
      id: "today-standup-start",
      type: "standup",
      title: "Start standup",
      context: signals.length ? signals.join(" · ") : `${board.summary.total} people`,
      signal: inWindow ? "Standup window" : "Before standup",
      severity: inWindow ? "warning" : "info",
      priority: inWindow ? 99 : 95,
      group: "now",
      target: standup.target,
      primaryKind: "open",
      primaryLabel: "Start standup",
      secondaryKinds: [],
    }),
  ];
}

function countGroups(items: TodayActionItem[]): Record<TodayActionGroup, number> {
  const counts: Record<TodayActionGroup, number> = { now: 0, next: 0, later: 0 };
  for (const item of items) {
    if (item.type !== "calm") counts[item.group] += 1;
  }
  return counts;
}

function buildFocus(params: {
  rhythm: TodayRhythmState;
  standup?: TodayStandupFocus;
  clock: DayClock;
  actionItems: TodayActionItem[];
  oneOnOneActions: TodayActionItem[];
  teamBoard: TeamTrackerAttentionSnapshot;
  teamAvailable: boolean;
  deskItems: ManagerDeskItem[];
  promiseItems: TodayPromiseItem[];
  carryActions: TodayActionItem[];
  openAsks: Map<string, TodayCheckInAsk>;
}): TodayFocus {
  const { clock, rhythm, standup } = params;
  const activeDays = params.teamAvailable
    ? params.teamBoard.developers.filter((day) => day.availability?.state !== "inactive")
    : [];

  switch (rhythm.stage) {
    case "morning_plan":
    case "standup_window":
      return {
        stage: rhythm.stage,
        morning: {
          ...(standup ? { standup } : {}),
          nowCount: countGroups(params.actionItems).now,
          oneOnOnes: params.oneOnOneActions,
        },
      };
    case "midday_check": {
      const soonMs = clock.nowMs + DUE_SOON_MS;
      const dueSoon = params.deskItems
        .filter((item) => isOpenDeskItem(item) && item.followUpAt)
        .filter((item) => {
          const at = Date.parse(item.followUpAt!);
          return at > clock.nowMs && at <= soonMs;
        })
        .sort((left, right) => left.followUpAt!.localeCompare(right.followUpAt!))
        .map((item) => buildPromiseItem(item, clock));
      const anchorMs = standup?.endedAt ? Date.parse(standup.endedAt) : zonedTimeToUtc(clock.date, 0, 0, clock.tz).getTime();
      const silentSinceStandup = activeDays
        .filter((day) => day.status !== "done_for_today")
        .filter((day) => !day.lastCheckInAt || Date.parse(day.lastCheckInAt) < anchorMs)
        .map((day) => focusPerson(day, clock.date, params.openAsks));
      return {
        stage: "midday_check",
        midday: { ...(standup ? { standup } : {}), dueSoon, silentSinceStandup },
      };
    }
    case "wrap_up": {
      const tomorrow = addDaysToIsoDay(clock.date, 1);
      const missingCheckIns = activeDays
        .filter((day) => !hasTrackerCheckInForDate(day, day.lastCheckInAt, clock))
        .map((day) => focusPerson(day, clock.date, params.openAsks));
      // EOD carry targets tomorrow, not today.
      const carryCandidates = params.carryActions.map((item) => ({
        ...item,
        primaryAction: item.primaryAction.kind === "carry_forward"
          ? { ...item.primaryAction, label: "Carry to tomorrow", toDate: tomorrow }
          : item.primaryAction,
      }));
      return {
        stage: "wrap_up",
        wrapUp: {
          missingCheckIns,
          openPromises: params.promiseItems,
          carryCandidates,
          eodNoteTarget: target("view", "notes", { date: clock.date }),
        },
      };
    }
  }
}

function buildDelta(params: {
  since?: string;
  clock: DayClock;
  issues: TodayIssue[];
  deskItems: ManagerDeskItem[];
  checkIns: CheckInSince[];
  resolvedCount: number;
  issuesAvailable: boolean;
}): TodayDelta {
  const { since, clock } = params;
  if (!since) {
    return {
      newIssues: { count: 0, items: [] },
      overdueOvernight: { count: 0, items: [] },
      newCheckIns: { count: 0, people: [] },
      followUpsNewlyDue: { count: 0, items: [] },
      resolvedCount: 0,
    };
  }
  const sinceMs = Date.parse(since);
  const sinceDay = toZonedIsoDay(since, clock.tz)!;
  const deltaIssue = (issue: TodayIssue, filter: FilterType): TodayDeltaIssue => ({
    jiraKey: issue.jiraKey,
    summary: issue.summary,
    target: target("issue", "work", { issueKey: issue.jiraKey, filter, date: clock.date }),
  });
  const issues = params.issuesAvailable ? params.issues : [];
  const newIssues = issues.filter((issue) => parseInstant(issue.createdAt) > sinceMs);
  // Due date passed between the last visit and now: not overdue then, overdue today.
  const overdueOvernight = issues.filter((issue) => {
    const due = issueDueDate(issue);
    return Boolean(due && due >= sinceDay && due < clock.date);
  });

  const byDeveloper = new Map<string, { displayName: string; count: number; latestAt: string }>();
  for (const checkIn of params.checkIns) {
    const entry = byDeveloper.get(checkIn.developerAccountId);
    if (entry) {
      entry.count += 1;
      if (checkIn.createdAt > entry.latestAt) entry.latestAt = checkIn.createdAt;
    } else {
      byDeveloper.set(checkIn.developerAccountId, { displayName: checkIn.displayName, count: 1, latestAt: checkIn.createdAt });
    }
  }
  const people = [...byDeveloper.entries()]
    .sort((left, right) => right[1].latestAt.localeCompare(left[1].latestAt))
    .map(([developerAccountId, entry]) => ({
      developerAccountId,
      displayName: entry.displayName,
      count: entry.count,
      latestAt: entry.latestAt,
      target: target("developer", "team", { developerAccountId, date: clock.date }),
    }));

  const newlyDue = params.deskItems
    .filter((item) => isOpenDeskItem(item) && item.followUpAt)
    .filter((item) => {
      const at = Date.parse(item.followUpAt!);
      return at > sinceMs && at <= clock.nowMs;
    })
    .sort((left, right) => left.followUpAt!.localeCompare(right.followUpAt!));

  return {
    since,
    newIssues: { count: newIssues.length, items: newIssues.slice(0, DELTA_ITEM_LIMIT).map((issue) => deltaIssue(issue, "all")) },
    overdueOvernight: { count: overdueOvernight.length, items: overdueOvernight.slice(0, DELTA_ITEM_LIMIT).map((issue) => deltaIssue(issue, "overdue")) },
    newCheckIns: { count: params.checkIns.length, people },
    followUpsNewlyDue: { count: newlyDue.length, items: newlyDue.slice(0, DELTA_ITEM_LIMIT).map((item) => buildPromiseItem(item, clock)) },
    resolvedCount: params.resolvedCount,
  };
}

function restoreRequest(date: string, actionTarget: ManagerActionTarget, restore: ManagerActionRestore): ManagerActionCommandRequest {
  return {
    date,
    command: { kind: "restore", label: "Undo", target: actionTarget },
    restore,
  };
}

function deskUndo(
  date: string,
  actionTarget: ManagerActionTarget,
  managerDeskItemId: number,
  patch: Extract<ManagerActionRestore, { type: "desk_item" }>["patch"],
  createdFollowUp?: ManagerDeskItem,
): ManagerActionUndo {
  return {
    label: "Undo",
    request: restoreRequest(date, actionTarget, {
      type: "desk_item",
      managerDeskItemId,
      patch,
      ...(createdFollowUp ? { alsoDeleteDeskItemId: createdFollowUp.id } : {}),
    }),
  };
}

type TaskUndoPatch = Extract<ManagerActionRestore, { type: "task" }>["patch"];

/** Inverse of a canonical task write: the prior value of every field it touched. */
function taskUndo(
  date: string,
  actionTarget: ManagerActionTarget,
  before: { taskKey: string; status: string; followUpAt: string | null; outcome: string | null; scheduledOn: string | null },
  updates: { status?: string; followUpAt?: string; outcome?: string; scheduledOn?: string },
  createdFollowUp?: ManagerDeskItem,
): ManagerActionUndo {
  const patch: TaskUndoPatch = {};
  if (updates.status !== undefined) patch.status = before.status as TaskUndoPatch["status"];
  if (updates.followUpAt !== undefined) patch.followUpAt = before.followUpAt;
  if (updates.outcome !== undefined) patch.outcome = before.outcome;
  if (updates.scheduledOn !== undefined) patch.scheduledOn = before.scheduledOn;
  return {
    label: "Undo",
    request: restoreRequest(date, actionTarget, {
      type: "task",
      taskKey: before.taskKey,
      patch,
      ...(createdFollowUp ? { alsoDeleteDeskItemId: createdFollowUp.id } : {}),
    }),
  };
}
