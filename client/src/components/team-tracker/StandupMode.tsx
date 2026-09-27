import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { format, parseISO } from 'date-fns';
import { ArrowLeftRight, History, Keyboard, ListChecks, X } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import type { RecordStandupSessionResponse, TeamTrackerBoardResponse, TrackerDeveloperStatus } from '@/types';
import { api } from '@/lib/api';
import { useLatestStandupSession, useStandupFeed } from '@/hooks/useTeamTracker';
import {
  useAddCheckIn,
  useReassignTrackerItem,
  useSetCurrentItem,
  useStatusUpdate,
} from '@/hooks/useTeamTrackerMutations';
import { useUpdateTaskDetail } from '@/hooks/useTaskDetail';
import { useDevelopers } from '@/hooks/useDevelopers';
import { useToast } from '@/context/ToastContext';
import { useScopedStorageKey } from '@/lib/scoped-storage';
import {
  buildStandupSummary,
  dayStats,
  doneTodayFor,
  EMPTY_STANDUP_SESSION,
  feedActiveTaskKeys,
  loadStandupSession,
  openTasksFor,
  saveStandupSession,
  standupSessionReducer,
  type StandupLogKind,
} from '@/lib/standup';
import { TaskUpdateComposer } from '@/components/tasks/TaskUpdateComposer';
import { taskKeysForSubmit, type TaskPickerTask } from '@/components/tasks/TaskPicker';
import { CaptureBox } from '@/components/capture/CaptureBox';
import { StatusRationaleDialog } from './StatusRationaleDialog';
import { StandupRail } from './standup/StandupRail';
import { StandupPersonHeader, STATUS_LABELS } from './standup/StandupPersonHeader';
import { StandupTaskList } from './standup/StandupTaskList';
import { StandupFeed } from './standup/StandupFeed';
import { StandupActionBar, type StandupActionGroup } from './standup/StandupActionBar';
import { StandupWrapUp } from './standup/StandupWrapUp';
import { CheckInForm, KeyHelpGrid, LayerShell, ReassignList } from './standup/StandupLayers';
import { StandupHistory } from './standup/StandupHistory';
import { Kbd } from './standup/StandupPrimitives';

/**
 * Phase 3 (P3-D5/D6, §6) + docs/50: keyboard-driven standup. One developer
 * at a time, ordered the same way the board is sorted; a "since last standup"
 * feed (anchored to the manager's last sealed session, else a rolling
 * 24h/72h-Monday fallback) sits beside the person's tasks. A client-side
 * session tracks who was reviewed and what was logged; End seals it into a
 * durable `standup_sessions` row, creates follow-up tasks for flagged people,
 * and archives the summary on today's note (docs/50 v2).
 * All writes reuse the canonical task/event/check-in paths — nothing here
 * bypasses them.
 */
interface StandupModeProps {
  date: string;
  board: TeamTrackerBoardResponse;
  onClose: () => void;
  onOpenTask: (taskKey: string) => void;
  /** Pause the keymap while a drawer/dialog stacked above standup owns input. */
  suspended?: boolean;
}

type StandupLayer = 'none' | 'capture' | 'status' | 'reassign' | 'checkin' | 'help' | 'history';
type StandupView = 'person' | 'wrapup';

const DIALOG_STATUSES: TrackerDeveloperStatus[] = ['at_risk', 'blocked', 'waiting'];

function formatStandupDate(date: string): string {
  try {
    return format(parseISO(date), 'EEE, MMM d');
  } catch {
    return date;
  }
}

export function StandupMode({ date, board, onClose, onOpenTask, suspended = false }: StandupModeProps) {
  const { addToast } = useToast();
  const reduceMotion = useReducedMotion();
  // P3-D5: standup order follows the board's active sort/saved view.
  const ordered = board.developers;

  // docs/50 S1: session survives accidental exits for the same date.
  const storageKey = useScopedStorageKey(`standup-session:${date}`);
  const [session, dispatch] = useReducer(standupSessionReducer, storageKey, loadStandupSession);
  useEffect(() => saveStandupSession(storageKey, session), [storageKey, session]);
  const reviewed = useMemo(() => new Set(session.reviewed), [session.reviewed]);
  const flagged = useMemo(() => new Set(session.flagged), [session.flagged]);

  // Track the person by id, not index: a status change can re-sort the board.
  const [currentId, setCurrentId] = useState<string | null>(() => {
    const resume = ordered.find((entry) => !session.reviewed.includes(entry.developer.accountId)) ?? ordered[0];
    return resume?.developer.accountId ?? null;
  });
  const [view, setView] = useState<StandupView>(() =>
    ordered.length > 0 && ordered.every((entry) => session.reviewed.includes(entry.developer.accountId)) ? 'wrapup' : 'person',
  );
  const [taskIndex, setTaskIndex] = useState(0);
  const [layer, setLayer] = useState<StandupLayer>('none');
  const [pendingStatus, setPendingStatus] = useState<TrackerDeveloperStatus | null>(null);
  const [statusPreselect, setStatusPreselect] = useState<string[]>([]);
  const [checkInText, setCheckInText] = useState('');
  const [announcement, setAnnouncement] = useState('');
  const [sealing, setSealing] = useState(false);
  const queryClient = useQueryClient();

  const composerApi = useRef<{ expand: () => void; focus: () => void; togglePrivate: () => void } | null>(null);
  const taskRowRefs = useRef(new Map<string, HTMLButtonElement>());
  const checkInRef = useRef<HTMLTextAreaElement>(null);

  const foundIndex = ordered.findIndex((entry) => entry.developer.accountId === currentId);
  const devIndex = foundIndex >= 0 ? foundIndex : 0;
  const day = ordered[devIndex];
  const accountId = day?.developer.accountId;
  const openTasks = useMemo(() => openTasksFor(day), [day]);
  const doneToday = useMemo(() => doneTodayFor(day), [day]);
  const stats = useMemo(() => (day ? dayStats(day, date) : null), [day, date]);
  const focusedTask = openTasks[Math.min(taskIndex, Math.max(openTasks.length - 1, 0))];
  const suggestion = day?.statusSuggestion;
  const pickerTasks: TaskPickerTask[] = openTasks.map((task) => ({ taskKey: task.taskKey, title: task.title }));
  const isFlagged = accountId ? flagged.has(accountId) : false;

  const feed = useStandupFeed(accountId);
  const latestSession = useLatestStandupSession(layer === 'history');
  const activeKeys = useMemo(() => feedActiveTaskKeys(feed.data?.entries ?? []), [feed.data]);
  const statusUpdate = useStatusUpdate(date);
  const addCheckIn = useAddCheckIn(date);
  const setCurrent = useSetCurrentItem(date);
  const reassign = useReassignTrackerItem(date);
  const updateTask = useUpdateTaskDetail(focusedTask?.taskKey);
  const developers = useDevelopers(date);

  // Resolve a stored accountId to a display name for the previous-round view —
  // board days first, then the full developer list for people off today's board.
  const nameFor = useCallback(
    (id: string) =>
      ordered.find((entry) => entry.developer.accountId === id)?.developer.displayName
      ?? (developers.data ?? []).find((dev) => dev.accountId === id)?.displayName
      ?? id,
    [ordered, developers.data],
  );

  const log = useCallback((target: string, kind: StandupLogKind, taskKey?: string, detail?: string) => {
    dispatch({ type: 'log', entry: { accountId: target, kind, taskKey, detail, at: new Date().toISOString() } });
  }, []);

  const focusRow = useCallback((taskKey?: string) => {
    window.setTimeout(() => {
      if (taskKey) taskRowRefs.current.get(taskKey)?.focus();
    }, 30);
  }, []);

  const closeLayer = useCallback(() => {
    setLayer('none');
    setPendingStatus(null);
    focusRow(focusedTask?.taskKey);
  }, [focusedTask?.taskKey, focusRow]);

  const goToDeveloper = useCallback(
    (id: string) => {
      const target = ordered.find((entry) => entry.developer.accountId === id);
      if (!target) return;
      // docs/50 S2: leaving someone counts as reviewing them; jumps don't mark the skipped.
      if (view === 'person' && accountId && id !== accountId) dispatch({ type: 'review', accountId, at: new Date().toISOString() });
      setCurrentId(id);
      setTaskIndex(0);
      setView('person');
      setAnnouncement(
        `${target.developer.displayName} — ${openTasksFor(target).length} open tasks, status ${STATUS_LABELS[target.status]}`,
      );
    },
    [ordered, view, accountId],
  );

  const openWrapUp = useCallback(() => {
    if (view === 'person' && accountId) dispatch({ type: 'review', accountId, at: new Date().toISOString() });
    setView('wrapup');
    setLayer('none');
    setAnnouncement('Standup wrap-up');
  }, [view, accountId]);

  const moveDeveloper = useCallback(
    (delta: number) => {
      if (!ordered.length) return;
      if (view === 'wrapup') {
        if (delta < 0) {
          setView('person');
          if (day) setAnnouncement(day.developer.displayName);
        }
        return;
      }
      const next = devIndex + delta;
      if (next < 0) return;
      if (next >= ordered.length) {
        openWrapUp();
        return;
      }
      goToDeveloper(ordered[next]!.developer.accountId);
    },
    [ordered, view, day, devIndex, openWrapUp, goToDeveloper],
  );

  const moveTask = useCallback(
    (delta: number) => {
      if (!openTasks.length) return;
      setTaskIndex((index) => Math.min(Math.max(index + delta, 0), openTasks.length - 1));
    },
    [openTasks.length],
  );

  const focusTaskByKey = useCallback(
    (taskKey: string) => {
      const index = openTasks.findIndex((task) => task.taskKey === taskKey);
      if (index < 0) {
        onOpenTask(taskKey);
        return;
      }
      setTaskIndex(index);
      focusRow(taskKey);
    },
    [openTasks, onOpenTask, focusRow],
  );

  const openStatusDialog = useCallback((status: TrackerDeveloperStatus, preselect: string[] = []) => {
    setPendingStatus(status);
    setStatusPreselect(preselect);
    setLayer('status');
  }, []);

  const handleStatusSelect = useCallback(
    (status: TrackerDeveloperStatus) => {
      if (!day || status === day.status) return;
      if (DIALOG_STATUSES.includes(status)) {
        openStatusDialog(status, focusedTask ? [focusedTask.taskKey] : []);
        return;
      }
      const target = day.developer.accountId;
      statusUpdate.mutate(
        { accountId: target, status },
        {
          onSuccess: () => log(target, 'status', undefined, STATUS_LABELS[status]),
          onError: (error) => addToast(error.message, 'error'),
        },
      );
    },
    [day, focusedTask, openStatusDialog, statusUpdate, log, addToast],
  );

  const submitCheckIn = useCallback(() => {
    const summary = checkInText.trim();
    if (!day || !summary) return;
    const target = day.developer.accountId;
    addCheckIn.mutate(
      { accountId: target, summary, taskKeys: taskKeysForSubmit([], summary, pickerTasks) },
      {
        onSuccess: () => {
          log(target, 'checkin');
          setCheckInText('');
          closeLayer();
        },
        onError: (error) => addToast(error.message, 'error'),
      },
    );
  }, [addCheckIn, addToast, checkInText, closeLayer, day, pickerTasks, log]);

  const copySummary = useCallback(() => {
    const text = buildStandupSummary({ date, days: ordered, session });
    const write = navigator.clipboard?.writeText(text);
    if (!write) {
      addToast('Clipboard is unavailable in this browser.', 'error');
      return;
    }
    write.then(
      () => addToast({ type: 'success', title: 'Standup summary copied' }),
      () => addToast('Could not copy the summary.', 'error'),
    );
  }, [date, ordered, session, addToast]);

  const resetSession = useCallback(() => {
    dispatch({ type: 'reset' });
    setCurrentId(ordered[0]?.developer.accountId ?? null);
    setTaskIndex(0);
    setView('person');
  }, [ordered]);

  /**
   * docs/50 v2: "End standup" seals the round — one durable session record
   * (which also anchors the next "since last standup" feed), a follow-up task
   * per flagged person created server-side, and the summary appended to
   * today's private note. The client session is cleared so the next standup
   * starts fresh; Esc/Exit still leaves without sealing.
   */
  const endStandup = useCallback(async () => {
    if (sealing) return;
    // Ending an untouched session is just exit — an empty seal would anchor
    // everyone's feed to a meaningless timestamp.
    if (!session.reviewed.length && !session.flagged.length && !session.log.length) {
      onClose();
      return;
    }
    setSealing(true);
    try {
      const summary = buildStandupSummary({ date, days: ordered, session });
      const result = await api.post<RecordStandupSessionResponse>('/team-tracker/standup/session', {
        date,
        startedAt: session.startedAt ?? new Date().toISOString(),
        reviewed: session.reviewed,
        flagged: session.flagged,
        log: session.log,
        summary,
        requestId: crypto.randomUUID(),
      });
      try {
        await api.post(`/notes/${encodeURIComponent(date)}/append`, { text: summary, requestId: crypto.randomUUID() });
      } catch {
        addToast('Standup recorded, but the summary could not be saved to notes.', 'error');
      }
      // Clear storage synchronously before unmounting — a dispatch alone races
      // with onClose(): the save effect may never run for the empty session,
      // leaving the sealed round resumable on the next entry.
      saveStandupSession(storageKey, EMPTY_STANDUP_SESSION);
      dispatch({ type: 'reset' });
      for (const key of ['team-tracker', 'tasks', 'daily-notes', 'today']) {
        void queryClient.invalidateQueries({ queryKey: [key] });
      }
      const followUps = result.followUps.length;
      addToast(
        `Standup recorded${followUps ? ` — ${followUps} follow-up${followUps === 1 ? '' : 's'} created` : ''}`,
        'success',
      );
      onClose();
    } catch (error) {
      addToast(error instanceof Error ? error.message : 'Could not end standup', 'error');
    } finally {
      setSealing(false);
    }
  }, [sealing, date, ordered, session, storageKey, queryClient, addToast, onClose]);

  // ── Actions: shared by the keymap and the action bar (S7) ──────────────
  const actions = {
    update: () => composerApi.current?.expand(),
    togglePrivate: () => composerApi.current?.togglePrivate(),
    setCurrent: () => {
      if (!focusedTask || !accountId) return;
      const { taskKey } = focusedTask;
      const target = accountId;
      setCurrent.mutate(taskKey, {
        onSuccess: () => log(target, 'current', taskKey),
        onError: (error) => addToast(error.message, 'error'),
      });
    },
    done: () => {
      if (!focusedTask || !accountId) return;
      const { taskKey } = focusedTask;
      const target = accountId;
      updateTask.mutate(
        { status: 'done' },
        {
          onSuccess: () => {
            log(target, 'done', taskKey);
            addToast({ type: 'success', title: `${taskKey} done` });
          },
          onError: (error) => addToast(error.message, 'error'),
        },
      );
    },
    blocked: () => openStatusDialog('blocked', focusedTask ? [focusedTask.taskKey] : []),
    add: () => setLayer('capture'),
    checkIn: () => {
      setLayer('checkin');
      window.setTimeout(() => checkInRef.current?.focus(), 40);
    },
    reassign: () => {
      if (focusedTask) setLayer('reassign');
    },
    accept: () => {
      if (suggestion) openStatusDialog(suggestion.status, [suggestion.reasonTaskKey]);
    },
    open: () => {
      if (focusedTask) onOpenTask(focusedTask.taskKey);
    },
    flag: () => {
      if (!day) return;
      dispatch({ type: 'toggle_flag', accountId: day.developer.accountId, at: new Date().toISOString() });
      setAnnouncement(`${day.developer.displayName} ${isFlagged ? 'unflagged' : 'flagged for follow-up'}`);
    },
    wrapUp: () => (view === 'wrapup' ? moveDeveloper(-1) : openWrapUp()),
    help: () => setLayer('help'),
  };

  // Keyboard map (§6.2) — plain keys only, inactive while a field or a
  // higher layer owns input. Esc closes the top layer; at root it exits.
  // The listener reads the latest render's handlers through a ref so it is
  // bound once.
  const keyHandlerRef = useRef<(event: KeyboardEvent) => void>(() => {});
  useLayoutEffect(() => {
    keyHandlerRef.current = (event: KeyboardEvent) => {
      if (suspended || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      const inField =
        target instanceof HTMLElement &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable);

      if (event.key === 'Escape') {
        // Layer dialogs (status, capture, check-in) close themselves; the
        // root level is the only place Esc exits standup.
        if (layer === 'none' && !inField) {
          event.preventDefault();
          onClose();
        }
        return;
      }
      if (layer !== 'none' || inField) return;

      const run = (fn: () => void) => {
        event.preventDefault();
        fn();
      };

      if (view === 'wrapup') {
        switch (event.key) {
          case 'ArrowLeft':
          case 'p':
            return run(() => moveDeveloper(-1));
          case 'w':
            return run(actions.wrapUp);
          case '?':
            return run(actions.help);
          case 'Enter':
            // Let a focused button handle its own Enter.
            if (target?.closest('button, a')) return;
            return run(() => void endStandup());
          default:
            return;
        }
      }

      switch (event.key) {
        case 'ArrowRight':
        case 'n':
          return run(() => moveDeveloper(1));
        case 'ArrowLeft':
        case 'p':
          return run(() => moveDeveloper(-1));
        case 'ArrowDown':
        case 'j':
          return run(() => moveTask(1));
        case 'ArrowUp':
        case 'k':
          return run(() => moveTask(-1));
        case 'u':
          return run(actions.update);
        case 'v':
          return run(actions.togglePrivate);
        case 's':
          if (focusedTask) run(actions.setCurrent);
          return;
        case 'd':
          if (focusedTask) run(actions.done);
          return;
        case 'b':
          return run(actions.blocked);
        case 'a':
          return run(actions.add);
        case 'c':
          return run(actions.checkIn);
        case 'r':
          if (focusedTask) run(actions.reassign);
          return;
        case 'y':
          if (suggestion) run(actions.accept);
          return;
        case 'f':
          return run(actions.flag);
        case 'w':
          return run(actions.wrapUp);
        case 'Enter':
          if (focusedTask) run(actions.open);
          return;
        case '?':
          return run(actions.help);
        default:
          return;
      }
    };
  });
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => keyHandlerRef.current(event);
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const reviewedCount = ordered.filter((entry) => reviewed.has(entry.developer.accountId)).length;
  const progress = ordered.length ? reviewedCount / ordered.length : 0;
  const allReviewed = ordered.length > 0 && reviewedCount === ordered.length;

  const actionGroups: StandupActionGroup[] = view === 'wrapup'
    ? [
        { label: 'Session', actions: [
          { keys: ['←'], label: 'Back to review', onRun: () => moveDeveloper(-1) },
          { keys: ['↵'], label: 'End standup', onRun: () => void endStandup(), emphasis: true },
          { keys: ['?'], label: 'Keys', onRun: actions.help },
        ] },
      ]
    : [
        { label: 'Move', actions: [
          { keys: ['j', 'k'], label: 'Task', onRun: () => moveTask(1), disabled: openTasks.length < 2 },
          { keys: ['←', '→'], label: 'Person', onRun: () => moveDeveloper(1) },
        ] },
        { label: 'Task', actions: [
          { keys: ['u'], label: 'Update', onRun: actions.update, disabled: !focusedTask },
          { keys: ['s'], label: 'Current', onRun: actions.setCurrent, disabled: !focusedTask || focusedTask.status === 'active' },
          { keys: ['d'], label: 'Done', onRun: actions.done, disabled: !focusedTask },
          { keys: ['b'], label: 'Blocked', onRun: actions.blocked },
          { keys: ['r'], label: 'Reassign', onRun: actions.reassign, disabled: !focusedTask },
          { keys: ['↵'], label: 'Open', onRun: actions.open, disabled: !focusedTask },
        ] },
        { label: 'Person', actions: [
          { keys: ['c'], label: 'Check-in', onRun: actions.checkIn },
          { keys: ['a'], label: 'Add task', onRun: actions.add },
          { keys: ['f'], label: isFlagged ? 'Unflag' : 'Flag', onRun: actions.flag, emphasis: isFlagged },
          ...(suggestion ? [{ keys: ['y'], label: 'Accept suggestion', onRun: actions.accept, emphasis: true }] : []),
        ] },
        { label: 'Session', actions: [
          { keys: ['w'], label: 'Wrap-up', onRun: actions.wrapUp, emphasis: allReviewed },
          { keys: ['?'], label: 'Keys', onRun: actions.help },
        ] },
      ];

  if (!day || !stats) {
    return (
      <div className="fixed inset-0 z-[60] flex items-center justify-center" style={{ background: 'var(--bg-primary)' }} role="dialog" aria-modal="true" aria-label="Standup mode" data-testid="standup-mode">
        <div className="max-w-sm rounded-2xl px-6 py-8 text-center" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)' }}>
          <h1 className="text-[15px] font-semibold" style={{ color: 'var(--text-primary)' }}>Standup</h1>
          <p className="mt-1.5 text-[12.5px]" style={{ color: 'var(--text-muted)' }}>No one on the board for this view. Add developers or loosen the board filters.</p>
          <button type="button" onClick={onClose} className="mt-4 rounded-lg px-3 py-1.5 text-[12px] font-semibold" style={{ color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>
            Exit
          </button>
        </div>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[60] flex flex-col"
      style={{ background: 'var(--bg-primary)' }}
      role="dialog"
      aria-modal="true"
      aria-label="Standup mode"
      data-testid="standup-mode"
    >
      <div aria-live="polite" className="sr-only">
        {announcement}
      </div>

      {/* Top bar */}
      <header
        className="flex shrink-0 items-center gap-4 border-b px-4 py-2.5"
        style={{ borderColor: 'var(--border)', background: 'var(--bg-secondary)' }}
      >
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ background: 'var(--accent-glow)', color: 'var(--accent)' }}>
            <ArrowLeftRight size={14} />
          </div>
          <div>
            <h1 className="text-[14px] font-semibold leading-tight" style={{ color: 'var(--text-primary)' }}>
              Standup
            </h1>
            <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
              {formatStandupDate(date)}
            </div>
          </div>
        </div>

        <div className="ml-2 hidden min-w-0 flex-1 items-center gap-3 sm:flex" data-testid="standup-progress">
          <div
            className="h-1.5 w-full max-w-[220px] overflow-hidden rounded-full"
            style={{ background: 'var(--bg-tertiary)' }}
            role="progressbar"
            aria-label="Developers reviewed"
            aria-valuemin={0}
            aria-valuemax={ordered.length}
            aria-valuenow={reviewedCount}
          >
            <motion.div
              className="h-full rounded-full"
              initial={false}
              animate={{ width: `${progress * 100}%` }}
              transition={reduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 220, damping: 30 }}
              style={{ background: allReviewed ? 'var(--success)' : 'var(--accent)' }}
            />
          </div>
          <span className="shrink-0 text-[12px] tabular-nums" style={{ color: 'var(--text-secondary)' }}>
            <span className="font-semibold" style={{ color: allReviewed ? 'var(--success)' : 'var(--text-primary)' }}>{reviewedCount}</span> of {ordered.length} reviewed
            {session.flagged.length > 0 && (
              <span style={{ color: 'var(--text-muted)' }}> · {session.flagged.length} flagged</span>
            )}
          </span>
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          <TopButton onClick={() => setLayer('history')} label="Previous standup round">
            <History size={13} />
            <span className="hidden sm:inline">Last round</span>
          </TopButton>
          <TopButton onClick={actions.wrapUp} label="Wrap-up" pressed={view === 'wrapup'} accent={allReviewed && view !== 'wrapup'}>
            <ListChecks size={13} />
            <span className="hidden sm:inline">Wrap-up</span>
          </TopButton>
          <TopButton onClick={actions.help} label="Standup keyboard shortcuts">
            <Keyboard size={13} />
            <Kbd subtle>?</Kbd>
          </TopButton>
          <TopButton onClick={onClose} label="Exit standup mode">
            <X size={13} />
            <span className="hidden sm:inline">Exit</span>
            <Kbd subtle>Esc</Kbd>
          </TopButton>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <StandupRail
          days={ordered}
          currentId={accountId ?? null}
          reviewed={reviewed}
          flagged={flagged}
          wrapUpActive={view === 'wrapup'}
          onSelect={goToDeveloper}
          onWrapUp={openWrapUp}
        />

        <main className="min-w-0 flex-1 overflow-y-auto lg:overflow-hidden">
          {view === 'wrapup' ? (
            <div className="h-full overflow-y-auto">
              <StandupWrapUp
                date={date}
                days={ordered}
                session={session}
                sealing={sealing}
                onJump={goToDeveloper}
                onBack={() => moveDeveloper(-1)}
                onEnd={() => void endStandup()}
                onCopy={copySummary}
                onReset={resetSession}
              />
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:h-full lg:grid-cols-[minmax(0,1fr)_minmax(320px,420px)]">
              <motion.div
                key={day.developer.accountId}
                initial={reduceMotion ? false : { opacity: 0, x: 8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                className="min-w-0 px-5 py-5 lg:overflow-y-auto lg:px-6"
              >
                <div className="mx-auto max-w-[860px] space-y-5">
                  <StandupPersonHeader
                    day={day}
                    stats={stats}
                    position={devIndex + 1}
                    total={ordered.length}
                    flagged={isFlagged}
                    onStatusSelect={handleStatusSelect}
                    onPrev={() => moveDeveloper(-1)}
                    onNext={() => moveDeveloper(1)}
                    onFocusCurrent={() => stats.current && focusTaskByKey(stats.current.taskKey)}
                    onAcceptSuggestion={actions.accept}
                  />
                  <StandupTaskList
                    ownerName={day.developer.displayName}
                    tasks={openTasks}
                    doneToday={doneToday}
                    focusedIndex={Math.min(taskIndex, Math.max(openTasks.length - 1, 0))}
                    activeKeys={activeKeys}
                    registerRow={(taskKey, el) => {
                      if (el) taskRowRefs.current.set(taskKey, el);
                      else taskRowRefs.current.delete(taskKey);
                    }}
                    onFocusIndex={setTaskIndex}
                    onOpen={onOpenTask}
                    onAdd={actions.add}
                    composer={
                      focusedTask ? (
                        <TaskUpdateComposer
                          taskKey={focusedTask.taskKey}
                          mode="manager"
                          via="standup"
                          collapsed
                          placeholder={`Update ${focusedTask.taskKey}… (u)`}
                          registerComposer={(api) => {
                            composerApi.current = api;
                          }}
                          onPosted={() => log(day.developer.accountId, 'update', focusedTask.taskKey)}
                        />
                      ) : null
                    }
                  />
                </div>
              </motion.div>

              <aside
                className="min-w-0 border-t px-5 py-5 lg:flex lg:flex-col lg:overflow-hidden lg:border-l lg:border-t-0"
                style={{ borderColor: 'var(--border)', background: 'color-mix(in srgb, var(--bg-secondary) 45%, transparent)' }}
              >
                <StandupFeed
                  data={feed.data}
                  isLoading={feed.isLoading}
                  isError={feed.isError}
                  onRetry={() => void feed.refetch()}
                  onSelectTask={focusTaskByKey}
                  onOpenTask={onOpenTask}
                />
              </aside>
            </div>
          )}
        </main>
      </div>

      <StandupActionBar groups={actionGroups} />

      {/* Layers */}
      <AnimatePresence>
        {layer === 'capture' && (
          <LayerShell onClose={closeLayer} label={`Add a task for ${day.developer.displayName}`}>
            <CaptureBox
              prefill={`@${day.developer.accountId} `}
              onClose={closeLayer}
              onCaptured={({ intent, taskKey }) => {
                if (intent === 'note') return;
                log(day.developer.accountId, intent === 'update' ? 'update' : 'added', taskKey);
              }}
            />
          </LayerShell>
        )}
        {layer === 'checkin' && (
          <LayerShell onClose={closeLayer} label={`Check-in for ${day.developer.displayName}`}>
            <CheckInForm
              inputRef={checkInRef}
              value={checkInText}
              pending={addCheckIn.isPending}
              onChange={setCheckInText}
              onSubmit={submitCheckIn}
              onCancel={closeLayer}
            />
          </LayerShell>
        )}
        {layer === 'reassign' && focusedTask && (
          <LayerShell onClose={closeLayer} label={`Reassign ${focusedTask.taskKey}`}>
            <ReassignList
              developers={(developers.data ?? []).filter((dev) => dev.accountId !== day.developer.accountId)}
              pending={reassign.isPending}
              onPick={(dev) => {
                const { taskKey } = focusedTask;
                const target = day.developer.accountId;
                reassign.mutate(
                  { itemId: taskKey, toAccountId: dev.accountId },
                  {
                    onSuccess: () => {
                      log(target, 'reassign', taskKey, dev.displayName);
                      closeLayer();
                    },
                    onError: (error) => addToast(error.message, 'error'),
                  },
                );
              }}
            />
          </LayerShell>
        )}
        {layer === 'help' && (
          <LayerShell onClose={closeLayer} label="Standup keyboard shortcuts">
            <KeyHelpGrid />
          </LayerShell>
        )}
        {layer === 'history' && (
          <LayerShell onClose={closeLayer} label="Previous standup">
            <StandupHistory
              session={latestSession.data?.session}
              isLoading={latestSession.isLoading}
              isError={latestSession.isError}
              onRetry={() => void latestSession.refetch()}
              nameFor={nameFor}
            />
          </LayerShell>
        )}
      </AnimatePresence>

      {pendingStatus && (
        <StatusRationaleDialog
          status={pendingStatus}
          developerName={day.developer.displayName}
          tasks={pickerTasks}
          initialSelectedKeys={statusPreselect}
          isPending={statusUpdate.isPending}
          error={statusUpdate.error?.message}
          onClose={() => {
            if (!statusUpdate.isPending) {
              statusUpdate.reset();
              closeLayer();
            }
          }}
          onSubmit={({ rationale, taskKey, nextFollowUpAt }) => {
            const status = pendingStatus;
            const target = day.developer.accountId;
            statusUpdate.mutate(
              { accountId: target, status, rationale, taskKey, nextFollowUpAt },
              {
                onSuccess: () => {
                  log(target, status === 'blocked' ? 'blocked' : 'status', taskKey, STATUS_LABELS[status]);
                  statusUpdate.reset();
                  closeLayer();
                },
              },
            );
          }}
        />
      )}
    </motion.div>
  );
}

function TopButton({
  onClick,
  label,
  pressed,
  accent,
  children,
}: {
  onClick: () => void;
  label: string;
  pressed?: boolean;
  accent?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={pressed}
      title={label}
      className="flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[12px] font-medium transition-colors hover:bg-[var(--bg-tertiary)]"
      style={{
        color: pressed || accent ? 'var(--accent)' : 'var(--text-secondary)',
        border: `1px solid ${pressed || accent ? 'color-mix(in srgb, var(--accent) 40%, transparent)' : 'var(--border)'}`,
        background: pressed ? 'var(--accent-glow)' : undefined,
      }}
    >
      {children}
    </button>
  );
}
