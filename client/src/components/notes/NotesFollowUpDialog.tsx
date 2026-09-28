import { useEffect, useMemo, useRef, useState } from 'react';
import { format } from 'date-fns';
import { CalendarClock } from 'lucide-react';
import { useToast } from '@/context/ToastContext';
import { useCreateDailyNoteFollowUp } from '@/hooks/useDailyNotes';
import { followUpPresets, toLocalDateTimeInputValue } from '@/components/tasks/task-detail-format';
import { getLocalIsoDate } from '@/lib/utils';
import { prettyNoteDate, splitTitleAndContext } from '@/lib/note-markdown';
import type { CreateDailyNoteFollowUpPayload, DailyNoteKind } from '@/types';
import {
  NOTES_INPUT_CLASS,
  NOTES_INPUT_STYLE,
  NotesDialogShell,
  NotesField,
  NotesFormError,
  NotesSubmitButton,
  noteSourceLabel,
} from './NotesDialogPrimitives';

interface NotesFollowUpDialogProps {
  open: boolean;
  noteDate: string;
  noteKind?: DailyNoteKind;
  selectedText: string;
  onClose: () => void;
  /** Called with the created follow-up's key so the note can mark the line (F7). */
  onDone?: (result: { taskKey?: string }) => void;
}

const TITLE_MAX = 500;

export function NotesFollowUpDialog({ open, noteDate, noteKind, selectedText, onClose, onDone }: NotesFollowUpDialogProps) {
  const { addToast } = useToast();
  const createFollowUp = useCreateDailyNoteFollowUp(noteDate);
  const [title, setTitle] = useState('');
  const [context, setContext] = useState('');
  const [followUpAt, setFollowUpAt] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const requestKeyRef = useRef<{ key: string; id: string; date: string } | null>(null);

  const presets = useMemo(() => (open ? followUpPresets() : []), [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const split = splitTitleAndContext(selectedText, TITLE_MAX);
    setTitle(split.title);
    setContext(split.context);
    setFollowUpAt(toLocalDateTimeInputValue(presets[0]?.value ?? null));
    setFormError(null);
    requestKeyRef.current = null;
  }, [open, selectedText, presets]);

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
      kind: noteKind,
    };

    createFollowUp.mutate(payload, {
      onSuccess: (created) => {
        addToast(created?.taskKey ? `Follow-up ${created.taskKey} created` : 'Follow-up created', 'success');
        requestKeyRef.current = null;
        onDone?.({ taskKey: created?.taskKey });
        onClose();
      },
      onError: (error) => {
        setFormError(error.message);
      },
    });
  };

  const followUpDate = followUpAt ? new Date(followUpAt) : null;

  return (
    <NotesDialogShell
      open={open}
      onClose={onClose}
      title="Create follow-up"
      sourceLabel={noteSourceLabel(prettyNoteDate(noteDate, 'EEE, MMM d'))}
      footer={
        <NotesSubmitButton onClick={handleSubmit} disabled={createFollowUp.isPending}>
          <CalendarClock size={12} />
          {createFollowUp.isPending ? 'Creating…' : 'Create follow-up'}
        </NotesSubmitButton>
      }
    >
      <NotesField
        label="Title"
        htmlFor="note-followup-title"
        hint={context ? 'Only the first line becomes the title — the rest stays in your note.' : undefined}
      >
        <input
          id="note-followup-title"
          type="text"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          maxLength={TITLE_MAX}
          placeholder="What should you come back to?"
          className={NOTES_INPUT_CLASS}
          style={NOTES_INPUT_STYLE}
        />
      </NotesField>
      <NotesField label="Follow up on" htmlFor="note-followup-at">
        <div className="mb-1.5 flex flex-wrap gap-1.5" role="group" aria-label="Follow-up presets">
          {presets.map((preset) => {
            const value = toLocalDateTimeInputValue(preset.value);
            return (
              <button
                key={preset.key}
                type="button"
                className={`notes-preset${value === followUpAt ? ' active' : ''}`}
                aria-pressed={value === followUpAt}
                onClick={() => setFollowUpAt(value)}
              >
                {preset.label}
                <span>{preset.hint}</span>
              </button>
            );
          })}
        </div>
        <input
          id="note-followup-at"
          type="datetime-local"
          required
          value={followUpAt}
          onChange={(event) => setFollowUpAt(event.target.value)}
          className={NOTES_INPUT_CLASS}
          style={NOTES_INPUT_STYLE}
        />
        {followUpDate && !Number.isNaN(followUpDate.getTime()) ? (
          <p className="mt-1 text-[12px]" style={{ color: 'var(--text-muted)' }}>
            {format(followUpDate, "EEEE, MMM d 'at' h:mm a")}
          </p>
        ) : null}
      </NotesField>
      <NotesFormError message={formError} />
    </NotesDialogShell>
  );
}
