import { useEffect, useId, type KeyboardEvent, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { useModalFocus } from '@/hooks/useModalFocus';
import './today.css';

interface TodayDialogProps {
  title: string;
  /** One short line of context (a name, a date) — never an explanation. */
  subtitle?: string;
  children: ReactNode;
  footer: ReactNode;
  /** Cmd/Ctrl+Enter submits from anywhere in the dialog. */
  onSubmit?: () => void;
  onClose: () => void;
  role?: 'dialog' | 'alertdialog';
}

/**
 * docs/53 D5: the one modal shell behind every Today dialog (check-in,
 * capture, confirm) — also used by the header inbox. Focus is trapped and
 * restored by `useModalFocus`; the first `[data-autofocus]` element (or the
 * first field) receives focus on open. Bottom sheet on phones.
 */
export function TodayDialog({ title, subtitle, children, footer, onSubmit, onClose, role = 'dialog' }: TodayDialogProps) {
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

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && onSubmit) {
      event.preventDefault();
      onSubmit();
    }
  };

  return (
    <div className="today-dialog-layer">
      <button type="button" aria-label="Close dialog" tabIndex={-1} className="today-dialog-backdrop" onClick={onClose} />
      <section
        ref={ref}
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={subtitle ? subtitleId : undefined}
        tabIndex={-1}
        className="today-dialog"
        onKeyDown={handleKeyDown}
      >
        <header className="today-dialog-head">
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="today-dialog-title">{title}</h2>
            {subtitle ? <p id={subtitleId} className="today-dialog-subtitle">{subtitle}</p> : null}
          </div>
          <button type="button" onClick={onClose} className="today-icon-btn" aria-label="Close">
            <X size={15} />
          </button>
        </header>
        <div className="today-dialog-body">{children}</div>
        <footer className="today-dialog-foot">{footer}</footer>
      </section>
    </div>
  );
}

export function TodayDialogError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="today-error" role="alert">{message}</p>;
}

export function TodayDialogActions({
  saveLabel,
  savingLabel = 'Saving…',
  isSaving,
  canSave,
  onCancel,
  onSave,
  tone,
}: {
  saveLabel: string;
  savingLabel?: string;
  isSaving: boolean;
  canSave: boolean;
  onCancel: () => void;
  onSave: () => void;
  tone?: 'danger';
}) {
  return (
    <>
      <span className="today-dialog-foot-hint hidden sm:inline">
        <kbd className="today-kbd">⌘</kbd> <kbd className="today-kbd">↵</kbd>
      </span>
      <button type="button" onClick={onCancel} className="today-btn today-btn-quiet">Cancel</button>
      <button
        type="button"
        onClick={onSave}
        disabled={!canSave || isSaving}
        className="today-btn today-btn-primary"
        style={tone === 'danger' ? { background: 'var(--danger)' } : undefined}
      >
        {isSaving ? savingLabel : saveLabel}
      </button>
    </>
  );
}
