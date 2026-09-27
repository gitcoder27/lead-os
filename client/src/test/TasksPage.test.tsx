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
const mockUser = vi.fn();
const mockAddToast = vi.fn();
let mockDoneToday: TaskViewTask[] = [];
let mockDrawerProps: {
  taskKey: string | null;
  onClose: () => void;
  orderedKeys?: string[];
  onStepTask?: (key: string) => void;
} | null = null;

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: mockUser(), features: { tasksPhase3: true } }),
  useAuthScopeKey: () => 'ws:manager:manager',
}));

vi.mock('@/context/ToastContext', () => ({
  useToast: () => ({ addToast: mockAddToast }),
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
  TaskDrawer: (props: {
    taskKey: string | null;
    onClose: () => void;
    orderedKeys?: string[];
    onStepTask?: (key: string) => void;
  }) => {
    mockDrawerProps = props;
    return props.taskKey ? (
      <div data-testid="drawer">
        {props.taskKey}
        <button onClick={props.onClose}>close drawer</button>
      </div>
    ) : null;
  },
  navigateToTaskPage: vi.fn(),
}));

import { TasksPage } from '@/components/tasks/TasksPage';

const TODAY = '2026-09-26';
const OPENISH = ['open', 'active', 'blocked'] as const;
const BUILTIN_VIEWS: TaskViewMeta[] = [
  { id: 'today', name: 'Planned today', builtin: true, section: 'plan', definition: { filters: { owner: 'me', status: [...OPENISH], later: false, horizon: 'today' }, sort: 'scheduled', group: 'scheduled' } },
  { id: 'inbox', name: 'Inbox', builtin: true, section: 'plan', definition: { filters: { owner: 'inbox', status: ['open'] }, sort: 'created' } },
  { id: 'my-tasks', name: 'My tasks', builtin: true, section: 'plan', definition: { filters: { owner: 'me', later: false }, sort: 'scheduled', group: 'scheduled' } },
  { id: 'waiting', name: 'Waiting on others', builtin: true, section: 'plan', definition: { filters: { waiting: true, later: false, status: [...OPENISH] }, sort: 'updated', group: 'owner' } },
  { id: 'attention', name: 'Needs attention', builtin: true, section: 'review', definition: { filters: { attention: ['overdue', 'stale', 'drift'], later: false }, sort: 'scheduled' } },
];

const NO_SIGNALS = { overdue: false, overdueDays: null, overdueSource: null, stale: false, staleDays: null, drift: false, followUpDue: false } as const;

function task(overrides: Partial<TaskViewTask> = {}): TaskViewTask {
  return {
    id: 1, taskKey: 'T-1', title: 'Task one', kind: 'task', status: 'open', ownerType: 'manager', ownerId: 'manager-a',
    priority: 'normal', scheduledOn: TODAY, dueAt: null, startsAt: null, endsAt: null, participants: null, outcome: null,
    createdByType: 'manager', createdById: 'manager-a', createdAt: '2026-09-20T10:00:00Z', updatedAt: '2026-09-24T10:00:00Z',
    closedAt: null, deletedAt: null, links: [], later: false, parentId: null, trackedByManagerId: 'manager-a',
    labels: [], nextAction: null, followUpAt: null, signals: { ...NO_SIGNALS }, schedulePosition: null,
    ...overrides,
  } as TaskViewTask;
}

function tasksResult(tasks: TaskViewTask[]) {
  return { data: { tasks }, isLoading: false, isError: false, isFetching: false, isPlaceholderData: false, error: null, refetch: vi.fn() };
}

function lastDefinition() {
  // The page also fires the F5 "Done today" query — skip it; it is the call
  // whose definition carries filters.closed.
  const calls = mockUseTaskViewTasks.mock.calls.filter((call) => !call[0]?.filters?.closed);
  return calls.at(-1)?.[0];
}

function lastDoneTodayDefinition() {
  const calls = mockUseTaskViewTasks.mock.calls.filter((call) => call[0]?.filters?.closed);
  return calls.at(-1)?.[0];
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
  mockUser.mockReturnValue({ accountId: 'manager-a', role: 'manager', developerAccountId: undefined });
  window.history.replaceState(null, '', '/tasks');
  mockApply.mockResolvedValue(true);
  mockCreate.mockResolvedValue({});
  mockDoneToday = [];
  mockDrawerProps = null;
  mockUseTaskViews.mockReturnValue({ data: { views: BUILTIN_VIEWS }, isLoading: false });
  mockUseTaskViewCounts.mockReturnValue({ data: { today: TODAY, counts: { today: { count: 2, overdue: 1 }, inbox: { count: 3, overdue: 0 }, 'my-tasks': { count: 7, overdue: 1 }, attention: { count: 0, overdue: 0 } } } });
  const open = tasksResult([
    task(),
    task({ id: 2, taskKey: 'T-2', title: 'Old one', scheduledOn: '2026-09-23', nextAction: 'waiting on Priya', signals: { ...NO_SIGNALS, overdue: true, overdueDays: 3, overdueSource: 'scheduled' } }),
  ]);
  mockUseTaskViewTasks.mockImplementation((definition?: { filters?: { closed?: unknown } }) =>
    definition?.filters?.closed ? tasksResult(mockDoneToday) : open,
  );
});

describe('TasksPage rail and views (docs/49 §3/§4)', () => {
  it('renders plan + review sections with counts and runs the default Planned today view', () => {
    render(<TasksPage />);
    const rail = within(screen.getByRole('navigation', { name: 'Task views' }));
    expect(rail.getByRole('button', { name: 'Planned today, 2 tasks' })).toHaveAttribute('aria-current', 'page');
    expect(rail.getByRole('button', { name: 'Inbox, 3 tasks' })).toBeTruthy();
    expect(rail.getByText('Review')).toBeTruthy();
    expect(lastDefinition()).toEqual(BUILTIN_VIEWS[0]!.definition);
    expect(mockUseTaskViewTasks.mock.calls.at(-1)?.[2]).toBe(TODAY);
    expect(screen.getByRole('heading', { level: 1, name: 'Planned today' })).toBeTruthy();
  });

  it('selecting a view switches the definition and heading', () => {
    render(<TasksPage />);
    fireEvent.click(within(screen.getByRole('navigation')).getByRole('button', { name: /Waiting on others/ }));
    expect(lastDefinition()).toEqual(BUILTIN_VIEWS[3]!.definition);
    expect(screen.getByRole('heading', { level: 1, name: 'Waiting on others' })).toBeTruthy();
  });

  it('g then w jumps to Waiting on others; an unknown chord key falls through', () => {
    render(<TasksPage />);
    press('g');
    press('w');
    expect(lastDefinition()).toEqual(BUILTIN_VIEWS[3]!.definition);
    expect(screen.getByRole('heading', { level: 1, name: 'Waiting on others' })).toBeTruthy();
    // Armed chord + unrecognized key: disarms, key behaves normally (j focuses a row).
    press('g');
    press('j');
    expect(lastDefinition()).toEqual(BUILTIN_VIEWS[3]!.definition); // still waiting
    expect(document.querySelector('[data-task-row][tabindex="0"]')).not.toBeNull();
  });

  it('resolves retired view ids from the URL (D6)', () => {
    window.history.replaceState(null, '', '/tasks?view=blocked');
    render(<TasksPage />);
    expect(screen.getByRole('heading', { level: 1, name: 'Waiting on others' })).toBeTruthy();
    expect(lastDefinition().filters.status).toEqual(['blocked']);
  });

  it('resolves the retired upcoming alias to My tasks (docs/51 F4)', () => {
    window.history.replaceState(null, '', '/tasks?view=upcoming');
    render(<TasksPage />);
    expect(screen.getByRole('heading', { level: 1, name: 'My tasks' })).toBeTruthy();
    expect(lastDefinition()).toEqual(BUILTIN_VIEWS[2]!.definition);
  });

  it('keeps the meetings alias working through the kind URL param (docs/51 F18)', () => {
    window.history.replaceState(null, '', '/tasks?view=meetings');
    render(<TasksPage />);
    expect(screen.getByRole('heading', { level: 1, name: 'My tasks' })).toBeTruthy();
    expect(lastDefinition().filters.kind).toBe('meeting');
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

  it('drops the Type chip and Label grouping while keeping their URL params (docs/51 F16/F18)', () => {
    window.history.replaceState(null, '', '/tasks?view=my-tasks&kind=meeting');
    render(<TasksPage />);
    expect(screen.queryByRole('button', { name: 'Type filter' })).toBeNull();
    expect(lastDefinition().filters.kind).toBe('meeting');
    fireEvent.click(screen.getByRole('button', { name: 'Display' }));
    const menu = screen.getByRole('menu', { name: 'Display options' });
    const groups = within(menu).getAllByRole('menuitemradio').map((item) => item.textContent);
    expect(groups).toEqual(['Schedule', 'Recently updated', 'Recently created', 'Priority', 'None', 'Schedule', 'Owner', 'Status']);
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

  it('renames a saved view inline — no window.prompt (docs/51 F10)', async () => {
    mockUseTaskViews.mockReturnValue({
      data: { views: [...BUILTIN_VIEWS, { id: 'saved:7', name: 'Escalations', builtin: false, definition: { filters: { status: ['blocked'] } } }] },
      isLoading: false,
    });
    mockUpdateView.mockResolvedValue({});
    render(<TasksPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Rename Escalations' }));
    const input = screen.getByLabelText('Rename Escalations');
    expect(input.tagName).toBe('INPUT');
    fireEvent.change(input, { target: { value: '  Escalation triage  ' } });
    await act(async () => { fireEvent.submit(input.closest('form')!); });
    expect(mockUpdateView).toHaveBeenCalledWith({ id: 7, updates: { name: 'Escalation triage' } });
  });

  it('deleting a saved view offers Undo that recreates it (docs/51 F10)', async () => {
    const definition = { filters: { status: ['blocked'] } };
    mockUseTaskViews.mockReturnValue({
      data: { views: [...BUILTIN_VIEWS, { id: 'saved:7', name: 'Escalations', builtin: false, definition }] },
      isLoading: false,
    });
    mockDeleteView.mockResolvedValue({});
    mockSaveView.mockResolvedValue({ id: 12, name: 'Escalations', definition, position: 0, createdAt: '', updatedAt: '' });
    render(<TasksPage />);
    await act(async () => { fireEvent.click(screen.getByLabelText('Delete Escalations')); });
    expect(mockDeleteView).toHaveBeenCalledWith(7);
    const toast = mockAddToast.mock.calls.at(-1)?.[0];
    expect(toast.title).toBe('Deleted view "Escalations"');
    await act(async () => { toast.action.onClick(); });
    expect(mockSaveView).toHaveBeenCalledWith({ name: 'Escalations', definition });
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

  it('appends a collapsed Done today group; expanding shows closed rows (docs/51 F5)', () => {
    mockDoneToday = [task({ taskKey: 'T-9', title: 'Shipped it', status: 'done', closedAt: `${TODAY}T11:00:00.000Z` })];
    render(<TasksPage />);
    expect(lastDoneTodayDefinition()).toEqual({ filters: { owner: 'me', closed: { from: TODAY, to: TODAY } }, sort: 'updated' });
    // Collapsed: count in the header, rows hidden.
    expect(screen.getByText('Done today')).toBeTruthy();
    expect(screen.queryByText('Shipped it')).toBeNull();
    // And the count doesn't leak into the toolbar count (2 open + 1 closed).
    expect(screen.getByText('2 tasks')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Expand Done today' }));
    expect(screen.getByText('Shipped it')).toBeTruthy();
  });

  it('hides Done today entirely when nothing closed today (docs/51 F5)', () => {
    render(<TasksPage />);
    expect(screen.queryByText('Done today')).toBeNull();
    expect(screen.queryByRole('button', { name: /Done today/ })).toBeNull();
  });

  it('hides Done today while the view is filtered or searched (docs/51 F5)', () => {
    window.history.replaceState(null, '', '/tasks?view=today&status=blocked');
    mockDoneToday = [task({ taskKey: 'T-9', title: 'Shipped it', status: 'done', closedAt: `${TODAY}T11:00:00.000Z` })];
    render(<TasksPage />);
    expect(screen.queryByText('Done today')).toBeNull();
    // The closed query is disabled — it still runs with the same definition but is inert.
    expect(lastDoneTodayDefinition()?.filters?.closed).toBeTruthy();
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

  it('s opens the date-picker schedule menu and m schedules for tomorrow (docs/51 F8)', async () => {
    render(<TasksPage />);
    press('j');
    press('s');
    // The list reuses the drawer's DatePickerPopover: a dialog holding a
    // preset menu plus a real date input.
    const menu = screen.getByRole('dialog', { name: 'Schedule' });
    expect(within(menu).getByLabelText('Pick a date')).toBeTruthy();
    await act(async () => { fireEvent.keyDown(menu, { key: 'm' }); });
    expect(mockApply).toHaveBeenCalledWith(
      [expect.objectContaining({ changes: { scheduledOn: '2026-09-27', later: false } })],
      expect.objectContaining({ label: 'Scheduled for tomorrow · 1 task' }),
    );
    expect(screen.queryByRole('dialog', { name: 'Schedule' })).toBeNull();
  });

  it('digit accelerators in the schedule menu pick the next weekday (docs/51 F8)', async () => {
    render(<TasksPage />);
    press('j');
    press('s');
    const menu = screen.getByRole('dialog', { name: 'Schedule' });
    // TODAY = 2026-09-26 is a Saturday; 1 → next Monday 2026-09-28.
    await act(async () => { fireEvent.keyDown(menu, { key: '1' }); });
    expect(mockApply).toHaveBeenCalledWith(
      [expect.objectContaining({ changes: { scheduledOn: '2026-09-28', later: false } })],
      expect.objectContaining({ label: 'Scheduled for Mon · 1 task' }),
    );
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

  it('resolves the manager\'s linked developer account as Me (docs/51 F3)', () => {
    // A linked manager's accountId IS their developer account id.
    mockUser.mockReturnValue({ accountId: 'dev-1', role: 'manager', developerAccountId: 'dev-1' });
    window.history.replaceState(null, '', '/tasks?view=waiting');
    mockUseTaskViewTasks.mockReturnValue(tasksResult([
      task({ taskKey: 'T-5', title: 'On my dev account', ownerType: 'developer', ownerId: 'dev-1', status: 'blocked' }),
      task({ id: 2, taskKey: 'T-6', title: 'On the team', ownerType: 'developer', ownerId: 'dev-9', status: 'blocked' }),
    ]));
    render(<TasksPage />);
    // Owner grouping files dev-self work under Me, not a second self-named group.
    const groupLabels = [...document.querySelectorAll('section h2')].map((el) => el.textContent);
    expect(groupLabels).toEqual(['Me', 'Developer']);
    // The assign menu and owner filter don't list self twice.
    press('j');
    press('a');
    const menu = screen.getByRole('menu', { name: 'Assign' });
    expect(within(menu).getByRole('menuitem', { name: 'Me' })).toBeTruthy();
    expect(within(menu).queryByRole('menuitem', { name: 'Dev One' })).toBeNull();
    fireEvent.keyDown(menu, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: 'Owner filter' }));
    const ownerMenu = screen.getByRole('menu', { name: 'Owner filter' });
    expect(within(ownerMenu).queryByRole('menuitemcheckbox', { name: 'Dev One' })).toBeNull();
    expect(within(ownerMenu).getByRole('menuitemcheckbox', { name: 'Me' })).toBeTruthy();
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

  it('n opens the standalone add row on an empty view (docs/51 F14)', async () => {
    mockUseTaskViewTasks.mockImplementation(() => tasksResult([]));
    render(<TasksPage />);
    // A real "Add task" row sits under the empty copy — no fake list.
    expect(screen.getByRole('button', { name: 'Add task' })).toBeTruthy();
    press('n');
    const input = await screen.findByLabelText('New task');
    fireEvent.change(input, { target: { value: 'Quick one' } });
    await act(async () => { fireEvent.submit(input.closest('form')!); });
    // The empty Today view's context still lands the task on today.
    expect(mockCreate).toHaveBeenCalledWith({ title: 'Quick one', scheduledOn: TODAY });
  });

  it('n stays dead on an empty view that cannot host adds (docs/51 F14)', () => {
    window.history.replaceState(null, '', '/tasks?view=attention');
    mockUseTaskViewTasks.mockImplementation(() => tasksResult([]));
    render(<TasksPage />);
    expect(screen.queryByRole('button', { name: 'Add task' })).toBeNull();
    press('n');
    expect(screen.queryByLabelText('New task')).toBeNull();
  });

  it('Alt+↓ persists a per-day reorder through the bulk path (docs/51 F7)', async () => {
    mockUseTaskViewTasks.mockImplementation((definition?: { filters?: { closed?: unknown } }) =>
      definition?.filters?.closed
        ? tasksResult([])
        : tasksResult([
            task(),
            task({ id: 2, taskKey: 'T-2', title: 'Second', scheduledOn: TODAY }),
            task({ id: 3, taskKey: 'T-3', title: 'Third', scheduledOn: TODAY }),
          ]),
    );
    render(<TasksPage />);
    press('j');
    await act(async () => { press('ArrowDown', { altKey: true }); });
    const items = mockApply.mock.calls[0]![0] as { task: { taskKey: string }; changes: { schedulePosition: number } }[];
    // The whole Today block is rewritten densely: [T-2, T-1, T-3].
    expect(items.map((item) => [item.task.taskKey, item.changes.schedulePosition])).toEqual([['T-2', 0], ['T-1', 1], ['T-3', 2]]);
    expect(mockApply.mock.calls[0]![1]).toMatchObject({ label: 'Reordered tasks' });
  });

  it('Alt+↑ at the top of a day bucket is a no-op (docs/51 F7)', async () => {
    mockUseTaskViewTasks.mockImplementation((definition?: { filters?: { closed?: unknown } }) =>
      definition?.filters?.closed ? tasksResult([]) : tasksResult([task(), task({ id: 2, taskKey: 'T-2', scheduledOn: TODAY })]),
    );
    render(<TasksPage />);
    press('j');
    await act(async () => { press('ArrowUp', { altKey: true }); });
    expect(mockApply).not.toHaveBeenCalled();
  });

  it('Alt+↑/↓ is inert on views without schedule grouping (docs/51 F7)', async () => {
    window.history.replaceState(null, '', '/tasks?view=inbox');
    mockUseTaskViewTasks.mockImplementation((definition?: { filters?: { closed?: unknown } }) =>
      definition?.filters?.closed ? tasksResult([]) : tasksResult([task(), task({ id: 2, taskKey: 'T-2', scheduledOn: null })]),
    );
    render(<TasksPage />);
    press('j');
    await act(async () => { press('ArrowDown', { altKey: true }); });
    expect(mockApply).not.toHaveBeenCalled();
  });

  it('p opens a priority menu and sets High (docs/51 F9)', async () => {
    render(<TasksPage />);
    press('j');
    press('p');
    const menu = screen.getByRole('menu', { name: 'Set priority' });
    await act(async () => { fireEvent.click(within(menu).getByRole('menuitemradio', { name: 'High' })); });
    expect(mockApply.mock.calls[0]![0][0].changes).toEqual({ priority: 'high' });
    // … menu parity: the same action lives in the More menu.
    fireEvent.click(within(row('T-1')).getByRole('button', { name: 'More actions' }));
    const more = screen.getByRole('menu', { name: 'More actions' });
    fireEvent.click(within(more).getByRole('menuitem', { name: /Priority/ }));
    expect(screen.getByRole('menu', { name: 'Set priority' })).toBeTruthy();
  });

  it('bulk status change clears the selection of removed rows (docs/51 B4)', async () => {
    render(<TasksPage />);
    press('j');
    press('x');
    expect(screen.getByRole('toolbar', { name: 'Bulk actions' })).toBeTruthy();
    await act(async () => { press(' '); });
    await waitFor(() => expect(screen.queryByRole('toolbar', { name: 'Bulk actions' })).toBeNull());
    expect(row('T-2')).toHaveAttribute('aria-selected', 'false');
  });

  it('rescheduling appends a destination hint to the lingering row (docs/51 F13)', async () => {
    const { rerender } = render(<TasksPage />);
    press('j');
    press('s');
    const menu = screen.getByRole('dialog', { name: 'Schedule' });
    await act(async () => { fireEvent.keyDown(menu, { key: 'm' }); });
    // The refetch no longer returns T-2 — it lingers with the destination named.
    mockUseTaskViewTasks.mockImplementation((definition?: { filters?: { closed?: unknown } }) =>
      definition?.filters?.closed ? tasksResult([]) : tasksResult([task()]),
    );
    rerender(<TasksPage />);
    expect(row('T-2').textContent).toContain('moved → Tomorrow');
    expect(row('T-2').getAttribute('aria-label')).toContain('moved → Tomorrow');
    // Only the title/meta dims — the action cluster keeps full opacity.
    const dimmed = row('T-2').querySelector('span[style*="opacity: 0.6"]');
    expect(dimmed).toBeTruthy();
    expect(row('T-2').style.opacity).toBe('');
  });

  it('opens the drawer with the visible list order for j/k stepping (docs/51 F19)', async () => {
    render(<TasksPage />);
    press('j');
    press('Enter');
    expect(mockDrawerProps?.taskKey).toBe('T-2');
    expect(mockDrawerProps?.orderedKeys).toEqual(['T-2', 'T-1']);
    await act(async () => { mockDrawerProps?.onStepTask?.('T-1'); });
    expect(screen.getByTestId('drawer').textContent).toContain('T-1');
    expect(row('T-1')).toHaveAttribute('tabindex', '0');
  });

  it('sections are labelled groups owning clean listboxes (docs/51 A1)', () => {
    render(<TasksPage />);
    for (const section of screen.getAllByRole('group')) {
      const headerId = section.getAttribute('aria-labelledby');
      expect(headerId).toBeTruthy();
      expect(document.getElementById(headerId!)?.tagName).toBe('H2');
    }
    for (const box of screen.getAllByRole('listbox')) {
      // Only presentation wrappers and option rows inside the listbox.
      for (const child of Array.from(box.children)) {
        expect(['presentation', 'option'].includes(child.getAttribute('role') ?? '')).toBe(true);
      }
      expect(box.querySelectorAll('[role="option"]').length).toBeGreaterThan(0);
    }
  });

  it('row aria-labels carry the visible metadata (docs/51 A2)', () => {
    render(<TasksPage />);
    // T-2: overdue 3d, nextAction, owner hidden (manager-owned in a Me view).
    expect(row('T-2').getAttribute('aria-label')).toBe('T-2 Old one, Open, 3d overdue');
  });

  it('popover outside-clicks restore focus to the row (docs/51 A5)', async () => {
    render(<TasksPage />);
    press('j');
    // Let focusRow's rAF land so the popover captures the row as returnFocus.
    await act(() => new Promise((resolve) => requestAnimationFrame(() => resolve(null))));
    press('s');
    expect(screen.getByRole('dialog', { name: 'Schedule' })).toBeTruthy();
    fireEvent.mouseDown(document.body);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Schedule' })).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(row('T-2')));
  });

  it('closing the shortcuts dialog restores focus (docs/51 A5)', async () => {
    render(<TasksPage />);
    press('j');
    await act(() => new Promise((resolve) => requestAnimationFrame(() => resolve(null))));
    press('?');
    const dialog = screen.getByRole('dialog', { name: 'Keyboard shortcuts' });
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Keyboard shortcuts' })).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(row('T-2')));
  });

  it('? opens the shortcut cheat sheet', () => {
    render(<TasksPage />);
    press('?');
    expect(screen.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeTruthy();
  });
});
