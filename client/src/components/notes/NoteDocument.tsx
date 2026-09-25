import { useCallback, useEffect, useRef, useState } from 'react';
import { addDays, format, parseISO } from 'date-fns';
import { CalendarClock, ChevronLeft, ChevronRight, History, ListPlus, Lock, SquarePlus } from 'lucide-react';
import { DAILY_NOTE_MAX_LENGTH, useDailyNoteEditor } from '@/hooks/useDailyNoteEditor';
import { isValidIsoDate } from '@/lib/view-params';
import type { TodayActionTarget } from '@/types';
import { NotesConflictPanel } from './NotesConflictPanel';
import { NotesFollowUpDialog } from './NotesFollowUpDialog';
import { NotesTaskActionDialog, type NotesTaskActionMode } from './NotesTaskActionDialog';

interface NoteDocumentProps {
  date: string;
  today: string;
  hidden?: boolean;
  mobile?: boolean;
  onNavigateDate: (date: string) => void;
  onOpenTarget: (target: TodayActionTarget) => void;
  registerFlush: (flush: (() => Promise<boolean>) | null) => void;
  onOpenHistory?: () => void;
}

const CHAR_COUNT_THRESHOLD = DAILY_NOTE_MAX_LENGTH - 5000;

export function NoteDocument({
  date,
  today,
  hidden = false,
  mobile = false,
  onNavigateDate,
  onOpenTarget,
  registerFlush,
  onOpenHistory,
}: NoteDocumentProps) {
  const editor = useDailyNoteEditor(date);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const selectionRef = useRef<{ start: number; end: number }>({ start: 0, end: 0 });
  const [followUpOpen, setFollowUpOpen] = useState(false);
  const [taskActionOpen, setTaskActionOpen] = useState(false);
  const [taskActionMode, setTaskActionMode] = useState<NotesTaskActionMode>('update');
  const [selectedText, setSelectedText] = useState('');

  const { flush } = editor;

  useEffect(() => {
    registerFlush(flush);
    return () => registerFlush(null);
  }, [flush, registerFlush]);

  const captureSelection = useCallback(() => {
    const el = textareaRef.current;
    if (!el) {
      return;
    }
    selectionRef.current = { start: el.selectionStart, end: el.selectionEnd };
  }, []);

  const shiftDate = useCallback(
    (days: number) => {
      if (!isValidIsoDate(date)) {
        return;
      }
      onNavigateDate(format(addDays(parseISO(date), days), 'yyyy-MM-dd'));
    },
    [date, onNavigateDate],
  );

  const handlePickerChange = (value: string) => {
    if (value && isValidIsoDate(value) && value !== date) {
      onNavigateDate(value);
    }
  };

  const handleOpenFollowUp = async () => {
    captureSelection();
    const { start, end } = selectionRef.current;
    setSelectedText(end > start ? editor.body.slice(start, end) : '');
    const ok = await flush();
    if (ok) {
      setFollowUpOpen(true);
    }
  };

  const handleOpenTaskAction = async (mode: NotesTaskActionMode) => {
    captureSelection();
    const { start, end } = selectionRef.current;
    setSelectedText(end > start ? editor.body.slice(start, end) : '');
    const ok = await flush();
    if (ok) {
      setTaskActionMode(mode);
      setTaskActionOpen(true);
    }
  };

  const heading = safeFormat(date, 'EEEE, MMMM d');
  const subline = safeFormat(date, 'yyyy');
  const isToday = date === today;
  const showCharCount = editor.body.length > CHAR_COUNT_THRESHOLD;
  const overLimit = editor.body.length > DAILY_NOTE_MAX_LENGTH;
  const conflicted = editor.saveState === 'conflict';
  const selectionActionsDisabled =
    editor.loading || conflicted || (!editor.latest && editor.body.trim().length === 0);

  const saveStatus = statusLabel(editor.saveState);

  return (
    <section className="notes-document" aria-label={`Note for ${date}`} hidden={hidden}>
      <div className="notes-document-inner">
        <div className="notes-doc-toolbar">
          <div className="min-w-0">
            {mobile ? (
              <p className="notes-doc-mobile-label">
                <Lock size={10} aria-hidden="true" />
                Notes · Only you
              </p>
            ) : null}
            <div className="flex items-center gap-2">
              {onOpenHistory ? (
                <button
                  type="button"
                  onClick={onOpenHistory}
                  className="notes-nav-button"
                  aria-label="Open note history"
                >
                  <History size={13} />
                  History
                </button>
              ) : null}
              <h2 className="notes-doc-heading">{heading}</h2>
            </div>
            <div className="notes-doc-subline">
              <span>{subline}</span>
              {isToday ? <span>· Today</span> : null}
            </div>
          </div>

          <div className="notes-doc-nav">
            <button
              type="button"
              className="notes-nav-button"
              onClick={() => shiftDate(-1)}
              aria-label="Previous day"
            >
              <ChevronLeft size={14} />
            </button>
            <button
              type="button"
              className="notes-nav-button"
              onClick={() => shiftDate(1)}
              aria-label="Next day"
            >
              <ChevronRight size={14} />
            </button>
            <label className="sr-only" htmlFor="notes-date-picker">
              Pick a date
            </label>
            <input
              id="notes-date-picker"
              type="date"
              value={date}
              onChange={(event) => handlePickerChange(event.target.value)}
              className="notes-date-input"
            />
            {!isToday ? (
              <button type="button" className="notes-nav-button" onClick={() => onNavigateDate(today)}>
                Today
              </button>
            ) : null}
          </div>
        </div>

        {editor.loadError ? (
          <div className="notes-doc-error" role="alert">
            <p>Could not load this note.</p>
            <p className="mt-1 text-[12px]" style={{ color: 'var(--text-muted)' }}>
              {editor.loadError.message}
            </p>
            <button type="button" className="notes-button secondary mt-4" onClick={editor.retryLoad}>
              Retry
            </button>
          </div>
        ) : editor.loading ? (
          <div aria-hidden="true" className="mt-6 space-y-3">
            {[0, 1, 2, 3].map((item) => (
              <div
                key={item}
                className="notes-skeleton"
                style={{ height: 14, width: `${88 - item * 14}%` }}
              />
            ))}
          </div>
        ) : (
          <>
            <label className="sr-only" htmlFor="notes-editor">
              {`Notes for ${heading}`}
            </label>
            <textarea
              id="notes-editor"
              ref={textareaRef}
              value={editor.body}
              onChange={(event) => editor.changeBody(event.target.value)}
              onSelect={captureSelection}
              onKeyUp={captureSelection}
              onMouseUp={captureSelection}
              onBlur={() => void editor.flush()}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
                  event.preventDefault();
                  void editor.flush();
                }
              }}
              placeholder="Thoughts, observations, things to come back to…"
              className="notes-textarea"
              disabled={editor.loading}
            />
            {editor.body.trim().length === 0 && !conflicted ? (
              <p className="mt-1 text-[12.5px]" style={{ color: 'var(--text-muted)' }}>
                Start anywhere. Your notes save as you write.
              </p>
            ) : null}

            {conflicted ? (
              <NotesConflictPanel
                remote={editor.conflict}
                error={editor.error}
                onKeepBoth={editor.keepBoth}
                onUseSavedVersion={editor.useSavedVersion}
              />
            ) : editor.error ? (
              <p className="notes-doc-inline-error" role="alert">
                {editor.error}
              </p>
            ) : null}

            <div className="notes-doc-meta">
              <span className={`notes-save-state${editor.saveState === 'error' ? ' error' : ''}`} aria-live="polite">
                {saveStatus}
                {editor.saveState === 'error' ? (
                  <button
                    type="button"
                    className="notes-followup-open"
                    onClick={editor.retrySave}
                  >
                    Retry
                  </button>
                ) : null}
              </span>
              {editor.recoveryUnavailable ? (
                <span style={{ color: 'var(--warning)' }}>
                  Draft recovery unavailable in this browser. Keep this page open until saved.
                </span>
              ) : null}
              <span className="notes-meta-spacer" />
              {showCharCount || overLimit ? (
                <span className={`notes-char-count${overLimit ? ' danger' : ''}`}>
                  {editor.body.length.toLocaleString()}/{DAILY_NOTE_MAX_LENGTH.toLocaleString()}
                </span>
              ) : null}
              <button
                type="button"
                className="notes-followup-button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => void handleOpenTaskAction('update')}
                disabled={selectionActionsDisabled}
              >
                <ListPlus size={12} />
                Add as update to…
              </button>
              <button
                type="button"
                className="notes-followup-button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => void handleOpenTaskAction('create')}
                disabled={selectionActionsDisabled}
              >
                <SquarePlus size={12} />
                Create task…
              </button>
              <button
                type="button"
                className="notes-followup-button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => void handleOpenFollowUp()}
                disabled={selectionActionsDisabled}
              >
                <CalendarClock size={12} />
                Create follow-up
              </button>
            </div>

            {editor.followUps.length > 0 ? (
              <div className="notes-followups">
                <h3 className="notes-followups-title">Follow-ups from this note</h3>
                {editor.followUps.map((followUp) => (
                  <div key={followUp.itemId} className="notes-followup-row">
                    <span className="notes-followup-row-title">{followUp.title}</span>
                    <span className="notes-followup-row-meta">
                      {followUp.followUpAt ? safeFormat(followUp.followUpAt, 'MMM d, h:mm a') : 'Unscheduled'}
                      {' · '}
                      {followUp.status.replace(/_/g, ' ')}
                    </span>
                    <button
                      type="button"
                      className="notes-followup-open"
                      onClick={() =>
                        onOpenTarget({
                          type: 'manager_desk_item',
                          view: 'desk',
                          managerDeskItemId: followUp.itemId,
                          date: followUp.date,
                        })
                      }
                    >
                      Open follow-up
                    </button>
                  </div>
                ))}
              </div>
            ) : null}
          </>
        )}
      </div>

      <NotesFollowUpDialog
        open={followUpOpen}
        noteDate={date}
        selectedText={selectedText}
        onClose={() => setFollowUpOpen(false)}
      />
      <NotesTaskActionDialog
        open={taskActionOpen}
        mode={taskActionMode}
        noteDate={date}
        selectedText={selectedText}
        onClose={() => setTaskActionOpen(false)}
      />
    </section>
  );
}

function safeFormat(value: string, pattern: string): string {
  try {
    return format(parseISO(value), pattern);
  } catch {
    return value;
  }
}

function statusLabel(state: string): string {
  switch (state) {
    case 'loading':
      return 'Loading…';
    case 'dirty':
      return 'Unsaved changes';
    case 'saving':
      return 'Saving…';
    case 'saved':
      return 'Saved';
    case 'error':
      return 'Could not save.';
    case 'conflict':
      return 'Needs your review';
    default:
      return '';
  }
}
