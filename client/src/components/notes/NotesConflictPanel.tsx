import { useMemo, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { AlertTriangle } from 'lucide-react';
import { conflictHunks } from '@/lib/daily-note-merge';
import type { DailyNote } from '@/types';

interface NotesConflictPanelProps {
  remote: DailyNote | null;
  /** Common ancestor and the editor draft — used to show only what differs (U5). */
  base: string;
  local: string;
  error: string | null;
  onKeepBoth: () => void;
  onUseSavedVersion: () => void;
}

const MAX_HUNKS_SHOWN = 4;

export function NotesConflictPanel({ remote, base, local, error, onKeepBoth, onUseSavedVersion }: NotesConflictPanelProps) {
  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false);
  const remoteBody = remote?.body ?? '';
  const hunks = useMemo(() => conflictHunks(base, local, remoteBody), [base, local, remoteBody]);
  const shown = hunks.slice(0, MAX_HUNKS_SHOWN);

  return (
    <div className="notes-conflict" role="status">
      <p className="notes-conflict-title">
        <AlertTriangle size={13} aria-hidden="true" />
        This note changed in another tab or device
      </p>
      <p className="notes-conflict-detail">
        {hunks.length === 0
          ? remote
            ? 'Both versions touched the same text. Your draft is still in the editor.'
            : 'The saved note was deleted elsewhere. Your draft is still in the editor.'
          : `${hunks.length === 1 ? 'One passage' : `${hunks.length} passages`} changed on both sides. Your draft is still in the editor.`}
      </p>
      {shown.length > 0 ? (
        <div className="notes-conflict-hunks">
          {shown.map((hunk, index) => (
            <div key={index} className="notes-conflict-hunk">
              <div>
                <p className="notes-conflict-side">Yours</p>
                <pre>{hunk.mine.join('\n') || '(removed)'}</pre>
              </div>
              <div>
                <p className="notes-conflict-side">Saved</p>
                <pre>{hunk.theirs.join('\n') || '(removed)'}</pre>
              </div>
            </div>
          ))}
          {hunks.length > shown.length ? (
            <p className="notes-conflict-detail">+{hunks.length - shown.length} more</p>
          ) : null}
        </div>
      ) : null}
      {error ? (
        <p className="mt-2 text-[12px]" style={{ color: 'var(--danger)' }}>
          {error}
        </p>
      ) : null}
      <div className="notes-conflict-actions">
        <button type="button" className="notes-button secondary" onClick={onKeepBoth}>
          Keep both
        </button>
        <button type="button" className="notes-button danger" onClick={() => setDiscardConfirmOpen(true)}>
          Use saved version
        </button>
      </div>

      <Dialog.Root open={discardConfirmOpen} onOpenChange={setDiscardConfirmOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[90]" style={{ background: 'rgba(4, 8, 14, 0.5)' }} />
          <Dialog.Content className="notes-dialog notes-dialog-narrow fixed z-[91] rounded-2xl border p-5">
            <Dialog.Title className="text-[14px] font-semibold" style={{ color: 'var(--text-primary)' }}>
              Discard your draft?
            </Dialog.Title>
            <Dialog.Description className="mt-2 text-[12.5px] leading-5" style={{ color: 'var(--text-secondary)' }}>
              This replaces your unsaved draft with the version saved on the server. This cannot be undone.
            </Dialog.Description>
            <div className="mt-4 flex justify-end gap-2">
              <Dialog.Close asChild>
                <button type="button" className="notes-button secondary">
                  Keep draft
                </button>
              </Dialog.Close>
              <button
                type="button"
                className="notes-button danger"
                onClick={() => {
                  setDiscardConfirmOpen(false);
                  onUseSavedVersion();
                }}
              >
                Use saved version
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
