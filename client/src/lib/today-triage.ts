import type { TodayActionCommand, TodayActionGroup, TodayActionItem } from '@/types';

/**
 * docs/53 U4: keyboard triage on Today — j/k move, Enter opens, e/Space runs
 * the primary action, s snoozes to tomorrow, f captures a follow-up, c adds a
 * check-in, z undoes the latest write. Pure so the mapping is testable.
 */
export type TodayTriageIntent =
  | { type: 'move'; delta: 1 | -1 }
  | { type: 'open' }
  | { type: 'command'; command: TodayActionCommand; preset?: 'tomorrow' }
  | { type: 'undo' };

export const TODAY_TRIAGE_KEYS: Array<{ keys: string[]; label: string }> = [
  { keys: ['j', 'k'], label: 'Move down / up' },
  { keys: ['Enter'], label: 'Open' },
  { keys: ['e', 'Space'], label: 'Primary action' },
  { keys: ['s'], label: 'Snooze to tomorrow' },
  { keys: ['f'], label: 'Follow up' },
  { keys: ['c'], label: 'Check-in' },
  { keys: ['z'], label: 'Undo' },
];

function findCommand(item: TodayActionItem, kind: TodayActionCommand['kind']): TodayActionCommand | undefined {
  if (item.primaryAction.kind === kind) return item.primaryAction;
  return item.secondaryActions.find((action) => action.kind === kind);
}

export function resolveTriageKey(key: string, item: TodayActionItem | undefined): TodayTriageIntent | undefined {
  switch (key) {
    case 'j':
    case 'ArrowDown':
      return { type: 'move', delta: 1 };
    case 'k':
    case 'ArrowUp':
      return { type: 'move', delta: -1 };
    case 'z':
      return { type: 'undo' };
  }
  if (!item || item.type === 'calm') {
    return undefined;
  }
  switch (key) {
    case 'Enter':
      return { type: 'open' };
    case 'e':
    case ' ':
      return { type: 'command', command: item.primaryAction };
    case 's': {
      const snooze = findCommand(item, 'snooze');
      return snooze ? { type: 'command', command: snooze, preset: 'tomorrow' } : undefined;
    }
    case 'f': {
      const followUp = findCommand(item, 'capture_follow_up');
      return followUp ? { type: 'command', command: followUp } : undefined;
    }
    case 'c': {
      const checkIn = findCommand(item, 'add_check_in');
      return checkIn ? { type: 'command', command: checkIn } : undefined;
    }
    default:
      return undefined;
  }
}

/** Keys typed into fields, or with modifiers, never triage. */
export function shouldIgnoreTriageEvent(event: Pick<KeyboardEvent, 'metaKey' | 'ctrlKey' | 'altKey' | 'defaultPrevented' | 'target'>): boolean {
  if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return true;
  const target = event.target as HTMLElement | null;
  if (!target || typeof target.closest !== 'function') return false;
  if (target.isContentEditable) return true;
  return Boolean(target.closest('input, textarea, select, [contenteditable="true"], [role="dialog"], [role="alertdialog"], [role="menu"]'));
}

// ── docs/53 F13: honest totals + in-place expansion ──────────────────────

export const TODAY_QUEUE_VISIBLE_LIMIT = 8;
const GROUP_ORDER: TodayActionGroup[] = ['now', 'next', 'later'];

export interface TodayQueueView {
  /** Rows always shown (ranked order). */
  head: TodayActionItem[];
  /** When expanded: the remaining rows grouped Now / Next / Later (ranked within). */
  groups: Array<{ group: TodayActionGroup; items: TodayActionItem[] }>;
  /** Rows not currently rendered (0 when expanded and all rows shipped). */
  hiddenCount: number;
  /** Actionable rows in the full queue (server total when provided). */
  totalCount: number;
  /** Display order — the keyboard triage list. */
  ordered: TodayActionItem[];
}

export function buildTodayQueueView(params: {
  items: TodayActionItem[];
  overflowItems?: TodayActionItem[];
  totalCount?: number;
  expanded: boolean;
  visibleLimit?: number;
}): TodayQueueView {
  const limit = params.visibleLimit ?? TODAY_QUEUE_VISIBLE_LIMIT;
  const all = [...params.items, ...(params.overflowItems ?? [])];
  const head = all.slice(0, limit);
  const rest = all.slice(limit);
  const actionable = all.filter((item) => item.type !== 'calm').length;
  const totalCount = Math.max(params.totalCount ?? actionable, actionable);
  const groups = params.expanded
    ? GROUP_ORDER
        .map((group) => ({ group, items: rest.filter((item) => item.group === group) }))
        .filter((entry) => entry.items.length > 0)
    : [];
  const renderedActionable = head.filter((item) => item.type !== 'calm').length + (params.expanded ? rest.length : 0);
  return {
    head,
    groups,
    hiddenCount: Math.max(totalCount - renderedActionable, 0),
    totalCount,
    ordered: [...head, ...groups.flatMap((entry) => entry.items)],
  };
}
