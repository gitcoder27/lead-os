import { formatDate, isDueToday, isOverdue, isStale } from '@/lib/utils';
import type {
  FilterType,
  Issue,
  ManagerDeskDayResponse,
  ManagerDeskItem,
  OverviewCounts,
  TeamTrackerBoardResponse,
  TrackerDeveloperDay,
  TrackerWorkItem,
} from '@/types';

export type ManagerAttentionTarget = 'work' | 'team' | 'desk' | 'follow-ups' | 'meetings';
export type ManagerAttentionSeverity = 'critical' | 'warning' | 'info' | 'neutral';

export interface ManagerAttentionItem {
  id: string;
  title: string;
  detail: string;
  count: number;
  severity: ManagerAttentionSeverity;
  target: ManagerAttentionTarget;
  filter?: FilterType;
  samples: string[];
}

export interface ManagerPulseMetric {
  id: string;
  label: string;
  value: number;
  detail: string;
  severity: ManagerAttentionSeverity;
  target: ManagerAttentionTarget;
  filter?: FilterType;
}

export interface StandupPrompt {
  id: string;
  title: string;
  detail: string;
  target: ManagerAttentionTarget;
  filter?: FilterType;
}

export interface ManualWorkSummary {
  deskOpen: number;
  trackerOpen: number;
  total: number;
  samples: string[];
}

export interface ManagerTeamPulseItem {
  accountId: string;
  displayName: string;
  initials: string;
  status: string;
  tone: ManagerAttentionSeverity | 'success';
  detail: string;
  currentWork: string;
  lastUpdate: string;
  action: string;
}

export interface ManagerAttentionSnapshot {
  date: string;
  attentionItems: ManagerAttentionItem[];
  workMetrics: ManagerPulseMetric[];
  teamMetrics: ManagerPulseMetric[];
  deskMetrics: ManagerPulseMetric[];
  teamPulse: ManagerTeamPulseItem[];
  teamSize: number;
  followUpsDue: ManagerDeskItem[];
  manualWork: ManualWorkSummary;
  standupPrompts: StandupPrompt[];
  totalAttentionCount: number;
}

interface BuildManagerAttentionSnapshotParams {
  date: string;
  overview?: OverviewCounts;
  issues?: Issue[];
  teamBoard?: TeamTrackerBoardResponse;
  deskDay?: ManagerDeskDayResponse;
}

const openDeskStatuses = new Set<ManagerDeskItem['status']>(['inbox', 'planned', 'in_progress', 'waiting', 'backlog']);

function issueDueDate(issue: Issue): string | undefined {
  return issue.developmentDueDate ?? issue.dueDate;
}

function issueLabel(issue: Issue): string {
  return `${issue.jiraKey} ${issue.summary}`;
}

function countOrFallback(value: number | undefined, fallback: number): number {
  return value ?? fallback;
}

function sampleIssues(issues: Issue[] | undefined, predicate: (issue: Issue) => boolean, limit = 3): string[] {
  return (issues ?? [])
    .filter(predicate)
    .slice(0, limit)
    .map(issueLabel);
}

function isOpenDeskItem(item: ManagerDeskItem): boolean {
  return openDeskStatuses.has(item.status);
}

function hasIssueLink(item: ManagerDeskItem): boolean {
  return item.links.some((link) => link.linkType === 'issue');
}

function isDueOrOverdue(value?: string): boolean {
  return isDueToday(value) || isOverdue(value);
}

function getDeskFollowUpsDue(items: ManagerDeskItem[]): ManagerDeskItem[] {
  return items
    .filter((item) => isOpenDeskItem(item))
    .filter((item) => item.category === 'follow_up' || isDueOrOverdue(item.followUpAt))
    .filter((item) => !item.followUpAt || isDueOrOverdue(item.followUpAt))
    .sort((a, b) => (a.followUpAt ?? a.createdAt).localeCompare(b.followUpAt ?? b.createdAt));
}

function getTrackerManualItems(board?: TeamTrackerBoardResponse): TrackerWorkItem[] {
  return (board?.developers ?? []).flatMap((day) => [
    ...(day.currentItem && !day.currentItem.jiraKey ? [day.currentItem] : []),
    ...day.plannedItems.filter((item) => !item.jiraKey),
  ]);
}

function buildAttentionItems(params: BuildManagerAttentionSnapshotParams): ManagerAttentionItem[] {
  const { overview, issues, teamBoard, deskDay } = params;
  const overdueSamples = sampleIssues(issues, (issue) => isOverdue(issueDueDate(issue)));
  const dueTodaySamples = sampleIssues(issues, (issue) => isDueToday(issueDueDate(issue)));
  const blockedSamples = sampleIssues(issues, (issue) => issue.flagged || issue.statusName.toLowerCase().includes('block'));
  const unassignedSamples = sampleIssues(issues, (issue) => !issue.assigneeId);
  const staleSamples = sampleIssues(issues, (issue) => isStale(issue.updatedAt));
  const highPrioritySamples = sampleIssues(
    issues,
    (issue) => ['highest', 'high'].includes(issue.priorityName.toLowerCase()) && issue.statusCategory.toLowerCase() !== 'done',
  );
  const followUps = getDeskFollowUpsDue(deskDay?.items ?? []);
  const attentionQueueSamples = (teamBoard?.attentionQueue ?? [])
    .slice(0, 3)
    .map((item) => `${item.developer.displayName}: ${item.reasons[0]?.label ?? item.status.replace(/_/g, ' ')}`);

  const items: ManagerAttentionItem[] = [
    {
      id: 'overdue-work',
      title: 'Overdue work',
      detail: 'Jira defects past due date',
      count: countOrFallback(overview?.overdue, overdueSamples.length),
      severity: 'critical',
      target: 'work',
      filter: 'overdue',
      samples: overdueSamples,
    },
    {
      id: 'blocked-work',
      title: 'Blocked work',
      detail: 'Flagged or blocked Jira defects',
      count: countOrFallback(overview?.blocked, blockedSamples.length),
      severity: 'critical',
      target: 'work',
      filter: 'blocked',
      samples: blockedSamples,
    },
    {
      id: 'team-attention',
      title: 'Team attention',
      detail: 'People with blockers, risk, stale check-ins, or missing current work',
      count: teamBoard?.attentionQueue.length ?? 0,
      severity: (teamBoard?.summary.blocked ?? 0) > 0 ? 'critical' : 'warning',
      target: 'team',
      samples: attentionQueueSamples,
    },
    {
      id: 'follow-ups',
      title: 'Follow-ups due',
      detail: 'Manager Desk follow-ups due today or overdue',
      count: followUps.length,
      severity: followUps.some((item) => isOverdue(item.followUpAt)) ? 'critical' : 'warning',
      target: 'follow-ups',
      samples: followUps.slice(0, 3).map((item) => item.title),
    },
    {
      id: 'due-today',
      title: 'Due today',
      detail: 'Jira defects with a due date today',
      count: countOrFallback(overview?.dueToday, dueTodaySamples.length),
      severity: 'warning',
      target: 'work',
      filter: 'dueToday',
      samples: dueTodaySamples,
    },
    {
      id: 'unassigned',
      title: 'Unassigned work',
      detail: 'Jira defects without an owner',
      count: countOrFallback(overview?.unassigned, unassignedSamples.length),
      severity: 'info',
      target: 'work',
      filter: 'unassigned',
      samples: unassignedSamples,
    },
    {
      id: 'high-priority',
      title: 'High priority not started',
      detail: 'High priority Jira defects that need active attention',
      count: countOrFallback(overview?.highPriority, highPrioritySamples.length),
      severity: 'warning',
      target: 'work',
      filter: 'highPriority',
      samples: highPrioritySamples,
    },
    {
      id: 'stale',
      title: 'Stale work',
      detail: 'Jira defects without a recent update',
      count: countOrFallback(overview?.stale, staleSamples.length),
      severity: 'info',
      target: 'work',
      filter: 'stale',
      samples: staleSamples,
    },
  ];

  return items
    .filter((item) => item.count > 0)
    .sort((a, b) => severityRank(b.severity) - severityRank(a.severity) || b.count - a.count);
}

function severityRank(severity: ManagerAttentionSeverity): number {
  switch (severity) {
    case 'critical':
      return 4;
    case 'warning':
      return 3;
    case 'info':
      return 2;
    default:
      return 1;
  }
}

function buildManualWorkSummary(board?: TeamTrackerBoardResponse, deskDay?: ManagerDeskDayResponse): ManualWorkSummary {
  const deskItems = (deskDay?.items ?? []).filter((item) => isOpenDeskItem(item) && !hasIssueLink(item));
  const trackerItems = getTrackerManualItems(board);

  return {
    deskOpen: deskItems.length,
    trackerOpen: trackerItems.length,
    total: deskItems.length + trackerItems.length,
    samples: [...deskItems.map((item) => item.title), ...trackerItems.map((item) => item.title)].slice(0, 4),
  };
}

function buildWorkMetrics(params: BuildManagerAttentionSnapshotParams, manualWork: ManualWorkSummary): ManagerPulseMetric[] {
  const { overview, teamBoard } = params;
  return [
    {
      id: 'jira-defects',
      label: 'Jira defects',
      value: overview?.total ?? 0,
      detail: 'active in Work',
      severity: 'neutral',
      target: 'work',
    },
    {
      id: 'manual-work',
      label: 'Manual work',
      value: manualWork.total,
      detail: `${manualWork.deskOpen} desk, ${manualWork.trackerOpen} team`,
      severity: manualWork.total > 0 ? 'info' : 'neutral',
      target: manualWork.total > 0 ? 'desk' : 'work',
    },
    {
      id: 'at-risk',
      label: 'At risk',
      value: (teamBoard?.summary.atRisk ?? 0) + (overview?.highPriority ?? 0),
      detail: 'people and priority work',
      severity: 'warning',
      target: 'team',
    },
    {
      id: 'unassigned',
      label: 'Unassigned',
      value: overview?.unassigned ?? 0,
      detail: 'needs an owner',
      severity: 'info',
      target: 'work',
      filter: 'unassigned',
    },
    {
      id: 'due-soon',
      label: 'Due soon',
      value: (overview?.dueToday ?? 0) + (overview?.dueThisWeek ?? 0),
      detail: 'today or later this week',
      severity: 'warning',
      target: 'work',
      filter: 'dueThisWeek',
    },
    {
      id: 'blocked',
      label: 'Blocked',
      value: (overview?.blocked ?? 0) + (teamBoard?.summary.blocked ?? 0),
      detail: 'work and people',
      severity: 'critical',
      target: 'work',
      filter: 'blocked',
    },
  ];
}

function buildTeamMetrics(board?: TeamTrackerBoardResponse): ManagerPulseMetric[] {
  const summary = board?.summary;
  return [
    {
      id: 'blocked',
      label: 'Blocked',
      value: summary?.blocked ?? 0,
      detail: 'team members',
      severity: 'critical',
      target: 'team',
    },
    {
      id: 'missing-current',
      label: 'No current work',
      value: summary?.noCurrent ?? 0,
      detail: 'needs direction',
      severity: 'info',
      target: 'team',
    },
    {
      id: 'stale-checkins',
      label: 'Stale check-ins',
      value: summary?.stale ?? 0,
      detail: 'needs update',
      severity: 'warning',
      target: 'team',
    },
  ];
}

function buildDeskMetrics(deskDay?: ManagerDeskDayResponse): ManagerPulseMetric[] {
  const summary = deskDay?.summary;
  const openItems = deskDay?.items.filter(isOpenDeskItem) ?? [];
  return [
    {
      id: 'inbox',
      label: 'Inbox',
      value: summary?.inbox ?? 0,
      detail: 'uncategorized captures',
      severity: 'info',
      target: 'desk',
    },
    {
      id: 'planned',
      label: 'Today plan',
      value: summary?.planned ?? 0,
      detail: 'scheduled desk items',
      severity: 'neutral',
      target: 'desk',
    },
    {
      id: 'follow-ups',
      label: 'Follow-ups',
      value: getDeskFollowUpsDue(openItems).length,
      detail: 'due or overdue',
      severity: 'warning',
      target: 'follow-ups',
    },
    {
      id: 'meetings',
      label: 'Meetings',
      value: summary?.meetings ?? 0,
      detail: 'captured today',
      severity: 'neutral',
      target: 'desk',
    },
  ];
}

function getInitials(displayName: string): string {
  return displayName
    .split(/\s+/)
    .map((part) => part[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

function formatHoursAgo(value?: string): string {
  if (!value) {
    return 'No update';
  }

  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) {
    return 'No update';
  }

  const hours = Math.max(0, Math.round((Date.now() - timestamp) / 3_600_000));
  if (hours < 1) {
    return 'Just now';
  }
  if (hours < 24) {
    return `${hours}h ago`;
  }
  return `${Math.round(hours / 24)}d ago`;
}

function getCurrentWork(day: TrackerDeveloperDay): string {
  return day.currentItem?.title ?? day.plannedItems[0]?.title ?? 'No current work set';
}

function getPulseTone(day: TrackerDeveloperDay): ManagerTeamPulseItem['tone'] {
  if (day.status === 'blocked') {
    return 'critical';
  }

  if (day.status === 'at_risk' || day.signals?.freshness.staleWithoutCurrentWork || day.isStale) {
    return 'warning';
  }

  if (day.status === 'waiting') {
    return 'info';
  }

  return 'success';
}

function getPulseStatus(day: TrackerDeveloperDay): string {
  if (day.status === 'blocked') {
    return 'Blocked';
  }

  if (day.signals?.freshness.staleWithoutCurrentWork || day.isStale) {
    return 'Stale';
  }

  if (day.status === 'at_risk') {
    return 'At risk';
  }

  if (day.status === 'waiting') {
    return 'Waiting';
  }

  if (day.status === 'done_for_today') {
    return 'Done';
  }

  return 'On track';
}

function getPulseDetail(day: TrackerDeveloperDay): string {
  const topReason = day.signals?.freshness.staleWithoutCurrentWork
    ? 'No check-in or current work'
    : day.signals?.freshness.staleWithOpenRisk
      ? 'Risk needs update'
      : day.signals?.freshness.staleByTime
        ? 'Check-in is stale'
        : day.currentItem
          ? 'Current work active'
          : day.plannedItems.length > 0
            ? 'Planned work ready'
            : 'Needs plan';

  return topReason;
}

function buildTeamPulse(board?: TeamTrackerBoardResponse): ManagerTeamPulseItem[] {
  return (board?.developers ?? [])
    .slice()
    .sort((a, b) => {
      const aTone = getPulseTone(a);
      const bTone = getPulseTone(b);
      const aRank = severityRank(aTone === 'success' ? 'neutral' : aTone);
      const bRank = severityRank(bTone === 'success' ? 'neutral' : bTone);
      return bRank - aRank || a.developer.displayName.localeCompare(b.developer.displayName);
    })
    .slice(0, 6)
    .map((day) => {
      const status = getPulseStatus(day);
      return {
        accountId: day.developer.accountId,
        displayName: day.developer.displayName,
        initials: getInitials(day.developer.displayName),
        status,
        tone: getPulseTone(day),
        detail: getPulseDetail(day),
        currentWork: getCurrentWork(day),
        lastUpdate: formatHoursAgo(day.lastCheckInAt ?? day.updatedAt),
        action: status === 'On track' || status === 'Done' ? 'View' : 'Check-in',
      };
    });
}

function buildStandupPrompts(params: BuildManagerAttentionSnapshotParams, manualWork: ManualWorkSummary): StandupPrompt[] {
  const { overview, teamBoard, deskDay } = params;
  const prompts: StandupPrompt[] = [];
  const topAttention = teamBoard?.attentionQueue[0];
  const followUps = getDeskFollowUpsDue(deskDay?.items ?? []);

  if (topAttention) {
    prompts.push({
      id: 'top-person-risk',
      title: `Start with ${topAttention.developer.displayName}`,
      detail: topAttention.reasons.map((reason) => reason.label).slice(0, 2).join(', '),
      target: 'team',
    });
  }

  if ((overview?.blocked ?? 0) > 0 || (teamBoard?.summary.blocked ?? 0) > 0) {
    prompts.push({
      id: 'blockers',
      title: 'Ask for blocker movement',
      detail: `${(overview?.blocked ?? 0) + (teamBoard?.summary.blocked ?? 0)} blocker signal${(overview?.blocked ?? 0) + (teamBoard?.summary.blocked ?? 0) === 1 ? '' : 's'} across work and team`,
      target: 'work',
      filter: 'blocked',
    });
  }

  if ((overview?.unassigned ?? 0) > 0) {
    prompts.push({
      id: 'ownership',
      title: 'Assign ownership before standup ends',
      detail: `${overview?.unassigned ?? 0} Jira defect${overview?.unassigned === 1 ? '' : 's'} without an owner`,
      target: 'work',
      filter: 'unassigned',
    });
  }

  if (followUps.length > 0) {
    prompts.push({
      id: 'manager-promises',
      title: 'Close the manager promises',
      detail: followUps.slice(0, 2).map((item) => item.title).join(', '),
      target: 'follow-ups',
    });
  }

  if (manualWork.total > 0) {
    prompts.push({
      id: 'manual-work',
      title: 'Check non-Jira work',
      detail: manualWork.samples.join(', '),
      target: 'desk',
    });
  }

  if (prompts.length === 0) {
    prompts.push({
      id: 'clean-start',
      title: 'Confirm the plan and protect focus time',
      detail: 'No urgent attention signals are active right now.',
      target: 'team',
    });
  }

  return prompts.slice(0, 5);
}

export function buildManagerAttentionSnapshot(params: BuildManagerAttentionSnapshotParams): ManagerAttentionSnapshot {
  const manualWork = buildManualWorkSummary(params.teamBoard, params.deskDay);
  const attentionItems = buildAttentionItems(params);
  const followUpsDue = getDeskFollowUpsDue(params.deskDay?.items ?? []);

  return {
    date: params.date,
    attentionItems,
    workMetrics: buildWorkMetrics(params, manualWork),
    teamMetrics: buildTeamMetrics(params.teamBoard),
    deskMetrics: buildDeskMetrics(params.deskDay),
    teamPulse: buildTeamPulse(params.teamBoard),
    teamSize: params.teamBoard?.developers.length ?? 0,
    followUpsDue,
    manualWork,
    standupPrompts: buildStandupPrompts(params, manualWork),
    totalAttentionCount: attentionItems.reduce((sum, item) => sum + item.count, 0),
  };
}

export function formatManagerDueSignal(item: ManagerDeskItem): string {
  if (item.followUpAt) {
    return `${isOverdue(item.followUpAt) ? 'Overdue' : 'Due'} ${formatDate(item.followUpAt)}`;
  }

  return item.category === 'follow_up' ? 'Follow-up' : item.kind.replace(/_/g, ' ');
}
