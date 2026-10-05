import { useManagerActions } from '@/hooks/useManagerActions';

/**
 * docs/56 UX-30: off Today the nav's Today tab carries the size of Today's queue as a quiet count,
 * instead of a second "Today N" control next to the actions.
 */
export function TodayCountBadge({ hidden = false }: { hidden?: boolean }) {
  const actions = useManagerActions({ surface: 'header', limit: 1 });
  const count = actions.data?.totalCount;
  if (!count) return null;
  return (
    <>
      <span
        aria-hidden="true"
        className="relative min-w-[18px] shrink-0 rounded-full px-1.5 text-center text-[10.5px] font-semibold leading-[18px] tabular-nums transition-[opacity,transform] duration-150 ease-out motion-reduce:transition-none"
        // Preserve the badge's width on Today so neighboring links never move on navigation.
        style={{ background: 'var(--accent-glow)', color: 'var(--accent-text)', opacity: hidden ? 0 : 1, transform: hidden ? 'scale(0.85)' : 'scale(1)' }}
      >
        {count}
      </span>
      {!hidden && <span className="sr-only">{`, ${count} to look at`}</span>}
    </>
  );
}
