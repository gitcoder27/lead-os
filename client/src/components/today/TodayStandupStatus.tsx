import { CheckCircle2 } from 'lucide-react';
import { firstName, formatClock } from '@/lib/today-layout';
import type { TodayActionTarget, TodayStandupFocus } from '@/types';

interface TodayStandupStatusProps {
  standup?: TodayStandupFocus;
  onOpenTarget: (target: TodayActionTarget) => void;
}

/**
 * docs/53 F7: after a round is sealed, "Standup ✓ 9:40 · 2 flagged" with
 * each flagged person one tap away. Before that, the queue's "Start
 * standup" row is the entry point — this line renders nothing.
 */
export function TodayStandupStatus({ standup, onOpenTarget }: TodayStandupStatusProps) {
  if (!standup || standup.status !== 'completed') return null;
  const endedAt = formatClock(standup.endedAt);

  return (
    <section className="today-status-line" aria-label="Standup">
      <span className="today-status-check">
        <CheckCircle2 size={14} style={{ color: 'var(--success)' }} aria-hidden="true" />
        Standup{endedAt ? ` ${endedAt}` : ''}
      </span>
      <span>{standup.reviewedCount} reviewed</span>
      {standup.flaggedCount > 0 ? (
        <>
          <span>·</span>
          <span>{standup.flaggedCount} flagged</span>
          {standup.flagged.map((person) => (
            <button key={person.accountId} type="button" className="today-link" onClick={() => onOpenTarget(person.target)}>
              {firstName(person.displayName)}
            </button>
          ))}
        </>
      ) : null}
      <button
        type="button"
        className="today-link ml-auto"
        onClick={() => onOpenTarget({ type: 'view', view: 'team', mode: 'standup', date: standup.date })}
      >
        Run again
      </button>
    </section>
  );
}
