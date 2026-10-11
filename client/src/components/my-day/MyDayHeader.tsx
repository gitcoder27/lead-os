import { ChevronRight, LogOut, RefreshCw, Sun, Moon } from 'lucide-react';
import type { ReactNode } from 'react';
import { format, parseISO } from 'date-fns';
import type { AuthUser, MyDayResponse } from '@/types';
import { getLocalIsoDate } from '@/lib/utils';
import { FOCUS_RING } from '@/components/ui/focus';
import { getStatusInfo } from './status-config';
import { MyDayDateControl, relativeDayLabel } from './MyDayDateControl';
import { HAIRLINE, IconAction } from './MyDayUI';

interface MyDayHeaderProps {
  date: string;
  setDate: (date: string | ((d: string) => string)) => void;
  user: AuthUser | null;
  day: MyDayResponse | undefined;
  isFetching: boolean;
  theme: string;
  onRefresh: () => void;
  onToggleTheme: () => void;
  onLogout: () => void;
  /** Narrow screens stack the check-in below the tasks; the status chip jumps there. */
  onJumpToCheckIn?: () => void;
  inbox?: ReactNode;
}

function greeting(now = new Date()): string {
  const hour = now.getHours();
  if (hour < 5) return 'Working late';
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

export function MyDayHeader({
  date,
  setDate,
  user,
  day,
  isFetching,
  theme,
  onRefresh,
  onToggleTheme,
  onLogout,
  onJumpToCheckIn,
  inbox,
}: MyDayHeaderProps) {
  const isToday = date === getLocalIsoDate();
  const firstName = user?.displayName?.trim().split(/\s+/)[0];
  const longDate = format(parseISO(date), 'EEEE, MMMM d');

  const eyebrow = isToday ? longDate : relativeDayLabel(date);
  const title = isToday ? `${greeting()}${firstName ? `, ${firstName}` : ''}` : longDate;

  return (
    <header className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <p className="text-body font-medium" style={{ color: 'var(--text-muted)' }}>
          {eyebrow}
        </p>
        <h1
          className="ui-page-title mt-1 truncate"
        >
          {title}
        </h1>
        {day && (
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
            <DayProgress
              done={day.completedItems.length}
              current={day.currentItem ? 1 : 0}
              planned={day.plannedItems.length}
            />
            {onJumpToCheckIn && <StatusChip status={getStatusInfo(day.status)} onClick={onJumpToCheckIn} />}
          </div>
        )}
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2 sm:pt-1">
        {inbox}
        <MyDayDateControl date={date} setDate={setDate} />
        <span className="mx-0.5 h-5 w-px" style={{ background: HAIRLINE }} aria-hidden="true" />
        <IconAction label="Refresh" onClick={onRefresh} disabled={isFetching} tone="var(--text-muted)">
          <RefreshCw size={15} className={isFetching ? 'animate-spin' : ''} />
        </IconAction>
        <IconAction
          label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          onClick={onToggleTheme}
          tone="var(--text-muted)"
        >
          {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
        </IconAction>
        <IconAction label="Sign out" onClick={onLogout} tone="var(--text-muted)">
          <LogOut size={15} />
        </IconAction>
      </div>
    </header>
  );
}

function StatusChip({ status, onClick }: { status: ReturnType<typeof getStatusInfo>; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex h-6 items-center gap-1.5 rounded-full pl-2 pr-1.5 text-ui font-medium lg:hidden ${FOCUS_RING}`}
      style={{
        color: status.textColor,
        background: `color-mix(in srgb, ${status.color} 10%, transparent)`,
        border: `1px solid color-mix(in srgb, ${status.color} 26%, transparent)`,
      }}
      aria-label={`Status: ${status.label}. Go to check in`}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: status.color }} aria-hidden="true" />
      {status.label}
      <ChevronRight size={12} className="opacity-70" aria-hidden="true" />
    </button>
  );
}

/** docs/56 MDA-03: the task in focus is hatched, so an unfinished day never reads as half done. */
const IN_PROGRESS_FILL = 'repeating-linear-gradient(-45deg, var(--accent) 0 2.5px, color-mix(in srgb, var(--accent) 38%, transparent) 2.5px 5px)';
const QUEUED_FILL = 'color-mix(in srgb, var(--text-muted) 28%, transparent)';

/**
 * The day at a glance: one segment per task — done (solid), in focus
 * (hatched), still queued (faint). Falls back to a proportional bar when the
 * day is too full for segments.
 */
function DayProgress({ done, current, planned, className }: { done: number; current: number; planned: number; className?: string }) {
  const total = done + current + planned;
  const allDone = total > 0 && done === total;
  const label = total === 0 ? 'Nothing planned yet' : allDone ? `All ${total} done` : `${done} of ${total} done`;

  const segments: string[] = [
    ...Array<string>(done).fill('var(--success)'),
    ...Array<string>(current).fill(IN_PROGRESS_FILL),
    ...Array<string>(planned).fill(QUEUED_FILL),
  ];
  const segmented = total > 0 && total <= 16;

  return (
    <div className={`flex items-center gap-3 ${className ?? ''}`}>
      {total > 0 && (
        <div
          role="img"
          aria-label={`${done} of ${total} tasks done${current ? ', one in progress' : ''}`}
          className="flex h-1.5 w-[132px] shrink-0 gap-[3px] overflow-hidden rounded-full sm:w-[168px]"
        >
          {segmented ? (
            segments.map((fill, index) => (
              <span key={index} className="h-full min-w-[4px] flex-1 rounded-full transition-colors duration-500" style={{ background: fill }} />
            ))
          ) : (
            <>
              <span className="h-full rounded-full" style={{ width: `${(done / total) * 100}%`, background: 'var(--success)' }} />
              {current > 0 && <span className="h-full w-[10px] rounded-full" style={{ background: IN_PROGRESS_FILL }} />}
              <span className="h-full flex-1 rounded-full" style={{ background: QUEUED_FILL }} />
            </>
          )}
        </div>
      )}
      <span className="text-body tabular-nums" style={{ color: allDone ? 'var(--success-text)' : 'var(--text-secondary)' }}>
        {label}
        {current > 0 && !allDone && (
          <span style={{ color: 'var(--text-muted)' }}>
            <span aria-hidden="true"> · </span>1 in progress
          </span>
        )}
      </span>
    </div>
  );
}
