import { useState } from 'react';
import { TriangleAlert, Bell, BellRing, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import type { TrackerDeveloperDay, TrackerDeveloperStatus } from '@/types';
import { cleanFlagReason, type DayStats } from '@/lib/standup';
import { formatRelativeTime } from '@/lib/utils';
import { Avatar } from './StandupPrimitives';
import { YouTag } from '@/components/team-tracker/YouTag';
import { DevStatusMark, StatusDot, STATUS_META } from '@/components/ui/DevStatus';
import { MenuHeading, MenuItem, TaskPopover } from '@/components/ui/Popover';

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
            <h2 data-standup-person tabIndex={-1} className="break-words text-title font-semibold leading-7 outline-none" style={{ color: 'var(--text-primary)' }}>
              {day.developer.displayName}
              <YouTag show={day.developer.isSelf} />
            </h2>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
            <StatusMenu status={day.status} suggested={day.statusSuggestion?.status} onSelect={onStatusSelect} />
            {day.nextFollowUpAt && (
              <span className="inline-flex items-center gap-1 text-ui" style={{ color: 'var(--text-muted)' }}>
                <BellRing size={11} /> Follow-up {formatTime(day.nextFollowUpAt)}
              </span>
            )}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1">
          <span className="mr-1 text-ui tabular-nums" style={{ color: 'var(--text-muted)' }}>
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

      <p className="mt-3 text-ui leading-4" style={{ color: 'var(--text-muted)' }}>
        {usesCheckIn ? (stats.checkInsToday ? `Developer check-in ${stats.lastCheckInAt ? formatRelativeTime(stats.lastCheckInAt) : 'today'}` : 'No developer check-in today')
          : `Last touched: ${day.signals.freshness.lastManagerTouchAt ? formatRelativeTime(day.signals.freshness.lastManagerTouchAt) : 'not yet'}`}
      </p>
      {flagged && <div className="mt-4 border-l-2 pl-3" style={{ borderColor: 'var(--accent)' }}>
        <p className="flex items-center gap-1.5 text-ui leading-4 font-medium"><Bell size={13} />Follow up at finish</p>
        <label className="mt-2 block text-ui leading-4" htmlFor="standup-flag-reason">Why follow up with {day.developer.displayName}? (optional)</label>
        <input id="standup-flag-reason" className="ui-field mt-1 w-full" maxLength={200} value={flagReason ?? ''} onChange={(event) => onFlagReasonChange(event.target.value)} onBlur={(event) => onFlagReasonChange(cleanFlagReason(event.target.value))} onKeyDown={(event) => {
          if (event.key === 'Escape' || (event.key === 'Enter' && !event.nativeEvent.isComposing)) {
            event.preventDefault(); event.stopPropagation(); event.currentTarget.blur();
          }
        }} />
        <p className="mt-1 text-ui leading-4" style={{ color: 'var(--text-muted)' }}>Saved as a linked task when this round is finished.</p>
      </div>}

      {/* P3-D11 hybrid status suggestion */}
      {suggestion && (
        <div
          className="mt-3 flex items-center gap-2 text-ui leading-4"
          data-testid="status-suggestion"
        >
          <TriangleAlert size={14} style={{ color: 'var(--warning)' }} />
          <span className="min-w-0 flex-1 text-body" style={{ color: 'var(--text-primary)' }}>
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


/**
 * docs/73 UXD-23: status as the shared dot-and-label mark that opens a menu — the same control as
 * the Team drawer — instead of a native select. Accelerator letters match `STATUS_META`.
 */
function StatusMenu({ status, suggested, onSelect }: {
  status: TrackerDeveloperStatus;
  suggested?: TrackerDeveloperStatus;
  onSelect: (status: TrackerDeveloperStatus) => void;
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const choose = (next: TrackerDeveloperStatus) => {
    setAnchor(null);
    if (next !== status) onSelect(next);
  };
  return (
    <>
      <button
        type="button"
        onClick={(event) => setAnchor(anchor ? null : event.currentTarget)}
        aria-label={`Set developer status (currently ${STATUS_META[status].label})`}
        aria-haspopup="menu"
        aria-expanded={Boolean(anchor)}
        className="group inline-flex min-h-8 items-center gap-1 rounded-full pr-1.5 transition-colors hover:bg-[var(--bg-tertiary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-active)]"
      >
        <DevStatusMark status={status} emphasis />
        <ChevronDown size={12} aria-hidden="true" className="opacity-60 transition-transform group-aria-expanded:rotate-180" style={{ color: 'var(--text-muted)' }} />
      </button>
      {anchor && (
        <TaskPopover
          anchor={anchor}
          onClose={() => setAnchor(null)}
          label="Developer status"
          width={220}
          onAccelerator={(key) => {
            const next = STATUS_OPTIONS.find((candidate) => STATUS_META[candidate].key === key.toLowerCase());
            if (!next) return false;
            choose(next);
            return true;
          }}
        >
          <MenuHeading>Set status</MenuHeading>
          {STATUS_OPTIONS.map((option) => (
            <MenuItem
              key={option}
              role="menuitemradio"
              checked={option === status}
              icon={<StatusDot status={option} size={8} />}
              label={suggested === option && option !== status ? (
                <span className="flex items-center gap-1.5">
                  {STATUS_LABELS[option]}
                  <span className="text-ui" style={{ color: 'var(--text-muted)' }}>suggested</span>
                </span>
              ) : STATUS_LABELS[option]}
              hint={STATUS_META[option].key}
              onSelect={() => choose(option)}
            />
          ))}
        </TaskPopover>
      )}
    </>
  );
}
