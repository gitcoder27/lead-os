import { useEffect, useMemo, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { addDays, format, parseISO } from 'date-fns';
import { CalendarClock, X } from 'lucide-react';
import { useToast } from '@/context/ToastContext';
import { useCreateDailyNoteFollowUp } from '@/hooks/useDailyNotes';
import { getLocalIsoDate } from '@/lib/utils';
import type { CreateDailyNoteFollowUpPayload } from '@/types';

interface NotesFollowUpDialogProps {
  open: boolean;
  noteDate: string;
  selectedText: string;
  onClose: () => void;
}

const TITLE_MAX = 500;

function defaultFollowUpValue(): string {
  const tomorrow = addDays(new Date(), 1);
  return format(tomorrow, "yyyy-MM-dd'T'09:00");
}

export function NotesFollowUpDialog({ open, noteDate, selectedText, onClose }: NotesFollowUpDialogProps) {
  const { addToast } = useToast();
  const createFollowUp = useCreateDailyNoteFollowUp(noteDate);
  const [title, setTitle] = useState('');
  const [followUpAt, setFollowUpAt] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const requestKeyRef = useRef<{ key: string; id: string; date: string } | null>(null);

  const sourceLabel = useMemo(() => {
    try {
      return format(parseISO(noteDate), 'EEE, MMM d');
    } catch {
      return noteDate;
    }
  }, [noteDate]);

  useEffect(() => {
    if (!open) {
      return;
    }
    setTitle(selectedText.trim().slice(0, TITLE_MAX));
    setFollowUpAt(defaultFollowUpValue());
    setFormError(null);
    requestKeyRef.current = null;
  }, [open, selectedText]);

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      onClose();
    }
  };

  const handleSubmit = () => {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setFormError('Add a title for the follow-up.');
      return;
    }
    if (!followUpAt) {
      setFormError('Choose when to follow up.');
      return;
    }
    const parsed = new Date(followUpAt);
    if (Number.isNaN(parsed.getTime())) {
      setFormError('That follow-up time is not valid.');
      return;
    }
    if (createFollowUp.isPending) {
      return;
    }

    const followUpAtIso = parsed.toISOString();
    const key = JSON.stringify([noteDate, trimmedTitle, followUpAtIso]);
    if (!requestKeyRef.current || requestKeyRef.current.key !== key) {
      requestKeyRef.current = { key, id: crypto.randomUUID(), date: getLocalIsoDate() };
    }

    const payload: CreateDailyNoteFollowUpPayload = {
      date: requestKeyRef.current.date,
      title: trimmedTitle,
      followUpAt: followUpAtIso,
      requestId: requestKeyRef.current.id,
    };

    createFollowUp.mutate(payload, {
      onSuccess: () => {
        addToast('Follow-up created', 'success');
        requestKeyRef.current = null;
        onClose();
      },
      onError: (error) => {
        setFormError(error.message);
      },
    });
  };

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay
          className="fixed inset-0 z-[90]"
          style={{ background: 'rgba(4, 8, 14, 0.5)', backdropFilter: 'blur(4px)' }}
        />
        <Dialog.Content className="notes-dialog fixed z-[91] rounded-2xl border p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <Dialog.Title className="text-[15px] font-semibold" style={{ color: 'var(--text-primary)' }}>
                Create follow-up
              </Dialog.Title>
              <Dialog.Description className="mt-1 text-[12px]" style={{ color: 'var(--text-muted)' }}>
                Adds a Manager Desk follow-up sourced from your {sourceLabel} note.
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                className="flex h-7 w-7 items-center justify-center rounded-lg"
                style={{ color: 'var(--text-muted)' }}
                aria-label="Close follow-up dialog"
              >
                <X size={14} />
              </button>
            </Dialog.Close>
          </div>

          <div className="mt-4 space-y-3">
            <div>
              <label htmlFor="note-followup-title" className="mb-1 block text-[12px] font-medium" style={{ color: 'var(--text-secondary)' }}>
                Title
              </label>
              <input
                id="note-followup-title"
                type="text"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                maxLength={TITLE_MAX}
                placeholder="What should you come back to?"
                className="w-full rounded-lg px-3 py-2 text-[13px] outline-none"
                style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
              />
            </div>
            <div>
              <label htmlFor="note-followup-at" className="mb-1 block text-[12px] font-medium" style={{ color: 'var(--text-secondary)' }}>
                Follow up on
              </label>
              <input
                id="note-followup-at"
                type="datetime-local"
                required
                value={followUpAt}
                onChange={(event) => setFollowUpAt(event.target.value)}
                className="w-full rounded-lg px-3 py-2 text-[13px] outline-none"
                style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
              />
            </div>
            {formError ? (
              <p className="text-[12px]" style={{ color: 'var(--danger)' }} role="alert">
                {formError}
              </p>
            ) : null}
          </div>

          <div className="mt-5 flex items-center justify-end gap-2">
            <Dialog.Close asChild>
              <button type="button" className="notes-button secondary">
                Cancel
              </button>
            </Dialog.Close>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={createFollowUp.isPending}
              className="notes-button"
              style={{ background: 'var(--accent)', color: '#fff', border: '1px solid transparent' }}
            >
              <CalendarClock size={12} />
              {createFollowUp.isPending ? 'Creating…' : 'Create follow-up'}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
