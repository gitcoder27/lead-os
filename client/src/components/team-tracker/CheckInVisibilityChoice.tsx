import type { TrackerCheckInVisibility } from '@/types';

interface CheckInVisibilityChoiceProps {
  /** The developer's display name; the first word is used in the copy. */
  developerName: string;
  value: TrackerCheckInVisibility;
  onChange: (value: TrackerCheckInVisibility) => void;
  disabled?: boolean;
}

/**
 * docs/56 P0-S6: who sees a manager-authored check-in. Render only when the
 * developer can log in (`usesCheckIns`); otherwise nothing is developer-facing.
 * A private check-in cannot reference tasks (their events would be shared).
 */
export function CheckInVisibilityChoice({ developerName, value, onChange, disabled }: CheckInVisibilityChoiceProps) {
  const firstName = developerName.split(' ')[0] || developerName;
  const option = (choice: TrackerCheckInVisibility, label: string) => (
    <button
      type="button"
      role="radio"
      aria-checked={value === choice}
      disabled={disabled}
      onClick={() => onChange(choice)}
      className="rounded-md px-2 py-0.5 text-[12px] font-medium transition-colors disabled:opacity-50"
      style={
        value === choice
          ? { background: 'var(--bg-primary)', color: 'var(--text-primary)', boxShadow: '0 0 0 1px var(--border-strong)' }
          : { color: 'var(--text-muted)' }
      }
    >
      {label}
    </button>
  );

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="checkin-visibility">
      <div
        role="radiogroup"
        aria-label="Who sees this check-in"
        className="inline-flex items-center gap-0.5 rounded-lg p-0.5"
        style={{ background: 'var(--bg-tertiary)' }}
      >
        {option('shared', `Visible to ${firstName}`)}
        {option('private', 'Private — only you')}
      </div>
      <span className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
        {value === 'private' ? "Can't be linked to a task." : `${firstName} sees this on My Day.`}
      </span>
    </div>
  );
}
