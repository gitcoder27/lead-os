import { useState } from 'react';
import { motion } from 'framer-motion';
import { History, X } from 'lucide-react';
import { FOCUS_RING } from '@/components/ui/focus';
import { useScopedStorageKey } from '@/lib/scoped-storage';
import type { TrackerWorkItem } from '@/types';
import { carriedDays } from './MyDayTaskParts';
import { sectionVariants, surfaceStyle } from './MyDayUI';
import { useMyDayTaskDetail } from './MyDayTaskDetailContext';

/** docs/56 MDA-04: carried for a working week or more is worth one question, not amber on every row. */
export const CARRY_NUDGE_DAYS = 7;

function readDismissed(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * One quiet prompt above the day's list when work has been rolling over for a
 * week or more: name the tasks, say what to do, and offer the check-in.
 * Dismissing hides it for this set of tasks today.
 */
export function CarryOverNudge({ items, viewDate, onCheckIn }: {
  items: TrackerWorkItem[];
  viewDate: string;
  onCheckIn?: () => void;
}) {
  const { openTask } = useMyDayTaskDetail();
  const stale = items
    .map((item) => ({ item, days: carriedDays(item, viewDate) }))
    .filter(({ days }) => days >= CARRY_NUDGE_DAYS)
    .sort((a, b) => b.days - a.days);
  const signature = stale.map(({ item }) => item.taskKey ?? item.id).join(',');
  const storageKey = useScopedStorageKey(`my-day:carry-nudge:${viewDate}`);
  const [dismissed, setDismissed] = useState(() => readDismissed(storageKey));

  if (stale.length === 0 || dismissed === signature) return null;

  const one = stale.length === 1;
  const oldest = stale[0]!;
  const headline = one
    ? `Carried over for ${oldest.days} days`
    : `${stale.length} tasks carried over for a week or more`;
  const dismiss = () => {
    setDismissed(signature);
    try {
      window.localStorage.setItem(storageKey, signature);
    } catch {
      // Private mode: the prompt simply returns on the next visit.
    }
  };

  return (
    <motion.section
      variants={sectionVariants}
      aria-label="Carried-over work"
      className="flex items-start gap-3 rounded-2xl px-4 py-3.5"
      style={surfaceStyle}
    >
      <span
        aria-hidden="true"
        className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
        style={{ background: 'color-mix(in srgb, var(--warning) 13%, transparent)', color: 'var(--warning-text)' }}
      >
        <History size={14} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-body font-semibold" style={{ color: 'var(--text-primary)' }}>{headline}</p>
        <p className="mt-0.5 text-ui leading-[18px]" style={{ color: 'var(--text-secondary)' }}>
          Still the plan? Finish, drop or move {one ? 'it' : 'them'}, or tell your lead what’s holding {one ? 'it' : 'them'} up.
        </p>
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          {stale.slice(0, 4).map(({ item, days }) => (
            <button
              key={item.id}
              type="button"
              onClick={() => item.taskKey && openTask(item.taskKey)}
              disabled={!item.taskKey}
              className={`inline-flex h-7 max-w-[240px] items-center gap-1.5 rounded-lg px-2 text-ui transition-colors hover:bg-[var(--bg-tertiary)] ${FOCUS_RING}`}
              style={{ border: '1px solid var(--border)', color: 'var(--text-secondary)' }}
              title={item.title}
            >
              {item.taskKey && <span className="shrink-0 whitespace-nowrap font-mono text-meta font-semibold" style={{ color: 'var(--text-muted)' }}>{item.taskKey}</span>}
              <span className="truncate">{item.title}</span>
              <span className="shrink-0 tabular-nums" style={{ color: 'var(--text-muted)' }}>{days}d</span>
            </button>
          ))}
          {stale.length > 4 && <span className="text-ui" style={{ color: 'var(--text-muted)' }}>+{stale.length - 4} more</span>}
          {onCheckIn && (
            <button type="button" onClick={onCheckIn} className={`ui-btn ui-btn-sm ${FOCUS_RING}`}>
              Check in
            </button>
          )}
        </div>
      </div>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss for today"
        title="Dismiss for today"
        className={`-mr-1.5 -mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors hover:bg-[var(--bg-tertiary)] ${FOCUS_RING}`}
        style={{ color: 'var(--text-muted)' }}
      >
        <X size={15} />
      </button>
    </motion.section>
  );
}
