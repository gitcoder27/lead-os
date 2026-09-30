import type { DecisionChip } from '@/lib/weekly-review-decisions';

/** Chips carry words, never colour alone: "Check was Wed" is red and says so. */
export function ReviewChips({ chips }: { chips: DecisionChip[] }) {
  return (
    <>
      {chips.map((chip) => (
        <span
          key={chip.label}
          className={`ui-chip ${chip.tone === 'danger' ? 'tone-danger' : chip.tone === 'warning' ? 'tone-warning' : ''}`}
          data-quiet={chip.tone === 'danger' || chip.tone === 'warning' ? undefined : 'true'}
        >
          {chip.label}
        </span>
      ))}
    </>
  );
}
