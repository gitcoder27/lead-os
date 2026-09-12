import { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import type { DailyNote } from '@/types';

interface NotesConflictPanelProps {
  remote: DailyNote | null;
  error: string | null;
  onKeepBoth: () => void;
  onUseSavedVersion: () => void;
}

export function NotesConflictPanel({ remote, error, onKeepBoth, onUseSavedVersion }: NotesConflictPanelProps) {
  const [savedVersionOpen, setSavedVersionOpen] = useState(false);
  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false);

  return (
    <div className="notes-conflict" role="alert">
      <p className="notes-conflict-title">This note changed elsewhere</p>
      <p className="notes-conflict-detail">
        Your draft is still in the editor. Review the saved version and choose how to continue.
      </p>
      <button
        type="button"
        className="notes-followup-open mt-2"
        onClick={() => setSavedVersionOpen((open) => !open)}
        aria-expanded={savedVersionOpen}
      >
        {savedVersionOpen ? 'Hide saved version' : 'Saved version'}
      </button>
      {savedVersionOpen ? (
        <div className="notes-conflict-saved">{remote?.body || '(no saved version found)'}</div>
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
        <button
          type="button"
          className="notes-button danger"
          onClick={() => setDiscardConfirmOpen(true)}
        >
          Use saved version
        </button>
      </div>

      <Dialog.Root open={discardConfirmOpen} onOpenChange={setDiscardConfirmOpen}>
        <Dialog.Portal>
          <Dialog.Overlay
            className="fixed inset-0 z-[90]"
            style={{ background: 'rgba(4, 8, 14, 0.5)' }}
          />
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
