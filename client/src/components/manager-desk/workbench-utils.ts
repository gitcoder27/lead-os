import { isPast, parseISO } from 'date-fns';
import type {
  ManagerDeskCategory,
  ManagerDeskItem,
  ManagerDeskItemKind,
  ManagerDeskStatus,
} from '@/types/manager-desk';

export type ManagerDeskFilterState = {
  kind: ManagerDeskItemKind | null;
  category: ManagerDeskCategory | null;
  status: ManagerDeskStatus | null;
};

export type ManagerDeskQuickFilter =
  | 'all'
  | 'now'
  | 'planned'
  | 'inbox'
  | 'backlog'
  | 'done'
  | 'carried';

const priorityWeight = { critical: 0, high: 1, medium: 2, low: 3 };
const statusWeight = { in_progress: 0, planned: 1, waiting: 2, inbox: 3, backlog: 4, done: 5, cancelled: 6 };
const nonAttentionRank = 99;

export function isCompleted(item: ManagerDeskItem) {
  return item.status === 'done' || item.status === 'cancelled';
}

export function isLaterItem(item: ManagerDeskItem) {
  return item.status === 'backlog';
}

export function isOpenWork(item: ManagerDeskItem) {
  return !isCompleted(item) && !isLaterItem(item);
}

export function isOverdue(item: ManagerDeskItem) {
  if (!item.followUpAt || !isOpenWork(item)) return false;

  try {
    return isPast(parseISO(item.followUpAt));
  } catch {
    return false;
  }
}

export function isAttentionItem(item: ManagerDeskItem) {
  return getAttentionRank(item) < nonAttentionRank;
}

function getAttentionRank(item: ManagerDeskItem) {
  if (!isOpenWork(item)) return nonAttentionRank;
  if (isOverdue(item)) return 0;
  if (item.status === 'in_progress') return 1;
  if (item.status === 'inbox') return 2;
  if (item.priority === 'critical' || item.priority === 'high') return 4;
  return nonAttentionRank;
}

function getSearchText(item: ManagerDeskItem) {
  return [
    item.title,
    item.nextAction,
    item.outcome,
    item.contextNote,
    item.participants,
    item.assignee?.displayName,
    item.assigneeDeveloperAccountId,
    item.links.map((link) => link.displayLabel).join(' '),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

export function filterItems(
  items: ManagerDeskItem[],
  searchQuery: string,
  quickFilter: ManagerDeskQuickFilter,
  filters: ManagerDeskFilterState,
  date: string
) {
  const normalizedQuery = searchQuery.trim().toLowerCase();

  return items.filter((item) => {
    if (filters.kind && item.kind !== filters.kind) return false;
    if (filters.category && item.category !== filters.category) return false;
    if (filters.status && item.status !== filters.status) return false;

    if (normalizedQuery.length > 0 && !getSearchText(item).includes(normalizedQuery)) {
      return false;
    }

    switch (quickFilter) {
      case 'now':
        return item.status === 'in_progress';
      case 'planned':
        return item.status === 'planned' || item.status === 'waiting';
      case 'inbox':
        return item.status === 'inbox';
      case 'backlog':
        return isLaterItem(item);
      case 'done':
        return isCompleted(item);
      case 'carried':
        return isOpenWork(item) && item.originDate < date;
      default:
        return true;
    }
  });
}

export function sortForWorkbench(items: ManagerDeskItem[]) {
  return [...items].sort((left, right) => {
    const attentionDiff = getAttentionRank(left) - getAttentionRank(right);
    if (attentionDiff !== 0) return attentionDiff;

    const statusDiff = statusWeight[left.status] - statusWeight[right.status];
    if (statusDiff !== 0) return statusDiff;

    if (left.kind === 'meeting' || right.kind === 'meeting') {
      return (left.plannedStartAt ?? '').localeCompare(right.plannedStartAt ?? '');
    }

    const priorityDiff = priorityWeight[left.priority] - priorityWeight[right.priority];
    if (priorityDiff !== 0) return priorityDiff;

    if (left.status === 'inbox' || right.status === 'inbox') {
      return right.createdAt.localeCompare(left.createdAt);
    }

    if (left.plannedStartAt || right.plannedStartAt) {
      return (left.plannedStartAt ?? '').localeCompare(right.plannedStartAt ?? '');
    }

    return left.updatedAt.localeCompare(right.updatedAt);
  });
}

export function getOpenItems(items: ManagerDeskItem[]) {
  return sortForWorkbench(items.filter(isOpenWork));
}

export function getCompletedItems(items: ManagerDeskItem[]) {
  return sortForWorkbench(items.filter(isCompleted));
}

export function getContinuedOpenItems(items: ManagerDeskItem[], date: string) {
  return getOpenItems(items).filter((item) => item.originDate < date);
}

export function getInitialSelection(items: ManagerDeskItem[]) {
  return getOpenItems(items)[0] ?? items[0] ?? null;
}

export function getQuickFilterCount(items: ManagerDeskItem[], quickFilter: ManagerDeskQuickFilter, date: string) {
  if (quickFilter === 'all') {
    return items.length;
  }

  return filterItems(items, '', quickFilter, { kind: null, category: null, status: null }, date).length;
}

export function isInboxItem(item: ManagerDeskItem | null) {
  return item?.status === 'inbox';
}
