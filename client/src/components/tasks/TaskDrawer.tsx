import { clearTaskUpdateDraftsForTask } from '@/lib/task-update-drafts';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import {
  ArrowLeft,
  Ellipsis,
  History,
  Link2,
  ListPlus,
  Lock,
  Maximize2,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { navigateToTaskPage } from '@/lib/task-nav';
import { useAuth, useAuthScopeKey } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { isCoveredByLaterLayer, useModalFocus } from '@/hooks/useModalFocus';
import { useDeleteTaskDetail, useTaskDetail, useUpdateTaskDetail } from '@/hooks/useTaskDetail';
import { formatRelativeTime, getLocalIsoDate } from '@/lib/utils';
import type { TaskDetailResponse, UpdateTaskRequest } from '@/types';
import {
  useAttachOneOnOneAgendaItemToSeries,
  useOneOnOneEnabled,
  useOneOnOneSeriesList,
} from '@/hooks/useOneOnOne';
import { TaskKeyChip } from './TaskKeyChip';
import { TaskTimeline } from './TaskTimeline';
import { TaskUpdateComposer } from './TaskUpdateComposer';
import { MenuDivider, MenuHeading, MenuItem, TaskPopover } from '@/components/ui/Popover';
import { FOCUS_RING, IconButton, SectionHeader, ShortcutLegend, isEditable, useTaskShortcuts } from './TaskDetailPrimitives';
import {
  MeetingOutcome,
  StatusControl,
  StatusPill,
  TaskDetailsSection,
  TaskMetaList,
  TaskProperties,
  useTaskPeople,
  type TaskDetailMode,
  type TaskPeople,
} from './TaskDetailFields';
import { ParentCrumb, TaskChildrenSection, TaskLinksSection } from './TaskDetailRelations';
import { formatStamp } from './task-detail-format';

export type TaskDrawerMode = TaskDetailMode;

export { navigateToTaskPage };

interface TaskDrawerProps {
  taskKey: string | null;
  onClose: () => void;
  /** Navigate the drawer to another task (children, parent, linked tasks). */
  onNavigateTask?: (taskKey: string) => void;
  /** docs/51 F19: list order the drawer was opened from — enables j/k stepping. */
  orderedKeys?: string[];
  onStepTask?: (taskKey: string) => void;
  stacked?: boolean;
}

/**
 * Phase 3 (P3-D2): the single shared task drawer. Driven entirely by
 * `useTaskDetail` — it knows nothing about the surface that opened it. Manager
 * and developer principals get their own DTOs server-side; private fields and
 * controls are hidden for developers.
 */
export function TaskDrawer({ taskKey, onClose, onNavigateTask, orderedKeys, onStepTask, stacked = false }: TaskDrawerProps) {
  const open = Boolean(taskKey);
  const reduceMotion = useReducedMotion();
  // §6.2: the drawer traps Tab while open and restores focus to the element
  // that opened it (a task row, deep-link target, or nothing) on close.
  const panelRef = useModalFocus<HTMLElement>(open);

  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (isCoveredByLaterLayer(panelRef.current)) return;
      // Claim the key so layers underneath (1:1 workspace, standup) stay put.
      e.preventDefault();
      // First Esc leaves a text field (keeping any draft); the next one closes.
      const active = document.activeElement;
      const panel = panelRef.current;
      if (active instanceof HTMLElement && panel?.contains(active) && isEditable(active)) {
        active.blur();
        panel.focus({ preventScroll: true });
        return;
      }
      onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open, onClose, panelRef]);

  // Move focus into the dialog so screen readers announce it and the
  // drawer's single-key shortcuts are live immediately.
  useEffect(() => {
    if (open) panelRef.current?.focus({ preventScroll: true });
  }, [open, taskKey, panelRef]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      <>
        <motion.div
          key={`scrim-${taskKey}`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className={`workspace-shell-backdrop fixed inset-x-0 bottom-0 ${stacked ? 'z-drawer-stacked' : 'z-drawer'}`}
          style={{ background: 'var(--scrim-soft)', backdropFilter: 'var(--scrim-soft-blur)' }}
          onClick={onClose}
        />
        <motion.aside
          ref={panelRef}
          key={`panel-${taskKey}`}
          tabIndex={-1}
          initial={reduceMotion ? { opacity: 0 } : { x: '100%' }}
          animate={reduceMotion ? { opacity: 1 } : { x: 0 }}
          exit={reduceMotion ? { opacity: 0 } : { x: '100%' }}
          transition={{ type: 'spring', damping: 34, stiffness: 340 }}
          className={`workspace-shell-drawer fixed right-0 top-0 bottom-0 ${stacked ? 'z-drawer-stacked' : 'z-drawer'} flex w-full max-w-[680px] flex-col overflow-hidden outline-none`}
          style={{
            background: 'var(--bg-primary)',
            borderLeft: '1px solid var(--border)',
            boxShadow: 'var(--drawer-shadow)',
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
            orderedKeys={orderedKeys}
            onStepTask={onStepTask}
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
  /** Page layout (`/t/:key`): two columns, a back affordance instead of close. */
  fullPage?: boolean;
  onBack?: () => void;
  /** docs/51 F19: list order the drawer was opened from — enables j/k stepping. */
  orderedKeys?: string[];
  onStepTask?: (taskKey: string) => void;
}

/** The shared task detail content — drawer panel body and `/t/:key` page body. */
export function TaskDetailBody({ taskKey, onClose, onOpenFullPage, onNavigateTask, fullPage = false, onBack, orderedKeys, onStepTask }: TaskDetailBodyProps) {
  const { user } = useAuth();
  const { addToast } = useToast();
  const mode: TaskDetailMode = user?.role === 'developer' ? 'developer' : 'manager';
  const scope = useAuthScopeKey();
  const query = useTaskDetail(taskKey);
  const update = useUpdateTaskDetail(taskKey);
  const remove = useDeleteTaskDetail(taskKey);
  const people = useTaskPeople(mode);

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
      const requested = Number(new URLSearchParams(window.location.search).get('event'));
      navigateToTaskPage(query.data.taskKey, true, Number.isSafeInteger(requested) && requested > 0 ? requested : undefined);
    }
  }, [fullPage, query.data, taskKey]);

  useEffect(() => {
    const status = (query.error as { status?: number } | null)?.status;
    if (status === 403 || status === 404 || (query.data && ('access' in query.data || query.data.deletedAt))) {
      clearTaskUpdateDraftsForTask(scope, taskKey);
      if (query.data?.taskKey !== taskKey && query.data?.taskKey) clearTaskUpdateDraftsForTask(scope, query.data.taskKey);
    }
  }, [scope, taskKey, query.error, query.data]);

  const dismiss = onClose ?? onBack;

  if (query.isLoading) {
    return <TaskDetailSkeleton taskKey={taskKey} fullPage={fullPage} onClose={onClose} onBack={onBack} />;
  }

  if (query.isError || !query.data) {
    const message = query.error instanceof Error ? query.error.message : 'Task not found';
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-16 text-center">
        <span className="rounded-md px-2 py-0.5 font-mono text-[12px] font-bold" style={{ color: 'var(--text-muted)', background: 'var(--bg-tertiary)' }}>{taskKey}</span>
        <p className="max-w-sm text-[14px]" style={{ color: 'var(--text-secondary)' }}>{message}</p>
        {dismiss && (
          <button
            type="button"
            onClick={dismiss}
            className={`rounded-lg px-3 py-1.5 text-[13px] font-semibold transition-colors hover:brightness-110 ${FOCUS_RING}`}
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
        <DetailToolbar
          fullPage={fullPage}
          onBack={onBack}
          leading={<><TaskKeyChip taskKey={task.taskKey} /><StatusPill status={task.status} /></>}
          actions={onClose && <IconButton label="Close" hint="Esc" onClick={onClose}><X size={16} /></IconButton>}
        />
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className={`mx-auto space-y-5 ${fullPage ? 'max-w-3xl px-6 py-8' : 'px-6 py-5'}`}>
            <h2 className="text-[20px] font-semibold leading-7 tracking-[-0.01em]" style={{ color: 'var(--text-primary)' }}>{task.title}</h2>
            <p className="flex items-center gap-2 rounded-xl px-3 py-2.5 text-[12.5px]" style={{ background: 'var(--bg-secondary)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>
              <Lock size={13} style={{ color: 'var(--text-muted)' }} />
              You no longer own this task. Only your own shared updates are shown.
            </p>
            <section className="space-y-3">
              <SectionHeader icon={<History size={14} />} title="Your updates" />
              <TaskTimeline taskKey={task.taskKey} mode="developer" emptyLabel="No updates from you yet." />
            </section>
          </div>
        </div>
      </>
    );
  }

  return (
    <TaskDetailView
      task={task}
      mode={mode}
      people={people}
      fullPage={fullPage}
      onPatch={patch}
      onDelete={() => {
        remove.mutate(undefined, {
          onError: (err) => addToast(err.message, 'error'),
          onSuccess: () => (onClose ?? onBack)?.(),
        });
      }}
      onClose={onClose}
      onBack={onBack}
      onOpenFullPage={fullPage ? undefined : onOpenFullPage}
      onNavigateTask={onNavigateTask}
      orderedKeys={orderedKeys}
      onStepTask={onStepTask}
    />
  );
}

// ── Detail view ─────────────────────────────────────────────────────

interface TaskDetailViewProps {
  task: TaskDetailResponse;
  mode: TaskDetailMode;
  people: TaskPeople;
  fullPage: boolean;
  onPatch: (updates: UpdateTaskRequest) => void;
  onDelete: () => void;
  onClose?: () => void;
  onBack?: () => void;
  onOpenFullPage?: () => void;
  onNavigateTask: (taskKey: string) => void;
  /** docs/51 F19: list order the detail was opened from — enables j/k stepping. */
  orderedKeys?: string[];
  onStepTask?: (taskKey: string) => void;
}

function TaskDetailView({ task, mode, people, fullPage, onPatch, onDelete, onClose, onBack, onOpenFullPage, onNavigateTask, orderedKeys, onStepTask }: TaskDetailViewProps) {
  const { user } = useAuth();
  const rootRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const [condensed, setCondensed] = useState(false);

  const deleted = Boolean(task.deletedAt);
  const canEditTitle =
    !deleted && (mode === 'manager' || (task.createdByType === 'developer' && task.createdById === user?.developerAccountId));
  // Developer detail is owner-only (former owners get the restricted view), and
  // owners already move status from My Day — the drawer matches that.
  const canEditStatus = !deleted;
  // Details is shared by design: whoever can open the task can edit it.
  const canEditDetails = !deleted;
  const managerEditable = mode === 'manager' && !deleted;

  // docs/51 F19: j/k step to the previous/next row of the list the drawer was
  // opened from (dead inside inputs by useTaskShortcuts' usual scoping).
  const stepTo = useCallback(
    (delta: number) => {
      if (!orderedKeys?.length || !onStepTask) return;
      const index = orderedKeys.indexOf(task.taskKey);
      const next = index >= 0 ? orderedKeys[index + delta] : undefined;
      if (next) onStepTask(next);
    },
    [orderedKeys, onStepTask, task.taskKey],
  );
  const canStep = Boolean(orderedKeys?.includes(task.taskKey) && onStepTask);
  useTaskShortcuts(rootRef, !deleted, {
    u: () => composerRef.current?.focus(),
    ...(canStep ? { j: () => stepTo(1), k: () => stepTo(-1) } : {}),
  });

  const hints: [string, string][] = [];
  if (canStep) hints.push(['j / k', 'Prev / next task']);
  if (canEditStatus) hints.push(['e', isOpenish(task) ? 'Done' : 'Reopen']);
  if (managerEditable) hints.push(['s', 'Schedule'], ['a', 'Assign'], ['p', 'Priority'], ['l', 'Labels']);
  if (canEditDetails) hints.push(['d', 'Details']);
  if (!deleted) hints.push(['u', 'Update']);

  const toolbar = (
    <DetailToolbar
      fullPage={fullPage}
      onBack={onBack}
      leading={
        <>
          <TaskKeyChip taskKey={task.taskKey} />
          {task.kind === 'meeting' && (
            <span
              className="inline-flex items-center gap-1 rounded-full px-2 text-[12px] font-semibold leading-5"
              style={{ background: 'var(--accent-glow)', color: 'var(--accent)' }}
            >
              <Users size={11} />
              Meeting
            </span>
          )}
          {task.parent && <ParentCrumb parent={task.parent} onOpen={onNavigateTask} />}
          {!fullPage && (
            <span
              className="min-w-0 truncate text-[13px] font-semibold transition-all duration-200"
              style={{ color: 'var(--text-primary)', opacity: condensed ? 1 : 0, transform: condensed ? 'none' : 'translateY(4px)' }}
              aria-hidden={!condensed}
            >
              {task.title}
            </span>
          )}
        </>
      }
      actions={
        <>
          {mode === 'manager' && !deleted && <OneOnOneAttachButton task={task} />}
          {onOpenFullPage && (
            <IconButton label="Open full page" onClick={onOpenFullPage}><Maximize2 size={14} /></IconButton>
          )}
          <MoreActions task={task} canDelete={mode === 'manager' && !deleted} onDelete={onDelete} onOpenFullPage={onOpenFullPage} />
          {onClose && <IconButton label="Close" hint="Esc" onClick={onClose}><X size={16} /></IconButton>}
        </>
      }
    />
  );

  const titleBlock = (
    <div className="space-y-3">
      <TitleField task={task} editable={canEditTitle} onPatch={onPatch} size={fullPage ? 'page' : 'drawer'} />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <StatusControl task={task} editable={canEditStatus} onPatch={onPatch} />
        <span className="ml-auto text-[12px]" style={{ color: 'var(--text-muted)' }} title={formatStamp(task.updatedAt)}>
          Updated {formatRelativeTime(task.updatedAt)}
        </span>
      </div>
      {deleted && (
        <div
          className="flex items-center gap-2 rounded-xl px-3 py-2.5 text-[12.5px] font-medium"
          style={{ background: 'color-mix(in srgb, var(--danger) 8%, transparent)', color: 'var(--danger)', border: '1px solid color-mix(in srgb, var(--danger) 22%, transparent)' }}
          role="status"
        >
          <Trash2 size={13} />
          This task was deleted{task.deletedAt ? ` on ${formatStamp(task.deletedAt)}` : ''}. It is read-only.
        </div>
      )}
    </div>
  );

  const properties = <TaskProperties task={task} mode={mode} readOnly={deleted} onPatch={onPatch} people={people} />;
  const details = <TaskDetailsSection task={task} mode={mode} editable={canEditDetails} onPatch={onPatch} people={people} />;
  const outcome = task.kind === 'meeting' && <MeetingOutcome task={task} editable={managerEditable} onPatch={onPatch} />;
  const relations = (
    <>
      <TaskChildrenSection task={task} mode={mode} readOnly={deleted} onNavigateTask={onNavigateTask} people={people} />
      <TaskLinksSection task={task} mode={mode} readOnly={deleted} onNavigateTask={onNavigateTask} people={people} />
    </>
  );
  const activity = (
    <section aria-labelledby={`activity-${task.taskKey}`} className="space-y-3">
      <SectionHeader id={`activity-${task.taskKey}`} icon={<History size={14} />} title="Activity" />
      {!deleted && (
        <TaskUpdateComposer
          taskKey={task.taskKey}
          mode={mode}
          via="task_drawer"
          date={getLocalIsoDate()}
          inputRef={composerRef}
        />
      )}
      <div className="pt-1">
        <TaskTimeline taskKey={task.taskKey} mode={mode} resolveName={people.nameFor} />
      </div>
    </section>
  );

  if (fullPage) {
    return (
      <div ref={rootRef} className="flex min-h-0 flex-1 flex-col">
        {toolbar}
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto grid w-full max-w-[1180px] gap-x-12 gap-y-8 px-5 pb-16 pt-8 sm:px-8 lg:grid-cols-[minmax(0,1fr)_340px] lg:grid-rows-[auto_1fr]">
            <div className="lg:col-start-1">{titleBlock}</div>
            <aside className="lg:col-start-2 lg:row-span-2 lg:row-start-1" aria-label="Task details">
              <div
                className="space-y-4 rounded-2xl p-4 lg:sticky lg:top-6"
                style={{ background: 'color-mix(in srgb, var(--bg-secondary) 72%, transparent)', border: '1px solid var(--border)' }}
              >
                <div className="px-1 text-[12px] font-semibold" style={{ color: 'var(--text-secondary)' }}>Details</div>
                {properties}
                <div className="h-px" style={{ background: 'var(--border)' }} />
                <div className="px-1">
                  <TaskMetaList task={task} people={people} />
                </div>
                {hints.length > 0 && <ShortcutLegend hints={hints} className="px-1 pt-1" />}
              </div>
            </aside>
            <div className="min-w-0 space-y-9 lg:col-start-1">
              {details}
              {outcome}
              {relations}
              {activity}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div ref={rootRef} className="flex min-h-0 flex-1 flex-col">
      {toolbar}
      <div
        className="min-h-0 flex-1 overflow-y-auto"
        onScroll={(event) => setCondensed(event.currentTarget.scrollTop > 72)}
      >
        <div className="space-y-7 px-6 pb-10 pt-5">
          {titleBlock}
          <div className="-mx-2">{properties}</div>
          {details}
          {outcome}
          <Divider />
          {relations}
          {activity}
          <Divider />
          <TaskMetaList task={task} people={people} />
        </div>
      </div>
      {hints.length > 0 && (
        <div className="hidden shrink-0 border-t px-6 py-2 sm:block" style={{ borderColor: 'var(--border)', background: 'color-mix(in srgb, var(--bg-secondary) 60%, transparent)' }}>
          <ShortcutLegend hints={[...hints, ['Esc', 'Close']]} />
        </div>
      )}
    </div>
  );
}

function isOpenish(task: TaskDetailResponse) {
  return task.status === 'open' || task.status === 'active' || task.status === 'blocked';
}

function Divider() {
  return <div className="h-px" style={{ background: 'color-mix(in srgb, var(--border) 70%, transparent)' }} />;
}

// ── Header pieces ───────────────────────────────────────────────────

function DetailToolbar({ fullPage, onBack, leading, actions }: {
  fullPage: boolean;
  onBack?: () => void;
  leading: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div
      className={`flex shrink-0 items-center gap-2 border-b ${fullPage ? 'h-14 px-4 sm:px-6' : 'h-[52px] pl-5 pr-3'}`}
      style={{ borderColor: 'var(--border)', background: 'color-mix(in srgb, var(--bg-primary) 92%, transparent)' }}
    >
      {fullPage && onBack && (
        <>
          <button
            type="button"
            onClick={onBack}
            className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-[12.5px] font-medium transition-colors hover:bg-[var(--bg-tertiary)] ${FOCUS_RING}`}
            style={{ color: 'var(--text-secondary)' }}
          >
            <ArrowLeft size={14} />
            Back
          </button>
          <span className="h-4 w-px" style={{ background: 'var(--border)' }} aria-hidden="true" />
        </>
      )}
      <div className="flex min-w-0 flex-1 items-center gap-2">{leading}</div>
      {actions && <div className="flex shrink-0 items-center gap-0.5">{actions}</div>}
    </div>
  );
}

function TitleField({ task, editable, onPatch, size }: {
  task: TaskDetailResponse;
  editable: boolean;
  onPatch: (updates: UpdateTaskRequest) => void;
  size: 'drawer' | 'page';
}) {
  const [value, setValue] = useState(task.title);
  const ref = useRef<HTMLTextAreaElement>(null);
  const reverting = useRef(false);
  useEffect(() => { setValue(task.title); }, [task.taskKey, task.title]);

  // Grow with the text so long titles wrap instead of scrolling sideways.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    if (el.scrollHeight) el.style.height = `${el.scrollHeight}px`;
  }, [value, editable]);

  const typography = size === 'page'
    ? 'text-[26px] leading-[34px] tracking-[-0.02em] sm:text-[28px] sm:leading-[36px]'
    : 'text-[20px] leading-[28px] tracking-[-0.012em]';

  if (!editable) {
    return (
      <h2 className={`font-semibold ${typography}`} style={{ color: 'var(--text-primary)' }}>
        {task.title}
      </h2>
    );
  }

  const commit = () => {
    if (reverting.current) {
      reverting.current = false;
      return;
    }
    const trimmed = value.trim();
    if (trimmed && trimmed !== task.title) onPatch({ title: trimmed });
    else setValue(task.title);
  };

  return (
    <textarea
      ref={ref}
      rows={1}
      value={value}
      onChange={(event) => setValue(event.target.value.replace(/\s*\n+\s*/g, ' '))}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          event.currentTarget.blur();
        }
        if (event.key === 'Escape') {
          event.stopPropagation();
          reverting.current = true;
          setValue(task.title);
          event.currentTarget.blur();
        }
      }}
      className={`-mx-2 block w-[calc(100%+1rem)] resize-none overflow-hidden rounded-lg bg-transparent px-2 py-0.5 font-semibold transition-colors hover:bg-[var(--bg-secondary)] focus:bg-[var(--bg-secondary)] ${FOCUS_RING} ${typography}`}
      style={{ color: 'var(--text-primary)' }}
      aria-label="Task title"
    />
  );
}

function MoreActions({ task, canDelete, onDelete, onOpenFullPage }: {
  task: TaskDetailResponse;
  canDelete: boolean;
  onDelete: () => void;
  onOpenFullPage?: () => void;
}) {
  const { addToast } = useToast();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [confirming, setConfirming] = useState(false);
  const close = () => { setAnchor(null); setConfirming(false); };

  const copyLink = async () => {
    close();
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/t/${task.taskKey}`);
      addToast(`Link to ${task.taskKey} copied`, 'success');
    } catch {
      addToast('Could not copy the link', 'error');
    }
  };

  return (
    <>
      <IconButton label="More actions" expanded={Boolean(anchor)} onClick={(el) => (anchor ? close() : setAnchor(el))}>
        <Ellipsis size={16} />
      </IconButton>
      {anchor && (
        <TaskPopover anchor={anchor} onClose={close} label={confirming ? 'Confirm delete' : 'More actions'} width={236}>
          {confirming ? (
            <div className="p-1.5">
              <p className="text-[12.5px] font-semibold" style={{ color: 'var(--text-primary)' }}>Delete {task.taskKey}?</p>
              <p className="mt-1 text-[12px] leading-[1.45]" style={{ color: 'var(--text-muted)' }}>
                It leaves every list and becomes a read-only record.
              </p>
              <div className="mt-3 flex justify-end gap-1.5">
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => setConfirming(false)}
                  className={`h-7 rounded-lg px-2.5 text-[12px] font-medium transition-colors hover:bg-[var(--bg-tertiary)] ${FOCUS_RING}`}
                  style={{ color: 'var(--text-secondary)' }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  role="menuitem"
                  autoFocus
                  onClick={() => { close(); onDelete(); }}
                  className="ui-btn-danger-solid"
                >
                  Delete task
                </button>
              </div>
            </div>
          ) : (
            <>
              <MenuItem icon={<Link2 size={13} />} label="Copy link" onSelect={() => void copyLink()} />
              {onOpenFullPage && <MenuItem icon={<Maximize2 size={13} />} label="Open full page" onSelect={() => { close(); onOpenFullPage(); }} />}
              {canDelete && (
                <>
                  <MenuDivider />
                  <MenuItem icon={<Trash2 size={13} />} label="Delete task…" tone="danger" onSelect={() => setConfirming(true)} />
                </>
              )}
            </>
          )}
        </TaskPopover>
      )}
    </>
  );
}

/**
 * docs/48 §4.3: "Add to 1:1 agenda" — manager-only, flag-gated series picker.
 * The task owner's series (if any) is listed first.
 */
function OneOnOneAttachButton({ task }: { task: TaskDetailResponse }) {
  // Flag-off renders nothing — the inner component owns the query hooks so a
  // disabled feature never mounts React Query calls.
  const enabled = useOneOnOneEnabled();
  if (!enabled) return null;
  return <OneOnOneAttachMenu task={task} />;
}

function OneOnOneAttachMenu({ task }: { task: TaskDetailResponse }) {
  const { addToast } = useToast();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const list = useOneOnOneSeriesList(Boolean(anchor));
  const attach = useAttachOneOnOneAgendaItemToSeries();

  const ownerId = task.ownerType === 'developer' ? task.ownerId : null;
  const series = (list.data?.series ?? []).slice().sort((a, b) => {
    if (a.developerAccountId === ownerId) return -1;
    if (b.developerAccountId === ownerId) return 1;
    return a.developerName.localeCompare(b.developerName);
  });

  return (
    <>
      <IconButton label="Add to 1:1 agenda" expanded={Boolean(anchor)} onClick={(el) => setAnchor(anchor ? null : el)}>
        <ListPlus size={15} />
      </IconButton>
      {anchor && (
        <TaskPopover anchor={anchor} onClose={() => setAnchor(null)} label="1:1 series" width={232}>
          <MenuHeading>Add to 1:1 agenda</MenuHeading>
          {list.isLoading ? (
            <div className="px-2 py-2 text-[12px]" style={{ color: 'var(--text-muted)' }}>Loading…</div>
          ) : series.length === 0 ? (
            <div className="px-2 py-2 text-[12px]" style={{ color: 'var(--text-muted)' }}>
              No 1:1 series yet — start one from the developer&apos;s drawer.
            </div>
          ) : (
            series.map((entry) => (
              <MenuItem
                key={entry.id}
                disabled={attach.isPending}
                label={entry.developerName}
                hint={entry.developerAccountId === ownerId ? 'owner' : undefined}
                onSelect={() =>
                  attach.mutate(
                    { seriesId: entry.id, taskKey: task.taskKey },
                    {
                      onSuccess: () => {
                        setAnchor(null);
                        addToast(`Added to ${entry.developerName}'s 1:1 agenda`, 'success');
                      },
                      onError: (error) =>
                        addToast(error instanceof Error ? error.message : 'Could not add to the 1:1 agenda', 'error'),
                    },
                  )
                }
              />
            ))
          )}
        </TaskPopover>
      )}
    </>
  );
}

// ── Loading ─────────────────────────────────────────────────────────

function TaskDetailSkeleton({ taskKey, fullPage, onClose, onBack }: { taskKey: string; fullPage: boolean; onClose?: () => void; onBack?: () => void }) {
  const bar = (width: string, height = 10) => (
    <span className="block animate-pulse rounded-md" style={{ width, height, background: 'var(--bg-tertiary)' }} />
  );
  return (
    <div className="flex min-h-0 flex-1 flex-col" aria-busy="true">
      <DetailToolbar
        fullPage={fullPage}
        onBack={onBack}
        leading={<span className="font-mono text-[12px] font-bold" style={{ color: 'var(--text-muted)' }}>{taskKey}</span>}
        actions={onClose && <IconButton label="Close" hint="Esc" onClick={onClose}><X size={16} /></IconButton>}
      />
      <div className={`space-y-6 ${fullPage ? 'mx-auto w-full max-w-[1180px] px-8 pt-8' : 'px-6 pt-5'}`}>
        <div className="space-y-3">
          {bar('72%', 22)}
          {bar('120px', 26)}
        </div>
        <div className="space-y-3">
          {[0, 1, 2, 3].map((index) => (
            <div key={index} className="flex items-center gap-6">
              {bar('88px')}
              {bar(`${40 + index * 8}%`)}
            </div>
          ))}
        </div>
        <span className="sr-only">Loading {taskKey}…</span>
      </div>
    </div>
  );
}
