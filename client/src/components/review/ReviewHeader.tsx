import { CalendarCheck, ChevronDown, Keyboard, X } from 'lucide-react';
import { Kbd } from '@/components/ui/Kbd';

/**
 * docs/59 §5.2: title with the week, a thin progress bar, "Step n of m" and Exit. On a phone the
 * step and progress drop to a second line, and the step name opens the step list.
 */
export function ReviewHeader({
  range,
  weekLabel,
  onSwitchWeek,
  stepLabel,
  stepIndex,
  stepTotal,
  onExit,
  onShortcuts,
  onPhoneSteps,
}: {
  range: string;
  /** "Last week" or null. */
  weekLabel: string | null;
  /** Label of the switch to the other week ("Switch to this week"). */
  onSwitchWeek?: { label: string; run: () => void };
  stepLabel: string;
  stepIndex: number;
  stepTotal: number;
  onExit: () => void;
  onShortcuts: (anchor: HTMLElement) => void;
  onPhoneSteps: (anchor: HTMLElement) => void;
}) {
  const last = stepIndex === stepTotal - 1;
  const percent = stepTotal > 0 ? ((stepIndex + 1) / stepTotal) * 100 : 0;
  const bar = (
    <span
      className="review-progress"
      role="progressbar"
      aria-label="Review progress"
      aria-valuemin={1}
      aria-valuemax={stepTotal}
      aria-valuenow={stepIndex + 1}
    >
      <span className="review-progress-fill" data-last={last || undefined} style={{ width: `${percent}%` }} />
    </span>
  );
  return (
    <header className="review-header">
      <div className="review-header-row">
        <span className="review-header-icon" aria-hidden="true"><CalendarCheck size={15} /></span>
        <h1 className="review-title">
          Weekly review <span className="review-title-range">· {range}</span>
          {weekLabel ? <span className="review-title-range"> · {weekLabel}</span> : null}
        </h1>
        {onSwitchWeek ? (
          <button type="button" className="ui-btn-ghost review-week-switch" onClick={onSwitchWeek.run}>
            {onSwitchWeek.label}
          </button>
        ) : null}
        <div className="review-progress-wrap">
          {bar}
          <span className="review-step-count">Step {stepIndex + 1} of {stepTotal}</span>
        </div>
        <div className="review-header-end">
          <button type="button" className="ui-icon-btn" aria-label="Keyboard shortcuts" onClick={(event) => onShortcuts(event.currentTarget)}>
            <Keyboard size={15} />
          </button>
          <button type="button" className="ui-btn-ghost" aria-label="Exit weekly review" onClick={onExit}>
            <X size={14} aria-hidden="true" />
            <span className="hidden sm:inline">Exit</span>
            <span className="hidden sm:inline"><Kbd variant="subtle">Esc</Kbd></span>
          </button>
        </div>
      </div>
      <div className="review-phone-steps">
        <button type="button" className="review-phone-step-btn" aria-haspopup="dialog" onClick={(event) => onPhoneSteps(event.currentTarget)}>
          {stepLabel} · {stepIndex + 1} of {stepTotal}
          <ChevronDown size={13} aria-hidden="true" />
        </button>
        {bar}
      </div>
    </header>
  );
}
