import { Fragment } from 'react';
import { Kbd } from './StandupPrimitives';

export interface StandupAction {
  keys: string[];
  label: string;
  onRun: () => void;
  disabled?: boolean;
  /** Highlight (e.g. a pending suggestion or active flag). */
  emphasis?: boolean;
}

export interface StandupActionGroup {
  label: string;
  actions: StandupAction[];
}

/**
 * docs/50 S7: the keymap as a clickable, grouped footer. Every chip runs the
 * same handler as its key.
 */
export function StandupActionBar({ groups }: { groups: StandupActionGroup[] }) {
  return (
    <div
      className="flex shrink-0 items-center gap-x-4 gap-y-1.5 overflow-x-auto border-t px-4 py-2"
      style={{ borderColor: 'var(--border)', background: 'var(--bg-secondary)' }}
      role="toolbar"
      aria-label="Standup actions"
      data-testid="standup-action-bar"
    >
      {groups.map((group, groupIndex) => (
        <Fragment key={group.label}>
          {groupIndex > 0 && <span className="h-4 w-px shrink-0" style={{ background: 'var(--border)' }} aria-hidden="true" />}
          <div className="flex shrink-0 items-center gap-0.5">
            <span className="mr-1.5 text-[9.5px] font-semibold uppercase tracking-[0.1em]" style={{ color: 'var(--text-disabled)' }}>
              {group.label}
            </span>
            {group.actions.map((action) => (
              <button
                key={action.label}
                type="button"
                tabIndex={-1}
                // Keep focus where it was so the keymap (and Enter) stay on the standup surface.
                onMouseDown={(event) => event.preventDefault()}
                onClick={action.onRun}
                disabled={action.disabled}
                title={`${action.label} (${action.keys.join(' / ')})`}
                className="flex h-7 shrink-0 items-center gap-1.5 rounded-md px-1.5 text-[12px] font-medium transition-colors hover:bg-[var(--bg-tertiary)] disabled:pointer-events-none disabled:opacity-35"
                style={{ color: action.emphasis ? 'var(--accent)' : 'var(--text-secondary)' }}
              >
                <span className="flex items-center gap-0.5">
                  {action.keys.map((key) => <Kbd key={key}>{key}</Kbd>)}
                </span>
                {action.label}
              </button>
            ))}
          </div>
        </Fragment>
      ))}
    </div>
  );
}
