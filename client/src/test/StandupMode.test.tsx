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
const mockApiPost = vi.fn((_url: string, _body?: unknown) =>
  Promise.resolve({ session: { id: 1 }, followUps: [] }),
);

vi.mock('@/lib/api', () => ({
  api: {
    post: (url: string, body?: unknown) => mockApiPost(url, body),
    get: () => Promise.resolve({}),
  },
}));

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

let mockLastSession: import('@/types').StandupSessionDetail | null = null;

vi.mock('@/hooks/useTeamTracker', () => ({
  useStandupFeed: () => ({ data: mockFeed, isLoading: false, isError: false }),
  useLatestStandupSession: () => ({ data: { session: mockLastSession }, isLoading: false, isError: false, refetch: vi.fn() }),
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
      overdueLinkedWork: 0, statusFollowUp: 0, doneForToday: 0,
    },
    visibleSummary: {
      total: 2, stale: 0, blocked: 0, atRisk: 0, waiting: 0, noCurrent: 0,
      overdueLinkedWork: 0, statusFollowUp: 0, doneForToday: 0,
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
  window.sessionStorage.clear();
});

describe('StandupMode', () => {
  it('renders the focused developer, their tasks, and the rolling-window feed', () => {
    renderStandup();
    expect(screen.getByTestId('standup-mode')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Standup' })).toBeInTheDocument();
    const tasks = screen.getByRole('listbox', { name: "Alice Smith's tasks" });
    expect(within(tasks).getByText('Ship migration')).toBeInTheDocument();
    expect(within(tasks).getByText('Stuck migration')).toBeInTheDocument();
    // Feed mixes events and check-ins.
    expect(screen.getByText('Wrapped the retry path')).toBeInTheDocument();
    expect(screen.getByText('Yesterday: migration, today: reviews')).toBeInTheDocument();
    expect(screen.getByText('24h window')).toBeInTheDocument();
    // Suggestion badge renders for dev-1.
    expect(screen.getByTestId('status-suggestion')).toBeInTheDocument();
  });

  it('shows a read-only 1:1 badge when a session is due', () => {
    const board = buildBoard();
    board.developers[0]!.oneOnOne = { seriesId: 5, scheduledFor: '2026-03-07', overdueDays: 0 };
    board.developers[1]!.oneOnOne = { seriesId: 6, scheduledFor: '2026-03-04', overdueDays: 3 };
    render(
      <TestWrapper>
        <StandupMode date="2026-03-07" board={board} onClose={mockOnClose} onOpenTask={mockOnOpenTask} />
      </TestWrapper>,
    );
    expect(screen.getByText('1:1 today')).toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: 'n' });
    expect(screen.getByText('1:1 overdue 3d')).toBeInTheDocument();
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

  it('clicking a task row opens the task drawer', () => {
    renderStandup();
    fireEvent.click(taskRows()[1]!);
    expect(mockOnOpenTask).toHaveBeenCalledWith('T-2');
    expect(taskRows()[1]).toHaveAttribute('aria-selected', 'true');
  });

  it('the Last round button opens the previous sealed standup', () => {
    mockLastSession = {
      id: 7,
      date: '2026-03-07',
      startedAt: '2026-03-07T08:30:00Z',
      endedAt: '2026-03-07T08:45:00Z',
      reviewed: ['dev-1', 'dev-2'],
      flagged: ['dev-1'],
      summary: 'Standup 2026-03-07 — 2/2 reviewed',
      createdAt: '2026-03-07T08:45:00Z',
      log: [{ accountId: 'dev-1', kind: 'done', taskKey: 'T-1', at: '2026-03-07T08:40:00Z' }],
    };
    try {
      renderStandup();
      fireEvent.click(screen.getByRole('button', { name: 'Previous standup round' }));
      const history = screen.getByTestId('standup-history');
      expect(within(history).getByText(/Ended .*· 2 reviewed · 1 flagged/)).toBeInTheDocument();
      expect(within(history).getAllByText('Alice Smith').length).toBeGreaterThanOrEqual(2); // flagged chip + log group
      expect(within(history).getByText('Closed T-1')).toBeInTheDocument();
      expect(within(history).getByText(/2\/2 reviewed/)).toBeInTheDocument();
    } finally {
      mockLastSession = null;
    }
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

  describe('session & wrap-up (docs/50)', () => {
    function rail() {
      return within(screen.getByRole('listbox', { name: 'Standup order' })).getAllByRole('option');
    }

    it('shows the day strip for the focused developer', () => {
      renderStandup();
      const strip = screen.getByTestId('standup-day-strip');
      expect(within(strip).getByText('T-1')).toBeInTheDocument();
      expect(within(strip).getByText('Blocked').nextSibling).toHaveTextContent('1');
      expect(within(strip).getByText('None today')).toBeInTheDocument();
    });

    it('marks a developer reviewed on moving past them and tracks progress', () => {
      renderStandup();
      expect(screen.getByTestId('standup-progress')).toHaveTextContent('0 of 2 reviewed');
      fireEvent.keyDown(document.body, { key: 'n' });
      expect(screen.getByTestId('standup-progress')).toHaveTextContent('1 of 2 reviewed');
      expect(rail()[0]).toHaveAccessibleName('Alice Smith, reviewed');
      expect(rail()[1]).toHaveAccessibleName('Bob Jones');
    });

    it('does not mark skipped people when jumping from the rail', () => {
      const board = buildBoard();
      board.developers.push(day({
        id: 3,
        developer: { accountId: 'dev-3', displayName: 'Cara Diaz', isActive: true },
        tasks: [surfaceTask({ id: 5, taskKey: 'T-5', title: 'Cara task', ownerId: 'dev-3' })],
      }));
      render(
        <TestWrapper>
          <StandupMode date="2026-03-07" board={board} onClose={mockOnClose} onOpenTask={mockOnOpenTask} />
        </TestWrapper>,
      );
      fireEvent.click(rail()[2]!);
      // Alice was left → reviewed; Bob was skipped; Cara is current.
      expect(rail()[0]).toHaveAccessibleName('Alice Smith, reviewed');
      expect(rail()[1]).toHaveAccessibleName('Bob Jones');
      expect(rail()[2]).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByTestId('standup-progress')).toHaveTextContent('1 of 3 reviewed');
    });

    it('opens the wrap-up past the last developer; ← returns and Enter ends', async () => {
      renderStandup();
      fireEvent.keyDown(document.body, { key: 'n' });
      fireEvent.keyDown(document.body, { key: 'n' });
      const wrapUp = screen.getByTestId('standup-wrapup');
      expect(within(wrapUp).getByRole('heading', { name: 'Standup complete' })).toBeInTheDocument();
      fireEvent.keyDown(document.body, { key: 'ArrowLeft' });
      expect(screen.queryByTestId('standup-wrapup')).not.toBeInTheDocument();
      expect(screen.getByRole('listbox', { name: "Bob Jones's tasks" })).toBeInTheDocument();
      fireEvent.keyDown(document.body, { key: 'w' });
      fireEvent.keyDown(document.body, { key: 'Enter' });
      await waitFor(() => expect(mockOnClose).toHaveBeenCalledTimes(1));
      // docs/50 v2: Enter sealed the round — session record + summary note append.
      const urls = mockApiPost.mock.calls.map(([url]) => String(url));
      expect(urls).toContain('/team-tracker/standup/session');
      expect(urls.some((url) => url === '/notes/2026-03-07/append')).toBe(true);
      // Session cleared — the next standup starts fresh.
      expect(window.sessionStorage.length).toBe(0);
    });

    it('End standup seals the round with reviewed ids and clears the session', async () => {
      renderStandup();
      fireEvent.keyDown(document.body, { key: 'f' });        // flag Alice
      fireEvent.keyDown(document.body, { key: 'n' });        // review Alice → Bob
      fireEvent.keyDown(document.body, { key: 'w' });        // wrap-up (Bob auto-reviewed on entry)
      fireEvent.click(within(screen.getByTestId('standup-wrapup')).getByRole('button', { name: /End standup/ }));
      await waitFor(() => expect(mockOnClose).toHaveBeenCalled());
      const call = mockApiPost.mock.calls.find(([url]) => String(url) === '/team-tracker/standup/session');
      expect(call).toBeTruthy();
      const body = call![1] as { reviewed: string[]; flagged: string[]; requestId: string; summary: string };
      expect(body.reviewed).toEqual(['dev-1', 'dev-2']);
      expect(body.flagged).toEqual(['dev-1']);
      expect(body.summary).toContain('Standup 2026-03-07');
      expect(body.requestId).toBeTruthy();
      expect(window.sessionStorage.length).toBe(0);
      // The failed-note path did not run — success toast mentions follow-ups.
      expect(mockAddToast).toHaveBeenCalledWith(expect.stringContaining('Standup recorded'), 'success');
    });

    it('files the summary as a standup note — checked by default', async () => {
      renderStandup();
      fireEvent.keyDown(document.body, { key: 'w' });  // wrap-up (auto-reviews Alice → non-empty session)
      const wrapUp = screen.getByTestId('standup-wrapup');
      const checkbox = within(wrapUp).getByRole('checkbox', { name: /Save summary to notes/ });
      expect(checkbox).toBeChecked();

      fireEvent.click(within(wrapUp).getByRole('button', { name: /End standup/ }));
      await waitFor(() => expect(mockOnClose).toHaveBeenCalled());
      const appendCall = mockApiPost.mock.calls.find(([url]) => String(url) === '/notes/2026-03-07/append');
      expect(appendCall).toBeTruthy();
      expect((appendCall![1] as { kind?: string }).kind).toBe('standup');
      expect((appendCall![1] as { requestId?: string }).requestId).toBeTruthy();
    });

    it('seals without appending when "Save summary to notes" is unchecked', async () => {
      renderStandup();
      fireEvent.keyDown(document.body, { key: 'w' });
      const wrapUp = screen.getByTestId('standup-wrapup');
      fireEvent.click(within(wrapUp).getByRole('checkbox', { name: /Save summary to notes/ }));

      fireEvent.click(within(wrapUp).getByRole('button', { name: /End standup/ }));
      await waitFor(() => expect(mockOnClose).toHaveBeenCalled());
      const urls = mockApiPost.mock.calls.map(([url]) => String(url));
      expect(urls).toContain('/team-tracker/standup/session');
      expect(urls.some((url) => url === '/notes/2026-03-07/append')).toBe(false);
      expect(mockAddToast).toHaveBeenCalledWith(expect.stringContaining('Standup recorded'), 'success');
    });

    it('keeps the wrap-up open and reports the error when sealing fails', async () => {
      mockApiPost.mockRejectedValueOnce(new Error('offline'));
      renderStandup();
      fireEvent.keyDown(document.body, { key: 'w' });  // reviews Alice via wrap-up entry → non-empty session
      fireEvent.click(within(screen.getByTestId('standup-wrapup')).getByRole('button', { name: /End standup/ }));
      await waitFor(() => expect(mockAddToast).toHaveBeenCalledWith('offline', 'error'));
      expect(mockOnClose).not.toHaveBeenCalled();
      expect(screen.getByTestId('standup-wrapup')).toBeInTheDocument();
    });

    it('Esc exits without sealing — the session stays resumable', () => {
      renderStandup();
      fireEvent.keyDown(document.body, { key: 'n' });  // review Alice
      fireEvent.keyDown(document.body, { key: 'Escape' });
      expect(mockOnClose).toHaveBeenCalledTimes(1);
      expect(mockApiPost.mock.calls.some(([url]) => String(url) === '/team-tracker/standup/session')).toBe(false);
      // Progress persisted for resume.
      expect(window.sessionStorage.length).toBeGreaterThan(0);
    });

    it('f flags for follow-up and logged actions appear in the wrap-up', () => {
      renderStandup();
      fireEvent.keyDown(document.body, { key: 'f' });
      expect(screen.getByText('Follow up')).toBeInTheDocument();
      fireEvent.keyDown(document.body, { key: 'd' });
      fireEvent.keyDown(document.body, { key: 'w' });
      const wrapUp = screen.getByTestId('standup-wrapup');
      expect(within(wrapUp).getByRole('heading', { name: '1 not reviewed yet' })).toBeInTheDocument();
      const aliceFollowUp = within(wrapUp).getAllByRole('button', { name: 'Go to Alice Smith' })[0]!;
      expect(aliceFollowUp).toHaveTextContent('Flagged');
      expect(within(wrapUp).getByText('Closed T-1')).toBeInTheDocument();
      // Jumping from "Not reviewed" lands on Bob.
      fireEvent.click(within(wrapUp).getByRole('button', { name: 'Go to Bob Jones' }));
      expect(screen.getByRole('listbox', { name: "Bob Jones's tasks" })).toBeInTheDocument();
    });

    it('resumes at the first unreviewed developer after reopening', () => {
      const first = renderStandup();
      fireEvent.keyDown(document.body, { key: 'n' });
      first.unmount();
      renderStandup();
      expect(screen.getByTestId('standup-progress')).toHaveTextContent('1 of 2 reviewed');
      expect(screen.getByRole('listbox', { name: "Bob Jones's tasks" })).toBeInTheDocument();
    });

    it('feed group headers focus the matching task row', () => {
      const previous = mockFeed;
      mockFeed = {
        ...previous,
        entries: [
          { id: 'event:20', kind: 'event', occurredAt: '2026-03-07T10:00:00Z', taskKey: 'T-3', taskTitle: 'Review queue', type: 'blocker', blockerAction: 'raised', body: 'Need access' },
          ...previous.entries,
        ],
      };
      try {
        renderStandup();
        expect(screen.getByText('Blocker raised')).toBeInTheDocument();
        fireEvent.click(screen.getByTitle('Focus T-3'));
        expect(taskRows()[2]).toHaveAttribute('aria-selected', 'true');
        fireEvent.click(screen.getByRole('button', { name: 'Open T-3' }));
        expect(mockOnOpenTask).toHaveBeenCalledWith('T-3');
      } finally {
        mockFeed = previous;
      }
    });

    it('action bar chips run the same handlers as keys', () => {
      renderStandup();
      const bar = screen.getByTestId('standup-action-bar');
      fireEvent.click(within(bar).getByRole('button', { name: /Done/ }));
      expect(mockUpdateTaskMutate).toHaveBeenCalledWith({ status: 'done' }, expect.anything());
      fireEvent.click(within(bar).getByRole('button', { name: /Check-in/ }));
      expect(screen.getByPlaceholderText(/General remark/)).toBeInTheDocument();
    });

    it('shows an add-task empty state for a developer with no open tasks', () => {
      const board = buildBoard();
      board.developers[1]!.tasks = [];
      render(
        <TestWrapper>
          <StandupMode date="2026-03-07" board={board} onClose={mockOnClose} onOpenTask={mockOnOpenTask} />
        </TestWrapper>,
      );
      fireEvent.keyDown(document.body, { key: 'n' });
      const empty = screen.getByText('No open tasks').parentElement!;
      fireEvent.click(within(empty).getByRole('button', { name: /Add task/ }));
      expect(screen.getByTestId('capture-box')).toHaveAttribute('data-prefill', '@dev-2 ');
    });
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
