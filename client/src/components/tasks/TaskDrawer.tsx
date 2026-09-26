import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowUpRight,
  CalendarDays,
  ChevronRight,
  Flag,
  History,
  Link2,
  ListTree,
  Loader2,
  Maximize2,
  Plus,
  Trash2,
  UserCircle2,
  Users,
  X,
} from 'lucide-react';
import { navigateToTaskPage } from '@/lib/task-nav';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { useDevelopers } from '@/hooks/useDevelopers';
import { useModalFocus } from '@/hooks/useModalFocus';
import {
  useAddTaskDetailLink,
  useCreateChildTask,
  useDeleteTaskDetail,
  useRemoveTaskDetailLink,
  useTaskDetail,
  useUpdateTaskDetail,
} from '@/hooks/useTaskDetail';
import { getLocalIsoDate } from '@/lib/utils';
import { format, parseISO } from 'date-fns';
import type { TaskChildRef, TaskDetailResponse, TaskStatus, UpdateTaskRequest } from '@/types';
import { JiraIssueLink } from '@/components/JiraIssueLink';
import { TaskKeyChip } from './TaskKeyChip';
import { TaskLabelChip, TaskLabelPicker } from './TaskLabelPicker';
import { useTaskLabels } from '@/hooks/useTaskLabels';
import { parseCapture, resolveCapture } from 'shared/capture-grammar';
import { TaskTimeline } from './TaskTimeline';
import { TaskUpdateComposer } from './TaskUpdateComposer';

export type TaskDrawerMode = 'manager' | 'developer';

const STATUS_OPTIONS: { value: TaskStatus; label: string }[] = [
  { value: 'open', label: 'Open' },
  { value: 'active', label: 'Active' },
  { value: 'blocked', label: 'Blocked' },
  { value: 'done', label: 'Done' },
  { value: 'dropped', label: 'Dropped' },
];

function statusStyle(status: TaskStatus): Record<string, string> {
  switch (status) {
    case 'active': return { background: 'rgba(6,182,212,0.1)', color: 'var(--accent)', border: '1px solid rgba(6,182,212,0.22)' };
    case 'blocked': return { background: 'rgba(239,68,68,0.1)', color: 'var(--danger)', border: '1px solid rgba(239,68,68,0.2)' };
    case 'done': return { background: 'rgba(16,185,129,0.1)', color: 'var(--success)', border: '1px solid rgba(16,185,129,0.2)' };
    case 'dropped': return { background: 'var(--bg-tertiary)', color: 'var(--text-muted)', border: '1px solid var(--border)' };
    default: return { background: 'var(--bg-tertiary)', color: 'var(--text-secondary)', border: '1px solid var(--border)' };
  }
}

export { navigateToTaskPage };

interface TaskDrawerProps {
  taskKey: string | null;
  onClose: () => void;
  /** Navigate the drawer to another task (children, parent, linked tasks). */
  onNavigateTask?: (taskKey: string) => void;
  stacked?: boolean;
}

/**
 * Phase 3 (P3-D2): the single shared task drawer. Driven entirely by
 * `useTaskDetail` — it knows nothing about the surface that opened it. Manager
 * and developer principals get their own DTOs server-side; private fields and
 * controls are hidden for developers.
 */
export function TaskDrawer({ taskKey, onClose, onNavigateTask, stacked = false }: TaskDrawerProps) {
  const open = Boolean(taskKey);
  // §6.2: the drawer traps Tab while open and restores focus to the element
  // that opened it (a task row, deep-link target, or nothing) on close.
  const panelRef = useModalFocus<HTMLElement>(open);

  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      <>
        <motion.div
          key={`scrim-${taskKey}`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className={`workspace-shell-backdrop fixed inset-x-0 bottom-0 ${stacked ? 'z-[70]' : 'z-40'}`}
          style={{ background: 'rgba(2, 6, 23, 0.46)', backdropFilter: 'blur(3px)' }}
          onClick={onClose}
        />
        <motion.aside
          ref={panelRef}
          key={`panel-${taskKey}`}
          initial={{ x: '100%' }}
          animate={{ x: 0 }}
          exit={{ x: '100%' }}
          transition={{ type: 'spring', damping: 30, stiffness: 300 }}
          className={`workspace-shell-drawer fixed right-0 top-0 bottom-0 ${stacked ? 'z-[71]' : 'z-50'} flex w-full max-w-2xl flex-col overflow-hidden`}
          style={{
            background: 'var(--bg-primary)',
            borderLeft: '1px solid var(--border)',
            boxShadow: '-28px 0 72px rgba(15, 23, 42, 0.22)',
          }}
          aria-label={`Task ${taskKey}`}
          role="dialog"
          aria-modal="true"
        >
          <TaskDetailBody
            taskKey={taskKey!}
            onClose={onClose}
            onOpenFullPage={() => navigateToTaskPage(taskKey!)}
            onNavigateTask={onNavigateTask ?? ((key) => navigateToTaskPage(key))}
          />
        </motion.aside>
      </>
    </AnimatePresence>,
    document.body,
  );
}

interface TaskDetailBodyProps {
  taskKey: string;
  onClose?: () => void;
  onOpenFullPage?: () => void;
  onNavigateTask: (taskKey: string) => void;
  fullPage?: boolean;
}

/** The shared task detail content — drawer panel body and `/t/:key` page body. */
export function TaskDetailBody({ taskKey, onClose, onOpenFullPage, onNavigateTask, fullPage = false }: TaskDetailBodyProps) {
  const { user } = useAuth();
  const { addToast } = useToast();
  const mode: TaskDrawerMode = user?.role === 'developer' ? 'developer' : 'manager';
  const query = useTaskDetail(taskKey);
  const update = useUpdateTaskDetail(taskKey);
  const remove = useDeleteTaskDetail(taskKey);

  const patch = useCallback(
    (updates: UpdateTaskRequest) => {
      update.mutate(updates, { onError: (err) => addToast(err.message, 'error') });
    },
    [update, addToast],
  );

  // Aliased keys resolve to the survivor — normalize the URL on the full page
  // (P3-D3). Drawers are transient so they keep the requested key.
  useEffect(() => {
    if (fullPage && query.data && query.data.taskKey !== taskKey) {
      navigateToTaskPage(query.data.taskKey, true);
    }
  }, [fullPage, query.data, taskKey]);

  if (query.isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center gap-2 py-16" style={{ color: 'var(--text-muted)' }}>
        <Loader2 size={16} className="animate-spin" />
        <span className="text-[13px]">Loading {taskKey}…</span>
      </div>
    );
  }

  if (query.isError || !query.data) {
    const message = query.error instanceof Error ? query.error.message : 'Task not found';
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-16 text-center">
        <span className="font-mono text-[13px] font-bold" style={{ color: 'var(--text-muted)' }}>{taskKey}</span>
        <p className="text-[14px]" style={{ color: 'var(--text-secondary)' }}>{message}</p>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3 py-1.5 text-[13px] font-semibold"
            style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)' }}
          >
            Go back
          </button>
        )}
      </div>
    );
  }

  const task = query.data;

  // Phase 3 (P3-D15): former owners get a restricted projection — key, title,
  // status, and their own shared timeline events. No editing, links, or labels.
  if ('access' in task) {
    return (
      <>
        <div className="flex items-center gap-2 border-b px-5 py-3" style={{ borderColor: 'var(--border)' }}>
          <TaskKeyChip taskKey={task.taskKey} />
          <span
            className="rounded-full px-2 py-0.5 text-[11px] font-bold"
            style={statusStyle(task.status)}
          >
            {STATUS_OPTIONS.find((option) => option.value === task.status)?.label ?? task.status}
          </span>
          <span className="flex-1" />
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1.5 transition-colors hover:bg-[var(--bg-tertiary)]"
              style={{ color: 'var(--text-muted)' }}
              aria-label="Close"
            >
              <X size={16} />
            </button>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="px-5 pt-4">
            <h2 className="text-[15px] font-semibold leading-snug" style={{ color: 'var(--text-primary)' }}>{task.title}</h2>
            <p className="mt-2 rounded-lg px-3 py-2 text-[12px]" style={{ background: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}>
              You no longer own this task. Only your own shared updates are shown.
            </p>
          </div>
          <div className="px-5 py-4">
            <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.14em]" style={{ color: 'var(--text-muted)' }}>
              <History size={11} />
              Your updates
            </div>
            <div className="mt-2">
              <TaskTimeline taskKey={task.taskKey} mode="developer" emptyLabel="No updates from you yet." />
            </div>
          </div>
        </div>
      </>
    );
  }

  const deleted = Boolean(task.deletedAt);
  const canEditTitle =
    mode === 'manager' ||
    (task.createdByType === 'developer' && task.createdById === user?.developerAccountId);
  const canDelete = mode === 'manager';

  return (
    <>
      <TaskDetailHeader
        task={task}
        mode={mode}
        canEditTitle={!deleted && canEditTitle}
        canDelete={!deleted && canDelete}
        onPatch={patch}
        onDelete={() => {
          remove.mutate(undefined, {
            onError: (err) => addToast(err.message, 'error'),
            onSuccess: () => onClose?.(),
          });
        }}
        onClose={onClose}
        onOpenFullPage={fullPage ? undefined : onOpenFullPage}
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {deleted && (
          <div
            className="mx-5 mt-4 rounded-lg px-3 py-2 text-[12px] font-semibold"
            style={{ background: 'rgba(239,68,68,0.08)', color: 'var(--danger)', border: '1px solid rgba(239,68,68,0.2)' }}
          >
            This task was deleted{task.deletedAt ? ` on ${formatSafe(task.deletedAt)}` : ''}. It is read-only.
          </div>
        )}
        <TaskOwnerSection task={task} mode={mode} onPatch={patch} readOnly={deleted} />
        <TaskScheduleSection task={task} mode={mode} onPatch={patch} readOnly={deleted} />
        <TaskLinksSection task={task} mode={mode} readOnly={deleted} onNavigateTask={onNavigateTask} />
        <TaskChildrenSection task={task} mode={mode} readOnly={deleted} onNavigateTask={onNavigateTask} />
        <div className="px-5 py-4" style={{ borderBottom: '1px solid var(--border)' }}>
          <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.14em]" style={{ color: 'var(--text-muted)' }}>
            <History size={11} />
            Timeline
          </div>
          <div className="mt-2">
            <TaskTimeline taskKey={task.taskKey} mode={mode} />
          </div>
          {!deleted && (
            <div className="mt-2">
              <TaskUpdateComposer
                taskKey={task.taskKey}
                mode={mode}
                via="task_drawer"
                date={getLocalIsoDate()}
                collapsed
              />
            </div>
          )}
        </div>
        <TaskPropertiesSection task={task} mode={mode} onPatch={patch} readOnly={deleted} />
      </div>
    </>
  );
}

// ── Header ──────────────────────────────────────────────────────────

function TaskDetailHeader({
  task,
  mode,
  canEditTitle,
  canDelete,
  onPatch,
  onDelete,
  onClose,
  onOpenFullPage,
}: {
  task: TaskDetailResponse;
  mode: TaskDrawerMode;
  canEditTitle: boolean;
  canDelete: boolean;
  onPatch: (updates: UpdateTaskRequest) => void;
  onDelete: () => void;
  onClose?: () => void;
  onOpenFullPage?: () => void;
}) {
  const [editTitle, setEditTitle] = useState(task.title);
  useEffect(() => { setEditTitle(task.title); }, [task.taskKey, task.title]);

  const commitTitle = () => {
    const trimmed = editTitle.trim();
    if (trimmed && trimmed !== task.title) onPatch({ title: trimmed });
    else setEditTitle(task.title);
  };

  const status = STATUS_OPTIONS.find((o) => o.value === task.status) ?? STATUS_OPTIONS[0]!;

  return (
    <div
      className="shrink-0 border-b px-5 pb-4 pt-3"
      style={{
        borderColor: 'var(--border)',
        background: 'linear-gradient(180deg, color-mix(in srgb, var(--bg-primary) 96%, var(--md-accent-dim)) 0%, var(--bg-primary) 100%)',
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <TaskKeyChip taskKey={task.taskKey} />
          {task.kind === 'meeting' && (
            <span
              className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.06em]"
              style={{ background: 'var(--accent-glow)', color: 'var(--accent)', border: '1px solid color-mix(in srgb, var(--accent) 22%, transparent)' }}
            >
              <Users size={9} />
              Meeting
            </span>
          )}
        </div>
        <div className="flex items-center gap-0.5">
          {onOpenFullPage && (
            <button
              type="button"
              onClick={onOpenFullPage}
              className="flex h-7 w-7 items-center justify-center rounded-lg transition-opacity hover:opacity-70"
              style={{ color: 'var(--text-secondary)' }}
              title="Open full page"
              aria-label="Open full page"
            >
              <Maximize2 size={13} />
            </button>
          )}
          {canDelete && (
            <button
              type="button"
              onClick={onDelete}
              className="flex h-7 w-7 items-center justify-center rounded-lg transition-opacity hover:opacity-70"
              style={{ color: 'var(--danger)' }}
              title="Delete task"
              aria-label="Delete task"
            >
              <Trash2 size={13} />
            </button>
          )}
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="flex h-7 w-7 items-center justify-center rounded-lg transition-opacity hover:opacity-70"
              style={{ color: 'var(--text-secondary)' }}
              aria-label="Close"
            >
              <X size={15} />
            </button>
          )}
        </div>
      </div>

      <div className="mt-2.5">
        {canEditTitle ? (
          <input
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            onBlur={commitTitle}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              if (e.key === 'Escape') setEditTitle(task.title);
            }}
            className="w-full rounded-lg bg-transparent px-1.5 py-1 -mx-1.5 text-[17px] font-semibold leading-snug outline-none transition-colors focus:bg-[var(--bg-tertiary)]"
            style={{ color: 'var(--text-primary)' }}
            aria-label="Task title"
          />
        ) : (
          <h2 className="px-0 text-[17px] font-semibold leading-snug" style={{ color: 'var(--text-primary)' }}>
            {task.title}
          </h2>
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {!task.deletedAt && (canEditTitle || mode === 'manager') ? (
          <StatusSelect task={task} onPatch={onPatch} />
        ) : (
          <span
            className="rounded-md px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.06em]"
            style={statusStyle(task.status)}
          >
            {status.label}
          </span>
        )}
      </div>
    </div>
  );
}

function StatusSelect({ task, onPatch }: { task: TaskDetailResponse; onPatch: (updates: UpdateTaskRequest) => void }) {
  const id = useId();
  return (
    <select
      id={id}
      value={task.status}
      onChange={(e) => onPatch({ status: e.target.value as TaskStatus })}
      className="cursor-pointer rounded-md px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.06em] outline-none"
      style={{ ...statusStyle(task.status), appearance: 'auto' }}
      aria-label="Task status"
    >
      {STATUS_OPTIONS.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

// ── Owner & tracking ────────────────────────────────────────────────

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.14em]" style={{ color: 'var(--text-muted)' }}>
      {children}
    </div>
  );
}

function TaskOwnerSection({
  task,
  mode,
  onPatch,
  readOnly,
}: {
  task: TaskDetailResponse;
  mode: TaskDrawerMode;
  onPatch: (updates: UpdateTaskRequest) => void;
  readOnly: boolean;
}) {
  const { user } = useAuth();
  // Manager-only endpoint (P3 §3.3): developers get an empty list rather than
  // a guaranteed 403. The hook still runs to keep call order stable.
  const developers = useDevelopers(undefined, { enabled: mode === 'manager' });
  const id = useId();

  if (mode === 'developer') {
    return null;
  }

  const ownerValue = task.ownerType && task.ownerId ? `${task.ownerType}:${task.ownerId}` : '';
  const trackedBy = 'trackedByManagerId' in task ? task.trackedByManagerId : null;

  return (
    <div className="px-5 py-4 space-y-2.5" style={{ borderBottom: '1px solid var(--border)' }}>
      <SectionHeading>
        <UserCircle2 size={11} />
        Owner & tracking
      </SectionHeading>
      <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
        <div>
          <label htmlFor={id} className="mb-0.5 block text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: 'var(--text-muted)' }}>
            Owner
          </label>
          <select
            id={id}
            value={ownerValue}
            disabled={readOnly}
            onChange={(e) => {
              const value = e.target.value;
              if (!value) onPatch({ ownerType: null, ownerId: null });
              else {
                const [ownerType, ownerId] = value.split(':') as ['manager' | 'developer', string];
                onPatch({ ownerType, ownerId });
              }
            }}
            className="w-full cursor-pointer rounded-lg px-2 py-1.5 text-[12px] font-medium outline-none disabled:cursor-not-allowed disabled:opacity-70"
            style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
          >
            <option value="">Unassigned (inbox)</option>
            <option value={`manager:${user?.accountId ?? ''}`}>Me</option>
            {(developers.data ?? []).map((dev) => (
              <option key={dev.accountId} value={`developer:${dev.accountId}`}>
                {dev.displayName}
              </option>
            ))}
          </select>
        </div>
        <div>
          <span className="mb-0.5 block text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: 'var(--text-muted)' }}>
            Tracked by
          </span>
          <span className="block rounded-lg px-2 py-1.5 text-[12px]" style={{ color: 'var(--text-secondary)', background: 'var(--bg-secondary)', border: '1px solid var(--border)' }}>
            {trackedBy ? (trackedBy === user?.accountId ? 'You' : trackedBy) : 'No one'}
          </span>
        </div>
      </div>
    </div>
  );
}

// ── Schedule ────────────────────────────────────────────────────────

function TaskScheduleSection({
  task,
  mode,
  onPatch,
  readOnly,
}: {
  task: TaskDetailResponse;
  mode: TaskDrawerMode;
  onPatch: (updates: UpdateTaskRequest) => void;
  readOnly: boolean;
}) {
  const editable = mode === 'manager' && !readOnly;
  const isMeeting = task.kind === 'meeting';
  const later = 'later' in task ? task.later : false;
  const followUpAt = 'followUpAt' in task ? task.followUpAt : null;

  return (
    <div className="px-5 py-4 space-y-2.5" style={{ borderBottom: '1px solid var(--border)' }}>
      <SectionHeading>
        <CalendarDays size={11} />
        Schedule
      </SectionHeading>
      <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
        <InlineDate label="Scheduled" value={task.scheduledOn} disabled={!editable} onChange={(v) => onPatch({ scheduledOn: v })} />
        {!isMeeting && mode === 'manager' && (
          <InlineDatetime label="Follow-up" value={followUpAt} disabled={!editable} onChange={(v) => onPatch({ followUpAt: v })} />
        )}
        {!isMeeting && mode === 'manager' && (
          <label className="col-span-2 flex items-center gap-2 text-[12px] font-medium" style={{ color: 'var(--text-secondary)' }}>
            <input
              type="checkbox"
              checked={later}
              disabled={!editable}
              onChange={(e) => onPatch({ later: e.target.checked })}
              className="h-3.5 w-3.5 rounded"
            />
            Later (parked, off today's list)
          </label>
        )}
        {isMeeting && (
          <>
            <InlineDatetime label="Starts" value={task.startsAt} disabled={!editable} onChange={(v) => onPatch({ startsAt: v })} />
            <InlineDatetime label="Ends" value={task.endsAt} disabled={!editable} onChange={(v) => onPatch({ endsAt: v })} />
            <InlineText label="Participants" value={task.participants ?? ''} placeholder="e.g. Design Team, Rahul" disabled={!editable} className="col-span-2" onChange={(v) => onPatch({ participants: v || null })} />
            <InlineText label="Outcome" value={task.outcome ?? ''} placeholder="What was decided?" disabled={!editable} className="col-span-2" onChange={(v) => onPatch({ outcome: v || null })} />
          </>
        )}
      </div>
    </div>
  );
}

// ── Links ───────────────────────────────────────────────────────────

function TaskLinksSection({
  task,
  mode,
  readOnly,
  onNavigateTask,
}: {
  task: TaskDetailResponse;
  mode: TaskDrawerMode;
  readOnly: boolean;
  onNavigateTask: (taskKey: string) => void;
}) {
  const { addToast } = useToast();
  const addLink = useAddTaskDetailLink(task.taskKey);
  const removeLink = useRemoveTaskDetailLink(task.taskKey);
  const developers = useDevelopers(undefined, { enabled: mode === 'manager' });
  const [adding, setAdding] = useState<'jira' | 'person' | 'external' | 'task' | null>(null);
  const [draft, setDraft] = useState('');
  const editable = mode === 'manager' && !readOnly;

  const devName = useMemo(() => {
    const map = new Map<string, string>();
    for (const dev of developers.data ?? []) map.set(dev.accountId, dev.displayName);
    return map;
  }, [developers.data]);

  const submit = () => {
    if (!adding || !draft.trim()) return;
    addLink.mutate(
      { kind: adding, ref: draft.trim(), ...(adding === 'jira' ? { role: 'related' as const } : {}) },
      {
        onSuccess: () => { setAdding(null); setDraft(''); },
        onError: (err) => addToast(err.message, 'error'),
      },
    );
  };

  const linkLabel = (link: TaskDetailResponse['links'][number]) => {
    if (link.kind === 'person') return devName.get(link.ref) ?? link.ref;
    return link.ref;
  };

  return (
    <div className="px-5 py-4 space-y-2" style={{ borderBottom: '1px solid var(--border)' }}>
      <div className="flex items-center justify-between">
        <SectionHeading>
          <Link2 size={11} />
          Links
        </SectionHeading>
        {editable && (
          <div className="flex items-center gap-1">
            {(['jira', 'person', 'external', 'task'] as const).map((kind) => (
              <button
                key={kind}
                type="button"
                onClick={() => { setAdding(adding === kind ? null : kind); setDraft(''); }}
                className="rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] transition-all hover:brightness-110"
                style={{ background: 'var(--bg-tertiary)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}
              >
                + {kind === 'jira' ? 'Jira' : kind === 'person' ? 'Dev' : kind === 'external' ? 'External' : 'Task'}
              </button>
            ))}
          </div>
        )}
      </div>
      {task.links.length ? (
        <div className="space-y-1">
          {task.links.map((link) => (
            <div
              key={link.id}
              className="group flex items-center gap-1.5 rounded-lg px-2.5 py-1.5"
              style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)' }}
            >
              {link.kind === 'jira' ? (
                <JiraIssueLink issueKey={link.ref} className="flex-1 truncate text-[12px] font-medium" style={{ color: 'var(--text-primary)' }}>
                  {link.ref}{link.role === 'primary' ? ' · primary' : ''}
                </JiraIssueLink>
              ) : link.kind === 'task' ? (
                <button
                  type="button"
                  onClick={() => onNavigateTask(link.ref)}
                  className="flex-1 truncate text-left font-mono text-[12px] font-medium"
                  style={{ color: 'var(--accent)' }}
                >
                  {link.ref}
                </button>
              ) : (
                <span className="flex-1 truncate text-[12px] font-medium" style={{ color: 'var(--text-primary)' }}>
                  {linkLabel(link)}
                </span>
              )}
              {editable && (
                <button
                  type="button"
                  onClick={() => removeLink.mutate(link.id, { onError: (err) => addToast(err.message, 'error') })}
                  className="transition-opacity group-hover:opacity-100 xl:opacity-0"
                  style={{ color: 'var(--text-muted)' }}
                  aria-label={`Remove link ${link.ref}`}
                >
                  <X size={11} />
                </button>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-lg px-2.5 py-2 text-[11px]" style={{ background: 'var(--bg-secondary)', color: 'var(--text-muted)', border: '1px dashed var(--border)' }}>
          No links yet.
        </div>
      )}
      {adding && editable && (
        <div className="flex items-center gap-1.5">
          {adding === 'person' ? (
            <select
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="flex-1 rounded-lg px-2 py-1.5 text-[12px] outline-none"
              style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
              aria-label="Developer"
            >
              <option value="">Choose a developer…</option>
              {(developers.data ?? []).map((dev) => (
                <option key={dev.accountId} value={dev.accountId}>{dev.displayName}</option>
              ))}
            </select>
          ) : (
            <input
              autoFocus
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); submit(); }
                if (e.key === 'Escape') { setAdding(null); setDraft(''); }
              }}
              placeholder={adding === 'jira' ? 'PROJ-123' : adding === 'task' ? 'T-42' : 'Link label or URL'}
              className="flex-1 rounded-lg px-2 py-1.5 text-[12px] outline-none"
              style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
              aria-label={`${adding} link`}
            />
          )}
          <button
            type="button"
            onClick={submit}
            disabled={!draft.trim() || addLink.isPending}
            className="rounded-lg px-2 py-1.5 text-[12px] font-semibold disabled:opacity-40"
            style={{ background: 'var(--accent-glow)', color: 'var(--accent)' }}
          >
            Add
          </button>
        </div>
      )}
    </div>
  );
}

// ── Children (action items) ─────────────────────────────────────────

function TaskChildrenSection({
  task,
  mode,
  readOnly,
  onNavigateTask,
}: {
  task: TaskDetailResponse;
  mode: TaskDrawerMode;
  readOnly: boolean;
  onNavigateTask: (taskKey: string) => void;
}) {
  const { addToast } = useToast();
  const createChild = useCreateChildTask(task.taskKey);
  const developers = useDevelopers(undefined, { enabled: mode === 'manager' });
  const [draft, setDraft] = useState('');
  const isMeeting = task.kind === 'meeting';
  const canAdd = mode === 'manager' && !readOnly;
  // §5.3: action-item owners come from `@person` via the capture grammar.
  const people = useMemo(
    () => (developers.data ?? []).map((dev) => ({ accountId: dev.accountId, displayName: dev.displayName })),
    [developers.data],
  );

  // Only show the section when there's something to show, or when a meeting
  // can accept new action items.
  if (!task.children.length && !task.parent && !(isMeeting && canAdd)) {
    return null;
  }

  const submit = () => {
    if (createChild.isPending) return;
    const resolved = resolveCapture(parseCapture(draft, getLocalIsoDate()), { people });
    const blocking = resolved.diagnostics.find((diagnostic) => diagnostic.severity === 'error');
    if (blocking) {
      addToast(blocking.message, 'error');
      return;
    }
    const title = resolved.title.trim();
    if (!title) return;
    createChild.mutate(
      {
        title,
        kind: 'task',
        parentId: task.id,
        ...(resolved.owner ? { ownerType: 'developer' as const, ownerId: resolved.owner.accountId } : {}),
        ...(resolved.scheduledOn ? { scheduledOn: resolved.scheduledOn } : {}),
        ...(resolved.priority === 'high' ? { priority: 'high' as const } : {}),
        ...(resolved.labels.length ? { labels: resolved.labels } : {}),
      },
      {
        onSuccess: () => setDraft(''),
        onError: (err) => addToast(err.message, 'error'),
      },
    );
  };

  return (
    <div className="px-5 py-4 space-y-2" style={{ borderBottom: '1px solid var(--border)' }}>
      <SectionHeading>
        <ListTree size={11} />
        {isMeeting ? 'Action items' : 'Subtasks'}
      </SectionHeading>
      {task.parent && (
        <button
          type="button"
          onClick={() => onNavigateTask(task.parent!.taskKey)}
          className="flex w-full items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-left text-[12px] transition-colors hover:brightness-110"
          style={{ background: 'var(--bg-secondary)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}
        >
          <ArrowUpRight size={11} />
          <span className="font-mono font-semibold">{task.parent.taskKey}</span>
          <span className="min-w-0 flex-1 truncate">{task.parent.title}</span>
        </button>
      )}
      {task.children.length > 0 && (
        <div className="space-y-1">
          {task.children.map((child) => (
            <ChildRow key={child.id} child={child} onOpen={onNavigateTask} />
          ))}
        </div>
      )}
      {isMeeting && canAdd && (
        <div className="flex items-center gap-1.5">
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }}
            placeholder="Add an action item — @dev for owner, !fri for a date…"
            className="min-w-0 flex-1 rounded-lg px-2 py-1.5 text-[12px] outline-none"
            style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
            aria-label="New action item"
          />
          <button
            type="button"
            onClick={submit}
            disabled={!draft.trim() || createChild.isPending}
            className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-[12px] font-semibold disabled:opacity-40"
            style={{ background: 'var(--accent-glow)', color: 'var(--accent)' }}
          >
            <Plus size={11} />
            Add
          </button>
        </div>
      )}
    </div>
  );
}

function ChildRow({ child, onOpen }: { child: TaskChildRef; onOpen: (key: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(child.taskKey)}
      className="group flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left transition-colors hover:brightness-110"
      style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)' }}
    >
      <span className="font-mono text-[11px] font-bold" style={{ color: 'var(--text-muted)' }}>{child.taskKey}</span>
      <span className="min-w-0 flex-1 truncate text-[12px] font-medium" style={{ color: 'var(--text-primary)' }}>{child.title}</span>
      <span className="rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.05em]" style={statusStyle(child.status)}>
        {child.status}
      </span>
      <ChevronRight size={11} style={{ color: 'var(--text-muted)' }} className="opacity-0 transition-opacity group-hover:opacity-70" />
    </button>
  );
}

// ── Properties ──────────────────────────────────────────────────────

function TaskPropertiesSection({
  task,
  mode,
  onPatch,
  readOnly,
}: {
  task: TaskDetailResponse;
  mode: TaskDrawerMode;
  onPatch: (updates: UpdateTaskRequest) => void;
  readOnly: boolean;
}) {
  // The label registry is a manager endpoint — developers keep chip names
  // with the default color instead of issuing a 403'd request.
  const registry = useTaskLabels({ enabled: mode === 'manager' });
  const isMeeting = task.kind === 'meeting';
  const labels = 'labels' in task ? task.labels : [];
  const colorByName = useMemo(() => {
    const map = new Map<string, string>();
    for (const label of registry.data?.labels ?? []) map.set(label.name, label.color);
    return map;
  }, [registry.data]);

  const meta: [string, string][] = [
    ['Created by', `${task.createdByType}${task.createdById ? ` (${task.createdById})` : ''}`],
    ['Created', formatSafe(task.createdAt)],
    ['Updated', formatSafe(task.updatedAt)],
  ];
  if (task.closedAt) meta.push(['Closed', formatSafe(task.closedAt)]);

  return (
    <div className="px-5 py-4 space-y-2.5">
      <SectionHeading>
        <Flag size={11} />
        Properties
      </SectionHeading>
      {mode === 'manager' && (
        <div>
          <span className="mb-1 block text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: 'var(--text-muted)' }}>
            Labels
          </span>
          <TaskLabelPicker
            labels={labels}
            disabled={readOnly}
            onChange={(next) => onPatch({ labels: next })}
          />
        </div>
      )}
      {mode === 'developer' && labels.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {labels.map((name) => (
            <TaskLabelChip key={name} name={name} color={colorByName.get(name)} />
          ))}
        </div>
      )}
      <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
        {mode === 'manager' && (
          <div>
            <span className="mb-0.5 block text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: 'var(--text-muted)' }}>
              Priority
            </span>
            <select
              value={task.priority}
              disabled={readOnly}
              onChange={(e) => onPatch({ priority: e.target.value as 'normal' | 'high' })}
              className="w-full cursor-pointer rounded-lg px-2 py-1.5 text-[12px] font-medium outline-none disabled:cursor-not-allowed disabled:opacity-70"
              style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
              aria-label="Priority"
            >
              <option value="normal">Normal</option>
              <option value="high">High</option>
            </select>
          </div>
        )}
        {isMeeting && task.dueAt && (
          <MetaRow label="Due" value={formatSafe(task.dueAt)} />
        )}
        {meta.map(([label, value]) => (
          <MetaRow key={label} label={label} value={value} />
        ))}
      </div>
    </div>
  );
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="mb-0.5 block text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: 'var(--text-muted)' }}>
        {label}
      </span>
      <span className="text-[12px]" style={{ color: 'var(--text-secondary)' }}>{value}</span>
    </div>
  );
}

// ── Field primitives ────────────────────────────────────────────────

function InlineText({ label, value, placeholder, onChange, className, disabled = false }: {
  label: string; value: string; placeholder?: string; onChange: (value: string) => void; className?: string; disabled?: boolean;
}) {
  const id = useId();
  const [local, setLocal] = useState(value);
  useEffect(() => { setLocal(value); }, [value]);
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-0.5 block text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: 'var(--text-muted)' }}>{label}</label>
      {disabled ? (
        <span className="block px-1 py-1 text-[12px]" style={{ color: 'var(--text-secondary)' }}>{value || '—'}</span>
      ) : (
        <input
          id={id}
          type="text"
          value={local}
          onChange={(e) => setLocal(e.target.value)}
          onBlur={() => { if (local !== value) onChange(local); }}
          placeholder={placeholder}
          className="w-full rounded-lg px-2 py-1.5 text-[12px] outline-none"
          style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
        />
      )}
    </div>
  );
}

function InlineDate({ label, value, onChange, disabled = false }: {
  label: string; value: string | null; onChange: (value: string | null) => void; disabled?: boolean;
}) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="mb-0.5 block text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: 'var(--text-muted)' }}>{label}</label>
      {disabled ? (
        <span className="block px-1 py-1 text-[12px]" style={{ color: 'var(--text-secondary)' }}>{value ?? '—'}</span>
      ) : (
        <input
          id={id}
          type="date"
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value || null)}
          className="w-full rounded-lg px-2 py-1.5 text-[12px] outline-none"
          style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
        />
      )}
    </div>
  );
}

function toLocalDateTimeInputValue(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function InlineDatetime({ label, value, onChange, disabled = false }: {
  label: string; value: string | null; onChange: (value: string | null) => void; disabled?: boolean;
}) {
  const id = useId();
  const localValue = value ? toLocalDateTimeInputValue(value) : '';
  return (
    <div>
      <label htmlFor={id} className="mb-0.5 block text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: 'var(--text-muted)' }}>{label}</label>
      {disabled ? (
        <span className="block px-1 py-1 text-[12px]" style={{ color: 'var(--text-secondary)' }}>{value ? formatSafe(value) : '—'}</span>
      ) : (
        <input
          id={id}
          type="datetime-local"
          value={localValue}
          onChange={(e) => onChange(e.target.value ? new Date(e.target.value).toISOString() : null)}
          className="w-full rounded-lg px-2 py-1.5 text-[12px] outline-none"
          style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
        />
      )}
    </div>
  );
}

function formatSafe(iso: string): string {
  try {
    return format(parseISO(iso), 'MMM d, yyyy HH:mm');
  } catch {
    return iso;
  }
}
