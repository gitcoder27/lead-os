import { useEffect, useId, useRef, type KeyboardEvent } from 'react';
import { AlertTriangle, X } from 'lucide-react';

interface TodayConfirmDialogProps {
  title: string;
  description: string;
  confirmLabel: string;
  isSaving: boolean;
  /** docs/53 F9: surfaced inline when the mutation fails. */
  errorMessage?: string;
  onClose: () => void;
  onConfirm: () => void;
}

export function TodayConfirmDialog({
  title,
  description,
  confirmLabel,
  isSaving,
  errorMessage,
  onClose,
  onConfirm,
}: TodayConfirmDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLElement | null>(null);
  const confirmButtonRef = useRef<HTMLButtonElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    confirmButtonRef.current?.focus();

    return () => {
      previousFocusRef.current?.focus();
    };
  }, []);

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }

    if (event.key !== 'Tab' || !dialogRef.current) {
      return;
    }

    const focusable = getFocusableElements(dialogRef.current);
    if (focusable.length === 0) {
      return;
    }

    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="fixed inset-0 z-[710] flex items-center justify-center px-4">
      <button
        type="button"
        aria-label="Close confirmation dialog"
        className="absolute inset-0 cursor-default"
        style={{ background: 'rgba(0, 0, 0, 0.48)', backdropFilter: 'blur(2px)' }}
        onClick={onClose}
      />
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className="relative w-full max-w-[420px] overflow-hidden rounded-xl border"
        style={{
          background: 'linear-gradient(180deg, var(--bg-secondary) 0%, var(--bg-primary) 100%)',
          borderColor: 'var(--border-strong)',
          boxShadow: '0 24px 80px rgba(0, 0, 0, 0.36)',
        }}
        onKeyDown={handleKeyDown}
      >
        <div className="flex items-start justify-between gap-3 border-b px-4 py-3" style={{ borderColor: 'var(--border)' }}>
          <div className="flex min-w-0 items-start gap-3">
            <span
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
              style={{
                background: 'color-mix(in srgb, var(--warning) 12%, transparent)',
                color: 'var(--warning)',
                border: '1px solid color-mix(in srgb, var(--warning) 24%, var(--border))',
              }}
            >
              <AlertTriangle size={16} />
            </span>
            <div className="min-w-0">
              <h2 id={titleId} className="truncate text-[15px] font-semibold" style={{ color: 'var(--text-primary)' }}>
                {title}
              </h2>
              <p id={descriptionId} className="mt-1 text-[12px] leading-5" style={{ color: 'var(--text-muted)' }}>
                {description}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors hover:bg-[var(--bg-tertiary)]"
            aria-label="Close"
          >
            <X size={15} style={{ color: 'var(--text-secondary)' }} />
          </button>
        </div>

        {errorMessage ? (
          <div className="border-t px-4 py-2.5" style={{ borderColor: 'var(--border)' }}>
            <p className="text-[12px] font-medium" style={{ color: 'var(--danger)' }} role="alert">
              {errorMessage}
            </p>
          </div>
        ) : null}

        <div className="flex items-center justify-end gap-2 border-t px-4 py-3" style={{ borderColor: 'var(--border)' }}>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3 py-1.5 text-[12px] font-medium transition-colors hover:bg-[var(--bg-tertiary)]"
            style={{ color: 'var(--text-secondary)' }}
          >
            Cancel
          </button>
          <button
            ref={confirmButtonRef}
            type="button"
            onClick={onConfirm}
            disabled={isSaving}
            className="rounded-lg px-3 py-1.5 text-[12px] font-semibold transition-opacity disabled:opacity-45"
            style={{ background: 'var(--warning)', color: '#111827' }}
          >
            {isSaving ? 'Working' : confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}

function getFocusableElements(root: HTMLElement): HTMLElement[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  );
}
