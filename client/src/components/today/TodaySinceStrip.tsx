import { deltaChips, formatSince } from '@/lib/today-layout';
import type { TodayActionTarget, TodayDelta } from '@/types';

interface TodaySinceStripProps {
  delta?: TodayDelta;
  date: string;
  onOpenTarget: (target: TodayActionTarget) => void;
}

/**
 * docs/53 §5 "What changed since I left?" as a stage-panel section. When
 * nothing moved it renders nothing — the header band carries that note.
 */
export function TodaySinceStrip({ delta, date, onOpenTarget }: TodaySinceStripProps) {
  const chips = deltaChips(delta, date);
  if (!delta?.since || chips.length === 0) return null;

  return (
    <section className="today-panel" aria-label="Since your last visit">
      <div className="today-panel-head">
        <h2 className="today-section-title">Since {formatSince(delta.since)}</h2>
      </div>
      <div className="today-strip">
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
      </div>
    </section>
  );
}
