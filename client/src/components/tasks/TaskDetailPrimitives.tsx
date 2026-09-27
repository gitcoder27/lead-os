import { forwardRef, useEffect, useId, useRef, useState, type ReactNode, type RefObject } from 'react';
import { CalendarX, ChevronDown, CornerDownLeft } from 'lucide-react';
import { MenuDivider, MenuItem, TaskPopover } from './TaskPopover';
import { avatarHue, initials, toneColor, type DateDisplay } from './task-detail-format';

/**
 * Building blocks for the task detail surface (drawer + full page). Visual
 * language: sentence-case labels, ghost controls that reveal affordance on
 * hover/focus, one accent, and tone colors reserved for state.
 */

export const FOCUS_RING = 'outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-active)]';

export function SectionHeader({ icon, title, count, hint, action, id, as: Heading = 'h3' }: {
  icon?: ReactNode;
  title: string;
  count?: ReactNode;
  /** Quiet qualifier after the count, e.g. "Private". */
  hint?: ReactNode;
  action?: ReactNode;
  id?: string;
  /** Heading level — pages that own their outline use h2. */
  as?: 'h2' | 'h3';
}) {
  return (
    <div className="flex min-h-[28px] items-center gap-2">
      {icon && <span className="flex items-center" style={{ color: 'var(--text-muted)' }}>{icon}</span>}
      <Heading id={id} className="text-[13px] font-semibold tracking-[-0.005em]" style={{ color: 'var(--text-primary)' }}>
        {title}
      </Heading>
      {count !== undefined && count !== null && (
        <span
          className="rounded-full px-1.5 text-[11px] font-semibold tabular-nums leading-[18px]"
          style={{ background: 'var(--bg-tertiary)', color: 'var(--text-muted)' }}
        >
          {count}
        </span>
      )}
      {hint && <span className="text-[11.5px]" style={{ color: 'var(--text-muted)' }}>{hint}</span>}
      {action && <div className="ml-auto flex items-center gap-1">{action}</div>}
    </div>
  );
}

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
        <span className="shrink-0 text-[11.5px] font-medium" style={{ color: toneColor(display.tone), opacity: 0.8 }}>
          {display.hint}
        </span>
      )}
    </span>
  );
}

export function Avatar({ name, seed, size = 20, muted = false }: { name: string; seed?: string; size?: number; muted?: boolean }) {
  const hue = avatarHue(seed ?? name);
  return (
    <span
      aria-hidden="true"
      className="inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold"
      style={{
        width: size,
        height: size,
        fontSize: Math.max(9, Math.round(size * 0.42)),
        background: muted ? 'var(--bg-tertiary)' : `hsl(${hue} 70% 50% / 0.18)`,
        color: muted ? 'var(--text-muted)' : `hsl(${hue} 75% 62%)`,
        border: `1px solid ${muted ? 'var(--border)' : `hsl(${hue} 70% 55% / 0.35)`}`,
      }}
    >
      {initials(name)}
    </span>
  );
}

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
        <label htmlFor={inputId} className="mb-1 block text-[11px] font-medium" style={{ color: 'var(--text-muted)' }}>
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

/** Square ghost icon control for drawer toolbars. */
export function IconButton({ label, hint, onClick, children, expanded, tone, popup }: {
  label: string;
  hint?: string;
  onClick: (anchor: HTMLButtonElement) => void;
  children: ReactNode;
  expanded?: boolean;
  tone?: 'danger';
  popup?: 'menu' | 'dialog';
}) {
  return (
    <button
      type="button"
      onClick={(event) => onClick(event.currentTarget)}
      className={`flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-[var(--bg-tertiary)] ${FOCUS_RING}`}
      style={{ color: tone === 'danger' ? 'var(--danger)' : 'var(--text-secondary)', background: expanded ? 'var(--bg-tertiary)' : undefined }}
      title={hint ? `${label} (${hint})` : label}
      aria-label={label}
      aria-haspopup={popup}
      aria-expanded={expanded}
    >
      {children}
    </button>
  );
}

export function ShortcutLegend({ hints, className = '' }: { hints: [string, string][]; className?: string }) {
  return (
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] ${className}`} style={{ color: 'var(--text-muted)' }} aria-hidden="true">
      {hints.map(([key, label]) => (
        <span key={key} className="inline-flex items-center gap-1">
          <kbd className="rounded px-1 font-mono text-[10px] leading-4" style={{ border: '1px solid var(--border)', background: 'var(--bg-primary)', color: 'var(--text-secondary)' }}>
            {key}
          </kbd>
          {label}
        </span>
      ))}
    </div>
  );
}

// ── Keyboard ────────────────────────────────────────────────────────

export function isEditable(el: Element): boolean {
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (el as HTMLElement).isContentEditable;
}

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
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || event.key.length !== 1) return;
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
      const key = event.key.toLowerCase();
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
