import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { ManagerTask, TaskViewMeta } from '@/types';

const mockUseTaskViews = vi.fn();
const mockUseTaskViewTasks = vi.fn();
const mockSaveView = vi.fn();
const mockUpdateView = vi.fn();
const mockDeleteView = vi.fn();

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { accountId: 'manager-a', role: 'manager' }, features: { tasksPhase3: true } }),
  useAuthScopeKey: () => 'ws:manager:manager',
}));

vi.mock('@/context/ToastContext', () => ({
  useToast: () => ({ addToast: vi.fn() }),
}));

vi.mock('@/hooks/useTaskViews', () => ({
  useTaskViews: (...args: unknown[]) => mockUseTaskViews(...args),
  useTaskViewTasks: (...args: unknown[]) => mockUseTaskViewTasks(...args),
  useSaveTaskView: () => ({ mutateAsync: mockSaveView, isPending: false }),
  useUpdateTaskView: () => ({ mutateAsync: mockUpdateView, isPending: false }),
  useDeleteTaskView: () => ({ mutateAsync: mockDeleteView, isPending: false }),
}));

vi.mock('@/hooks/useDevelopers', () => ({
  useDevelopers: () => ({ data: [{ accountId: 'dev-1', displayName: 'Dev One' }] }),
}));

vi.mock('@/hooks/useTaskLabels', () => ({
  useTaskLabels: () => ({ data: { labels: [{ name: 'escalation', color: 'red', system: false, createdAt: '' }] } }),
}));

vi.mock('@/components/tasks/TaskLabelPicker', () => ({
  TaskLabelChip: ({ name }: { name: string }) => <span data-testid={`label-${name}`}>{name}</span>,
  TaskLabelPicker: () => null,
}));

vi.mock('@/components/tasks/TaskDrawer', () => ({
  TaskDrawer: ({ taskKey }: { taskKey: string | null }) => (taskKey ? <div data-testid="drawer">{taskKey}</div> : null),
  navigateToTaskPage: vi.fn(),
}));

import { TasksPage } from '@/components/tasks/TasksPage';

const BUILTIN_VIEWS: TaskViewMeta[] = [
  { id: 'today-plan', name: 'Today plan', builtin: true, definition: { filters: { owner: 'me', status: ['open', 'active', 'blocked'] }, sort: 'scheduled', group: 'scheduled' } },
  { id: 'my-tasks', name: 'My tasks', builtin: true, definition: { filters: { owner: 'me' }, sort: 'scheduled', group: 'status' } },
  { id: 'inbox', name: 'Inbox', builtin: true, definition: { filters: { owner: 'inbox', status: ['open'] }, sort: 'created' } },
  { id: 'blocked', name: 'Blocked', builtin: true, definition: { filters: { status: ['blocked'] }, sort: 'updated', group: 'owner' } },
];

function task(overrides: Partial<ManagerTask> = {}): ManagerTask {
  return {
    id: 1,
    taskKey: 'T-1',
    title: 'Task one',
    kind: 'task',
    status: 'open',
    ownerType: 'manager',
    ownerId: 'manager-a',
    priority: 'normal',
    scheduledOn: null,
    dueAt: null,
    startsAt: null,
    endsAt: null,
    participants: null,
    outcome: null,
    createdByType: 'manager',
    createdById: 'manager-a',
    createdAt: '2026-09-20T10:00:00Z',
    updatedAt: '2026-09-24T10:00:00Z',
    closedAt: null,
    deletedAt: null,
    links: [],
    legacyDeskItemId: null,
    later: false,
    parentId: null,
    trackedByManagerId: 'manager-a',
    labels: [],
    nextAction: null,
    followUpAt: null,
    ...overrides,
  } as ManagerTask;
}

function lastDefinition() {
  const calls = mockUseTaskViewTasks.mock.calls;
  return calls[calls.length - 1]?.[0];
}

beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState(null, '', '/tasks');
  mockUseTaskViews.mockReturnValue({ data: { views: BUILTIN_VIEWS }, isLoading: false });
  mockUseTaskViewTasks.mockReturnValue({
    data: { tasks: [task(), task({ id: 2, taskKey: 'T-2', title: 'Dev task', ownerType: 'developer', ownerId: 'dev-1' })] },
    isLoading: false,
    isError: false,
    error: null,
  });
});

describe('TasksPage (P3-D1/D9)', () => {
  it('renders the view rail and runs the default view definition', () => {
    render(<TasksPage />);
    const rail = within(screen.getByRole('listbox'));
    for (const name of ['Today plan', 'My tasks', 'Inbox', 'Blocked']) {
      expect(rail.getByRole('option', { name })).toBeTruthy();
    }
    expect(lastDefinition()).toEqual(BUILTIN_VIEWS[0]!.definition);
    expect(screen.getByText('Task one')).toBeTruthy();
    expect(screen.getByText('Dev task')).toBeTruthy();
  });

  it('selecting a view switches the definition and shows the title', () => {
    render(<TasksPage />);
    const rail = within(screen.getByRole('listbox'));
    fireEvent.click(rail.getByRole('option', { name: 'Blocked' }).querySelector('button')!);
    expect(lastDefinition()).toEqual(BUILTIN_VIEWS[3]!.definition);
    expect(screen.getByRole('heading', { name: 'Blocked' })).toBeTruthy();
  });

  it('groups rows by the view grouping (scheduled buckets)', () => {
    mockUseTaskViewTasks.mockReturnValue({
      data: {
        tasks: [
          task({ taskKey: 'T-9', title: 'Old one', scheduledOn: '2000-01-01' }),
          task({ id: 2, taskKey: 'T-10', title: 'No date' }),
        ],
      },
      isLoading: false,
      isError: false,
      error: null,
    });
    render(<TasksPage />);
    expect(screen.getByText('Overdue')).toBeTruthy();
    expect(screen.getByText('Unscheduled')).toBeTruthy();
  });

  it('applies URL overrides on top of the selected view', () => {
    window.history.replaceState(null, '', '/tasks?view=my-tasks&owner=team&group=owner');
    render(<TasksPage />);
    const definition = lastDefinition();
    expect(definition.filters.owner).toBe('team');
    expect(definition.group).toBe('owner');
    expect(screen.getByRole('heading', { name: 'My tasks' })).toBeTruthy();
  });

  it('renders saved views separately and offers delete', () => {
    mockUseTaskViews.mockReturnValue({
      data: {
        views: [
          ...BUILTIN_VIEWS,
          { id: 'saved:7', name: 'Escalations', builtin: false, definition: { filters: { status: ['blocked'] } } },
        ],
      },
      isLoading: false,
    });
    render(<TasksPage />);
    const savedRow = screen.getByText('Escalations').closest('[role="option"]')!;
    expect(savedRow).toBeTruthy();
    const deleteButton = savedRow.querySelector('[aria-label="Delete Escalations"]');
    expect(deleteButton).toBeTruthy();
    fireEvent.click(deleteButton!);
    expect(mockDeleteView).toHaveBeenCalledWith(7);
  });

  it('saves the current composed definition as a new view', async () => {
    mockSaveView.mockResolvedValue({ id: 11, name: 'My filter', definition: {}, position: 0, createdAt: '', updatedAt: '' });
    render(<TasksPage />);
    fireEvent.click(screen.getByText('Save current view'));
    fireEvent.change(screen.getByLabelText('Saved view name'), { target: { value: 'My filter' } });
    fireEvent.click(screen.getByLabelText('Save view'));
    expect(mockSaveView).toHaveBeenCalledWith({ name: 'My filter', definition: BUILTIN_VIEWS[0]!.definition });
  });

  it('opens the TaskDrawer for the ?task= deep link', () => {
    window.history.replaceState(null, '', '/tasks?task=T-2');
    render(<TasksPage />);
    expect(screen.getByTestId('drawer').textContent).toBe('T-2');
  });

  it('opens the drawer when a row is clicked', () => {
    render(<TasksPage />);
    fireEvent.click(screen.getByText('Task one'));
    expect(screen.getByTestId('drawer').textContent).toBe('T-1');
  });
});
