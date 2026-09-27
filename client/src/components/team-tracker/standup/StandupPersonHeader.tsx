import { AlertTriangle, BellRing, ChevronLeft, ChevronRight, Flag } from 'lucide-react';
import type { TrackerDeveloperDay, TrackerDeveloperStatus } from '@/types';
import type { DayStats } from '@/lib/standup';
import { formatRelativeTime } from '@/lib/utils';
import { TrackerStatusPill } from '../TrackerStatusPill';
import { Avatar } from './StandupPrimitives';

export const STATUS_OPTIONS: TrackerDeveloperStatus[] = ['on_track', 'at_risk', 'blocked', 'waiting', 'done_for_today'];
export const STATUS_LABELS: Record<TrackerDeveloperStatus, string> = {
  on_track: 'On track',
  at_risk: 'At risk',
  blocked: 'Blocked',
  waiting: 'Waiting',
  done_for_today: 'Done for today',
};

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  } catch {
    return iso;
  }
}

/** docs/50 §4: identity row + the five-cell day strip. */
export function StandupPersonHeader({
  day,
  stats,
  position,
  total,
  flagged,
  onStatusSelect,
  onPrev,
  onNext,
  onFocusCurrent,
  onAcceptSuggestion,
}: {
  day: TrackerDeveloperDay;
  stats: DayStats;
  position: number;
  total: number;
  flagged: boolean;
  onStatusSelect: (status: TrackerDeveloperStatus) => void;
  onPrev: () => void;
  onNext: () => void;
  onFocusCurrent: () => void;
  onAcceptSuggestion: () => void;
}) {
  const suggestion = day.statusSuggestion;
  const oneOnOne = day.oneOnOne;

  return (
    <div>
      <div className="flex items-start gap-3">
        <Avatar name={day.developer.displayName} size={42} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate text-[17px] font-semibold tracking-[-0.01em]" style={{ color: 'var(--text-primary)' }}>
              {day.developer.displayName}
            </h2>
            <TrackerStatusPill status={day.status} />
            {/* docs/48 §4.4: read-only 1:1 badge — "1:1 today" / overdue. */}
            {oneOnOne && (
              <span
                className="rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.05em]"
                style={{
                  color: oneOnOne.overdueDays > 0 ? 'var(--danger)' : 'var(--accent)',
                  background: oneOnOne.overdueDays > 0
                    ? 'color-mix(in srgb, var(--danger) 12%, transparent)'
                    : 'color-mix(in srgb, var(--accent) 12%, transparent)',
                }}
                title={`1:1 scheduled ${oneOnOne.scheduledFor}`}
              >
                {oneOnOne.overdueDays > 0 ? `1:1 overdue ${oneOnOne.overdueDays}d` : '1:1 today'}
              </span>
            )}
            {flagged && (
              <span
                className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.05em]"
                style={{ color: 'var(--accent)', border: '1px solid color-mix(in srgb, var(--accent) 35%, transparent)' }}
              >
                <Flag size={10} /> Follow up
              </span>
            )}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
            <select
              value={day.status}
              onChange={(event) => onStatusSelect(event.target.value as TrackerDeveloperStatus)}
              className="h-7 rounded-md px-2 text-[12px] font-medium outline-none focus-visible:shadow-[0_0_0_2px_var(--accent)]"
              style={{ background: 'var(--bg-tertiary)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}
              aria-label="Set developer status"
            >
              {STATUS_OPTIONS.map((status) => (
                <option key={status} value={status}>
                  {STATUS_LABELS[status]}
                </option>
              ))}
            </select>
            {day.nextFollowUpAt && (
              <span className="inline-flex items-center gap-1 text-[11.5px]" style={{ color: 'var(--text-muted)' }}>
                <BellRing size={11} /> Follow-up {formatTime(day.nextFollowUpAt)}
              </span>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <span className="mr-1 text-[11.5px] tabular-nums" style={{ color: 'var(--text-muted)' }}>
            {position} / {total}
          </span>
          <NavButton label="Previous developer" onClick={onPrev} disabled={position <= 1}>
            <ChevronLeft size={14} />
          </NavButton>
          <NavButton label="Next developer" onClick={onNext}>
            <ChevronRight size={14} />
          </NavButton>
        </div>
      </div>

      {/* Day strip */}
      <div
        className="mt-4 grid grid-cols-2 overflow-hidden rounded-xl sm:grid-cols-[minmax(0,2.2fr)_repeat(4,minmax(0,1fr))]"
        style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)' }}
        data-testid="standup-day-strip"
      >
        <StripCell label="Current" className="col-span-2 sm:col-span-1">
          {stats.current ? (
            <button type="button" onClick={onFocusCurrent} className="flex min-w-0 max-w-full items-center gap-1.5 text-left hover:underline">
              <span className="shrink-0 font-mono text-[11px]" style={{ color: 'var(--accent)' }}>{stats.current.taskKey}</span>
              <span className="truncate text-[13px] font-medium" style={{ color: 'var(--text-primary)' }}>{stats.current.title}</span>
            </button>
          ) : (
            <span className="text-[13px]" style={{ color: 'var(--text-muted)' }}>None set</span>
          )}
        </StripCell>
        <StripCell label="Open">
          <StripValue>{stats.open}</StripValue>
        </StripCell>
        <StripCell label="Blocked">
          <StripValue color={stats.blocked > 0 ? 'var(--danger)' : undefined}>{stats.blocked}</StripValue>
        </StripCell>
        <StripCell label="Done today">
          <StripValue color={stats.doneToday > 0 ? 'var(--success)' : undefined}>{stats.doneToday}</StripValue>
        </StripCell>
        <StripCell label="Check-in">
          {stats.checkInsToday > 0 ? (
            <span className="text-[13px] font-medium" style={{ color: 'var(--text-primary)' }} title={stats.lastCheckInAt}>
              {stats.checkInsToday} today
              {stats.lastCheckInAt && (
                <span className="block text-[11px] font-normal" style={{ color: 'var(--text-muted)' }}>{formatRelativeTime(stats.lastCheckInAt)}</span>
              )}
            </span>
          ) : (
            <span className="text-[13px] font-medium" style={{ color: 'var(--warning)' }}>
              None today
              {stats.lastCheckInAt && (
                <span className="block text-[11px] font-normal" style={{ color: 'var(--text-muted)' }}>last {formatRelativeTime(stats.lastCheckInAt)}</span>
              )}
            </span>
          )}
        </StripCell>
      </div>

      {/* P3-D11 hybrid status suggestion */}
      {suggestion && (
        <div
          className="mt-3 flex items-center gap-2.5 rounded-xl px-3 py-2"
          style={{ background: 'color-mix(in srgb, var(--warning) 9%, transparent)', border: '1px solid color-mix(in srgb, var(--warning) 32%, transparent)' }}
          data-testid="status-suggestion"
        >
          <AlertTriangle size={14} style={{ color: 'var(--warning)' }} />
          <span className="min-w-0 flex-1 text-[12.5px]" style={{ color: 'var(--text-primary)' }}>
            {suggestion.reasonTaskKey} is blocked
            {suggestion.reasonTaskTitle ? ` — ${suggestion.reasonTaskTitle}` : ''}. Suggested status: blocked.
          </span>
          <button
            type="button"
            onClick={onAcceptSuggestion}
            className="shrink-0 rounded-md px-2 py-1 text-[11.5px] font-semibold"
            style={{ background: 'var(--warning)', color: '#1a1300' }}
          >
            Accept (y)
          </button>
        </div>
      )}
    </div>
  );
}

function StripCell({ label, children, className = '' }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`min-w-0 px-3.5 py-2.5 [&:not(:first-child)]:border-l ${className}`} style={{ borderColor: 'var(--border)' }}>
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.09em]" style={{ color: 'var(--text-muted)' }}>
        {label}
      </div>
      {children}
    </div>
  );
}

function StripValue({ children, color }: { children: React.ReactNode; color?: string }) {
  return (
    <span className="text-[17px] font-semibold leading-none tabular-nums" style={{ color: color ?? 'var(--text-primary)' }}>
      {children}
    </span>
  );
}

function NavButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-[var(--bg-tertiary)] disabled:opacity-30 disabled:hover:bg-transparent"
      style={{ color: 'var(--text-secondary)', border: '1px solid var(--border)' }}
      aria-label={label}
      title={label}
    >
      {children}
    </button>
  );
}

