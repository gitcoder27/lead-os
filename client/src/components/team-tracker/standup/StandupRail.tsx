import { TriangleAlert, Bell, Check, ListChecks } from 'lucide-react';
import type { TrackerDeveloperDay } from '@/types';
import { TrackerStatusPill } from '../TrackerStatusPill';
import { Avatar, Kbd } from './StandupPrimitives';

/**
 * docs/50 §3: roster in board order. Current = accent bar + ring; reviewed =
 * success badge on the avatar, name dimmed; unreviewed = full contrast.
 */
export function StandupRail({
  days,
  currentId,
  reviewed,
  acknowledged,
  flagged,
  wrapUpActive,
  onSelect,
  onWrapUp,
}: {
  days: TrackerDeveloperDay[];
  currentId: string | null;
  reviewed: Set<string>;
  acknowledged: Set<string>;
  flagged: Set<string>;
  wrapUpActive: boolean;
  onSelect: (accountId: string) => void;
  onWrapUp: () => void;
}) {
  const reviewedCount = days.filter((day) => reviewed.has(day.developer.accountId)).length;
  const allReviewed = days.length > 0 && reviewedCount === days.length;

  return (
    <nav
      className="flex w-[64px] shrink-0 flex-col border-r md:w-[248px]"
      style={{ borderColor: 'var(--border)', background: 'var(--bg-secondary)' }}
      aria-label="Standup roster"
    >
      <div className="hidden items-center justify-between px-4 pb-1.5 pt-3.5 md:flex">
        <span className="text-[11px] font-semibold uppercase tracking-[0.09em]" style={{ color: 'var(--text-muted)' }}>
          Order
        </span>
        <span className="text-[12px] font-semibold tabular-nums" style={{ color: allReviewed ? 'var(--success)' : 'var(--text-muted)' }}>
          {reviewedCount}/{days.length}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-1.5" role="listbox" aria-label="Standup order">
        {days.map((day) => {
          const id = day.developer.accountId;
          const active = !wrapUpActive && id === currentId;
          const isReviewed = reviewed.has(id);
          const isFlagged = flagged.has(id);
          return (
            <button
              key={id}
              type="button"
              role="option"
              aria-selected={active}
              aria-label={`${day.developer.displayName}${isReviewed ? ', visited' : ''}${isReviewed && !acknowledged.has(id) ? ', not saved' : ''}${isFlagged ? ', flagged' : ''}`}
              tabIndex={active ? 0 : -1}
              title={day.developer.displayName}
              onClick={() => onSelect(id)}
              className="relative mb-0.5 flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left outline-none transition-colors hover:bg-[var(--bg-tertiary)]"
              style={{ background: active ? 'color-mix(in srgb, var(--bg-tertiary) 80%, transparent)' : undefined }}
            >
              {active && (
                <span className="absolute inset-y-1.5 left-0 w-[2px] rounded-full" style={{ background: 'var(--accent)' }} aria-hidden="true" />
              )}
              <span className="relative">
                <Avatar name={day.developer.displayName} seed={day.developer.accountId} size={30} ring={active} />
                {isReviewed && acknowledged.has(id) && (
                  <span
                    className="absolute -bottom-1 -right-1 flex h-[14px] w-[14px] items-center justify-center rounded-full"
                    style={{ background: 'var(--text-muted)', color: 'var(--bg-secondary)', border: '2px solid var(--bg-secondary)' }}
                    aria-hidden="true"
                  >
                    <Check size={8} strokeWidth={4} />
                  </span>
                )}
              </span>
              <span className="hidden min-w-0 flex-1 md:block">
                <span
                  className="block truncate text-[12.5px] font-semibold"
                  style={{ color: isReviewed && !active ? 'var(--text-secondary)' : 'var(--text-primary)' }}
                >
                  {day.developer.displayName}
                </span>
                <span className="mt-1 flex items-center gap-1.5">
                  {day.status !== 'on_track' && <TrackerStatusPill status={day.status} />}
                </span>
              </span>
              <span className="hidden shrink-0 flex-col items-end gap-1 md:flex">
                {isFlagged && <Bell size={12} style={{ color: 'var(--accent)' }} aria-hidden="true" />}
                {day.statusSuggestion && <TriangleAlert size={12} style={{ color: 'var(--warning)' }} aria-label="Status suggestion" />}
              </span>
            </button>
          );
        })}
      </div>

      <div className="border-t p-2" style={{ borderColor: 'var(--border)' }}>
        {allReviewed && !wrapUpActive && (
          <div className="mb-2 hidden rounded-md px-2 py-1.5 text-[12px] font-medium md:block" style={{ color: 'var(--success)', background: 'color-mix(in srgb, var(--success) 10%, transparent)' }}>
            All people visited
          </div>
        )}
        <button
          type="button"
          onClick={onWrapUp}
          aria-pressed={wrapUpActive}
          className="flex w-full items-center justify-center gap-2 rounded-lg px-2 py-2 text-[12px] font-semibold transition-colors md:justify-start"
          style={{
            color: wrapUpActive || allReviewed ? 'var(--accent)' : 'var(--text-secondary)',
            background: wrapUpActive ? 'var(--accent-glow)' : 'transparent',
            border: `1px solid ${wrapUpActive || allReviewed ? 'color-mix(in srgb, var(--accent) 40%, transparent)' : 'var(--border)'}`,
          }}
        >
          <ListChecks size={14} />
          <span className="hidden flex-1 md:inline">Wrap-up</span>
          <span className="hidden md:inline"><Kbd subtle>w</Kbd></span>
        </button>
      </div>
    </nav>
  );
}
