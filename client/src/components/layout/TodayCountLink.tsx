import { useManagerActions } from '@/hooks/useManagerActions';

/**
 * docs/56 UX-30: off Today the nav's Today tab carries the size of Today's queue as a quiet count,
 * instead of a second "Today N" control next to the actions.
 */
export function TodayCountBadge() {
  const actions = useManagerActions({ surface: 'header', limit: 1 });
  const count = actions.data?.totalCount;
  if (!count) return null;
  return (
    <>
      <span
        aria-hidden="true"
        className="relative min-w-[18px] rounded-full px-1.5 text-center text-[10.5px] font-semibold leading-[18px] tabular-nums"
        style={{ background: 'var(--accent-glow)', color: 'var(--accent-text)' }}
      >
        {count}
      </span>
      <span className="sr-only">{`, ${count} to look at`}</span>
    </>
  );
}
