import { format, parseISO } from 'date-fns';
import { shiftLocalIsoDate } from '@/lib/utils';
import { taskPlanDate, localDateOf } from '@/lib/task-list';
import { findSection, type ReviewDecision } from '@/lib/weekly-review';
import type { WeeklyReviewResponse, WeeklyReviewTaskRow } from '@/types';

/**
 * docs/59 §5.3 step 5: next week as it will be once the decisions from steps 2 and 3 are applied.
 * The server's snapshot lists what is planned next week; a decision made in this session moves
 * tasks in (Monday, a date), or out (done, dropped, Later), so the counts follow the manager's hand.
 */
export interface PlannedRow {
  row: WeeklyReviewTaskRow;
  /** Local plan date next week. */
  planDate: string;
  /** Moved to the next workday in this review (steps 2 and 3). */
  movedToMonday: boolean;
}

export interface NextWeekPlan {
  /** Candidates for the top 3, in order: moved to Monday, high priority, the rest by date. */
  candidates: PlannedRow[];
  /** Planned tasks per weekday of next week (Mon–Fri, then any weekend day that has some). */
  days: { date: string; label: string; count: number }[];
  total: number;
  /** Rows the manager parked until next week (they come back, they are not planned). */
  backFromLater: WeeklyReviewTaskRow[];
}

function planDateAfter(row: WeeklyReviewTaskRow, decision: ReviewDecision | undefined): string | null {
  if (!decision) return taskPlanDate(row).date;
  const changes = decision.choice.changes;
  if (changes.status === 'done' || changes.status === 'dropped') return null;
  if (changes.later === true) return null;
  if (changes.scheduledOn) return changes.scheduledOn;
  if (changes.scheduledOn === null) return null;
  return taskPlanDate(row).date;
}

export function buildNextWeekPlan(review: WeeklyReviewResponse, decisions: ReadonlyMap<string, ReviewDecision>): NextWeekPlan {
  const { nextEnd } = review.range;
  // From the next workday (a Friday review: exactly next week) to the end of next week.
  const first = review.nextWorkday;
  const inWeek = (date: string | null): date is string => date !== null && date >= first && date <= nextEnd;
  const rows = new Map<string, WeeklyReviewTaskRow>();
  for (const row of findSection(review, 'plannedNextWeek')?.rows ?? []) rows.set(row.taskKey, row);
  // A task moved into next week in this session is not in the snapshot: take it from the decision.
  for (const decision of decisions.values()) if (!rows.has(decision.taskKey)) rows.set(decision.taskKey, decision.row);

  const planned: PlannedRow[] = [];
  for (const row of rows.values()) {
    const decision = decisions.get(row.taskKey);
    const planDate = planDateAfter(row, decision);
    if (!inWeek(planDate)) continue;
    planned.push({ row, planDate, movedToMonday: Boolean(decision?.choice.changes.scheduledOn === review.nextWorkday && decision.choice.changes.later !== true) });
  }
  planned.sort((a, b) => a.planDate.localeCompare(b.planDate) || a.row.id - b.row.id);

  const rank = (item: PlannedRow) => (item.movedToMonday ? 0 : item.row.priority === 'high' ? 1 : 2);
  const candidates = [...planned].sort((a, b) => rank(a) - rank(b) || a.planDate.localeCompare(b.planDate) || a.row.id - b.row.id);

  const counts = new Map<string, number>();
  for (const item of planned) counts.set(item.planDate, (counts.get(item.planDate) ?? 0) + 1);
  const days: NextWeekPlan['days'] = [];
  for (let date = first; date <= nextEnd; date = shiftLocalIsoDate(date, 1)) {
    const count = counts.get(date) ?? 0;
    const weekend = [0, 6].includes(parseISO(date).getDay());
    if (!weekend || count > 0) days.push({ date, label: format(parseISO(date), 'EEE'), count });
  }

  // Later tasks the manager just parked with a date next week come back too.
  const backFromLater = [...(findSection(review, 'laterNextWeek')?.rows ?? [])];
  return { candidates, days, total: planned.length, backFromLater };
}

/** "Wed 7 Oct" for a back-from-Later row. */
export function comesBackLabel(row: WeeklyReviewTaskRow): string {
  const date = localDateOf(row.hideUntil ?? null);
  return date ? `Back ${format(parseISO(date), 'EEE d MMM')}` : 'Back next week';
}
