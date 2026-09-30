import type { ComponentType } from 'react';
import { findSection, type ReviewStepContext, type ReviewStepDef } from '@/lib/weekly-review';
import { format, parseISO } from 'date-fns';
import { TODAY_TOP_LIMIT } from '@/types';
import { ReviewLookBackStep } from './ReviewLookBackStep';
import { ReviewLooseEndsStep } from './ReviewLooseEndsStep';
import { ReviewNextWeekStep } from './ReviewNextWeekStep';
import { peopleNeedingYou, ReviewPeopleStep } from './ReviewPeopleStep';
import { ReviewWaitingStep } from './ReviewWaitingStep';

export type ReviewStepEntry = ReviewStepDef & { Component: ComponentType<{ ctx: ReviewStepContext }> };

/** Step 1 (docs/59 §5.3): what closed this week, and what is worth reporting. */
export const LOOK_BACK_STEP: ReviewStepEntry = {
  id: 'look_back',
  label: 'Look back',
  heading: 'What closed this week',
  summary: ({ review }) => {
    const closed = findSection(review, 'closed')?.rows ?? [];
    // With nothing closed the step shows its empty state; a lone "3 slipped" would only confuse.
    if (closed.length === 0) return '';
    const done = closed.filter((row) => row.status === 'done').length;
    const dropped = closed.length - done;
    const slipped = findSection(review, 'slipped')?.rows.length ?? 0;
    return [
      done > 0 ? `${done} done` : null,
      dropped > 0 ? `${dropped} dropped` : null,
      slipped > 0 ? `${slipped} slipped` : null,
    ].filter(Boolean).join(' · ');
  },
  count: ({ review }) => findSection(review, 'closed')?.rows.length ?? 0,
  keys: [
    ['j / k', 'Next / previous row'],
    ['x', 'Add to or leave out of the update'],
    ['o', 'Open the task'],
  ],
  Component: ReviewLookBackStep,
};

/** How many of a step's rows still need a decision this session. */
function leftToDecide(ctx: ReviewStepContext, ids: Array<'quiet' | 'slipped' | 'inbox' | 'undated'>): { total: number; left: number } {
  const rows = ids.flatMap((id) => findSection(ctx.review, id)?.rows ?? []);
  return { total: rows.length, left: rows.filter((row) => !ctx.decisions.has(row.taskKey)).length };
}

/** Step 2: what is waiting or delegated and has gone quiet. */
export const WAITING_STEP: ReviewStepEntry = {
  id: 'waiting',
  label: 'Waiting',
  heading: 'Waiting & delegated',
  summary: (ctx) => {
    const { total, left } = leftToDecide(ctx, ['quiet']);
    if (total === 0) return '';
    return left === total ? `${total} went quiet` : left === 0 ? 'All decided' : `${left} of ${total} left`;
  },
  done: (ctx) => {
    const { total, left } = leftToDecide(ctx, ['quiet']);
    return total > 0 && left === 0;
  },
  count: (ctx) => leftToDecide(ctx, ['quiet']).left,
  keys: [
    ['j / k', 'Next / previous row'],
    ['m', 'Check on the next workday'],
    ['c', 'Choose a check date'],
    ['e', 'Got it (done)'],
    ['#', 'Drop'],
    ['o', 'Open the task'],
    ['z', 'Undo the last decision'],
  ],
  Component: ReviewWaitingStep,
};

/** Step 3: my slipped plans, Inbox leftovers and old undated tasks. */
export const LOOSE_ENDS_STEP: ReviewStepEntry = {
  id: 'loose_ends',
  label: 'Loose ends',
  heading: 'Loose ends',
  summary: (ctx) => {
    const { total, left } = leftToDecide(ctx, ['slipped', 'inbox', 'undated']);
    if (total === 0) return '';
    return left === total ? `${total} to decide` : left === 0 ? 'All decided' : `${left} of ${total} left`;
  },
  done: (ctx) => {
    const { total, left } = leftToDecide(ctx, ['slipped', 'inbox', 'undated']);
    return total > 0 && left === 0;
  },
  count: (ctx) => leftToDecide(ctx, ['slipped', 'inbox', 'undated']).left,
  keys: [
    ['j / k', 'Next / previous row'],
    ['m', 'Plan it for the next workday'],
    ['s', 'Schedule, or park it for Later'],
    ['e', 'Done'],
    ['#', 'Drop'],
    ['o', 'Open the task'],
    ['z', 'Undo the last decision'],
  ],
  Component: ReviewLooseEndsStep,
};

/** Step 4: 1:1s to catch up on and people marked blocked or at risk. Hidden with an empty roster. */
export const PEOPLE_STEP: ReviewStepEntry = {
  id: 'people',
  label: 'People',
  heading: 'People',
  summary: (ctx) => {
    const needs = peopleNeedingYou(ctx);
    return needs > 0 ? `${needs} need${needs === 1 ? 's' : ''} you` : '';
  },
  count: (ctx) => peopleNeedingYou(ctx),
  visible: (review) => review.rosterSize > 0,
  keys: [
    ['j / k', 'Next / previous row'],
    ['o', 'Open the 1:1 or the person'],
  ],
  Component: ReviewPeopleStep,
};

/** Step 5: the next workday's top 3, and how next week looks. */
export const NEXT_WEEK_STEP: ReviewStepEntry = {
  id: 'next_week',
  label: 'Next week',
  heading: (review) => `${format(parseISO(review.nextWorkday), 'EEEE')}'s top ${TODAY_TOP_LIMIT}`,
  summary: (ctx) => `${ctx.pins.length} of ${TODAY_TOP_LIMIT}`,
  done: (ctx) => ctx.pins.length >= TODAY_TOP_LIMIT,
  count: (ctx) => ctx.pins.length,
  keys: [
    ['j / k', 'Next / previous row'],
    ['p', 'Pick, or remove from the top 3'],
    ['o', 'Open the task'],
  ],
  Component: ReviewNextWeekStep,
};

/**
 * The steps the review currently has, in order. Later steps (Waiting, Loose ends, People, Next
 * week, Send update) each add their entry here, so every commit ships a working review.
 */
export const REVIEW_STEPS: ReviewStepEntry[] = [LOOK_BACK_STEP, WAITING_STEP, LOOSE_ENDS_STEP, PEOPLE_STEP, NEXT_WEEK_STEP];
