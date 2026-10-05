import { useManagerActions } from '@/hooks/useManagerActions';
import { motion, useReducedMotion } from 'framer-motion';

/**
 * docs/56 UX-30: off Today the nav's Today tab carries the size of Today's queue as a quiet count,
 * instead of a second "Today N" control next to the actions.
 */
export function TodayCountBadge({ hidden = false }: { hidden?: boolean }) {
  const actions = useManagerActions({ surface: 'header', limit: 1 });
  const count = actions.data?.totalCount;
  const reduceMotion = useReducedMotion();
  if (!count) return null;
  return (
    <>
      <motion.span
        aria-hidden="true"
        className="relative inline-flex shrink-0 overflow-hidden"
        initial={false}
        animate={{ width: hidden ? 0 : 'auto', marginLeft: hidden ? 0 : 6, opacity: hidden ? 0 : 1 }}
        transition={{ duration: reduceMotion ? 0 : 0.18, ease: 'easeInOut' }}
      >
        <span className="min-w-[18px] shrink-0 rounded-full px-1.5 text-center text-[10.5px] font-semibold leading-[18px] tabular-nums"
          style={{ background: 'var(--accent-glow)', color: 'var(--accent-text)' }}>
          {count}
        </span>
      </motion.span>
      {!hidden && <span className="sr-only">{`, ${count} to look at`}</span>}
    </>
  );
}
