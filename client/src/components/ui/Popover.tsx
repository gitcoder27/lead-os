import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Check, Minus } from 'lucide-react';
import { Kbd } from './Kbd';

const POPOVER_FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

/**
 * docs/49 §6/§12, docs/54 V4: the app's one anchored popover/menu —
 * used by Tasks, Today, Notes, the Team drawer and every shortcut sheet.
 * A small anchored popover rendered in a portal (so rows near
 * the bottom of the scrolling list are never clipped). Arrow keys move
 * between menu items, Esc closes and restores focus to where it came from,
 * and `onAccelerator` lets menus bind single-letter shortcuts.
 */
export function TaskPopover({
  anchor,
  onClose,
  label,
  children,
  width = 224,
  onAccelerator,
  role = 'menu',
}: {
  anchor: HTMLElement | null;
  onClose: () => void;
  label: string;
  children: ReactNode;
  width?: number;
  /** Return true when the key was handled. */
  onAccelerator?: (key: string) => boolean;
  role?: 'menu' | 'dialog';
}) {
  const ref = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (!anchor) return;
    returnFocus.current = (document.activeElement as HTMLElement | null) ?? null;
    const place = () => {
      const rect = anchor.getBoundingClientRect();
      const height = ref.current?.offsetHeight ?? 0;
      const below = rect.bottom + 4;
      const top = below + height > window.innerHeight - 8 && rect.top - height - 4 > 8 ? rect.top - height - 4 : below;
      const left = Math.min(Math.max(8, rect.right - width), window.innerWidth - width - 8);
      setPosition({ top, left });
    };
    place();
    // Re-place once the content has measured its height.
    const frame = requestAnimationFrame(place);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [anchor, width]);

  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('[data-autofocus], [role^="menuitem"]')?.focus();
  }, []);

  // docs/51 A5: every close path restores focus — Esc, Tab, item select and
  // outside click alike. `closeRef` keeps the latest onClose without
  // re-binding the mousedown listener every render.
  const closeRef = useRef<() => void>(() => {});
  closeRef.current = () => {
    onClose();
    const target = returnFocus.current;
    if (target && document.contains(target)) requestAnimationFrame(() => target.focus());
  };
  const close = () => closeRef.current();

  useEffect(() => {
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (ref.current?.contains(target) || anchor?.contains(target)) return;
      closeRef.current();
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [anchor]);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = [...(ref.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]:not([aria-disabled="true"])') ?? [])];
    const index = items.indexOf(document.activeElement as HTMLElement);
    const target = event.target as HTMLElement;
    const inInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA';
    // Native date/time inputs use the arrow keys to step their segments.
    const steppingInput = target instanceof HTMLInputElement && /^(date|datetime-local|time|number)$/.test(target.type);
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
    } else if (steppingInput && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      // Leave the arrow to the input.
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      items[(index + 1) % items.length]?.focus();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      items[(index - 1 + items.length) % items.length]?.focus();
    } else if (event.key === 'Tab') {
      if (role === 'menu') {
        close();
      } else {
        // Dialog popovers (date pickers) keep Tab inside themselves.
        const focusables = [...(ref.current?.querySelectorAll<HTMLElement>(POPOVER_FOCUSABLE) ?? [])];
        const at = focusables.indexOf(document.activeElement as HTMLElement);
        event.preventDefault();
        const next = event.shiftKey ? (at <= 0 ? focusables.length - 1 : at - 1) : (at + 1) % focusables.length;
        focusables[next]?.focus();
      }
    } else if (!inInput && !event.metaKey && !event.ctrlKey && !event.altKey && onAccelerator?.(event.key)) {
      event.preventDefault();
    }
    event.stopPropagation();
  };

  if (!anchor) return null;
  return createPortal(
    <div
      ref={ref}
      role={role}
      aria-label={label}
      data-popover-layer=""
      onKeyDown={handleKeyDown}
      className="fixed z-popover max-h-[360px] overflow-y-auto rounded-xl p-1"
      style={{
        top: position?.top ?? -9999,
        left: position?.left ?? -9999,
        width,
        background: 'var(--bg-elevated)',
        border: '1px solid var(--border)',
        boxShadow: 'var(--panel-shadow)',
      }}
    >
      {children}
    </div>,
    document.body,
  );
}

export function MenuItem({
  icon,
  label,
  hint,
  onSelect,
  checked,
  role = 'menuitem',
  tone,
  disabled,
}: {
  icon?: ReactNode;
  label: ReactNode;
  hint?: string;
  onSelect: () => void;
  checked?: boolean | 'mixed';
  role?: 'menuitem' | 'menuitemradio' | 'menuitemcheckbox';
  tone?: 'danger';
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role={role}
      aria-checked={role === 'menuitem' ? undefined : checked === 'mixed' ? 'mixed' : Boolean(checked)}
      aria-disabled={disabled || undefined}
      disabled={disabled}
      onClick={onSelect}
      className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12.5px] outline-none transition-colors hover:bg-[var(--bg-tertiary)] focus-visible:bg-[var(--bg-tertiary)] disabled:opacity-40"
      style={{ color: tone === 'danger' ? 'var(--danger)' : 'var(--text-secondary)' }}
    >
      {role !== 'menuitem' && (
        <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center" style={{ color: 'var(--accent)' }}>
          {checked === 'mixed' ? <Minus size={12} /> : checked ? <Check size={12} /> : null}
        </span>
      )}
      {icon && <span className="flex shrink-0 items-center" style={{ color: 'var(--text-muted)' }}>{icon}</span>}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {hint && <Kbd variant="subtle">{hint}</Kbd>}
    </button>
  );
}

export function MenuDivider() {
  return <div className="my-1 h-px" style={{ background: 'var(--border)' }} role="separator" />;
}

export function MenuHeading({ children }: { children: ReactNode }) {
  return (
    <p className="px-2 pb-1 pt-1.5 text-[11px] font-bold uppercase tracking-[0.12em]" style={{ color: 'var(--text-muted)' }}>
      {children}
    </p>
  );
}

/** Neutral name for the shared popover (docs/54). */
export { TaskPopover as Popover };
