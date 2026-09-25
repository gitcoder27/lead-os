import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { TestWrapper } from '@/test/wrapper';
import type {
  ManagerSurfaceTask,
  StandupFeedResponse,
  TeamTrackerBoardResponse,
  TrackerDeveloperDay,
} from '@/types';
import { StandupMode } from '@/components/team-tracker/StandupMode';

const mockStatusUpdateMutate = vi.fn((_params: unknown, options?: { onSuccess?: () => void }) => options?.onSuccess?.());
const mockAddCheckInMutate = vi.fn((_params: unknown, options?: { onSuccess?: () => void }) => options?.onSuccess?.());
const mockSetCurrentMutate = vi.fn((_ref: unknown, options?: { onSuccess?: () => void }) => options?.onSuccess?.());
const mockReassignMutate = vi.fn((_params: unknown, options?: { onSuccess?: () => void }) => options?.onSuccess?.());
const mockUpdateTaskMutate = vi.fn((_updates: unknown, options?: { onSuccess?: () => void }) => options?.onSuccess?.());
const mockAddTaskEventMutate = vi.fn();
const mockAddToast = vi.fn();
const mockOnClose = vi.fn();
const mockOnOpenTask = vi.fn();

let mockFeed: StandupFeedResponse = {
  entries: [
    {
      id: 'event:7',
      kind: 'event',
      occurredAt: '2026-03-07T09:00:00Z',
      taskKey: 'T-1',
      taskTitle: 'Ship migration',
      type: 'update',
      body: 'Wrapped the retry path',
      authorType: 'developer',
    },
    {
      id: 'checkin:3',
      kind: 'checkin',
      occurredAt: '2026-03-07T08:30:00Z',
      summary: 'Yesterday: migration, today: reviews',
    },
  ],
  windowStart: '2026-03-06T09:00:00Z',
  windowHours: 24,
};

vi.mock('@/hooks/useTeamTracker', () => ({
  useStandupFeed: () => ({ data: mockFeed, isLoading: false, isError: false }),
}));

vi.mock('@/hooks/useTeamTrackerMutations', () => ({
  useStatusUpdate: () => ({ mutate: mockStatusUpdateMutate, isPending: false, reset: vi.fn(), error: null }),
  useAddCheckIn: () => ({ mutate: mockAddCheckInMutate, isPending: false }),
  useSetCurrentItem: () => ({ mutate: mockSetCurrentMutate, isPending: false }),
  useReassignTrackerItem: () => ({ mutate: mockReassignMutate, isPending: false }),
}));

vi.mock('@/hooks/useTaskDetail', () => ({
  useUpdateTaskDetail: () => ({ mutate: mockUpdateTaskMutate, isPending: false }),
}));

vi.mock('@/hooks/useTasks', () => ({
  useAddTaskEvent: () => ({ mutate: mockAddTaskEventMutate, isPending: false }),
  useAddMyDayTaskEvent: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock('@/hooks/useDevelopers', () => ({
  useDevelopers: () => ({
    data: [
      { accountId: 'dev-1', displayName: 'Alice Smith', isActive: true },
      { accountId: 'dev-2', displayName: 'Bob Jones', isActive: true },
    ],
    isPending: false,
  }),
}));

vi.mock('@/context/ToastContext', () => ({
  useToast: () => ({ addToast: mockAddToast }),
}));

vi.mock('@/components/capture/CaptureBox', () => ({
  CaptureBox: ({ prefill, onClose }: { prefill?: string; onClose: () => void }) => (
    <div data-testid="capture-box" data-prefill={prefill}>
      <button type="button" onClick={onClose}>
        Done
      </button>
    </div>
  ),
}));

function surfaceTask(overrides: Partial<ManagerSurfaceTask>): ManagerSurfaceTask {
  return {
    id: 1,
    taskKey: 'T-1',
    title: 'Task',
    kind: 'task',
    status: 'open',
    ownerType: 'developer',
    ownerId: 'dev-1',
    priority: 'normal',
    scheduledOn: '2026-03-07',
    dueAt: null,
    startsAt: null,
    endsAt: null,
    participants: null,
    outcome: null,
    createdByType: 'manager',
    createdById: 'manager-1',
    createdAt: '2026-03-07T08:00:00Z',
    updatedAt: '2026-03-07T08:00:00Z',
    closedAt: null,
    deletedAt: null,
    links: [],
    later: false,
    trackedByManagerId: null,
    parentId: null,
    labels: [],
    nextAction: null,
    followUpAt: null,
    position: 0,
    originDate: '2026-03-07',
    itemType: 'custom',
    lifecycle: 'tracker_only',
    relatedIssueKeys: [],
    ...overrides,
  };
}

function signals(): TrackerDeveloperDay['signals'] {
  return {
    freshness: {
      staleThresholdHours: 4,
      noCurrentThresholdHours: 2,
      statusFollowUpThresholdHours: 2,
      staleByTime: false,
      staleWithOpenRisk: false,
      staleWithoutCurrentWork: false,
      statusChangeWithoutFollowUp: false,
    },
    risk: {
      openRisk: false,
      overdueLinkedWork: false,
      overdueLinkedCount: 0,
      overCapacity: false,
      capacityDelta: 0,
    },
  };
}

function day(overrides: Partial<TrackerDeveloperDay>): TrackerDeveloperDay {
  return {
    id: 1,
    date: '2026-03-07',
    developer: { accountId: 'dev-1', displayName: 'Alice Smith', isActive: true },
    availability: { state: 'active' },
    status: 'on_track',
    plannedItems: [],
    completedItems: [],
    droppedItems: [],
    checkIns: [],
    recentCheckIns: [],
    isStale: false,
    signals: signals(),
    createdAt: '2026-03-07T08:00:00Z',
    updatedAt: '2026-03-07T08:00:00Z',
    ...overrides,
  };
}

function buildBoard(): TeamTrackerBoardResponse {
  return {
    date: '2026-03-07',
    viewMode: 'live',
    taskModel: 'canonical',
    developers: [
      day({
        statusSuggestion: { status: 'blocked', reasonTaskKey: 'T-2', reasonTaskTitle: 'Stuck migration' },
        tasks: [
          surfaceTask({ id: 1, taskKey: 'T-1', title: 'Ship migration', status: 'active', position: 0 }),
          surfaceTask({ id: 2, taskKey: 'T-2', title: 'Stuck migration', status: 'blocked', position: 1 }),
          surfaceTask({ id: 3, taskKey: 'T-3', title: 'Review queue', status: 'open', position: 2 }),
        ],
      }),
      day({
        id: 2,
        developer: { accountId: 'dev-2', displayName: 'Bob Jones', isActive: true },
        tasks: [surfaceTask({ id: 4, taskKey: 'T-4', title: 'Bob task', ownerId: 'dev-2', position: 0 })],
      }),
    ],
    inactiveDevelopers: [],
    attentionQueue: [],
    summary: {
      total: 2, stale: 0, blocked: 0, atRisk: 0, waiting: 0, noCurrent: 0,
      overdueLinkedWork: 0, overCapacity: 0, statusFollowUp: 0, doneForToday: 0,
    },
    visibleSummary: {
      total: 2, stale: 0, blocked: 0, atRisk: 0, waiting: 0, noCurrent: 0,
      overdueLinkedWork: 0, overCapacity: 0, statusFollowUp: 0, doneForToday: 0,
    },
    groups: [],
    query: { summaryFilter: 'all', sortBy: 'name', groupBy: 'none' },
  };
}

function renderStandup() {
  return render(
    <TestWrapper>
      <StandupMode date="2026-03-07" board={buildBoard()} onClose={mockOnClose} onOpenTask={mockOnOpenTask} />
    </TestWrapper>,
  );
}

function taskRows() {
  return within(screen.getByRole('listbox', { name: /Alice Smith's tasks|Bob Jones's tasks/ })).getAllByRole('option');
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('StandupMode', () => {
  it('renders the focused developer, their tasks, and the rolling-window feed', () => {
    renderStandup();
    expect(screen.getByTestId('standup-mode')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Standup' })).toBeInTheDocument();
    expect(screen.getByText('Ship migration')).toBeInTheDocument();
    expect(screen.getByText('Stuck migration')).toBeInTheDocument();
    // Feed mixes events and check-ins.
    expect(screen.getByText('Wrapped the retry path')).toBeInTheDocument();
    expect(screen.getByText('Yesterday: migration, today: reviews')).toBeInTheDocument();
    expect(screen.getByText('24h window')).toBeInTheDocument();
    // Suggestion badge renders for dev-1.
    expect(screen.getByTestId('status-suggestion')).toBeInTheDocument();
  });

  it.each([
    ['n', 1],
    ['ArrowRight', 1],
  ])('moves to the next developer with %s', (key, expectedIndex) => {
    renderStandup();
    fireEvent.keyDown(document.body, { key });
    expect(screen.getByText('Bob task')).toBeInTheDocument();
    const rail = screen.getByRole('listbox', { name: 'Standup order' });
    const railOptions = within(rail).getAllByRole('option');
    expect(railOptions[expectedIndex]).toHaveAttribute('aria-selected', 'true');
  });

  it('moves back with p / ArrowLeft', () => {
    renderStandup();
    fireEvent.keyDown(document.body, { key: 'n' });
    fireEvent.keyDown(document.body, { key: 'p' });
    const rail = screen.getByRole('listbox', { name: 'Standup order' });
    expect(within(rail).getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(document.body, { key: 'n' });
    fireEvent.keyDown(document.body, { key: 'ArrowLeft' });
    expect(within(rail).getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true');
  });

  it('moves between tasks with j/k', () => {
    renderStandup();
    const rows = taskRows();
    expect(rows[0]).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(document.body, { key: 'j' });
    expect(taskRows()[1]).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(document.body, { key: 'k' });
    expect(taskRows()[0]).toHaveAttribute('aria-selected', 'true');
  });

  it('u expands the focused task composer and v toggles private', () => {
    renderStandup();
    fireEvent.keyDown(document.body, { key: 'u' });
    expect(screen.getByLabelText('Add an update to T-1')).toBeInTheDocument();
    const privateToggle = screen.getByRole('button', { name: 'Private' });
    expect(privateToggle).toHaveAttribute('aria-pressed', 'false');
    fireEvent.keyDown(document.body, { key: 'v' });
    expect(privateToggle).toHaveAttribute('aria-pressed', 'true');
  });

  it('s sets the focused task current, d marks it done', () => {
    renderStandup();
    fireEvent.keyDown(document.body, { key: 's' });
    expect(mockSetCurrentMutate).toHaveBeenCalledWith('T-1', expect.anything());
    fireEvent.keyDown(document.body, { key: 'd' });
    expect(mockUpdateTaskMutate).toHaveBeenCalledWith({ status: 'done' }, expect.anything());
  });

  it('b opens the blocked rationale dialog for the focused task', () => {
    renderStandup();
    fireEvent.keyDown(document.body, { key: 'j' }); // focus T-2 (blocked)
    fireEvent.keyDown(document.body, { key: 'b' });
    const dialog = screen.getByRole('dialog', { name: /Alice Smith/ });
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/Rationale/)).toBeInTheDocument();
  });

  it('a opens the capture box pre-filled with the developer owner token', async () => {
    renderStandup();
    fireEvent.keyDown(document.body, { key: 'a' });
    expect(screen.getByTestId('capture-box')).toHaveAttribute('data-prefill', '@dev-1 ');
    // Closing marks the developer visited and returns to the board layer.
    fireEvent.click(within(screen.getByTestId('capture-box')).getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByTestId('capture-box')).not.toBeInTheDocument());
  });

  it('c opens the check-in layer and submits through the check-in mutation', () => {
    renderStandup();
    fireEvent.keyDown(document.body, { key: 'c' });
    const input = screen.getByPlaceholderText(/General remark/);
    fireEvent.change(input, { target: { value: 'Going well overall' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(mockAddCheckInMutate).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: 'dev-1', summary: 'Going well overall' }),
      expect.anything(),
    );
  });

  it('r opens the reassign layer and reassigns the focused task', () => {
    renderStandup();
    fireEvent.keyDown(document.body, { key: 'r' });
    fireEvent.click(screen.getByRole('button', { name: /Bob Jones/ }));
    expect(mockReassignMutate).toHaveBeenCalledWith({ itemId: 'T-1', toAccountId: 'dev-2' }, expect.anything());
  });

  it('y accepts the status suggestion through the rationale dialog', () => {
    renderStandup();
    fireEvent.keyDown(document.body, { key: 'y' });
    const dialog = screen.getByRole('dialog', { name: /Alice Smith/ });
    fireEvent.change(within(dialog).getByLabelText(/Rationale/), { target: { value: 'Migration is stuck on review' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Set status' }));
    expect(mockStatusUpdateMutate).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: 'dev-1', status: 'blocked', rationale: 'Migration is stuck on review', taskKey: 'T-2' }),
      expect.anything(),
    );
  });

  it('Enter opens the focused task drawer', () => {
    renderStandup();
    fireEvent.keyDown(document.body, { key: 'j' });
    fireEvent.keyDown(document.body, { key: 'Enter' });
    expect(mockOnOpenTask).toHaveBeenCalledWith('T-2');
  });

  it('? opens the key help overlay and Esc closes layers before exiting', async () => {
    renderStandup();
    fireEvent.keyDown(document.body, { key: '?' });
    expect(screen.getByRole('dialog', { name: 'Standup keyboard shortcuts' })).toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Standup keyboard shortcuts' })).not.toBeInTheDocument(),
    );
    expect(mockOnClose).not.toHaveBeenCalled();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it('ignores plain keys while a text field holds focus', () => {
    renderStandup();
    fireEvent.keyDown(document.body, { key: 'c' });
    const input = screen.getByPlaceholderText(/General remark/);
    input.focus();
    fireEvent.keyDown(input, { key: 'n' });
    // Still on dev-1 — n typed into the field, not handled as navigation.
    const rail = screen.getByRole('listbox', { name: 'Standup order' });
    expect(within(rail).getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true');
  });
});
