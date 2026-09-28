import type { ReactNode } from 'react';
import { MenuHeading, TaskPopover } from '@/components/ui/Popover';
import { KeySpec } from './Kbd';

export interface ShortcutGroup {
  /** Optional group label ("Navigate", "Task"); omit for a single flat list. */
  group?: string;
  /** [key spec, what it does] — keys are written as they are pressed (lowercase). */
  keys: Array<[string, string]>;
}

/**
 * docs/54 K2: every surface's keyboard map reads the same — grouped, key on
 * the left, lowercase caps. `ShortcutList` is the body; `ShortcutSheet` is
 * the standard presentation, anchored to the surface's keyboard button.
 */
export function ShortcutList({ groups, footnote }: { groups: ShortcutGroup[]; footnote?: ReactNode }) {
  return (
    <div className="space-y-2">
      {groups.map(({ group, keys }, index) => (
        <div key={group ?? index}>
          {group ? <MenuHeading>{group}</MenuHeading> : null}
          <dl className="space-y-1 px-2">
            {keys.map(([spec, label]) => (
              <div key={`${spec}-${label}`} className="grid grid-cols-[minmax(72px,auto)_minmax(0,1fr)] items-center gap-3">
                <dt><KeySpec keys={spec} /></dt>
                <dd className="text-[12px] leading-5" style={{ color: 'var(--text-secondary)' }}>{label}</dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
      {footnote ? (
        <p className="px-2 pt-1 text-[12px]" style={{ color: 'var(--text-muted)' }}>{footnote}</p>
      ) : null}
    </div>
  );
}

export function ShortcutSheet({ anchor, groups, footnote, onClose, width = 300 }: {
  anchor: HTMLElement | null;
  groups: ShortcutGroup[];
  footnote?: ReactNode;
  onClose: () => void;
  width?: number;
}) {
  return (
    <TaskPopover anchor={anchor} role="dialog" label="Keyboard shortcuts" width={width} onClose={onClose}>
      {/* Focus lands in the sheet so Esc and Tab belong to it. */}
      <div className="px-1 pb-1.5 pt-1 outline-none" tabIndex={-1} data-autofocus="">
        <p className="px-2 pb-1.5 text-[12px] font-semibold" style={{ color: 'var(--text-primary)' }}>Keyboard shortcuts</p>
        <ShortcutList groups={groups} footnote={footnote} />
      </div>
    </TaskPopover>
  );
}

/** Inline key legend for drawers — the same caps as every sheet, keys as pressed (lowercase). */
export function ShortcutLegend({ hints, className = '' }: { hints: [string, string][]; className?: string }) {
  return (
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] ${className}`} style={{ color: 'var(--text-muted)' }} aria-hidden="true">
      {hints.map(([key, label]) => (
        <span key={key} className="inline-flex items-center gap-1">
          <KeySpec keys={key} variant="subtle" />
          {label}
        </span>
      ))}
    </div>
  );
}
