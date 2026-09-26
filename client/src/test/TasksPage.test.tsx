import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { TaskViewMeta, TaskViewTask } from '@/types';

const mockUseTaskViews = vi.fn();
const mockUseTaskViewTasks = vi.fn();
const mockUseTaskViewCounts = vi.fn();
const mockSaveView = vi.fn();
const mockUpdateView = vi.fn();
const mockDeleteView = vi.fn();
const mockApply = vi.fn();
const mockCreate = vi.fn();

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { accountId: 'manager-a', role: 'manager' }, features: { tasksPhase3: true } }),
  useAuthScopeKey: () => 'ws:manager:manager',
}));

vi.mock('@/context/ToastContext', () => ({
  useToast: () => ({ addToast: vi.fn() }),
}));

vi.mock('@/hooks/useLocalDate', () => ({ useLocalDate: () => '2026-09-26' }));

vi.mock('@/hooks/useTaskViews', () => ({
  useTaskViews: (...args: unknown[]) => mockUseTaskViews(...args),
  useTaskViewTasks: (...args: unknown[]) => mockUseTaskViewTasks(...args),
  useTaskViewCounts: (...args: unknown[]) => mockUseTaskViewCounts(...args),
  useSaveTaskView: () => ({ mutateAsync: mockSaveView, isPending: false }),
  useUpdateTaskView: () => ({ mutateAsync: mockUpdateView, isPending: false }),
  useDeleteTaskView: () => ({ mutateAsync: mockDeleteView, isPending: false }),
}));

vi.mock('@/hooks/useTaskListMutations', () => ({
  useTaskListMutations: () => ({ apply: mockApply, create: { mutateAsync: mockCreate }, isPending: false }),
}));

vi.mock('@/hooks/useDevelopers', () => ({
  useDevelopers: () => ({ data: [{ accountId: 'dev-1', displayName: 'Dev One' }] }),
}));

vi.mock('@/hooks/useTaskLabels', () => ({
  useTaskLabels: () => ({
    data: {
      labels: [
        { name: 'escalation', color: 'red', system: false, createdAt: '' },
        { name: 'category:follow_up', color: 'teal', system: true, createdAt: '' },
      ],
    },
  }),
}));

vi.mock('@/components/tasks/TaskDrawer', () => ({
  TaskDrawer: ({ taskKey, onClose }: { taskKey: string | null; onClose: () => void }) =>
    taskKey ? <div data-testid="drawer">{taskKey}<button onClick={onClose}>close drawer</button></div> : null,
  navigateToTaskPage: vi.fn(),
}));

import { TasksPage } from '@/components/tasks/TasksPage';

const TODAY = '2026-09-26';
const OPENISH = ['open', 'active', 'blocked'] as const;
const BUILTIN_VIEWS: TaskViewMeta[] = [
  { id: 'today', name: 'Today', builtin: true, section: 'plan', definition: { filters: { owner: 'me', status: [...OPENISH], later: false, horizon: 'today' }, sort: 'scheduled', group: 'scheduled' } },
  { id: 'inbox', name: 'Inbox', builtin: true, section: 'plan', definition: { filters: { owner: 'inbox', status: ['open'] }, sort: 'created' } },
  { id: 'my-tasks', name: 'My tasks', builtin: true, section: 'plan', definition: { filters: { owner: 'me', later: false }, sort: 'scheduled', group: 'scheduled' } },
  { id: 'waiting', name: 'Waiting on others', builtin: true, section: 'plan', definition: { filters: { waiting: true, later: false, status: [...OPENISH] }, sort: 'updated', group: 'owner' } },
  { id: 'attention', name: 'Needs attention', builtin: true, section: 'review', definition: { filters: { attention: ['overdue', 'stale', 'drift'] }, sort: 'scheduled' } },
];

const NO_SIGNALS = { overdue: false, overdueDays: null, overdueSource: null, stale: false, staleDays: null, drift: false, followUpDue: false } as const;

function task(overrides: Partial<TaskViewTask> = {}): TaskViewTask {
  return {
    id: 1, taskKey: 'T-1', title: 'Task one', kind: 'task', status: 'open', ownerType: 'manager', ownerId: 'manager-a',
    priority: 'normal', scheduledOn: TODAY, dueAt: null, startsAt: null, endsAt: null, participants: null, outcome: null,
    createdByType: 'manager', createdById: 'manager-a', createdAt: '2026-09-20T10:00:00Z', updatedAt: '2026-09-24T10:00:00Z',
    closedAt: null, deletedAt: null, links: [], later: false, parentId: null, trackedByManagerId: 'manager-a',
    labels: [], nextAction: null, followUpAt: null, signals: { ...NO_SIGNALS },
    ...overrides,
  } as TaskViewTask;
}

function tasksResult(tasks: TaskViewTask[]) {
  return { data: { tasks }, isLoading: false, isError: false, isFetching: false, isPlaceholderData: false, error: null, refetch: vi.fn() };
}

function lastDefinition() {
  const calls = mockUseTaskViewTasks.mock.calls;
  return calls[calls.length - 1]?.[0];
}

function row(key: string): HTMLElement {
  return document.querySelector(`[data-task-row="${key}"]`) as HTMLElement;
}

function press(key: string, init: KeyboardEventInit = {}) {
  act(() => {
    fireEvent.keyDown(document.activeElement ?? document.body, { key, ...init });
  });
}

beforeEach(async () => {
  // Flush focus frames scheduled by the previous test's rows.
  await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
  vi.clearAllMocks();
  window.history.replaceState(null, '', '/tasks');
  mockApply.mockResolvedValue(true);
  mockCreate.mockResolvedValue({});
  mockUseTaskViews.mockReturnValue({ data: { views: BUILTIN_VIEWS }, isLoading: false });
  mockUseTaskViewCounts.mockReturnValue({ data: { today: TODAY, counts: { today: { count: 2, overdue: 1 }, inbox: { count: 3, overdue: 0 }, 'my-tasks': { count: 7, overdue: 1 }, attention: { count: 0, overdue: 0 } } } });
  mockUseTaskViewTasks.mockReturnValue(tasksResult([
    task(),
    task({ id: 2, taskKey: 'T-2', title: 'Old one', scheduledOn: '2026-09-23', nextAction: 'waiting on Priya', signals: { ...NO_SIGNALS, overdue: true, overdueDays: 3, overdueSource: 'scheduled' } }),
  ]));
});

describe('TasksPage rail and views (docs/49 §3/§4)', () => {
  it('renders plan + review sections with counts and runs the default Today view', () => {
    render(<TasksPage />);
    const rail = within(screen.getByRole('navigation', { name: 'Task views' }));
    expect(rail.getByRole('button', { name: 'Today, 2 tasks' })).toHaveAttribute('aria-current', 'page');
    expect(rail.getByRole('button', { name: 'Inbox, 3 tasks' })).toBeTruthy();
    expect(rail.getByText('Review')).toBeTruthy();
    expect(lastDefinition()).toEqual(BUILTIN_VIEWS[0]!.definition);
    expect(mockUseTaskViewTasks.mock.calls.at(-1)?.[2]).toBe(TODAY);
    expect(screen.getByRole('heading', { level: 1, name: 'Today' })).toBeTruthy();
  });

  it('selecting a view switches the definition and heading', () => {
    render(<TasksPage />);
    fireEvent.click(within(screen.getByRole('navigation')).getByRole('button', { name: /Waiting on others/ }));
    expect(lastDefinition()).toEqual(BUILTIN_VIEWS[3]!.definition);
    expect(screen.getByRole('heading', { level: 1, name: 'Waiting on others' })).toBeTruthy();
  });

  it('resolves retired view ids from the URL (D6)', () => {
    window.history.replaceState(null, '', '/tasks?view=blocked');
    render(<TasksPage />);
    expect(screen.getByRole('heading', { level: 1, name: 'Waiting on others' })).toBeTruthy();
    expect(lastDefinition().filters.status).toEqual(['blocked']);
  });

  it('applies URL overrides and shows them as removable chips', () => {
    window.history.replaceState(null, '', '/tasks?view=my-tasks&owner=dev-1&group=owner&signal=drift');
    render(<TasksPage />);
    const definition = lastDefinition();
    expect(definition.filters.owner).toEqual(['dev-1']);
    expect(definition.group).toBe('owner');
    fireEvent.click(screen.getByRole('button', { name: 'Clear Owner filter' }));
    expect(lastDefinition().filters.owner).toBe('me');
  });

  it('label filter shows system labels prefix-free and toggles canonical names (D8)', () => {
    render(<TasksPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Label filter' }));
    const menu = screen.getByRole('menu', { name: 'Label filter' });
    fireEvent.click(within(menu).getByRole('menuitemcheckbox', { name: 'follow up' }));
    expect(lastDefinition().filters.labels).toEqual(['category:follow_up']);
  });

  it('saves, deletes, and updates saved views', async () => {
    mockUseTaskViews.mockReturnValue({
      data: { views: [...BUILTIN_VIEWS, { id: 'saved:7', name: 'Escalations', builtin: false, definition: { filters: { status: ['blocked'] } } }] },
      isLoading: false,
    });
    mockSaveView.mockResolvedValue({ id: 11, name: 'Mine', definition: {}, position: 0, createdAt: '', updatedAt: '' });
    mockUpdateView.mockResolvedValue({});
    render(<TasksPage />);
    fireEvent.click(screen.getByLabelText('Delete Escalations'));
    expect(mockDeleteView).toHaveBeenCalledWith(7);

    fireEvent.click(screen.getByText('Save current view'));
    fireEvent.change(screen.getByLabelText('Saved view name'), { target: { value: 'Mine' } });
    await act(async () => { fireEvent.click(screen.getByLabelText('Save view')); });
    expect(mockSaveView).toHaveBeenCalledWith({ name: 'Mine', definition: BUILTIN_VIEWS[0]!.definition });

    fireEvent.click(within(screen.getByRole('navigation')).getByRole('button', { name: 'Escalations' }));
    fireEvent.click(screen.getByRole('button', { name: 'Status filter' }));
    fireEvent.click(within(screen.getByRole('menu', { name: 'Status filter' })).getByRole('menuitemcheckbox', { name: 'Open' }));
    expect(screen.getByLabelText('Unsaved filter changes')).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Update view' })); });
    expect(mockUpdateView).toHaveBeenCalledWith({ id: 7, updates: { definition: { filters: { status: ['open'] } } } });
  });
});

describe('TasksPage rows (docs/49 §5)', () => {
  it('groups by plan date, suppresses implied meta, and renders nextAction', () => {
    render(<TasksPage />);
    expect(screen.getByText('Overdue')).toBeTruthy();
    expect(screen.getByText('3d overdue')).toBeTruthy();
    expect(screen.getByText('→ waiting on Priya')).toBeTruthy();
    // Today bucket hides the redundant date; owner:"me" hides the avatar.
    expect(within(row('T-1')).queryByText('Today')).toBeNull();
    expect(within(row('T-1')).queryByLabelText(/Owner:/)).toBeNull();
  });

  it('shows reason chips in Needs attention', () => {
    window.history.replaceState(null, '', '/tasks?view=attention');
    mockUseTaskViewTasks.mockReturnValue(tasksResult([task({ signals: { ...NO_SIGNALS, stale: true, staleDays: 6, drift: true } })]));
    render(<TasksPage />);
    expect(screen.getByText('Stale 6d')).toBeTruthy();
    expect(screen.getByText('Jira drift')).toBeTruthy();
  });

  it('search filters the loaded rows', () => {
    render(<TasksPage />);
    fireEvent.change(screen.getByLabelText('Search tasks'), { target: { value: 'priya' } });
    expect(screen.queryByText('Task one')).toBeNull();
    expect(screen.getByText('Old one')).toBeTruthy();
  });

  it('opens the drawer from a row click and the ?task= deep link', () => {
    render(<TasksPage />);
    fireEvent.click(screen.getByText('Task one'));
    expect(screen.getByTestId('drawer').textContent).toContain('T-1');
  });

  it('opens the TaskDrawer for the ?task= deep link', () => {
    window.history.replaceState(null, '', '/tasks?task=T-2');
    render(<TasksPage />);
    expect(screen.getByTestId('drawer').textContent).toContain('T-2');
  });
});

describe('TasksPage empty/loading/error (docs/49 §11)', () => {
  it('Inbox zero is a success state', () => {
    window.history.replaceState(null, '', '/tasks?view=inbox');
    mockUseTaskViewTasks.mockReturnValue(tasksResult([]));
    render(<TasksPage />);
    expect(screen.getByText('Inbox zero')).toBeTruthy();
  });

  it('Today empty offers Plan your day with a candidate count', () => {
    mockUseTaskViewTasks.mockReturnValue(tasksResult([]));
    render(<TasksPage />);
    // (my-tasks 7 − today 2) + inbox 3
    expect(screen.getByText('8 open tasks could be pulled in.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Plan your day' }));
    expect(screen.getByRole('heading', { level: 1, name: 'My tasks' })).toBeTruthy();
  });

  it('filtered empty offers Clear filters', () => {
    window.history.replaceState(null, '', '/tasks?view=today&status=dropped');
    mockUseTaskViewTasks.mockReturnValue(tasksResult([]));
    render(<TasksPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(lastDefinition().filters.status).toEqual([...OPENISH]);
  });

  it('skeleton on first load; inline error with retry', () => {
    mockUseTaskViewTasks.mockReturnValue({ data: undefined, isLoading: true, isError: false, isFetching: true, isPlaceholderData: false, error: null, refetch: vi.fn() });
    const { unmount } = render(<TasksPage />);
    expect(screen.getByLabelText('Loading tasks')).toBeTruthy();
    unmount();
    const refetch = vi.fn();
    mockUseTaskViewTasks.mockReturnValue({ data: undefined, isLoading: false, isError: true, isFetching: false, isPlaceholderData: false, error: new Error('boom'), refetch });
    render(<TasksPage />);
    fireEvent.click(screen.getByRole('button', { name: /Retry/ }));
    expect(refetch).toHaveBeenCalled();
  });
});

describe('TasksPage keyboard, actions, and lingering (docs/49 §6–§8)', () => {
  it('j/k move focus with roving tabindex; Enter opens; focus returns after the drawer closes', () => {
    render(<TasksPage />);
    press('j');
    expect(row('T-2')).toHaveAttribute('tabindex', '0');
    press('j');
    expect(row('T-1')).toHaveAttribute('tabindex', '0');
    press('k');
    expect(row('T-2')).toHaveAttribute('tabindex', '0');
    press('Enter');
    expect(screen.getByTestId('drawer').textContent).toContain('T-2');
    // Shortcuts are suspended while the drawer is open.
    press('j');
    expect(row('T-2')).toHaveAttribute('tabindex', '0');
    fireEvent.click(screen.getByText('close drawer'));
    expect(screen.queryByTestId('drawer')).toBeNull();
  });

  it('ignores shortcuts typed into inputs and with modifier keys', () => {
    render(<TasksPage />);
    const search = screen.getByLabelText('Search tasks');
    search.focus();
    fireEvent.keyDown(search, { key: 'j' });
    expect(row('T-2')).toHaveAttribute('tabindex', '-1');
    fireEvent.keyDown(document.body, { key: 'k', metaKey: true });
    expect(row('T-2')).toHaveAttribute('tabindex', '-1');
    press('/');
  });

  it('Space marks the focused task done and the row lingers until focus moves (R1/R2)', async () => {
    const { rerender } = render(<TasksPage />);
    press('j');
    await act(async () => { press(' '); });
    expect(mockApply).toHaveBeenCalledWith(
      [expect.objectContaining({ task: expect.objectContaining({ taskKey: 'T-2' }), changes: { status: 'done' } })],
      expect.objectContaining({ label: 'Marked 1 task done' }),
    );
    // The refetch no longer returns T-2 — it stays put, struck through.
    mockUseTaskViewTasks.mockReturnValue(tasksResult([task()]));
    rerender(<TasksPage />);
    expect(row('T-2')).toBeTruthy();
    expect(screen.getByText('Old one')).toHaveStyle({ textDecoration: 'line-through' });
    press('j');
    expect(row('T-2')).toBeNull();
  });

  it('x selects, the bulk bar appears, and # drops the selection', async () => {
    render(<TasksPage />);
    press('j');
    press('x');
    press('j');
    press('x');
    expect(screen.getByRole('toolbar', { name: 'Bulk actions' })).toBeTruthy();
    expect(screen.getByText('2 selected')).toBeTruthy();
    expect(row('T-1')).toHaveAttribute('aria-selected', 'true');
    await act(async () => { press('#'); });
    expect(mockApply.mock.calls[0]![0]).toHaveLength(2);
    expect(mockApply.mock.calls[0]![0][0].changes).toEqual({ status: 'dropped' });
    press('Escape');
    expect(row('T-1')).toHaveAttribute('aria-selected', 'false');
    // The bar leaves via its exit animation.
    await waitFor(() => expect(screen.queryByRole('toolbar', { name: 'Bulk actions' })).toBeNull());
  });

  it('s then m schedules the focused task for tomorrow', async () => {
    render(<TasksPage />);
    press('j');
    press('s');
    const menu = screen.getByRole('menu', { name: 'Schedule' });
    await act(async () => { fireEvent.keyDown(menu, { key: 'm' }); });
    expect(mockApply).toHaveBeenCalledWith(
      [expect.objectContaining({ changes: { scheduledOn: '2026-09-27', later: false } })],
      expect.objectContaining({ label: 'Scheduled for tomorrow · 1 task' }),
    );
    expect(screen.queryByRole('menu', { name: 'Schedule' })).toBeNull();
  });

  it('status glyph opens a five-status menu', async () => {
    render(<TasksPage />);
    fireEvent.click(within(row('T-1')).getByRole('button', { name: /Change status/ }));
    const menu = screen.getByRole('menu', { name: 'Set status' });
    expect(within(menu).getAllByRole('menuitemradio')).toHaveLength(5);
    await act(async () => { fireEvent.click(within(menu).getByRole('menuitemradio', { name: 'Blocked' })); });
    expect(mockApply.mock.calls[0]![0][0].changes).toEqual({ status: 'blocked' });
  });

  it('assign menu reassigns to a developer', async () => {
    render(<TasksPage />);
    press('j');
    press('a');
    const menu = screen.getByRole('menu', { name: 'Assign' });
    await act(async () => { fireEvent.click(within(menu).getByRole('menuitem', { name: 'Dev One' })); });
    expect(mockApply.mock.calls[0]![0][0].changes).toEqual({ ownerType: 'developer', ownerId: 'dev-1' });
  });

  it('Overdue header moves every overdue task to today', async () => {
    render(<TasksPage />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Move all to today/ })); });
    expect(mockApply.mock.calls[0]![0].map((item: { task: { taskKey: string } }) => item.task.taskKey)).toEqual(['T-2']);
    expect(mockApply.mock.calls[0]![0][0].changes).toEqual({ scheduledOn: TODAY, later: false });
  });

  it('inline add inherits the group context', async () => {
    render(<TasksPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Add task to Today' }));
    const input = screen.getByLabelText('New task in Today');
    fireEvent.change(input, { target: { value: 'Prep 1:1' } });
    await act(async () => { fireEvent.submit(input.closest('form')!); });
    expect(mockCreate).toHaveBeenCalledWith({ title: 'Prep 1:1', scheduledOn: TODAY });
  });

  it('? opens the shortcut cheat sheet', () => {
    render(<TasksPage />);
    press('?');
    expect(screen.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeTruthy();
  });
});
