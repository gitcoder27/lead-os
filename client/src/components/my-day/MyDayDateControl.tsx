import { ChevronLeft, ChevronRight } from 'lucide-react';
import { differenceInCalendarDays, format, parseISO } from 'date-fns';
import { FOCUS_RING } from '@/components/tasks/TaskDetailPrimitives';
import { getLocalIsoDate, shiftLocalIsoDate } from '@/lib/utils';
import { HAIRLINE } from './MyDayUI';

interface MyDayDateControlProps {
  date: string;
  setDate: (date: string | ((d: string) => string)) => void;
}

/** "Today" / "Yesterday" / "Tomorrow" / "Thu, Sep 25" for a local yyyy-MM-dd date. */
export function relativeDayLabel(date: string, today = getLocalIsoDate()): string {
  const diff = differenceInCalendarDays(parseISO(date), parseISO(today));
  if (diff === 0) return 'Today';
  if (diff === -1) return 'Yesterday';
  if (diff === 1) return 'Tomorrow';
  return format(parseISO(date), 'EEE, MMM d');
}

export function MyDayDateControl({ date, setDate }: MyDayDateControlProps) {
  const today = getLocalIsoDate();
  const isToday = date === today;
  const label = relativeDayLabel(date, today);

  const stepButton = `flex h-8 w-8 items-center justify-center rounded-[9px] transition-colors hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)] ${FOCUS_RING}`;

  return (
    <div
      className="flex items-center gap-0.5 rounded-xl p-0.5"
      style={{ background: 'color-mix(in srgb, var(--bg-secondary) 70%, transparent)', border: `1px solid ${HAIRLINE}` }}
      role="group"
      aria-label="Change day"
    >
      <button
        type="button"
        onClick={() => setDate((d) => shiftLocalIsoDate(d, -1))}
        className={stepButton}
        style={{ color: 'var(--text-muted)' }}
        aria-label="Previous day"
        title="Previous day ( [ )"
      >
        <ChevronLeft size={16} />
      </button>
      <button
        type="button"
        onClick={() => setDate(today)}
        disabled={isToday}
        className={`h-8 min-w-[92px] rounded-[9px] px-2.5 text-[13px] font-medium tabular-nums transition-colors enabled:hover:bg-[var(--bg-tertiary)] disabled:cursor-default ${FOCUS_RING}`}
        style={{ color: isToday ? 'var(--text-primary)' : 'var(--accent)' }}
        aria-label={isToday ? 'Viewing today' : `Viewing ${label} — jump to today`}
        title={isToday ? undefined : 'Jump to today ( T )'}
      >
        {label}
      </button>
      <button
        type="button"
        onClick={() => setDate((d) => shiftLocalIsoDate(d, 1))}
        className={stepButton}
        style={{ color: 'var(--text-muted)' }}
        aria-label="Next day"
        title="Next day ( ] )"
      >
        <ChevronRight size={16} />
      </button>
    </div>
  );
}
