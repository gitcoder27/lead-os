export type WorkloadLevel = "light" | "medium" | "heavy";
export type TeamScopeState = "in_team" | "out_of_team" | "unassigned";
export type SyncScopeState = "active" | "inaccessible" | "out_of_scope";
export type JiraSyncScopeMode = "team_assignees" | "base_query";

export type FilterType =
  | "all"
  | "new"
  | "recentlyAssigned"
  | "inProgress"
  | "reopened"
  | "unassigned"
  | "dueToday"
  | "dueThisWeek"
  | "noDueDate"
  | "overdue"
  | "blocked"
  | "stale"
  | "highPriority"
  | "outOfTeam";

export interface LocalTag {
  id: number;
  name: string;
  color: string;
}

export interface TagUsageIssuePreview {
  jiraKey: string;
  summary: string;
  assigneeName?: string;
  statusName: string;
  updatedAt: string;
}

export interface TagUsageResponse {
  tag: LocalTag;
  issueCount: number;
  issues: TagUsageIssuePreview[];
}

export interface TagDeleteResponse {
  success: true;
  removedIssueCount: number;
}

export interface Issue {
  jiraKey: string;
  summary: string;
  description?: string;
  aspenSeverity?: string;
  priorityName: string;
  priorityId: string;
  statusName: string;
  statusCategory: string;
  assigneeId?: string;
  assigneeName?: string;
  reporterName?: string;
  component?: string;
  labels: string[];
  dueDate?: string;
  developmentDueDate?: string;
  flagged: boolean;
  createdAt: string;
  updatedAt: string;
  teamScopeState?: TeamScopeState;
  syncScopeState?: SyncScopeState;
  lastSeenInScopedSyncAt?: string;
  lastReconciledAt?: string;
  scopeChangedAt?: string;
  localTags: LocalTag[];
  analysisNotes?: string;
  trackerAssignmentsToday?: IssueTrackerAssignmentSummary;
  excluded?: boolean;
}

export interface IssueTrackerAssignmentSummary {
  activeCount: number;
  developerNames: string[];
}

export interface Developer {
  accountId: string;
  displayName: string;
  email?: string;
  avatarUrl?: string;
  source?: "jira" | "manual";
  jiraAccountId?: string;
  isActive: boolean;
  availability?: DeveloperAvailability;
}

export type DeveloperAvailabilityState = "active" | "inactive";

export interface DeveloperAvailability {
  state: DeveloperAvailabilityState;
  startDate?: string;
  endDate?: string;
  note?: string;
}

export interface DeveloperWorkload {
  developer: Developer;
  activeDefects: number;
  dueToday: number;
  blocked: number;
  score: number;
  level: WorkloadLevel;
  currentCount?: 0 | 1;
  plannedCount?: number;
  assignedTodayCount?: number;
  completedTodayCount?: number;
  droppedTodayCount?: number;
  trackerStatus?: TrackerDeveloperStatus;
  isTrackerStale?: boolean;
  hasCurrentItem?: boolean;
  capacityUnits?: number;
  capacityUsed?: number;
  capacityRemaining?: number;
  capacityUtilization?: number;
  signals?: {
    idle: boolean;
    noCurrentItem: boolean;
    overCapacity: boolean;
    backlogTrackerMismatch: boolean;
  };
}

export interface OverviewCounts {
  new: number;
  recentlyAssigned: number;
  unassigned: number;
  dueToday: number;
  dueThisWeek: number;
  noDueDate: number;
  overdue: number;
  blocked: number;
  stale: number;
  highPriority: number;
  inProgress: number;
  reopened: number;
  outOfTeam?: number;
  total: number;
  lastSynced?: string;
}

export type AlertType =
  | "overdue"
  | "stale"
  | "blocked"
  | "idle_developer"
  | "high_priority_not_started";

export interface Alert {
  id: string;
  type: AlertType;
  severity: "high" | "medium";
  issueKey?: string;
  developerAccountId?: string;
  developerName?: string;
  message: string;
  detectedAt: string;
}

export interface AlertDismissRequest {
  alertIds: string[];
}

export interface AlertDismissResponse {
  success: true;
  dismissedIds: string[];
}

export interface AssignmentSuggestion {
  developer: Developer;
  score: number;
  reason: string;
  workload: DeveloperWorkload;
}

export type SyncRunStatus = "success" | "error" | "skipped";

export interface SyncRunResponse {
  status: SyncRunStatus;
  issuesSynced: number;
  startedAt: string;
  completedAt: string;
  errorMessage?: string;
  reason?: "already_running";
}

export interface SyncStatus {
  lastSyncedAt?: string;
  status: "idle" | "syncing" | "error";
  issuesSynced?: number;
  errorMessage?: string;
  autoSyncEnabled?: boolean;
}

// ── Today cockpit types ─────────────────────────────────

export type TodayRhythmStage =
  | "morning_plan"
  | "standup_window"
  | "midday_check"
  | "wrap_up";

export type TodayActionTargetType =
  | "issue"
  | "developer"
  | "manager_desk_item"
  | "tracker_item"
  | "follow_up"
  | "meeting"
  | "view";

export type TodayActionItemType =
  | "developer_attention"
  | "overdue_issue"
  | "due_issue"
  | "unassigned_issue"
  | "stale_check_in"
  | "follow_up_due"
  | "meeting_outcome"
  | "desk_carry_forward"
  | "manual_work"
  | "sync_attention"
  | "calm";

export type TodayActionKind =
  | "open"
  | "ask_check_in"
  | "add_check_in"
  | "set_current_work"
  | "assign_owner"
  | "capture_follow_up"
  | "snooze"
  | "mark_done"
  | "carry_forward"
  | "capture_meeting_outcome";

export type TodayActionSeverity =
  | "critical"
  | "warning"
  | "info"
  | "neutral"
  | "success";

export type TodayActionGroup = "now" | "next" | "later";

export interface TodayActionTarget {
  type: TodayActionTargetType;
  view: "work" | "team" | "desk" | "follow-ups" | "meetings" | "notes" | "settings";
  issueKey?: string;
  relatedIssueKeys?: string[];
  developerAccountId?: string;
  managerDeskItemId?: number;
  trackerItemId?: number;
  date?: string;
  filter?: FilterType;
}

export interface TodayActionCommand {
  kind: TodayActionKind;
  label: string;
  target: TodayActionTarget;
  confirm?: boolean;
}

export interface TodayActionItem {
  id: string;
  type: TodayActionItemType;
  title: string;
  context: string;
  signal: string;
  severity: TodayActionSeverity;
  priority: number;
  group: TodayActionGroup;
  target: TodayActionTarget;
  primaryAction: TodayActionCommand;
  secondaryActions: TodayActionCommand[];
  freshness?: string;
  actionPreview?: string;
}

export interface TodayRhythmState {
  stage: TodayRhythmStage;
  label: string;
  detail: string;
}

export interface TodaySummaryMetric {
  id: string;
  label: string;
  value: number;
  detail: string;
  severity: TodayActionSeverity;
  target?: TodayActionTarget;
}

export interface TodayTeamPulseItem {
  accountId: string;
  displayName: string;
  initials: string;
  status: string;
  tone: TodayActionSeverity;
  detail: string;
  currentWork: string;
  lastUpdate: string;
  target: TodayActionTarget;
  primaryAction: TodayActionCommand;
  secondaryActions: TodayActionCommand[];
  actionPreview?: string;
}

export interface TodayPromiseItem {
  id: string;
  title: string;
  detail: string;
  severity: TodayActionSeverity;
  target: TodayActionTarget;
  primaryAction: TodayActionCommand;
  secondaryActions: TodayActionCommand[];
}

export interface TodayStandupPrompt {
  id: string;
  title: string;
  detail: string;
  severity: TodayActionSeverity;
  target: TodayActionTarget;
  primaryAction: TodayActionCommand;
}

export interface TodayMeetingPrompt {
  id: string;
  title: string;
  detail: string;
  severity: TodayActionSeverity;
  target: TodayActionTarget;
  primaryAction: TodayActionCommand;
  secondaryActions: TodayActionCommand[];
}

export type TodaySourceName = "issues" | "team" | "desk" | "sync";
export type TodaySourceStatus = Record<TodaySourceName, "ready" | "unavailable">;

export interface TodayResponse {
  date: string;
  generatedAt: string;
  rhythm: TodayRhythmState;
  summary: TodaySummaryMetric[];
  currentPriority?: TodayActionItem;
  actionItems: TodayActionItem[];
  teamPulse: TodayTeamPulseItem[];
  promises: TodayPromiseItem[];
  standupPrompts: TodayStandupPrompt[];
  meetingPrompts: TodayMeetingPrompt[];
  syncStatus?: SyncStatus;
  isPartial?: boolean;
  sourceStatus?: TodaySourceStatus;
}

// ── Manager action engine contracts ─────────────────────

export type ManagerActionSurface = "today" | "header";
export type ManagerActionKind = TodayActionKind;
export type ManagerActionTarget = TodayActionTarget;
export type ManagerActionCommand = TodayActionCommand;
export type ManagerActionItem = TodayActionItem;
export type ManagerActionSnoozePreset = "later_today" | "tomorrow" | "next_week";

export interface ManagerActionResponse {
  date: string;
  generatedAt: string;
  surface: ManagerActionSurface;
  actions: ManagerActionItem[];
  urgentCount: number;
  totalCount: number;
}

export interface ManagerActionCommandRequest {
  command: ManagerActionCommand;
  date: string;
  title?: string;
  outcome?: string;
  preset?: ManagerActionSnoozePreset;
  summary?: string;
}

export interface ManagerActionCommandResponse {
  success: boolean;
  command: ManagerActionKind;
  target: ManagerActionTarget;
  result?: unknown;
}

export interface DashboardConfig {
  jiraBaseUrl: string;
  jiraEmail: string;
  jiraProjectKey: string;
  managerJiraAccountId: string;
  jiraApiToken: string;
  syncIntervalMs: number;
  staleThresholdHours: number;
  jiraAutoSyncEnabled: boolean;
  backupEnabled: boolean;
  backupIntervalMinutes: number;
  backupRetentionDays: number;
  backupMaxScheduledSnapshots: number;
  backupDirectory: string;
  backupOnStartup: boolean;
  backupStartupMaxAgeHours: number;
  backupBeforeReset: boolean;
  jiraSyncScopeMode: JiraSyncScopeMode;
  jiraSyncJql: string;
  jiraDevDueDateField: string;
  jiraAspenSeverityField: string;
  isConfigured: boolean;
}

export type WorkspaceMaintenanceResetTarget =
  | "manager_desk"
  | "team_tracker"
  | "workspace";

export interface ManagerDeskMaintenancePreview {
  dayCount: number;
  itemCount: number;
  linkCount: number;
  historyCount: number;
  linkedTrackerItemCount: number;
}

export interface TeamTrackerMaintenancePreview {
  dayCount: number;
  itemCount: number;
  checkInCount: number;
  availabilityPeriodCount: number;
  savedViewCount: number;
  linkedManagerDeskItemCount: number;
}

export interface WorkspaceMaintenancePreviewResponse {
  backupBeforeReset: boolean;
  managerDesk: ManagerDeskMaintenancePreview;
  teamTracker: TeamTrackerMaintenancePreview;
}

export interface WorkspaceMaintenanceBackupSummary {
  name: string;
  createdAt: string;
  reason: string;
}

export interface WorkspaceMaintenanceResetResponse {
  success: true;
  target: WorkspaceMaintenanceResetTarget;
  backup?: WorkspaceMaintenanceBackupSummary;
}

export interface IssueUpdate {
  assigneeId?: string;
  priorityName?: string;
  dueDate?: string;
  developmentDueDate?: string;
  flagged?: boolean;
  analysisNotes?: string;
}

export interface IssueCommentRequest {
  text: string;
}

export interface IssueCommentResponse {
  ok: true;
}

export interface IssueListOptions {
  trackerDate?: string;
}

export interface PrioritySuggestion {
  suggested: string;
  reason: string;
}

export interface DueDateSuggestion {
  suggested: string;
  reason: string;
}

export interface TagCountItem {
  tagId: number;
  count: number;
}

export interface TagCountsResponse {
  counts: TagCountItem[];
  untaggedCount: number;
}

export interface ApiErrorResponse {
  error: string;
  status: number;
}

export type UserRole = "admin" | "manager" | "developer";

export interface AuthUser {
  username: string;
  accountId: string;
  workspaceId: string;
  displayName: string;
  role: UserRole;
  developerAccountId?: string;
}

export interface AuthSessionResponse {
  user: AuthUser;
}

export interface AuthBootstrapResponse {
  bootstrapOpen: boolean;
  userCount: number;
}

// ── Team Tracker types ──────────────────────────────────

export type TrackerDeveloperStatus =
  | "on_track"
  | "at_risk"
  | "blocked"
  | "waiting"
  | "done_for_today";

export type TrackerItemState = "planned" | "in_progress" | "done" | "dropped";
export type TrackerItemType = "jira" | "custom";
export type TrackerTaskLifecycle = "tracker_only" | "manager_desk_linked";
export type TeamTrackerViewMode = "live" | "history";
export type MyDayViewMode = "live" | "history" | "planning";
export type MyDayReadOnlyReason = "inactive" | "history" | "future";

export interface TrackerCheckIn {
  id: number;
  dayId: number;
  summary: string;
  createdAt: string;
  authorType?: UserRole;
  authorAccountId?: string;
  status?: TrackerDeveloperStatus;
  rationale?: string;
  nextFollowUpAt?: string;
}

export interface TrackerWorkItem {
  id: number;
  dayId: number;
  originDate: string;
  managerDeskItemId?: number;
  lifecycle: TrackerTaskLifecycle;
  itemType: TrackerItemType;
  jiraKey?: string;
  relatedIssueKeys?: string[];
  jiraSummary?: string;
  jiraPriorityName?: string;
  jiraDueDate?: string;
  title: string;
  state: TrackerItemState;
  position: number;
  note?: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TrackerDeveloperDay {
  id: number;
  date: string;
  developer: Developer;
  availability: DeveloperAvailability;
  status: TrackerDeveloperStatus;
  capacityUnits?: number;
  managerNotes?: string;
  lastCheckInAt?: string;
  nextFollowUpAt?: string;
  currentItem?: TrackerWorkItem;
  plannedItems: TrackerWorkItem[];
  completedItems: TrackerWorkItem[];
  droppedItems: TrackerWorkItem[];
  checkIns: TrackerCheckIn[];
  isStale: boolean;
  signals: TrackerDeveloperSignals;
  statusUpdatedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export type TrackerAttentionReasonCode =
  | "blocked"
  | "at_risk"
  | "stale_by_time"
  | "stale_with_open_risk"
  | "stale_without_current_work"
  | "overdue_linked_work"
  | "over_capacity"
  | "status_change_without_follow_up"
  | "no_current"
  | "waiting";

export interface TrackerAttentionReason {
  code: TrackerAttentionReasonCode;
  label: string;
  priority: number;
}

export type TrackerAttentionQuickAction =
  | "update_status"
  | "set_current"
  | "mark_inactive"
  | "capture_follow_up";

export interface TrackerAttentionActionItem {
  id: number;
  title: string;
  jiraKey?: string;
  relatedIssueKeys?: string[];
  lifecycle: TrackerTaskLifecycle;
}

export interface TrackerAttentionItem {
  developer: Developer;
  status: TrackerDeveloperStatus;
  reasons: TrackerAttentionReason[];
  lastCheckInAt?: string;
  nextFollowUpAt?: string;
  isStale: boolean;
  signals: TrackerDeveloperSignals;
  hasCurrentItem: boolean;
  currentItem?: TrackerAttentionActionItem;
  plannedCount: number;
  availableQuickActions: TrackerAttentionQuickAction[];
  setCurrentCandidates: TrackerAttentionActionItem[];
}

export interface TrackerCarryForwardPreviewGroup {
  developer: Developer;
  items: TrackerWorkItem[];
}

export interface TrackerCarryForwardPreviewResponse {
  carryable: number;
  developers: TrackerCarryForwardPreviewGroup[];
}

export interface TrackerCarryForwardContextResponse
  extends TrackerCarryForwardPreviewResponse {
  fromDate?: string;
  toDate: string;
}

export type TrackerBoardSummaryFilter =
  | "all"
  | "stale"
  | "blocked"
  | "at_risk"
  | "waiting"
  | "overdue_linked"
  | "over_capacity"
  | "status_follow_up"
  | "no_current"
  | "done_for_today";

export type TeamTrackerBoardSort =
  | "name"
  | "attention"
  | "stale_age"
  | "load"
  | "blocked_first";

export type TeamTrackerBoardGroupBy =
  | "none"
  | "status"
  | "attention_state";

export interface TeamTrackerBoardQuery {
  q?: string;
  summaryFilter?: TrackerBoardSummaryFilter;
  sortBy?: TeamTrackerBoardSort;
  groupBy?: TeamTrackerBoardGroupBy;
  viewId?: number;
}

export interface TeamTrackerBoardResolvedQuery {
  q: string;
  summaryFilter: TrackerBoardSummaryFilter;
  sortBy: TeamTrackerBoardSort;
  groupBy: TeamTrackerBoardGroupBy;
  viewId?: number;
}

export interface TrackerDeveloperGroup {
  key: string;
  label: string;
  count: number;
  developers: TrackerDeveloperDay[];
}

export interface TeamTrackerSavedView {
  id: number;
  name: string;
  q: string;
  summaryFilter: TrackerBoardSummaryFilter;
  sortBy: TeamTrackerBoardSort;
  groupBy: TeamTrackerBoardGroupBy;
  createdAt: string;
  updatedAt: string;
}

export interface TeamTrackerBoardResponse {
  date: string;
  viewMode: TeamTrackerViewMode;
  developers: TrackerDeveloperDay[];
  inactiveDevelopers: InactiveDeveloperListItem[];
  summary: TrackerBoardSummary;
  visibleSummary: TrackerBoardSummary;
  groups: TrackerDeveloperGroup[];
  query: TeamTrackerBoardResolvedQuery;
  attentionQueue: TrackerAttentionItem[];
}

export interface InactiveDeveloperListItem {
  developer: Developer;
  availability: DeveloperAvailability;
}

export interface MyDayResponse {
  date: string;
  viewMode: MyDayViewMode;
  readOnlyReason?: MyDayReadOnlyReason;
  developer: Developer;
  status: TrackerDeveloperStatus;
  capacityUnits?: number;
  availability: DeveloperAvailability;
  isReadOnly: boolean;
  lastCheckInAt?: string;
  currentItem?: TrackerWorkItem;
  plannedItems: TrackerWorkItem[];
  completedItems: TrackerWorkItem[];
  droppedItems: TrackerWorkItem[];
  checkIns: TrackerCheckIn[];
  isStale: boolean;
}

export interface TrackerIssueAssignment {
  date: string;
  jiraKey: string;
  itemId: number;
  title: string;
  state: TrackerItemState;
  developer: Developer;
}

export interface TrackerBoardSummary {
  total: number;
  stale: number;
  blocked: number;
  atRisk: number;
  waiting: number;
  noCurrent: number;
  overdueLinkedWork: number;
  overCapacity: number;
  statusFollowUp: number;
  doneForToday: number;
}

export interface TrackerFreshnessSignals {
  staleThresholdHours: number;
  noCurrentThresholdHours: number;
  statusFollowUpThresholdHours: number;
  hoursSinceCheckIn?: number;
  hoursSinceStatusChange?: number;
  staleByTime: boolean;
  staleWithOpenRisk: boolean;
  staleWithoutCurrentWork: boolean;
  statusChangeWithoutFollowUp: boolean;
}

export interface TrackerRiskSignals {
  openRisk: boolean;
  overdueLinkedWork: boolean;
  overdueLinkedCount: number;
  overCapacity: boolean;
  capacityDelta: number;
}

export interface TrackerDeveloperSignals {
  freshness: TrackerFreshnessSignals;
  risk: TrackerRiskSignals;
}

// ── Manager Desk types ─────────────────────────────────

export type ManagerDeskItemKind =
  | "action"
  | "meeting"
  | "decision"
  | "waiting";

export type ManagerDeskCategory =
  | "analysis"
  | "design"
  | "team_management"
  | "cross_team"
  | "follow_up"
  | "escalation"
  | "admin"
  | "planning"
  | "other";

export type ManagerDeskStatus =
  | "inbox"
  | "planned"
  | "in_progress"
  | "waiting"
  | "backlog"
  | "done"
  | "cancelled";

export type ManagerDeskPriority = "low" | "medium" | "high" | "critical";

export type ManagerDeskViewMode = "live" | "history" | "planning";

export type ManagerDeskLinkType =
  | "issue"
  | "developer"
  | "external_group";

export interface ManagerDeskDelegatedExecution {
  trackerItemId: number;
  state: TrackerItemState;
  note?: string;
  completedAt?: string;
  updatedAt: string;
}

export interface ManagerDeskLink {
  id: number;
  itemId: number;
  linkType: ManagerDeskLinkType;
  issueKey?: string;
  developerAccountId?: string;
  externalLabel?: string;
  displayLabel: string;
  createdAt: string;
}

export interface ManagerDeskAssignee {
  accountId: string;
  displayName: string;
  avatarUrl?: string;
  availability?: DeveloperAvailability;
}

export interface ManagerDeskItem {
  id: number;
  dayId: number;
  originDate: string;
  title: string;
  kind: ManagerDeskItemKind;
  category: ManagerDeskCategory;
  status: ManagerDeskStatus;
  priority: ManagerDeskPriority;
  assigneeDeveloperAccountId?: string;
  participants?: string;
  contextNote?: string;
  nextAction?: string;
  outcome?: string;
  plannedStartAt?: string;
  plannedEndAt?: string;
  followUpAt?: string;
  completedAt?: string;
  delegatedExecution?: ManagerDeskDelegatedExecution;
  assignee?: ManagerDeskAssignee;
  createdAt: string;
  updatedAt: string;
  links: ManagerDeskLink[];
}

export interface ManagerDeskSummary {
  totalOpen: number;
  inbox: number;
  planned: number;
  inProgress: number;
  waiting: number;
  overdueFollowUps: number;
  meetings: number;
  completed: number;
}

export interface ManagerDeskDayResponse {
  date: string;
  viewMode: ManagerDeskViewMode;
  items: ManagerDeskItem[];
  summary: ManagerDeskSummary;
  createdThatDayItems?: ManagerDeskItem[];
}

export type ManagerDeskCarryForwardTimeMode = "rebase_to_target_date";

export type ManagerDeskCarryForwardWarningCode =
  | "follow_up_overdue_on_arrival"
  | "planned_end_overdue_on_arrival";

export interface ManagerDeskCarryForwardPreviewItem {
  item: ManagerDeskItem;
  rebasedPlannedStartAt?: string;
  rebasedPlannedEndAt?: string;
  rebasedFollowUpAt?: string;
  warningCodes: ManagerDeskCarryForwardWarningCode[];
}

export interface ManagerDeskCarryForwardPreviewResponse {
  fromDate: string;
  toDate: string;
  carryable: number;
  overdueOnArrivalCount: number;
  timeMode: ManagerDeskCarryForwardTimeMode;
  items: ManagerDeskCarryForwardPreviewItem[];
}

export interface ManagerDeskCarryForwardContextResponse {
  fromDate?: string;
  toDate: string;
  carryable: number;
  overdueOnArrivalCount: number;
  timeMode: ManagerDeskCarryForwardTimeMode;
  items: ManagerDeskCarryForwardPreviewItem[];
}

export interface TrackerSharedTaskDetailResponse {
  date: string;
  developer: Developer;
  lifecycle: TrackerTaskLifecycle;
  managerDeskItem?: ManagerDeskItem;
  trackerItem: TrackerWorkItem;
}

export interface ManagerDeskIssueLookupItem {
  jiraKey: string;
  summary: string;
  priorityName: string;
  statusName: string;
  assigneeName?: string;
}

export interface ManagerDeskDeveloperLookupItem {
  accountId: string;
  displayName: string;
  email?: string;
  avatarUrl?: string;
  availability?: DeveloperAvailability;
}

export interface GlobalSearchIssueItem {
  jiraKey: string;
  summary: string;
  statusName: string;
  statusCategory: string;
  priorityName: string;
  assigneeName?: string;
  dueDate?: string;
  updatedAt: string;
}

export interface GlobalSearchDeskItem {
  itemId: number;
  date: string;
  title: string;
  kind: ManagerDeskItemKind;
  category: ManagerDeskCategory;
  status: ManagerDeskStatus;
  followUpAt?: string;
  completedAt?: string;
  updatedAt: string;
}

export interface GlobalSearchCheckInItem {
  checkInId: number;
  date: string;
  developerAccountId: string;
  developerName: string;
  summary: string;
  status?: string;
  createdAt: string;
}

export interface GlobalSearchDeveloperItem {
  accountId: string;
  displayName: string;
  email?: string;
  avatarUrl?: string;
}

export interface GlobalSearchResponse {
  query: string;
  issues: GlobalSearchIssueItem[];
  deskItems: GlobalSearchDeskItem[];
  checkIns: GlobalSearchCheckInItem[];
  developers: GlobalSearchDeveloperItem[];
  notes?: DailyNoteSummary[];
}

export interface WorkSavedView {
  id: number;
  name: string;
  filter: FilterType;
  developerAccountId?: string | null;
  tagId?: number | null;
  noTagsFilter: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface WorkSavedViewInput {
  name: string;
  filter?: FilterType;
  developerAccountId?: string | null;
  tagId?: number | null;
  noTagsFilter?: boolean;
}

export interface WorkSavedViewUpdate {
  name?: string;
  filter?: FilterType;
  developerAccountId?: string | null;
  tagId?: number | null;
  noTagsFilter?: boolean;
}

export interface WorkSavedViewsResponse {
  views: WorkSavedView[];
}

export interface ManagerDeskCreateItemPayload {
  date: string;
  title: string;
  kind?: ManagerDeskItemKind;
  category?: ManagerDeskCategory;
  status?: ManagerDeskStatus;
  priority?: ManagerDeskPriority;
  assigneeDeveloperAccountId?: string | null;
  participants?: string;
  contextNote?: string;
  nextAction?: string;
  plannedStartAt?: string;
  plannedEndAt?: string;
  followUpAt?: string;
  links?: Array<{
    linkType: ManagerDeskLinkType;
    issueKey?: string;
    developerAccountId?: string;
    externalLabel?: string;
  }>;
}

export interface ManagerDeskUpdateItemPayload {
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

export type ManagerDeskAddLinkPayload =
  | { linkType: "issue"; issueKey: string }
  | { linkType: "developer"; developerAccountId: string }
  | { linkType: "external_group"; externalLabel: string };

export interface ManagerDeskCarryForwardPayload {
  fromDate: string;
  toDate: string;
  itemIds?: number[];
}

export interface DailyNoteSummary {
  id: number;
  date: string;
  title: string;
  excerpt: string;
  updatedAt: string;
}

export interface DailyNote extends DailyNoteSummary {
  body: string;
  revision: number;
  createdAt: string;
}

export interface DailyNoteFollowUp {
  itemId: number;
  date: string;
  title: string;
  status: ManagerDeskStatus;
  followUpAt?: string;
}

export interface DailyNoteResponse {
  note: DailyNote | null;
  followUps: DailyNoteFollowUp[];
}

export interface DailyNotesResponse {
  notes: DailyNoteSummary[];
  nextCursor: string | null;
}

export interface SaveDailyNotePayload {
  body: string;
  revision: number;
}

export interface AppendDailyNotePayload {
  text: string;
  requestId: string;
}

export interface CreateDailyNoteFollowUpPayload {
  date: string;
  title: string;
  followUpAt: string;
  requestId: string;
}

export interface DailyNoteSource {
  itemId: number;
  noteId: number;
  date: string;
}

export interface DailyNoteSourcesResponse {
  sources: DailyNoteSource[];
}
