import type { TrackerAttentionItem, TrackerAttentionReasonCode, TrackerDeveloperDay } from '@/types';
import { describeMoment } from '@/components/tasks/task-detail-format';
import { getSignalBadges } from './TrackerSignalBadges';
import { formatCompactRelative } from './trackerItemFormat';

/**
 * Roster signal model. Each fact is said once, in the cell that owns it:
 * status in the person cell, freshness in check-in, "no current" in current
 * work. The attention cell only carries what no other cell already shows,
 * and the row rail is reserved for rows that genuinely need the manager.
 */

export type RosterTone = 'danger' | 'warning' | 'info' | 'accent';

export interface RosterFlag {
  key: string;
  label: string;
  tone: RosterTone;
}

export interface RosterAttention {
  /** Rail tone: only danger/warning rows earn a rail. */
  rail: 'danger' | 'warning' | null;
  /** Flags for the attention cell, most severe first. */
  flags: RosterFlag[];
  /** Every reason, including ones shown by other cells — for the tooltip. */
  summary: string;
}

/** Reasons another roster cell already states. */
const COVERED_ELSEWHERE: ReadonlySet<TrackerAttentionReasonCode> = new Set([
  'blocked', // status mark
  'at_risk', // status mark
  'waiting', // status mark
  'stale_by_time', // check-in cell
  'no_current', // current work cell
]);

const REASON_TONE: Record<TrackerAttentionReasonCode, RosterTone> = {
  blocked: 'danger',
  overdue_linked_work: 'danger',
  stale_with_open_risk: 'warning',
  at_risk: 'warning',
  status_change_without_follow_up: 'warning',
  stale_without_current_work: 'warning',
  stale_by_time: 'warning',
  no_current: 'info',
  waiting: 'info',
};

/** Reasons that put a rail on the row. Plain staleness and "no current" stay quiet. */
const RAIL_REASONS: ReadonlySet<TrackerAttentionReasonCode> = new Set([
  'blocked',
  'overdue_linked_work',
  'stale_with_open_risk',
  'at_risk',
  'status_change_without_follow_up',
  'stale_without_current_work',
]);

const TONE_RANK: RosterTone[] = ['danger', 'warning', 'info', 'accent'];

function overdueLabel(day: TrackerDeveloperDay) {
  const count = day.signals.risk.overdueLinkedCount;
  return count > 1 ? `${count} overdue Jira` : 'Overdue Jira';
}

/** Server reasons when the board ranked this developer; client signals otherwise. */
function reasonFlags(day: TrackerDeveloperDay, item?: TrackerAttentionItem): { codes: TrackerAttentionReasonCode[]; flags: RosterFlag[]; labels: string[] } {
  if (item) {
    const flags = item.reasons
      .filter((reason) => !COVERED_ELSEWHERE.has(reason.code))
      .map((reason) => ({
        key: reason.code,
        label: reason.code === 'overdue_linked_work' ? overdueLabel(day) : reason.label,
        tone: REASON_TONE[reason.code],
      }));
    return { codes: item.reasons.map((reason) => reason.code), flags, labels: item.reasons.map((reason) => reason.label) };
  }

  const codes: TrackerAttentionReasonCode[] = [];
  if (day.status === 'blocked') codes.push('blocked');
  if (day.status === 'at_risk') codes.push('at_risk');
  const flags: RosterFlag[] = getSignalBadges(day)
    .filter((badge) => badge.key !== 'stale' && badge.key !== 'no-current')
    .map((badge) => {
      if (badge.key === 'overdue-linked') {
        codes.push('overdue_linked_work');
        return { key: badge.key, label: overdueLabel(day), tone: 'danger' };
      }
      if (badge.key === 'stale-risk') codes.push('stale_with_open_risk');
      if (badge.key === 'stale-no-current') codes.push('stale_without_current_work');
      if (badge.key === 'needs-follow-up') codes.push('status_change_without_follow_up');
      return { key: badge.key, label: badge.label, tone: badge.tone === 'info' ? 'warning' : badge.tone };
    });
  return { codes, flags, labels: flags.map((flag) => flag.label) };
}

export function getRosterAttention(day: TrackerDeveloperDay, item?: TrackerAttentionItem, now = new Date()): RosterAttention {
  const { codes, flags, labels } = reasonFlags(day, item);

  // A follow-up the manager promised, now due: the most direct "needs me".
  const followUp = day.nextFollowUpAt ? describeMoment(day.nextFollowUpAt, 'open', now) : null;
  if (followUp?.hint === 'due') {
    flags.push({ key: 'follow-up-due', label: 'Follow-up due', tone: 'warning' });
    labels.push(`Follow-up due (${followUp.label})`);
  }

  if (day.oneOnOne) {
    const overdue = day.oneOnOne.overdueDays > 0;
    const label = overdue ? `1:1 overdue ${day.oneOnOne.overdueDays}d` : '1:1 today';
    flags.push({ key: 'one-on-one', label, tone: overdue ? 'warning' : 'accent' });
    labels.push(label);
  }

  flags.sort((left, right) => TONE_RANK.indexOf(left.tone) - TONE_RANK.indexOf(right.tone));

  const railCodes = codes.filter((code) => RAIL_REASONS.has(code));
  const rail = railCodes.some((code) => REASON_TONE[code] === 'danger')
    ? 'danger'
    : railCodes.length > 0 || flags.some((flag) => flag.key === 'follow-up-due')
      ? 'warning'
      : null;

  return { rail, flags, summary: labels.join(' · ') };
}

export interface RosterCheckIn {
  label: string;
  stale: boolean;
  title?: string;
}

export function getRosterCheckIn(day: TrackerDeveloperDay, now = Date.now()): RosterCheckIn {
  const { staleByTime, staleThresholdHours } = day.signals.freshness;
  if (!day.lastCheckInAt) {
    return { label: 'No check-in', stale: true, title: 'No check-in recorded yet' };
  }
  const relative = formatCompactRelative(day.lastCheckInAt, now);
  return {
    label: relative,
    stale: staleByTime,
    title: staleByTime ? `Stale — no check-in within ${staleThresholdHours}h` : undefined,
  };
}

/** Current work plus planned tasks — the drawer's "Load". */
export function getRosterLoad(day: TrackerDeveloperDay): number {
  return (day.currentItem ? 1 : 0) + day.plannedItems.length;
}

export const ROSTER_TONE_COLOR: Record<RosterTone, string> = {
  danger: 'var(--danger)',
  warning: 'var(--warning)',
  info: 'var(--info)',
  accent: 'var(--accent)',
};
