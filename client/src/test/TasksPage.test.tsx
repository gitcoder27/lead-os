import type * as Csv from '@/lib/csv';
import { QuickActionsProvider } from '@/context/QuickActionsContext';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { TaskViewMeta, TaskViewTask } from '@/types';

const mockCsvDownload = vi.fn();
vi.mock('@/lib/csv', async (original) => ({ ...await original<typeof Csv>(), downloadCsv: (...args: unknown[]) => mockCsvDownload(...args) }));
const mockUseTaskViews = vi.fn();
const mockUseProject = vi.fn();
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

vi.mock('@/hooks/useGlobalSearch', () => ({
  GLOBAL_SEARCH_MIN_LENGTH: 2,
  useGlobalSearch: (query: string, options?: { enabled?: boolean }) => ({
    data: options?.enabled && query.trim().length >= 2 ? { issues: [{ jiraKey: 'LEAD-42', summary: 'Login fails on Safari' }] } : undefined,
  }),
}));

vi.mock('@/hooks/useProjects', () => ({ useProject: (...args: unknown[]) => mockUseProject(...args), useProjects: () => ({ data: { projects: [] } }), useProjectWrites: () => ({ isPending: false }) }));

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

vi.mock('@/hooks/useContacts', () => ({
  useContacts: () => ({ data: [{ id: 7, displayName: 'Acme Legal', handle: 'acme-legal', note: null, createdAt: '' }] }),
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
  { id: 'meetings', name: 'Meetings', builtin: true, section: 'plan', definition: { filters: { kind: 'meeting', withClosed: { from: '2026-09-13' } }, sort: 'scheduled', group: 'meeting' } },
  { id: 'high-priority', name: 'High priority', builtin: true, section: 'review', definition: { filters: { priority: 'high', status: [...OPENISH] }, sort: 'scheduled' } },
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

const openRow = (key: string) => row(key).querySelector<HTMLButtonElement>('[data-task-open]')!;

function press(key: string, init: KeyboardEventInit = {}) {
  act(() => {
    fireEvent.keyDown(document.activeElement ?? document.body, { key, ...init });
  });
}

beforeEach(async () => {
  // Flush focus frames scheduled by the previous test's rows.
  await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
  vi.clearAllMocks();
  mockUseProject.mockReturnValue({ data: undefined });
  mockUser.mockReturnValue({ accountId: 'manager-a', role: 'manager', developerAccountId: undefined });
  window.history.replaceState(null, '', '/tasks');
  mockApply.mockResolvedValue(true);
  mockCreate.mockResolvedValue({ task: { taskKey: 'T-99' }, warnings: [] });
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
  it('opens High priority from the rail and the mobile picker with a count', () => {
    mockUseTaskViewCounts.mockReturnValue({ data: { today: TODAY, counts: { 'high-priority': { count: 3, overdue: 0 } } } });
    render(<TasksPage />);
    fireEvent.click(screen.getByRole('button', { name: 'High priority, 3 tasks' }));
    expect(screen.getByRole('heading', { level: 1, name: 'High priority' })).toBeVisible();
    expect(lastDefinition()).toEqual(BUILTIN_VIEWS.find((view) => view.id === 'high-priority')!.definition);
    const picker = screen.getByRole('combobox', { name: 'Task view' });
    expect(within(picker).getByRole('option', { name: 'High priority (3)' })).toBeInTheDocument();
    fireEvent.change(picker, { target: { value: 'inbox' } });
    fireEvent.change(picker, { target: { value: 'high-priority' } });
    expect(lastDefinition().filters.priority).toBe('high');
    fireEvent.change(picker, { target: { value: 'inbox' } });
    press('g');
    press('h');
    expect(lastDefinition().filters.priority).toBe('high');
  });

  it('filters priority and saves it with the current view context', async () => {
    window.history.replaceState(null, '', '/tasks?view=my-tasks');
    mockSaveView.mockResolvedValue({ id: 11, name: 'My high priority', definition: {}, position: 0, createdAt: '', updatedAt: '' });
    render(<TasksPage />);
    fireEvent.click(screen.getByRole('button', { name: 'View options' }));
    expect(screen.getByRole('menuitemradio', { name: 'All priorities' })).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'High priority' }));
    expect(lastDefinition().filters).toMatchObject({ priority: 'high', owner: 'me', later: false });
    expect(screen.getByRole('button', { name: 'View options (1)' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Save current view' }));
    fireEvent.change(screen.getByLabelText('Saved view name'), { target: { value: 'My high priority' } });
    await act(async () => { fireEvent.click(within(screen.getByRole('dialog', { name: 'Save view' })).getByRole('button', { name: 'Save view' })); });
    expect(mockSaveView).toHaveBeenCalledWith({ name: 'My high priority', definition: { ...BUILTIN_VIEWS[2]!.definition, filters: { ...BUILTIN_VIEWS[2]!.definition.filters, priority: 'high' } } });
  });

  it.each(['high-priority', 'saved:7'])('reflects, overrides and restores the inherited priority in %s', (viewId) => {
    window.history.replaceState(null, '', `/tasks?view=${viewId}`);
    mockUseTaskViews.mockReturnValue({ data: { views: [...BUILTIN_VIEWS, { id: 'saved:7', name: 'Saved high', builtin: false, definition: { filters: { priority: 'high', owner: 'me' } } }] }, isLoading: false });
    render(<TasksPage />);
    fireEvent.click(screen.getByRole('button', { name: 'View options' }));
    expect(screen.getByRole('menuitemradio', { name: 'High priority' })).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'All priorities' }));
    expect(lastDefinition().filters.priority).toBeUndefined();
    expect(screen.getByRole('menuitemradio', { name: 'All priorities' })).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Normal priority' }));
    expect(lastDefinition().filters.priority).toBe('normal');
    fireEvent.click(screen.getByRole('menuitem', { name: viewId === 'saved:7' ? 'Revert' : 'Reset' }));
    expect(lastDefinition().filters.priority).toBe('high');
    expect(screen.getByRole('button', { name: 'View options' })).toBeInTheDocument();
  });

  it('explains an empty High priority view and adds with high priority defaults', async () => {
    window.history.replaceState(null, '', '/tasks?view=high-priority');
    mockUseTaskViewTasks.mockReturnValue(tasksResult([]));
    render(<TasksPage />);
    expect(screen.getByText('No open high-priority tasks')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Add task' }));
    const input = screen.getByLabelText('New task');
    fireEvent.change(input, { target: { value: 'Critical release follow-through' } });
    await act(async () => { fireEvent.submit(input.closest('form')!); });
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ text: 'Critical release follow-through', defaults: { priority: 'high' } }));
  });

  it.each(['today', 'inbox'].flatMap((viewId) =>
    ['button', 'outside', 'escape'].map((dismiss) => ({ viewId, dismiss })),
  ))('reopens View options after $dismiss dismissal in $viewId', async ({ viewId, dismiss }) => {
    window.history.replaceState(null, '', `/tasks?view=${viewId}`);
    render(<TasksPage />);
    const options = screen.getByRole('button', { name: 'View options' });
    options.focus();

    for (let cycle = 0; cycle < 3; cycle++) {
      fireEvent.mouseDown(options);
      fireEvent.click(options);
      const menu = screen.getByRole('menu', { name: 'View options' });
      expect(within(menu).getByRole('menuitemcheckbox', { name: 'You' })).toBeVisible();
      expect(within(menu).getByRole('menuitemcheckbox', { name: 'Open' })).toBeVisible();

      if (dismiss === 'button') {
        fireEvent.mouseDown(options);
        fireEvent.click(options);
      } else if (dismiss === 'outside') {
        fireEvent.mouseDown(document.body);
        fireEvent.click(document.body);
      } else {
        fireEvent.keyDown(menu, { key: 'Escape' });
      }
      expect(screen.queryByRole('menu', { name: 'View options' })).not.toBeInTheDocument();
      // Allow any focus restoration to settle before the next interaction.
      await act(() => new Promise((resolve) => requestAnimationFrame(() => resolve(null))));
    }
  });

  it('exports the searched current rows, excluding private agenda and other rows', () => {
    mockUseTaskViewTasks.mockReturnValue(tasksResult([task({ title: 'Match ordinary', details: 'PRIVATE BODY' }), task({ id: 2, taskKey: 'T-2', title: 'Other title' }), task({ id: 3, taskKey: 'T-3', title: 'Match private agenda', oneOnOne: true })]));
    render(<TasksPage />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Search tasks' }), { target: { value: 'Match' } });
    fireEvent.click(screen.getByRole('button', { name: 'View options' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Export CSV' }));
    expect(mockCsvDownload).toHaveBeenCalledTimes(1);
    expect(mockCsvDownload.mock.calls[0]?.[0]).toContain('Match ordinary');
    expect(mockCsvDownload.mock.calls[0]?.[0]).not.toMatch(/Other title|Match private agenda|PRIVATE BODY/);
    expect(mockCsvDownload.mock.calls[0]?.[1]).toBe('leados-tasks-today-2026-09-26.csv');
  });

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
    expect(document.querySelector('[data-task-row][data-focused="true"]')).not.toBeNull();
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

  it('opens the built-in Meetings view, and keeps the kind URL param working (docs/51 F18, docs/57 P3-06)', () => {
    window.history.replaceState(null, '', '/tasks?view=meetings');
    const { unmount } = render(<TasksPage />);
    expect(screen.getByRole('heading', { level: 1, name: 'Meetings' })).toBeTruthy();
    expect(lastDefinition()).toEqual(BUILTIN_VIEWS.find((view) => view.id === 'meetings')!.definition);
    unmount();

    window.history.replaceState(null, '', '/tasks?view=my-tasks&kind=meeting');
    render(<TasksPage />);
    expect(lastDefinition().filters.kind).toBe('meeting');
  });

  it('applies URL overrides and clears them inside consolidated options', () => {
    window.history.replaceState(null, '', '/tasks?view=my-tasks&owner=dev-1&group=owner&signal=drift');
    render(<TasksPage />);
    const definition = lastDefinition();
    expect(definition.filters.owner).toEqual(['dev-1']);
    expect(definition.group).toBe('owner');
    fireEvent.click(screen.getByRole('button', { name: 'View options (3)' }));
    fireEvent.click(within(screen.getByRole('menu', { name: 'View options' })).getByRole('menuitemcheckbox', { name: 'Dev One' }));
    expect(lastDefinition().filters.owner).toBe('me');
  });

  it('uses three stable toolbar targets, counts override categories and preserves hidden URL options', () => {
    window.history.replaceState(null, '', '/tasks?view=my-tasks&status=open,blocked&owner=me&kind=meeting');
    render(<TasksPage />);
    expect(screen.getByRole('button', { name: 'View options (3)' })).toBeInTheDocument();
    expect(screen.getByText(/Applied options:/)).toHaveTextContent('status: open, blocked');
    for (const name of ['Owner filter', 'Status filter', 'Label filter', 'Display', 'Filter', 'Save current view', 'Reset']) expect(screen.queryByRole('button', { name })).toBeNull();
    expect(screen.getByRole('button', { name: 'Keyboard shortcuts' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Search tasks' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Task view' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'View options (3)' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Reset' }));
    expect(lastDefinition()).toEqual(BUILTIN_VIEWS[2]!.definition);
  });

  it('save dialog retains its name after failure, retries, omits search and returns focus to options', async () => {
    mockSaveView.mockRejectedValueOnce(new Error('Unavailable')).mockResolvedValueOnce({ id: 11, name: 'Mine', definition: {}, position: 0, createdAt: '', updatedAt: '' });
    render(<TasksPage />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Search tasks' }), { target: { value: 'transient' } });
    const options = screen.getByRole('button', { name: 'View options' });
    fireEvent.click(options); fireEvent.click(screen.getByRole('menuitem', { name: 'Save current view' }));
    const dialog = screen.getByRole('dialog', { name: 'Save view' });
    expect(within(dialog).getByRole('button', { name: 'Save view' })).toBeDisabled();
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Saved view name' }), { target: { value: 'Mine' } });
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Save view' })); });
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Could not save view');
    expect(within(dialog).getByRole('textbox')).toHaveValue('Mine');
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Save view' })); });
    expect(mockSaveView).toHaveBeenLastCalledWith({ name: 'Mine', definition: BUILTIN_VIEWS[0]!.definition });
    expect(screen.queryByRole('dialog', { name: 'Save view' })).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(options));
  });

  it('Escape cancels a save without writing and returns to options', async () => {
    render(<TasksPage />);
    const options = screen.getByRole('button', { name: 'View options' });
    fireEvent.click(options); fireEvent.click(screen.getByRole('menuitem', { name: 'Save current view' }));
    fireEvent.keyDown(screen.getByRole('dialog', { name: 'Save view' }), { key: 'Escape' });
    expect(mockSaveView).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog', { name: 'Save view' })).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(options));
  });

  it('label filter shows system labels prefix-free and toggles canonical names (D8)', () => {
    render(<TasksPage />);
    fireEvent.click(screen.getByRole('button', { name: 'View options' }));
    const menu = screen.getByRole('menu', { name: 'View options' });
    fireEvent.click(within(menu).getByRole('menuitemcheckbox', { name: 'follow up' }));
    expect(lastDefinition().filters.labels).toEqual(['category:follow_up']);
  });

  it('drops the Type chip and Label grouping while keeping their URL params (docs/51 F16/F18)', () => {
    window.history.replaceState(null, '', '/tasks?view=my-tasks&kind=meeting');
    render(<TasksPage />);
    expect(screen.queryByRole('button', { name: 'Type filter' })).toBeNull();
    expect(lastDefinition().filters.kind).toBe('meeting');
    fireEvent.click(screen.getByRole('button', { name: /View options/ }));
    const menu = screen.getByRole('menu', { name: 'View options' });
    const groups = within(menu).getAllByRole('menuitemradio').map((item) => item.textContent);
    expect(groups).toEqual(['All priorities', 'High priority', 'Normal priority', 'Schedule', 'Recently updated', 'Recently created', 'Priority', 'Check-by date', 'None', 'Schedule', 'Owner', 'Status', 'Waiting on']);
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

    fireEvent.click(screen.getByRole('button', { name: 'View options' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Save current view' }));
    fireEvent.change(screen.getByLabelText('Saved view name'), { target: { value: 'Mine' } });
    await act(async () => { fireEvent.click(within(screen.getByRole('dialog', { name: 'Save view' })).getByRole('button', { name: 'Save view' })); });
    expect(mockSaveView).toHaveBeenCalledWith({ name: 'Mine', definition: BUILTIN_VIEWS[0]!.definition });

    fireEvent.click(within(screen.getByRole('navigation')).getByRole('button', { name: 'Escalations' }));
    fireEvent.click(screen.getByRole('button', { name: 'View options' }));
    fireEvent.click(within(screen.getByRole('menu', { name: 'View options' })).getByRole('menuitemcheckbox', { name: 'Open' }));
    expect(screen.getByLabelText('Unsaved filter changes')).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByRole('menuitem', { name: 'Update view' })); });
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
  it('uses neutral Waiting empty copy without claiming all obligations are clear', () => {
    window.history.replaceState(null, '', '/tasks?view=waiting');
    mockUseTaskViewTasks.mockReturnValue(tasksResult([]));
    render(<TasksPage />);
    expect(screen.getByText('No tasks in Waiting.')).toBeInTheDocument();
    expect(screen.queryByText(/Nobody owes|Capture a promise with/)).not.toBeInTheDocument();
  });

  it('keeps filtered Waiting emptiness distinct', () => {
    window.history.replaceState(null, '', '/tasks?view=waiting&status=dropped');
    mockUseTaskViewTasks.mockReturnValue(tasksResult([]));
    render(<TasksPage />);
    expect(screen.getByText('No tasks match these filters.')).toBeInTheDocument();
    expect(screen.queryByText('No tasks in Waiting.')).not.toBeInTheDocument();
  });

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
    expect(row('T-2')).toHaveAttribute('data-focused', 'true');
    press('j');
    expect(row('T-1')).toHaveAttribute('data-focused', 'true');
    press('k');
    expect(row('T-2')).toHaveAttribute('data-focused', 'true');
    press('Enter');
    expect(screen.getByTestId('drawer').textContent).toContain('T-2');
    // Shortcuts are suspended while the drawer is open.
    press('j');
    expect(row('T-2')).toHaveAttribute('data-focused', 'true');
    fireEvent.click(screen.getByText('close drawer'));
    expect(screen.queryByTestId('drawer')).toBeNull();
  });

  it('ignores shortcuts typed into inputs and with modifier keys', () => {
    render(<TasksPage />);
    const search = screen.getByLabelText('Search tasks');
    search.focus();
    fireEvent.keyDown(search, { key: 'j' });
    expect(row('T-2')).not.toHaveAttribute('data-focused');
    fireEvent.keyDown(document.body, { key: 'k', metaKey: true });
    expect(row('T-2')).not.toHaveAttribute('data-focused');
    press('/');
  });

  it('e marks the focused task done and the row lingers until focus moves (R1/R2)', async () => {
    const { rerender } = render(<TasksPage />);
    press('j');
    await act(async () => { press('e'); });
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
    expect(row('T-1')).toContainElement(within(row('T-1')).getByRole('checkbox', { checked: true }));
    await act(async () => { press('#'); });
    expect(mockApply.mock.calls[0]![0]).toHaveLength(2);
    expect(mockApply.mock.calls[0]![0][0].changes).toEqual({ status: 'dropped' });
    press('Escape');
    expect(within(row('T-1')).getByRole('checkbox')).not.toBeChecked();
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

  it('More retains the five-status menu', async () => {
    render(<TasksPage />);
    fireEvent.click(within(row('T-1')).getByRole('button', { name: 'More actions for T-1' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Status…' }));
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

  it('resolves the manager\'s linked developer account as You (docs/51 F3, UX-09)', () => {
    // A linked manager's accountId IS their developer account id.
    mockUser.mockReturnValue({ accountId: 'dev-1', role: 'manager', developerAccountId: 'dev-1' });
    window.history.replaceState(null, '', '/tasks?view=waiting');
    mockUseTaskViewTasks.mockReturnValue(tasksResult([
      task({ taskKey: 'T-5', title: 'On my dev account', ownerType: 'developer', ownerId: 'dev-1', status: 'blocked' }),
      task({ id: 2, taskKey: 'T-6', title: 'On the team', ownerType: 'developer', ownerId: 'dev-9', status: 'blocked' }),
    ]));
    render(<TasksPage />);
    // Owner grouping files dev-self work under You, not a second self-named group.
    const groupLabels = [...document.querySelectorAll('section h2')].map((el) => el.textContent);
    expect(groupLabels).toEqual(['You', 'Unknown owner']);
    // The assign menu and owner filter don't list self twice.
    press('j');
    press('a');
    const menu = screen.getByRole('menu', { name: 'Assign' });
    expect(within(menu).getByRole('menuitem', { name: 'You' })).toBeTruthy();
    expect(within(menu).queryByRole('menuitem', { name: 'Dev One' })).toBeNull();
    fireEvent.keyDown(menu, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: 'View options' }));
    const ownerMenu = screen.getByRole('menu', { name: 'View options' });
    expect(within(ownerMenu).queryByRole('menuitemcheckbox', { name: 'Dev One' })).toBeNull();
    expect(within(ownerMenu).getByRole('menuitemcheckbox', { name: 'You' })).toBeTruthy();
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
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ text: 'Prep 1:1', defaults: { scheduledOn: TODAY } }));
  });

  it('inline add sends the title as capture text, so tokens in it work (P3-05)', async () => {
    render(<TasksPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Add task to Today' }));
    const input = screen.getByLabelText('New task in Today');
    fireEvent.change(input, { target: { value: 'Draft memo @dev-1 !fri !due:mon' } });
    await act(async () => { fireEvent.submit(input.closest('form')!); });
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ text: 'Draft memo @dev-1 !fri !due:mon', defaults: { scheduledOn: TODAY } }));
  });

  it('inline add keeps the row open with an error toast when the capture is rejected', async () => {
    const { CaptureRejectedError } = await import('@/hooks/useCapture');
    mockCreate.mockRejectedValueOnce(new CaptureRejectedError([
      { severity: 'error', code: 'unknown-person', message: 'Nobody matches @nobody' },
    ]));
    render(<TasksPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Add task to Today' }));
    const input = screen.getByLabelText('New task in Today') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Ask @nobody' } });
    await act(async () => { fireEvent.submit(input.closest('form')!); });
    expect(mockAddToast).toHaveBeenCalledWith(expect.objectContaining({ type: 'error', title: 'Could not add task', message: 'Nobody matches @nobody' }));
    // The text stays so it can be fixed.
    expect((screen.getByLabelText('New task in Today') as HTMLInputElement).value).toBe('Ask @nobody');
  });

  it('inline add toasts warnings from a successful capture', async () => {
    mockCreate.mockResolvedValueOnce({ task: { taskKey: 'T-100' }, warnings: [{ severity: 'warning', code: 'jira-not-synced', message: 'LEAD-9 isn\u2019t synced \u2014 kept as text' }] });
    render(<TasksPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Add task to Today' }));
    const input = screen.getByLabelText('New task in Today');
    fireEvent.change(input, { target: { value: 'Look at #LEAD-9' } });
    await act(async () => { fireEvent.submit(input.closest('form')!); });
    expect(mockAddToast).toHaveBeenCalledWith(expect.objectContaining({ type: 'warning', title: 'Added with warnings' }));
  });

  it('inline add suggests people, issues and labels as you type (P3-05)', async () => {
    render(<TasksPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Add task to Today' }));
    const input = screen.getByLabelText('New task in Today') as HTMLInputElement;

    fireEvent.change(input, { target: { value: 'Pair with @ac', selectionStart: 13 } });
    expect(screen.getByRole('listbox', { name: 'Person suggestions' })).toBeTruthy();
    // Enter accepts the suggestion instead of adding the task.
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(input.value).toBe('Pair with @acme-legal ');
    expect(mockCreate).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: 'Look at #LEA' } });
    expect(screen.getByRole('listbox', { name: 'Issue suggestions' })).toBeTruthy();
    fireEvent.keyDown(input, { key: 'Tab' });
    expect(input.value).toBe('Look at #LEAD-42 ');

    fireEvent.change(input, { target: { value: 'Tag it +esc' } });
    expect(screen.getByRole('listbox', { name: 'Label suggestions' })).toBeTruthy();
    // Escape closes the suggestions first, and only then the row.
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('listbox', { name: 'Label suggestions' })).toBeNull();
    expect(screen.getByLabelText('New task in Today')).toBeTruthy();
  });

  describe('Meetings view (docs/57 P3-06)', () => {
    const meeting = (overrides: Partial<TaskViewTask>) => task({ kind: 'meeting', scheduledOn: null, ...overrides });
    const openMeetings = (rows: TaskViewTask[]) => {
      window.history.replaceState(null, '', '/tasks?view=meetings');
      mockUseTaskViewTasks.mockImplementation((definition?: { filters?: { closed?: unknown } }) => definition?.filters?.closed ? tasksResult([]) : tasksResult(rows));
    };

    it('groups Today / Upcoming / Needs outcome / Recent, and never lanes a past meeting as Upcoming', () => {
      openMeetings([
        meeting({ id: 10, taskKey: 'T-10', title: 'Standup sync', scheduledOn: TODAY }),
        meeting({ id: 11, taskKey: 'T-11', title: 'Roadmap review', scheduledOn: '2026-09-30' }),
        meeting({ id: 12, taskKey: 'T-12', title: 'Last week retro', scheduledOn: '2026-09-21' }),
        meeting({ id: 13, taskKey: 'T-13', title: 'Vendor call', scheduledOn: '2026-09-22', status: 'done', closedAt: '2026-09-22T10:00:00Z' }),
        meeting({ id: 14, taskKey: 'T-14', title: 'Board prep', scheduledOn: '2026-09-23', outcome: 'Agreed on scope' }),
      ]);
      render(<TasksPage />);

      const headings = screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent);
      expect(headings).toEqual(['Today', 'Upcoming', 'Needs outcome', 'Recent']);
      const inGroup = (label: string) => Array.from(screen.getByRole('list', { name: label }).querySelectorAll('[data-task-row]')).map((item) => item.getAttribute('data-task-row'));
      expect(inGroup('Today')).toEqual(['T-10']);
      expect(inGroup('Upcoming')).toEqual(['T-11']);
      expect(inGroup('Needs outcome')).toEqual(['T-12']);
      expect(inGroup('Recent')).toEqual(['T-13', 'T-14']);
    });

    it('shows how many action items are done, and says so to screen readers', () => {
      openMeetings([
        meeting({ id: 10, taskKey: 'T-10', title: 'Design review', scheduledOn: TODAY, signals: { ...NO_SIGNALS, actions: { done: 2, total: 3 } } }),
        meeting({ id: 11, taskKey: 'T-11', title: 'No actions yet', scheduledOn: TODAY, signals: { ...NO_SIGNALS, actions: { done: 0, total: 0 } } }),
      ]);
      render(<TasksPage />);

      expect(within(row('T-10')).getByTestId('meeting-actions')).toHaveTextContent('2/3 actions');
      expect(openRow('T-10').getAttribute('aria-label')).toContain('2/3 actions');
      expect(within(row('T-11')).queryByTestId('meeting-actions')).toBeNull();
    });

    it('a past meeting reads Needs outcome, not overdue, and Capture outcome saves it (UX-08)', async () => {
      window.history.replaceState(null, '', '/tasks?view=today');
      mockUseTaskViewTasks.mockImplementation((definition?: { filters?: { closed?: unknown } }) => definition?.filters?.closed ? tasksResult([]) : tasksResult([
        meeting({ id: 12, taskKey: 'T-12', title: 'Architecture sync', scheduledOn: '2026-09-21' }),
      ]));
      render(<TasksPage />);

      expect(within(row('T-12')).queryByText(/overdue/)).toBeNull();
      expect(within(row('T-12')).getByText('Needs outcome')).toBeTruthy();
      fireEvent.click(within(row('T-12')).getByRole('button', { name: 'Capture outcome for T-12' }));
      const dialog = screen.getByRole('dialog', { name: /capture outcome/i });
      fireEvent.change(within(dialog).getByLabelText('Meeting outcome'), { target: { value: 'Go with Redis' } });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Save outcome' }));
      await waitFor(() => expect(mockApply).toHaveBeenCalled());
      expect(mockApply.mock.calls[0]![0][0].changes).toEqual({ outcome: 'Go with Redis', status: 'done' });
    });

    it('a plain task never shows an action tally', () => {
      window.history.replaceState(null, '', '/tasks?view=my-tasks');
      render(<TasksPage />);
      expect(screen.queryByTestId('meeting-actions')).toBeNull();
    });

    it('g then e jumps to Meetings', () => {
      render(<TasksPage />);
      press('g');
      press('e');
      expect(screen.getByRole('heading', { level: 1, name: 'Meetings' })).toBeTruthy();
    });

    it('adds under a group with the meeting kind and that group\'s day', async () => {
      openMeetings([meeting({ id: 11, taskKey: 'T-11', title: 'Roadmap review', scheduledOn: '2026-09-30' })]);
      render(<TasksPage />);
      fireEvent.click(screen.getByRole('button', { name: 'Add task to Upcoming' }));
      const input = screen.getByLabelText('New task in Upcoming');
      fireEvent.change(input, { target: { value: 'Planning sync' } });
      await act(async () => { fireEvent.submit(input.closest('form')!); });
      expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ text: 'Planning sync', defaults: { kind: 'meeting', scheduledOn: '2026-09-27' } }));
    });

    it('an empty Meetings view says how to capture one', () => {
      openMeetings([]);
      render(<TasksPage />);
      expect(screen.getByText(/No meetings/)).toBeTruthy();
    });
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
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ text: 'Quick one', defaults: { scheduledOn: TODAY } }));
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
    fireEvent.click(within(row('T-1')).getByRole('button', { name: /More actions for/  }));
    const more = screen.getByRole('menu', { name: 'More actions' });
    fireEvent.click(within(more).getByRole('menuitem', { name: /Priority/ }));
    expect(screen.getByRole('menu', { name: 'Set priority' })).toBeTruthy();
  });

  it('w sets who a task waits on — developer, contact, or free text (docs/57 P3-03)', async () => {
    render(<TasksPage />);
    press('j');
    press('w');
    let menu = screen.getByRole('menu', { name: 'Waiting on' });
    await act(async () => { fireEvent.click(within(menu).getByRole('menuitem', { name: /Acme Legal/ })); });
    expect(mockApply.mock.calls.at(-1)![0][0].changes).toEqual({ waitingOn: { type: 'contact', ref: '7', label: 'Acme Legal' } });
    press('w');
    menu = screen.getByRole('menu', { name: 'Waiting on' });
    fireEvent.change(within(menu).getByRole('textbox', { name: 'Waiting on' }), { target: { value: 'Finance' } });
    await act(async () => { fireEvent.click(within(menu).getByRole('menuitem', { name: /Finance/ })); });
    expect(mockApply.mock.calls.at(-1)![0][0].changes).toEqual({ waitingOn: { type: 'text', label: 'Finance' } });
  });

  it('c sets a check-by date as a local 9am followUpAt (docs/57 P3-03)', async () => {
    render(<TasksPage />);
    press('j');
    press('c');
    await act(async () => { press('m'); });
    expect(mockApply.mock.calls.at(-1)![0][0].changes).toEqual({ followUpAt: new Date('2026-09-27T09:00:00').toISOString() });
  });

  it('the Waiting view groups by the party waited on and shows aging and check chips (docs/57 §4)', () => {
    window.history.replaceState(null, '', '/tasks?view=waiting');
    mockUseTaskViews.mockReturnValue({
      data: { views: BUILTIN_VIEWS.map((view) => (view.id === 'waiting' ? { ...view, name: 'Waiting', definition: { ...view.definition, sort: 'checkBy', group: 'party' } } : view)) },
      isLoading: false, isError: false,
    });
    mockUseTaskViewTasks.mockImplementation((definition?: { filters?: { closed?: unknown } }) => (definition?.filters?.closed ? tasksResult([]) : tasksResult([
      task({ id: 1, taskKey: 'T-1', title: 'NDA', scheduledOn: null, followUpAt: '2026-09-25T09:00:00Z', waitingOn: { type: 'contact', ref: '7', label: 'Acme Legal', since: '2026-09-20T10:00:00Z' }, signals: { ...NO_SIGNALS, waitingDays: 6 } }),
      task({ id: 2, taskKey: 'T-2', title: 'Rollout', ownerType: 'developer', ownerId: 'dev-1', scheduledOn: null, signals: { ...NO_SIGNALS, stale: true, staleDays: 9, waitingDays: 9 } }),
      task({ id: 3, taskKey: 'T-3', title: 'Stuck', status: 'blocked', scheduledOn: null, signals: { ...NO_SIGNALS, waitingDays: 1 } }),
    ])));
    render(<TasksPage />);
    const headings = screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent);
    expect(headings).toEqual(expect.arrayContaining(['Acme Legal', 'Dev One', 'Blocked']));
    expect(headings.indexOf('Blocked')).toBeGreaterThan(headings.indexOf('Acme Legal'));
    expect(within(row('T-1')).getByTestId('waiting-check').textContent).toBe('Check 1d late');
    expect(within(row('T-1')).getByTestId('waiting-aging').textContent).toBe('Waiting 6d');
    expect(within(row('T-2')).getByTestId('waiting-aging').textContent).toBe('Waiting 9d');
  });

  it('bulk status change clears the selection of removed rows (docs/51 B4)', async () => {
    render(<TasksPage />);
    press('j');
    press('x');
    expect(screen.getByRole('toolbar', { name: 'Bulk actions' })).toBeTruthy();
    await act(async () => { press('e'); });
    await waitFor(() => expect(screen.queryByRole('toolbar', { name: 'Bulk actions' })).toBeNull());
    expect(within(row('T-2')).getByRole('checkbox')).not.toBeChecked();
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
    expect(openRow('T-2').getAttribute('aria-label')).toContain('moved → Tomorrow');
    // Only the title/meta dims — the action cluster keeps full opacity.
    const dimmed = row('T-2').querySelector('.task-row-content[style*="opacity: 0.6"]');
    expect(dimmed).toBeTruthy();
    expect(row('T-2').style.opacity).toBe('');
  });

  it('a failed action releases its lingering row and selection, and leaves the rest alone (docs/61 TS-01)', async () => {
    let fail!: (ok: boolean) => void;
    mockApply.mockReturnValueOnce(new Promise<boolean>((resolve) => { fail = resolve; }));
    const { rerender } = render(<TasksPage />);
    press('j');
    press('x');
    await act(async () => { press('#'); });
    // The optimistic view no longer returns T-2: it lingers with what the action did.
    mockUseTaskViewTasks.mockImplementation((definition?: { filters?: { closed?: unknown } }) =>
      definition?.filters?.closed ? tasksResult([]) : tasksResult([task()]),
    );
    rerender(<TasksPage />);
    expect(row('T-2')).toBeTruthy();

    await act(async () => { fail(false); });
    await waitFor(() => expect(row('T-2')).toBeNull());
    expect(row('T-1')).toBeTruthy();
    expect(screen.queryByRole('toolbar', { name: 'Bulk actions' })).toBeNull();
  });

  it('opens the drawer with the visible list order for j/k stepping (docs/51 F19)', async () => {
    render(<TasksPage />);
    press('j');
    press('Enter');
    expect(mockDrawerProps?.taskKey).toBe('T-2');
    expect(mockDrawerProps?.orderedKeys).toEqual(['T-2', 'T-1']);
    await act(async () => { mockDrawerProps?.onStepTask?.('T-1'); });
    expect(screen.getByTestId('drawer').textContent).toContain('T-1');
    expect(row('T-1')).toHaveAttribute('data-focused', 'true');
  });

  it('sections are labelled groups owning native lists (docs/51 A1)', () => {
    render(<TasksPage />);
    for (const section of screen.getAllByRole('group')) {
      const headerId = section.getAttribute('aria-labelledby');
      expect(headerId).toBeTruthy();
      expect(document.getElementById(headerId!)?.tagName).toBe('H2');
    }
    for (const box of screen.getAllByRole('list').filter((list) => list.querySelector('[data-task-row]'))) {
      expect(box.tagName).toBe('UL');
      for (const child of Array.from(box.children)) expect(child.tagName).toBe('LI');
      expect(box.querySelector('[role="option"]')).toBeNull();
    }
  });

  it('row aria-labels carry the visible metadata (docs/51 A2)', () => {
    render(<TasksPage />);
    // T-2: overdue 3d, nextAction, owner hidden (manager-owned in a Me view).
    expect(openRow('T-2').getAttribute('aria-label')).toBe('T-2 Old one, Open, 3d overdue');
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
    await waitFor(() => expect(document.activeElement).toBe(openRow('T-2')));
  });

  it('closing the shortcuts dialog restores focus (docs/51 A5)', async () => {
    render(<TasksPage />);
    press('j');
    await act(() => new Promise((resolve) => requestAnimationFrame(() => resolve(null))));
    press('?');
    const dialog = screen.getByRole('dialog', { name: 'Keyboard shortcuts' });
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Keyboard shortcuts' })).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(openRow('T-2')));
  });

  it('? opens the shortcut cheat sheet', () => {
    render(<TasksPage />);
    press('?');
    expect(screen.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeTruthy();
  });
});

describe('TasksPage design layer (docs/51 D1–D5, U2–U6)', () => {
  it('keeps high priority visible and announced alongside Needs attention reasons', () => {
    window.history.replaceState(null, '', '/tasks?view=attention');
    mockUseTaskViewTasks.mockReturnValue(tasksResult([task({ priority: 'high', signals: { ...NO_SIGNALS, stale: true, staleDays: 9, drift: true } })]));
    render(<TasksPage />);
    expect(within(row('T-1')).getByRole('img', { name: 'High priority' })).toBeVisible();
    expect(within(row('T-1')).getByText('Stale 9d')).toBeVisible();
    expect(within(row('T-1')).getByText('Jira drift')).toBeVisible();
    expect(openRow('T-1')).toHaveAccessibleName(expect.stringContaining('High priority'));
  });

  const styleOf = (element: Element | null) => element?.getAttribute('style') ?? '';

  it('rail badge, Overdue label and row agree: a slipped plan date is amber, not red (D1)', () => {
    render(<TasksPage />);
    const rail = within(screen.getByRole('navigation', { name: 'Task views' }));
    const badge = within(rail.getByRole('button', { name: 'Planned today, 2 tasks' })).getByText('2');
    expect(styleOf(badge)).toContain('var(--task-warning-text)');
    expect(styleOf(screen.getByRole('heading', { name: 'Overdue' }))).toContain('var(--task-warning-text)');
    expect(styleOf(screen.getByText('3d overdue'))).toContain('var(--task-warning-text)');
    expect(styleOf(screen.getByText('3d overdue'))).not.toContain('var(--task-danger-text)');
  });

  it('a missed deadline turns the badge, label and row red together (D1)', () => {
    mockUseTaskViewCounts.mockReturnValue({ data: { today: TODAY, counts: { today: { count: 2, overdue: 1, missed: 1 } } } });
    const missed = tasksResult([
      task(),
      task({ id: 2, taskKey: 'T-2', title: 'Board deck', scheduledOn: null, dueAt: '2026-09-24', signals: { ...NO_SIGNALS, overdue: true, overdueDays: 2, overdueSource: 'due' } }),
    ]);
    mockUseTaskViewTasks.mockImplementation((definition?: { filters?: { closed?: unknown } }) =>
      definition?.filters?.closed ? tasksResult([]) : missed,
    );
    render(<TasksPage />);
    const rail = within(screen.getByRole('navigation', { name: 'Task views' }));
    expect(styleOf(within(rail.getByRole('button', { name: 'Planned today, 2 tasks' })).getByText('2'))).toContain('var(--task-danger-text)');
    expect(styleOf(screen.getByRole('heading', { name: 'Overdue' }))).toContain('var(--task-danger-text)');
    expect(styleOf(screen.getByText('2d overdue'))).toContain('var(--task-danger-text)');
  });

  it('a follow-up shows the bell only — no duplicate label chip (D4)', () => {
    mockUseTaskViewTasks.mockReturnValue(tasksResult([task({ labels: ['category:follow_up'] })]));
    render(<TasksPage />);
    expect(within(row('T-1')).getByRole('img', { name: 'Follow-up' })).toBeTruthy();
    expect(within(row('T-1')).queryByText('follow up')).toBeNull();
  });

  it('the toolbar states a count only when it differs from the rail (D2)', () => {
    render(<TasksPage />);
    // Unfiltered: present for narrow screens only (the rail carries it at md+).
    expect(screen.getByText('2 tasks').className).toContain('md:hidden');
    fireEvent.change(screen.getByLabelText('Search tasks'), { target: { value: 'priya' } });
    expect(screen.getByText('1 matching').className).not.toContain('md:hidden');
  });

  it('keeps the date and all controls visible without hover', () => {
    render(<TasksPage />);
    press('j');
    expect(within(row('T-2')).getByText('3d overdue')).toBeTruthy();
    const more = within(row('T-2')).getByRole('button', { name: 'More actions for T-2' });
    expect(more).not.toHaveAttribute('tabindex', '-1');
    expect(more.className).not.toMatch(/opacity-0|group-hover/);
    expect(within(row('T-2')).getByRole('checkbox', { name: 'Select T-2' })).toBeVisible();
    expect(within(row('T-2')).getByText('T-2')).toBeVisible();
  });

  it('keeps keyboard help without a hint strip or storage reads', () => {
    const read = vi.spyOn(Storage.prototype, 'getItem');
    render(<TasksPage />);
    expect(screen.queryByRole('note', { name: 'Keyboard shortcuts hint' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Keyboard shortcuts' }));
    expect(screen.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeInTheDocument();
    expect(read.mock.calls.some(([key]) => key === 'leados.tasks.keyHintDismissed')).toBe(false);
    read.mockRestore();
  });

  it('skeleton draws section labels for grouped views (U5)', () => {
    mockUseTaskViewTasks.mockReturnValue({ data: undefined, isLoading: true, isError: false, isFetching: true, isPlaceholderData: false, error: null, refetch: vi.fn() });
    render(<TasksPage />);
    const skeleton = screen.getByLabelText('Loading tasks');
    expect(skeleton.querySelectorAll('.task-row-layout').length).toBe(6);
    expect(skeleton.querySelectorAll('.h-9').length).toBe(2);
  });

  it('a mouse-pinned row releases once the pointer moves to another row (U6)', async () => {
    const { rerender } = render(<TasksPage />);
    const done = within(row('T-2')).getByRole('button', { name: 'Mark done T-2' });
    fireEvent.pointerDown(done);
    await act(async () => { fireEvent.click(done); });
    mockUseTaskViewTasks.mockImplementation((definition?: { filters?: { closed?: unknown } }) =>
      definition?.filters?.closed ? tasksResult([]) : tasksResult([task()]),
    );
    rerender(<TasksPage />);
    expect(row('T-2')).toBeTruthy();
    const later = Date.now() + 5_000;
    const clock = vi.spyOn(Date, 'now').mockReturnValue(later);
    try {
      // Still under the pointer: stays put.
      fireEvent.pointerMove(row('T-2'));
      expect(row('T-2')).toBeTruthy();
      // Pointer moves on: released.
      act(() => { fireEvent.pointerMove(row('T-1')); });
      await waitFor(() => expect(row('T-2')).toBeNull());
    } finally {
      clock.mockRestore();
    }
  });
});


describe('R5 native row controls and readable context', () => {
  it('keeps key/title opening separate from selection and exposes four native controls', () => {
    render(<TasksPage />);
    expect(row('T-1').querySelector('[role="option"]')).toBeNull();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    const item = row('T-1');
    const selection = within(item).getByRole('checkbox', { name: 'Select T-1' });
    expect(selection).not.not.toHaveAttribute('data-focused');
    expect(within(item).getAllByRole('button')).toHaveLength(3);
    fireEvent.click(selection);
    expect(selection).toBeChecked();
    fireEvent.click(within(item).getByText('T-1'));
    expect(screen.getByTestId('drawer')).toHaveTextContent('T-1');
  });

  it('shows one overdue fact, preserves check-by and names owners in mixed views', () => {
    window.history.replaceState(null, '', '/tasks?view=attention');
    mockUseTaskViewTasks.mockReturnValue(tasksResult([task({ title: 'Check in', ownerType: 'developer', ownerId: 'dev-1', dueAt: '2026-09-24', scheduledOn: null, followUpAt: '2026-09-25T09:00:00Z', waitingOn: { type: 'text', label: 'Finance', ref: null, since: '2026-09-20T09:00:00Z' }, signals: { ...NO_SIGNALS, overdue: true, overdueDays: 2, overdueSource: 'due' } })]));
    render(<TasksPage />);
    expect(within(row('T-1')).getByText('2d overdue')).toBeInTheDocument();
    expect(within(row('T-1')).queryByText('Overdue 2d')).not.toBeInTheDocument();
    expect(within(row('T-1')).getByText('Dev One')).toBeInTheDocument();
    expect(within(row('T-1')).getByRole('button', { name: /T-1 Check in/ }).getAttribute('aria-label')?.match(/overdue/g)).toHaveLength(1);
  });

  it('offers Schedule from the always-visible More menu', () => {
    render(<TasksPage />);
    fireEvent.click(within(row('T-1')).getByRole('button', { name: 'More actions for T-1' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Schedule/ }));
    expect(screen.getByRole('dialog', { name: 'Schedule' })).toBeInTheDocument();
  });
});

it('opens Projects from the rail and mobile picker without changing the default view', () => {
  render(<TasksPage />);
  expect(screen.getByRole('button', { name: /Planned today/ })).toHaveAttribute('aria-current', 'page');
  fireEvent.click(within(screen.getByRole('navigation', { name: 'Task views' })).getByRole('button', { name: 'Projects', exact: true }));
  expect(screen.getByText(/No projects yet/)).toBeInTheDocument();
  const picker = screen.getByRole('combobox', { name: 'Task view' });
  expect(picker).toHaveValue('projects');
  fireEvent.change(picker, { target: { value: 'today' } });
  expect(screen.queryByText(/No projects yet/)).not.toBeInTheDocument();
});


it('places task controls under the project and returns to the directory from the rail', () => {
  window.history.replaceState(null, '', '/tasks?view=projects&project=1');
  mockUseProject.mockReturnValue({ data: { project: { id: 1, name: 'Platform migration', archivedAt: null }, tracks: [], facts: { open: 2, blocked: 0, overdue: 0, followUpDue: 0, nextCheck: null } } });
  render(<TasksPage />);
  expect(screen.getByRole('heading', { name: 'Platform migration', level: 1 })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Project tasks · all tracks', level: 2 })).toBeInTheDocument();
  expect(screen.getByRole('textbox', { name: 'Search tasks' })).toBeInTheDocument();
  fireEvent.click(within(screen.getByRole('navigation', { name: 'Task views' })).getByRole('button', { name: 'Projects', exact: true }));
  expect(screen.getByRole('textbox', { name: 'Search projects' })).toBeInTheDocument();
  expect(screen.queryByRole('textbox', { name: 'Search tasks' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'View options' })).not.toBeInTheDocument();
});

it('waits for project context before offering tasks or contextual capture', () => {
  window.history.replaceState(null, '', '/tasks?view=projects&project=1');
  mockUseProject.mockReturnValue({ isLoading: true });
  render(<TasksPage />);
  expect(screen.getByText('Loading project…')).toBeInTheDocument();
  expect(screen.queryByRole('textbox', { name: 'Search tasks' })).not.toBeInTheDocument();
  expect(screen.queryByText('Add task')).not.toBeInTheDocument();
});


describe('Tasks viewport window (P02)', () => {
  it('retains the starting row when range key events share a render batch', () => {
    mockUseTaskViewTasks.mockReturnValue(tasksResult([task(), task({ id: 2, taskKey: 'T-2' }), task({ id: 3, taskKey: 'T-3' })]));
    render(<TasksPage />);
    act(() => {
      openRow('T-1').focus();
      fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown', shiftKey: true });
      fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown', shiftKey: true });
    });
    expect(screen.getByText('3 selected')).toBeInTheDocument();
    expect(row('T-3')).toHaveAttribute('data-focused', 'true');
  });

  it('bounds grouped mounts, preserves offscreen range selection, and exports all tasks', async () => {
    if (!HTMLElement.prototype.scrollTo) HTMLElement.prototype.scrollTo = () => {};
    const all = Array.from({ length: 1000 }, (_, index) => task({ id: index + 1, taskKey: `T-${index + 1}`, title: `Synthetic ${index + 1}`, scheduledOn: index < 500 ? TODAY : '2026-09-27' }));
    mockUseTaskViewTasks.mockImplementation((definition?: { filters?: { closed?: unknown } }) => definition?.filters?.closed ? tasksResult([]) : tasksResult(all));
    const { container } = render(<TasksPage />);
    expect(container.querySelectorAll('[data-task-row]').length).toBeLessThan(40);
    expect(screen.queryByText('Synthetic 1000')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'View options' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Export CSV' }));
    expect(mockCsvDownload.mock.calls.at(-1)![0]).toContain('Synthetic 1000');
    press('j');
    act(() => {
      for (let i = 0; i < 35; i++) fireEvent.keyDown(document.activeElement ?? document.body, { key: 'j', shiftKey: true });
    });
    await waitFor(() => expect(row('T-36')).toHaveAttribute('data-focused', 'true'));
    expect(container.querySelectorAll('[data-task-row]').length).toBeLessThan(40);
    expect(screen.getByText('36 selected')).toBeInTheDocument();
    expect(row('T-30')).toBeNull();
    await act(async () => { fireEvent.click(within(screen.getByRole('toolbar', { name: 'Bulk actions' })).getByRole('button', { name: 'Done (e)' })); });
    expect(mockApply.mock.calls.at(-1)![0]).toHaveLength(36);
    expect(mockApply.mock.calls.at(-1)![0].map((item: { task: TaskViewTask }) => item.task.taskKey)).toContain('T-30');
  });

  it('keeps whole-group actions complete when most rows are outside the viewport', async () => {
    const all = Array.from({ length: 150 }, (_, index) => task({ id: index + 1, taskKey: `T-${index + 1}`, title: `Overdue ${index + 1}`, scheduledOn: '2026-09-23', signals: { ...NO_SIGNALS, overdue: true, overdueSource: 'scheduled', overdueDays: 3 } }));
    mockUseTaskViewTasks.mockImplementation((definition?: { filters?: { closed?: unknown } }) => definition?.filters?.closed ? tasksResult([]) : tasksResult(all));
    const { container } = render(<TasksPage />);
    expect(container.querySelectorAll('[data-task-row]').length).toBeLessThan(40);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Move all to today/ })); });
    expect(mockApply.mock.calls.at(-1)![0]).toHaveLength(150);
    expect(mockApply.mock.calls.at(-1)![0].at(-1).task.taskKey).toBe('T-150');
  });

  it('opens a drawer deep link for an offscreen task without mounting the backlog', async () => {
    window.history.replaceState(null, '', '/tasks?view=my-tasks&task=T-1000');
    mockUseTaskViewTasks.mockReturnValue(tasksResult(Array.from({ length: 1000 }, (_, index) => task({ id: index + 1, taskKey: `T-${index + 1}`, title: `Synthetic ${index + 1}` }))));
    const { container } = render(<TasksPage />);
    await waitFor(() => expect(mockDrawerProps?.taskKey).toBe('T-1000'));
    expect(container.querySelectorAll('[data-task-row]').length).toBeLessThan(40);
    expect(row('T-1000')).toBeNull();
  });
});

describe('WQ-03 visible bulk Priority and Check-by', () => {
  const tomorrowAtNine = new Date('2026-09-27T09:00:00').toISOString();

  function selectAcrossGroups(overrides: Partial<TaskViewTask> = {}) {
    const rows = [
      task({ followUpAt: new Date('2026-09-25T09:00:00').toISOString(), ...overrides }),
      task({ id: 2, taskKey: 'T-2', title: 'Selected overdue', scheduledOn: '2026-09-23', priority: 'high', followUpAt: new Date('2026-09-27T15:00:00').toISOString() }),
      task({ id: 3, taskKey: 'T-3', title: 'Unselected tomorrow', scheduledOn: '2026-09-27' }),
    ];
    mockUseTaskViewTasks.mockImplementation((definition?: { filters?: { closed?: unknown } }) =>
      definition?.filters?.closed ? tasksResult([]) : tasksResult(rows),
    );
    render(<TasksPage />);
    expect(row('T-1').closest('[role="group"]')).not.toBe(row('T-2').closest('[role="group"]'));
    for (const key of ['T-1', 'T-2']) fireEvent.click(within(row(key)).getByRole('checkbox', { name: `Select ${key}` }));
    return within(screen.getByRole('toolbar', { name: 'Bulk actions' }));
  }

  function openBulkMenu(source: 'button' | 'keyboard', name: 'Priority (p)' | 'Check-by (c)') {
    if (source === 'button') {
      // A toolbar action must still use the selection when another row has focus.
      act(() => { openRow('T-3').focus(); });
      fireEvent.click(within(screen.getByRole('toolbar', { name: 'Bulk actions' })).getByRole('button', { name }));
      return;
    }
    act(() => { openRow('T-1').focus(); });
    press(name === 'Priority (p)' ? 'p' : 'c');
  }

  it.each(['button', 'keyboard'] as const)('%s sets selected priorities, skipping identical values', async (source) => {
    selectAcrossGroups();
    openBulkMenu(source, 'Priority (p)');
    await act(async () => { fireEvent.click(within(screen.getByRole('menu', { name: 'Set priority' })).getByRole('menuitemradio', { name: 'High' })); });
    expect(mockApply).toHaveBeenCalledOnce();
    expect(mockApply.mock.calls[0]![0].map((item: { task: TaskViewTask; changes: unknown }) => ({ key: item.task.taskKey, changes: item.changes })))
      .toEqual([{ key: 'T-1', changes: { priority: 'high' } }]);
    expect(mockApply.mock.calls[0]![1]).toMatchObject({ label: '1 task → High priority · skipped 1' });
    expect(within(row('T-3')).queryByRole('img', { name: 'High priority' })).not.toBeInTheDocument();
    expect(within(row('T-3')).getByRole('checkbox')).not.toBeChecked();
    expect(screen.getByText('2 selected')).toBeInTheDocument();
  });

  it('does nothing when all selected priorities already match', async () => {
    const toolbar = selectAcrossGroups({ priority: 'high' });
    fireEvent.click(toolbar.getByRole('button', { name: 'Priority (p)' }));
    await act(async () => { fireEvent.click(screen.getByRole('menuitemradio', { name: 'High' })); });
    expect(mockApply).not.toHaveBeenCalled();
    expect(mockAddToast).not.toHaveBeenCalled();
  });

  it.each(['button', 'keyboard'] as const)('%s sets Check-by at local 09:00 and skips the same local day', async (source) => {
    selectAcrossGroups();
    openBulkMenu(source, 'Check-by (c)');
    await act(async () => { fireEvent.click(within(screen.getByRole('dialog', { name: 'Check by' })).getByRole('menuitem', { name: /Tomorrow/ })); });
    expect(mockApply).toHaveBeenCalledOnce();
    expect(mockApply.mock.calls[0]![0].map((item: { task: TaskViewTask; changes: unknown }) => ({ key: item.task.taskKey, changes: item.changes })))
      .toEqual([{ key: 'T-1', changes: { followUpAt: tomorrowAtNine } }]);
    expect(mockApply.mock.calls[0]![1]).toMatchObject({ label: 'Check Sun · 1 task · skipped 1' });
    expect(within(row('T-3')).getByRole('checkbox')).not.toBeChecked();
    expect(row('T-3')).not.toHaveTextContent('Check');
  });

  it('clears selected check dates and leaves an already empty date unchanged', async () => {
    const toolbar = selectAcrossGroups({ followUpAt: null });
    fireEvent.click(toolbar.getByRole('button', { name: 'Check-by (c)' }));
    await act(async () => { fireEvent.click(screen.getByRole('menuitem', { name: /No check date/ })); });
    expect(mockApply.mock.calls[0]![0].map((item: { task: TaskViewTask; changes: unknown }) => ({ key: item.task.taskKey, changes: item.changes })))
      .toEqual([{ key: 'T-2', changes: { followUpAt: null } }]);
    expect(mockApply.mock.calls[0]![1]).toMatchObject({ label: 'Check date cleared · 1 task · skipped 1' });
  });

  it('applies a custom Check-by date to the exact selected tasks', async () => {
    const toolbar = selectAcrossGroups();
    fireEvent.click(toolbar.getByRole('button', { name: 'Check-by (c)' }));
    const picker = within(screen.getByRole('dialog', { name: 'Check by' }));
    fireEvent.change(picker.getByLabelText('Pick a date'), { target: { value: '2026-10-02' } });
    await act(async () => { fireEvent.click(picker.getByRole('button', { name: 'Apply check by' })); });
    const followUpAt = new Date('2026-10-02T09:00:00').toISOString();
    expect(mockApply.mock.calls[0]![0].map((item: { task: TaskViewTask; changes: unknown }) => ({ key: item.task.taskKey, changes: item.changes })))
      .toEqual([{ key: 'T-1', changes: { followUpAt } }, { key: 'T-2', changes: { followUpAt } }]);
    expect(within(row('T-3')).getByRole('checkbox')).not.toBeChecked();
  });
});


it('routes the Tasks help button to app help and ignores composing question marks', () => {
  const openKeyboardShortcuts = vi.fn();
  render(<QuickActionsProvider value={{ openCapture: vi.fn(), openCommandPalette: vi.fn(), openKeyboardShortcuts }}><TasksPage /></QuickActionsProvider>);
  fireEvent.keyDown(document.body, { key: '?', isComposing: true });
  expect(openKeyboardShortcuts).not.toHaveBeenCalled();
  const button = screen.getByRole('button', { name: 'Keyboard shortcuts' });
  fireEvent.click(button);
  expect(openKeyboardShortcuts).toHaveBeenCalledWith(button);
  expect(screen.queryByRole('dialog', { name: 'Keyboard shortcuts' })).not.toBeInTheDocument();
});


it('TR-01 retries a lost inline response with the original identity; equal-title new adds remain distinct', async () => {
  const { createTaskViaCapture } = await import('@/hooks/useCapture');
  const accepted = new Map<string, unknown>();
  let loseResponse = true;
  const post = vi.fn(async (body) => {
    if (!accepted.has(body.requestId)) accepted.set(body.requestId, { taskKey: `T-${accepted.size + 1}` });
    if (loseResponse) { loseResponse = false; throw new Error('Response lost'); }
    return { diagnostics: [], task: accepted.get(body.requestId) };
  });
  mockCreate.mockImplementation((input) => createTaskViaCapture(post, input));
  mockUseTaskViewTasks.mockReturnValue(tasksResult([]));
  render(<TasksPage />);
  fireEvent.click(screen.getByRole('button', { name: 'Add task', exact: true }));
  const input = screen.getByLabelText('New task');
  fireEvent.change(input, { target: { value: 'Retry me' } });
  await act(async () => { fireEvent.submit(input.closest('form')!); });
  expect(input).toHaveValue('Retry me');
  await act(async () => { fireEvent.submit(input.closest('form')!); });
  expect(post.mock.calls[1]![0]).toEqual(post.mock.calls[0]![0]);
  expect(accepted.size).toBe(1);
  expect(input).toHaveValue('');
  fireEvent.change(input, { target: { value: 'Retry me' } });
  await act(async () => { fireEvent.submit(input.closest('form')!); });
  expect(accepted.size).toBe(2);
});
