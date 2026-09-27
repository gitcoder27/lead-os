import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { addDays, format, parseISO } from 'date-fns';
import { CalendarDays, CalendarPlus, ChevronLeft, ChevronRight, History, Lock, Sun } from 'lucide-react';
import { useToast } from '@/context/ToastContext';
import { DAILY_NOTE_MAX_LENGTH, useDailyNoteEditor, type DailyNoteEditor } from '@/hooks/useDailyNoteEditor';
import { useManagerDeskDeveloperLookup } from '@/hooks/useManagerDesk';
import { useNoteEntityLookups } from '@/hooks/useNoteEntityLookups';
import { DatePickerPopover, isEditable } from '@/components/tasks/TaskDetailPrimitives';
import { TaskDrawer } from '@/components/tasks/TaskDrawer';
import { CARRIED_PATTERN, inferFromText, prettyNoteDate, wrapUpCandidates, type WrapUpCandidate } from '@/lib/note-markdown';
import { isValidIsoDate } from '@/lib/view-params';
import type { DailyNoteKind, DailyNoteRef, TodayActionTarget } from '@/types';
import { NoteEditor, type NoteActionSource, type NoteEditorHandle, type NoteLineEdit } from './editor/NoteEditor';
import type { NoteEditorHandlers, NoteEntityContext, NoteLineAction } from './editor/note-editor-extensions';
import { NotesConflictPanel } from './NotesConflictPanel';
import { NotesDayContext } from './NotesDayContext';
import { NotesDocFooter } from './NotesDocFooter';
import { NotesFollowUpDialog } from './NotesFollowUpDialog';
import { NotesFromThisNote } from './NotesFromThisNote';
import { NotesTaskActionDialog, type NotesTaskActionInference } from './NotesTaskActionDialog';
import { NotesWrapUpDialog } from './NotesWrapUpDialog';

interface NoteDocumentProps {
  date: string;
  today: string;
  kind?: DailyNoteKind;
  hidden?: boolean;
  mobile?: boolean;
  onNavigateDate: (date: string) => void;
  onOpenTarget: (target: TodayActionTarget) => void;
  registerFlush: (flush: (() => Promise<boolean>) | null) => void;
  onOpenHistory?: () => void;
  /** Search terms to land on when this note was opened from a search result (F12). */
  jumpTerms?: string[];
}

const CHAR_COUNT_THRESHOLD = DAILY_NOTE_MAX_LENGTH - 5000;
/** After this local hour the wrap-up button is nudged on today's note. */
const WRAP_UP_NUDGE_HOUR = 17;

interface ActionDialogState {
  kind: NoteLineAction;
  text: string;
  inference: NotesTaskActionInference;
}

function hasOpenLayer(): boolean {
  return Boolean(document.querySelector('[aria-modal="true"], [role="dialog"][data-state="open"], [data-popover-layer]'));
}

export function NoteDocument({
  date,
  today,
  kind = 'scratchpad',
  hidden = false,
  mobile = false,
  onNavigateDate,
  onOpenTarget,
  registerFlush,
  onOpenHistory,
  jumpTerms,
}: NoteDocumentProps) {
  const editor = useDailyNoteEditor(date, kind);
  const { addToast } = useToast();
  const lookups = useNoteEntityLookups();
  const rosterQuery = useManagerDeskDeveloperLookup('', date);
  const editorRef = useRef<NoteEditorHandle>(null);
  const actionSourceRef = useRef<NoteActionSource | null>(null);
  const [actionDialog, setActionDialog] = useState<ActionDialogState | null>(null);
  const [wrapUp, setWrapUp] = useState<WrapUpCandidate[] | null>(null);
  const [drawerTaskKey, setDrawerTaskKey] = useState<string | null>(null);
  const [dateAnchor, setDateAnchor] = useState<HTMLButtonElement | null>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  const { flush } = editor;

  useEffect(() => {
    registerFlush(flush);
    return () => registerFlush(null);
  }, [flush, registerFlush]);

  const developers = useMemo(
    () => (rosterQuery.data ?? []).filter((dev) => dev.availability?.state !== 'inactive'),
    [rosterQuery.data],
  );

  const entityContext = useMemo<NoteEntityContext>(() => {
    const refs = new Map<string, { status: DailyNoteRef['status']; title: string }>();
    for (const ref of editor.refs) {
      if (ref.taskKey) refs.set(ref.taskKey.toUpperCase(), { status: ref.status, title: ref.title });
    }
    return { developers, refs };
  }, [developers, editor.refs]);

  const conflicted = editor.saveState === 'conflict';
  const actionsDisabledReason = actionsBlockedReason(editor, conflicted);

  // ── Line actions (F8) ──────────────────────────────────────────────

  const startAction = useCallback(
    async (kind: NoteLineAction) => {
      if (actionsDisabledReason) {
        addToast(actionsDisabledReason, 'info');
        return;
      }
      const source = editorRef.current?.captureActionSource() ?? null;
      const text = source?.text ?? '';
      actionSourceRef.current = source;
      const inferred = inferFromText(text, developers);
      const ok = await flush();
      if (!ok) {
        return;
      }
      setActionDialog({
        kind,
        text,
        inference: {
          taskKey: inferred.taskKey,
          developer: developers.find((dev) => dev.accountId === inferred.developer?.accountId) ?? null,
          jiraKey: inferred.jiraKey,
        },
      });
    },
    [actionsDisabledReason, addToast, developers, flush],
  );

  const closeActionDialog = useCallback(() => {
    setActionDialog(null);
    editorRef.current?.restoreSelection(actionSourceRef.current);
  }, []);

  const markSourceLine = useCallback((taskKey: string | undefined) => {
    const source = actionSourceRef.current;
    if (source && taskKey) editorRef.current?.appendMarker(source, taskKey);
  }, []);

  // ── Wrap-up (§5) ────────────────────────────────────────────────────

  const openWrapUp = useCallback(async () => {
    if (actionsDisabledReason) {
      addToast(actionsDisabledReason, 'info');
      return;
    }
    const ok = await flush();
    if (!ok) return;
    setWrapUp(wrapUpCandidates(editor.body, developers));
  }, [actionsDisabledReason, addToast, developers, editor.body, flush]);

  const applyWrapUpEdits = useCallback((edits: NoteLineEdit[]) => {
    editorRef.current?.applyLineEdits(edits);
  }, []);

  const openItems = useMemo(() => wrapUpCandidates(editor.body, developers), [developers, editor.body]);
  const openCheckboxes = openItems.filter((item) => item.kind === 'checkbox').length;

  // ── Editor handlers (read through a ref inside CodeMirror) ──────────

  const handlers: NoteEditorHandlers = {
    openTask: (taskKey) => setDrawerTaskKey(taskKey),
    openIssue: (issueKey) => onOpenTarget({ type: 'issue', view: 'work', issueKey }),
    openDeveloper: (developerAccountId) => onOpenTarget({ type: 'developer', view: 'team', developerAccountId }),
    openNoteDate: (next) => onNavigateDate(next),
    previewTask: lookups.previewTask,
    previewIssue: lookups.previewIssue,
    searchTasks: lookups.searchTasks,
    searchIssues: lookups.searchIssues,
    onAction: (kind) => void startAction(kind),
    onWrapUp: () => void openWrapUp(),
    onSave: () => void flush(),
  };

  // F12: land at the match when opened (or re-opened) from a search result.
  const jumpedRef = useRef<string[] | undefined>(undefined);
  useEffect(() => {
    if (jumpedRef.current === jumpTerms || editor.loading || !jumpTerms?.length) return;
    jumpedRef.current = jumpTerms;
    requestAnimationFrame(() => editorRef.current?.highlightTerms(jumpTerms));
  }, [editor.loading, jumpTerms]);

  // `?` opens the shortcut legend from anywhere on the page that isn't a text field.
  useEffect(() => {
    if (hidden) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== '?' || event.metaKey || event.ctrlKey || event.altKey || event.defaultPrevented) return;
      const active = document.activeElement;
      if (active && isEditable(active)) return;
      if (event.target instanceof Element && isEditable(event.target)) return;
      if (hasOpenLayer()) return;
      event.preventDefault();
      setShortcutsOpen(true);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [hidden]);

  // ── Header ──────────────────────────────────────────────────────────

  const shiftDate = (days: number) => {
    if (isValidIsoDate(date)) onNavigateDate(format(addDays(parseISO(date), days), 'yyyy-MM-dd'));
  };

  const isToday = date === today;
  const heading = headingLabel(date, today);
  const headingDate = safeFormat(date, 'EEEE, MMMM d, yyyy');

  const save = saveStatus(editor, today);
  const showCharCount = editor.body.length > CHAR_COUNT_THRESHOLD;
  const overLimit = editor.body.length > DAILY_NOTE_MAX_LENGTH;
  // Only nag about real open checkboxes, and only once the day is winding down.
  const wrapUpNudge = isToday && openCheckboxes > 0 && new Date().getHours() >= WRAP_UP_NUDGE_HOUR;

  const openRef = (ref: DailyNoteRef) => {
    if (ref.taskKey) {
      setDrawerTaskKey(ref.taskKey);
    } else if (ref.itemId) {
      onOpenTarget({ type: 'manager_desk_item', view: 'desk', managerDeskItemId: ref.itemId });
    }
  };

  return (
    <section className="notes-document" aria-label={kind === 'standup' ? `Standup note for ${headingDate}` : `Note for ${headingDate}`} hidden={hidden}>
      <div className="notes-document-inner">
        <header className="notes-doc-toolbar">
          <div className="min-w-0 flex-1">
            {mobile ? (
              <p className="notes-doc-mobile-label">
                <Lock size={10} aria-hidden="true" />
                {kind === 'standup' ? 'Standup · Only you' : 'Notes · Only you'}
              </p>
            ) : null}
            <div className="flex min-w-0 items-center gap-2">
              {onOpenHistory ? (
                <button type="button" onClick={onOpenHistory} className="notes-nav-button" aria-label="Open note history">
                  <History size={13} />
                  History
                </button>
              ) : null}
              <h2 className="notes-doc-heading">
                {heading}
                {kind === 'standup' ? <span className="notes-kind-pill">Standup</span> : null}
                {isToday ? <span className="notes-today-pill">Today</span> : null}
              </h2>
            </div>
          </div>

          <nav className="notes-doc-nav" aria-label="Change day">
            <div className="notes-nav-group">
              <button
                type="button"
                className="notes-nav-button"
                onClick={() => shiftDate(-1)}
                aria-label="Previous day"
                title="Previous day (⌥↑)"
              >
                <ChevronLeft size={14} />
              </button>
              <button
                type="button"
                className="notes-nav-button"
                onClick={() => shiftDate(1)}
                aria-label="Next day"
                title="Next day (⌥↓)"
              >
                <ChevronRight size={14} />
              </button>
              <button
                type="button"
                className="notes-nav-button"
                aria-label="Pick a date"
                aria-haspopup="dialog"
                aria-expanded={Boolean(dateAnchor)}
                onClick={(event) => setDateAnchor(dateAnchor ? null : event.currentTarget)}
              >
                <CalendarDays size={13} />
              </button>
            </div>
            {!isToday ? (
              <button type="button" className="notes-nav-button" onClick={() => onNavigateDate(today)} title="Today (⌥T)">
                Today
              </button>
            ) : null}
          </nav>
        </header>

        <NotesDayContext
          date={date}
          isToday={isToday}
          onOpenTarget={onOpenTarget}
          onRevealCarried={() => editorRef.current?.revealLine((text) => new RegExp(CARRIED_PATTERN.source).test(text))}
        />

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
          <div aria-hidden="true" className="notes-doc-skeleton">
            {[0, 1, 2, 3].map((item) => (
              <div key={item} className="notes-skeleton" style={{ height: 14, width: `${88 - item * 14}%` }} />
            ))}
          </div>
        ) : (
          <>
            {conflicted ? (
              <NotesConflictPanel
                remote={editor.conflict}
                base={editor.baseBody}
                local={editor.body}
                error={editor.error}
                onKeepBoth={editor.keepBoth}
                onUseSavedVersion={editor.useSavedVersion}
              />
            ) : editor.error ? (
              <p className="notes-doc-inline-error" role={editor.offline ? 'status' : 'alert'}>
                {editor.offline ? 'Your draft is saved on this device and will sync when you reconnect.' : editor.error}
              </p>
            ) : null}

            <NoteEditor
              ref={editorRef}
              value={editor.body}
              onChange={editor.changeBody}
              onBlur={() => void editor.flush()}
              handlers={handlers}
              entityContext={entityContext}
              placeholder={
                kind === 'standup'
                  ? 'Standup notes for this day…'
                  : isToday
                    ? 'What’s on your mind today?'
                    : 'Thoughts, observations, things to come back to…'
              }
              ariaLabel={kind === 'standup' ? `Standup note for ${headingDate}` : `Notes for ${headingDate}`}
              actionsDisabled={actionsDisabledReason !== null}
              mobile={mobile}
            />

            {editor.body.trim().length === 0 && !conflicted ? (
              <p className="notes-teach">
                Type <kbd>@</kbd> for people, <kbd>T-</kbd> for tasks, <kbd>#</kbd> for Jira, <kbd>/</kbd> for commands.
                Put the caret on a line and press <kbd>⌘⇧E</kbd> to turn it into a task.
              </p>
            ) : null}

            {/* A1: routine save states stay silent; merge notices reach assistive tech. */}
            <span className="sr-only" role="status">
              {editor.mergeNotice ?? ''}
            </span>

            <NotesFromThisNote refs={editor.refs} onOpen={openRef} />
          </>
        )}
      </div>

      {!editor.loading && !editor.loadError ? (
        <NotesDocFooter
          saveLabel={save.label}
          saveTone={save.tone}
          onRetrySave={editor.saveState === 'error' ? editor.retrySave : undefined}
          mergeNotice={editor.mergeNotice}
          charCount={showCharCount || overLimit ? { value: editor.body.length, max: DAILY_NOTE_MAX_LENGTH, over: overLimit } : null}
          recoveryUnavailable={editor.recoveryUnavailable}
          actionsDisabledReason={actionsDisabledReason}
          onAction={(kind) => void startAction(kind)}
          wrapUpCount={openItems.length}
          wrapUpNudge={wrapUpNudge}
          onWrapUp={() => void openWrapUp()}
          shortcutsOpen={shortcutsOpen}
          onShortcutsOpenChange={setShortcutsOpen}
        />
      ) : null}

      {dateAnchor ? (
        <DatePickerPopover
          anchor={dateAnchor}
          label="Go to day"
          kind="date"
          value={date}
          clearLabel={null}
          presets={[
            { key: 'today', label: 'Today', hint: prettyNoteDate(today, 'EEE, MMM d'), icon: <Sun size={13} />, onSelect: () => goTo(today) },
            {
              key: 'yesterday',
              label: 'Yesterday',
              hint: prettyNoteDate(shiftIso(today, -1), 'EEE, MMM d'),
              icon: <ChevronLeft size={13} />,
              onSelect: () => goTo(shiftIso(today, -1)),
            },
            {
              key: 'tomorrow',
              label: 'Tomorrow',
              hint: prettyNoteDate(shiftIso(today, 1), 'EEE, MMM d'),
              icon: <CalendarPlus size={13} />,
              onSelect: () => goTo(shiftIso(today, 1)),
            },
          ]}
          onCommit={(value) => {
            if (value && isValidIsoDate(value)) goTo(value);
          }}
          onClose={() => setDateAnchor(null)}
        />
      ) : null}

      <NotesFollowUpDialog
        open={actionDialog?.kind === 'follow-up'}
        noteDate={date}
        noteKind={kind}
        selectedText={actionDialog?.kind === 'follow-up' ? actionDialog.text : ''}
        onClose={closeActionDialog}
        onDone={({ taskKey }) => markSourceLine(taskKey)}
      />
      <NotesTaskActionDialog
        open={actionDialog?.kind === 'task' || actionDialog?.kind === 'update'}
        mode={actionDialog?.kind === 'update' ? 'update' : 'create'}
        noteDate={date}
        noteKind={kind}
        selectedText={actionDialog && actionDialog.kind !== 'follow-up' ? actionDialog.text : ''}
        inference={actionDialog?.inference}
        onClose={closeActionDialog}
        onDone={({ taskKey }) => markSourceLine(taskKey)}
      />
      <NotesWrapUpDialog
        open={wrapUp !== null}
        noteDate={date}
        noteKind={kind}
        today={today}
        candidates={wrapUp ?? []}
        developers={developers}
        onClose={() => {
          setWrapUp(null);
          editorRef.current?.focus();
        }}
        onApplyEdits={applyWrapUpEdits}
      />
      <TaskDrawer taskKey={drawerTaskKey} onClose={() => setDrawerTaskKey(null)} onNavigateTask={setDrawerTaskKey} />
    </section>
  );

  function goTo(next: string) {
    setDateAnchor(null);
    if (next !== date) onNavigateDate(next);
  }
}

function actionsBlockedReason(editor: DailyNoteEditor, conflicted: boolean): string | null {
  if (editor.loading) return 'Loading this note…';
  if (conflicted) return 'Resolve the version conflict first';
  if (!editor.latest && editor.body.trim().length === 0) return 'Write something first';
  return null;
}

function headingLabel(date: string, today: string): string {
  try {
    const parsed = parseISO(date);
    const sameYear = parsed.getFullYear() === parseISO(today).getFullYear();
    return format(parsed, sameYear ? 'EEEE, MMMM d' : 'EEEE, MMMM d, yyyy');
  } catch {
    return date;
  }
}

function shiftIso(date: string, days: number): string {
  return format(addDays(parseISO(date), days), 'yyyy-MM-dd');
}

function safeFormat(value: string, pattern: string): string {
  try {
    return format(parseISO(value), pattern);
  } catch {
    return value;
  }
}

/** U3: a steady "Saved · time"; only errors, offline, and conflicts change the line. */
function saveStatus(editor: DailyNoteEditor, today: string): { label: string; tone: 'default' | 'error' | 'warning' } {
  if (editor.saveState === 'conflict') return { label: 'Needs your review', tone: 'warning' };
  if (editor.saveState === 'error') {
    return editor.offline
      ? { label: 'Offline — saved on this device', tone: 'warning' }
      : { label: 'Could not save.', tone: 'error' };
  }
  const updatedAt = editor.latest?.updatedAt;
  if (!updatedAt) {
    return { label: editor.body.trim().length > 0 ? 'Saving…' : '', tone: 'default' };
  }
  const at = new Date(updatedAt);
  if (Number.isNaN(at.getTime())) return { label: 'Saved', tone: 'default' };
  const sameDay = format(at, 'yyyy-MM-dd') === today;
  return { label: `Saved · ${format(at, sameDay ? 'h:mm a' : 'MMM d, h:mm a')}`, tone: 'default' };
}
