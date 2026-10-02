import type { FilterType } from '@/types';

export const PRIORITY_WEIGHTS: Record<string, number> = {
  Highest: 5,
  High: 3,
  Medium: 1,
  Low: 0.5,
  Lowest: 0.5,
};

export const PRIORITY_OPTIONS = ['Highest', 'High', 'Medium', 'Low', 'Lowest'];

export const FILTER_LABELS: Record<FilterType, string> = {
  all: 'All',
  new: 'New (24h)',
  recentlyAssigned: 'New to Team (24h)',
  inProgress: 'In Progress',
  reopened: 'Reopened',
  unassigned: 'Unassigned',
  dueToday: 'Due Today',
  dueThisWeek: 'Due This Week',
  noDueDate: 'No Due Date',
  overdue: 'Overdue',
  blocked: 'Blocked',
  stale: 'Stale',
  highPriority: 'High Priority',
  outOfTeam: 'Other Team',
  excluded: 'Excluded / snoozed',
};

export const FILTER_KEYS: FilterType[] = [
  'unassigned',
  'outOfTeam',
  'dueThisWeek',
  'noDueDate',
  'overdue',
  'blocked',
  'stale',
  'highPriority',
  'excluded',
];

export const CARD_CONFIGS = [
  { key: 'total' as const, label: 'Total Defects', color: '#06B6D4', filter: 'all' as FilterType },
  { key: 'recentlyAssigned' as const, label: 'New to Team (24h)', color: '#F59E0B', filter: 'recentlyAssigned' as FilterType },
  { key: 'dueToday' as const, label: 'Due Today', color: '#F97316', filter: 'dueToday' as FilterType },
  { key: 'overdue' as const, label: 'Overdue', color: '#EF4444', filter: 'overdue' as FilterType },
  { key: 'inProgress' as const, label: 'In Progress', color: '#10B981', filter: 'inProgress' as FilterType },
  { key: 'new' as const, label: 'New (24h)', color: '#8B5CF6', filter: 'new' as FilterType },
];

export const DEVELOPER_LOGIN_URL = 'https://developer.daycommand.online/my-day';
