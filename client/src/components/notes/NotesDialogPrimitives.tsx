import type { ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Lock, X } from 'lucide-react';
import { FOCUS_RING } from '@/components/tasks/TaskDetailPrimitives';

/**
 * docs/52 F10: one form vocabulary for every "turn into…" dialog on the
 * Notes page — same shell, source label, field layout, and footer.
 */

export const NOTES_INPUT_CLASS = `w-full rounded-lg px-3 py-2 text-[13px] leading-5 ${FOCUS_RING}`;
export const NOTES_INPUT_STYLE = {
  background: 'var(--bg-tertiary)',
  color: 'var(--text-primary)',
  border: '1px solid var(--border)',
} as const;

export function NotesDialogShell({
  open,
  onClose,
  title,
  sourceLabel,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  /** "from Sat, Sep 12 note" — where the text came from. */
  sourceLabel: string;
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={(next) => (!next ? onClose() : undefined)}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[90]" style={{ background: 'rgba(4, 8, 14, 0.5)', backdropFilter: 'blur(4px)' }} />
        <Dialog.Content className="notes-dialog fixed z-[91] rounded-2xl border p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <Dialog.Title className="text-[15px] font-semibold" style={{ color: 'var(--text-primary)' }}>
                {title}
              </Dialog.Title>
              <Dialog.Description className="mt-1 inline-flex items-center gap-1 text-[12px]" style={{ color: 'var(--text-muted)' }}>
                <Lock size={10} aria-hidden="true" />
                {sourceLabel}
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                className={`flex h-7 w-7 items-center justify-center rounded-lg ${FOCUS_RING}`}
                style={{ color: 'var(--text-muted)' }}
                aria-label={`Close ${title.toLowerCase()} dialog`}
              >
                <X size={14} />
              </button>
            </Dialog.Close>
          </div>
          <div className="mt-4 space-y-3">{children}</div>
          <div className="mt-5 flex items-center justify-end gap-2">
            <Dialog.Close asChild>
              <button type="button" className="notes-button secondary">
                Cancel
              </button>
            </Dialog.Close>
            {footer}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function NotesField({
  label,
  htmlFor,
  optional,
  hint,
  children,
}: {
  label: string;
  htmlFor?: string;
  optional?: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  const labelNode = (
    <>
      {label}
      {optional ? <span style={{ color: 'var(--text-muted)' }}> ({optional})</span> : null}
    </>
  );
  return (
    <div>
      {htmlFor ? (
        <label htmlFor={htmlFor} className="mb-1 block text-[12px] font-medium" style={{ color: 'var(--text-secondary)' }}>
          {labelNode}
        </label>
      ) : (
        <span className="mb-1 block text-[12px] font-medium" style={{ color: 'var(--text-secondary)' }}>
          {labelNode}
        </span>
      )}
      {children}
      {hint ? (
        <p className="mt-1 text-[11px]" style={{ color: 'var(--text-muted)' }}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function NotesFormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p className="text-[12px]" style={{ color: 'var(--danger)' }} role="alert">
      {message}
    </p>
  );
}

export function NotesSubmitButton({ onClick, disabled, children }: { onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className="notes-button primary">
      {children}
    </button>
  );
}

export function noteSourceLabel(prettyDate: string): string {
  return `from ${prettyDate} note`;
}
