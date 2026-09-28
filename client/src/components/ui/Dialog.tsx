import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { isCoveredByLaterLayer, useModalFocus } from '@/hooks/useModalFocus';
import { Kbd, KeySpec } from './Kbd';

interface DialogProps {
  title: ReactNode;
  /** One short line of context (a name, a date) — never an explanation. */
  subtitle?: ReactNode;
  /** Optional leading visual in the head (an icon tile). */
  icon?: ReactNode;
  children: ReactNode;
  /** Footer actions; omit when the body owns its own submit row. */
  footer?: ReactNode;
  /** sm 420 · md 480 (default) · lg 560. */
  size?: 'sm' | 'md' | 'lg';
  /** Accessible name when it differs from the visible title. */
  ariaLabel?: string;
  /** Pass false when a parent keyboard layer manages Esc itself. */
  closeOnEscape?: boolean;
  /** Body without padding — for lists and composers that pad themselves. */
  flush?: boolean;
  /** Accessible name of the close button. */
  closeLabel?: string;
  /** Extra content under the title row (e.g. a target switcher). */
  headerExtra?: ReactNode;
  /** Cmd/Ctrl+Enter submits from anywhere in the dialog. */
  onSubmit?: () => void;
  onClose: () => void;
  role?: 'dialog' | 'alertdialog';
}

/**
 * docs/53 D5 → docs/54 V1: the app's one modal shell — Today's dialogs, the
 * header inbox, Capture, Standup layers, status rationale, desk capture.
 * Focus is trapped and restored by `useModalFocus`; the first
 * `[data-autofocus]` element (or the first field) receives focus on open;
 * Esc closes; ⌘↵ submits. Rendered in a portal; a bottom sheet on phones.
 */
export function Dialog({
  title,
  subtitle,
  icon,
  children,
  footer,
  size = 'md',
  ariaLabel,
  closeOnEscape = true,
  flush = false,
  closeLabel = 'Close',
  headerExtra,
  onSubmit,
  onClose,
  role = 'dialog',
}: DialogProps) {
  const ref = useModalFocus<HTMLElement>();
  const titleId = useId();
  const subtitleId = useId();

  useEffect(() => {
    const root = ref.current;
    const target = root?.querySelector<HTMLElement>('[data-autofocus]')
      ?? root?.querySelector<HTMLElement>('textarea, input, select')
      ?? root;
    target?.focus();
  }, [ref]);

  // Esc belongs to the topmost layer wherever focus is (docs/54 V1): a popover
  // inside the dialog, or a layer stacked above it, handles its own Esc first.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    if (!closeOnEscape) return undefined;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (event.target instanceof Element && event.target.closest('[data-popover-layer]')) return;
      if (isCoveredByLaterLayer(ref.current)) return;
      event.preventDefault();
      event.stopPropagation();
      onCloseRef.current();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [closeOnEscape, ref]);

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && onSubmit) {
      event.preventDefault();
      onSubmit();
    }
  };

  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="ui-dialog-layer">
      <button type="button" aria-label="Close dialog" tabIndex={-1} className="ui-dialog-backdrop" onClick={onClose} />
      <section
        ref={ref}
        role={role}
        aria-modal="true"
        aria-labelledby={ariaLabel ? undefined : titleId}
        aria-label={ariaLabel}
        data-size={size}
        aria-describedby={subtitle ? subtitleId : undefined}
        tabIndex={-1}
        className="ui-dialog"
        onKeyDown={handleKeyDown}
      >
        <header className="ui-dialog-head">
          {icon ? <span className="ui-dialog-icon" aria-hidden="true">{icon}</span> : null}
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="ui-dialog-title">{title}</h2>
            {subtitle ? <p id={subtitleId} className="ui-dialog-subtitle">{subtitle}</p> : null}
          </div>
          <button type="button" onClick={onClose} className="ui-icon-btn" aria-label={closeLabel}>
            <X size={15} />
          </button>
        </header>
        {headerExtra ? <div className="ui-dialog-head-extra">{headerExtra}</div> : null}
        <div className={flush ? 'ui-dialog-body ui-dialog-body-flush' : 'ui-dialog-body'}>{children}</div>
        {footer ? <footer className="ui-dialog-foot">{footer}</footer> : null}
      </section>
    </div>,
    document.body,
  );
}

export function DialogError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="ui-error" role="alert">{message}</p>;
}

export function DialogActions({
  saveLabel,
  savingLabel = 'Saving…',
  isSaving,
  canSave,
  onCancel,
  onSave,
  tone,
  submitKey = 'mod-enter',
}: {
  saveLabel: string;
  savingLabel?: string;
  isSaving: boolean;
  canSave: boolean;
  onCancel: () => void;
  onSave: () => void;
  tone?: 'danger';
  /** Which key the form submits on — shown as the footer hint. */
  submitKey?: 'enter' | 'mod-enter';
}) {
  return (
    <>
      <span className="ui-dialog-foot-hint hidden items-center gap-1 sm:inline-flex">
        {submitKey === 'enter' ? <><Kbd variant="subtle">↵</Kbd> save · <Kbd variant="subtle">⇧ ↵</Kbd> newline</> : <KeySpec keys="⌘ ↵" variant="subtle" />}
      </span>
      <button type="button" onClick={onCancel} className="ui-btn-quiet">Cancel</button>
      <button
        type="button"
        onClick={onSave}
        disabled={!canSave || isSaving}
        className={tone === 'danger' ? 'ui-btn-danger-solid' : 'ui-btn-solid'}
      >
        {isSaving ? savingLabel : saveLabel}
      </button>
    </>
  );
}
