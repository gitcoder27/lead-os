import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { NotebookPen } from 'lucide-react';
import { useAuthScopeKey } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { useAppendDailyNote } from '@/hooks/useDailyNotes';
import {
  clearDailyNoteCaptureDraft,
  readDailyNoteCaptureDraft,
  writeDailyNoteCaptureDraft,
} from '@/lib/daily-note-drafts';

interface NoteCaptureFormProps {
  date: string;
  formattedDate: string;
  onClose: () => void;
  onOpenNotes?: (date?: string) => void;
}

export function NoteCaptureForm({ date, formattedDate, onClose, onOpenNotes }: NoteCaptureFormProps) {
  const scope = useAuthScopeKey();
  const appendNote = useAppendDailyNote();
  const { addToast } = useToast();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const requestKeyRef = useRef<{ key: string; id: string } | null>(null);
  const submittingRef = useRef(false);

  const [initialDraft] = useState(() => readDailyNoteCaptureDraft(scope));
  const [targetDate] = useState(() => initialDraft?.date ?? date);
  const [submitting, setSubmitting] = useState(false);
  const [storageWarning, setStorageWarning] = useState(false);
  const [text, setText] = useState(() => {
    if (initialDraft) {
      requestKeyRef.current = { key: `${initialDraft.date}\n${initialDraft.text.trim()}`, id: initialDraft.requestId };
      return initialDraft.text;
    }
    return '';
  });

  useEffect(() => {
    const t = setTimeout(() => textareaRef.current?.focus(), 140);
    return () => clearTimeout(t);
  }, []);

  const persistDraft = (nextText: string) => {
    const trimmed = nextText.trim();
    if (!trimmed) {
      clearDailyNoteCaptureDraft(scope);
      requestKeyRef.current = null;
      return;
    }
    const key = `${targetDate}\n${trimmed}`;
    if (!requestKeyRef.current || requestKeyRef.current.key !== key) {
      requestKeyRef.current = { key, id: crypto.randomUUID() };
    }
    const ok = writeDailyNoteCaptureDraft(scope, {
      date: targetDate,
      text: nextText,
      requestId: requestKeyRef.current.id,
    });
    if (!ok) {
      setStorageWarning(true);
    }
  };

  const handleChange = (next: string) => {
    setText(next);
    persistDraft(next);
  };

  const handleSubmit = () => {
    const trimmed = text.trim();
    if (!trimmed || submittingRef.current || appendNote.isPending) {
      return;
    }
    submittingRef.current = true;
    setSubmitting(true);
    const key = `${targetDate}\n${trimmed}`;
    if (!requestKeyRef.current || requestKeyRef.current.key !== key) {
      requestKeyRef.current = { key, id: crypto.randomUUID() };
    }
    const requestId = requestKeyRef.current.id;
    writeDailyNoteCaptureDraft(scope, { date: targetDate, text, requestId });

    appendNote.mutate(
      { date: targetDate, text: trimmed, requestId },
      {
        onSuccess: () => {
          const stored = readDailyNoteCaptureDraft(scope);
          if (stored?.requestId === requestId) {
            clearDailyNoteCaptureDraft(scope);
            requestKeyRef.current = null;
          }
          addToast('Added to your note', 'success');
          onClose();
        },
        onError: (error) => {
          submittingRef.current = false;
          setSubmitting(false);
          addToast({ type: 'error', title: 'Could not add to note', message: error.message });
        },
      },
    );
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.12 }}
    >
      <div className="px-5 py-3.5">
        <label htmlFor="note-capture-text" className="mb-1.5 block text-[12px] font-medium" style={{ color: 'var(--text-secondary)' }}>
          Quick note
        </label>
        <textarea
          id="note-capture-text"
          ref={textareaRef}
          value={text}
          onChange={(e) => handleChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              handleSubmit();
            }
          }}
          placeholder="Jot it down before it slips…"
          rows={4}
          className="notes-capture-textarea w-full rounded-xl px-3.5 py-2.5 text-[13px] outline-none resize-y disabled:opacity-60"
          style={{
            background: 'var(--bg-tertiary)',
            color: 'var(--text-primary)',
            border: '1px solid var(--border)',
            minHeight: '96px',
          }}
          maxLength={50000}
          disabled={submitting}
        />
        <p className="mt-1.5 text-[11px]" style={{ color: 'var(--text-muted)' }}>
          Added to your private daily note
        </p>
        {storageWarning ? (
          <p className="mt-1 text-[11px]" style={{ color: 'var(--warning)' }}>
            Draft recovery unavailable in this browser. Keep this dialog open until it saves.
          </p>
        ) : null}
      </div>

      <div
        className="flex items-center justify-between gap-2 px-5 py-3"
        style={{
          borderTop: '1px solid var(--border)',
          background: 'color-mix(in srgb, var(--bg-tertiary) 40%, transparent)',
        }}
      >
        <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
          {targetDate === date ? formattedDate : targetDate}
        </span>
        <div className="flex items-center gap-2">
          {onOpenNotes ? (
            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenNotes(targetDate);
              }}
              className="rounded-lg px-2.5 py-1.5 text-[12px] font-medium"
              style={{ color: 'var(--text-muted)' }}
            >
              Open Notes
            </button>
          ) : null}
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!text.trim() || submitting}
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-semibold transition-all disabled:opacity-40"
            style={{
              background: 'var(--accent)',
              color: '#fff',
            }}
          >
            <NotebookPen size={11} />
            {submitting ? 'Adding…' : 'Add to note'}
          </button>
        </div>
      </div>
    </motion.div>
  );
}
