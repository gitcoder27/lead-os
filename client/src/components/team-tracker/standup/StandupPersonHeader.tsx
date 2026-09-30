import { TriangleAlert, Bell, BellRing, ChevronLeft, ChevronRight } from 'lucide-react';
import type { TrackerDeveloperDay, TrackerDeveloperStatus } from '@/types';
import { cleanFlagReason, type DayStats } from '@/lib/standup';
import { formatRelativeTime } from '@/lib/utils';
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
  flagReason,
  onFlagReasonChange,
  onStatusSelect,
  onPrev,
  onNext,
  usesCheckIn = true,
}: {
  day: TrackerDeveloperDay;
  stats: DayStats;
  position: number;
  total: number;
  flagged: boolean;
  /** docs/56 P1-07: the one-line reason given when flagging. */
  flagReason?: string;
  onFlagReasonChange: (reason: string) => void;
  onStatusSelect: (status: TrackerDeveloperStatus) => void;
  onPrev: () => void;
  onNext: () => void;
  onFocusCurrent: () => void;
  onAcceptSuggestion: () => void;
  /** False in solo / for non-participating developers: show "Last touched", never "None today". */
  usesCheckIn?: boolean;
}) {
  const suggestion = day.statusSuggestion;

  return (
    <div>
      <div className="flex items-start gap-3">
        <Avatar name={day.developer.displayName} seed={day.developer.accountId} size={42} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 data-standup-person tabIndex={-1} className="break-words text-[20px] font-semibold leading-7 outline-none" style={{ color: 'var(--text-primary)' }}>
              {day.developer.displayName}
            </h2>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
            <select
              value={day.status}
              onChange={(event) => onStatusSelect(event.target.value as TrackerDeveloperStatus)}
              className="h-9 rounded-md px-2 text-[12px] font-medium outline-none"
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
              <span className="inline-flex items-center gap-1 text-[12px]" style={{ color: 'var(--text-muted)' }}>
                <BellRing size={11} /> Follow-up {formatTime(day.nextFollowUpAt)}
              </span>
            )}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1">
          <span className="mr-1 text-[12px] tabular-nums" style={{ color: 'var(--text-muted)' }}>
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

      <p className="mt-3 text-xs" style={{ color: 'var(--text-muted)' }}>
        {usesCheckIn ? (stats.checkInsToday ? `Developer check-in ${stats.lastCheckInAt ? formatRelativeTime(stats.lastCheckInAt) : 'today'}` : 'No developer check-in today')
          : `Last touched: ${day.signals.freshness.lastManagerTouchAt ? formatRelativeTime(day.signals.freshness.lastManagerTouchAt) : 'not yet'}`}
      </p>
      {flagged && <div className="mt-4 border-l-2 pl-3" style={{ borderColor: 'var(--accent)' }}>
        <p className="flex items-center gap-1.5 text-xs font-medium"><Bell size={13} />Follow up at finish</p>
        <label className="mt-2 block text-xs" htmlFor="standup-flag-reason">Why follow up with {day.developer.displayName}? (optional)</label>
        <input id="standup-flag-reason" className="ui-field mt-1 w-full" maxLength={200} value={flagReason ?? ''} onChange={(event) => onFlagReasonChange(event.target.value)} onBlur={(event) => onFlagReasonChange(cleanFlagReason(event.target.value))} onKeyDown={(event) => {
          if (event.key === 'Escape' || (event.key === 'Enter' && !event.nativeEvent.isComposing)) {
            event.preventDefault(); event.stopPropagation(); event.currentTarget.blur();
          }
        }} />
        <p className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>Saved as a linked task when this round is finished.</p>
      </div>}

      {/* P3-D11 hybrid status suggestion */}
      {suggestion && (
        <div
          className="mt-3 flex items-center gap-2 text-xs"
          data-testid="status-suggestion"
        >
          <TriangleAlert size={14} style={{ color: 'var(--warning)' }} />
          <span className="min-w-0 flex-1 text-[12.5px]" style={{ color: 'var(--text-primary)' }}>
            {suggestion.reasonTaskKey} is blocked
          </span>
        </div>
      )}
    </div>
  );
}

function NavButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex h-10 w-10 items-center justify-center rounded-md transition-colors hover:bg-[var(--bg-tertiary)] disabled:opacity-30 disabled:hover:bg-transparent"
      style={{ color: 'var(--text-secondary)', border: '1px solid var(--border)' }}
      aria-label={label}
      title={label}
    >
      {children}
    </button>
  );
}

