import { useMemo } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { useToday } from '@/hooks/useToday';
import { useLocalDate } from '@/hooks/useLocalDate';
import { deriveTodayQueue } from '@/lib/today-queue';

/**
 * docs/56 UX-30: off Today the nav's Today tab carries the size of Today's queue as a quiet count,
 * instead of a second "Today N" control next to the actions.
 * docs/73 UXD-06: the count is the "Queue N" total itself — same Today query, same derivation.
 */
export function TodayCountBadge({ hidden = false }: { hidden?: boolean }) {
  const today = useToday(useLocalDate());
  const count = useMemo(
    () => (today.data ? deriveTodayQueue(today.data, { expanded: false, visibleLimit: 0 }).queueView.totalCount : 0),
    [today.data],
  );
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
        <span className="min-w-[18px] shrink-0 rounded-full px-1.5 text-center text-meta font-semibold leading-[18px] tabular-nums"
          style={{ background: 'var(--accent-glow)', color: 'var(--accent-text)' }}>
          {count}
        </span>
      </motion.span>
      {!hidden && <span className="sr-only">{`, ${count} to look at`}</span>}
    </>
  );
}
