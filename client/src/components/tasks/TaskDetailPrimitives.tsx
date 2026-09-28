import { forwardRef, useEffect, useId, useRef, useState, type ReactNode, type RefObject } from 'react';
import { CalendarX, ChevronDown, CornerDownLeft } from 'lucide-react';
import { MenuDivider, MenuItem, TaskPopover } from '@/components/ui/Popover';
import { toneColor, type DateDisplay } from './task-detail-format';
// docs/54 §2: generic primitives live in components/ui; re-exported here so
// task-detail code keeps one import site.
export { FOCUS_RING, isEditable } from '@/components/ui/focus';
export { SectionHeader } from '@/components/ui/SectionHeader';
export { IconButton } from '@/components/ui/IconButton';
export { ShortcutLegend } from '@/components/ui/ShortcutSheet';
import { FOCUS_RING, isEditable } from '@/components/ui/focus';

/**
 * Building blocks for the task detail surface (drawer + full page). Visual
 * language: sentence-case labels, ghost controls that reveal affordance on
 * hover/focus, one accent, and tone colors reserved for state.
 */

export function PropertyRow({ icon, label, children, align = 'center' }: {
  icon: ReactNode;
  label: string;
  children: ReactNode;
  align?: 'center' | 'start';
}) {
  return (
    <div
      className={`grid grid-cols-[minmax(96px,34%)_minmax(0,1fr)] gap-2 ${align === 'start' ? 'items-start' : 'items-center'} min-h-[36px]`}
    >
      <dt
        className={`flex items-center gap-2 text-[12.5px] font-medium ${align === 'start' ? 'pt-[9px]' : ''}`}
        style={{ color: 'var(--text-muted)' }}
      >
        <span className="flex w-4 shrink-0 justify-center opacity-80">{icon}</span>
        <span className="truncate">{label}</span>
      </dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

interface PropertyButtonProps {
  children: ReactNode;
  onClick?: (anchor: HTMLButtonElement) => void;
  disabled?: boolean;
  ariaLabel: string;
  title?: string;
  expanded?: boolean;
  shortcut?: string;
  popup?: 'menu' | 'dialog';
}

/** Ghost value control — reads as text, behaves as a button. */
export const PropertyButton = forwardRef<HTMLButtonElement, PropertyButtonProps>(function PropertyButton(
  { children, onClick, disabled = false, ariaLabel, title, expanded, shortcut, popup = 'dialog' },
  ref,
) {
  if (disabled) {
    return (
      <span className="flex min-h-[32px] min-w-0 items-center gap-2 px-2 text-[13px]" style={{ color: 'var(--text-secondary)' }}>
        {children}
      </span>
    );
  }
  return (
    <button
      ref={ref}
      type="button"
      onClick={(event) => onClick?.(event.currentTarget)}
      aria-label={ariaLabel}
      aria-haspopup={popup}
      aria-expanded={expanded}
      title={title}
      data-task-shortcut={shortcut}
      className={`group/prop flex min-h-[32px] w-full min-w-0 items-center gap-2 rounded-lg px-2 text-left text-[13px] transition-colors hover:bg-[var(--bg-tertiary)] ${FOCUS_RING}`}
      style={{ color: 'var(--text-primary)', background: expanded ? 'var(--bg-tertiary)' : undefined }}
    >
      <span className="flex min-w-0 flex-1 items-center gap-2">{children}</span>
      <ChevronDown
        size={13}
        className="shrink-0 opacity-0 transition-opacity group-hover/prop:opacity-60 group-focus-visible/prop:opacity-60"
        style={{ color: 'var(--text-muted)' }}
      />
    </button>
  );
});

export function Placeholder({ children }: { children: ReactNode }) {
  return <span className="truncate" style={{ color: 'var(--text-placeholder)' }}>{children}</span>;
}

export function DateValue({ display, empty }: { display: DateDisplay | null; empty: string }) {
  if (!display) return <Placeholder>{empty}</Placeholder>;
  return (
    <span className="flex min-w-0 items-baseline gap-1.5">
      <span className="truncate font-medium" style={{ color: toneColor(display.tone) }}>{display.label}</span>
      {display.hint && (
        <span className="shrink-0 text-[12px] font-medium" style={{ color: toneColor(display.tone), opacity: 0.8 }}>
          {display.hint}
        </span>
      )}
    </span>
  );
}

export { Avatar } from '@/components/ui/Avatar';

export interface DatePreset {
  key: string;
  label: string;
  hint?: string;
  icon: ReactNode;
  checked?: boolean;
  onSelect: () => void;
}

/**
 * Anchored date/datetime picker: one-tap presets first (the common case),
 * then an exact value that only commits on Apply/Enter — native date inputs
 * fire `change` mid-typing, so committing on change would PATCH garbage.
 */
export function DatePickerPopover({ anchor, label, kind, value, presets, onCommit, onClose, clearLabel = 'Clear', onAccelerator }: {
  anchor: HTMLElement;
  label: string;
  kind: 'date' | 'datetime-local';
  /** Current value in the input's own format. */
  value: string;
  presets: DatePreset[];
  onCommit: (value: string | null) => void;
  onClose: () => void;
  clearLabel?: string | null;
  /** Single-key preset shortcuts; return true when handled. */
  onAccelerator?: (key: string) => boolean;
}) {
  const inputId = useId();
  const [draft, setDraft] = useState(value);
  useEffect(() => { setDraft(value); }, [value]);
  const canApply = Boolean(draft) && draft !== value;
  const showMenu = presets.length > 0 || Boolean(value && clearLabel);

  return (
    <TaskPopover anchor={anchor} onClose={onClose} label={label} width={248} role="dialog" onAccelerator={onAccelerator}>
      {showMenu && (
      <div role="menu" aria-label={`${label} presets`}>
        {presets.map((preset) => (
          <MenuItem
            key={preset.key}
            role={preset.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
            checked={preset.checked}
            icon={preset.icon}
            label={preset.label}
            hint={preset.hint}
            onSelect={preset.onSelect}
          />
        ))}
        {value && clearLabel && (
          <MenuItem icon={<CalendarX size={13} />} label={clearLabel} onSelect={() => onCommit(null)} />
        )}
      </div>
      )}
      {showMenu && <MenuDivider />}
      <form
        className="px-1.5 pb-1 pt-1"
        onSubmit={(event) => {
          event.preventDefault();
          if (canApply) onCommit(draft);
        }}
      >
        <label htmlFor={inputId} className="mb-1 block text-[12px] font-medium" style={{ color: 'var(--text-muted)' }}>
          {kind === 'date' ? 'Pick a date' : 'Pick a date & time'}
        </label>
        <div className="flex items-center gap-1.5">
          <input
            id={inputId}
            type={kind}
            data-autofocus={showMenu ? undefined : ''}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            className={`min-w-0 flex-1 rounded-lg px-2 py-1.5 text-[12.5px] tabular-nums ${FOCUS_RING}`}
            style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
          />
          <button
            type="submit"
            disabled={!canApply}
            className={`flex h-[30px] items-center gap-1 rounded-lg px-2 text-[12px] font-semibold transition-opacity disabled:opacity-40 ${FOCUS_RING}`}
            style={{ background: 'var(--accent-glow)', color: 'var(--accent)' }}
            aria-label={`Apply ${label.toLowerCase()}`}
          >
            <CornerDownLeft size={12} />
            Set
          </button>
        </div>
      </form>
    </TaskPopover>
  );
}

/** Borderless text that commits on blur/Enter and reverts on Escape. */
export function InlineTextField({ value, placeholder, onCommit, ariaLabel, multiline = false, disabled = false, className = '' }: {
  value: string;
  placeholder: string;
  onCommit: (value: string) => void;
  ariaLabel: string;
  multiline?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  const [local, setLocal] = useState(value);
  const reverting = useRef(false);
  useEffect(() => { setLocal(value); }, [value]);

  if (disabled) {
    return (
      <span className={`block whitespace-pre-wrap px-2 py-1.5 text-[13px] ${className}`} style={{ color: value ? 'var(--text-secondary)' : 'var(--text-placeholder)' }}>
        {value || '—'}
      </span>
    );
  }

  const commit = () => {
    if (reverting.current) {
      reverting.current = false;
      return;
    }
    const next = local.trim();
    if (next !== value.trim()) onCommit(next);
  };
  const shared = {
    value: local,
    placeholder,
    'aria-label': ariaLabel,
    onBlur: commit,
    className: `w-full rounded-lg bg-transparent px-2 py-1.5 text-[13px] transition-colors placeholder:text-[var(--text-placeholder)] hover:bg-[var(--bg-tertiary)] focus:bg-[var(--bg-tertiary)] ${FOCUS_RING} ${className}`,
    style: { color: 'var(--text-primary)' },
  };

  if (multiline) {
    return (
      <textarea
        {...shared}
        rows={Math.min(8, Math.max(2, local.split('\n').length))}
        onChange={(event) => setLocal(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) (event.target as HTMLTextAreaElement).blur();
          if (event.key === 'Escape') {
            event.stopPropagation();
            reverting.current = true;
            setLocal(value);
            (event.target as HTMLTextAreaElement).blur();
          }
        }}
        className={`${shared.className} resize-none leading-5`}
      />
    );
  }
  return (
    <input
      {...shared}
      type="text"
      onChange={(event) => setLocal(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
        if (event.key === 'Escape') {
          event.stopPropagation();
          reverting.current = true;
          setLocal(value);
          (event.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}



// ── Keyboard ────────────────────────────────────────────────────────

/**
 * Single-key shortcuts scoped to a detail surface. A key maps to the element
 * marked `data-task-shortcut="<key>"` inside `rootRef` (clicked, or its input
 * focused) unless `custom` handles it. Inactive while typing, with modifiers,
 * or when another modal layer sits above this one.
 */
export function useTaskShortcuts(rootRef: RefObject<HTMLElement>, enabled: boolean, custom: Record<string, () => void>) {
  const customRef = useRef(custom);
  customRef.current = custom;

  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || event.key.length !== 1) return;
      const root = rootRef.current;
      if (!root) return;
      const active = document.activeElement;
      if (active && isEditable(active)) return;
      if (!(active && root.contains(active))) {
        const ownDialog = root.closest('[role="dialog"]');
        if (ownDialog) {
          // Drawer: live while focus is anywhere in this dialog (incl. its container).
          if (active !== ownDialog) return;
        } else if ((active && active !== document.body) || document.querySelector('[aria-modal="true"]')) {
          // Page: live from the page body, never under a modal layer.
          return;
        }
      }
      // docs/54 K1: Shift variants bind as "shift+<key>" (e.g. ⇧S for status).
      const key = `${event.shiftKey ? 'shift+' : ''}${event.key.toLowerCase()}`;
      const handler = customRef.current[key];
      const target = handler ? null : root.querySelector<HTMLElement>(`[data-task-shortcut="${key}"]`);
      if (!handler && !target) return;
      event.preventDefault();
      event.stopPropagation();
      if (handler) {
        handler();
        return;
      }
      const field = target && (isEditable(target) ? target : target.querySelector<HTMLElement>('input, textarea'));
      if (field) field.focus();
      else target?.click();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [enabled, rootRef]);
}
