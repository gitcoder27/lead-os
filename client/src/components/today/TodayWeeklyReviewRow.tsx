import { format } from 'date-fns';
import { CalendarCheck, CircleCheck } from 'lucide-react';
import { useDismissReviewWeek } from '@/hooks/useWeeklyReview';
import { openWeeklyReview } from '@/lib/weekly-review';
import type { TodayWeeklyReview } from '@/types';

/**
 * docs/59 §5.1 (WR-06): the weekly review as one row at the top of the stage panel. On the review
 * day it invites the review (and reads "done · 15:42" afterwards); on Monday and Tuesday it offers
 * the catch-up for last week, with **Not this week** to put it down for good.
 */
export function TodayWeeklyReviewRow({ review }: { review: TodayWeeklyReview }) {
  const dismiss = useDismissReviewWeek();
  const done = !review.due && review.completedAt;
  if (!review.due && !done) return null;
  const finishedAt = review.completedAt ? format(new Date(review.completedAt), 'HH:mm') : null;

  return (
    <section className="today-panel" aria-label="Weekly review" data-testid="today-weekly-review">
      {done ? (
        <div className="today-row today-tone-success">
          <span className="today-row-icon" aria-hidden="true"><CircleCheck size={14} /></span>
          <span className="today-row-link">
            <span className="today-row-title-line">
              <span className="today-row-title">Weekly review done{finishedAt ? ` · ${finishedAt}` : ''}</span>
            </span>
          </span>
          <span className="today-row-actions">
            <button type="button" className="ui-btn-ghost" onClick={() => openWeeklyReview(review.weekStart)}>Open</button>
          </span>
        </div>
      ) : (
        <div className="today-row today-tone-info">
          <span className="today-row-icon" aria-hidden="true"><CalendarCheck size={14} /></span>
          <span className="today-row-link">
            <span className="today-row-title-line">
              <span className="today-row-title">{review.catchUp ? 'Review last week' : 'Weekly review'}</span>
            </span>
            <span className="today-row-meta today-row-meta-muted">~10 min</span>
          </span>
          <span className="today-row-actions">
            <button type="button" className="ui-btn" onClick={() => openWeeklyReview(review.weekStart)}>
              {review.catchUp ? 'Start' : 'Start review'}
            </button>
            {review.catchUp ? (
              <button type="button" className="ui-btn-ghost" disabled={dismiss.isPending} onClick={() => dismiss.mutate(review.weekStart)}>
                Not this week
              </button>
            ) : null}
          </span>
        </div>
      )}
    </section>
  );
}
