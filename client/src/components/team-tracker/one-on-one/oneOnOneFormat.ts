import { differenceInCalendarDays, format, parseISO } from 'date-fns';
import type {
  OneOnOneAgendaItem,
  OneOnOneAgendaTask,
  OneOnOneSession,
  OneOnOneSuggestionReason,
  TaskStatus,
} from '@/types';
import type { DateTone } from '@/components/tasks/task-detail-format';
import { localDateOf } from '@/lib/task-list';

export const OPEN_STATUSES: ReadonlySet<TaskStatus> = new Set(['open', 'active', 'blocked']);

export function isOpenAgendaItem(item: OneOnOneAgendaItem): boolean {
  return OPEN_STATUSES.has(item.task.status) && !item.task.deletedAt;
}

function parseDay(iso: string): Date | null {
  const date = parseISO(iso.slice(0, 10));
  return Number.isNaN(date.getTime()) ? null : date;
}

/** "Tue, Sep 30" (year only when it differs). */
export function formatDay(iso: string, today: string): string {
  const date = parseDay(iso);
  const now = parseDay(today);
  if (!date || !now) return iso;
  return format(date, date.getFullYear() === now.getFullYear() ? 'EEE, MMM d' : 'EEE, MMM d, yyyy');
}

/** "Sep 30" — the short form used by quiet markers. */
export function formatShortDay(iso: string, today: string): string {
  const date = parseDay(iso);
  const now = parseDay(today);
  if (!date || !now) return iso;
  return format(date, date.getFullYear() === now.getFullYear() ? 'MMM d' : 'MMM d, yyyy');
}

/** The scheduled session's date: absolute label plus where it sits relative to today. */
export function describeSessionDate(iso: string, today: string): { label: string; hint: string; tone: DateTone } {
  const date = parseDay(iso);
  const now = parseDay(today);
  const label = formatDay(iso, today);
  if (!date || !now) return { label, hint: '', tone: 'default' };
  const diff = differenceInCalendarDays(date, now);
  if (diff === 0) return { label, hint: 'Today', tone: 'accent' };
  if (diff === 1) return { label, hint: 'Tomorrow', tone: 'default' };
  if (diff > 1) return { label, hint: `in ${diff} days`, tone: 'default' };
  return { label, hint: `${-diff}d overdue`, tone: 'warning' };
}

/** "today", "yesterday", "5 days ago", "2 weeks ago", "3 months ago". */
export function relativeDay(iso: string, today: string): string {
  const date = parseDay(iso);
  const now = parseDay(today);
  if (!date || !now) return '';
  const diff = differenceInCalendarDays(now, date);
  if (diff <= 0) return 'today';
  if (diff === 1) return 'yesterday';
  if (diff < 14) return `${diff} days ago`;
  if (diff < 60) return `${Math.round(diff / 7)} weeks ago`;
  return `${Math.round(diff / 30)} months ago`;
}

/** Live state of an agenda topic's task — the meta line under the title. */
export function describeAgendaTask(
  task: OneOnOneAgendaTask,
  today: string,
): { status?: { label: string; tone: DateTone }; date?: { label: string; tone: DateTone } } {
  const status =
    task.status === 'blocked'
      ? { label: 'Blocked', tone: 'danger' as const }
      : task.status === 'active'
        ? { label: 'In progress', tone: 'accent' as const }
        : task.status === 'done'
          ? { label: 'Done', tone: 'muted' as const }
          : task.status === 'dropped'
            ? { label: 'Dropped', tone: 'muted' as const }
            : undefined;
  if (!OPEN_STATUSES.has(task.status)) return { status };
  // The deadline's local day: `dueAt` is an instant (end of the local day), so a UTC slice can read a day off.
  const due = localDateOf(task.dueAt);
  if (due) {
    const diff = differenceInCalendarDays(parseDay(due) ?? new Date(), parseDay(today) ?? new Date());
    if (diff < 0) return { status, date: { label: `Due ${formatShortDay(due, today)} · ${-diff}d late`, tone: 'danger' } };
    if (diff === 0) return { status, date: { label: 'Due today', tone: 'warning' } };
    return { status, date: { label: `Due ${diff === 1 ? 'tomorrow' : formatShortDay(due, today)}`, tone: 'default' } };
  }
  if (task.scheduledOn) {
    const diff = differenceInCalendarDays(parseDay(task.scheduledOn) ?? new Date(), parseDay(today) ?? new Date());
    if (diff < 0) return { status, date: { label: `Planned ${formatShortDay(task.scheduledOn, today)} · slipped ${-diff}d`, tone: 'warning' } };
    if (diff === 0) return { status, date: { label: 'Planned today', tone: 'muted' } };
    return { status, date: { label: `Planned ${formatShortDay(task.scheduledOn, today)}`, tone: 'muted' } };
  }
  return { status };
}

export function reasonLabel(reason: OneOnOneSuggestionReason): { label: string; tone: DateTone } {
  switch (reason.code) {
    case 'blocked':
      return { label: 'Blocked', tone: 'danger' };
    case 'overdue':
      return reason.source === 'due'
        ? { label: `Overdue ${reason.days}d`, tone: 'danger' }
        : { label: `Slipped ${reason.days}d`, tone: 'warning' };
    case 'high_priority':
      return { label: 'High priority', tone: 'danger' };
    case 'carried':
      return { label: `Carried ${reason.days}d`, tone: 'warning' };
    case 'stale':
      return { label: `Quiet ${reason.days}d`, tone: 'muted' };
  }
}

export function checkInTopicTitle(checkIn: { lastCheckInAt: string | null; basis?: 'manager_touch' }, today: string): string {
  // docs/56 P1-03: on the manager-touch clock the timestamp is the manager's own
  // last touch, not an update from the person, so the wording is about catching up.
  if (checkIn.basis === 'manager_touch') {
    return checkIn.lastCheckInAt
      ? `Catch up — not touched since ${formatShortDay(checkIn.lastCheckInAt, today)}`
      : 'Catch up — how are things going?';
  }
  return checkIn.lastCheckInAt
    ? `Check in — no update since ${formatShortDay(checkIn.lastCheckInAt, today)}`
    : 'Check in — how are things going?';
}

/** Closed sessions, newest first, each with the close stamp of the one before it. */
export function closedSessions(sessions: OneOnOneSession[]): Array<{ session: OneOnOneSession; previousClosedAt: string | null }> {
  const closed = sessions
    .filter((session) => session.status !== 'scheduled')
    .sort((a, b) => b.scheduledFor.localeCompare(a.scheduledFor) || b.id - a.id);
  return closed.map((session, index) => ({ session, previousClosedAt: closed[index + 1]?.completedAt ?? null }));
}

/**
 * What was on the agenda for a closed session (matches the server's
 * approximate `agendaCount`): links attached before it closed, minus topics
 * already resolved before the previous session closed.
 */
export function sessionSnapshot(
  agenda: OneOnOneAgendaItem[],
  session: OneOnOneSession,
  previousClosedAt: string | null,
): OneOnOneAgendaItem[] {
  const closedAt = session.completedAt ?? session.createdAt;
  return agenda.filter((item) => {
    if (item.task.deletedAt || item.addedAt > closedAt) return false;
    return !(previousClosedAt && item.task.closedAt && item.task.closedAt < previousClosedAt);
  });
}

/** Topics whose tasks closed since the last session ended — talking points for wins. */
export function resolvedSinceLastSession(agenda: OneOnOneAgendaItem[], lastClosedAt: string | null): OneOnOneAgendaItem[] {
  return agenda.filter(
    (item) =>
      !item.task.deletedAt &&
      !OPEN_STATUSES.has(item.task.status) &&
      Boolean(item.task.closedAt) &&
      (!lastClosedAt || item.task.closedAt! >= lastClosedAt),
  );
}

/** Plain-text preview of markdown notes: no list markers, emphasis or headings. */
export function notesPreview(notes: string): string {
  return notes
    .split('\n')
    .map((line) =>
      line
        .replace(/^\s*#{1,6}\s+/, '')
        .replace(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/, '')
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/\s*→\s*[A-Z][A-Z0-9]*-\d+\s*$/, '')
        .trim(),
    )
    .filter(Boolean)
    .join(' · ');
}

/** The chip on the 1:1 "check in" suggestion; `days` are working days on the touch clock. */
export function checkInSuggestionChip(checkIn: { days: number | null; basis?: 'manager_touch' }): string {
  if (checkIn.basis === 'manager_touch') {
    return checkIn.days === null ? 'Not touched yet' : `Not touched ${checkIn.days}d`;
  }
  return checkIn.days === null ? 'No check-ins yet' : `No check-in ${checkIn.days}d`;
}
