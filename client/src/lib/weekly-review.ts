import { format, parseISO } from 'date-fns';
import type { DecisionChoice } from '@/lib/weekly-review-decisions';
import type {
  TodayActionTarget,
  WeeklyReviewOneOnOneRow,
  WeeklyReviewPin,
  WeeklyReviewResponse,
  WeeklyReviewSavedState,
  WeeklyReviewSection,
  WeeklyReviewStepId,
  WeeklyReviewTaskRow,
} from '@/types';

/**
 * docs/59 §5, §9 (WR-03): helpers shared by the review steps and, later, the report builder.
 *
 * `excluded` on the saved record lists report lines the manager unticked. A line's default is
 * decided by what it is (a done task is in, a dropped task or a meeting is out), so a manager who
 * ticks a default-out line back in is recorded as `+<id>`. That keeps the stored list to what the
 * manager actually did, and a task that closes after the first save still gets its own default.
 */
export const INCLUDE_PREFIX = '+';

export function isLineIncluded(excluded: readonly string[], lineId: string, defaultIncluded: boolean): boolean {
  if (excluded.includes(lineId)) return false;
  if (excluded.includes(`${INCLUDE_PREFIX}${lineId}`)) return true;
  return defaultIncluded;
}

/** The new `excluded` list once the manager sets a line to `included`. */
export function withLineIncluded(excluded: readonly string[], lineId: string, defaultIncluded: boolean, included: boolean): string[] {
  const rest = excluded.filter((entry) => entry !== lineId && entry !== `${INCLUDE_PREFIX}${lineId}`);
  if (included === defaultIncluded) return rest;
  return [...rest, included ? `${INCLUDE_PREFIX}${lineId}` : lineId];
}

/** Done work goes in the update; dropped work and meetings (attendance, not an outcome) start out of it. */
export function defaultInUpdate(row: Pick<WeeklyReviewTaskRow, 'status' | 'kind'>): boolean {
  return row.status === 'done' && row.kind !== 'meeting';
}

export function findSection<Id extends WeeklyReviewSection['id']>(
  review: WeeklyReviewResponse,
  id: Id,
): Extract<WeeklyReviewSection, { id: Id }> | undefined {
  return review.sections.find((section): section is Extract<WeeklyReviewSection, { id: Id }> => section.id === id);
}

/** "28 Sep – 2 Oct" (Monday to Friday: the working week the manager reports on). */
export function formatWeekRange(start: string): string {
  const first = parseISO(start);
  const last = parseISO(start);
  last.setDate(last.getDate() + 4);
  const sameMonth = first.getMonth() === last.getMonth();
  return `${format(first, sameMonth ? 'd' : 'd MMM')} – ${format(last, 'd MMM')}`;
}

/** The Monday of the week that holds `isoDay` (a local calendar date). */
export function mondayOfLocal(isoDay: string): string {
  const date = parseISO(isoDay);
  const dow = date.getDay();
  date.setDate(date.getDate() + (dow === 0 ? -6 : 1 - dow));
  return format(date, 'yyyy-MM-dd');
}

/**
 * Open the weekly review from anywhere in the app (the Today row, the palette, the Tasks rail): the
 * URL carries the mode, and the app's `popstate` handling turns it into the review.
 */
export function openWeeklyReview(week?: string): void {
  const target = week ? `/?mode=review&week=${encodeURIComponent(week)}` : '/?mode=review';
  window.history.pushState(null, '', target);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

/** The saved record a fresh review starts from. */
export function blankSavedState(weekStart: string): WeeklyReviewSavedState {
  const now = new Date().toISOString();
  return { weekStart, step: 'look_back', decisions: {}, excluded: [], reportMarkdown: null, startedAt: now, completedAt: null, dismissedAt: null, updatedAt: now };
}

/** A decision made in this session: what was written and how to take it back. */
export interface ReviewDecision {
  taskKey: string;
  row: WeeklyReviewTaskRow;
  choice: DecisionChoice;
}

export interface ReviewStepContext {
  review: WeeklyReviewResponse;
  saved: WeeklyReviewSavedState;
  /** The manager's local day. */
  today: string;
  isIncluded: (lineId: string, defaultIncluded: boolean) => boolean;
  setIncluded: (lineId: string, defaultIncluded: boolean, included: boolean) => void;
  openTask: (taskKey: string) => void;
  /** A person's display name from their account id ("Someone" until the roster loads). */
  personName: (accountId: string | null) => string;
  /** Decisions made this session by task key (kept across steps: the snapshot still lists those rows). */
  decisions: ReadonlyMap<string, ReviewDecision>;
  /** Write a decision now: the row collapses at once and goes back to undecided if the write fails. */
  decide: (row: WeeklyReviewTaskRow, choice: DecisionChoice) => void;
  /** Take one back (the inverse write), leaving the row undecided again. */
  undoDecision: (taskKey: string) => void;
  /** The next workday's top 3 (held for the session; changes are written at once). */
  pins: WeeklyReviewPin[];
  /** Pin a task; false (and a spoken reason) when the top 3 is full. */
  pin: (taskKey: string, title: string) => boolean;
  unpin: (taskKey: string) => void;
  /** 1:1 sessions skipped in this review (the snapshot still lists them as scheduled). */
  skippedSessions: ReadonlySet<number>;
  skipSession: (session: WeeklyReviewOneOnOneRow) => void;
  /** Open a person, a 1:1 or another surface (leaving the review; Back returns to it). */
  openTarget: (target: TodayActionTarget) => void;
  /** Open the global capture dialog. */
  capture: () => void;
  /** The signed-in manager's account id (their own tasks group under "Me"). */
  selfAccountId?: string;
  /** Fetch the week again (the inline "Couldn't load · Retry" note). */
  retry: () => void;
  /** One polite live-region sentence ("Left out of the update."). */
  announce: (message: string) => void;
}

export interface ReviewStepDef {
  id: WeeklyReviewStepId;
  /** Rail label. */
  label: string;
  /** Step heading (h2). */
  heading: string | ((review: WeeklyReviewResponse) => string);
  /** Muted line beside the heading: "12 done · 2 dropped · 3 slipped". */
  summary: (ctx: ReviewStepContext) => string;
  /** Rail badge; null shows none. */
  count: (ctx: ReviewStepContext) => number | null;
  /** True once nothing is left to decide in the step (its summary turns to success). */
  done?: (ctx: ReviewStepContext) => boolean;
  /** Steps that do not apply (People with an empty roster) drop out of the rail and the count. */
  visible?: (review: WeeklyReviewResponse) => boolean;
  /** Step-specific keys for the shortcut sheet, written as pressed. */
  keys: Array<[string, string]>;
}
