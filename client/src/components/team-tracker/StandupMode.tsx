import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Activity,
  AlertTriangle,
  ArrowLeftRight,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CirclePlus,
  Keyboard,
  MessageSquarePlus,
  UserRoundCheck,
  X,
} from 'lucide-react';
import type {
  StandupFeedEntry,
  SurfaceTask,
  TeamTrackerBoardResponse,
  TrackerDeveloperDay,
  TrackerDeveloperStatus,
  TrackerWorkItem,
} from '@/types';
import { useStandupFeed } from '@/hooks/useTeamTracker';
import {
  useAddCheckIn,
  useReassignTrackerItem,
  useSetCurrentItem,
  useStatusUpdate,
} from '@/hooks/useTeamTrackerMutations';
import { useUpdateTaskDetail } from '@/hooks/useTaskDetail';
import { useDevelopers } from '@/hooks/useDevelopers';
import { useModalFocus } from '@/hooks/useModalFocus';
import { useToast } from '@/context/ToastContext';
import { formatRelativeTime } from '@/lib/utils';
import { TaskUpdateComposer } from '@/components/tasks/TaskUpdateComposer';
import { taskKeysForSubmit, type TaskPickerTask } from '@/components/tasks/TaskPicker';
import { CaptureBox } from '@/components/capture/CaptureBox';
import { StatusRationaleDialog } from './StatusRationaleDialog';
import { TrackerStatusPill } from './TrackerStatusPill';

/**
 * Phase 3 (P3-D5/D6, §6): keyboard-driven standup. One developer at a time,
 * ordered the same way the board is sorted; a rolling-window feed (24h, 72h
 * on Mondays) sits beside the person's tasks. All writes reuse the canonical
 * task/event/check-in paths — nothing here bypasses them.
 */
interface StandupModeProps {
  date: string;
  board: TeamTrackerBoardResponse;
  onClose: () => void;
  onOpenTask: (taskKey: string) => void;
  /** Pause the keymap while a drawer/dialog stacked above standup owns input. */
  suspended?: boolean;
}

type StandupLayer = 'none' | 'capture' | 'status' | 'reassign' | 'checkin' | 'help';

interface FocusedTask {
  taskKey: string;
  title: string;
  status: 'open' | 'active' | 'blocked';
}

const OPENISH = new Set(['open', 'active', 'blocked']);

function focusedTasksFor(day: TrackerDeveloperDay | undefined): FocusedTask[] {
  if (!day) return [];
  if (day.tasks?.length) {
    return day.tasks
      .filter((task): task is SurfaceTask => OPENISH.has(task.status))
      .sort((left, right) => left.position - right.position)
      .map((task) => ({ taskKey: task.taskKey, title: task.title, status: task.status as FocusedTask['status'] }));
  }
  const fromItems = (items: Array<TrackerWorkItem | undefined>, status: FocusedTask['status']) =>
    items.flatMap((item) => (item?.taskKey ? [{ taskKey: item.taskKey, title: item.title, status }] : []));
  return [...fromItems([day.currentItem], 'active'), ...fromItems(day.plannedItems, 'open')];
}

const STATUS_OPTIONS: TrackerDeveloperStatus[] = ['on_track', 'at_risk', 'blocked', 'waiting', 'done_for_today'];
const STATUS_LABELS: Record<TrackerDeveloperStatus, string> = {
  on_track: 'On track',
  at_risk: 'At risk',
  blocked: 'Blocked',
  waiting: 'Waiting',
  done_for_today: 'Done for today',
};
const DIALOG_STATUSES: TrackerDeveloperStatus[] = ['at_risk', 'blocked', 'waiting'];

const KEY_HELP: Array<[string, string]> = [
  ['→ / n', 'Next developer'],
  ['← / p', 'Previous developer'],
  ['j / k', 'Next / previous task'],
  ['u', 'Log a task update'],
  ['c', 'General remark (check-in)'],
  ['v', 'Composer shared ↔ private'],
  ['s', 'Set as current'],
  ['d', 'Done'],
  ['b', 'Blocked (rationale)'],
  ['a', 'Add a task (@dev)'],
  ['r', 'Reassign'],
  ['y', 'Accept status suggestion'],
  ['Enter', 'Open task drawer'],
  ['?', 'Keyboard shortcuts'],
  ['Esc', 'Close layer / exit'],
];

function feedIcon(entry: StandupFeedEntry) {
  if (entry.kind === 'checkin') return <MessageSquarePlus size={11} />;
  switch (entry.type) {
    case 'status': return <Activity size={11} />;
    case 'blocker': return <AlertTriangle size={11} />;
    case 'assign': return <UserRoundCheck size={11} />;
    case 'created': return <CirclePlus size={11} />;
    default: return <MessageSquarePlus size={11} />;
  }
}

const getInitials = (name: string) =>
  name.split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase();

export function StandupMode({ date, board, onClose, onOpenTask, suspended = false }: StandupModeProps) {
  const { addToast } = useToast();
  // P3-D5: standup order follows the board's active sort/saved view.
  const ordered = board.developers;
  const [devIndex, setDevIndex] = useState(0);
  const [taskIndex, setTaskIndex] = useState(0);
  const [layer, setLayer] = useState<StandupLayer>('none');
  const [pendingStatus, setPendingStatus] = useState<TrackerDeveloperStatus | null>(null);
  const [statusPreselect, setStatusPreselect] = useState<string[]>([]);
  const [checkInText, setCheckInText] = useState('');
  const [visited, setVisited] = useState<Set<string>>(new Set());
  const [announcement, setAnnouncement] = useState('');

  const composerApi = useRef<{ expand: () => void; focus: () => void; togglePrivate: () => void } | null>(null);
  const taskRowRefs = useRef(new Map<string, HTMLButtonElement>());
  const checkInRef = useRef<HTMLTextAreaElement>(null);

  const day = ordered[Math.min(devIndex, ordered.length - 1)];
  const accountId = day?.developer.accountId;
  const focusedTasks = useMemo(() => focusedTasksFor(day), [day]);
  const focusedTask = focusedTasks[Math.min(taskIndex, Math.max(focusedTasks.length - 1, 0))];
  const suggestion = day?.statusSuggestion;
  const pickerTasks: TaskPickerTask[] = focusedTasks.map((task) => ({ taskKey: task.taskKey, title: task.title }));

  const feed = useStandupFeed(accountId);
  const statusUpdate = useStatusUpdate(date);
  const addCheckIn = useAddCheckIn(date);
  const setCurrent = useSetCurrentItem(date);
  const reassign = useReassignTrackerItem(date);
  const updateTask = useUpdateTaskDetail(focusedTask?.taskKey);
  const developers = useDevelopers(date);

  const markVisited = useCallback(() => {
    if (!accountId) return;
    setVisited((current) => (current.has(accountId) ? current : new Set(current).add(accountId)));
  }, [accountId]);

  const focusRow = useCallback((taskKey?: string) => {
    window.setTimeout(() => {
      if (taskKey) taskRowRefs.current.get(taskKey)?.focus();
    }, 30);
  }, []);

  const closeLayer = useCallback(
    (mark = false) => {
      setLayer('none');
      setPendingStatus(null);
      if (mark) markVisited();
      focusRow(focusedTask?.taskKey);
    },
    [focusedTask?.taskKey, focusRow, markVisited],
  );

  const moveDeveloper = useCallback(
    (delta: number) => {
      if (!ordered.length) return;
      const next = Math.min(Math.max(devIndex + delta, 0), ordered.length - 1);
      if (next === devIndex) return;
      setDevIndex(next);
      setTaskIndex(0);
      const nextDay = ordered[next];
      if (nextDay) {
        setAnnouncement(`${nextDay.developer.displayName} — ${focusedTasksFor(nextDay).length} open tasks, status ${STATUS_LABELS[nextDay.status]}`);
      }
    },
    [devIndex, ordered],
  );

  const moveTask = useCallback(
    (delta: number) => {
      if (!focusedTasks.length) return;
      setTaskIndex((index) => Math.min(Math.max(index + delta, 0), focusedTasks.length - 1));
    },
    [focusedTasks.length],
  );

  const openStatusDialog = useCallback(
    (status: TrackerDeveloperStatus, preselect: string[] = []) => {
      setPendingStatus(status);
      setStatusPreselect(preselect);
      setLayer('status');
    },
    [],
  );

  const handleStatusSelect = useCallback(
    (status: TrackerDeveloperStatus) => {
      if (!day || status === day.status) return;
      if (DIALOG_STATUSES.includes(status)) {
        openStatusDialog(status, focusedTask ? [focusedTask.taskKey] : []);
        return;
      }
      statusUpdate.mutate(
        { accountId: day.developer.accountId, status },
        { onSuccess: markVisited, onError: (error) => addToast(error.message, 'error') },
      );
    },
    [day, focusedTask, openStatusDialog, statusUpdate, markVisited, addToast],
  );

  const submitCheckIn = useCallback(() => {
    const summary = checkInText.trim();
    if (!day || !summary) return;
    addCheckIn.mutate(
      { accountId: day.developer.accountId, summary, taskKeys: taskKeysForSubmit([], summary, pickerTasks) },
      {
        onSuccess: () => {
          setCheckInText('');
          closeLayer(true);
        },
        onError: (error) => addToast(error.message, 'error'),
      },
    );
  }, [addCheckIn, addToast, checkInText, closeLayer, day, pickerTasks]);

  // Keyboard map (§6.2) — plain keys only, inactive while a field or a
  // higher layer owns input. Esc closes the top layer; at root it exits.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
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

      switch (event.key) {
        case 'ArrowRight':
        case 'n':
          event.preventDefault();
          moveDeveloper(1);
          break;
        case 'ArrowLeft':
        case 'p':
          event.preventDefault();
          moveDeveloper(-1);
          break;
        case 'ArrowDown':
        case 'j':
          event.preventDefault();
          moveTask(1);
          break;
        case 'ArrowUp':
        case 'k':
          event.preventDefault();
          moveTask(-1);
          break;
        case 'u':
          event.preventDefault();
          composerApi.current?.expand();
          break;
        case 'v':
          event.preventDefault();
          composerApi.current?.togglePrivate();
          break;
        case 's':
          if (focusedTask) {
            event.preventDefault();
            setCurrent.mutate(focusedTask.taskKey, {
              onSuccess: markVisited,
              onError: (error) => addToast(error.message, 'error'),
            });
          }
          break;
        case 'd':
          if (focusedTask) {
            event.preventDefault();
            updateTask.mutate(
              { status: 'done' },
              {
                onSuccess: () => {
                  markVisited();
                  addToast({ type: 'success', title: `${focusedTask.taskKey} done` });
                },
                onError: (error) => addToast(error.message, 'error'),
              },
            );
          }
          break;
        case 'b':
          event.preventDefault();
          openStatusDialog('blocked', focusedTask ? [focusedTask.taskKey] : []);
          break;
        case 'a':
          event.preventDefault();
          setLayer('capture');
          break;
        case 'c':
          event.preventDefault();
          setLayer('checkin');
          window.setTimeout(() => checkInRef.current?.focus(), 40);
          break;
        case 'r':
          if (focusedTask) {
            event.preventDefault();
            setLayer('reassign');
          }
          break;
        case 'y':
          if (suggestion) {
            event.preventDefault();
            openStatusDialog(suggestion.status, [suggestion.reasonTaskKey]);
          }
          break;
        case 'Enter':
          if (focusedTask) {
            event.preventDefault();
            onOpenTask(focusedTask.taskKey);
          }
          break;
        case '?':
          event.preventDefault();
          setLayer('help');
          break;
        default:
          break;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    layer,
    suspended,
    focusedTask,
    suggestion,
    onClose,
    onOpenTask,
    moveDeveloper,
    moveTask,
    openStatusDialog,
    setCurrent,
    updateTask,
    markVisited,
    addToast,
  ]);

  if (!day) return null;

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

      {/* Header */}
      <div
        className="flex shrink-0 items-center gap-3 border-b px-4 py-2.5"
        style={{ borderColor: 'var(--border)', background: 'var(--bg-secondary)' }}
      >
        <div
          className="flex h-8 w-8 items-center justify-center rounded-lg"
          style={{ background: 'var(--accent-glow)', color: 'var(--accent)' }}
        >
          <ArrowLeftRight size={14} />
        </div>
        <div>
          <h1 className="text-[14px] font-semibold" style={{ color: 'var(--text-primary)' }}>
            Standup
          </h1>
          <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
            {date} · {visited.size}/{ordered.length} visited
          </div>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setLayer('help')}
            className="flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[12px] font-medium"
            style={{ color: 'var(--text-secondary)', border: '1px solid var(--border)' }}
            aria-label="Standup keyboard shortcuts"
          >
            <Keyboard size={12} />
            Keys
          </button>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[12px] font-medium"
            style={{ color: 'var(--text-secondary)', border: '1px solid var(--border)' }}
            aria-label="Exit standup mode"
          >
            <X size={12} />
            Exit
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Roster rail */}
        <div
          className="w-[230px] shrink-0 overflow-y-auto border-r py-2"
          style={{ borderColor: 'var(--border)', background: 'var(--bg-secondary)' }}
          role="listbox"
          aria-label="Standup order"
        >
          {ordered.map((entry, index) => {
            const active = index === devIndex;
            return (
              <button
                key={entry.developer.accountId}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => {
                  setDevIndex(index);
                  setTaskIndex(0);
                  setAnnouncement(`${entry.developer.displayName} — ${focusedTasksFor(entry).length} open tasks`);
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors"
                style={{
                  background: active ? 'var(--accent-glow)' : 'transparent',
                  borderLeft: `2px solid ${active ? 'var(--accent)' : 'transparent'}`,
                }}
              >
                <span
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[11px] font-bold"
                  style={{ background: 'var(--bg-tertiary)', color: 'var(--accent)', border: '1px solid var(--border)' }}
                >
                  {getInitials(entry.developer.displayName)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12px] font-semibold" style={{ color: 'var(--text-primary)' }}>
                    {entry.developer.displayName}
                  </span>
                  <span className="mt-0.5 block">
                    <TrackerStatusPill status={entry.status} />
                  </span>
                </span>
                {entry.statusSuggestion ? (
                  <AlertTriangle size={12} style={{ color: 'var(--warning)' }} aria-label="Status suggestion" />
                ) : visited.has(entry.developer.accountId) ? (
                  <Check size={12} style={{ color: 'var(--success)' }} aria-label="Visited" />
                ) : null}
              </button>
            );
          })}
        </div>

        {/* Focused developer panel */}
        <div className="grid min-w-0 flex-1 grid-cols-1 gap-4 overflow-y-auto p-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(280px,1fr)]">
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              <span
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-[14px] font-bold"
                style={{ background: 'var(--bg-tertiary)', color: 'var(--accent)', border: '1px solid var(--border)' }}
              >
                {getInitials(day.developer.displayName)}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-[16px] font-semibold" style={{ color: 'var(--text-primary)' }}>
                    {day.developer.displayName}
                  </span>
                  <TrackerStatusPill status={day.status} />
                </div>
                <div className="mt-1 flex items-center gap-2">
                  <select
                    value={day.status}
                    onChange={(event) => handleStatusSelect(event.target.value as TrackerDeveloperStatus)}
                    className="h-6 rounded-md px-1.5 text-[11px] font-medium outline-none"
                    style={{ background: 'var(--bg-tertiary)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}
                    aria-label="Set developer status"
                  >
                    {STATUS_OPTIONS.map((status) => (
                      <option key={status} value={status}>
                        {STATUS_LABELS[status]}
                      </option>
                    ))}
                  </select>
                  {day.lastCheckInAt ? (
                    <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                      Check-in {formatRelativeTime(day.lastCheckInAt)}
                    </span>
                  ) : (
                    <span className="text-[11px]" style={{ color: 'var(--warning)' }}>
                      No check-in yet
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => moveDeveloper(-1)}
                  disabled={devIndex === 0}
                  className="flex h-7 w-7 items-center justify-center rounded-md disabled:opacity-30"
                  style={{ color: 'var(--text-secondary)', border: '1px solid var(--border)' }}
                  aria-label="Previous developer"
                >
                  <ChevronLeft size={13} />
                </button>
                <button
                  type="button"
                  onClick={() => moveDeveloper(1)}
                  disabled={devIndex >= ordered.length - 1}
                  className="flex h-7 w-7 items-center justify-center rounded-md disabled:opacity-30"
                  style={{ color: 'var(--text-secondary)', border: '1px solid var(--border)' }}
                  aria-label="Next developer"
                >
                  <ChevronRight size={13} />
                </button>
              </div>
            </div>

            {/* P3-D11 hybrid status suggestion */}
            {suggestion && (
              <div
                className="mt-3 flex items-center gap-2 rounded-xl px-3 py-2"
                style={{ background: 'color-mix(in srgb, var(--warning) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--warning) 35%, transparent)' }}
                data-testid="status-suggestion"
              >
                <AlertTriangle size={13} style={{ color: 'var(--warning)' }} />
                <span className="min-w-0 flex-1 text-[12px]" style={{ color: 'var(--text-primary)' }}>
                  {suggestion.reasonTaskKey} is blocked
                  {suggestion.reasonTaskTitle ? ` — ${suggestion.reasonTaskTitle}` : ''}. Suggested status: blocked.
                </span>
                <button
                  type="button"
                  onClick={() => openStatusDialog('blocked', [suggestion.reasonTaskKey])}
                  className="shrink-0 rounded-md px-2 py-1 text-[11px] font-semibold"
                  style={{ background: 'var(--warning)', color: '#1a1300' }}
                >
                  Accept (y)
                </button>
              </div>
            )}

            {/* Tasks — roving tabindex focus target list */}
            <div className="mt-4">
              <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em]" style={{ color: 'var(--text-muted)' }}>
                Tasks · j/k to move
              </div>
              {focusedTasks.length === 0 ? (
                <div
                  className="rounded-xl px-3 py-4 text-center text-[12px]"
                  style={{ color: 'var(--text-muted)', background: 'var(--bg-secondary)', border: '1px solid var(--border)' }}
                >
                  No open tasks — press a to add one.
                </div>
              ) : (
                <div className="space-y-1.5" role="listbox" aria-label={`${day.developer.displayName}'s tasks`}>
                  {focusedTasks.map((task, index) => {
                    const focused = index === taskIndex;
                    return (
                      <button
                        key={task.taskKey}
                        type="button"
                        role="option"
                        aria-selected={focused}
                        tabIndex={focused ? 0 : -1}
                        ref={(el) => {
                          if (el) taskRowRefs.current.set(task.taskKey, el);
                          else taskRowRefs.current.delete(task.taskKey);
                        }}
                        onClick={() => setTaskIndex(index)}
                        onDoubleClick={() => onOpenTask(task.taskKey)}
                        className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--border-active)]"
                        style={{
                          background: focused ? 'var(--accent-glow)' : 'var(--bg-secondary)',
                          border: `1px solid ${focused ? 'var(--accent)' : 'var(--border)'}`,
                        }}
                      >
                        <span className="font-mono text-[11px] font-bold" style={{ color: 'var(--accent)' }}>
                          {task.taskKey}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-[13px] font-medium" style={{ color: 'var(--text-primary)' }}>
                          {task.title}
                        </span>
                        {task.status === 'active' && (
                          <span
                            className="shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase"
                            style={{ background: 'var(--accent-glow)', color: 'var(--accent)' }}
                          >
                            Current
                          </span>
                        )}
                        {task.status === 'blocked' && (
                          <span
                            className="shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase"
                            style={{ background: 'color-mix(in srgb, var(--danger) 12%, transparent)', color: 'var(--danger)' }}
                          >
                            Blocked
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Composer on the focused task (u / v) */}
            {focusedTask ? (
              <div className="mt-3">
                <TaskUpdateComposer
                  taskKey={focusedTask.taskKey}
                  mode="manager"
                  via="standup"
                  collapsed
                  placeholder={`Update ${focusedTask.taskKey}…`}
                  registerComposer={(api) => {
                    composerApi.current = api;
                  }}
                />
              </div>
            ) : null}

            <div className="mt-3 text-[11px] leading-5" style={{ color: 'var(--text-muted)' }}>
              u update · c check-in · s current · d done · b blocked · a add task · r reassign · Enter open · ? keys
            </div>
          </div>

          {/* Rolling-window feed (P3-D6) */}
          <div className="min-w-0">
            <div className="mb-1.5 flex items-baseline justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-[0.08em]" style={{ color: 'var(--text-muted)' }}>
                Since last standup
              </span>
              {feed.data && (
                <span className="text-[10px] tabular-nums" style={{ color: 'var(--text-muted)' }}>
                  {feed.data.windowHours}h window
                </span>
              )}
            </div>
            <div
              className="max-h-[calc(100vh-220px)] overflow-y-auto rounded-xl p-2"
              style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)' }}
            >
              {feed.isLoading ? (
                <div className="px-2 py-6 text-center text-[12px]" style={{ color: 'var(--text-muted)' }}>
                  Loading feed…
                </div>
              ) : feed.isError ? (
                <div className="px-2 py-6 text-center text-[12px]" style={{ color: 'var(--danger)' }}>
                  Feed unavailable.
                </div>
              ) : feed.data && feed.data.entries.length === 0 ? (
                <div className="px-2 py-6 text-center text-[12px]" style={{ color: 'var(--text-muted)' }}>
                  Nothing since the window started.
                </div>
              ) : (
                <div className="space-y-1">
                  {feed.data?.entries.map((entry) => (
                    <div key={entry.id} className="flex items-start gap-2 rounded-lg px-2 py-1.5" style={{ background: 'transparent' }}>
                      <span className="mt-0.5 shrink-0" style={{ color: entry.type === 'blocker' ? 'var(--danger)' : 'var(--text-muted)' }}>
                        {feedIcon(entry)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          {entry.taskKey && (
                            <button
                              type="button"
                              onClick={() => onOpenTask(entry.taskKey!)}
                              className="shrink-0 font-mono text-[10px] font-bold"
                              style={{ color: 'var(--accent)' }}
                            >
                              {entry.taskKey}
                            </button>
                          )}
                          <span className="text-[10px] tabular-nums" style={{ color: 'var(--text-muted)' }}>
                            {formatRelativeTime(entry.occurredAt)}
                          </span>
                          {entry.kind === 'checkin' && (
                            <span className="text-[10px] font-semibold uppercase" style={{ color: 'var(--info)' }}>
                              check-in
                            </span>
                          )}
                        </div>
                        <div className="truncate text-[12px]" style={{ color: 'var(--text-secondary)' }}>
                          {entry.kind === 'checkin' ? entry.summary : entry.body ?? entry.taskTitle ?? entry.type}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Layers */}
      <AnimatePresence>
        {layer === 'capture' && day && (
          <LayerShell onClose={() => closeLayer(true)} label={`Add a task for ${day.developer.displayName}`}>
            <CaptureBox prefill={`@${day.developer.accountId} `} onClose={() => closeLayer(true)} />
          </LayerShell>
        )}
        {layer === 'checkin' && day && (
          <LayerShell onClose={() => closeLayer()} label={`Check-in for ${day.developer.displayName}`}>
            <div className="space-y-2 px-4 py-3">
              <textarea
                ref={checkInRef}
                value={checkInText}
                onChange={(event) => setCheckInText(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    submitCheckIn();
                  }
                  if (event.key === 'Escape') {
                    event.stopPropagation();
                    closeLayer();
                  }
                }}
                rows={3}
                placeholder="General remark — lands as a check-in on today’s record…"
                className="w-full resize-none rounded-lg px-3 py-2 text-[13px] leading-5 outline-none"
                style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
              />
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={submitCheckIn}
                  disabled={!checkInText.trim() || addCheckIn.isPending}
                  className="rounded-lg px-3 py-1.5 text-[12px] font-semibold disabled:opacity-40"
                  style={{ background: 'var(--accent)', color: '#fff' }}
                >
                  {addCheckIn.isPending ? 'Saving…' : 'Save check-in'}
                </button>
              </div>
            </div>
          </LayerShell>
        )}
        {layer === 'reassign' && day && focusedTask && (
          <LayerShell onClose={() => closeLayer()} label={`Reassign ${focusedTask.taskKey}`}>
            <div className="max-h-[300px] overflow-y-auto px-2 py-2">
              {(developers.data ?? [])
                .filter((dev) => dev.accountId !== day.developer.accountId)
                .map((dev) => (
                  <button
                    key={dev.accountId}
                    type="button"
                    onClick={() =>
                      reassign.mutate(
                        { itemId: focusedTask.taskKey, toAccountId: dev.accountId },
                        {
                          onSuccess: () => closeLayer(true),
                          onError: (error) => addToast(error.message, 'error'),
                        },
                      )
                    }
                    disabled={reassign.isPending}
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-[13px] transition-colors hover:bg-[var(--bg-tertiary)] disabled:opacity-50"
                    style={{ color: 'var(--text-primary)' }}
                  >
                    <span
                      className="flex h-6 w-6 items-center justify-center rounded-md text-[10px] font-bold"
                      style={{ background: 'var(--bg-tertiary)', color: 'var(--accent)' }}
                    >
                      {getInitials(dev.displayName)}
                    </span>
                    {dev.displayName}
                  </button>
                ))}
            </div>
          </LayerShell>
        )}
        {layer === 'help' && (
          <LayerShell onClose={() => closeLayer()} label="Standup keyboard shortcuts">
            <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 px-4 py-3">
              {KEY_HELP.map(([key, description]) => (
                <div key={key} className="flex items-center gap-2">
                  <kbd
                    className="min-w-[44px] rounded-md px-1.5 py-0.5 text-center font-mono text-[11px] font-semibold"
                    style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
                  >
                    {key}
                  </kbd>
                  <span className="text-[12px]" style={{ color: 'var(--text-secondary)' }}>
                    {description}
                  </span>
                </div>
              ))}
            </div>
          </LayerShell>
        )}
      </AnimatePresence>

      {pendingStatus && day && (
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
          onSubmit={({ rationale, taskKey, nextFollowUpAt }) =>
            statusUpdate.mutate(
              { accountId: day.developer.accountId, status: pendingStatus, rationale, taskKey, nextFollowUpAt },
              {
                onSuccess: () => {
                  statusUpdate.reset();
                  closeLayer(true);
                },
              },
            )
          }
        />
      )}
    </motion.div>
  );
}

/** Small modal shell for capture / check-in / reassign / help layers. */
function LayerShell({ children, onClose, label }: { children: React.ReactNode; onClose: () => void; label: string }) {
  // §6.2: Tab/Shift+Tab stay inside the top layer; focus returns to the
  // standup surface when it unmounts.
  const panelRef = useModalFocus<HTMLDivElement>();
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [onClose]);

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15 }}
        className="fixed inset-0 z-[70]"
        style={{ background: 'rgba(6, 10, 15, 0.45)', backdropFilter: 'blur(4px)' }}
        onClick={onClose}
      />
      <div className="pointer-events-none fixed inset-0 z-[71] flex items-start justify-center pt-[14vh]">
        <motion.div
          ref={panelRef}
          initial={{ opacity: 0, y: 14, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8, scale: 0.97 }}
          transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
          className="pointer-events-auto w-[calc(100%-2rem)] max-w-[560px] overflow-hidden rounded-2xl"
          role="dialog"
          aria-modal="true"
          aria-label={label}
          style={{
            background: 'var(--bg-secondary)',
            border: '1px solid color-mix(in srgb, var(--accent) 16%, var(--border-strong) 84%)',
            boxShadow: '0 24px 64px rgba(0, 0, 0, 0.4)',
          }}
          onClick={(event) => event.stopPropagation()}
        >
          <div
            className="flex items-center justify-between px-4 py-2.5 text-[12px] font-semibold"
            style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-primary)' }}
          >
            {label}
            <button
              type="button"
              onClick={onClose}
              className="flex h-6 w-6 items-center justify-center rounded-md"
              style={{ color: 'var(--text-muted)' }}
              aria-label="Close"
            >
              <X size={13} />
            </button>
          </div>
          {children}
        </motion.div>
      </div>
    </>
  );
}
