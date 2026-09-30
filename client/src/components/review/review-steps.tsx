import type { ComponentType } from 'react';
import { findSection, type ReviewStepContext, type ReviewStepDef } from '@/lib/weekly-review';
import { ReviewLookBackStep } from './ReviewLookBackStep';

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

/**
 * The steps the review currently has, in order. Later steps (Waiting, Loose ends, People, Next
 * week, Send update) each add their entry here, so every commit ships a working review.
 */
export const REVIEW_STEPS: ReviewStepEntry[] = [LOOK_BACK_STEP];
