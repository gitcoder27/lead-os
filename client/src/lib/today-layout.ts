import { format, isSameDay, parseISO, subDays } from 'date-fns';
import type {
  TodayActionCommand,
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
 * docs/53 §5/F6: the day drives the page. The queue always owns the left
 * column; the stage panel on the right changes with the stage. The server
 * ranks the queue — the client only decides which blocks fill the panel.
 */
export type TodayPanelSectionId =
  | 'wrapUp'
  | 'standup'
  | 'delta'
  | 'dueSoon'
  | 'quiet'
  | 'oneOnOnes'
  | 'carry'
  | 'promises'
  | 'people';

export function todayPanelOrder(stage: TodayRhythmStage | undefined): TodayPanelSectionId[] {
  switch (stage) {
    case 'morning_plan':
    case 'standup_window':
      return ['standup', 'delta', 'oneOnOnes', 'carry', 'promises', 'people'];
    case 'midday_check':
      return ['dueSoon', 'quiet', 'delta', 'standup', 'oneOnOnes', 'carry', 'promises', 'people'];
    case 'wrap_up':
      return ['wrapUp', 'delta', 'oneOnOnes', 'promises', 'people'];
    default:
      return ['delta', 'oneOnOnes', 'carry', 'promises', 'people'];
  }
}

// ── Queue vs panel ownership ──────────────────────────────────────────────

export interface TodayPanelRows {
  /** What the left column shows: people, work, promises, meetings, signals. */
  queue: TodayActionItem[];
  /** The server's "Start standup" row — the panel's standup card owns it. */
  standup?: TodayActionItem;
  oneOnOnes: TodayActionItem[];
  carry: TodayActionItem[];
}

/**
 * docs/53 U1: the stage panel owns the day's fixtures — standup, 1:1s and
 * carry-forward — so the queue is only the things that need a decision.
 */
export function splitPanelRows(items: TodayActionItem[]): TodayPanelRows {
  const out: TodayPanelRows = { queue: [], oneOnOnes: [], carry: [] };
  for (const item of items) {
    if (item.type === 'standup') out.standup ??= item;
    else if (item.type === 'one_on_one') out.oneOnOnes.push(item);
    else if (item.type === 'desk_carry_forward') out.carry.push(item);
    else out.queue.push(item);
  }
  return out;
}

// ── Queue grouping ────────────────────────────────────────────────────────

/** Rows about people that share one reason collapse into a single group row. */
const PEOPLE_TYPES = new Set<TodayActionItem['type']>(['stale_check_in', 'developer_attention']);
export const QUEUE_GROUP_MIN = 3;

export interface TodayQueueGroup {
  id: string;
  kind: 'people' | 'duplicates';
  /** The chip on the group row ("Stale by time", "×2"). */
  reason: string;
  members: TodayActionItem[];
  /** The group row's one-tap write, fanned out per member. */
  bulk?: { label: string; commands: TodayActionCommand[]; toast: (count: number) => string };
}

/**
 * One row per fact: "5 people · Stale by time · Ask all" instead of five
 * identical rows, and one "Standup follow-up: Harsha ×2 · Done all" instead
 * of two. The group sits at its highest-ranked member's position and is a
 * synthetic queue item, so limits, expansion and triage treat it as a row.
 */
export function groupQueueItems(items: TodayActionItem[]): { items: TodayActionItem[]; groups: Map<string, TodayQueueGroup> } {
  const buckets = new Map<string, { kind: TodayQueueGroup['kind']; reason: string; members: TodayActionItem[] }>();
  for (const item of items) {
    let key: string | undefined;
    let kind: TodayQueueGroup['kind'] = 'people';
    let reason = '';
    if (PEOPLE_TYPES.has(item.type)) {
      reason = signalChips(item.signal)[0] ?? item.signal;
      key = `people|${item.type}|${reason}|${item.primaryAction.kind}`;
    } else if (item.type === 'follow_up_due' || item.type === 'meeting_outcome') {
      kind = 'duplicates';
      key = `dup|${item.type}|${item.title.trim().toLowerCase()}`;
    }
    if (!key) continue;
    const bucket = buckets.get(key) ?? { kind, reason, members: [] };
    bucket.members.push(item);
    buckets.set(key, bucket);
  }

  const groups = new Map<string, TodayQueueGroup>();
  const memberToGroup = new Map<string, string>();
  for (const [key, bucket] of buckets) {
    const min = bucket.kind === 'people' ? QUEUE_GROUP_MIN : 2;
    if (bucket.members.length < min) continue;
    const id = `group:${key}`;
    groups.set(id, buildGroup(id, bucket.kind, bucket.reason, bucket.members));
    for (const member of bucket.members) memberToGroup.set(member.id, id);
  }
  if (groups.size === 0) return { items, groups };

  const out: TodayActionItem[] = [];
  const emitted = new Set<string>();
  for (const item of items) {
    const groupId = memberToGroup.get(item.id);
    if (!groupId) {
      out.push(item);
      continue;
    }
    if (emitted.has(groupId)) continue;
    emitted.add(groupId);
    out.push(groupItem(groups.get(groupId)!));
  }
  return { items: out, groups };
}

function buildGroup(id: string, kind: TodayQueueGroup['kind'], reason: string, members: TodayActionItem[]): TodayQueueGroup {
  if (kind === 'duplicates') {
    const lead = members[0]!;
    const commands = members.map((member) => member.primaryAction).filter((command) => command.kind === lead.primaryAction.kind);
    return {
      id,
      kind,
      reason: `×${members.length}`,
      members,
      bulk: commands.length === members.length && lead.primaryAction.kind === 'mark_done'
        ? { label: 'Done all', commands, toast: (count) => `Marked ${count} done` }
        : undefined,
    };
  }
  const asks = members
    .filter((member) => !member.askedAt)
    .map((member) => member.secondaryActions.find((action) => action.kind === 'ask_check_in'))
    .filter((command): command is TodayActionCommand => Boolean(command));
  return {
    id,
    kind,
    reason,
    members,
    bulk: asks.length > 0
      ? { label: asks.length === members.length ? 'Ask all' : `Ask ${asks.length}`, commands: asks, toast: (count) => `Asked ${count} for an update` }
      : undefined,
  };
}

function groupItem(group: TodayQueueGroup): TodayActionItem {
  const lead = group.members[0]!;
  const teamTarget: TodayActionTarget = { type: 'view', view: 'team', date: lead.target.date };
  const asked = group.members.filter((member) => member.askedAt).length;
  const base = {
    id: group.id,
    type: lead.type,
    signal: group.reason,
    severity: group.members.some((member) => member.severity === 'critical') ? 'critical' as const : lead.severity,
    priority: lead.priority,
    group: lead.group,
    secondaryActions: [],
  };
  if (group.kind === 'duplicates') {
    return {
      ...base,
      title: lead.title,
      context: lead.context,
      freshness: lead.freshness,
      target: lead.target,
      primaryAction: group.bulk
        ? { kind: lead.primaryAction.kind, label: group.bulk.label, target: lead.target }
        : lead.primaryAction,
    };
  }
  return {
    ...base,
    title: `${group.members.length} people`,
    context: group.members.map((member) => firstName(member.title)).join(', '),
    freshness: asked > 0 ? `${asked} asked` : undefined,
    target: teamTarget,
    primaryAction: group.bulk
      ? { kind: 'ask_check_in', label: group.bulk.label, target: teamTarget }
      : { kind: 'open', label: 'Open Team', target: teamTarget },
  };
}

export function isQueueGroupId(id: string): boolean {
  return id.startsWith('group:');
}

/** Server placeholders that say nothing about the row. */
const FILLER_CONTEXT = new Set(['Open Manager Desk item', 'Manager follow-up', 'Meeting memory', 'Needs captured outcome']);

/** A row's second line: real context, or where it came from, never filler. */
export function rowContext(item: Pick<TodayActionItem, 'context' | 'type' | 'target'>, today?: string): string | undefined {
  if (item.context && !FILLER_CONTEXT.has(item.context)) return item.context;
  const origin = item.target.date;
  if (origin && origin !== today && (item.type === 'desk_carry_forward' || item.type === 'meeting_outcome')) {
    const at = parseISO(origin);
    if (!Number.isNaN(at.getTime())) return `from ${format(at, 'EEE d MMM')}`;
  }
  return undefined;
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
  attention: ['open', 'open'],
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
