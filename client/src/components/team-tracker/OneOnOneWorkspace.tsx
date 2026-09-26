import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, ChevronDown, ChevronRight, GripVertical, Plus, X } from 'lucide-react';
import {
  useCreateOneOnOneSeries,
  useCreateOneOnOneSession,
  useCreateOneOnOneSessionAction,
  useDetachOneOnOneAgendaItem,
  useAttachOneOnOneAgendaItem,
  useOneOnOneSeries,
  useOneOnOneSeriesForDeveloper,
  useReorderOneOnOneAgenda,
  useUpdateOneOnOneSeries,
  useUpdateOneOnOneSession,
} from '@/hooks/useOneOnOne';
import { useToast } from '@/context/ToastContext';
import { renderMarkdownLite } from '@/components/assistant/markdown-lite';
import type {
  OneOnOneAgendaItem,
  OneOnOneCadence,
  OneOnOneSeriesDetail,
  OneOnOneSession,
  TaskStatus,
} from '@/types';

const OPEN_STATUSES: ReadonlySet<TaskStatus> = new Set(['open', 'active', 'blocked']);

const CADENCE_OPTIONS: Array<{ value: OneOnOneCadence; label: string }> = [
  { value: 'weekly', label: 'Weekly' },
  { value: 'biweekly', label: 'Every 2 weeks' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'ad_hoc', label: 'Ad hoc' },
];

const WEEKDAY_OPTIONS = [
  { value: -1, label: 'Any weekday' },
  { value: 0, label: 'Sunday' },
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' },
];

const STATUS_TONES: Record<OneOnOneSession['status'], { label: string; color: string }> = {
  scheduled: { label: 'Scheduled', color: 'var(--accent)' },
  done: { label: 'Done', color: 'var(--success, #22c55e)' },
  skipped: { label: 'Skipped', color: 'var(--text-muted)' },
};

interface OneOnOneWorkspaceProps {
  developerAccountId: string;
  onClose: () => void;
  onOpenTask?: (taskKey: string) => void;
}

/**
 * docs/48 §4.2: the manager-private 1:1 workspace — Agenda | Session |
 * History inside the Team surface (`/team?dev=<id>&panel=one-on-one`).
 * Esc returns to the board (URL state lives in App.tsx).
 */
export function OneOnOneWorkspace({ developerAccountId, onClose, onOpenTask }: OneOnOneWorkspaceProps) {
  const { addToast } = useToast();
  const { series, isLoading } = useOneOnOneSeriesForDeveloper(developerAccountId);
  const detail = useOneOnOneSeries(series?.id);
  const createSeries = useCreateOneOnOneSeries();
  const [newCadence, setNewCadence] = useState<OneOnOneCadence>('weekly');

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const startSeries = useCallback(() => {
    createSeries.mutate(
      { developerAccountId, cadence: newCadence },
      { onError: (error) => addToast(error instanceof Error ? error.message : 'Could not create the 1:1 series', 'error') },
    );
  }, [addToast, createSeries, developerAccountId, newCadence]);

  if (isLoading) {
    return <WorkspaceFrame name="" onClose={onClose}><PanelMessage>Loading 1:1…</PanelMessage></WorkspaceFrame>;
  }

  if (!series) {
    return (
      <WorkspaceFrame name="1:1" onClose={onClose}>
        <PanelMessage>
          <div className="text-[14px] font-semibold" style={{ color: 'var(--text-primary)' }}>
            No 1:1 series yet
          </div>
          <div className="mt-1 text-[13px]" style={{ color: 'var(--text-muted)' }}>
            Start a recurring 1:1 to keep a persistent agenda and private notes.
          </div>
          <div className="mt-4 flex items-center justify-center gap-2">
            <select
              value={newCadence}
              onChange={(event) => setNewCadence(event.target.value as OneOnOneCadence)}
              className="h-8 rounded-lg px-2 text-[12px]"
              style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
              aria-label="Cadence"
            >
              {CADENCE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={startSeries}
              disabled={createSeries.isPending}
              className="h-8 rounded-lg px-3 text-[12px] font-semibold disabled:opacity-50"
              style={{ background: 'var(--accent)', color: '#fff' }}
            >
              {createSeries.isPending ? 'Starting…' : 'Start 1:1 series'}
            </button>
          </div>
        </PanelMessage>
      </WorkspaceFrame>
    );
  }

  if (!detail.data) {
    return (
      <WorkspaceFrame name={series.developerName} onClose={onClose}>
        <PanelMessage>{detail.isError ? 'Could not load the 1:1 workspace.' : 'Loading 1:1…'}</PanelMessage>
      </WorkspaceFrame>
    );
  }

  return <Workspace detail={detail.data} onClose={onClose} onOpenTask={onOpenTask} />;
}

function WorkspaceFrame({ name, onClose, children }: { name: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="one-on-one-workspace">
      <div className="mb-3 flex items-center gap-2">
        <div
          className="h-8 w-8 rounded-lg flex items-center justify-center shrink-0"
          style={{ background: 'var(--bg-tertiary)', color: 'var(--accent)', border: '1px solid var(--border)' }}
        >
          <CalendarDays size={14} />
        </div>
        <div className="min-w-0">
          <div className="truncate text-[15px] font-semibold" style={{ color: 'var(--text-primary)' }}>
            {name ? `1:1 — ${name}` : '1:1'}
          </div>
          <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
            Manager-private agenda, notes, and history
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="ml-auto flex h-8 items-center gap-1 rounded-lg px-2.5 text-[12px] font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--border-active)]"
          style={{ background: 'transparent', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}
          aria-label="Close 1:1 workspace"
          title="Close (Esc)"
        >
          <X size={12} />
          Close
        </button>
      </div>
      {children}
    </div>
  );
}

function PanelMessage({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="flex flex-1 items-center justify-center rounded-xl border px-4 py-10 text-center"
      style={{ borderColor: 'var(--border)', background: 'color-mix(in srgb, var(--bg-secondary) 72%, transparent)' }}
    >
      <div className="text-[13px]" style={{ color: 'var(--text-muted)' }}>{children}</div>
    </div>
  );
}

function Workspace({ detail, onClose, onOpenTask }: { detail: OneOnOneSeriesDetail; onClose: () => void; onOpenTask?: (taskKey: string) => void }) {
  return (
    <WorkspaceFrame name={detail.series.developerName} onClose={onClose}>
      <SeriesControls detail={detail} />
      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-3">
        <AgendaColumn detail={detail} onOpenTask={onOpenTask} />
        <SessionColumn detail={detail} />
        <HistoryColumn detail={detail} />
      </div>
    </WorkspaceFrame>
  );
}

function SeriesControls({ detail }: { detail: OneOnOneSeriesDetail }) {
  const { addToast } = useToast();
  const updateSeries = useUpdateOneOnOneSeries(detail.series.id);
  const onError = (error: unknown) => addToast(error instanceof Error ? error.message : 'Could not update the series', 'error');
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 text-[12px]" style={{ color: 'var(--text-secondary)' }}>
      <select
        value={detail.series.cadence}
        onChange={(event) => updateSeries.mutate({ cadence: event.target.value as OneOnOneCadence }, { onError })}
        className="h-7 rounded-md px-1.5 text-[12px]"
        style={{ background: 'transparent', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}
        aria-label="Cadence"
      >
        {CADENCE_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
      <select
        value={detail.series.preferredWeekday ?? -1}
        onChange={(event) => {
          const value = Number(event.target.value);
          updateSeries.mutate({ preferredWeekday: value < 0 ? null : value }, { onError });
        }}
        className="h-7 rounded-md px-1.5 text-[12px]"
        style={{ background: 'transparent', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}
        aria-label="Preferred weekday"
      >
        {WEEKDAY_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
      <label className="flex items-center gap-1.5" style={{ color: 'var(--text-muted)' }}>
        <input
          type="checkbox"
          checked={detail.series.active}
          onChange={(event) => updateSeries.mutate({ active: event.target.checked }, { onError })}
        />
        Active
      </label>
    </div>
  );
}

// ── Column 1: Agenda ──

function AgendaColumn({ detail, onOpenTask }: { detail: OneOnOneSeriesDetail; onOpenTask?: (taskKey: string) => void }) {
  const { addToast } = useToast();
  const seriesId = detail.series.id;
  const attach = useAttachOneOnOneAgendaItem(seriesId);
  const reorder = useReorderOneOnOneAgenda(seriesId);
  const detach = useDetachOneOnOneAgendaItem(seriesId);
  const [draft, setDraft] = useState('');
  const [dragId, setDragId] = useState<number | null>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const openItems = useMemo(
    () => detail.agenda.filter((item) => OPEN_STATUSES.has(item.task.status) && !item.task.deletedAt),
    [detail.agenda],
  );

  const moveTo = useCallback(
    (itemIds: number[]) => {
      reorder.mutate(
        { itemIds },
        { onError: (error) => addToast(error instanceof Error ? error.message : 'Could not reorder the agenda', 'error') },
      );
    },
    [addToast, reorder],
  );

  const moveBy = useCallback(
    (itemId: number, direction: -1 | 1) => {
      const ids = openItems.map((item) => item.id);
      const index = ids.indexOf(itemId);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= ids.length) return;
      [ids[index], ids[target]] = [ids[target]!, ids[index]!];
      moveTo(ids);
    },
    [moveTo, openItems],
  );

  const submitDraft = useCallback(() => {
    const title = draft.trim();
    if (!title || attach.isPending) return;
    attach.mutate(
      { title },
      {
        onSuccess: () => setDraft(''),
        onError: (error) => addToast(error instanceof Error ? error.message : 'Could not add to the agenda', 'error'),
      },
    );
  }, [addToast, attach, draft]);

  return (
    <section
      className="flex min-h-0 flex-col rounded-xl border p-3"
      style={{ borderColor: 'var(--border)', background: 'color-mix(in srgb, var(--bg-secondary) 72%, transparent)' }}
      aria-label="1:1 agenda"
    >
      <ColumnHeader title="Agenda" count={openItems.length} />
      <form
        className="mb-2"
        onSubmit={(event) => {
          event.preventDefault();
          submitDraft();
        }}
      >
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Add to agenda…"
          className="h-8 w-full rounded-lg px-2.5 text-[12px] outline-none focus:ring-2 focus:ring-[var(--border-active)]"
          style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
          aria-label="Add to agenda"
        />
      </form>
      <ul ref={listRef} className="flex-1 space-y-1 overflow-y-auto" data-testid="one-on-one-agenda">
        {openItems.map((item) => (
          <AgendaRow
            key={item.id}
            item={item}
            dragId={dragId}
            onDragStart={() => setDragId(item.id)}
            onDragEnd={() => setDragId(null)}
            onDrop={(targetId) => {
              if (dragId === null || dragId === targetId) return;
              const ids = openItems.map((entry) => entry.id);
              const from = ids.indexOf(dragId);
              const to = ids.indexOf(targetId);
              if (from < 0 || to < 0) return;
              ids.splice(to, 0, ...ids.splice(from, 1));
              moveTo(ids);
            }}
            onMoveBy={moveBy}
            onDetach={(itemId) =>
              detach.mutate(itemId, {
                onError: (error) => addToast(error instanceof Error ? error.message : 'Could not remove the item', 'error'),
              })
            }
            onOpenTask={onOpenTask}
          />
        ))}
        {openItems.length === 0 && (
          <li className="rounded-lg border border-dashed px-3 py-6 text-center text-[12px]" style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}>
            Nothing on the agenda yet.
          </li>
        )}
      </ul>
      <div className="mt-2 text-[10px]" style={{ color: 'var(--text-muted)' }}>
        Drag to reorder, or focus a row and press Alt+↑/↓.
      </div>
    </section>
  );
}

function AgendaRow({
  item,
  dragId,
  onDragStart,
  onDragEnd,
  onDrop,
  onMoveBy,
  onDetach,
  onOpenTask,
}: {
  item: OneOnOneAgendaItem;
  dragId: number | null;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDrop: (targetId: number) => void;
  onMoveBy: (itemId: number, direction: -1 | 1) => void;
  onDetach: (itemId: number) => void;
  onOpenTask?: (taskKey: string) => void;
}) {
  return (
    <li
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        onDrop(item.id);
      }}
      tabIndex={0}
      onKeyDown={(event) => {
        if (!event.altKey) return;
        if (event.key === 'ArrowUp') {
          event.preventDefault();
          onMoveBy(item.id, -1);
        } else if (event.key === 'ArrowDown') {
          event.preventDefault();
          onMoveBy(item.id, 1);
        }
      }}
      className="group flex items-center gap-1.5 rounded-lg border px-2 py-1.5 outline-none focus:ring-2 focus:ring-[var(--border-active)]"
      style={{
        borderColor: 'var(--border)',
        background: dragId === item.id ? 'color-mix(in srgb, var(--accent) 8%, transparent)' : 'var(--bg-primary)',
        opacity: dragId === item.id ? 0.6 : 1,
      }}
      data-testid={`agenda-item-${item.id}`}
    >
      <GripVertical size={12} className="shrink-0 cursor-grab" style={{ color: 'var(--text-muted)' }} />
      <button
        type="button"
        className="min-w-0 flex-1 text-left"
        onClick={() => onOpenTask?.(item.task.taskKey)}
      >
        <span className="mr-1.5 font-mono text-[10px]" style={{ color: 'var(--accent)' }}>
          {item.task.taskKey}
        </span>
        <span className="text-[12px]" style={{ color: 'var(--text-primary)' }}>
          {item.task.title}
        </span>
        {item.carriedFrom && (
          <span className="ml-1.5 rounded px-1 py-px text-[10px]" style={{ background: 'color-mix(in srgb, var(--accent) 12%, transparent)', color: 'var(--accent)' }}>
            carried from {item.carriedFrom}
          </span>
        )}
      </button>
      <button
        type="button"
        onClick={() => onDetach(item.id)}
        className="h-5 w-5 shrink-0 rounded opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
        style={{ color: 'var(--text-muted)' }}
        aria-label={`Remove ${item.task.taskKey} from agenda`}
        title="Remove from agenda"
      >
        <X size={11} />
      </button>
    </li>
  );
}

// ── Column 2: Session ──

function SessionColumn({ detail }: { detail: OneOnOneSeriesDetail }) {
  const { addToast } = useToast();
  const seriesId = detail.series.id;
  const session = detail.upcoming;
  const updateSession = useUpdateOneOnOneSession(seriesId);
  const createSession = useCreateOneOnOneSession(seriesId);
  const createAction = useCreateOneOnOneSessionAction(seriesId);
  const [confirmingComplete, setConfirmingComplete] = useState(false);
  const [scheduleDate, setScheduleDate] = useState('');
  const [actionDraft, setActionDraft] = useState('');
  const [notes, setNotes] = useState(session?.notes ?? '');
  const notesSessionRef = useRef<number | undefined>(session?.id);
  const notesTimer = useRef<ReturnType<typeof setTimeout>>();

  // Only resync the notes buffer when the live session changes — never on
  // refetch, so an in-flight autosave can't clobber typing.
  useEffect(() => {
    if (session?.id !== notesSessionRef.current) {
      notesSessionRef.current = session?.id;
      setNotes(session?.notes ?? '');
    }
  }, [session?.id, session?.notes]);

  useEffect(() => () => {
    if (notesTimer.current) clearTimeout(notesTimer.current);
  }, []);

  const onNotesChange = useCallback(
    (value: string) => {
      setNotes(value);
      if (!session) return;
      if (notesTimer.current) clearTimeout(notesTimer.current);
      notesTimer.current = setTimeout(() => {
        updateSession.mutate(
          { sessionId: session.id, notes: value },
          { onError: (error) => addToast(error instanceof Error ? error.message : 'Could not save notes', 'error') },
        );
      }, 800);
    },
    [addToast, session, updateSession],
  );

  const patch = useCallback(
    (body: { status?: 'done' | 'skipped'; scheduledFor?: string; started?: boolean; reopenCarried?: boolean }) => {
      if (!session) return;
      updateSession.mutate(
        { sessionId: session.id, ...body },
        { onError: (error) => addToast(error instanceof Error ? error.message : 'Could not update the session', 'error') },
      );
    },
    [addToast, session, updateSession],
  );

  const submitAction = useCallback(() => {
    const title = actionDraft.trim();
    if (!title || !session || createAction.isPending) return;
    createAction.mutate(
      { sessionId: session.id, title },
      {
        onSuccess: () => setActionDraft(''),
        onError: (error) => addToast(error instanceof Error ? error.message : 'Could not create the action item', 'error'),
      },
    );
  }, [actionDraft, addToast, createAction, session]);

  const openCount = detail.agenda.filter((item) => OPEN_STATUSES.has(item.task.status) && !item.task.deletedAt).length;

  return (
    <section
      className="flex min-h-0 flex-col rounded-xl border p-3"
      style={{ borderColor: 'var(--border)', background: 'color-mix(in srgb, var(--bg-secondary) 72%, transparent)' }}
      aria-label="1:1 session"
    >
      <ColumnHeader title="Session" />
      {!session ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
          <div className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
            {detail.series.active ? 'No session scheduled.' : 'Series is paused.'}
          </div>
          <div className="flex items-center gap-1.5">
            <input
              type="date"
              value={scheduleDate}
              onChange={(event) => setScheduleDate(event.target.value)}
              className="h-8 rounded-lg px-2 text-[12px] font-mono outline-none"
              style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
              aria-label="Session date"
            />
            <button
              type="button"
              onClick={() =>
                createSession.mutate(
                  { scheduledFor: scheduleDate || undefined },
                  { onError: (error) => addToast(error instanceof Error ? error.message : 'Could not schedule the session', 'error') },
                )
              }
              disabled={createSession.isPending}
              className="h-8 rounded-lg px-3 text-[12px] font-semibold disabled:opacity-50"
              style={{ background: 'var(--accent)', color: '#fff' }}
            >
              Schedule
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="mb-2 flex items-center gap-2">
            <input
              type="date"
              value={session.scheduledFor}
              onChange={(event) => {
                if (event.target.value) patch({ scheduledFor: event.target.value });
              }}
              className="h-8 rounded-lg px-2 text-[12px] font-mono outline-none"
              style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
              aria-label="Session date"
            />
            {session.startedAt && (
              <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold" style={{ background: 'color-mix(in srgb, var(--accent) 14%, transparent)', color: 'var(--accent)' }}>
                Live
              </span>
            )}
            <div className="ml-auto flex items-center gap-1">
              {!session.startedAt && (
                <button type="button" onClick={() => patch({ started: true })} className="h-7 rounded-md px-2 text-[11px] font-semibold" style={{ background: 'var(--accent)', color: '#fff' }}>
                  Start
                </button>
              )}
              <button
                type="button"
                onClick={() => setConfirmingComplete(true)}
                className="h-7 rounded-md px-2 text-[11px] font-semibold"
                style={{ background: 'color-mix(in srgb, var(--success, #22c55e) 14%, transparent)', color: 'var(--success, #22c55e)', border: '1px solid color-mix(in srgb, var(--success, #22c55e) 30%, transparent)' }}
              >
                Complete
              </button>
              <button
                type="button"
                onClick={() => patch({ status: 'skipped' })}
                className="h-7 rounded-md px-2 text-[11px] font-medium"
                style={{ background: 'transparent', color: 'var(--text-muted)', border: '1px solid var(--border)' }}
              >
                Skip
              </button>
            </div>
          </div>
          {confirmingComplete && (
            <div className="mb-2 rounded-lg border px-2.5 py-2 text-[12px]" style={{ borderColor: 'var(--border)', background: 'var(--bg-primary)' }}>
              <div style={{ color: 'var(--text-primary)' }}>
                {openCount > 0 ? `Keep the ${openCount} open agenda item${openCount === 1 ? '' : 's'} on the agenda?` : 'Complete this session?'}
              </div>
              <div className="mt-1.5 flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    setConfirmingComplete(false);
                    patch({ status: 'done', reopenCarried: true });
                  }}
                  className="h-7 rounded-md px-2 text-[11px] font-semibold"
                  style={{ background: 'var(--accent)', color: '#fff' }}
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
                    className="h-7 rounded-md px-2 text-[11px] font-medium"
                    style={{ background: 'transparent', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}
                  >
                    Detach items — complete
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setConfirmingComplete(false)}
                  className="h-7 rounded-md px-2 text-[11px]"
                  style={{ color: 'var(--text-muted)' }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
          <form
            className="mb-2"
            onSubmit={(event) => {
              event.preventDefault();
              submitAction();
            }}
          >
            <div className="flex items-center gap-1.5">
              <input
                value={actionDraft}
                onChange={(event) => setActionDraft(event.target.value)}
                placeholder="Add action item…"
                className="h-8 flex-1 rounded-lg px-2.5 text-[12px] outline-none focus:ring-2 focus:ring-[var(--border-active)]"
                style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
                aria-label="Add action item"
              />
              <button
                type="submit"
                disabled={!actionDraft.trim() || createAction.isPending}
                className="h-8 w-8 rounded-lg flex items-center justify-center disabled:opacity-40"
                style={{ background: 'var(--bg-tertiary)', color: 'var(--accent)', border: '1px solid var(--border)' }}
                aria-label="Create action item"
                title="Create action item"
              >
                <Plus size={13} />
              </button>
            </div>
          </form>
          <textarea
            value={notes}
            onChange={(event) => onNotesChange(event.target.value)}
            placeholder="Private running notes (markdown, autosaved)…"
            className="min-h-[160px] flex-1 resize-none rounded-lg px-2.5 py-2 text-[12px] leading-5 outline-none focus:ring-2 focus:ring-[var(--border-active)]"
            style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
            aria-label="Session notes"
          />
          <div className="mt-1.5 text-[10px]" style={{ color: 'var(--text-muted)' }}>
            {updateSession.isPending ? 'Saving…' : 'Notes autosave.'}
          </div>
        </>
      )}
    </section>
  );
}

// ── Column 3: History ──

function HistoryColumn({ detail }: { detail: OneOnOneSeriesDetail }) {
  const closed = detail.sessions.filter((session) => session.status !== 'scheduled');
  return (
    <section
      className="flex min-h-0 flex-col rounded-xl border p-3"
      style={{ borderColor: 'var(--border)', background: 'color-mix(in srgb, var(--bg-secondary) 72%, transparent)' }}
      aria-label="1:1 history"
    >
      <ColumnHeader title="History" count={closed.length} />
      <ul className="flex-1 space-y-1 overflow-y-auto" data-testid="one-on-one-history">
        {closed.map((session) => (
          <HistoryRow key={session.id} session={session} />
        ))}
        {closed.length === 0 && (
          <li className="rounded-lg border border-dashed px-3 py-6 text-center text-[12px]" style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}>
            No past sessions yet.
          </li>
        )}
      </ul>
    </section>
  );
}

function HistoryRow({ session }: { session: OneOnOneSession }) {
  const [expanded, setExpanded] = useState(false);
  const tone = STATUS_TONES[session.status];
  const preview = session.notes.trim().slice(0, 140);
  return (
    <li className="rounded-lg border px-2.5 py-2" style={{ borderColor: 'var(--border)', background: 'var(--bg-primary)' }}>
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full items-center gap-2 text-left"
        aria-expanded={expanded}
      >
        {expanded ? <ChevronDown size={12} style={{ color: 'var(--text-muted)' }} /> : <ChevronRight size={12} style={{ color: 'var(--text-muted)' }} />}
        <span className="font-mono text-[11px]" style={{ color: 'var(--text-primary)' }}>
          {session.scheduledFor}
        </span>
        <span className="rounded px-1.5 py-px text-[10px] font-semibold" style={{ color: tone.color, background: `color-mix(in srgb, ${tone.color} 12%, transparent)` }}>
          {tone.label}
        </span>
        <span className="ml-auto text-[10px]" style={{ color: 'var(--text-muted)' }}>
          {session.agendaCount} on agenda
        </span>
      </button>
      {!expanded && preview && (
        <div className="mt-1 truncate pl-5 text-[11px]" style={{ color: 'var(--text-muted)' }}>
          {preview}
        </div>
      )}
      {expanded && (
        <div className="mt-1.5 whitespace-pre-wrap pl-5 text-[12px] leading-5" style={{ color: 'var(--text-secondary)' }}>
          {session.notes.trim() ? renderMarkdownLite(session.notes) : 'No notes.'}
        </div>
      )}
    </li>
  );
}

function ColumnHeader({ title, count }: { title: string; count?: number }) {
  return (
    <div className="mb-2 flex items-center gap-2">
      <h2 className="text-[12px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-secondary)' }}>
        {title}
      </h2>
      {count !== undefined && (
        <span className="rounded px-1.5 py-px text-[10px] font-mono" style={{ background: 'var(--bg-tertiary)', color: 'var(--text-muted)' }}>
          {count}
        </span>
      )}
    </div>
  );
}
