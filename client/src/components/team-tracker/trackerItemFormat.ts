import type { TaskEventSummary, TaskEventType } from '@/types';

function localDayMs(isoDate: string): number | null {
  const [year, month, day] = isoDate.split('-').map(Number);
  if (!year || !month || !day) {
    return null;
  }
  return new Date(year, month - 1, day).getTime();
}

/** Whole local days between a work item's origin date and the viewed date. */
export function continuedDays(originDate: string, viewDate: string): number {
  const origin = localDayMs(originDate);
  const view = localDayMs(viewDate);
  if (origin === null || view === null) {
    return 0;
  }
  return Math.max(0, Math.round((view - origin) / 86_400_000));
}

/** "just now", "12m ago", "3h ago", "2d ago" — dense lists read better than "2 days ago". */
export function formatCompactRelative(value: string, now = Date.now()): string {
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return '';
  const minutes = Math.floor((now - time) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 60) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

/** Events that carry a human-written body; the rest are system lines with no text of their own. */
const MESSAGE_EVENT_PREFIX: Partial<Record<TaskEventType, string>> = {
  update: '',
  instruction: 'Told them: ',
  decision: 'Decision: ',
  blocker: 'Blocker: ',
};

const SYSTEM_EVENT_LABELS: Record<TaskEventType, string> = {
  created: 'Created',
  update: 'Updated',
  instruction: 'Instruction',
  decision: 'Decision',
  blocker: 'Blocker',
  status: 'Status changed',
  assign: 'Reassigned',
  focus: 'Focus changed',
  title: 'Renamed',
  schedule: 'Rescheduled',
  link: 'Linked',
  checkin_ref: 'Mentioned in a check-in',
  note_ref: 'Mentioned in a note',
  merged: 'Merged',
};

/**
 * The latest task event as a single readable phrase. System events arrive
 * with their type as the excerpt ("focus", "title"), so they get a label
 * instead of leaking the raw type.
 */
export function describeLatestEvent(event: TaskEventSummary): { text: string; tone: 'default' | 'danger' } {
  const prefix = MESSAGE_EVENT_PREFIX[event.type];
  const hasBody = prefix !== undefined && event.excerpt.trim() && event.excerpt !== event.type;
  if (hasBody) {
    return { text: `${prefix}${event.excerpt}`, tone: event.type === 'blocker' ? 'danger' : 'default' };
  }
  return { text: SYSTEM_EVENT_LABELS[event.type] ?? event.excerpt, tone: 'default' };
}
