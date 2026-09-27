import { deltaChips, formatSince } from '@/lib/today-layout';
import type { TodayActionTarget, TodayDelta } from '@/types';

interface TodaySinceStripProps {
  delta?: TodayDelta;
  date: string;
  onOpenTarget: (target: TodayActionTarget) => void;
}

/**
 * docs/53 §5 "What changed since I left?": one compact line above the queue.
 * Absent on the first visit (no baseline); a quiet line when nothing moved.
 */
export function TodaySinceStrip({ delta, date, onOpenTarget }: TodaySinceStripProps) {
  if (!delta?.since) return null;
  const since = formatSince(delta.since);
  const chips = deltaChips(delta, date);

  return (
    <section className="today-strip" aria-label="Since your last visit">
      <span className="today-strip-label">{chips.length ? `Since ${since}` : `Nothing new since ${since}`}</span>
      {chips.map((chip) => (
        <button
          key={chip.id}
          type="button"
          className={`today-chip-btn today-tone-${chip.tone}`}
          disabled={!chip.target}
          title={chip.detail || undefined}
          onClick={() => chip.target && onOpenTarget(chip.target)}
        >
          <span className="today-chip-dot" aria-hidden="true" />
          {chip.label}
        </button>
      ))}
    </section>
  );
}
