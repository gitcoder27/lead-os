import { CircleCheck, PlayCircle } from 'lucide-react';
import { firstName, formatClock } from '@/lib/today-layout';
import type { TodayActionItem, TodayActionTarget, TodayStandupFocus } from '@/types';

interface TodayStandupCardProps {
  standup?: TodayStandupFocus;
  /** The server's "Start standup" row (its context carries e.g. "5 stale"). */
  row?: TodayActionItem;
  /** After the window, only a finished round is worth showing. */
  completedOnly?: boolean;
  onOpenTarget: (target: TodayActionTarget) => void;
}

/**
 * docs/53 F7: the stage panel's standup card. Not started → what's waiting
 * and one "Start standup" button (`/team?mode=standup`). Done → "Standup ✓
 * 09:40 · 2 flagged" with each flagged person one tap away.
 */
export function TodayStandupCard({ standup, row, completedOnly = false, onOpenTarget }: TodayStandupCardProps) {
  if (!standup) return null;

  if (standup.status !== 'completed') {
    if (completedOnly) return null;
    return (
      <section className="today-panel" aria-label="Standup">
        <div className="today-standup">
          <PlayCircle size={18} className="today-standup-icon" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <h2 className="today-section-title">Standup</h2>
            <p className="today-standup-meta">Not started{row?.context ? ` · ${row.context}` : ''}</p>
          </div>
          <button type="button" className="ui-btn" onClick={() => onOpenTarget(standup.target)}>
            Start standup
          </button>
        </div>
      </section>
    );
  }

  const endedAt = formatClock(standup.endedAt);
  return (
    <section className="today-panel" aria-label="Standup">
      <div className="today-standup">
        <CircleCheck size={18} className="today-standup-icon" style={{ color: 'var(--success)' }} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <h2 className="today-section-title">Standup{endedAt ? ` ✓ ${endedAt}` : ' ✓'}</h2>
          <p className="today-standup-meta">
            {standup.reviewedCount} reviewed
            {standup.flaggedCount > 0 ? ` · ${standup.flaggedCount} flagged` : ''}
          </p>
          {standup.flagged.length > 0 ? (
            <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
              {standup.flagged.map((person) => (
                <button key={person.accountId} type="button" className="ui-link" onClick={() => onOpenTarget(person.target)}>
                  {firstName(person.displayName)}
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <button
          type="button"
          className="ui-btn-ghost"
          onClick={() => onOpenTarget({ type: 'view', view: 'team', mode: 'standup', date: standup.date })}
        >
          Run again
        </button>
      </div>
    </section>
  );
}
