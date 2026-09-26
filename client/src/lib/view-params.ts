import type { TeamTrackerBoardGroupBy, TeamTrackerBoardQuery, TeamTrackerBoardSort, TrackerBoardSummaryFilter } from '@/types';
import { DEFAULT_DASHBOARD_FILTER_STATE, type DashboardFilterState } from '@/components/layout/dashboard-state';

// URL serialization for view-scoped filter state. Params only appear when they
// differ from the defaults, so bookmarkable URLs stay short and legible.

const FILTER_TYPES: DashboardFilterState['activeFilter'][] = [
  'all',
  'new',
  'recentlyAssigned',
  'inProgress',
  'reopened',
  'unassigned',
  'dueToday',
  'dueThisWeek',
  'noDueDate',
  'overdue',
  'blocked',
  'stale',
  'highPriority',
  'outOfTeam',
];

const SUMMARY_FILTERS: TrackerBoardSummaryFilter[] = [
  'all',
  'stale',
  'blocked',
  'at_risk',
  'waiting',
  'overdue_linked',
  'status_follow_up',
  'no_current',
  'done_for_today',
];

const SORTS: TeamTrackerBoardSort[] = ['name', 'attention', 'stale_age', 'load', 'blocked_first'];
const GROUPS: TeamTrackerBoardGroupBy[] = ['none', 'status', 'attention_state'];

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function isValidIsoDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) {
    return false;
  }
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(year ?? 0, (month ?? 1) - 1, day ?? 1);
  return (
    parsed.getFullYear() === year && parsed.getMonth() === (month ?? 1) - 1 && parsed.getDate() === day
  );
}

function firstParam(params: URLSearchParams, key: string): string | undefined {
  const value = params.get(key);
  return value !== null && value !== '' ? value : undefined;
}

function intParam(params: URLSearchParams, key: string): number | undefined {
  const value = firstParam(params, key);
  if (value === undefined || !/^\d+$/.test(value)) {
    return undefined;
  }
  return parseInt(value, 10);
}

function dateParam(params: URLSearchParams, key: string): string | undefined {
  const value = firstParam(params, key);
  return value !== undefined && isValidIsoDate(value) ? value : undefined;
}

function buildSearch(entries: Record<string, string | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(entries)) {
    if (value !== undefined && value !== '') {
      params.set(key, value);
    }
  }
  const search = params.toString();
  return search ? `?${search}` : '';
}

export function dashboardFilterStateToParams(state: DashboardFilterState): Record<string, string | undefined> {
  return {
    filter: state.activeFilter !== DEFAULT_DASHBOARD_FILTER_STATE.activeFilter ? state.activeFilter : undefined,
    dev: state.activeDeveloper,
    tag: state.selectedTagId !== undefined ? String(state.selectedTagId) : undefined,
    noTags: state.noTagsFilter ? '1' : undefined,
  };
}

export function dashboardFilterStateToSearch(state: DashboardFilterState): string {
  return buildSearch(dashboardFilterStateToParams(state));
}

export function dashboardFilterStateFromParams(params: URLSearchParams): DashboardFilterState {
  const filter = firstParam(params, 'filter');
  return {
    activeFilter: filter && (FILTER_TYPES as string[]).includes(filter) ? (filter as DashboardFilterState['activeFilter']) : DEFAULT_DASHBOARD_FILTER_STATE.activeFilter,
    activeDeveloper: firstParam(params, 'dev'),
    selectedTagId: intParam(params, 'tag'),
    noTagsFilter: firstParam(params, 'noTags') === '1',
  };
}

export function teamBoardQueryToParams(query: TeamTrackerBoardQuery): Record<string, string | undefined> {
  return {
    q: query.q || undefined,
    filter: query.summaryFilter,
    sort: query.sortBy !== 'attention' ? query.sortBy : undefined,
    group: query.groupBy !== 'none' ? query.groupBy : undefined,
    view: query.viewId !== undefined ? String(query.viewId) : undefined,
  };
}

export function teamBoardQueryToSearch(query: TeamTrackerBoardQuery): string {
  return buildSearch(teamBoardQueryToParams(query));
}

export function teamBoardQueryFromParams(params: URLSearchParams): TeamTrackerBoardQuery {
  const filter = firstParam(params, 'filter');
  const sort = firstParam(params, 'sort');
  const group = firstParam(params, 'group');
  return {
    q: firstParam(params, 'q'),
    summaryFilter: filter && (SUMMARY_FILTERS as string[]).includes(filter) ? (filter as TrackerBoardSummaryFilter) : undefined,
    sortBy: sort && (SORTS as string[]).includes(sort) ? (sort as TeamTrackerBoardSort) : undefined,
    groupBy: group && (GROUPS as string[]).includes(group) ? (group as TeamTrackerBoardGroupBy) : undefined,
    viewId: intParam(params, 'view'),
  };
}

/** Phase 3 (P3-D5): `/team?mode=standup` opens the standup overlay. */
export function teamModeFromParams(params: URLSearchParams): 'standup' | undefined {
  return firstParam(params, 'mode') === 'standup' ? 'standup' : undefined;
}

export type TeamPanel = 'one-on-one' | 'one-on-ones';

const TEAM_PANELS: readonly string[] = ['one-on-one', 'one-on-ones'];

/**
 * docs/48 (OO-D7): `/team?panel=one-on-ones` is the series overview;
 * `/team?dev=<accountId>&panel=one-on-one` is a developer's workspace.
 */
export function teamPanelFromParams(params: URLSearchParams): TeamPanel | undefined {
  const panel = firstParam(params, 'panel');
  return panel && TEAM_PANELS.includes(panel) ? (panel as TeamPanel) : undefined;
}

/** The `dev` param only carries meaning alongside `panel=one-on-one`. */
export function teamPanelDevFromParams(params: URLSearchParams): string | undefined {
  return firstParam(params, 'dev');
}

export function deskDateFromParams(params: URLSearchParams): string | undefined {
  return dateParam(params, 'date');
}

export function deskDateToSearch(date: string | undefined): string {
  return buildSearch({ date });
}

export function notesDateFromParams(params: URLSearchParams): string | undefined {
  return dateParam(params, 'date');
}

const TASK_KEY_PARAM_PATTERN = /^[Tt]-\d{1,9}$/;

export function taskKeyFromParams(params: URLSearchParams): string | undefined {
  const value = firstParam(params, 'task');
  if (!value || !TASK_KEY_PARAM_PATTERN.test(value)) {
    return undefined;
  }
  return `T-${Number(value.slice(2))}`;
}

export function taskKeyToParams(taskKey: string | undefined): Record<string, string | undefined> {
  return { task: taskKey };
}

/** Writes/removes the `?task=` param on the current URL without adding history. */
export function writeTaskParam(taskKey: string | undefined) {
  const params = new URLSearchParams(window.location.search);
  const current = params.get('task');
  if (taskKey && current !== taskKey) {
    params.set('task', taskKey);
  } else if (!taskKey && current !== null) {
    params.delete('task');
  } else {
    return;
  }
  const search = params.toString();
  window.history.replaceState(null, '', `${window.location.pathname}${search ? `?${search}` : ''}`);
}
