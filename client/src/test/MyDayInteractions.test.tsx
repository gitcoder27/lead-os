import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, renderHook, screen, within } from '@testing-library/react';
import { StatusSelector } from '@/components/my-day/StatusSelector';
import { RecentActivity } from '@/components/my-day/RecentActivity';
import { LoginPage } from '@/components/my-day/LoginPage';
import { QuickUpdates } from '@/components/my-day/QuickUpdates';
import { CurrentTask } from '@/components/my-day/CurrentTask';
import { PlannedQueue } from '@/components/my-day/PlannedQueue';
import { FinishedWork } from '@/components/my-day/FinishedWork';
import { relativeDayLabel } from '@/components/my-day/MyDayDateControl';
import { useMyDayHandlers } from '@/components/my-day/useMyDayHandlers';
import { useMyDayShortcuts } from '@/components/my-day/useMyDayShortcuts';
import { TestWrapper } from '@/test/wrapper';
import type { MyDayResponse, TrackerWorkItem } from '@/types';

let mockWorkspaceManager: { accountId: string; displayName: string } | undefined = { accountId: 'manager-a', displayName: 'Ayan' };
const mockAddToast = vi.fn();
const mockUpdateItemMutate = vi.fn();
const mockAddCheckInMutate = vi.fn();

vi.mock('@/context/ToastContext', () => ({
  useToast: () => ({ addToast: mockAddToast }),
}));

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ workspaceManager: mockWorkspaceManager, user: { displayName: 'Alice Smith', role: 'developer', developerAccountId: 'dev-1' } }),
  useAuthScopeKey: () => 'dev-1',
}));

vi.mock('@/hooks/useConfig', () => ({
  useConfig: () => ({ data: { jiraBaseUrl: 'https://test.atlassian.net', isConfigured: true } }),
}));

vi.mock('@/hooks/useMyDay', () => ({
  useUpdateMyDayStatus: () => ({ mutate: vi.fn(), isPending: false }),
  useAddMyDayItem: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateMyDayItem: () => ({ mutate: mockUpdateItemMutate, isPending: false }),
  useSetMyDayCurrent: () => ({ mutate: vi.fn(), isPending: false }),
  useAddMyDayCheckIn: () => ({ mutate: mockAddCheckInMutate, isPending: false }),
}));

vi.mock('@/hooks/useTasks', () => ({
  useAddMyDayTaskEvent: () => ({ mutate: vi.fn(), isPending: false }),
  useAddTaskEvent: () => ({ mutate: vi.fn(), isPending: false }),
  useMyDayTaskEvents: () => ({ data: { pages: [{ events: [], nextCursor: null }] } }),
  useTaskEvents: () => ({ data: undefined }),
  useRedactTaskEvent: () => ({ mutate: vi.fn() }),
  useUpdateTaskEventVisibility: () => ({ mutate: vi.fn() }),
}));

function createItem(overrides: Partial<TrackerWorkItem>): TrackerWorkItem {
  return {
    id: 1,
    dayId: 10,
    originDate: '2026-03-10',
    lifecycle: 'tracker_only',
    itemType: 'custom',
    taskKey: null,
    title: 'Task title',
    state: 'planned',
    position: 0,
    createdAt: '2026-03-10T09:00:00.000Z',
    updatedAt: '2026-03-10T09:00:00.000Z',
    ...overrides,
  };
}

describe('My Day status selector', () => {
  it('marks the current status and only reports real changes', () => {
    const onUpdate = vi.fn();
    render(<StatusSelector current="at_risk" onUpdate={onUpdate} />);

    const group = screen.getByRole('group', { name: 'Your status' });
    expect(group).toBeInTheDocument();
    const atRisk = screen.getByRole('button', { name: /at risk/i });
    expect(atRisk).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(atRisk);
    expect(onUpdate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /blocked/i }));
    expect(onUpdate).toHaveBeenCalledWith('blocked');
  });

  it('ignores clicks on a read-only day', () => {
    const onUpdate = vi.fn();
    render(<StatusSelector current="on_track" onUpdate={onUpdate} disabled />);
    fireEvent.click(screen.getByRole('button', { name: /waiting/i }));
    expect(onUpdate).not.toHaveBeenCalled();
  });
});

describe('My Day quick update', () => {
  const tasks = [
    { taskKey: 'T-1', title: 'Current work' },
    { taskKey: 'T-2', title: 'Next work' },
  ];

  it('asks the question the current status raises', () => {
    render(<QuickUpdates onAddCheckIn={vi.fn()} status="blocked" />);
    expect(screen.getByLabelText('Quick update')).toHaveAttribute('placeholder', expect.stringMatching(/blocking/i));
  });

  it('sends on Enter with tagged and typed task keys, and clears only once it lands', () => {
    const onAddCheckIn = vi.fn();
    render(<QuickUpdates onAddCheckIn={onAddCheckIn} tasks={tasks} />);

    const input = screen.getByLabelText('Quick update');
    fireEvent.focus(input);
    fireEvent.click(screen.getByRole('button', { name: 'T-2' }));
    fireEvent.change(input, { target: { value: 'Pairing on t-1 now' } });

    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    expect(onAddCheckIn).not.toHaveBeenCalled();

    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onAddCheckIn).toHaveBeenCalledWith('Pairing on t-1 now', undefined, ['T-2', 'T-1'], expect.objectContaining({ onSuccess: expect.any(Function) }));
    expect(input).toHaveValue('Pairing on t-1 now');

    act(() => {
      onAddCheckIn.mock.calls[0]![3].onSuccess();
    });
    expect(input).toHaveValue('');
    expect(screen.getByText('Update shared with Ayan')).toBeInTheDocument();
  });

  it('stays closed on read-only days', () => {
    const onAddCheckIn = vi.fn();
    render(<QuickUpdates onAddCheckIn={onAddCheckIn} disabled />);
    expect(screen.getByLabelText('Quick update')).toBeDisabled();
    expect(screen.getByRole('button', { name: /send/i })).toBeDisabled();
  });
});

describe('My Day focus card', () => {
  it('offers the next queued task as a one-click start when nothing is in focus', () => {
    const onSetCurrent = vi.fn();
    render(<CurrentTask viewDate="2026-03-10" nextItem={createItem({ id: 7, title: 'Ship the fix' })} onSetCurrent={onSetCurrent} />, { wrapper: TestWrapper });

    fireEvent.click(screen.getByRole('button', { name: 'Start Ship the fix' }));
    expect(onSetCurrent).toHaveBeenCalledWith(7);
  });

  it('points to adding a task when the queue is empty, and offers nothing on read-only days', () => {
    const onAddTask = vi.fn();
    const { rerender } = render(<CurrentTask viewDate="2026-03-10" onAddTask={onAddTask} />, { wrapper: TestWrapper });
    fireEvent.click(screen.getByRole('button', { name: /add a task/i }));
    expect(onAddTask).toHaveBeenCalled();

    rerender(<CurrentTask viewDate="2026-03-10" onAddTask={onAddTask} nextItem={createItem({ id: 7 })} readOnly />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('keeps done and drop one click away on the current task', () => {
    const onMarkDone = vi.fn();
    const onDrop = vi.fn();
    render(
      <CurrentTask
        viewDate="2026-03-10"
        item={createItem({ id: 3, title: 'Review PR', state: 'in_progress' })}
        onMarkDone={onMarkDone}
        onDrop={onDrop}
      />,
      { wrapper: TestWrapper }
    );

    fireEvent.click(screen.getByRole('button', { name: 'Mark Review PR done' }));
    fireEvent.click(screen.getByRole('button', { name: 'Drop Review PR' }));
    expect(onMarkDone).toHaveBeenCalledWith(3);
    expect(onDrop).toHaveBeenCalledWith(3);
  });
});

describe('My Day queue and finished work', () => {
  it('reorders from the keyboard with the same position contract as a drag', () => {
    const onReorder = vi.fn();
    render(
      <PlannedQueue
        viewDate="2026-03-10"
        items={[createItem({ id: 1, title: 'First', position: 1 }), createItem({ id: 2, title: 'Second', position: 3 })]}
        onSetCurrent={vi.fn()}
        onMarkDone={vi.fn()}
        onDrop={vi.fn()}
        onReorder={onReorder}
        onUpdateTitle={vi.fn()}
      />,
      { wrapper: TestWrapper }
    );

    const firstHandle = screen.getByRole('button', { name: /reorder first/i });
    fireEvent.keyDown(firstHandle, { key: 'ArrowUp' });
    expect(onReorder).not.toHaveBeenCalled();

    fireEvent.keyDown(firstHandle, { key: 'ArrowDown' });
    expect(onReorder).toHaveBeenCalledWith(1, 3);
  });

  it('opens a row’s update composer only on demand and closes it with Escape', () => {
    render(
      <PlannedQueue
        viewDate="2026-03-10"
        items={[createItem({ id: 1, title: 'Keyed', taskKey: 'T-9', position: 1 })]}
        onSetCurrent={vi.fn()}
        onMarkDone={vi.fn()}
        onDrop={vi.fn()}
        onReorder={vi.fn()}
        onUpdateTitle={vi.fn()}
      />,
      { wrapper: TestWrapper }
    );

    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add an update to T-9' }));
    const composer = screen.getByRole('textbox', { name: 'Add an update to T-9' });
    fireEvent.keyDown(composer, { key: 'Escape' });
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('moves finished work back to Up next', () => {
    const onReopen = vi.fn();
    render(
      <FinishedWork
        viewDate="2026-03-10"
        completedItems={[createItem({ id: 5, title: 'Wrote summary', state: 'done', completedAt: '2026-03-10T10:00:00.000Z' })]}
        droppedItems={[createItem({ id: 6, title: 'Old spike', state: 'dropped' })]}
        onReopen={onReopen}
      />,
      { wrapper: TestWrapper }
    );

    expect(screen.getByText('Dropped')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Move Wrote summary back to Up next' }));
    expect(onReopen).toHaveBeenCalledWith(5);
  });
});

describe('My Day handlers', () => {
  const day = {
    currentItem: createItem({ id: 101, title: 'Current', state: 'in_progress' }),
    plannedItems: [createItem({ id: 102, title: 'Planned' })],
    completedItems: [],
    droppedItems: [],
  } as unknown as MyDayResponse;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('offers an undo that restores the task to where it was', () => {
    const { result } = renderHook(() => useMyDayHandlers('2026-03-10', false, day), { wrapper: TestWrapper });

    act(() => result.current.handleMarkDone(101));
    expect(mockUpdateItemMutate).toHaveBeenCalledWith({ itemId: 101, state: 'done' }, expect.anything());

    act(() => mockUpdateItemMutate.mock.calls[0]![1].onSuccess());
    const toast = mockAddToast.mock.calls[0]![0];
    expect(toast).toMatchObject({ title: 'Marked done', message: 'Current', action: { label: 'Undo' } });

    act(() => toast.action.onClick());
    expect(mockUpdateItemMutate).toHaveBeenLastCalledWith({ itemId: 101, state: 'in_progress' }, expect.anything());
  });

  it('reopens finished work as planned and reports check-in success to the caller', () => {
    const { result } = renderHook(() => useMyDayHandlers('2026-03-10', false, day), { wrapper: TestWrapper });
    const onSuccess = vi.fn();

    act(() => {
      result.current.handleReopen(102);
      result.current.handleAddCheckIn('Shipped', undefined, ['T-1'], { onSuccess });
    });

    expect(mockUpdateItemMutate).toHaveBeenCalledWith({ itemId: 102, state: 'planned' }, expect.anything());
    act(() => mockAddCheckInMutate.mock.calls[0]![1].onSuccess());
    expect(onSuccess).toHaveBeenCalled();
    expect(mockAddToast).not.toHaveBeenCalled();
  });
});

describe('My Day shortcuts and dates', () => {
  it('labels nearby days in words and farther ones by date', () => {
    expect(relativeDayLabel('2026-03-10', '2026-03-10')).toBe('Today');
    expect(relativeDayLabel('2026-03-09', '2026-03-10')).toBe('Yesterday');
    expect(relativeDayLabel('2026-03-11', '2026-03-10')).toBe('Tomorrow');
    expect(relativeDayLabel('2026-03-05', '2026-03-10')).toBe('Thu, Mar 5');
  });

  it('fires single-key shortcuts only when not typing and without modifiers', () => {
    const handlers = { onAddTask: vi.fn(), onFocusUpdate: vi.fn(), onPrevDay: vi.fn(), onNextDay: vi.fn(), onToday: vi.fn() };
    renderHook(() => useMyDayShortcuts(handlers));

    fireEvent.keyDown(window, { key: 'n' });
    fireEvent.keyDown(window, { key: 'u' });
    fireEvent.keyDown(window, { key: '[' });
    fireEvent.keyDown(window, { key: ']' });
    fireEvent.keyDown(window, { key: 't' });
    expect(handlers.onAddTask).toHaveBeenCalledTimes(1);
    expect(handlers.onFocusUpdate).toHaveBeenCalledTimes(1);
    expect(handlers.onPrevDay).toHaveBeenCalledTimes(1);
    expect(handlers.onNextDay).toHaveBeenCalledTimes(1);
    expect(handlers.onToday).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(window, { key: 'n', metaKey: true });
    const input = document.createElement('input');
    document.body.appendChild(input);
    fireEvent.keyDown(input, { key: 'n' });
    input.remove();
    expect(handlers.onAddTask).toHaveBeenCalledTimes(1);
  });
});

describe('My Day manager names', () => {
  beforeEach(() => { mockWorkspaceManager = { accountId: 'manager-a', displayName: 'Ayan' }; });

  it('keeps developer sign-in copy neutral before a workspace is known', () => {
    render(<LoginPage role="developer" />);
    expect(screen.getByText('Your current task, your plan for today and updates shared with your team.')).toBeInTheDocument();
    expect(screen.getByText('No account yet? Ask the person who invited you for access.')).toBeInTheDocument();
    expect(screen.queryByText(/Ayan|your lead/)).not.toBeInTheDocument();
  });

  it('uses the actual author for replies and does not attribute unknown authors to the workspace owner', () => {
    render(<RecentActivity checkIns={[
      { id: 1, dayId: 1, summary: 'Owner reply', createdAt: '2026-03-10T09:00:00Z', authorType: 'manager', authorAccountId: 'manager-a', taskKeys: [] },
      { id: 2, dayId: 1, summary: 'Colleague reply', createdAt: '2026-03-10T09:01:00Z', authorType: 'manager', authorAccountId: 'manager-b', authorDisplayName: 'Mira', taskKeys: [] },
      { id: 3, dayId: 1, summary: 'Historical reply', createdAt: '2026-03-10T09:02:00Z', authorType: 'manager', taskKeys: [] },
    ]} />);
    expect(screen.getByText('From Ayan')).toBeInTheDocument();
    expect(screen.getByText('From Mira')).toBeInTheDocument();
    expect(screen.getByText('Shared update')).toBeInTheDocument();
    expect(screen.queryByText(/your lead/i)).not.toBeInTheDocument();
  });

  it('merges task updates and blockers into the log newest first', () => {
    render(<RecentActivity
      checkIns={[{ id: 1, dayId: 1, summary: 'Morning check-in', createdAt: '2026-03-10T09:00:00Z', authorType: 'developer', taskKeys: [] }]}
      taskUpdates={[
        { id: 7, taskKey: 'T-56', type: 'update', body: 'Wired the endpoint', occurredAt: '2026-03-10T11:00:00Z' },
        { id: 8, taskKey: 'T-69', type: 'blocker', blockerAction: 'raised', body: 'Need access', occurredAt: '2026-03-10T10:00:00Z' },
      ]}
    />);
    const items = within(screen.getByRole('list', { name: 'Check-ins' })).getAllByRole('listitem');
    expect(items.map((item) => item.textContent)).toEqual([
      expect.stringContaining('Wired the endpoint'),
      expect.stringContaining('Need access'),
      expect.stringContaining('Morning check-in'),
    ]);
    expect(items[0]).toHaveTextContent('T-56');
    expect(items[1]).toHaveTextContent('Blocker raised');
  });

  it('uses neutral activity and success copy without a manager name', () => {
    mockWorkspaceManager = undefined;
    const onAddCheckIn = vi.fn();
    render(<><RecentActivity checkIns={[]} /><QuickUpdates onAddCheckIn={onAddCheckIn} /></>);
    expect(screen.getByText('Updates you send show up here — and on the team board.')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Quick update'), { target: { value: 'Progress' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    act(() => { onAddCheckIn.mock.calls[0]![3].onSuccess(); });
    expect(screen.getByText('Update shared')).toBeInTheDocument();
    expect(screen.queryByText(/your lead/i)).not.toBeInTheDocument();
  });
});
