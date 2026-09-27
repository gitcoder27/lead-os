import type { ReactNode } from 'react';
import { CalendarClock, CalendarX2, History } from 'lucide-react';
import type { DeveloperAvailability, MyDayReadOnlyReason } from '@/types';
import { FOCUS_RING } from '@/components/tasks/TaskDetailPrimitives';
import { Kbd } from './MyDayUI';

interface MyDayInactiveBannerProps {
  availability: DeveloperAvailability;
}

function Banner({ icon, tone, title, children, action }: { icon: ReactNode; tone: string; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div
      role="status"
      className="flex flex-col gap-3 rounded-2xl px-4 py-3 sm:flex-row sm:items-center"
      style={{
        background: `color-mix(in srgb, ${tone} 8%, var(--bg-secondary))`,
        border: `1px solid color-mix(in srgb, ${tone} 24%, transparent)`,
      }}
    >
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <span
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl"
          style={{ background: `color-mix(in srgb, ${tone} 14%, transparent)`, color: tone }}
          aria-hidden="true"
        >
          {icon}
        </span>
        <div className="min-w-0">
          <div className="text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>
            {title}
          </div>
          {children && (
            <div className="mt-0.5 text-[12.5px] leading-[18px]" style={{ color: 'var(--text-secondary)' }}>
              {children}
            </div>
          )}
        </div>
      </div>
      {action}
    </div>
  );
}

export function MyDayInactiveBanner({ availability }: MyDayInactiveBannerProps) {
  if (availability.state !== 'inactive') {
    return null;
  }

  return (
    <Banner icon={<CalendarX2 size={16} />} tone="var(--warning)" title="You are marked inactive for this day">
      {availability.note || 'A manager marked this day unavailable. Your workspace is read-only until you are reactivated.'}
    </Banner>
  );
}

/** Past and future days are look-only; say so once, plainly, with the way back. */
export function MyDayReadOnlyBanner({ reason, onToday }: { reason?: MyDayReadOnlyReason; onToday: () => void }) {
  if (reason !== 'history' && reason !== 'future') {
    return null;
  }
  const future = reason === 'future';
  return (
    <Banner
      icon={future ? <CalendarClock size={16} /> : <History size={16} />}
      tone="var(--info)"
      title={future ? 'This day hasn’t started yet' : 'You’re looking back at a past day'}
      action={
        <button
          type="button"
          onClick={onToday}
          className={`inline-flex h-8 shrink-0 items-center gap-2 self-start rounded-lg px-3 text-[12.5px] font-semibold transition-colors hover:bg-[var(--bg-tertiary)] sm:self-auto ${FOCUS_RING}`}
          style={{ color: 'var(--text-primary)', border: '1px solid var(--border)' }}
        >
          Back to today
          <Kbd>T</Kbd>
        </button>
      }
    >
      {future ? 'Future days are read-only — plan today’s queue instead.' : 'Past days are read-only. Activity stays open for reference.'}
    </Banner>
  );
}
