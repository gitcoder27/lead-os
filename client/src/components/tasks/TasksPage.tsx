import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowUpRight,
  BookmarkPlus,
  Check,
  Inbox,
  ListChecks,
  Loader2,
  Pencil,
  Trash2,
  X,
} from 'lucide-react';
import { useToast } from '@/context/ToastContext';
import { useDevelopers } from '@/hooks/useDevelopers';
import { useTaskLabels } from '@/hooks/useTaskLabels';
import {
  useDeleteTaskView,
  useSaveTaskView,
  useTaskViewTasks,
  useTaskViews,
  useUpdateTaskView,
} from '@/hooks/useTaskViews';
import {
  applyTaskViewOverrides,
  groupTaskViewTasks,
  taskViewStateFromParams,
  type TaskViewOverrides,
  type TaskViewUrlState,
} from '@/lib/task-views';
import { taskKeyFromParams, writeTaskParam } from '@/lib/view-params';
import { getLocalIsoDate } from '@/lib/utils';
import type { ManagerTask, TaskStatus, TaskViewGroup, TaskViewMeta, TaskViewSort } from '@/types';
import { TaskDrawer, navigateToTaskPage } from './TaskDrawer';
import { TaskLabelChip } from './TaskLabelPicker';

const DEFAULT_VIEW_ID = 'today-plan';

const STATUS_FILTERS: { value: TaskStatus; label: string }[] = [
  { value: 'open', label: 'Open' },
  { value: 'active', label: 'Active' },
  { value: 'blocked', label: 'Blocked' },
  { value: 'done', label: 'Done' },
  { value: 'dropped', label: 'Dropped' },
];

const OWNER_FILTERS = [
  { value: '', label: 'Any owner' },
  { value: 'me', label: 'Mine' },
  { value: 'team', label: 'Team' },
  { value: 'inbox', label: 'Inbox' },
];

const SORT_OPTIONS: { value: TaskViewSort; label: string }[] = [
  { value: 'scheduled', label: 'Schedule' },
  { value: 'updated', label: 'Recently updated' },
  { value: 'created', label: 'Recently created' },
  { value: 'priority', label: 'Priority' },
];

const GROUP_OPTIONS: { value: '' | TaskViewGroup; label: string }[] = [
  { value: '', label: 'No grouping' },
  { value: 'owner', label: 'Owner' },
  { value: 'status', label: 'Status' },
  { value: 'label', label: 'Label' },
  { value: 'scheduled', label: 'Schedule' },
];

interface TasksPageProps {
  /** URL state pushed in by App on popstate/navigation. */
  urlState?: TaskViewUrlState;
  urlStateNonce?: number;
  onUrlStateChange?: (state: TaskViewUrlState) => void;
  /** Deep-linked task (e.g. from a Today action target while already on /tasks). */
  openTaskKey?: string;
  openTaskNonce?: number;
}

/**
 * Phase 3 (P3-D1, spec §5.1): the Tasks workspace — a view rail of built-in
 * and saved views, an override filter bar, a grouped task list, and the
 * shared TaskDrawer. URL: `/tasks?view=<id>` plus flat override params.
 */
export function TasksPage({ urlState, urlStateNonce, onUrlStateChange, openTaskKey, openTaskNonce }: TasksPageProps = {}) {
  const { addToast } = useToast();
  const today = getLocalIsoDate();
  const views = useTaskViews(true);
  const saveView = useSaveTaskView();
  const updateView = useUpdateTaskView();
  const deleteView = useDeleteTaskView();
  const developers = useDevelopers();
  const labels = useTaskLabels();

  const [state, setState] = useState<TaskViewUrlState>(() =>
    taskViewStateFromParams(new URLSearchParams(window.location.search)),
  );
  const [drawerTaskKey, setDrawerTaskKey] = useState<string | undefined>(() =>
    taskKeyFromParams(new URLSearchParams(window.location.search)),
  );
  const [savingView, setSavingView] = useState(false);
  const [saveName, setSaveName] = useState('');

  // External URL changes (popstate, palette deep links) replace local state.
  useEffect(() => {
    if (urlStateNonce !== undefined && urlStateNonce > 0) {
      setState(urlState ?? { view: undefined, overrides: {} });
      setDrawerTaskKey(taskKeyFromParams(new URLSearchParams(window.location.search)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlStateNonce]);

  // App-level deep links (Today targets) pushState without popstate — the
  // nonce opens the drawer instead.
  useEffect(() => {
    if (openTaskNonce !== undefined && openTaskNonce > 0 && openTaskKey) {
      setDrawerTaskKey(openTaskKey);
      writeTaskParam(openTaskKey);
    }
  }, [openTaskNonce, openTaskKey]);

  useEffect(() => {
    onUrlStateChange?.(state);
  }, [onUrlStateChange, state]);

  const allViews = useMemo(() => views.data?.views ?? [], [views.data]);
  const selectedId = state.view ?? DEFAULT_VIEW_ID;
  const selectedView: TaskViewMeta | undefined = allViews.find((view) => view.id === selectedId) ?? allViews[0];
  const definition = useMemo(
    () => (selectedView ? applyTaskViewOverrides(selectedView.definition, state.overrides) : undefined),
    [selectedView, state.overrides],
  );
  const tasks = useTaskViewTasks(definition, Boolean(definition));
  const taskList = useMemo(() => tasks.data?.tasks ?? [], [tasks.data]);

  const ownerName = useCallback(
    (ownerType: string | null, ownerId: string | null) => {
      if (ownerType === 'developer' && ownerId) {
        return developers.data?.find((dev) => dev.accountId === ownerId)?.displayName ?? 'Developer';
      }
      return 'Me';
    },
    [developers.data],
  );

  const grouped = useMemo(
    () => groupTaskViewTasks(taskList, definition?.group, today, ownerName),
    [taskList, definition?.group, today, ownerName],
  );

  const setView = (view: string | undefined) =>
    setState((current) => ({ view, overrides: view === current.view ? current.overrides : {} }));
  const setOverride = (overrides: Partial<TaskViewOverrides>) =>
    setState((current) => ({ ...current, overrides: { ...current.overrides, ...overrides } }));

  const openTask = (taskKey: string) => {
    setDrawerTaskKey(taskKey);
    writeTaskParam(taskKey);
  };
  const closeDrawer = () => {
    setDrawerTaskKey(undefined);
    writeTaskParam(undefined);
  };

  const savedSelected = selectedView && !selectedView.builtin ? selectedView : undefined;
  const overridesDirty = Boolean(
    state.overrides.owner || state.overrides.status?.length || state.overrides.label?.length || state.overrides.group || state.overrides.sort,
  );

  const handleSaveView = async () => {
    const name = saveName.trim();
    if (!name || !definition) return;
    try {
      const created = await saveView.mutateAsync({ name, definition });
      setSavingView(false);
      setSaveName('');
      setState({ view: `saved:${created.id}`, overrides: {} });
      addToast('View saved', 'success');
    } catch (error) {
      addToast(error instanceof Error ? error.message : 'Could not save view', 'error');
    }
  };

  const handleDeleteSaved = async (view: TaskViewMeta) => {
    const id = Number(view.id.slice(6));
    try {
      await deleteView.mutateAsync(id);
      setState({ view: undefined, overrides: {} });
      addToast('View deleted', 'success');
    } catch (error) {
      addToast(error instanceof Error ? error.message : 'Could not delete view', 'error');
    }
  };

  const handleRenameSaved = async (view: TaskViewMeta) => {
    const name = window.prompt('Rename view', view.name)?.trim();
    if (!name || name === view.name) return;
    try {
      await updateView.mutateAsync({ id: Number(view.id.slice(6)), updates: { name } });
      addToast('View renamed', 'success');
    } catch (error) {
      addToast(error instanceof Error ? error.message : 'Could not rename view', 'error');
    }
  };

  return (
    <main className="flex min-h-0 flex-1 overflow-hidden" aria-label="Tasks">
      <aside
        className="flex w-56 shrink-0 flex-col overflow-y-auto px-3 py-5"
        style={{ borderRight: '1px solid var(--border)', background: 'var(--bg-secondary)' }}
        aria-label="Task views"
      >
        <p className="px-2 pb-2 text-[11px] font-bold uppercase tracking-[0.14em]" style={{ color: 'var(--text-muted)' }}>
          Views
        </p>
        <ViewRail
          views={allViews.filter((view) => view.builtin)}
          selectedId={selectedId}
          onSelect={(id) => setView(id)}
        />
        {allViews.some((view) => !view.builtin) && (
          <>
            <p className="px-2 pb-2 pt-5 text-[11px] font-bold uppercase tracking-[0.14em]" style={{ color: 'var(--text-muted)' }}>
              My views
            </p>
            <ViewRail
              views={allViews.filter((view) => !view.builtin)}
              selectedId={selectedId}
              onSelect={(id) => setView(id)}
              onRename={handleRenameSaved}
              onDelete={handleDeleteSaved}
            />
          </>
        )}
        {savingView ? (
          <form
            className="mt-3 flex items-center gap-1.5 px-1"
            onSubmit={(e) => {
              e.preventDefault();
              void handleSaveView();
            }}
          >
            <input
              autoFocus
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              placeholder="View name"
              className="min-w-0 flex-1 rounded-lg px-2 py-1.5 text-[12px] outline-none"
              style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
              aria-label="Saved view name"
            />
            <button
              type="submit"
              disabled={!saveName.trim() || saveView.isPending}
              className="flex h-7 w-7 items-center justify-center rounded-lg disabled:opacity-40"
              style={{ background: 'var(--accent-glow)', color: 'var(--accent)' }}
              aria-label="Save view"
            >
              <Check size={12} />
            </button>
            <button
              type="button"
              onClick={() => setSavingView(false)}
              className="flex h-7 w-7 items-center justify-center rounded-lg"
              style={{ color: 'var(--text-muted)' }}
              aria-label="Cancel save"
            >
              <X size={12} />
            </button>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setSavingView(true)}
            disabled={!definition}
            className="mt-3 flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[12px] font-semibold transition-colors hover:brightness-110 disabled:opacity-40"
            style={{ color: 'var(--accent)', background: 'var(--accent-glow)' }}
          >
            <BookmarkPlus size={12} />
            Save current view
          </button>
        )}
        {savedSelected && overridesDirty && (
          <button
            type="button"
            onClick={() =>
              void updateView.mutateAsync({ id: Number(savedSelected.id.slice(6)), updates: { definition } }).then(
                () => addToast('View updated', 'success'),
                (error: Error) => addToast(error.message, 'error'),
              )
            }
            className="mt-2 flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[12px] font-medium"
            style={{ color: 'var(--text-secondary)', border: '1px solid var(--border)' }}
          >
            <Pencil size={11} />
            Update “{savedSelected.name}” with these filters
          </button>
        )}
      </aside>

      <section className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="px-6 pb-3 pt-5" style={{ borderBottom: '1px solid var(--border)' }}>
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h1 className="text-[20px] font-bold" style={{ color: 'var(--text-primary)' }}>
              {selectedView?.name ?? 'Tasks'}
            </h1>
            <span className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
              {tasks.isLoading ? 'Loading…' : `${taskList.length} task${taskList.length === 1 ? '' : 's'}`}
            </span>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <select
              value={state.overrides.owner ?? ''}
              onChange={(e) => setOverride({ owner: e.target.value || undefined })}
              className="rounded-lg px-2 py-1.5 text-[12px] outline-none"
              style={{ background: 'var(--bg-tertiary)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}
              aria-label="Owner filter"
            >
              {OWNER_FILTERS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
              {(developers.data ?? []).map((dev) => (
                <option key={dev.accountId} value={dev.accountId}>{dev.displayName}</option>
              ))}
            </select>
            <select
              value={state.overrides.status?.[0] ?? ''}
              onChange={(e) => setOverride({ status: e.target.value ? [e.target.value as TaskStatus] : undefined })}
              className="rounded-lg px-2 py-1.5 text-[12px] outline-none"
              style={{ background: 'var(--bg-tertiary)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}
              aria-label="Status filter"
            >
              <option value="">Any status</option>
              {STATUS_FILTERS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            <select
              value={state.overrides.label?.[0] ?? ''}
              onChange={(e) => setOverride({ label: e.target.value ? [e.target.value] : undefined })}
              className="rounded-lg px-2 py-1.5 text-[12px] outline-none"
              style={{ background: 'var(--bg-tertiary)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}
              aria-label="Label filter"
            >
              <option value="">Any label</option>
              {(labels.data?.labels ?? []).map((label) => (
                <option key={label.name} value={label.name}>{label.name}</option>
              ))}
            </select>
            <span className="mx-1 h-4 w-px" style={{ background: 'var(--border)' }} />
            <select
              value={state.overrides.sort ?? ''}
              onChange={(e) => setOverride({ sort: (e.target.value || undefined) as TaskViewSort | undefined })}
              className="rounded-lg px-2 py-1.5 text-[12px] outline-none"
              style={{ background: 'var(--bg-tertiary)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}
              aria-label="Sort order"
            >
              <option value="">Default sort</option>
              {SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            <select
              value={state.overrides.group ?? ''}
              onChange={(e) => setOverride({ group: (e.target.value || undefined) as TaskViewGroup | undefined })}
              className="rounded-lg px-2 py-1.5 text-[12px] outline-none"
              style={{ background: 'var(--bg-tertiary)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}
              aria-label="Group by"
            >
              <option value="">Default grouping</option>
              {GROUP_OPTIONS.filter((option) => option.value !== '').map((option) => (
                <option key={option.value} value={option.value}>Group: {option.label}</option>
              ))}
            </select>
            {overridesDirty && (
              <button
                type="button"
                onClick={() => setState((current) => ({ ...current, overrides: {} }))}
                className="rounded-lg px-2 py-1.5 text-[12px] font-medium"
                style={{ color: 'var(--text-muted)' }}
              >
                Clear overrides
              </button>
            )}
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          {tasks.isLoading ? (
            <div className="flex items-center justify-center gap-2 py-16" style={{ color: 'var(--text-muted)' }}>
              <Loader2 size={15} className="animate-spin" />
              <span className="text-[13px]">Loading tasks…</span>
            </div>
          ) : tasks.isError ? (
            <div className="py-16 text-center text-[13px]" style={{ color: 'var(--danger)' }}>
              {tasks.error instanceof Error ? tasks.error.message : 'Could not load tasks'}
            </div>
          ) : taskList.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-16 text-center">
              <Inbox size={20} style={{ color: 'var(--text-muted)' }} />
              <p className="text-[13px] font-medium" style={{ color: 'var(--text-secondary)' }}>
                Nothing in this view
              </p>
              <p className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
                Capture a task with ⌘I, or loosen the filters.
              </p>
            </div>
          ) : (
            <div className="mx-auto max-w-3xl space-y-5">
              {grouped.map((group) => (
                <section key={group.key} aria-label={group.label || 'Tasks'}>
                  {group.label && (
                    <h2
                      className="mb-1.5 flex items-center gap-2 px-1 text-[11px] font-bold uppercase tracking-[0.14em]"
                      style={{ color: 'var(--text-muted)' }}
                    >
                      <ListChecks size={11} />
                      {group.label}
                      <span className="font-normal normal-case tracking-normal">({group.tasks.length})</span>
                    </h2>
                  )}
                  <div className="space-y-1">
                    {group.tasks.map((task) => (
                      <TaskRow key={task.id} task={task} ownerName={ownerName} onOpen={openTask} />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>
      </section>

      <TaskDrawer
        taskKey={drawerTaskKey ?? null}
        onClose={closeDrawer}
        onNavigateTask={(key) => {
          closeDrawer();
          navigateToTaskPage(key);
        }}
      />
    </main>
  );
}

function ViewRail({
  views,
  selectedId,
  onSelect,
  onRename,
  onDelete,
}: {
  views: TaskViewMeta[];
  selectedId: string;
  onSelect: (id: string) => void;
  onRename?: (view: TaskViewMeta) => void;
  onDelete?: (view: TaskViewMeta) => void;
}) {
  return (
    <div className="space-y-0.5" role="listbox" aria-label="Task views">
      {views.map((view) => {
        const selected = view.id === selectedId;
        return (
          <div
            key={view.id}
            role="option"
            aria-selected={selected}
            className="group flex items-center rounded-lg transition-colors"
            style={{
              background: selected ? 'var(--accent-glow)' : 'transparent',
            }}
          >
            <button
              type="button"
              onClick={() => onSelect(view.id)}
              className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left text-[12.5px]"
              style={{ color: selected ? 'var(--accent)' : 'var(--text-secondary)', fontWeight: selected ? 600 : 500 }}
            >
              <span className="truncate">{view.name}</span>
            </button>
            {!view.builtin && (onRename || onDelete) && (
              <span className="hidden shrink-0 items-center pr-1 group-hover:flex">
                {onRename && (
                  <button
                    type="button"
                    onClick={() => onRename(view)}
                    className="flex h-5 w-5 items-center justify-center rounded"
                    style={{ color: 'var(--text-muted)' }}
                    aria-label={`Rename ${view.name}`}
                  >
                    <Pencil size={10} />
                  </button>
                )}
                {onDelete && (
                  <button
                    type="button"
                    onClick={() => onDelete(view)}
                    className="flex h-5 w-5 items-center justify-center rounded"
                    style={{ color: 'var(--text-muted)' }}
                    aria-label={`Delete ${view.name}`}
                  >
                    <Trash2 size={10} />
                  </button>
                )}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function TaskRow({
  task,
  ownerName,
  onOpen,
}: {
  task: ManagerTask;
  ownerName: (ownerType: string | null, ownerId: string | null) => string;
  onOpen: (taskKey: string) => void;
}) {
  const jiraLink = task.links.find((link) => link.kind === 'jira');
  return (
    <button
      type="button"
      onClick={() => onOpen(task.taskKey)}
      className="group flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:brightness-110"
      style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)' }}
    >
      <span className="shrink-0 font-mono text-[11px] font-bold" style={{ color: 'var(--text-muted)' }}>{task.taskKey}</span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span
            className="truncate text-[13px] font-medium"
            style={{
              color: 'var(--text-primary)',
              textDecoration: task.status === 'done' || task.status === 'dropped' ? 'line-through' : undefined,
              opacity: task.status === 'dropped' ? 0.7 : undefined,
            }}
          >
            {task.title}
          </span>
          {task.labels.slice(0, 4).map((label) => (
            <TaskLabelChip key={label} name={label} />
          ))}
        </span>
        <span className="mt-0.5 flex items-center gap-2 text-[11px]" style={{ color: 'var(--text-muted)' }}>
          <span>{task.ownerType ? ownerName(task.ownerType, task.ownerId) : 'Inbox'}</span>
          {task.scheduledOn && <span>· {task.scheduledOn}</span>}
          {task.later && <span>· Later</span>}
          {task.followUpAt && <span>· Follow-up</span>}
        </span>
      </span>
      {jiraLink && (
        <span
          className="shrink-0 rounded px-1 py-0.5 font-mono text-[10px] font-semibold"
          style={{ background: 'var(--bg-tertiary)', color: 'var(--accent)', border: '1px solid var(--border)' }}
        >
          {jiraLink.ref}
        </span>
      )}
      <span
        className="rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.05em]"
        style={taskStatusStyle(task.status)}
      >
        {task.status}
      </span>
      <ArrowUpRight size={12} className="opacity-0 transition-opacity group-hover:opacity-60" style={{ color: 'var(--text-muted)' }} />
    </button>
  );
}

function taskStatusStyle(status: TaskStatus): Record<string, string> {
  switch (status) {
    case 'active': return { background: 'rgba(6,182,212,0.1)', color: 'var(--accent)', border: '1px solid rgba(6,182,212,0.22)' };
    case 'blocked': return { background: 'rgba(239,68,68,0.1)', color: 'var(--danger)', border: '1px solid rgba(239,68,68,0.2)' };
    case 'done': return { background: 'rgba(16,185,129,0.1)', color: 'var(--success)', border: '1px solid rgba(16,185,129,0.2)' };
    case 'dropped': return { background: 'var(--bg-tertiary)', color: 'var(--text-muted)', border: '1px solid var(--border)' };
    default: return { background: 'var(--bg-tertiary)', color: 'var(--text-secondary)', border: '1px solid var(--border)' };
  }
}
