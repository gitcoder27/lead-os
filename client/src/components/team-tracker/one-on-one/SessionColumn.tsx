import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { addDays, format, parseISO } from 'date-fns';
import { CalendarCheck, CalendarDays, CalendarPlus, Lock, Play, Plus, Sun, Sunrise } from 'lucide-react';
import {
  useCreateOneOnOneSession,
  useCreateOneOnOneSessionAction,
  useUpdateOneOnOneSession,
} from '@/hooks/useOneOnOne';
import { useNoteEntityLookups } from '@/hooks/useNoteEntityLookups';
import { useToast } from '@/context/ToastContext';
import type { ManagerDeskStatus, OneOnOneSeriesDetail, OneOnOneSession, TaskStatus } from '@/types';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { EmptyState } from '@/components/ui/EmptyState';
import { KeySpec } from '@/components/ui/Kbd';
import { FOCUS_RING } from '@/components/ui/focus';
import { DatePickerPopover, type DatePreset } from '@/components/tasks/TaskDetailPrimitives';
import { toneColor } from '@/components/tasks/task-detail-format';
import { NoteEditor, type NoteEditorHandle } from '@/components/notes/editor/NoteEditor';
import type { NoteEditorHandlers, NoteEntityContext, NoteLineAction } from '@/components/notes/editor/note-editor-extensions';
import { splitTitleAndContext } from '@/lib/note-markdown';
import { getLocalIsoDate } from '@/lib/utils';
import { describeSessionDate, isOpenAgendaItem } from './oneOnOneFormat';
import '@/components/notes/notes.css';

const NOTES_AUTOSAVE_MS = 800;
const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

const errorMessage = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback);

/** Map live task state onto the note editor's provenance-chip vocabulary. */
function deskStatusFor(status: TaskStatus): ManagerDeskStatus {
  switch (status) {
    case 'active':
      return 'in_progress';
    case 'blocked':
      return 'waiting';
    case 'done':
      return 'done';
    case 'dropped':
      return 'cancelled';
    default:
      return 'planned';
  }
}

/** Next occurrence of `weekday` strictly after `today` (YYYY-MM-DD). */
function nextWeekday(today: string, weekday: number): string {
  const date = parseISO(today);
  const delta = ((weekday - date.getDay() + 7) % 7) || 7;
  return format(addDays(date, delta), 'yyyy-MM-dd');
}

function sessionDatePresets(today: string, preferredWeekday: number | null, onPick: (iso: string) => void): DatePreset[] {
  const tomorrow = format(addDays(parseISO(today), 1), 'yyyy-MM-dd');
  const presets: DatePreset[] = [
    { key: 'today', label: 'Today', hint: 't', icon: <Sun size={13} />, onSelect: () => onPick(today) },
    { key: 'tomorrow', label: 'Tomorrow', hint: 'm', icon: <Sunrise size={13} />, onSelect: () => onPick(tomorrow) },
  ];
  if (preferredWeekday !== null) {
    presets.push({
      key: 'preferred',
      label: `Next ${WEEKDAY_NAMES[preferredWeekday]}`,
      hint: 'p',
      icon: <CalendarCheck size={13} />,
      onSelect: () => onPick(nextWeekday(today, preferredWeekday)),
    });
  }
  presets.push({
    key: 'week',
    label: 'In a week',
    hint: 'w',
    icon: <CalendarDays size={13} />,
    onSelect: () => onPick(format(addDays(parseISO(today), 7), 'yyyy-MM-dd')),
  });
  return presets;
}

/**
 * docs/48 §4.2 column 2: the live/next session — date, Start / Complete /
 * Skip, action items, and private notes in the Notes editor (same markdown,
 * task chips and line actions, scoped to this 1:1).
 */
export function SessionColumn({ detail, onOpenTask }: { detail: OneOnOneSeriesDetail; onOpenTask?: (taskKey: string) => void }) {
  const session = detail.upcoming;
  return (
    <section className="one-on-one-column flex min-h-0 flex-col" aria-label="1:1 session">
      <SectionHeader as="h2" title="Session" />
      {session ? (
        <LiveSession key={session.id} detail={detail} session={session} onOpenTask={onOpenTask} />
      ) : (
        <NoSession detail={detail} />
      )}
    </section>
  );
}

function NoSession({ detail }: { detail: OneOnOneSeriesDetail }) {
  const { addToast } = useToast();
  const createSession = useCreateOneOnOneSession(detail.series.id);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const today = getLocalIsoDate();

  const schedule = (scheduledFor: string) => {
    setAnchor(null);
    createSession.mutate(
      { scheduledFor },
      { onError: (error) => addToast(errorMessage(error, 'Could not schedule the session'), 'error') },
    );
  };

  if (!detail.series.active) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <EmptyState
          compact
          title="This series is paused"
          body="Resume it above to schedule sessions on its cadence again. The agenda and history are kept."
        />
      </div>
    );
  }

  return (
    <div className="flex flex-1 items-center justify-center">
      <EmptyState
        compact
        icon={<CalendarPlus size={18} />}
        title="No session scheduled"
        body={
          detail.series.cadence === 'ad_hoc'
            ? 'Ad hoc series schedule one session at a time.'
            : 'Pick a date for the next 1:1.'
        }
        action={
          <div className="flex items-center gap-1.5">
            <button type="button" className="ui-btn" disabled={createSession.isPending} onClick={() => schedule(today)}>
              Schedule for today
            </button>
            <button
              type="button"
              className="ui-btn-ghost"
              aria-haspopup="dialog"
              aria-expanded={Boolean(anchor)}
              onClick={(event) => setAnchor(anchor ? null : event.currentTarget)}
            >
              <CalendarDays size={12} aria-hidden="true" />
              Pick a date…
            </button>
          </div>
        }
      />
      {anchor && (
        <DatePickerPopover
          anchor={anchor}
          label="Session date"
          kind="date"
          value=""
          clearLabel={null}
          presets={sessionDatePresets(today, detail.series.preferredWeekday, schedule)}
          onCommit={(value) => value && schedule(value)}
          onClose={() => setAnchor(null)}
        />
      )}
    </div>
  );
}

function LiveSession({
  detail,
  session,
  onOpenTask,
}: {
  detail: OneOnOneSeriesDetail;
  session: OneOnOneSession;
  onOpenTask?: (taskKey: string) => void;
}) {
  const { addToast } = useToast();
  const seriesId = detail.series.id;
  const updateSession = useUpdateOneOnOneSession(seriesId);
  const saveNotes = useUpdateOneOnOneSession(seriesId);
  const createAction = useCreateOneOnOneSessionAction(seriesId);
  const lookups = useNoteEntityLookups();
  const today = getLocalIsoDate();
  const [confirmingComplete, setConfirmingComplete] = useState(false);
  const [dateAnchor, setDateAnchor] = useState<HTMLElement | null>(null);
  const [actionDraft, setActionDraft] = useState('');
  const [notes, setNotes] = useState(session.notes);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const editorRef = useRef<NoteEditorHandle>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const pendingNotes = useRef<string | null>(null);

  // The buffer only resyncs when the live session changes (this component is
  // keyed by session id) — never on refetch, so an autosave can't clobber typing.
  const persist = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = undefined;
    const value = pendingNotes.current;
    if (value === null) return;
    pendingNotes.current = null;
    setSaveState('saving');
    saveNotes.mutate(
      { sessionId: session.id, notes: value },
      {
        onSuccess: () => {
          if (pendingNotes.current !== null) return;
          setSaveState('saved');
          setSavedAt(format(new Date(), 'HH:mm'));
        },
        onError: (error) => {
          pendingNotes.current ??= value;
          setSaveState('error');
          addToast(errorMessage(error, 'Could not save notes'), 'error');
        },
      },
    );
  }, [addToast, saveNotes, session.id]);

  const persistRef = useRef(persist);
  persistRef.current = persist;
  // Leaving the workspace (or the session closing) flushes the last keystrokes.
  useEffect(() => () => persistRef.current(), []);

  const onNotesChange = useCallback((value: string) => {
    setNotes(value);
    pendingNotes.current = value;
    setSaveState('dirty');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => persistRef.current(), NOTES_AUTOSAVE_MS);
  }, []);

  const patch = useCallback(
    (body: { status?: 'done' | 'skipped'; scheduledFor?: string; started?: boolean; reopenCarried?: boolean }) => {
      persist();
      updateSession.mutate(
        { sessionId: session.id, ...body },
        { onError: (error) => addToast(errorMessage(error, 'Could not update the session'), 'error') },
      );
    },
    [addToast, persist, session.id, updateSession],
  );

  const createActionItem = useCallback(
    (title: string, options: { owner?: 'manager'; onCreated?: (taskKey: string) => void } = {}) => {
      createAction.mutate(
        { sessionId: session.id, title, ...(options.owner ? { ownerType: options.owner } : {}) },
        {
          onSuccess: (result) => options.onCreated?.(result.item.task.taskKey),
          onError: (error) => addToast(errorMessage(error, 'Could not create the action item'), 'error'),
        },
      );
    },
    [addToast, createAction, session.id],
  );

  const submitAction = () => {
    const title = actionDraft.trim();
    if (!title || createAction.isPending) return;
    createActionItem(title, { onCreated: () => setActionDraft('') });
  };

  // ⌘⇧E / ⌘⇧L on a notes line: the line becomes an action item for the
  // developer, or a follow-up owned by you — marked `→ KEY` like in Notes.
  const lineAction = useCallback(
    (action: NoteLineAction) => {
      const source = editorRef.current?.captureActionSource() ?? null;
      const title = source ? splitTitleAndContext(source.text).title : '';
      if (!source || !title) {
        addToast('Put the caret on a line (or select text) to turn it into an action item', 'info');
        return;
      }
      createActionItem(title, {
        owner: action === 'follow-up' ? 'manager' : undefined,
        onCreated: (taskKey) => {
          editorRef.current?.appendMarker(source, taskKey);
          addToast(action === 'follow-up' ? `Follow-up ${taskKey} created for you` : `Action item ${taskKey} added to the agenda`, 'success');
        },
      });
    },
    [addToast, createActionItem],
  );

  const agendaTasks = useMemo(() => detail.agenda.filter((item) => !item.task.deletedAt).map((item) => item.task), [detail.agenda]);
  const entityContext = useMemo<NoteEntityContext>(() => {
    const refs = new Map(agendaTasks.map((task) => [task.taskKey.toUpperCase(), { status: deskStatusFor(task.status), title: task.title }]));
    return {
      developers: [{ accountId: detail.series.developerAccountId, displayName: detail.series.developerName }],
      refs,
    };
  }, [agendaTasks, detail.series.developerAccountId, detail.series.developerName]);

  const handlers: NoteEditorHandlers = {
    openTask: (taskKey) => onOpenTask?.(taskKey),
    openIssue: () => undefined,
    openDeveloper: () => undefined,
    openNoteDate: () => undefined,
    previewTask: lookups.previewTask,
    previewIssue: lookups.previewIssue,
    // Agenda topics first — they're what a 1:1 note usually references.
    searchTasks: async (query) => {
      const needle = query.trim().toLowerCase();
      const local = agendaTasks
        .filter((task) => !needle || task.title.toLowerCase().includes(needle) || task.taskKey.toLowerCase().includes(needle))
        .map((task) => ({ taskKey: task.taskKey, title: task.title }));
      const remote = await lookups.searchTasks(query).catch(() => []);
      const seen = new Set(local.map((task) => task.taskKey));
      return [...local, ...remote.filter((task) => !seen.has(task.taskKey))].slice(0, 12);
    },
    searchIssues: lookups.searchIssues,
    onAction: lineAction,
    onWrapUp: () => setConfirmingComplete(true),
    onSave: () => persist(),
  };

  const openCount = detail.agenda.filter(isOpenAgendaItem).length;
  const date = describeSessionDate(session.scheduledFor, today);
  const live = Boolean(session.startedAt);
  const firstName = detail.series.developerName.split(' ')[0] ?? detail.series.developerName;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        className="mb-3 rounded-xl px-3 py-2.5"
        style={{
          background: live ? 'color-mix(in srgb, var(--accent) 7%, var(--bg-secondary))' : 'var(--bg-secondary)',
          border: `1px solid ${live ? 'color-mix(in srgb, var(--accent) 30%, var(--border))' : 'var(--border)'}`,
        }}
        data-testid="one-on-one-session-card"
      >
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
          <button
            type="button"
            onClick={(event) => setDateAnchor(dateAnchor ? null : event.currentTarget)}
            aria-label={`Session date: ${date.label}`}
            aria-haspopup="dialog"
            aria-expanded={Boolean(dateAnchor)}
            title="Reschedule"
            className={`-ml-1.5 flex min-w-0 items-baseline gap-2 rounded-lg px-1.5 py-0.5 text-left transition-colors hover:bg-[var(--bg-tertiary)] ${FOCUS_RING}`}
          >
            <span className="truncate text-[15px] font-semibold tracking-[-0.01em]" style={{ color: 'var(--text-primary)' }}>
              {date.label}
            </span>
            {!live && date.hint && (
              <span className="shrink-0 text-[12px] font-medium" style={{ color: toneColor(date.tone) }}>
                {date.hint}
              </span>
            )}
          </button>
          {live && (
            <span className="ui-chip tone-accent gap-1" title={`Started ${format(new Date(session.startedAt!), 'HH:mm')}`}>
              <span className="h-1.5 w-1.5 animate-pulse rounded-full motion-reduce:animate-none" style={{ background: 'var(--accent)' }} aria-hidden="true" />
              Live · since {format(new Date(session.startedAt!), 'HH:mm')}
            </span>
          )}
          <div className="ml-auto flex items-center gap-1">
            {!live && (
              <button type="button" onClick={() => patch({ started: true })} className="ui-btn">
                <Play size={11} aria-hidden="true" />
                Start
              </button>
            )}
            <button type="button" onClick={() => setConfirmingComplete(true)} className={live ? 'ui-btn' : 'ui-btn-ghost'}>
              Complete
            </button>
            <button type="button" onClick={() => patch({ status: 'skipped' })} className="ui-btn-ghost" title="Skip — open topics carry to the next session">
              Skip
            </button>
          </div>
        </div>
        <div className="mt-1 text-[12px]" style={{ color: 'var(--text-muted)' }}>
          {openCount === 0
            ? 'No open topics yet — add some in the agenda.'
            : `${openCount} open topic${openCount === 1 ? '' : 's'} to cover with ${firstName}`}
        </div>

        {confirmingComplete && (
          <div
            className="mt-2.5 rounded-lg px-2.5 py-2 text-[12.5px]"
            role="group"
            aria-label="Complete session"
            style={{ background: 'var(--bg-primary)', border: '1px solid var(--border)' }}
          >
            <div style={{ color: 'var(--text-primary)' }}>
              {openCount > 0 ? `Keep the ${openCount} open agenda item${openCount === 1 ? '' : 's'} on the agenda?` : 'Complete this session?'}
            </div>
            {openCount > 0 && (
              <div className="mt-0.5 text-[12px]" style={{ color: 'var(--text-muted)' }}>
                Kept topics carry to the next session. Detaching leaves the tasks open but off the agenda.
              </div>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                autoFocus
                onClick={() => {
                  setConfirmingComplete(false);
                  patch({ status: 'done', reopenCarried: true });
                }}
                className="ui-btn ui-btn-sm"
              >
                {openCount > 0 ? 'Keep open — complete' : 'Complete'}
              </button>
              {openCount > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setConfirmingComplete(false);
                    patch({ status: 'done', reopenCarried: false });
                  }}
                  className="ui-btn-ghost"
                >
                  Detach items — complete
                </button>
              )}
              <button type="button" onClick={() => setConfirmingComplete(false)} className="ui-btn-ghost">
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {dateAnchor && (
        <DatePickerPopover
          anchor={dateAnchor}
          label="Session date"
          kind="date"
          value={session.scheduledFor}
          clearLabel={null}
          presets={sessionDatePresets(today, detail.series.preferredWeekday, (iso) => {
            setDateAnchor(null);
            if (iso !== session.scheduledFor) patch({ scheduledFor: iso });
          })}
          onAccelerator={(key) => {
            const preset = sessionDatePresets(today, detail.series.preferredWeekday, () => undefined).find((entry) => entry.hint === key.toLowerCase());
            if (!preset) return false;
            setDateAnchor(null);
            preset.onSelect();
            return true;
          }}
          onCommit={(value) => {
            setDateAnchor(null);
            if (value && value !== session.scheduledFor) patch({ scheduledFor: value });
          }}
          onClose={() => setDateAnchor(null)}
        />
      )}

      <form
        className="mb-3"
        onSubmit={(event) => {
          event.preventDefault();
          submitAction();
        }}
      >
        <div
          className="flex items-center gap-2 rounded-lg pl-2.5 pr-1 transition-[border-color,box-shadow] focus-within:border-[var(--border-active)] focus-within:shadow-[0_0_0_3px_color-mix(in_srgb,var(--accent)_10%,transparent)]"
          style={{ background: 'var(--bg-primary)', border: '1px solid var(--border)' }}
        >
          <input
            value={actionDraft}
            onChange={(event) => setActionDraft(event.target.value)}
            placeholder={`Action item for ${firstName}…`}
            className="h-8 min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-[var(--text-placeholder)]"
            style={{ color: 'var(--text-primary)' }}
            aria-label="Add action item"
          />
          <button
            type="submit"
            disabled={!actionDraft.trim() || createAction.isPending}
            className="ui-icon-btn h-7 w-7 disabled:opacity-40"
            aria-label="Create action item"
            title="Create a task for them and put it on the agenda"
          >
            <Plus size={13} />
          </button>
        </div>
      </form>

      <div className="flex min-h-0 flex-1 flex-col" data-testid="one-on-one-notes">
        <div className="mb-1 flex items-center gap-1.5 text-[12px] font-medium" style={{ color: 'var(--text-muted)' }}>
          <Lock size={11} aria-hidden="true" />
          Private notes
        </div>
        <div className="one-on-one-notes min-h-0 flex-1 overflow-y-auto">
          <NoteEditor
            ref={editorRef}
            value={notes}
            onChange={onNotesChange}
            onBlur={() => persist()}
            handlers={handlers}
            entityContext={entityContext}
            placeholder={`What's on ${firstName}'s mind? Wins, blockers, growth… Type / for commands`}
            ariaLabel="Session notes"
            omit={['update', 'wrap-up']}
          />
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]" style={{ color: 'var(--text-muted)' }}>
          <span aria-live="polite" data-testid="one-on-one-save-state">
            {saveState === 'saving' || saveState === 'dirty'
              ? 'Saving…'
              : saveState === 'error'
                ? <span style={{ color: 'var(--danger)' }}>Not saved — keep typing to retry</span>
                : saveState === 'saved' && savedAt
                  ? `Saved ${savedAt}`
                  : 'Saved as you type'}
          </span>
          <span className="hidden items-center gap-1 sm:inline-flex">
            <KeySpec keys="⌘ ⇧ E" variant="subtle" /> line → action item
          </span>
          <span className="hidden items-center gap-1 xl:inline-flex">
            <KeySpec keys="⌘ ⇧ L" variant="subtle" /> my follow-up
          </span>
        </div>
      </div>
    </div>
  );
}
