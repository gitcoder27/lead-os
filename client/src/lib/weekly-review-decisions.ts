import { format, parseISO } from 'date-fns';
import { checkByTimestamp } from '@/components/tasks/TaskMenus';
import { scheduleChanges, shortDay, type SchedulePreset } from '@/lib/task-list';
import { shiftLocalIsoDate } from '@/lib/utils';
import type { UpdateTaskRequest, WeeklyReviewTaskRow } from '@/types';

/**
 * docs/60 WR-04: the exact writes behind each decision in Waiting and Loose ends. A choice is the
 * patch plus how it reads afterwards (the collapsed row's one line) and what the live region says.
 */
export interface DecisionChoice {
  /** Short code saved on the week's record (`decisions[taskKey]`). */
  action: string;
  /** How the decided row reads: "→ Check Mon", "Done". */
  label: string;
  /** `success` for finished work, `neutral` for everything that only moves or stops a task. */
  tone: 'success' | 'neutral';
  /** Sentence for the live region, without the Undo hint. */
  announce: string;
  changes: UpdateTaskRequest;
}

function dayName(date: string): string {
  return format(parseISO(date), 'EEE');
}

/** Waiting: chase it on the next workday (usually Monday). */
export function checkNextWorkday(nextWorkday: string): DecisionChoice {
  const day = dayName(nextWorkday);
  return { action: 'check_monday', label: `→ Check ${day}`, tone: 'neutral', announce: `Check ${day}.`, changes: { followUpAt: checkByTimestamp(nextWorkday) } };
}

/** Waiting: it is still out, look again in a week. */
export function stillWaiting(today: string): DecisionChoice {
  const date = shiftLocalIsoDate(today, 7);
  const label = shortDay(date, today);
  return { action: 'still_waiting', label: `→ Check ${label}`, tone: 'neutral', announce: `Still waiting. Check ${label}.`, changes: { followUpAt: checkByTimestamp(date) } };
}

export function checkByDate(today: string, date: string | null): DecisionChoice {
  if (!date) return { action: 'check_by', label: 'No check date', tone: 'neutral', announce: 'Check date cleared.', changes: { followUpAt: null } };
  const label = shortDay(date, today);
  return { action: 'check_by', label: `→ Check ${label}`, tone: 'neutral', announce: `Check ${label}.`, changes: { followUpAt: checkByTimestamp(date) } };
}

export function stopWaiting(): DecisionChoice {
  return { action: 'stop_waiting', label: 'No longer waiting', tone: 'neutral', announce: 'Stopped waiting.', changes: { waitingOn: null } };
}

export function markDone(label = 'Done'): DecisionChoice {
  return { action: 'done', label, tone: 'success', announce: `${label}.`, changes: { status: 'done' } };
}

export function dropTask(): DecisionChoice {
  return { action: 'drop', label: 'Dropped', tone: 'neutral', announce: 'Dropped.', changes: { status: 'dropped' } };
}

/** Loose ends: plan it for the next workday. */
export function moveToNextWorkday(nextWorkday: string): DecisionChoice {
  const day = dayName(nextWorkday);
  return { action: 'monday', label: `→ ${day}`, tone: 'neutral', announce: `Moved to ${day}.`, changes: { scheduledOn: nextWorkday, later: false } };
}

const PRESET_LABELS: Record<SchedulePreset, string> = {
  today: 'Today',
  tomorrow: 'Tomorrow',
  'next-week': 'Next Mon',
  later: 'Later',
  clear: 'No date',
};

/** The schedule menu's presets (Later included), as decisions. */
export function schedulePreset(preset: SchedulePreset, today: string): DecisionChoice {
  const label = PRESET_LABELS[preset];
  return { action: preset === 'later' ? 'later' : 'scheduled', label: `→ ${label}`, tone: 'neutral', announce: `Moved to ${label}.`, changes: scheduleChanges(preset, today) };
}

export function scheduleDate(today: string, date: string): DecisionChoice {
  const label = shortDay(date, today);
  return { action: 'scheduled', label: `→ ${label}`, tone: 'neutral', announce: `Moved to ${label}.`, changes: { scheduledOn: date, later: false } };
}

/** Loose ends: leave it without a date, on purpose (takes an Inbox task out of the Inbox). */
export function keepUndated(): DecisionChoice {
  return { action: 'keep', label: 'Kept undated', tone: 'neutral', announce: 'Kept undated.', changes: { triaged: true } };
}

export interface DecisionChip {
  label: string;
  tone?: 'danger' | 'warning' | 'muted';
}

/** Chips on a Waiting row: how long, and why it is here ("Check was Wed" in danger; text, not colour alone). */
export function quietChips(row: WeeklyReviewTaskRow, today: string): DecisionChip[] {
  const chips: DecisionChip[] = [];
  const days = row.signals.waitingDays;
  if (days !== null && days !== undefined && days >= 1) chips.push({ label: `Waiting ${days}d`, tone: 'muted' });
  const quiet = row.quiet;
  if (quiet?.checkByPassed) {
    chips.push(quiet.checkByPassed === today
      ? { label: 'Check today', tone: 'warning' }
      : { label: `Check was ${dayName(quiet.checkByPassed)}`, tone: 'danger' });
  } else if (quiet) {
    chips.push({ label: `Quiet ${quiet.idleWorkingDays} working days`, tone: 'warning' });
  }
  return chips;
}

/** The meta line of a Loose ends row. */
export function looseEndMeta(row: WeeklyReviewTaskRow, today: string, group: 'slipped' | 'inbox' | 'undated'): string {
  const created = format(parseISO(row.createdAt), 'yyyy-MM-dd');
  const age = Math.max(0, Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${created}T00:00:00Z`)) / 86_400_000));
  if (group === 'slipped') {
    const days = row.signals.overdueDays ?? 0;
    const planned = row.scheduledOn ?? row.dueAt?.slice(0, 10);
    return `${days}d overdue${planned ? ` · planned ${dayName(planned)}` : ''}`;
  }
  if (group === 'inbox') return age === 0 ? 'Captured today' : `In Inbox ${age}d`;
  return `No date · ${age}d old`;
}
