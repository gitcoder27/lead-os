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
      // docs/73 UXD-23: on touch the keycaps go (they mean nothing there) but the buttons stay, so Note,
      // Flag, Done and Update remain reachable; on a phone the bar is one scrolling row.
      className="no-scrollbar flex shrink-0 items-center gap-2 border-t px-3 py-2 max-md:overflow-x-auto md:flex-wrap"
      style={{ borderColor: 'var(--border)', background: 'var(--bg-secondary)' }}
      role="toolbar"
      aria-label="Standup actions"
      data-testid="standup-action-bar"
    >
      {groups.map((group, groupIndex) => (
        <Fragment key={group.label}>
          {groupIndex > 0 && <span className="h-4 w-px shrink-0" style={{ background: 'var(--border)' }} aria-hidden="true" />}
          <div className="flex shrink-0 items-center gap-1 md:flex-wrap">
            {group.actions.map((action) => (
              <button
                key={action.label}
                type="button"
                onClick={action.onRun}
                disabled={action.disabled}
                title={`${action.label} (${action.keys.join(' / ')})`}
                className="flex h-10 shrink-0 items-center gap-1.5 rounded-md px-2 text-ui font-medium transition-colors hover:bg-(--bg-tertiary) disabled:pointer-events-none disabled:opacity-35"
                style={{ color: action.emphasis ? 'var(--accent)' : 'var(--text-secondary)' }}
              >
                <span className="hint-fine-only flex items-center gap-0.5">
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
