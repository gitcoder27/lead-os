import { format, parseISO } from 'date-fns';
import type { TaskEvent, TaskEventType } from '@/types';

/**
 * docs/56 MDA-02: the activity feed reads like a conversation. People's messages
 * stand on their own; the app's bookkeeping between them becomes short,
 * plain-language changes, paired (focus + status), merged (repeated carry-overs,
 * renames) and folded into one line when there are more than a couple.
 */

export type NameResolver = (accountId: string) => string | undefined;

/** Event types that carry a human message: rendered as cards; the rest are changes. */
export const MESSAGE_TYPES = new Set<TaskEventType>(['update', 'instruction', 'decision', 'blocker', 'note_ref', 'checkin_ref']);

/** A run of changes longer than this folds into one summary line. */
export const INLINE_CHANGE_LIMIT = 2;

/** Changes this close together (same direction) are one thing that happened. */
const PAIR_WINDOW_MS = 5 * 60_000;

export function eventMeta(event: TaskEvent): Record<string, unknown> {
  return event.meta && typeof event.meta === 'object' ? (event.meta as Record<string, unknown>) : {};
}

export function blockerAction(event: TaskEvent): 'raised' | 'cleared' | undefined {
  const action = eventMeta(event).action;
  return action === 'raised' || action === 'cleared' ? action : undefined;
}

export function isMessageEvent(event: TaskEvent): boolean {
  return MESSAGE_TYPES.has(event.type) || (event.type === 'created' && Boolean(event.body));
}

/** docs/73 UXD-14: activity reads dates the manager's way — "Sat 10 Oct", never 2026-10-10. */
export function friendlyEventValue(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return format(parseISO(value), 'EEE d MMM');
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) {
    const date = new Date(value);
    // A due date is stored as the end of its day (23:59); the time says nothing, so only the day is shown.
    if (!Number.isNaN(date.getTime())) return date.getHours() === 23 && date.getMinutes() === 59 ? format(date, 'EEE d MMM') : format(date, 'EEE d MMM, HH:mm');
  }
  return value;
}

/** Older note excerpts were raw slices of the note: strip list, checkbox and emphasis syntax. */
export function plainExcerpt(value: string): string {
  return value
    .split('\n')
    .map((line) => line
      .replace(/^\s*#{1,6}\s+/, '')
      .replace(/^\s*(?:[-*+]|\d{1,9}[.)])\s+(?:\[[ xX]\]\s+)?/, '')
      .replace(/^\s*\[[ xX]?\]\s*/, '')
      .replace(/~~|\*\*|__/g, '')
      .trim())
    .filter(Boolean)
    .join(' · ');
}

function str(meta: Record<string, unknown>, field: string): string | undefined {
  const value = meta[field];
  return typeof value === 'string' && value ? value : undefined;
}

function person(meta: Record<string, unknown>, field: string, resolveName?: NameResolver): string | undefined {
  const id = str(meta, field);
  return id ? resolveName?.(id) ?? id : undefined;
}

function day(value: string | undefined): string {
  return value ? friendlyEventValue(value) : '';
}

const ACTIVE = new Set(['active', 'in_progress']);
const QUEUED = new Set(['open', 'planned']);
const CLOSED = new Set(['done', 'dropped', 'cancelled', 'deleted']);

function statusChange(meta: Record<string, unknown>): string {
  const from = str(meta, 'from');
  const to = str(meta, 'to') ?? '';
  const reason = str(meta, 'reason');
  switch (to) {
    case 'done': return 'Marked done';
    case 'dropped': return 'Dropped';
    case 'cancelled': return 'Cancelled';
    case 'deleted': return 'Deleted';
    case 'blocked': return 'Marked blocked';
    case 'waiting': return 'Moved to Waiting';
    case 'backlog': return 'Moved to Later';
    case 'inbox': return from && CLOSED.has(from) ? 'Reopened' : 'Moved to Inbox';
    default: break;
  }
  if (ACTIVE.has(to)) {
    if (from && CLOSED.has(from)) return 'Reopened and started';
    if (from === 'blocked') return 'Unblocked and started';
    return 'Started working on it';
  }
  if (QUEUED.has(to)) {
    if (from && CLOSED.has(from)) return 'Reopened';
    if (from === 'blocked') return 'Unblocked';
    if (from === 'waiting') return 'No longer waiting';
    if (from && ACTIVE.has(from)) {
      if (reason === 'single_current') return 'Paused for another task';
      if (reason === 'reassigned') return 'Back to planned after reassignment';
      return 'Moved back to the queue';
    }
    return 'Planned';
  }
  return `Status set to ${to.replace(/_/g, ' ')}`;
}

function scheduleChange(meta: Record<string, unknown>, resolveName?: NameResolver): string {
  const to = str(meta, 'to');
  const via = str(meta, 'via');
  switch (str(meta, 'field')) {
    case 'day':
      if (!to) return 'Unscheduled';
      if (via === 'carry_forward') return `Carried over to ${day(to)}`;
      return str(meta, 'from') ? `Moved to ${day(to)}` : `Scheduled for ${day(to)}`;
    case 'due_at':
      if (!to) return 'Due date cleared';
      return str(meta, 'from') ? `Due date moved to ${day(to)}` : `Due ${day(to)}`;
    case 'follow_up_at':
      if (!to) return 'Follow-up cleared';
      return via === 'snooze' ? `Snoozed until ${day(to)}` : `Follow-up set for ${day(to)}`;
    case 'planned_start_at': return to ? `Start set for ${day(to)}` : 'Start time cleared';
    case 'planned_end_at': return to ? `End set for ${day(to)}` : 'End time cleared';
    case 'waiting_on': return to ? `Waiting on ${person(meta, 'to', resolveName)}` : 'No longer waiting';
    default: return to ? `Schedule changed to ${day(to)}` : 'Schedule cleared';
  }
}

function linkChange(meta: Record<string, unknown>, resolveName?: NameResolver): string {
  const removed = meta.action === 'removed';
  const kind = str(meta, 'kind');
  const ref = kind === 'person' || kind === 'contact' ? person(meta, 'ref', resolveName) : str(meta, 'ref');
  const what = kind === 'external' ? `link ${ref ?? ''}`.trim() : kind === 'contact' ? `contact ${ref ?? ''}`.trim() : ref ?? 'a link';
  const role = meta.role === 'primary' && !removed ? ' as primary' : '';
  return `${removed ? 'Unlinked' : 'Linked'} ${what}${role}`;
}

function occurredDay(event: TaskEvent): string | undefined {
  const date = new Date(event.occurredAt);
  return Number.isNaN(date.getTime()) ? undefined : format(date, 'yyyy-MM-dd');
}

/** One plain sentence for an app-recorded change. The actor and time sit beside it. */
export function describeChange(event: TaskEvent, resolveName?: NameResolver): string {
  const meta = eventMeta(event);
  switch (event.type) {
    case 'created': {
      const owner = person(meta, 'ownerId', resolveName);
      return owner ? `Created for ${owner}` : 'Created';
    }
    case 'status': return statusChange(meta);
    case 'focus': {
      const date = str(meta, 'date');
      const forDay = date && date !== occurredDay(event) ? ` for ${day(date)}` : '';
      return `${meta.action === 'set_current' ? 'Started working on it' : 'Stopped working on it'}${forDay}`;
    }
    case 'assign': {
      const from = person(meta, 'fromId', resolveName);
      const to = person(meta, 'toId', resolveName);
      if (!to) return from ? `Unassigned from ${from}` : 'Unassigned';
      return from ? `Reassigned from ${from} to ${to}` : `Assigned to ${to}`;
    }
    case 'title': {
      const from = str(meta, 'from');
      return from ? `Renamed from “${from}” to “${str(meta, 'to') ?? ''}”` : `Renamed to “${str(meta, 'to') ?? ''}”`;
    }
    case 'schedule': return scheduleChange(meta, resolveName);
    case 'priority': return meta.to === 'high' ? 'Priority raised to High' : 'Priority back to Normal';
    case 'link': return linkChange(meta, resolveName);
    case 'merged': return `Merged ${str(meta, 'mergedKey') ?? 'a task'} into ${str(meta, 'survivorKey') ?? 'this task'}`;
    case 'blocker': return blockerAction(event) === 'cleared' ? 'Blocker cleared' : 'Blocker raised';
    case 'checkin_ref': return `Checked in on ${day(str(meta, 'date'))}`;
    case 'note_ref': return 'Mentioned in a note';
    default: return 'Changed';
  }
}

const NOTE_RELATION: Record<string, string> = {
  created_from: 'Created from your note',
  update_from: 'Updated from your note',
  mentioned: 'Mentioned in your note',
};

/** What a message card says under its header. */
export function messageBody(event: TaskEvent, resolveName?: NameResolver): string {
  if (event.body) return event.body;
  const meta = eventMeta(event);
  if (event.type === 'checkin_ref') return str(meta, 'excerpt') ?? `Checked in on ${day(str(meta, 'date'))}`;
  if (event.type === 'note_ref') {
    const excerpt = str(meta, 'excerpt');
    return excerpt ? plainExcerpt(excerpt) : `${NOTE_RELATION[str(meta, 'relation') ?? 'mentioned'] ?? NOTE_RELATION.mentioned} ${day(str(meta, 'noteDate'))}`;
  }
  if (event.type === 'blocker') return blockerAction(event) === 'cleared' ? 'Blocker cleared' : 'Blocker raised';
  return describeChange(event, resolveName);
}

/** The small context line beside a note reference ("Created from your note · Wed 23 Sep"). */
export function noteContext(event: TaskEvent): string | undefined {
  if (event.type !== 'note_ref') return undefined;
  const meta = eventMeta(event);
  const relation = NOTE_RELATION[str(meta, 'relation') ?? 'mentioned'] ?? NOTE_RELATION.mentioned;
  const date = str(meta, 'noteDate');
  return date ? `${relation} · ${day(date)}` : relation;
}

const VIA_LABELS: Record<string, string> = {
  standup: 'in standup',
  notes_page: 'from Notes',
  copilot: 'via Copilot',
  capture: 'from capture',
};

/** Where a message was written, when that adds something ("in standup"). */
export function viaLabel(event: TaskEvent): string | undefined {
  const via = str(eventMeta(event), 'via');
  return via ? VIA_LABELS[via] : undefined;
}

export interface ActivityChange {
  /** The newest event this change stands for (actions and time come from it). */
  event: TaskEvent;
  /** Every event folded into this change, newest first. */
  events: TaskEvent[];
  text: string;
  /** How many separate times it happened (repeated carry-overs, start/stop loops). */
  count: number;
}

export type ActivityItem =
  | { kind: 'message'; event: TaskEvent }
  | { kind: 'changes'; key: string; changes: ActivityChange[] };

function time(event: TaskEvent): number {
  const value = new Date(event.occurredAt).getTime();
  return Number.isNaN(value) ? 0 : value;
}

function near(a: TaskEvent, b: TaskEvent): boolean {
  return Math.abs(time(a) - time(b)) <= PAIR_WINDOW_MS;
}

/** A focus toggle and the status change it caused are one change: keep the status. */
function dropPairedFocus(run: TaskEvent[]): TaskEvent[] {
  return run.filter((event) => {
    if (event.type !== 'focus' || event.redacted) return true;
    const set = eventMeta(event).action === 'set_current';
    return !run.some((other) => {
      if (other.type !== 'status' || other.redacted || !near(event, other)) return false;
      const meta = eventMeta(other);
      return set ? ACTIVE.has(String(meta.to)) : ACTIVE.has(String(meta.from));
    });
  });
}

function mergeKey(event: TaskEvent, text: string): string {
  if (event.redacted) return `redacted:${event.id}`;
  const meta = eventMeta(event);
  if (event.type === 'schedule' && meta.field === 'day' && meta.via === 'carry_forward') return 'carry';
  if (event.type === 'title') return 'title';
  return `text:${text}`;
}

function mergedText(key: string, change: ActivityChange, resolveName?: NameResolver): string {
  if (key === 'carry' && change.count > 1) {
    return `Carried over ${change.count} times, now ${day(str(eventMeta(change.event), 'to'))}`;
  }
  if (key === 'title') {
    const oldest = change.events[change.events.length - 1]!;
    const from = str(eventMeta(oldest), 'from');
    const to = str(eventMeta(change.event), 'to') ?? '';
    return from ? `Renamed from “${from}” to “${to}”` : `Renamed to “${to}”`;
  }
  return describeChange(change.event, resolveName);
}

/** Pairs, dedupes and merges one run of changes (newest first in, newest first out). */
export function summarizeChanges(run: TaskEvent[], resolveName?: NameResolver): ActivityChange[] {
  const changes: (ActivityChange & { key: string })[] = [];
  for (const event of dropPairedFocus(run)) {
    const text = event.redacted ? 'This entry was removed.' : describeChange(event, resolveName);
    const key = mergeKey(event, text);
    const previous = changes[changes.length - 1];
    if (previous && previous.key === key) {
      // A mirror of the same change moments apart is one change; later repeats count.
      if (!near(previous.events[previous.events.length - 1]!, event) || key === 'carry') previous.count += 1;
      previous.events.push(event);
      previous.text = mergedText(key, previous, resolveName);
      continue;
    }
    changes.push({ key, event, events: [event], text, count: 1 });
  }
  return foldFocusLoops(changes.map(({ key: _key, ...change }) => change));
}

const STARTED = 'Started working on it';
const PAUSES = new Set(['Paused for another task', 'Stopped working on it']);

function times(count: number): string {
  return count === 1 ? 'once' : count === 2 ? 'twice' : `${count} times`;
}

/** Switching between tasks all day is one story, not a ladder of starts and pauses. */
function foldFocusLoops(changes: ActivityChange[]): ActivityChange[] {
  const out: ActivityChange[] = [];
  let loop: ActivityChange[] = [];
  const flush = () => {
    if (loop.length < 3) {
      out.push(...loop);
    } else {
      const pauses = loop.filter((change) => PAUSES.has(change.text)).reduce((sum, change) => sum + change.count, 0);
      const starts = loop.filter((change) => change.text === STARTED).reduce((sum, change) => sum + change.count, 0);
      const newest = loop[0]!;
      out.push({
        event: newest.event,
        events: loop.flatMap((change) => change.events),
        count: 1,
        text: newest.text === STARTED ? `Paused and resumed ${times(pauses)}` : `Started and paused ${times(starts)}`,
      });
    }
    loop = [];
  };
  for (const change of changes) {
    if (!change.event.redacted && (change.text === STARTED || PAUSES.has(change.text))) {
      loop.push(change);
    } else {
      flush();
      out.push(change);
    }
  }
  flush();
  return out;
}

/**
 * Splits a newest-first event list into message cards and change runs. The
 * task's creation is its own run so the feed always ends on where it began.
 */
export function buildActivityFeed(events: TaskEvent[], resolveName?: NameResolver): ActivityItem[] {
  const items: ActivityItem[] = [];
  let run: TaskEvent[] = [];
  const flush = () => {
    if (!run.length) return;
    const created = run.filter((event) => event.type === 'created');
    const rest = run.filter((event) => event.type !== 'created');
    if (rest.length) items.push({ kind: 'changes', key: `changes-${rest[0]!.id}`, changes: summarizeChanges(rest, resolveName) });
    for (const event of created) items.push({ kind: 'changes', key: `created-${event.id}`, changes: summarizeChanges([event], resolveName) });
    run = [];
  };
  for (const event of events) {
    if (isMessageEvent(event)) {
      flush();
      items.push({ kind: 'message', event });
    } else {
      run.push(event);
    }
  }
  flush();
  return items;
}
