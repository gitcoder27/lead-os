import { format, isSameDay, parseISO, subDays } from 'date-fns';
import type {
  TodayActionItem,
  TodayActionTarget,
  TodayDelta,
  TodayFocus,
  TodayMeetingPrompt,
  TodayPromiseItem,
  TodayResponse,
  TodayRhythmStage,
  TodayStandupFocus,
  TodayTeamPulseItem,
} from '@/types';

/**
 * docs/53 §5/F6: the day drives the page — one section order per stage, built
 * from the same components. The server ranks the queue; the client only
 * decides which blocks sit around it.
 */
export type TodaySectionId = 'wrapUp' | 'standup' | 'delta' | 'queue' | 'dueSoon';

export function todaySectionOrder(stage: TodayRhythmStage | undefined): TodaySectionId[] {
  switch (stage) {
    case 'morning_plan':
    case 'standup_window':
      return ['delta', 'standup', 'queue'];
    case 'midday_check':
      return ['delta', 'queue', 'dueSoon', 'standup'];
    case 'wrap_up':
      return ['wrapUp', 'delta', 'queue'];
    default:
      return ['delta', 'queue'];
  }
}

export function standupFocus(focus: TodayFocus | undefined): TodayStandupFocus | undefined {
  if (!focus) return undefined;
  if ('morning' in focus) return focus.morning.standup;
  if ('midday' in focus) return focus.midday.standup;
  return undefined;
}

/** A stable identity for "the same thing" across queue rows, rail rows and pulse rows. */
export function targetIdentity(target: TodayActionTarget): string | undefined {
  if (target.managerDeskItemId) return `desk:${target.managerDeskItemId}`;
  // People rows (incl. "Set current" tracker targets) are about the person.
  if (target.developerAccountId && (target.type === 'developer' || target.type === 'tracker_item')) {
    return `dev:${target.developerAccountId}`;
  }
  if (target.taskKey && target.type !== 'view') return `task:${target.taskKey}`;
  if (target.issueKey && target.type === 'issue') return `issue:${target.issueKey}`;
  return undefined;
}

function identities(items: TodayActionItem[]): Set<string> {
  const ids = new Set<string>();
  for (const item of items) {
    const id = targetIdentity(item.target);
    if (id) ids.add(id);
  }
  return ids;
}

/**
 * docs/53 U1: the queue owns actions. The pulse lists only people who are
 * not already a queue row; the ones who are become an avatar strip.
 */
export function splitPulse(people: TodayTeamPulseItem[], queue: TodayActionItem[]) {
  const inQueue = identities(queue);
  const rows: TodayTeamPulseItem[] = [];
  const queued: TodayTeamPulseItem[] = [];
  for (const person of people) {
    (inQueue.has(`dev:${person.accountId}`) ? queued : rows).push(person);
  }
  return { rows, queued };
}

export type TodayRailItem =
  | { kind: 'promise'; item: TodayPromiseItem }
  | { kind: 'meeting'; item: TodayMeetingPrompt };

/** docs/53 U1/U7: one "Promises & meetings" list of things the queue doesn't already show. */
export function railItems(promises: TodayPromiseItem[], meetings: TodayMeetingPrompt[], queue: TodayActionItem[]): TodayRailItem[] {
  const inQueue = identities(queue);
  const notQueued = (target: TodayActionTarget) => {
    const id = targetIdentity(target);
    return !id || !inQueue.has(id);
  };
  return [
    ...promises.filter((item) => notQueued(item.target)).map((item) => ({ kind: 'promise' as const, item })),
    ...meetings.filter((item) => notQueued(item.target)).map((item) => ({ kind: 'meeting' as const, item })),
  ];
}

/**
 * At wrap-up the EOD block owns open promises and carry candidates — drop
 * those rows from the queue so each item lives in one place.
 */
export function withoutWrapUpItems(queue: TodayActionItem[], focus: TodayFocus | undefined): TodayActionItem[] {
  if (!focus || !('wrapUp' in focus)) return queue;
  const owned = new Set<string>();
  for (const promise of focus.wrapUp.openPromises) {
    const id = targetIdentity(promise.target);
    if (id) owned.add(id);
  }
  for (const carry of focus.wrapUp.carryCandidates) {
    const id = targetIdentity(carry.target);
    if (id) owned.add(id);
  }
  if (owned.size === 0) return queue;
  return queue.filter((item) => {
    if (item.type !== 'follow_up_due' && item.type !== 'desk_carry_forward') return true;
    const id = targetIdentity(item.target);
    return !id || !owned.has(id);
  });
}

/** docs/53 U5: up to two short reason chips instead of only the first. */
export function signalChips(signal: string): string[] {
  if (!signal.trim()) return [];
  if (signal.includes('Stale without current work')) return ['Stale', 'No current work'];
  return signal
    .split(' / ')
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 2);
}

// ── Since-last-visit strip ────────────────────────────────────────────────

export interface TodayDeltaChip {
  id: 'newIssues' | 'overdueOvernight' | 'newCheckIns' | 'followUpsNewlyDue' | 'resolved';
  label: string;
  tone: 'critical' | 'warning' | 'info' | 'success';
  /** Absent → informational only. */
  target?: TodayActionTarget;
  /** Names behind the count, for the tooltip. */
  detail?: string;
}

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

export function deltaChips(delta: TodayDelta | undefined, date: string): TodayDeltaChip[] {
  if (!delta?.since) return [];
  const chips: TodayDeltaChip[] = [];
  const { overdueOvernight, newIssues, newCheckIns, followUpsNewlyDue } = delta;
  if (overdueOvernight.count > 0) {
    chips.push({
      id: 'overdueOvernight',
      label: `${overdueOvernight.count} went overdue`,
      tone: 'critical',
      target: overdueOvernight.count === 1 && overdueOvernight.items[0]
        ? overdueOvernight.items[0].target
        : { type: 'view', view: 'work', filter: 'overdue', date },
      detail: overdueOvernight.items.map((item) => item.jiraKey).join(', '),
    });
  }
  if (newIssues.count > 0) {
    chips.push({
      id: 'newIssues',
      label: plural(newIssues.count, 'new defect'),
      tone: 'warning',
      target: newIssues.count === 1 && newIssues.items[0] ? newIssues.items[0].target : { type: 'view', view: 'work', date },
      detail: newIssues.items.map((item) => item.jiraKey).join(', '),
    });
  }
  if (followUpsNewlyDue.count > 0) {
    chips.push({
      id: 'followUpsNewlyDue',
      label: `${plural(followUpsNewlyDue.count, 'follow-up')} came due`,
      tone: 'warning',
      target: followUpsNewlyDue.count === 1 && followUpsNewlyDue.items[0]
        ? followUpsNewlyDue.items[0].target
        : { type: 'view', view: 'follow-ups', date },
      detail: followUpsNewlyDue.items.map((item) => item.title).join(', '),
    });
  }
  if (newCheckIns.count > 0) {
    const [only] = newCheckIns.people;
    chips.push({
      id: 'newCheckIns',
      label: plural(newCheckIns.count, 'check-in'),
      tone: 'info',
      target: newCheckIns.people.length === 1 && only ? only.target : { type: 'view', view: 'team', date },
      detail: newCheckIns.people.map((person) => person.displayName).join(', '),
    });
  }
  if (delta.resolvedCount > 0) {
    chips.push({ id: 'resolved', label: `${delta.resolvedCount} resolved`, tone: 'success' });
  }
  return chips;
}

/** "18:40", "yesterday 18:40", or "Fri 18:40" relative to now. */
export function formatSince(since: string, now: Date = new Date()): string {
  const at = parseISO(since);
  if (Number.isNaN(at.getTime())) return '';
  const time = format(at, 'HH:mm');
  if (isSameDay(at, now)) return time;
  if (isSameDay(at, subDays(now, 1))) return `yesterday ${time}`;
  return `${format(at, 'EEE')} ${time}`;
}

export function formatClock(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const at = parseISO(value);
  return Number.isNaN(at.getTime()) ? undefined : format(at, 'HH:mm');
}

// ── Header metrics (docs/53 U3) ───────────────────────────────────────────

const HEADER_METRIC_IDS = ['attention', 'stale', 'due-work', 'promises', 'sync'] as const;

/** Four decision metrics (+ Sync only while it's broken); inventory counts are dropped. */
export function headerMetrics(summary: TodayResponse['summary']) {
  return HEADER_METRIC_IDS
    .map((id) => summary.find((metric) => metric.id === id))
    .filter((metric): metric is TodayResponse['summary'][number] => Boolean(metric));
}

const METRIC_LABELS: Record<string, [string, string]> = {
  attention: ['in queue', 'in queue'],
  stale: ['stale', 'stale'],
  'due-work': ['due', 'due'],
  promises: ['follow-up', 'follow-ups'],
  sync: ['sync issue', 'sync issue'],
};

export function metricLabel(id: string, value: number, fallback: string): string {
  const labels = METRIC_LABELS[id];
  if (!labels) return fallback;
  return value === 1 ? labels[0] : labels[1];
}

// ── Copy helpers (docs/53 F16) ────────────────────────────────────────────

export function developerNameFor(snapshot: TodayResponse | undefined, accountId: string | undefined): string | undefined {
  if (!snapshot || !accountId) return undefined;
  const person = snapshot.teamPulse.find((entry) => entry.accountId === accountId);
  if (person) return person.displayName;
  const row = [...snapshot.actionItems, ...(snapshot.overflowActionItems ?? [])].find(
    (item) => item.target.developerAccountId === accountId && (item.type === 'developer_attention' || item.type === 'stale_check_in'),
  );
  return row?.title;
}

export function firstName(name: string): string {
  return name.split(/\s+/)[0] ?? name;
}

/** "Follow up with Deepak on AM-123" — uses what Today already knows. */
export function defaultFollowUpTitle(snapshot: TodayResponse | undefined, target: TodayActionTarget): string {
  const issueKey = target.issueKey ?? target.context?.issueKey;
  const name = developerNameFor(snapshot, target.developerAccountId);
  if (name && issueKey) return `Follow up with ${firstName(name)} on ${issueKey}`;
  if (name) return `Follow up with ${firstName(name)}`;
  if (issueKey) return `Follow up on ${issueKey}`;
  return 'Follow up';
}

/** Check-in placeholder from the row's signal (docs/53 F15: a hint, not a value). */
export function checkInPlaceholder(snapshot: TodayResponse | undefined, accountId: string | undefined): string {
  const row = snapshot?.actionItems.find((item) => item.target.developerAccountId === accountId && item.type !== 'calm');
  const reason = row ? signalChips(row.signal)[0] : undefined;
  return reason ? `${reason} — what did you hear?` : 'What did you hear?';
}
