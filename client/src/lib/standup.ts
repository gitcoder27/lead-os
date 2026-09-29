import type {
  StandupFeedEntry,
  SurfaceTask,
  TaskEventSummary,
  TrackerDeveloperDay,
  TrackerDeveloperStatus,
  TrackerWorkItem,
} from '@/types';
import { getLocalIsoDate } from '@/lib/utils';

/**
 * docs/50: pure standup logic — session model (S1–S3), the person's day
 * strip (§4), feed grouping (S5), follow-up reasons and the wrap-up summary
 * (§5). Components stay presentational; everything here is unit-tested.
 */

// ── Tasks ────────────────────────────────────────────────────────────────

export type StandupTaskStatus = 'open' | 'active' | 'blocked';

export interface StandupTask {
  taskKey: string;
  title: string;
  status: StandupTaskStatus;
  latestEvent?: TaskEventSummary;
  jiraKey?: string;
  highPriority?: boolean;
}

const OPENISH = new Set(['open', 'active', 'blocked']);

/** Open work in board position order — the j/k navigation set. */
export function openTasksFor(day: TrackerDeveloperDay | undefined): StandupTask[] {
  if (!day) return [];
  if (day.tasks?.length) {
    return day.tasks
      .filter((task): task is SurfaceTask => OPENISH.has(task.status))
      .sort((left, right) => left.position - right.position)
      .map((task) => ({
        taskKey: task.taskKey,
        title: task.title,
        status: task.status as StandupTaskStatus,
        latestEvent: task.latestEvent,
        jiraKey: task.jiraKey,
        highPriority: task.priority === 'high',
      }));
  }
  const fromItems = (items: Array<TrackerWorkItem | undefined>, status: StandupTaskStatus) =>
    items.flatMap((item) =>
      item?.taskKey
        ? [{ taskKey: item.taskKey, title: item.title, status, latestEvent: item.latestEvent, jiraKey: item.jiraKey }]
        : [],
    );
  return [...fromItems([day.currentItem], 'active'), ...fromItems(day.plannedItems, 'open')];
}

/** Tasks closed as done today (the board only carries today's closures). */
export function doneTodayFor(day: TrackerDeveloperDay | undefined): Array<{ taskKey: string; title: string }> {
  if (!day) return [];
  if (day.tasks?.length) {
    return day.tasks.filter((task) => task.status === 'done').map((task) => ({ taskKey: task.taskKey, title: task.title }));
  }
  return day.completedItems.flatMap((item) => (item.taskKey ? [{ taskKey: item.taskKey, title: item.title }] : []));
}

export interface DayStats {
  current?: StandupTask;
  open: number;
  blocked: number;
  doneToday: number;
  checkInsToday: number;
  lastCheckInAt?: string;
}

export function checkInsToday(day: TrackerDeveloperDay, date: string): number {
  if (day.checkIns.length) return day.checkIns.length;
  // Fallback when the exact-day record isn't loaded: the effective day's
  // last check-in still counts if it happened on the standup date.
  return day.lastCheckInAt && getLocalIsoDate(new Date(day.lastCheckInAt)) === date ? 1 : 0;
}

export function dayStats(day: TrackerDeveloperDay, date: string): DayStats {
  const open = openTasksFor(day);
  return {
    current: open.find((task) => task.status === 'active'),
    open: open.length,
    blocked: open.filter((task) => task.status === 'blocked').length,
    doneToday: doneTodayFor(day).length,
    checkInsToday: checkInsToday(day, date),
    lastCheckInAt: day.lastCheckInAt,
  };
}

// ── Session (S1–S3) ──────────────────────────────────────────────────────

export type StandupLogKind = 'update' | 'checkin' | 'status' | 'current' | 'done' | 'blocked' | 'reassign' | 'added';

export interface StandupLogEntry {
  accountId: string;
  kind: StandupLogKind;
  taskKey?: string;
  /** Short human detail, e.g. the new status label or reassignee name. */
  detail?: string;
  at: string;
}

export interface StandupSession {
  reviewed: string[];
  flagged: string[];
  log: StandupLogEntry[];
  /** ISO timestamp of the first session action — sent as startedAt on seal. */
  startedAt?: string;
}

export const EMPTY_STANDUP_SESSION: StandupSession = { reviewed: [], flagged: [], log: [] };

export type StandupSessionAction =
  | { type: 'review'; accountId: string; at: string }
  | { type: 'toggle_flag'; accountId: string; at: string }
  | { type: 'log'; entry: StandupLogEntry }
  | { type: 'reset' };

export function standupSessionReducer(state: StandupSession, action: StandupSessionAction): StandupSession {
  switch (action.type) {
    case 'review':
      return state.reviewed.includes(action.accountId)
        ? state
        : { ...state, startedAt: state.startedAt ?? action.at, reviewed: [...state.reviewed, action.accountId] };
    case 'toggle_flag':
      return {
        ...state,
        startedAt: state.startedAt ?? action.at,
        flagged: state.flagged.includes(action.accountId)
          ? state.flagged.filter((id) => id !== action.accountId)
          : [...state.flagged, action.accountId],
      };
    case 'log': {
      // S2: any successful write for a person also counts as reviewing them.
      const reviewed = state.reviewed.includes(action.entry.accountId) ? state.reviewed : [...state.reviewed, action.entry.accountId];
      return { ...state, startedAt: state.startedAt ?? action.entry.at, reviewed, log: [...state.log, action.entry] };
    }
    case 'reset':
      return EMPTY_STANDUP_SESSION;
    default:
      return state;
  }
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

export function loadStandupSession(key: string): StandupSession {
  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return EMPTY_STANDUP_SESSION;
    const parsed = JSON.parse(raw) as Partial<StandupSession>;
    return {
      reviewed: isStringArray(parsed.reviewed) ? parsed.reviewed : [],
      flagged: isStringArray(parsed.flagged) ? parsed.flagged : [],
      log: Array.isArray(parsed.log)
        ? parsed.log.filter((entry): entry is StandupLogEntry => Boolean(entry && typeof entry.accountId === 'string' && typeof entry.kind === 'string'))
        : [],
      ...(typeof parsed.startedAt === 'string' ? { startedAt: parsed.startedAt } : {}),
    };
  } catch {
    return EMPTY_STANDUP_SESSION;
  }
}

export function saveStandupSession(key: string, session: StandupSession): void {
  try {
    if (session === EMPTY_STANDUP_SESSION || (!session.reviewed.length && !session.flagged.length && !session.log.length)) {
      window.sessionStorage.removeItem(key);
    } else {
      window.sessionStorage.setItem(key, JSON.stringify(session));
    }
  } catch {
    // Storage can be unavailable (private mode, quota); the session still works in memory.
  }
}

export interface SessionTotals {
  updates: number;
  checkins: number;
  closed: number;
  statusChanges: number;
  added: number;
  reassigned: number;
}

export function sessionTotals(session: StandupSession): SessionTotals {
  const count = (...kinds: StandupLogKind[]) => session.log.filter((entry) => kinds.includes(entry.kind)).length;
  return {
    updates: count('update'),
    checkins: count('checkin'),
    closed: count('done'),
    statusChanges: count('status', 'blocked', 'current'),
    added: count('added'),
    reassigned: count('reassign'),
  };
}

export function describeLogEntry(entry: StandupLogEntry, usesCheckIn = true): string {
  const key = entry.taskKey ? ` ${entry.taskKey}` : '';
  switch (entry.kind) {
    case 'update': return `Logged update on${key}`;
    case 'checkin': return usesCheckIn ? 'Added a check-in' : 'Added a note';
    case 'status': return `Status → ${entry.detail ?? 'changed'}`;
    case 'blocked': return `Marked blocked${entry.taskKey ? ` (${entry.taskKey})` : ''}`;
    case 'current': return `Set${key} as current`;
    case 'done': return `Closed${key}`;
    case 'reassign': return `Reassigned${key}${entry.detail ? ` to ${entry.detail}` : ''}`;
    case 'added': return entry.taskKey ? `Added ${entry.taskKey}` : 'Captured a task';
    default: return entry.kind;
  }
}

// ── Follow-up reasons (§5) ───────────────────────────────────────────────

export type ReasonTone = 'danger' | 'warning' | 'accent' | 'muted';

export interface FollowUpReason {
  code: 'flagged' | 'status' | 'suggestion' | 'no_checkin' | 'one_on_one';
  label: string;
  tone: ReasonTone;
}

const PERSON_STATUS_LABELS: Record<TrackerDeveloperStatus, string> = {
  on_track: 'On track',
  at_risk: 'At risk',
  blocked: 'Blocked',
  waiting: 'Waiting',
  done_for_today: 'Done for today',
};

/**
 * `usesCheckIn` (docs/56 P1-04): "No check-in today" only makes sense for people
 * who check in; solo and non-participating developers never get it.
 */
export function followUpReasons(day: TrackerDeveloperDay, date: string, flagged: boolean, usesCheckIn = true): FollowUpReason[] {
  const reasons: FollowUpReason[] = [];
  if (flagged) reasons.push({ code: 'flagged', label: 'Flagged', tone: 'accent' });
  if (day.status === 'blocked' || day.status === 'at_risk' || day.status === 'waiting') {
    reasons.push({ code: 'status', label: PERSON_STATUS_LABELS[day.status], tone: day.status === 'blocked' ? 'danger' : 'warning' });
  }
  if (day.statusSuggestion) {
    reasons.push({ code: 'suggestion', label: `${day.statusSuggestion.reasonTaskKey} blocked`, tone: 'warning' });
  }
  if (usesCheckIn && day.status !== 'done_for_today' && checkInsToday(day, date) === 0) {
    reasons.push({ code: 'no_checkin', label: 'No check-in today', tone: 'muted' });
  }
  if (day.oneOnOne) {
    reasons.push({
      code: 'one_on_one',
      label: day.oneOnOne.overdueDays > 0 ? `1:1 overdue ${day.oneOnOne.overdueDays}d` : '1:1 today',
      tone: day.oneOnOne.overdueDays > 0 ? 'danger' : 'accent',
    });
  }
  return reasons;
}

/** Reasons that alone put someone on the wrap-up follow-up list (not just "no check-in"). */
export function needsFollowUp(reasons: FollowUpReason[]): boolean {
  return reasons.some((reason) => reason.code !== 'no_checkin');
}

// ── Feed (S5) ────────────────────────────────────────────────────────────

export type FeedTone = 'danger' | 'warning' | 'success' | 'accent' | 'info' | 'muted';

const TASK_STATUS_LABELS: Record<string, string> = {
  open: 'Open',
  active: 'Active',
  blocked: 'Blocked',
  done: 'Done',
  dropped: 'Dropped',
  deleted: 'Deleted',
};

const statusLabel = (value: string | null | undefined) => (value ? TASK_STATUS_LABELS[value] ?? value : 'New');

/** `single_current` demotions are a side-effect of another task becoming current. */
export function isFeedNoise(entry: StandupFeedEntry): boolean {
  return entry.kind === 'event' && entry.type === 'status' && entry.statusReason === 'single_current';
}

/** 3 = must see, 2 = notable, 1 = routine, 0 = background. */
export function feedEntryImportance(entry: StandupFeedEntry): number {
  if (entry.kind === 'checkin') return 2;
  switch (entry.type) {
    case 'blocker':
      return entry.blockerAction === 'cleared' ? 2 : 3;
    case 'status':
      if (entry.statusTo === 'blocked') return 3;
      if (entry.statusTo === 'done' || entry.statusTo === 'dropped') return 2;
      return 0;
    case 'update':
      return 1;
    case 'created':
    case 'assign':
      return 1;
    default:
      return 0;
  }
}

export interface FeedEntryView {
  label: string;
  text: string | null;
  tone: FeedTone;
}

export function describeFeedEntry(entry: StandupFeedEntry): FeedEntryView {
  if (entry.kind === 'checkin') return { label: 'Check-in', text: entry.summary ?? null, tone: 'info' };
  switch (entry.type) {
    case 'status': {
      const to = entry.statusTo;
      const tone: FeedTone = to === 'blocked' ? 'danger' : to === 'done' ? 'success' : to === 'active' ? 'accent' : 'muted';
      return { label: to ? `${statusLabel(entry.statusFrom)} → ${statusLabel(to)}` : 'Status changed', text: null, tone };
    }
    case 'blocker':
      return entry.blockerAction === 'cleared'
        ? { label: 'Blocker cleared', text: entry.body ?? null, tone: 'success' }
        : { label: 'Blocker raised', text: entry.body ?? null, tone: 'danger' };
    case 'update':
      return { label: 'Update', text: entry.body ?? null, tone: 'muted' };
    case 'created':
      return { label: 'Created', text: null, tone: 'muted' };
    case 'assign':
      return { label: 'Assigned', text: null, tone: 'muted' };
    default:
      return { label: entry.type ?? 'Event', text: entry.body ?? null, tone: 'muted' };
  }
}

export interface FeedGroup {
  id: string;
  kind: 'task' | 'checkins';
  taskKey?: string;
  title: string;
  entries: StandupFeedEntry[];
  latestAt: string;
  importance: number;
}

/**
 * Group by task (check-ins together), newest-first inside each group. Groups
 * holding a must-see entry (importance 3) float to the top; the rest follow
 * by most recent activity.
 */
export function groupStandupFeed(entries: StandupFeedEntry[]): FeedGroup[] {
  const groups = new Map<string, FeedGroup>();
  for (const entry of entries) {
    if (isFeedNoise(entry)) continue;
    const isCheckIn = entry.kind === 'checkin' || !entry.taskKey;
    const id = isCheckIn ? 'checkins' : `task:${entry.taskKey}`;
    let group = groups.get(id);
    if (!group) {
      group = {
        id,
        kind: isCheckIn ? 'checkins' : 'task',
        taskKey: isCheckIn ? undefined : entry.taskKey,
        title: isCheckIn ? 'Check-ins' : entry.taskTitle ?? entry.taskKey ?? '',
        entries: [],
        latestAt: entry.occurredAt,
        importance: 0,
      };
      groups.set(id, group);
    }
    group.entries.push(entry);
    if (entry.occurredAt > group.latestAt) group.latestAt = entry.occurredAt;
    group.importance = Math.max(group.importance, feedEntryImportance(entry));
  }
  const result = [...groups.values()];
  for (const group of result) group.entries.sort((left, right) => right.occurredAt.localeCompare(left.occurredAt));
  return result.sort((left, right) => {
    const urgent = Number(right.importance >= 3) - Number(left.importance >= 3);
    return urgent || right.latestAt.localeCompare(left.latestAt);
  });
}

export interface FeedCounts {
  updates: number;
  blockers: number;
  statusChanges: number;
  checkins: number;
}

export function feedCounts(entries: StandupFeedEntry[]): FeedCounts {
  const counts: FeedCounts = { updates: 0, blockers: 0, statusChanges: 0, checkins: 0 };
  for (const entry of entries) {
    if (isFeedNoise(entry)) continue;
    if (entry.kind === 'checkin') counts.checkins += 1;
    else if (entry.type === 'blocker' && entry.blockerAction !== 'cleared') counts.blockers += 1;
    else if (entry.type === 'status') counts.statusChanges += 1;
    else if (entry.type === 'update') counts.updates += 1;
  }
  return counts;
}

/** Task keys with meaningful (non-noise) activity in the feed window. */
export function feedActiveTaskKeys(entries: StandupFeedEntry[]): Set<string> {
  return new Set(entries.flatMap((entry) => (entry.taskKey && !isFeedNoise(entry) ? [entry.taskKey] : [])));
}

// ── Wrap-up summary (§5) ────────────────────────────────────────────────

export function buildStandupSummary({
  date,
  days,
  session,
  usesCheckIn = () => true,
}: {
  date: string;
  days: TrackerDeveloperDay[];
  session: StandupSession;
  usesCheckIn?: (day: TrackerDeveloperDay) => boolean;
}): string {
  const reviewed = new Set(session.reviewed);
  const flagged = new Set(session.flagged);
  const totals = sessionTotals(session);
  const lines: string[] = [
    `Standup ${date} — ${days.filter((day) => reviewed.has(day.developer.accountId)).length}/${days.length} reviewed`,
    `Logged: ${totals.updates} updates · ${totals.checkins} ${days.some(usesCheckIn) ? 'check-ins' : 'notes'} · ${totals.closed} closed · ${totals.statusChanges} status changes`,
  ];
  const followUps = days
    .map((day) => ({ day, reasons: followUpReasons(day, date, flagged.has(day.developer.accountId), usesCheckIn(day)) }))
    .filter(({ reasons }) => needsFollowUp(reasons));
  if (followUps.length) {
    lines.push('', 'Follow up:');
    for (const { day, reasons } of followUps) {
      lines.push(`- ${day.developer.displayName}: ${reasons.map((reason) => reason.label).join(', ')}`);
    }
  }
  const unreviewed = days.filter((day) => !reviewed.has(day.developer.accountId));
  if (unreviewed.length) {
    lines.push('', `Not reviewed: ${unreviewed.map((day) => day.developer.displayName).join(', ')}`);
  }
  const logged = days.filter((day) => session.log.some((entry) => entry.accountId === day.developer.accountId));
  if (logged.length) {
    lines.push('', 'Actions:');
    for (const day of logged) {
      const entries = session.log
        .filter((entry) => entry.accountId === day.developer.accountId)
        .map((entry) => describeLogEntry(entry, usesCheckIn(day)));
      lines.push(`- ${day.developer.displayName}: ${entries.join('; ')}`);
    }
  }
  return lines.join('\n');
}
