import { AnimatePresence, motion } from 'framer-motion';
import type { TrackerWorkItem } from '@/types';
import { HAIRLINE } from './MyDayUI';
import { MyDayTaskRow } from './MyDayTaskRow';

interface FinishedWorkProps {
  viewDate: string;
  completedItems: TrackerWorkItem[];
  droppedItems: TrackerWorkItem[];
  onReopen?: (id: number) => void;
  readOnly?: boolean;
}

/** The tail of the day: what shipped, then (quieter) what was let go. */
export function FinishedWork({ viewDate, completedItems, droppedItems, onReopen, readOnly }: FinishedWorkProps) {
  const rows = [
    ...completedItems.map((item) => ({ item, variant: 'done' as const })),
    ...droppedItems.map((item) => ({ item, variant: 'dropped' as const })),
  ];

  return (
    <div className="flex flex-col">
      <AnimatePresence initial={false}>
        {rows.map(({ item, variant }, position) => (
          <motion.div
            key={item.id}
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: variant === 'dropped' ? 0.72 : 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.22 }}
            className="overflow-hidden"
            style={{ borderTop: position > 0 ? `1px solid ${HAIRLINE}` : undefined }}
          >
            <MyDayTaskRow item={item} variant={variant} viewDate={viewDate} readOnly={readOnly} onReopen={onReopen} />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
