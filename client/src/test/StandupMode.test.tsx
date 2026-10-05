import { clearTaskUpdateDraftsForScope } from '@/lib/task-update-drafts';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { QueryClient } from '@tanstack/react-query';
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
const mockRecordReviewsMutate = vi.fn((body: { accountIds: string[] }, options?: { onError?: () => void; onSuccess?: (result: { recorded: string[] }) => void }) => options?.onSuccess?.({ recorded: body.accountIds }));
const mockAddToast = vi.fn();
const mockOnClose = vi.fn();
const mockOnOpenTask = vi.fn();
const mockApiPost = vi.fn((_url: string, _body?: unknown) =>
  Promise.resolve({ session: { id: 1 }, followUps: [] }),
);

vi.mock('@/context/AuthContext', () => ({ useAuthScopeKey: () => 'standup-scope', useAuth: () => ({ user: null }) }));

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

// docs/56 P1-04: these suites describe the collab check-in UI; solo cases flip the mode.
const teamModeMock = vi.hoisted(() => ({ mode: 'collab' as 'solo' | 'collab' }));
vi.mock('@/hooks/useTeamMode', () => ({
  useTeamMode: () => teamModeMock.mode,
  useSetTeamMode: () => ({ mutate: vi.fn(), isPending: false }),
}));

// A test can answer per person (e.g. one feed still loading); by default everyone gets `mockFeed`.
let feedFor: ((accountId: string | undefined) => { data: StandupFeedResponse | undefined; isLoading: boolean; isError: boolean }) | null = null;
const mockPrefetchFeeds = vi.fn();

vi.mock('@/hooks/useTeamTracker', () => ({
  useStandupFeed: (accountId?: string) => (feedFor ? feedFor(accountId) : { data: mockFeed, isLoading: false, isError: false }),
  usePrefetchStandupFeeds: (ids: string[], enabled?: boolean) => mockPrefetchFeeds(ids, enabled),
  useLatestStandupSession: () => ({ data: { session: mockLastSession }, isLoading: false, isError: false, refetch: vi.fn() }),
}));

vi.mock('@/hooks/useTeamTrackerMutations', () => ({
  useStatusUpdate: () => ({ mutate: mockStatusUpdateMutate, isPending: false, reset: vi.fn(), error: null }),
  useAddCheckIn: () => ({ mutate: mockAddCheckInMutate, mutateAsync: (body: unknown) => new Promise((resolve, reject) => mockAddCheckInMutate(body, { onSuccess: () => resolve({}), onError: reject } as never)), isPending: false }),
  useSetCurrentItem: () => ({ mutate: mockSetCurrentMutate, isPending: false }),
  useReassignTrackerItem: () => ({ mutate: mockReassignMutate, isPending: false }),
  useRecordStandupReviews: () => ({ mutate: mockRecordReviewsMutate, mutateAsync: (body: { accountIds: string[] }) => new Promise((resolve, reject) => mockRecordReviewsMutate(body, { onSuccess: resolve, onError: reject })), isPending: false }),
}));

vi.mock('@/hooks/useTaskDetail', () => ({
  useUpdateTaskDetail: () => ({ mutate: mockUpdateTaskMutate, isPending: false }),
}));

vi.mock('@/hooks/useTasks', () => ({
  useAddTaskEvent: () => ({ mutate: mockAddTaskEventMutate, mutateAsync: (body: unknown) => new Promise((resolve, reject) => mockAddTaskEventMutate(body, { onSuccess: resolve, onError: reject })), isPending: false }),
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
  CaptureBox: ({ assignee, onClose }: { assignee?: { accountId: string; displayName?: string }; onClose: () => void }) => (
    <div data-testid="capture-box" data-assignee={assignee?.accountId}>
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

function signals(freshness: Partial<TrackerDeveloperDay['signals']['freshness']> = {}): TrackerDeveloperDay['signals'] {
  return {
    freshness: {
      staleThresholdHours: 4,
      noCurrentThresholdHours: 2,
      statusFollowUpThresholdHours: 2,
      staleByTime: false,
      staleWithOpenRisk: false,
      staleWithoutCurrentWork: false,
      statusChangeWithoutFollowUp: false,
      ...freshness,
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
    participates: true,
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

function renderStandup(board = buildBoard()) {
  return render(
    <TestWrapper>
      <StandupMode date="2026-03-07" board={board} onClose={mockOnClose} onOpenTask={mockOnOpenTask} />
    </TestWrapper>,
  );
}

/** `f` opens the reason layer; Enter flags with or without a reason. */
function flagFocusedPerson(reason?: string) {
  fireEvent.keyDown(document.body, { key: 'f' });
  const input = screen.getByLabelText(/Why follow up with/);
  if (reason !== undefined) fireEvent.change(input, { target: { value: reason } });
  fireEvent.keyDown(input, { key: 'Enter' });
}

function taskRows() {
  return within(screen.getByRole('listbox', { name: /Alice Smith's tasks|Bob Jones's tasks/ })).getAllByRole('option');
}

beforeEach(() => {
  teamModeMock.mode = 'collab';
  feedFor = null;
  vi.clearAllMocks();
  mockApiPost.mockReset();
  mockApiPost.mockResolvedValue({ session: { id: 1 }, followUps: [] });
  clearTaskUpdateDraftsForScope('standup-scope');
  window.sessionStorage.clear();
  window.localStorage.clear();
});

describe('StandupMode', () => {
  it('keeps roster and selected task identities stable when polling reorders them', () => {
    const board = buildBoard();
    const view = renderStandup(board);
    fireEvent.keyDown(document.body, { key: 'j' });
    fireEvent.keyDown(document.body, { key: 'u' });
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'T-2 draft' } });
    const reordered = { ...board, developers: [...board.developers].reverse().map((person) => ({ ...person, tasks: [...(person.tasks ?? [])].reverse().map((task, index) => ({ ...task, position: index })) })) };
    view.rerender(<TestWrapper><StandupMode date="2026-03-07" board={reordered} onClose={mockOnClose} onOpenTask={mockOnOpenTask} /></TestWrapper>);
    expect(screen.getByRole('textbox')).toHaveValue('T-2 draft');
    expect(screen.getByLabelText('Add an update to T-2')).toBeInTheDocument();
    const roster = within(screen.getByRole('listbox', { name: 'Standup order' })).getAllByRole('option');
    expect(roster[0]).toHaveAccessibleName('Alice Smith');
    expect(roster[1]).toHaveAccessibleName('Bob Jones');
  });

  it('preserves a person draft and a delayed success without clearing another person', async () => {
    let saved!: () => void;
    mockAddCheckInMutate.mockImplementationOnce((_body, options) => { saved = options!.onSuccess!; });
    renderStandup();
    fireEvent.keyDown(document.body, { key: 'c' });
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Alice note' } });
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /Check-in for Alice/ })).not.toBeInTheDocument());
    fireEvent.keyDown(document.body, { key: 'ArrowRight' });
    fireEvent.keyDown(document.body, { key: 'c' });
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Bob note' } });
    await act(async () => saved());
    expect(screen.getByRole('textbox')).toHaveValue('Bob note');
    expect(screen.getByRole('dialog', { name: /Bob Jones/ })).toBeInTheDocument();
    expect(mockAddCheckInMutate.mock.calls[0]![0]).toMatchObject({ accountId: 'dev-1', summary: 'Alice note', requestId: expect.any(String) });
  });

  it('recovers a removed task draft from finish after refresh', async () => {
    const first = renderStandup();
    fireEvent.keyDown(document.body, { key: 'u' });
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Keep this task update' } });
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });
    fireEvent.keyDown(document.body, { key: 'w' });
    await act(async () => {});
    first.unmount();
    const board = buildBoard();
    board.developers[0]!.tasks = board.developers[0]!.tasks!.filter((task) => task.taskKey !== 'T-1');
    renderStandup(board);
    expect(screen.getByRole('button', { name: 'Finish standup' })).toBeDisabled();
    expect(screen.getByRole('status', { name: '' })).toHaveTextContent('Send or discard the drafts above to finish.');
    fireEvent.click(within(screen.getByRole('region', { name: 'Unsent task updates' })).getByRole('button', { name: /T-1/ }));
    expect(screen.getByRole('textbox')).toHaveValue('Keep this task update');
    expect(screen.getByLabelText('Add an update to T-1')).toBeInTheDocument();
    expect(within(screen.getByRole('dialog', { name: 'Draft for T-1' })).getByText('T-1 · Alice Smith')).toBeInTheDocument();
  });

  it('reuses the exact finish request after a lost response and refresh', async () => {
    mockApiPost.mockRejectedValueOnce(new Error('Lost response'));
    const first = renderStandup();
    fireEvent.keyDown(document.body, { key: 'w' });
    await act(async () => {});
    fireEvent.click(screen.getByRole('button', { name: 'Finish standup' }));
    await screen.findByText(/Finish was not acknowledged/);
    const request = mockApiPost.mock.calls[0]![1];
    first.unmount();
    renderStandup();
    fireEvent.click(screen.getByRole('button', { name: 'Retry finish' }));
    await waitFor(() => expect(mockOnClose).toHaveBeenCalled());
    expect(mockApiPost.mock.calls[1]![1]).toEqual(request);
  });

  it('retries only the archive after a saved round is refreshed', async () => {
    mockApiPost.mockImplementation((url) => url.startsWith('/notes') ? Promise.reject(new Error('Lost archive response')) : Promise.resolve({ session: { id: 1 }, followUps: [] }));
    const first = renderStandup();
    fireEvent.keyDown(document.body, { key: 'w' });
    await act(async () => {});
    fireEvent.click(screen.getByRole('button', { name: 'Finish standup' }));
    await screen.findByRole('heading', { name: 'Round saved' });
    await act(async () => {});
    const request = mockApiPost.mock.calls[1]![1];
    first.unmount();
    mockApiPost.mockResolvedValue({ session: { id: 1 }, followUps: [] });
    renderStandup();
    fireEvent.click(screen.getByRole('button', { name: 'Retry Notes archive' }));
    await waitFor(() => expect(mockOnClose).toHaveBeenCalled());
    expect(mockApiPost.mock.calls.filter(([url]) => url.includes('/standup/session'))).toHaveLength(1);
    expect(mockApiPost.mock.calls.at(-1)![1]).toEqual(request);
  });

  it('moves real task focus and leaves native button Enter unclaimed', async () => {
    renderStandup();
    // Opening lands on the first task, not the name.
    await waitFor(() => expect(taskRows()[0]).toHaveFocus());
    fireEvent.keyDown(document.activeElement!, { key: 'j' });
    await waitFor(() => expect(taskRows()[1]).toHaveFocus());
    const next = screen.getByRole('button', { name: 'Next developer' });
    next.focus();
    expect(fireEvent.keyDown(next, { key: 'Enter' })).toBe(true);
    expect(mockOnOpenTask).not.toHaveBeenCalled();
    fireEvent.click(next);
    await waitFor(() => expect(taskRows()[0]).toHaveFocus());
    expect(screen.getByRole('listbox', { name: "Bob Jones's tasks" })).toBeInTheDocument();
  });

  describe('landing on a person (docs: standup switch)', () => {
    const withCurrentLast = () => {
      const board = buildBoard();
      board.developers[1] = day({
        id: 2,
        developer: { accountId: 'dev-2', displayName: 'Bob Jones', isActive: true },
        tasks: [
          surfaceTask({ id: 4, taskKey: 'T-4', title: 'Planned first', ownerId: 'dev-2', status: 'open', position: 0 }),
          surfaceTask({ id: 5, taskKey: 'T-5', title: 'Blocked second', ownerId: 'dev-2', status: 'blocked', position: 1 }),
          surfaceTask({ id: 6, taskKey: 'T-6', title: 'In progress now', ownerId: 'dev-2', status: 'active', position: 2 }),
        ],
      });
      return board;
    };

    it('puts keyboard focus on the first task after ← / →, never on the name', async () => {
      renderStandup(withCurrentLast());
      await waitFor(() => expect(taskRows()[0]).toHaveFocus());
      fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' });
      await waitFor(() => expect(taskRows()[0]).toHaveFocus());
      expect(screen.getByRole('heading', { name: 'Bob Jones' })).not.toHaveFocus();
      expect(taskRows()[0]).toHaveAttribute('aria-selected', 'true');
      fireEvent.keyDown(document.activeElement!, { key: 'ArrowLeft' });
      await waitFor(() => expect(screen.getByRole('listbox', { name: "Alice Smith's tasks" })).toBeInTheDocument());
      await waitFor(() => expect(taskRows()[0]).toHaveFocus());
    });

    it('lists the current task first, then the rest in board order, and selects it on arrival', async () => {
      renderStandup(withCurrentLast());
      fireEvent.keyDown(document.body, { key: 'ArrowRight' });
      await waitFor(() => expect(screen.getByRole('listbox', { name: "Bob Jones's tasks" })).toBeInTheDocument());
      const rows = taskRows();
      expect(rows.map((row) => within(row).getByText(/^T-\d+$/).textContent)).toEqual(['T-6', 'T-4', 'T-5']);
      expect(within(rows[0]!).getByText('Current')).toBeInTheDocument();
      await waitFor(() => expect(rows[0]).toHaveFocus());
      // j walks the same order the screen shows.
      fireEvent.keyDown(document.activeElement!, { key: 'j' });
      await waitFor(() => expect(taskRows()[1]).toHaveFocus());
    });

    it('falls back to the name only when the person has no open task', async () => {
      const board = buildBoard();
      board.developers[1] = day({ id: 2, developer: { accountId: 'dev-2', displayName: 'Bob Jones', isActive: true }, tasks: [] });
      renderStandup(board);
      fireEvent.keyDown(document.body, { key: 'ArrowRight' });
      await waitFor(() => expect(screen.getByRole('heading', { name: 'Bob Jones' })).toHaveFocus());
    });
  });

  it('starts a new identity on a second round without carrying flags or drafts', async () => {
    const first = renderStandup();
    flagFocusedPerson();
    fireEvent.keyDown(document.body, { key: 'w' });
    await act(async () => {});
    fireEvent.click(screen.getByRole('button', { name: 'Finish standup' }));
    await waitFor(() => expect(mockOnClose).toHaveBeenCalled());
    const firstId = (mockApiPost.mock.calls[0]![1] as { requestId: string }).requestId;
    first.unmount();
    renderStandup();
    expect(screen.queryByText('Follow up at finish')).not.toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: 'w' });
    await act(async () => {});
    fireEvent.click(screen.getByRole('button', { name: 'Finish standup' }));
    await waitFor(() => expect(mockOnClose).toHaveBeenCalledTimes(2));
    const secondId = (mockApiPost.mock.calls[2]![1] as { requestId: string }).requestId;
    expect(secondId).not.toBe(firstId);
  });
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

  it('marks the manager\'s own row as You, and no one else', () => {
    const board = buildBoard();
    board.developers[0]!.developer = { ...board.developers[0]!.developer, isSelf: true };
    renderStandup(board);
    // The person header carries the tag, the rail names it for screen readers; Bob has neither.
    expect(screen.getAllByText('You').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByRole('option', { name: /Alice Smith \(you\)/ })).toBeInTheDocument();
    const bob = screen.getByRole('option', { name: /Bob Jones/ });
    expect(bob).not.toHaveAccessibleName(/you/i);
    expect(within(bob).queryByText('You')).toBeNull();
  });

  describe('switching people stays quick and steady (docs/standup switch)', () => {
    const empty: StandupFeedResponse = { entries: [], windowStart: '2026-03-06T09:00:00Z', windowHours: 24 };
    const threePeople = () => {
      const board = buildBoard();
      board.developers.push(day({
        id: 3,
        developer: { accountId: 'dev-3', displayName: 'Cara Diaz', isActive: true },
        tasks: [surfaceTask({ id: 5, taskKey: 'T-5', title: 'Cara task', ownerId: 'dev-3', position: 0 })],
      }));
      return board;
    };

    it('asks to preload everyone else, nearest first and next before previous, following the cursor', () => {
      const board = threePeople();
      renderStandup(board);
      expect(mockPrefetchFeeds).toHaveBeenLastCalledWith(['dev-2', 'dev-3'], true);
      fireEvent.keyDown(document.body, { key: 'ArrowRight' });
      expect(mockPrefetchFeeds).toHaveBeenLastCalledWith(['dev-3', 'dev-1'], true);
    });

    it('orders a larger team by distance from the person on screen', () => {
      const board = threePeople();
      for (const [index, name] of ['Dan', 'Eve'].entries()) {
        board.developers.push(day({ id: 10 + index, developer: { accountId: `dev-${4 + index}`, displayName: name, isActive: true }, tasks: [] }));
      }
      renderStandup(board);
      fireEvent.keyDown(document.body, { key: 'ArrowRight' });
      fireEvent.keyDown(document.body, { key: 'ArrowRight' });
      // On dev-3 of 5: dev-4 and dev-2 are one away, dev-5 and dev-1 two away.
      expect(mockPrefetchFeeds).toHaveBeenLastCalledWith(['dev-4', 'dev-2', 'dev-5', 'dev-1'], true);
    });

    it('keeps the Changes panel open while the next person\'s feed loads, with no pulsing skeleton', () => {
      feedFor = (id) => (id === 'dev-2' ? { data: undefined, isLoading: true, isError: false } : { data: mockFeed, isLoading: false, isError: false });
      renderStandup();
      expect(screen.getByRole('region', { name: 'Since last standup' })).toBeInTheDocument();
      fireEvent.keyDown(document.body, { key: 'ArrowRight' });
      // The tasks switch at once; the panel neither collapses nor shows a pulsing skeleton while waiting.
      expect(screen.getByRole('listbox', { name: "Bob Jones's tasks" })).toBeInTheDocument();
      const panel = screen.getByRole('region', { name: 'Since last standup' });
      expect(within(panel).getByLabelText('Loading feed')).toBeInTheDocument();
      expect(panel.querySelector('.animate-pulse')).toBeNull();
    });

    it('keeps the rail while the next feed loads when the previous person had no changes, then settles once', () => {
      let bob: ReturnType<NonNullable<typeof feedFor>> = { data: undefined, isLoading: true, isError: false };
      feedFor = (id) => (id === 'dev-2' ? bob : { data: empty, isLoading: false, isError: false });
      const view = renderStandup();
      // Alice has nothing: the panel is the slim rail.
      expect(screen.queryByRole('region', { name: 'Since last standup' })).not.toBeInTheDocument();
      fireEvent.keyDown(document.body, { key: 'ArrowRight' });
      // Bob is still loading: it must not pop open as a skeleton and collapse again.
      expect(screen.queryByRole('region', { name: 'Since last standup' })).not.toBeInTheDocument();
      expect(screen.queryByLabelText('Loading feed')).not.toBeInTheDocument();
      // His feed arrives with changes: the panel opens exactly once.
      bob = { data: mockFeed, isLoading: false, isError: false };
      view.rerender(
        <TestWrapper>
          <StandupMode date="2026-03-07" board={buildBoard()} onClose={mockOnClose} onOpenTask={mockOnOpenTask} />
        </TestWrapper>,
      );
      expect(screen.getByRole('region', { name: 'Since last standup' })).toBeInTheDocument();
    });

    it('shows a failed feed instead of hiding it behind the previous state', () => {
      feedFor = (id) => (id === 'dev-2' ? { data: undefined, isLoading: false, isError: true } : { data: empty, isLoading: false, isError: false });
      renderStandup();
      fireEvent.keyDown(document.body, { key: 'ArrowRight' });
      expect(screen.getByRole('alert')).toHaveTextContent('Feed unavailable');
    });

    it('swaps people without a slide or fade, as a fresh column that starts at the top', () => {
      renderStandup();
      fireEvent.keyDown(document.body, { key: 'ArrowRight' });
      const tasks = screen.getByRole('listbox', { name: "Bob Jones's tasks" });
      // Only the person column (up to <main>): the overlay itself fades in once, on open.
      for (let node: HTMLElement | null = tasks; node && node.tagName !== 'MAIN'; node = node.parentElement) {
        expect(node.getAttribute('style') ?? '').not.toMatch(/opacity|transform/);
      }
      // A fresh column per person: scroll starts at the top.
      expect(tasks.closest<HTMLElement>('[class*="overflow-y-auto"]')?.scrollTop ?? 0).toBe(0);
      expect(screen.getAllByText('Bob Jones').length).toBeGreaterThan(0);
    });
  });

  describe('opening (no flash while the round lock is being granted)', () => {
    afterEach(() => { Reflect.deleteProperty(navigator, 'locks'); });

    it('shows nothing while waiting for the lock, never the "another tab" message first', async () => {
      // A lock that someone else holds: the request never resolves.
      Object.defineProperty(navigator, 'locks', { value: { request: () => new Promise(() => undefined) }, configurable: true });
      renderStandup();
      expect(screen.queryByTestId('standup-mode')).not.toBeInTheDocument();
      expect(screen.queryByText(/open in another tab/)).not.toBeInTheDocument();
      // Only once the grace period passes is the other tab reported.
      await waitFor(() => expect(screen.getByText(/open in another tab/)).toBeInTheDocument(), { timeout: 2000 });
    });

    it('opens straight into the real screen when the lock is granted', async () => {
      Object.defineProperty(navigator, 'locks', {
        value: { request: (_name: string, _options: unknown, callback: () => Promise<void>) => { setTimeout(() => void callback(), 0); return new Promise(() => undefined); } },
        configurable: true,
      });
      renderStandup();
      expect(screen.queryByText(/open in another tab/)).not.toBeInTheDocument();
      await waitFor(() => expect(screen.getByTestId('standup-progress')).toBeInTheDocument());
      expect(screen.queryByText(/open in another tab/)).not.toBeInTheDocument();
    });
  });

  it('marks the selected task with a soft tint and a left accent bar, not a ring around the whole row', async () => {
    renderStandup();
    await waitFor(() => expect(taskRows()[0]).toHaveFocus());
    const [selected, other] = [taskRows()[0]!, taskRows()[1]!];
    expect(selected).toHaveAttribute('aria-selected', 'true');
    expect(selected.style.boxShadow).toMatch(/inset 3px 0px? 0px? (?:0px )?var\(--accent\)|inset 3px 0 0 var\(--accent\)/);
    expect(selected.style.background).toContain('var(--accent) 8%');
    // Unselected rows carry neither; and no row opts back in to the focus-visible ring utility.
    expect(other.style.boxShadow).toBe('');
    for (const row of taskRows()) {
      expect(row.className).toContain('standup-task-row');
      expect(row.className).not.toContain('focus-visible:shadow');
    }
  });

  it('the shell drops the cyan focus ring for selectable rows and text fields, and keeps it for buttons and links', () => {
    const css = readFileSync(resolve(__dirname, '../components/team-tracker/standup/standup.css'), 'utf8');
    expect(css).toMatch(/\.standup-shell \[role='option'\]:focus-visible \{\s*outline: none;/);
    expect(css).toMatch(/\.standup-shell textarea:focus-visible \{\s*outline: none;/);
    expect(css).toMatch(/\.standup-shell input:focus-visible,\s*\.standup-shell select:focus-visible \{\s*outline: none;/);
    // Everything else in standup (buttons, links) keeps the visible ring.
    expect(css).toMatch(/\.standup-shell :focus-visible \{\s*outline: 2px solid var\(--accent\)/);
  });

  it('keeps 1:1 reminders out of standup', () => {
    const board = buildBoard();
    board.developers[0]!.oneOnOne = { seriesId: 5, scheduledFor: '2026-03-07', overdueDays: 0 };
    board.developers[1]!.oneOnOne = { seriesId: 6, scheduledFor: '2026-03-04', overdueDays: 3 };
    render(
      <TestWrapper>
        <StandupMode date="2026-03-07" board={board} onClose={mockOnClose} onOpenTask={mockOnOpenTask} />
      </TestWrapper>,
    );
    expect(screen.queryByText('1:1 today')).not.toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: 'ArrowRight' });
    expect(screen.queryByText('1:1 overdue 3d')).not.toBeInTheDocument();
  });

  it.each([
    ['ArrowRight', 1],
  ])('moves to the next developer with %s', (key, expectedIndex) => {
    renderStandup();
    fireEvent.keyDown(document.body, { key });
    expect(screen.getByText('Bob task')).toBeInTheDocument();
    const rail = screen.getByRole('listbox', { name: 'Standup order' });
    const railOptions = within(rail).getAllByRole('option');
    expect(railOptions[expectedIndex]).toHaveAttribute('aria-selected', 'true');
  });

  it('moves back with ArrowLeft', () => {
    renderStandup();
    fireEvent.keyDown(document.body, { key: 'ArrowRight' });
    fireEvent.keyDown(document.body, { key: 'ArrowLeft' });
    const rail = screen.getByRole('listbox', { name: 'Standup order' });
    expect(within(rail).getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(document.body, { key: 'ArrowRight' });
    fireEvent.keyDown(document.body, { key: 'ArrowLeft' });
    expect(within(rail).getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true');
  });

  it('clicking a task row selects it without opening the task drawer', () => {
    renderStandup();
    fireEvent.click(taskRows()[1]!);
    expect(mockOnOpenTask).not.toHaveBeenCalled();
    expect(taskRows()[1]).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(document.body, { key: 'u' });
    expect(screen.getByLabelText('Add an update to T-2')).toBeInTheDocument();
  });

  it('double-clicking a task row opens the selected task drawer once', () => {
    renderStandup();
    const row = taskRows()[1]!;
    fireEvent.click(row);
    fireEvent.click(row);
    fireEvent.doubleClick(row);
    expect(mockOnOpenTask).toHaveBeenCalledExactlyOnceWith('T-2');
    expect(row).toHaveAttribute('aria-selected', 'true');
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
      expect(within(history).getByText(/Ended .*· 2 visited · 1 flagged/)).toBeInTheDocument();
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

  it('. sets the focused task current, e marks it done', () => {
    renderStandup();
    fireEvent.keyDown(document.body, { key: '.' });
    expect(mockSetCurrentMutate).toHaveBeenCalledWith('T-1', expect.anything());
    fireEvent.keyDown(document.body, { key: 'e' });
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

  it('a opens the capture box with the developer as assignee', async () => {
    renderStandup();
    fireEvent.keyDown(document.body, { key: 'n' });
    expect(screen.getByTestId('capture-box')).toHaveAttribute('data-assignee', 'dev-1');
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

  it('solo: c opens a note layer that still saves through the check-in mutation (P1-04)', () => {
    teamModeMock.mode = 'solo';
    renderStandup();
    fireEvent.keyDown(document.body, { key: 'c' });
    expect(screen.getByRole('dialog', { name: 'Note for Alice Smith' })).toBeInTheDocument();
    const input = screen.getByPlaceholderText(/Add a note/);
    expect(screen.getByRole('button', { name: 'Save note' })).toBeDisabled();
    fireEvent.change(input, { target: { value: 'Talked through the migration' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(mockAddCheckInMutate).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: 'dev-1', summary: 'Talked through the migration' }),
      expect.anything(),
    );
  });

  it('solo: the action bar and the help sheet say "Note", and "New task for this person" (P1-04)', () => {
    teamModeMock.mode = 'solo';
    renderStandup();
    const bar = screen.getByTestId('standup-action-bar');
    expect(within(bar).getByRole('button', { name: /Note/ })).toBeInTheDocument();
    expect(within(bar).queryByRole('button', { name: /Check-in/ })).not.toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: '?' });
    expect(screen.getByText('Add a note')).toBeInTheDocument();
    expect(screen.getByText('New task for this person')).toBeInTheDocument();
    expect(screen.queryByText(/@dev/)).not.toBeInTheDocument();
  });

  it('r opens the reassign layer and reassigns the focused task', () => {
    renderStandup();
    fireEvent.keyDown(document.body, { key: 'a' });
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

  it('ignores Escape claimed by a higher layer and exits on the next Escape', () => {
    renderStandup();
    const claimEscape = (event: KeyboardEvent) => event.preventDefault();
    document.addEventListener('keydown', claimEscape, { once: true });

    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(mockOnClose).not.toHaveBeenCalled();
    expect(screen.getByTestId('standup-mode')).toBeInTheDocument();

    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(mockOnClose).toHaveBeenCalledTimes(1);
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

    it('keeps person status and work without a repeated metric strip', () => {
      renderStandup();
      expect(screen.queryByTestId('standup-day-strip')).not.toBeInTheDocument();
      expect(screen.getByLabelText('Set developer status')).toBeInTheDocument();
      expect(screen.getByText('No developer check-in today')).toBeInTheDocument();
    });

    it('solo: the day strip shows "Last touched" instead of "None today" (P1-04)', () => {
      teamModeMock.mode = 'solo';
      const board = buildBoard();
      board.developers[0] = day({
        ...board.developers[0]!,
        participates: false,
        signals: signals({ lastManagerTouchAt: '2026-03-05T09:00:00Z' }),
      });
      renderStandup(board);
      expect(screen.getByText(/Last touched:/)).toBeInTheDocument();
      expect(screen.queryByText('No developer check-in today')).not.toBeInTheDocument();
    });

    it('solo: the wrap-up counts notes and never lists "No check-in today" (P1-04)', () => {
      teamModeMock.mode = 'solo';
      renderStandup();
      fireEvent.keyDown(document.body, { key: 'w' });
      const wrapUp = screen.getByTestId('standup-wrapup');
      expect(within(wrapUp).queryByText('Notes')).not.toBeInTheDocument();
      expect(within(wrapUp).queryByText('Check-ins')).not.toBeInTheDocument();
      expect(within(wrapUp).queryByText('No check-in today')).not.toBeInTheDocument();
    });

    it('marks a developer reviewed on moving past them and tracks progress', () => {
      renderStandup();
      expect(screen.getByTestId('standup-progress')).toHaveTextContent('0 of 2 visited');
      fireEvent.keyDown(document.body, { key: 'ArrowRight' });
      expect(screen.getByTestId('standup-progress')).toHaveTextContent('1 of 2 visited');
      expect(rail()[0]).toHaveAccessibleName('Alice Smith, visited, not saved');
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
      expect(rail()[0]).toHaveAccessibleName('Alice Smith, visited, not saved');
      expect(rail()[1]).toHaveAccessibleName('Bob Jones');
      expect(rail()[2]).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByTestId('standup-progress')).toHaveTextContent('1 of 3 visited');
    });

    it('opens the wrap-up past the last developer; ← returns and Enter ends', async () => {
      renderStandup();
      fireEvent.keyDown(document.body, { key: 'ArrowRight' });
      fireEvent.keyDown(document.body, { key: 'ArrowRight' });
      const wrapUp = screen.getByTestId('standup-wrapup');
      expect(within(wrapUp).getByText('2 of 2 people visited')).toBeInTheDocument();
      fireEvent.keyDown(document.body, { key: 'ArrowLeft' });
      expect(screen.queryByTestId('standup-wrapup')).not.toBeInTheDocument();
      expect(screen.getByRole('listbox', { name: "Bob Jones's tasks" })).toBeInTheDocument();
      fireEvent.keyDown(document.body, { key: 'w' });
      await act(async () => {});
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
      flagFocusedPerson();                                   // flag Alice (no reason)
      fireEvent.keyDown(document.body, { key: 'ArrowRight' });        // review Alice → Bob
      fireEvent.keyDown(document.body, { key: 'w' });        // wrap-up (Bob auto-reviewed on entry)
      await act(async () => {});
      fireEvent.click(within(screen.getByTestId('standup-wrapup')).getByRole('button', { name: /Finish standup/ }));
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

    it('files the summary as a standup note by default and says what Finish does', async () => {
      renderStandup();
      fireEvent.keyDown(document.body, { key: 'w' });  // wrap-up (auto-reviews Alice → non-empty session)
      const wrapUp = screen.getByTestId('standup-wrapup');
      expect(within(wrapUp).getByRole('checkbox', { name: /Add summary to Notes/ })).toBeChecked();
      expect(within(wrapUp).getByText(/Finish saves this round, and adds a summary to Notes → Standups/)).toBeInTheDocument();
      expect(within(wrapUp).getByRole('button', { name: 'Copy summary' })).toHaveTextContent('Copy summary');

      await act(async () => {});
      fireEvent.click(within(wrapUp).getByRole('button', { name: /Finish standup/ }));
      await waitFor(() => expect(mockOnClose).toHaveBeenCalled());
      const appendCall = mockApiPost.mock.calls.find(([url]) => String(url) === '/notes/2026-03-07/append');
      expect(appendCall).toBeTruthy();
      expect((appendCall![1] as { kind?: string }).kind).toBe('standup');
      expect((appendCall![1] as { requestId?: string }).requestId).toBeTruthy();
    });

    it('skips the Notes archive when the summary option is unticked', async () => {
      renderStandup();
      fireEvent.keyDown(document.body, { key: 'w' });
      const wrapUp = screen.getByTestId('standup-wrapup');
      fireEvent.click(within(wrapUp).getByRole('checkbox', { name: /Add summary to Notes/ }));
      expect(within(wrapUp).getByText(/^Finish saves this round\.$/)).toBeInTheDocument();
      await act(async () => {});
      fireEvent.click(within(wrapUp).getByRole('button', { name: /Finish standup/ }));
      await waitFor(() => expect(mockOnClose).toHaveBeenCalled());
      expect(mockApiPost.mock.calls.some(([url]) => String(url).startsWith('/notes'))).toBe(false);
      expect(mockApiPost.mock.calls.some(([url]) => String(url) === '/team-tracker/standup/session')).toBe(true);
    });

    it('retries an unacknowledged archive without sealing the round again', async () => {
      mockApiPost.mockImplementation((url) => url.startsWith('/notes')
        ? Promise.reject(new Error('offline')) : Promise.resolve({ session: { id: 1 }, followUps: [] }));
      renderStandup();
      fireEvent.keyDown(document.body, { key: 'w' });
      const wrapUp = screen.getByTestId('standup-wrapup');
      await act(async () => {});
      fireEvent.click(within(wrapUp).getByRole('button', { name: /Finish standup/ }));
      expect(await screen.findByText(/Round saved. The Notes archive/)).toBeInTheDocument();
      expect(mockOnClose).not.toHaveBeenCalled();
      mockApiPost.mockResolvedValue({ session: { id: 1 }, followUps: [] });
      fireEvent.click(within(wrapUp).getByRole('button', { name: /Retry Notes archive/ }));
      await waitFor(() => expect(mockOnClose).toHaveBeenCalled());
      const urls = mockApiPost.mock.calls.map(([url]) => String(url));
      expect(urls.filter((url) => url === '/team-tracker/standup/session')).toHaveLength(1);
      const archives = mockApiPost.mock.calls.filter(([url]) => url.startsWith('/notes'));
      expect(archives).toHaveLength(2);
      expect(archives[0]![1]).toEqual(archives[1]![1]);
      expect(mockAddToast).toHaveBeenCalledWith(expect.stringContaining('Standup recorded'), 'success');
    });

    it('keeps the wrap-up open and reports the error when sealing fails', async () => {
      mockApiPost.mockRejectedValueOnce(new Error('offline'));
      renderStandup();
      fireEvent.keyDown(document.body, { key: 'w' });  // reviews Alice via wrap-up entry → non-empty session
      await act(async () => {});
      fireEvent.click(within(screen.getByTestId('standup-wrapup')).getByRole('button', { name: /Finish standup/ }));
      await waitFor(() => expect(mockAddToast).toHaveBeenCalledWith('offline', 'error'));
      expect(mockOnClose).not.toHaveBeenCalled();
      expect(screen.getByTestId('standup-wrapup')).toBeInTheDocument();
    });

    it('Esc exits without sealing — the session stays resumable', () => {
      renderStandup();
      fireEvent.keyDown(document.body, { key: 'ArrowRight' });  // review Alice
      fireEvent.keyDown(document.body, { key: 'Escape' });
      expect(mockOnClose).toHaveBeenCalledTimes(1);
      expect(mockApiPost.mock.calls.some(([url]) => String(url) === '/team-tracker/standup/session')).toBe(false);
      // Progress persisted for resume.
      expect(window.sessionStorage.length).toBeGreaterThan(0);
    });

    it('f flags for follow-up and logged actions appear in the wrap-up', () => {
      renderStandup();
      flagFocusedPerson();
      expect(screen.getByText('Follow up at finish')).toBeInTheDocument();
      fireEvent.keyDown(document.body, { key: 'e' });
      fireEvent.keyDown(document.body, { key: 'w' });
      const wrapUp = screen.getByTestId('standup-wrapup');
      expect(within(wrapUp).getByText('1 of 2 people visited')).toBeInTheDocument();
      const aliceFollowUp = within(wrapUp).getAllByRole('button', { name: 'Go to Alice Smith' })[0]!;
      expect(aliceFollowUp).toHaveTextContent('Alice Smith');
      expect(within(wrapUp).queryByText('Closed T-1')).not.toBeInTheDocument();
      // Jumping from "Not reviewed" lands on Bob.
      fireEvent.click(within(wrapUp).getByRole('button', { name: 'Go to Bob Jones' }));
      expect(screen.getByRole('listbox', { name: "Bob Jones's tasks" })).toBeInTheDocument();
    });

    describe('docs/56 P1-07: manager-owned standup follow-through', () => {
      it.each(['click', 'keyboard'])('shows the visited tick after saving a %s navigation', async (navigation) => {
        let acknowledge!: () => void;
        mockRecordReviewsMutate.mockImplementationOnce((body, options) => {
          acknowledge = () => options?.onSuccess?.({ recorded: body.accountIds });
        });
        renderStandup();
        const roster = within(screen.getByRole('listbox', { name: 'Standup order' }));
        if (navigation === 'click') fireEvent.click(roster.getByRole('option', { name: 'Bob Jones' }));
        else fireEvent.keyDown(document.body, { key: 'ArrowRight' });

        const alice = roster.getByRole('option', { name: 'Alice Smith, visited, not saved' });
        expect(alice.querySelector('.lucide-check')).not.toBeInTheDocument();
        await act(async () => acknowledge());
        expect(alice).toHaveAccessibleName('Alice Smith, visited');
        expect(alice.querySelector('.lucide-check')).toBeInTheDocument();
        expect(screen.queryByTestId('standup-saving')).not.toBeInTheDocument();
        expect(screen.queryByText(/Visits not saved/)).not.toBeInTheDocument();
      });

      it('acknowledges a failed visit using Retry without refreshing or losing the current person', async () => {
        mockRecordReviewsMutate.mockImplementationOnce((_body, options) => options?.onError?.());
        renderStandup();
        fireEvent.keyDown(document.body, { key: 'ArrowRight' });
        await screen.findByText(/Visits not saved/);
        const request = mockRecordReviewsMutate.mock.calls[0]![0];
        fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
        await waitFor(() => expect(screen.queryByText(/Visits not saved/)).not.toBeInTheDocument());
        expect(mockRecordReviewsMutate).toHaveBeenLastCalledWith(request, expect.anything());
        const roster = within(screen.getByRole('listbox', { name: 'Standup order' }));
        expect(roster.getByRole('option', { name: 'Alice Smith, visited' }).querySelector('.lucide-check')).toBeInTheDocument();
        expect(roster.getByRole('option', { name: 'Bob Jones' })).toHaveAttribute('aria-selected', 'true');
      });

      it('records a review as a manager touch the moment someone is reviewed, without sealing', async () => {
        renderStandup();
        expect(mockRecordReviewsMutate).not.toHaveBeenCalled();
        fireEvent.keyDown(document.body, { key: 'ArrowRight' });   // leaving Alice reviews her
        expect(mockRecordReviewsMutate).toHaveBeenCalledTimes(1);
        expect(mockRecordReviewsMutate).toHaveBeenLastCalledWith(expect.objectContaining({ date: '2026-03-07', accountIds: ['dev-1'] }), expect.anything());
        await act(async () => {});
        fireEvent.keyDown(document.body, { key: 'w' });            // entering wrap-up reviews Bob
        expect(mockRecordReviewsMutate).toHaveBeenCalledTimes(2);
        expect(mockRecordReviewsMutate).toHaveBeenLastCalledWith(expect.objectContaining({ date: '2026-03-07', accountIds: ['dev-2'] }), expect.anything());
        expect(mockApiPost.mock.calls.some(([url]) => String(url) === '/team-tracker/standup/session')).toBe(false);
      });

      it('a logged write counts as reviewing that person too', () => {
        renderStandup();
        fireEvent.keyDown(document.body, { key: 'e' });            // done on T-1 → logs for Alice
        expect(mockRecordReviewsMutate).toHaveBeenCalledWith(expect.objectContaining({ date: '2026-03-07', accountIds: ['dev-1'] }), expect.anything());
      });

      it('does not re-send acknowledged reviews of a resumed round', async () => {
        const first = renderStandup();
        fireEvent.keyDown(document.body, { key: 'ArrowRight' });
        await act(async () => {});
        first.unmount();
        mockRecordReviewsMutate.mockClear();
        renderStandup();
        expect(mockRecordReviewsMutate).not.toHaveBeenCalled();
        fireEvent.keyDown(document.body, { key: 'w' });            // Bob is new
        expect(mockRecordReviewsMutate).toHaveBeenCalledTimes(1);
        expect(mockRecordReviewsMutate).toHaveBeenCalledWith(expect.objectContaining({ date: '2026-03-07', accountIds: ['dev-2'] }), expect.anything());
      });

      it('shows a pending visit save inline in the top bar, never as a banner that pushes the page down', () => {
        mockRecordReviewsMutate.mockImplementationOnce(() => undefined);   // the server has not answered yet
        renderStandup();
        fireEvent.keyDown(document.body, { key: 'ArrowRight' });
        expect(screen.getByTestId('standup-saving')).toHaveTextContent('saving');
        expect(screen.queryByText(/Saving visits/)).not.toBeInTheDocument();
        // Nothing sits between the top bar and the body: the body starts where it always does.
        const header = screen.getByTestId('standup-mode').querySelector('header')!;
        expect(header.nextElementSibling?.getAttribute('role')).not.toBe('status');
        expect(header.nextElementSibling?.className).toContain('flex min-h-0 flex-1');
      });

      it('retries a failed review after refresh without another visit', async () => {
        mockRecordReviewsMutate.mockImplementationOnce((_body, options) => options?.onError?.());
        const first = renderStandup();
        fireEvent.keyDown(document.body, { key: 'ArrowRight' });   // Alice: fails
        await act(async () => {});
        expect(screen.getByText(/Visits not saved/)).toBeInTheDocument();
        const request = mockRecordReviewsMutate.mock.calls[0]![0];
        first.unmount();
        renderStandup();
        await act(async () => {});
        expect(mockRecordReviewsMutate).toHaveBeenLastCalledWith(request, expect.anything());
        expect(screen.queryByText(/Visits not saved/)).not.toBeInTheDocument();
      });

      it('refreshes the board and Today once when standup closes after recording reviews', () => {
        const invalidate = vi.spyOn(QueryClient.prototype, 'invalidateQueries');
        const view = renderStandup();
        fireEvent.keyDown(document.body, { key: 'ArrowRight' });
        expect(invalidate).not.toHaveBeenCalled();                 // never mid-round: the order is walked by index
        view.unmount();
        const keys = invalidate.mock.calls.map(([filters]) => (filters as { queryKey: string[] }).queryKey[0]);
        expect(keys).toEqual(['team-tracker', 'today']);
        invalidate.mockRestore();
      });

      it('f flags immediately and exposes an optional inline reason', () => {
        renderStandup();
        fireEvent.keyDown(document.body, { key: 'f' });
        expect(screen.queryByRole('dialog', { name: 'Flag Alice Smith for follow-up' })).not.toBeInTheDocument();
        const input = screen.getByLabelText(/Why follow up with Alice Smith/);
        expect(input).toHaveAttribute('maxlength', '200');
        fireEvent.change(input, { target: { value: '  Waiting on   design review ' } });
        fireEvent.keyDown(input, { key: 'Enter' });
        expect(screen.queryByRole('dialog', { name: /Flag Alice Smith/ })).not.toBeInTheDocument();
        expect(screen.getByText('Follow up at finish')).toBeInTheDocument();

        fireEvent.keyDown(document.body, { key: 'w' });
        const wrapUp = screen.getByTestId('standup-wrapup');
        expect(within(wrapUp).getByText(/Waiting on design review/)).toBeInTheDocument();
      });

      it('Esc leaves an optional reason without discarding the flag', () => {
        renderStandup();
        fireEvent.keyDown(document.body, { key: 'f' });
        fireEvent.keyDown(screen.getByLabelText(/Why follow up with/), { key: 'Escape' });
        expect(screen.getByText('Follow up at finish')).toBeInTheDocument();
        expect(mockOnClose).not.toHaveBeenCalled();
      });

      it('f on a flagged person unflags immediately and drops the reason', async () => {
        renderStandup();
        flagFocusedPerson('Waiting on QA');
        fireEvent.keyDown(document.body, { key: 'f' });
        expect(screen.queryByRole('dialog', { name: /Flag Alice Smith/ })).not.toBeInTheDocument();
        expect(screen.queryByText('Follow up at finish')).not.toBeInTheDocument();

        fireEvent.keyDown(document.body, { key: 'w' });
        await act(async () => {});
        fireEvent.click(within(screen.getByTestId('standup-wrapup')).getByRole('button', { name: /Finish standup/ }));
        await waitFor(() => expect(mockOnClose).toHaveBeenCalled());
        const body = mockApiPost.mock.calls.find(([url]) => String(url) === '/team-tracker/standup/session')![1] as { flagged: string[]; flagReasons?: unknown };
        expect(body.flagged).toEqual([]);
        expect(body.flagReasons).toBeUndefined();
      });

      it('seals with the reason, and the summary carries it', async () => {
        renderStandup();
        flagFocusedPerson('Waiting on design review');
        fireEvent.keyDown(document.body, { key: 'w' });
        await act(async () => {});
        fireEvent.click(within(screen.getByTestId('standup-wrapup')).getByRole('button', { name: /Finish standup/ }));
        await waitFor(() => expect(mockOnClose).toHaveBeenCalled());
        const body = mockApiPost.mock.calls.find(([url]) => String(url) === '/team-tracker/standup/session')![1] as { flagged: string[]; flagReasons: Record<string, string>; summary: string };
        expect(body.flagged).toEqual(['dev-1']);
        expect(body.flagReasons).toEqual({ 'dev-1': 'Waiting on design review' });
        expect(body.summary).toContain('Alice Smith: Flagged: Waiting on design review');
      });

      it('the previous-round recall shows each flagged person\'s reason', () => {
        mockLastSession = {
          id: 3,
          date: '2026-03-06',
          startedAt: '2026-03-06T09:00:00Z',
          endedAt: '2026-03-06T09:20:00Z',
          reviewed: ['dev-1', 'dev-2'],
          flagged: ['dev-1'],
          flagReasons: { 'dev-1': 'Waiting on design review' },
          summary: 'Standup',
          createdAt: '2026-03-06T09:20:00Z',
          log: [],
        };
        try {
          renderStandup();
          fireEvent.click(screen.getByRole('button', { name: 'Previous standup round' }));
          expect(within(screen.getByTestId('standup-history')).getByText('Alice Smith: Waiting on design review')).toBeInTheDocument();
        } finally {
          mockLastSession = null;
        }
      });

      it('the feed collapses to a rail with its count, and the choice is remembered', () => {
        const first = renderStandup();
        expect(screen.getByRole('region', { name: 'Since last standup' })).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Hide feed' }));
        expect(screen.queryByRole('region', { name: 'Since last standup' })).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: /^Show feed \(\d+ since last standup\)$/ })).toBeInTheDocument();
        // The tasks stay put.
        expect(screen.getByRole('listbox', { name: "Alice Smith's tasks" })).toBeInTheDocument();

        first.unmount();
        renderStandup();
        expect(screen.queryByRole('region', { name: 'Since last standup' })).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /^Show feed/ }));
        expect(screen.getByRole('region', { name: 'Since last standup' })).toBeInTheDocument();
        expect(screen.getByText('Wrapped the retry path')).toBeInTheDocument();
      });
    });

    it('resumes at the first unreviewed developer after reopening', () => {
      const first = renderStandup();
      fireEvent.keyDown(document.body, { key: 'ArrowRight' });
      first.unmount();
      renderStandup();
      expect(screen.getByTestId('standup-progress')).toHaveTextContent('1 of 2 visited');
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
        fireEvent.click(screen.getAllByRole('button', { name: 'Open T-3' })[0]!);
        expect(mockOnOpenTask).toHaveBeenCalledWith('T-3');
      } finally {
        mockFeed = previous;
      }
    });

    it('the footer shows the handful of shortcuts a standup uses all the time, and no more', () => {
      renderStandup();
      const bar = screen.getByTestId('standup-action-bar');
      const chips = within(bar).getAllByRole('button').map((button) => button.getAttribute('title'));
      expect(chips).toEqual([
        'Previous (←)', 'Next (→)', 'Note (c)', 'Flag (f)',
        'Current (.)', 'Done (e)', 'Blocked (b)', 'Update (u)',
      ]);
    });

    it('the Current, Done and Blocked chips run what . e and b run', () => {
      renderStandup();
      const bar = () => screen.getByTestId('standup-action-bar');
      // Alice's first task is already current, so there is nothing to make current.
      expect(within(bar()).getByRole('button', { name: /Current/ })).toBeDisabled();
      fireEvent.keyDown(document.body, { key: 'j' });
      expect(within(bar()).getByRole('button', { name: /Current/ })).toBeEnabled();
      fireEvent.click(within(bar()).getByRole('button', { name: /Current/ }));
      expect(mockSetCurrentMutate).toHaveBeenCalledWith('T-2', expect.anything());
      fireEvent.click(within(bar()).getByRole('button', { name: /Done/ }));
      expect(mockUpdateTaskMutate).toHaveBeenCalledWith({ status: 'done' }, expect.anything());
      fireEvent.click(within(bar()).getByRole('button', { name: /Blocked/ }));
      expect(screen.getByRole('dialog', { name: /Alice Smith/ })).toBeInTheDocument();
    });

    it('action bar chips run the same handlers as keys', () => {
      renderStandup();
      const bar = screen.getByTestId('standup-action-bar');
      fireEvent.click(within(bar).getByRole('button', { name: /Flag/ }));
      expect(screen.getByText('Follow up at finish')).toBeInTheDocument();
      fireEvent.click(within(bar).getByRole('button', { name: /Note/ }));
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
      fireEvent.keyDown(document.body, { key: 'ArrowRight' });
      const empty = screen.getByText('No open tasks').parentElement!;
      fireEvent.click(within(empty).getByRole('button', { name: /Add task/ }));
      expect(screen.getByTestId('capture-box')).toHaveAttribute('data-assignee', 'dev-2');
    });
  });

  it('ignores plain keys while a text field holds focus', () => {
    renderStandup();
    fireEvent.keyDown(document.body, { key: 'c' });
    const input = screen.getByPlaceholderText(/General remark/);
    input.focus();
    fireEvent.keyDown(input, { key: 'n' });
    // Still on dev-1 — n typed into the field, not handled as a key.
    const rail = screen.getByRole('listbox', { name: 'Standup order' });
    expect(within(rail).getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true');
  });
});
