import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { TestWrapper } from '@/test/wrapper';
import type { TeamTrackerBoardResponse, TrackerDeveloperDay, Issue, TrackerIssueAssignment, TrackerCarryForwardContextResponse, TrackerCarryForwardPreviewResponse } from '@/types';
import type { ManagerDeskDayResponse } from '@/types/manager-desk';
import { formatAbsoluteDateTime } from '@/lib/utils';

const mockCarryForwardMutate = vi.fn();
const mockUpdateDayMutate = vi.fn();
const mockUpdateAvailabilityMutate = vi.fn();
const mockUpdateTrackerItemMutate = vi.fn();
const mockSetCurrentMutate = vi.fn();
const mockAddToast = vi.fn();
const mockCreateManagerDeskItemMutate = vi.fn();
const mockUpdateManagerDeskItemMutate = vi.fn();
const mockAddTrackerItemMutate = vi.fn();
const mockRefetchBoard = vi.fn();
const mockRefetchCarryForwardPreview = vi.fn();
const mockRefetchCarryForwardContext = vi.fn();
let mockCarryForwardPreviewValue: TrackerCarryForwardPreviewResponse | undefined;
let mockCarryForwardContextValue: TrackerCarryForwardContextResponse | undefined;
let mockIssues: Issue[] = [];
let mockTrackerIssueAssignments: TrackerIssueAssignment[] = [];
let mockManagerDeskDay: ManagerDeskDayResponse;

function buildSignals(overrides?: {
  freshness?: Partial<TrackerDeveloperDay['signals']['freshness']>;
  risk?: Partial<TrackerDeveloperDay['signals']['risk']>;
}): TrackerDeveloperDay['signals'] {
  return {
    freshness: {
      staleThresholdHours: 4,
      noCurrentThresholdHours: 2,
      statusFollowUpThresholdHours: 2,
      staleByTime: false,
      staleWithOpenRisk: false,
      staleWithoutCurrentWork: false,
      statusChangeWithoutFollowUp: false,
      ...overrides?.freshness,
    },
    risk: {
      openRisk: false,
      overdueLinkedWork: false,
      overdueLinkedCount: 0,
      overCapacity: false,
      capacityDelta: 0,
      ...overrides?.risk,
    },
  };
}

const mockDay: (overrides?: Partial<TrackerDeveloperDay>) => TrackerDeveloperDay = (overrides = {}) => ({
  id: 1,
  date: '2026-03-07',
  developer: { accountId: 'dev-1', displayName: 'Alice Smith', isActive: true },
  availability: { state: 'active' },
  status: 'on_track',
  plannedItems: [],
  completedItems: [],
  droppedItems: [],
  checkIns: [],
  isStale: false,
  signals: buildSignals(),
  statusUpdatedAt: '2026-03-07T08:00:00Z',
  createdAt: '2026-03-07T08:00:00Z',
  updatedAt: '2026-03-07T08:00:00Z',
  ...overrides,
});

function buildMockBoard(): TeamTrackerBoardResponse {
  return {
    date: '2026-03-07',
    viewMode: 'live',
    developers: [
      mockDay(),
      mockDay({
        id: 2,
        developer: { accountId: 'dev-2', displayName: 'Bob Jones', isActive: true },
        status: 'blocked',
        capacityUnits: 2,
        isStale: true,
        lastCheckInAt: '2026-03-07T07:00:00Z',
        statusUpdatedAt: '2026-03-07T08:30:00Z',
        signals: buildSignals({
          freshness: {
            staleByTime: true,
            staleWithOpenRisk: true,
            statusChangeWithoutFollowUp: true,
            hoursSinceCheckIn: 5,
            hoursSinceStatusChange: 3.5,
          },
          risk: {
            openRisk: true,
            overdueLinkedWork: true,
            overdueLinkedCount: 1,
            overCapacity: true,
            capacityDelta: 1,
          },
        }),
        currentItem: {
          id: 10,
          dayId: 2,
          managerDeskItemId: 110,
          lifecycle: 'manager_desk_linked',
          itemType: 'jira',
          jiraKey: 'AM-123',
          jiraPriorityName: 'High',
          jiraDueDate: '2026-03-06',
          title: 'Fix login bug',
          state: 'in_progress',
          position: 0,
          createdAt: '2026-03-07T08:00:00Z',
          updatedAt: '2026-03-07T08:00:00Z',
        },
        plannedItems: [
          {
            id: 11,
            dayId: 2,
            managerDeskItemId: 111,
            lifecycle: 'manager_desk_linked',
            itemType: 'custom',
            title: 'Code review',
            state: 'planned',
            position: 1,
            createdAt: '2026-03-07T08:00:00Z',
            updatedAt: '2026-03-07T08:00:00Z',
          },
          {
            id: 12,
            dayId: 2,
            managerDeskItemId: 112,
            lifecycle: 'manager_desk_linked',
            itemType: 'custom',
            title: 'Follow up with QA',
            state: 'planned',
            position: 2,
            createdAt: '2026-03-07T08:00:00Z',
            updatedAt: '2026-03-07T08:00:00Z',
          },
          {
            id: 13,
            dayId: 2,
            lifecycle: 'tracker_only',
            itemType: 'custom',
            title: 'Refactor utils',
            state: 'planned',
            position: 3,
            createdAt: '2026-03-07T08:00:00Z',
            updatedAt: '2026-03-07T08:00:00Z',
          },
        ],
      }),
    ],
    inactiveDevelopers: [],
    summary: {
      total: 2,
      stale: 1,
      blocked: 1,
      atRisk: 0,
      waiting: 0,
      noCurrent: 1,
      overdueLinkedWork: 1,
      overCapacity: 1,
      statusFollowUp: 1,
      doneForToday: 0,
    },
    visibleSummary: {
      total: 2,
      stale: 1,
      blocked: 1,
      atRisk: 0,
      waiting: 0,
      noCurrent: 1,
      overdueLinkedWork: 1,
      overCapacity: 1,
      statusFollowUp: 1,
      doneForToday: 0,
    },
    groups: [
      {
        key: 'all',
        label: 'All Developers',
        count: 2,
        developers: [mockDay(), mockDay({
          id: 2,
          developer: { accountId: 'dev-2', displayName: 'Bob Jones', isActive: true },
          status: 'blocked',
          capacityUnits: 2,
          isStale: true,
          lastCheckInAt: '2026-03-07T07:00:00Z',
          statusUpdatedAt: '2026-03-07T08:30:00Z',
          signals: buildSignals({
            freshness: {
              staleByTime: true,
              staleWithOpenRisk: true,
              statusChangeWithoutFollowUp: true,
              hoursSinceCheckIn: 5,
              hoursSinceStatusChange: 3.5,
            },
            risk: {
              openRisk: true,
              overdueLinkedWork: true,
              overdueLinkedCount: 1,
              overCapacity: true,
              capacityDelta: 1,
            },
          }),
          currentItem: {
            id: 10,
            dayId: 2,
            managerDeskItemId: 110,
            lifecycle: 'manager_desk_linked',
            itemType: 'jira',
            jiraKey: 'AM-123',
            jiraPriorityName: 'High',
            jiraDueDate: '2026-03-06',
            title: 'Fix login bug',
            state: 'in_progress',
            position: 0,
            createdAt: '2026-03-07T08:00:00Z',
            updatedAt: '2026-03-07T08:00:00Z',
          },
          plannedItems: [
            {
              id: 11,
              dayId: 2,
              managerDeskItemId: 111,
              lifecycle: 'manager_desk_linked',
              itemType: 'custom',
              title: 'Code review',
              state: 'planned',
              position: 1,
              createdAt: '2026-03-07T08:00:00Z',
              updatedAt: '2026-03-07T08:00:00Z',
            },
            {
              id: 12,
              dayId: 2,
              managerDeskItemId: 112,
              lifecycle: 'manager_desk_linked',
              itemType: 'custom',
              title: 'Follow up with QA',
              state: 'planned',
              position: 2,
              createdAt: '2026-03-07T08:00:00Z',
              updatedAt: '2026-03-07T08:00:00Z',
            },
          ],
        })],
      },
    ],
    query: {
      q: '',
      summaryFilter: 'all',
      sortBy: 'name',
      groupBy: 'none',
    },
    attentionQueue: [
      {
        developer: { accountId: 'dev-2', displayName: 'Bob Jones', isActive: true },
        status: 'blocked',
        reasons: [
          { code: 'blocked', label: 'Blocked', priority: 1 },
          { code: 'stale_with_open_risk', label: 'Stale with risk', priority: 2 },
          { code: 'overdue_linked_work', label: 'Overdue linked work', priority: 3 },
        ],
        isStale: true,
        signals: buildSignals({
          freshness: {
            staleByTime: true,
            staleWithOpenRisk: true,
            statusChangeWithoutFollowUp: true,
            hoursSinceCheckIn: 5,
            hoursSinceStatusChange: 3.5,
          },
          risk: {
            openRisk: true,
            overdueLinkedWork: true,
            overdueLinkedCount: 1,
            overCapacity: true,
            capacityDelta: 1,
          },
        }),
        hasCurrentItem: true,
        currentItem: {
          id: 10,
          title: 'Fix login bug',
          jiraKey: 'AM-123',
          lifecycle: 'manager_desk_linked',
        },
        plannedCount: 2,
        lastCheckInAt: '2026-03-07T07:00:00Z',
        availableQuickActions: ['update_status', 'mark_inactive', 'capture_follow_up'],
        setCurrentCandidates: [],
      },
      {
        developer: { accountId: 'dev-1', displayName: 'Alice Smith', isActive: true },
        status: 'on_track',
        reasons: [{ code: 'no_current', label: 'No current item', priority: 4 }],
        isStale: false,
        signals: buildSignals(),
        hasCurrentItem: false,
        plannedCount: 0,
        availableQuickActions: ['update_status', 'mark_inactive', 'capture_follow_up'],
        setCurrentCandidates: [],
      },
    ],
  };
}

let mockBoard: TeamTrackerBoardResponse = buildMockBoard();
let mockBoardQueryState = {
  isLoading: false,
  isError: false,
  error: null as Error | null,
  isFetching: false,
};

vi.mock('@/hooks/useTeamTracker', () => ({
  useTeamTracker: () => ({
    data: mockBoard,
    isLoading: mockBoardQueryState.isLoading,
    isError: mockBoardQueryState.isError,
    error: mockBoardQueryState.error,
    isFetching: mockBoardQueryState.isFetching,
    refetch: mockRefetchBoard,
  }),
  useCarryForwardPreview: () => ({
    data: mockCarryForwardPreviewValue,
    isLoading: false,
    isError: false,
    isFetching: false,
    refetch: mockRefetchCarryForwardPreview,
  }),
  useCarryForwardContext: () => ({
    data: mockCarryForwardContextValue,
    isLoading: false,
    isError: false,
    isFetching: false,
    refetch: mockRefetchCarryForwardContext,
  }),
  useTrackerIssueAssignments: () => ({
    data: mockTrackerIssueAssignments,
    isLoading: false,
    isError: false,
  }),
}));

vi.mock('@/hooks/useTeamTrackerMutations', () => ({
  useUpdateDay: () => ({ mutate: mockUpdateDayMutate }),
  useUpdateAvailability: () => ({ mutate: mockUpdateAvailabilityMutate, isPending: false, variables: undefined }),
  useAddTrackerItem: () => ({ mutate: mockAddTrackerItemMutate, isPending: false }),
  useSetCurrentItem: () => ({ mutate: mockSetCurrentMutate, isPending: false }),
  useUpdateTrackerItem: () => ({ mutate: mockUpdateTrackerItemMutate }),
  useDeleteTrackerItem: () => ({ mutate: vi.fn() }),
  useAddCheckIn: () => ({ mutate: vi.fn() }),
  useCarryForward: () => ({ mutate: mockCarryForwardMutate, isPending: false }),
  useStatusUpdate: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock('@/hooks/useManagerDesk', () => ({
  useManagerDesk: () => ({
    data: mockManagerDeskDay,
    isLoading: false,
  }),
  useCreateManagerDeskItem: () => ({ mutate: mockCreateManagerDeskItemMutate, isPending: false }),
  useUpdateManagerDeskItem: () => ({ mutate: mockUpdateManagerDeskItemMutate, isPending: false }),
}));

vi.mock('@/hooks/useIssues', () => ({
  useIssues: () => ({ data: mockIssues }),
}));

vi.mock('@/hooks/useConfig', () => ({
  useConfig: () => ({ data: { jiraBaseUrl: 'https://test.atlassian.net', isConfigured: true } }),
}));

vi.mock('@/context/ToastContext', () => ({
  useToast: () => ({
    addToast: mockAddToast,
  }),
}));

vi.mock('@/components/team-tracker/TrackerTaskDetailDrawer', () => ({
  TrackerTaskDetailDrawer: ({
    trackerItemId,
    initialManagerDeskItemId,
    backTo,
    onClose,
  }: {
    trackerItemId: number | null;
    initialManagerDeskItemId: number | null;
    backTo?: string;
    onClose: () => void;
  }) =>
    trackerItemId === null ? null : (
      <div role="dialog" aria-label="Team Tracker task detail">
        <span>{`Shared task detail for item ${trackerItemId}`}</span>
        {initialManagerDeskItemId !== null ? <span>{`Shared manager task ${initialManagerDeskItemId}`}</span> : null}
        {backTo ? (
          <button type="button" onClick={onClose}>
            {`Back to ${backTo}`}
          </button>
        ) : null}
        <button type="button" onClick={onClose}>
          Close shared task detail
        </button>
      </div>
    ),
}));

// Minimal framer-motion stub for tests
vi.mock('framer-motion', async () => {
  const actual = await vi.importActual<typeof import('framer-motion')>('framer-motion');
  return {
    ...actual,
    AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  };
});

import { TeamTrackerPage } from '@/components/team-tracker/TeamTrackerPage';
import { ROSTER_GRID } from '@/components/team-tracker/TrackerRosterBoard';

function clickDeveloperRow(name: string) {
  const target = screen
    .getAllByRole('button')
    .find((element) => element.textContent?.includes(name) && element.getAttribute('role') === 'button');
  if (!target) {
    throw new Error(`Could not find developer row for ${name}`);
  }
  fireEvent.click(target);
}

function switchTrackerLens(name: RegExp) {
  fireEvent.click(screen.getByRole('tab', { name }));
}

describe('TeamTrackerPage', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-07T12:00:00.000Z'));
    mockBoard = buildMockBoard();
    mockBoardQueryState = {
      isLoading: false,
      isError: false,
      error: null,
      isFetching: false,
    };
    mockCarryForwardMutate.mockReset();
    mockUpdateDayMutate.mockReset();
    mockUpdateAvailabilityMutate.mockReset();
    mockUpdateTrackerItemMutate.mockReset();
    mockSetCurrentMutate.mockReset();
    mockAddToast.mockReset();
    mockCreateManagerDeskItemMutate.mockReset();
    mockUpdateManagerDeskItemMutate.mockReset();
    mockAddTrackerItemMutate.mockReset();
    mockRefetchBoard.mockReset();
    mockRefetchCarryForwardPreview.mockReset();
    mockRefetchCarryForwardContext.mockReset();
    mockCarryForwardPreviewValue = undefined;
    mockCarryForwardContextValue = undefined;
    mockIssues = [];
    mockTrackerIssueAssignments = [];
    mockManagerDeskDay = {
      date: '2026-03-07',
      viewMode: 'live',
      items: [],
      summary: {
        totalOpen: 0,
        inbox: 0,
        planned: 0,
        inProgress: 0,
        waiting: 0,
        overdueFollowUps: 0,
        meetings: 0,
        completed: 0,
      },
    };
    mockBoard.inactiveDevelopers = [];
    window.sessionStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders the page title', () => {
    render(
      <TestWrapper>
        <TeamTrackerPage />
      </TestWrapper>
    );
    expect(screen.getByRole('heading', { name: 'Team' })).toBeInTheDocument();
  });

  it('does not hardcode a dark native color scheme on the board date input', () => {
    render(
      <TestWrapper>
        <TeamTrackerPage />
      </TestWrapper>
    );

    expect(screen.getByDisplayValue('2026-03-07')).toHaveProperty('style.colorScheme', '');
  });

  it('renders developer rows', () => {
    render(
      <TestWrapper>
        <TeamTrackerPage />
      </TestWrapper>
    );
    expect(screen.getAllByText('Alice Smith').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Bob Jones').length).toBeGreaterThanOrEqual(1);
  });

  it('shows a retryable error state when the board query fails', () => {
    mockBoardQueryState = {
      isError: true,
      error: new Error('Board query failed'),
      isFetching: false,
    };

    render(
      <TestWrapper>
        <TeamTrackerPage />
      </TestWrapper>
    );

    expect(screen.getByText('Could not load team tracker')).toBeInTheDocument();
    expect(screen.getByText('Board query failed')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^retry$/i }));
    expect(mockRefetchBoard).toHaveBeenCalled();
  });

  it('gives the availability dialog modal semantics, Escape close, and focus restoration', async () => {
    const { AvailabilityDialog } = await import('@/components/team-tracker/AvailabilityDialog');
    const onClose = vi.fn();
    const onConfirm = vi.fn();
    const { rerender } = render(
      <>
        <button type="button">Before dialog</button>
        <AvailabilityDialog
          open={false}
          developerName="Alice Smith"
          date="2026-03-07"
          onClose={onClose}
          onConfirm={onConfirm}
        />
      </>
    );

    const beforeButton = screen.getByRole('button', { name: /before dialog/i });
    beforeButton.focus();
    rerender(
      <>
        <button type="button">Before dialog</button>
        <AvailabilityDialog
          open
          developerName="Alice Smith"
          date="2026-03-07"
          onClose={onClose}
          onConfirm={onConfirm}
        />
      </>
    );
    vi.runOnlyPendingTimers();

    const dialog = screen.getByRole('dialog', { name: /mark alice smith inactive/i });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByRole('button', { name: /close inactive dialog/i })).toHaveFocus();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();

    rerender(
      <>
        <button type="button">Before dialog</button>
        <AvailabilityDialog
          open={false}
          developerName="Alice Smith"
          date="2026-03-07"
          onClose={onClose}
          onConfirm={onConfirm}
        />
      </>
    );
    expect(screen.getByRole('button', { name: /before dialog/i })).toHaveFocus();
  });

  it('renders summary strip with counts', () => {
    render(
      <TestWrapper>
        <TeamTrackerPage />
      </TestWrapper>
    );
    expect(screen.getByRole('button', { name: /1 blocked/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /1 stale/i })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /1 overdue jira/i }).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole('button', { name: /1 over cap/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /1 needs follow-up/i })).toBeInTheDocument();
  });

  it('renders the team roster with attention ranking and concise reason lines', () => {
    mockBoard.attentionQueue[0] = {
      ...mockBoard.attentionQueue[0]!,
      currentItem: undefined,
    };
    mockBoard.query.sortBy = 'attention';

    render(
      <TestWrapper>
        <TeamTrackerPage />
      </TestWrapper>
    );

    const roster = screen.getByText('Developer').closest('.overflow-hidden');
    expect(roster).not.toBeNull();

    const rosterView = within(roster! as HTMLElement);
    const bob = rosterView.getByText('Bob Jones');
    const alice = rosterView.getByText('Alice Smith');
    expect(bob.compareDocumentPosition(alice) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(rosterView.getByText(/blocked · stale with risk/i)).toBeInTheDocument();
    expect(rosterView.getByText('Fix login bug')).toBeInTheDocument();
    expect(rosterView.getByText('No current item')).toBeInTheDocument();
    expect(rosterView.queryByText('Active work is set')).not.toBeInTheDocument();
  });

  it('captures developer follow-ups with current and related tracker issue links', () => {
    mockBoard.developers[1] = {
      ...mockBoard.developers[1]!,
      currentItem: {
        ...mockBoard.developers[1]!.currentItem!,
        jiraKey: 'AM-123',
        relatedIssueKeys: ['AM-456', 'AM-789'],
      },
    };

    render(
      <TestWrapper>
        <TeamTrackerPage />
      </TestWrapper>
    );

    fireEvent.click(screen.getByRole('button', { name: /capture follow-up for bob jones/i }));
    expect(screen.getByRole('dialog', { name: /follow up with bob jones/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /add to desk/i }));

    expect(mockCreateManagerDeskItemMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Follow up with Bob Jones',
        links: [
          { linkType: 'developer', developerAccountId: 'dev-2' },
          { linkType: 'issue', issueKey: 'AM-123' },
          { linkType: 'issue', issueKey: 'AM-456' },
          { linkType: 'issue', issueKey: 'AM-789' },
        ],
      }),
      expect.any(Object),
    );
  });

  it('renders the inactive restore tray and reactivates developers from it', () => {
    mockBoard.inactiveDevelopers = [
      {
        developer: { accountId: 'dev-3', displayName: 'Cara Diaz', isActive: true },
        availability: { state: 'inactive', startDate: '2026-03-07', note: 'PTO today' },
      },
    ];

    render(
      <TestWrapper>
        <TeamTrackerPage />
      </TestWrapper>
    );

    switchTrackerLens(/inactive/i);

    expect(screen.getByText('Cara Diaz')).toBeInTheDocument();
    expect(screen.getByText('PTO today')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Active' }));

    expect(mockUpdateAvailabilityMutate).toHaveBeenCalledWith({ accountId: 'dev-3', state: 'active' });
  });

  it('shows blocked status pill on blocked developer', () => {
    render(
      <TestWrapper>
        <TeamTrackerPage />
      </TestWrapper>
    );
    // Bob is blocked
    const blockedPills = screen.getAllByText('Blocked');
    expect(blockedPills.length).toBeGreaterThanOrEqual(1);
  });

  it('shows current item for developer with in_progress work', () => {
    render(
      <TestWrapper>
        <TeamTrackerPage />
      </TestWrapper>
    );
    switchTrackerLens(/team/i);
    expect(screen.getByText('AM-123')).toBeInTheDocument();
    expect(screen.getByText('Fix login bug')).toBeInTheDocument();
  });

  it('manually refreshes only team tracker queries from the page header', () => {
    render(
      <TestWrapper>
        <TeamTrackerPage />
      </TestWrapper>
    );

    fireEvent.click(screen.getByRole('button', { name: /refresh team tracker/i }));

    expect(mockRefetchBoard).toHaveBeenCalled();
    expect(mockRefetchCarryForwardContext).not.toHaveBeenCalled();
    expect(mockRefetchCarryForwardPreview).not.toHaveBeenCalled();
  });

  it('shows "No current item" warning for developer without active work', () => {
    render(
      <TestWrapper>
        <TeamTrackerPage />
      </TestWrapper>
    );
    expect(screen.getAllByText('No current item').length).toBeGreaterThanOrEqual(1);
  });

  it('filters by summary chip', () => {
    render(
      <TestWrapper>
        <TeamTrackerPage />
      </TestWrapper>
    );
    // Click "Blocked" filter
    fireEvent.click(screen.getByRole('button', { name: /1 blocked/i }));
    expect(screen.getByRole('button', { name: /2 total/i })).toBeInTheDocument();
  });

  it('opens drawer when clicking a developer row', () => {
    render(
      <TestWrapper>
        <TeamTrackerPage />
      </TestWrapper>
    );
    clickDeveloperRow('Alice Smith');
    expect(screen.getAllByText('Alice Smith').length).toBeGreaterThanOrEqual(1);
  });

  it('shows developer-linked manager follow-ups in the drawer and completes the same desk item', () => {
    mockManagerDeskDay.items = [
      {
        id: 901,
        dayId: 33,
        originDate: '2026-03-07',
        title: 'Confirm rollout blocker',
        kind: 'action',
        category: 'follow_up',
        status: 'planned',
        priority: 'medium',
        contextNote: 'Ask Bob for the deploy decision.',
        createdAt: '2026-03-07T09:00:00Z',
        updatedAt: '2026-03-07T09:00:00Z',
        links: [
          {
            id: 902,
            itemId: 901,
            linkType: 'developer',
            developerAccountId: 'dev-2',
            displayLabel: 'Bob Jones',
            createdAt: '2026-03-07T09:00:00Z',
          },
        ],
      },
    ];

    render(
      <TestWrapper>
        <TeamTrackerPage />
      </TestWrapper>
    );

    clickDeveloperRow('Bob Jones');

    expect(screen.getByText('Confirm rollout blocker')).toBeInTheDocument();
    expect(screen.getByText('Ask Bob for the deploy decision.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /mark confirm rollout blocker complete/i }));

    expect(mockUpdateManagerDeskItemMutate).toHaveBeenCalledWith({ itemId: 901, status: 'done' });
  });

  it('opens the shared task detail drawer when clicking a task on the board', () => {
    render(
      <TestWrapper>
        <TeamTrackerPage />
      </TestWrapper>
    );

    switchTrackerLens(/team/i);
    fireEvent.click(screen.getByText('Fix login bug'));

    expect(screen.getByRole('dialog', { name: /team tracker task detail/i })).toBeInTheDocument();
    expect(screen.getByText('Shared task detail for item 10')).toBeInTheDocument();
  });

  it('opens an existing assignment from the quick-add conflict panel', () => {
    mockIssues = [
      {
        jiraKey: 'AM-456',
        summary: 'Investigate API latency',
        description: 'Investigate slow endpoint responses',
        priorityName: 'Highest',
        priorityId: '1',
        statusName: 'To Do',
        statusCategory: 'new',
        assigneeId: 'dev-1',
        assigneeName: 'Alice Smith',
        reporterName: 'Lead',
        component: 'API',
        labels: [],
        dueDate: '2026-03-08',
        developmentDueDate: undefined,
        flagged: false,
        createdAt: '2026-03-07T08:00:00Z',
        updatedAt: '2026-03-07T08:00:00Z',
        localTags: [],
      },
    ];
    mockTrackerIssueAssignments = [
      {
        date: '2026-03-07',
        jiraKey: 'AM-456',
        itemId: 77,
        title: 'Existing API latency investigation',
        state: 'planned',
        developer: { accountId: 'dev-1', displayName: 'Alice Smith', isActive: true },
      },
    ];

    render(
      <TestWrapper>
        <TeamTrackerPage />
      </TestWrapper>
    );

    clickDeveloperRow('Alice Smith');
    fireEvent.click(screen.getAllByRole('button', { name: /add task/i }).at(-1)!);
    fireEvent.change(screen.getByPlaceholderText('Describe the work in one line'), {
      target: { value: 'Investigate API latency spike' },
    });
    fireEvent.click(screen.getByRole('button', { name: /attach jira/i }));
    fireEvent.change(screen.getByPlaceholderText('Search Jira issues'), {
      target: { value: 'AM-456' },
    });
    fireEvent.click(screen.getByText('Investigate API latency'));

    expect(screen.getByText("AM-456 is already on Alice Smith's board today.")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: /open/i }).at(-1)!);

    expect(screen.queryByText("AM-456 is already on Alice Smith's board today.")).not.toBeInTheDocument();
    expect(screen.getByText('Shared task detail for item 77')).toBeInTheDocument();
  });

  it('shows the simplified live tracker controls and removes carry-forward controls', () => {
    render(
      <TestWrapper>
        <TeamTrackerPage />
      </TestWrapper>
    );

    expect(screen.queryByRole('tab', { name: /attention/i })).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /team/i })).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByText(/open team work stays on the tracker until it is done or dropped/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /carry forward/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /review & carry/i })).not.toBeInTheDocument();
  });

  it('switches the page into historical snapshot mode for past dates', () => {
    mockBoard.viewMode = 'history';

    render(
      <TestWrapper>
        <TeamTrackerPage />
      </TestWrapper>
    );

    fireEvent.change(screen.getByDisplayValue('2026-03-07'), {
      target: { value: '2026-03-05' },
    });

    expect(
      screen.getByText(/2026-03-05 is a read-only historical snapshot/i)
    ).toBeInTheDocument();
    expect(screen.queryByText('Needs attention')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /carry forward/i })).not.toBeInTheDocument();
  });

  it('renders the inactive tray as read-only for historical views', () => {
    mockBoard.viewMode = 'history';
    mockBoard.inactiveDevelopers = [
      {
        developer: { accountId: 'dev-3', displayName: 'Cara Diaz', isActive: true },
        availability: { state: 'inactive', startDate: '2026-03-07', note: 'PTO today' },
      },
    ];

    render(
      <TestWrapper>
        <TeamTrackerPage />
      </TestWrapper>
    );

    switchTrackerLens(/inactive/i);

    expect(screen.getByText('Historical inactive state for the selected date.')).toBeInTheDocument();
    expect(screen.getByText('Cara Diaz')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Active' })).not.toBeInTheDocument();
  });

  it('keeps the developer drawer read-only in historical mode', () => {
    mockBoard.viewMode = 'history';
    mockBoard.developers[0] = mockDay({
      ...mockBoard.developers[0],
      currentItem: undefined,
      plannedItems: [
        {
          id: 21,
          dayId: 1,
          lifecycle: 'tracker_only',
          itemType: 'custom',
          title: 'Historical planned task',
          state: 'planned',
          position: 0,
          createdAt: '2026-03-06T08:00:00Z',
          updatedAt: '2026-03-06T08:00:00Z',
        },
      ],
    });

    render(
      <TestWrapper>
        <TeamTrackerPage />
      </TestWrapper>
    );

    clickDeveloperRow('Alice Smith');

    expect(screen.getByText('No active item in this historical snapshot.')).toBeInTheDocument();
    expect(screen.getAllByText('Historical planned task').length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByRole('button', { name: /add task/i })).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/add a check-in note/i)).not.toBeInTheDocument();
    expect(screen.queryByText('Capture Follow-Up')).not.toBeInTheDocument();
  });

  it('does not open shared task detail from the board in historical mode', () => {
    mockBoard.viewMode = 'history';

    render(
      <TestWrapper>
        <TeamTrackerPage />
      </TestWrapper>
    );

    switchTrackerLens(/team/i);
    fireEvent.click(screen.getByText('Fix login bug'));

    expect(screen.queryByRole('dialog', { name: /team tracker task detail/i })).not.toBeInTheDocument();
  });

  it('shows check-in authorship badges and absolute timestamps in the drawer', () => {
    const bobAttentionItem = mockBoard.attentionQueue[0]!;
    mockBoard.developers[1] = mockDay({
      ...mockBoard.developers[1],
      checkIns: [
        {
          id: 201,
          dayId: 2,
          summary: 'Waiting on QA verification',
          createdAt: '2026-03-07T09:30:00Z',
          authorType: 'manager',
          authorAccountId: 'mgr-1',
        },
        {
          id: 202,
          dayId: 2,
          summary: 'Patch is in review now',
          createdAt: '2026-03-07T10:45:00Z',
          authorType: 'developer',
          authorAccountId: 'dev-2',
        },
      ],
      lastCheckInAt: '2026-03-07T10:45:00Z',
    });
    mockBoard.attentionQueue[0] = {
      ...bobAttentionItem,
      lastCheckInAt: '2026-03-07T10:45:00Z',
    };

    render(
      <TestWrapper>
        <TeamTrackerPage />
      </TestWrapper>
    );

    clickDeveloperRow('Bob Jones');

    expect(screen.getByText('Manager')).toBeInTheDocument();
    expect(screen.getAllByText('Developer').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(formatAbsoluteDateTime('2026-03-07T09:30:00Z'))).toBeInTheDocument();
    expect(screen.getByText(formatAbsoluteDateTime('2026-03-07T10:45:00Z'))).toBeInTheDocument();
    expect(screen.getAllByTitle(formatAbsoluteDateTime('2026-03-07T10:45:00Z')).length).toBeGreaterThanOrEqual(3);
  });

  it('creates a tracker-local Jira task from the drawer using the synced issue picker', () => {
    mockIssues = [
      {
        jiraKey: 'AM-456',
        summary: 'Investigate API latency',
        description: 'Investigate slow endpoint responses',
        priorityName: 'Highest',
        priorityId: '1',
        statusName: 'To Do',
        statusCategory: 'new',
        assigneeId: 'dev-2',
        assigneeName: 'Bob Jones',
        reporterName: 'Lead',
        component: 'API',
        labels: [],
        dueDate: '2026-03-08',
        developmentDueDate: undefined,
        flagged: false,
        createdAt: '2026-03-07T08:00:00Z',
        updatedAt: '2026-03-07T08:00:00Z',
        localTags: [],
      },
    ];

    render(
      <TestWrapper>
        <TeamTrackerPage />
      </TestWrapper>
    );

    clickDeveloperRow('Bob Jones');
    fireEvent.click(screen.getAllByRole('button', { name: /add task/i }).at(-1)!);
    fireEvent.change(screen.getByPlaceholderText('Describe the work in one line'), {
      target: { value: 'Investigate API latency spike' },
    });
    fireEvent.click(screen.getByRole('button', { name: /attach jira/i }));
    fireEvent.change(screen.getByPlaceholderText('Search Jira issues'), {
      target: { value: 'AM-456' },
    });
    fireEvent.click(screen.getByText('Investigate API latency'));
    fireEvent.click(screen.getAllByRole('button', { name: /^add task$/i }).at(-1)!);

    expect(mockAddTrackerItemMutate).toHaveBeenCalledWith({
      accountId: 'dev-2',
      title: 'Investigate API latency spike',
      jiraKey: 'AM-456',
      note: undefined,
    });
    expect(mockCreateManagerDeskItemMutate).not.toHaveBeenCalled();
  });

  it('navigates to the previous day when clicking the left arrow', () => {
    render(
      <TestWrapper>
        <TeamTrackerPage />
      </TestWrapper>
    );

    fireEvent.click(screen.getByRole('button', { name: /previous day/i }));
    // The date input should now show yesterday
    expect(screen.getByDisplayValue('2026-03-06')).toBeInTheDocument();
  });

  it('navigates to the next day when clicking the right arrow', () => {
    render(
      <TestWrapper>
        <TeamTrackerPage />
      </TestWrapper>
    );

    // First go to a past date
    fireEvent.click(screen.getByRole('button', { name: /previous day/i }));
    // Now click next day
    fireEvent.click(screen.getByRole('button', { name: /next day/i }));
    // Should be back to today
    expect(screen.getByDisplayValue('2026-03-07')).toBeInTheDocument();
  });

  it('disables next day button when on today', () => {
    render(
      <TestWrapper>
        <TeamTrackerPage />
      </TestWrapper>
    );

    const nextDayButton = screen.getByRole('button', { name: /next day/i });
    expect(nextDayButton).toBeDisabled();
  });

  it('shows drag handles for planned items in the drawer', () => {
    render(
      <TestWrapper>
        <TeamTrackerPage />
      </TestWrapper>
    );

    clickDeveloperRow('Bob Jones');
    const dragHandles = screen.getAllByTitle('Drag to reorder');
    // Bob has 3 planned items, each should have a drag handle
    expect(dragHandles.length).toBe(3);
  });

  it('opens the shared task detail drawer when clicking a task inside the developer drawer', () => {
    render(
      <TestWrapper>
        <TeamTrackerPage />
      </TestWrapper>
    );

    clickDeveloperRow('Bob Jones');
    const taskRow = screen.getAllByText('Code review').at(-1)?.closest('[role="button"]');
    expect(taskRow).not.toBeNull();
    fireEvent.click(taskRow!);

    expect(screen.getByRole('dialog', { name: /team tracker task detail/i })).toBeInTheDocument();
    expect(screen.getByText('Shared task detail for item 11')).toBeInTheDocument();
  });

  it('keeps the developer drawer mounted under the task detail and returns to it on close', () => {
    render(
      <TestWrapper>
        <TeamTrackerPage />
      </TestWrapper>
    );

    clickDeveloperRow('Bob Jones');
    expect(screen.getByRole('dialog', { name: /bob jones developer details/i })).toBeInTheDocument();

    const taskRow = screen.getAllByText('Code review').at(-1)?.closest('[role="button"]');
    expect(taskRow).not.toBeNull();
    fireEvent.click(taskRow!);

    expect(screen.getByRole('dialog', { name: /team tracker task detail/i })).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: /bob jones developer details/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /back to bob jones/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /close shared task detail/i }));

    expect(screen.queryByRole('dialog', { name: /team tracker task detail/i })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: /bob jones developer details/i })).toBeInTheDocument();
  });

  it('returns to the developer drawer via the task detail back control', () => {
    render(
      <TestWrapper>
        <TeamTrackerPage />
      </TestWrapper>
    );

    clickDeveloperRow('Bob Jones');
    const taskRow = screen.getAllByText('Code review').at(-1)?.closest('[role="button"]');
    fireEvent.click(taskRow!);

    fireEvent.click(screen.getByRole('button', { name: /back to bob jones/i }));

    expect(screen.queryByRole('dialog', { name: /team tracker task detail/i })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: /bob jones developer details/i })).toBeInTheDocument();
  });

  it('opens task detail from the board without a developer panel to return to', () => {
    render(
      <TestWrapper>
        <TeamTrackerPage />
      </TestWrapper>
    );

    switchTrackerLens(/team/i);
    fireEvent.click(screen.getByText('Fix login bug'));

    expect(screen.getByRole('dialog', { name: /team tracker task detail/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /back to/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: /developer details/i })).not.toBeInTheDocument();
  });

  it('shares the roster grid template across the header, rows, and loading skeleton', () => {
    mockBoardQueryState.isLoading = true;
    const { unmount } = render(
      <TestWrapper>
        <TeamTrackerPage />
      </TestWrapper>
    );

    const skeletonRows = Array.from(document.querySelectorAll('div')).filter((el) =>
      el.className.includes('grid-cols-[')
    );
    expect(skeletonRows.length).toBeGreaterThan(0);
    skeletonRows.forEach((el) => expect(el.className).toContain(ROSTER_GRID));
    unmount();

    mockBoardQueryState.isLoading = false;
    render(
      <TestWrapper>
        <TeamTrackerPage />
      </TestWrapper>
    );

    const header = screen.getByText('Current work').parentElement;
    expect(header?.className).toContain(ROSTER_GRID);

    const devRow = screen
      .getAllByRole('button')
      .find((element) => element.textContent?.includes('Bob Jones'));
    expect(devRow?.className).toContain(ROSTER_GRID);

    // Header and rows must declare the same column gap or the tracks drift out of alignment
    expect(header?.className).toContain('gap-3');
    expect(devRow?.className).toContain('gap-3');
  });

  it('edits a planned task title from the developer drawer without opening task detail', () => {
    render(
      <TestWrapper>
        <TeamTrackerPage />
      </TestWrapper>
    );

    clickDeveloperRow('Bob Jones');
    fireEvent.click(screen.getByRole('button', { name: /edit title: refactor utils/i }));

    const titleInput = screen.getByLabelText('Edit title');
    fireEvent.change(titleInput, {
      target: { value: 'Refactor utils and helpers' },
    });
    fireEvent.click(screen.getByTitle('Save title'));

    expect(mockUpdateTrackerItemMutate).toHaveBeenCalledWith({ itemId: 13, title: 'Refactor utils and helpers' });
    expect(screen.queryByRole('dialog', { name: /team tracker task detail/i })).not.toBeInTheDocument();
  });

  it('hides the title edit button for linked delegated tasks in the developer drawer', () => {
    render(
      <TestWrapper>
        <TeamTrackerPage />
      </TestWrapper>
    );

    clickDeveloperRow('Bob Jones');
    expect(screen.queryByRole('button', { name: /edit title: code review/i })).not.toBeInTheDocument();
  });

  it('starts a planned task from the developer drawer without opening task detail', () => {
    render(
      <TestWrapper>
        <TeamTrackerPage />
      </TestWrapper>
    );

    clickDeveloperRow('Bob Jones');
    fireEvent.click(screen.getByRole('button', { name: /start code review/i }));

    expect(mockSetCurrentMutate).toHaveBeenCalledWith(
      11,
      expect.objectContaining({ onError: expect.any(Function) })
    );
    expect(screen.queryByRole('dialog', { name: /team tracker task detail/i })).not.toBeInTheDocument();
  });

  it('shows a success toast with undo after marking current work done from the drawer', () => {
    mockUpdateTrackerItemMutate.mockImplementation((params, options) => {
      options?.onSuccess?.(undefined, params, undefined);
    });

    render(
      <TestWrapper>
        <TeamTrackerPage />
      </TestWrapper>
    );

    clickDeveloperRow('Bob Jones');
    fireEvent.click(screen.getByRole('button', { name: /mark fix login bug done/i }));

    expect(mockUpdateTrackerItemMutate).toHaveBeenNthCalledWith(
      1,
      { itemId: 10, state: 'done' },
      expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) })
    );
    expect(mockAddToast).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'success',
        title: 'Fix login bug marked done',
        action: expect.objectContaining({ label: 'Undo', onClick: expect.any(Function) }),
      })
    );

    const undo = mockAddToast.mock.calls[0]?.[0]?.action?.onClick;
    expect(undo).toBeTypeOf('function');
    undo();

    expect(mockUpdateTrackerItemMutate).toHaveBeenNthCalledWith(
      2,
      { itemId: 10, state: 'in_progress' },
      expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) })
    );
    expect(mockAddToast).toHaveBeenLastCalledWith('Task restored', 'success');
  });

  it('saves daily capacity from the drawer', () => {
    render(
      <TestWrapper>
        <TeamTrackerPage />
      </TestWrapper>
    );

    clickDeveloperRow('Bob Jones');
    fireEvent.change(screen.getByDisplayValue('2'), {
      target: { value: '5' },
    });
    fireEvent.click(screen.getAllByRole('button', { name: 'Save' })[0]!);

    expect(mockUpdateDayMutate).toHaveBeenCalledWith({
      accountId: 'dev-2',
      capacityUnits: 5,
    });
  });

  it('closes the shared task detail drawer from its close action', () => {
    render(
      <TestWrapper>
        <TeamTrackerPage />
      </TestWrapper>
    );

    switchTrackerLens(/team/i);
    fireEvent.click(screen.getByText('Fix login bug'));
    fireEvent.click(screen.getByRole('button', { name: /close shared task detail/i }));

    expect(screen.queryByRole('dialog', { name: /team tracker task detail/i })).not.toBeInTheDocument();
  });
});

describe('TrackerStatusPill', () => {
  it('renders correct label for each status', async () => {
    const { TrackerStatusPill } = await import('@/components/team-tracker/TrackerStatusPill');

    const { rerender } = render(<TrackerStatusPill status="blocked" />);
    expect(screen.getByText('Blocked')).toBeInTheDocument();

    rerender(<TrackerStatusPill status="at_risk" />);
    expect(screen.getByText('At Risk')).toBeInTheDocument();

    rerender(<TrackerStatusPill status="done_for_today" />);
    expect(screen.getByText('Done')).toBeInTheDocument();
  });
});

describe('TrackerItemRow', () => {
  it('renders item with jira key', async () => {
    const { TrackerItemRow } = await import('@/components/team-tracker/TrackerItemRow');

    render(
      <TrackerItemRow
        item={{
          id: 1,
          dayId: 1,
          lifecycle: 'tracker_only',
          itemType: 'jira',
          jiraKey: 'AM-456',
          jiraPriorityName: 'Highest',
          jiraDueDate: '2026-03-09',
          title: 'Deploy fix',
          state: 'planned',
          position: 0,
          createdAt: '2026-03-07T08:00:00Z',
          updatedAt: '2026-03-07T08:00:00Z',
        }}
      />
    );
    expect(screen.getByText('AM-456')).toBeInTheDocument();
    expect(screen.getByText('Deploy fix')).toBeInTheDocument();
    expect(screen.getByText('Highest • Due Mar 9')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'AM-456' })).toHaveAttribute('href', 'https://test.atlassian.net/browse/AM-456');
  });

  it('renders a compact Jira row variant for planned drawer items', async () => {
    const { TrackerItemRow } = await import('@/components/team-tracker/TrackerItemRow');
    const onSetCurrent = vi.fn();
    const onOpen = vi.fn();

    render(
      <TrackerItemRow
        item={{
          id: 17,
          dayId: 1,
          lifecycle: 'tracker_only',
          itemType: 'jira',
          jiraKey: 'AM-456',
          jiraSummary: 'Deploy fix to staging',
          jiraPriorityName: 'Highest',
          jiraDueDate: '2026-03-09',
          title: 'Validate the staging rollout guardrails',
          state: 'planned',
          note: 'This note should stay hidden in the drawer row.',
          position: 0,
          createdAt: '2026-03-07T08:00:00Z',
          updatedAt: '2026-03-07T08:00:00Z',
        }}
        variant="drawer-planned"
        actionPreset="hover-start"
        onOpen={onOpen}
        onSetCurrent={onSetCurrent}
      />
    );

    expect(screen.getByText('Validate the staging rollout guardrails')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'AM-456' })).toBeInTheDocument();
    expect(screen.queryByText('Highest • Due Mar 9')).not.toBeInTheDocument();
    expect(screen.queryByText('This note should stay hidden in the drawer row.')).not.toBeInTheDocument();
    expect(screen.queryByText(/^Start$/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /start validate the staging rollout guardrails/i }));

    expect(onSetCurrent).toHaveBeenCalledWith(17);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('renders a task without Jira metadata', async () => {
    const { TrackerItemRow } = await import('@/components/team-tracker/TrackerItemRow');

    render(
      <TrackerItemRow
        item={{
          id: 2,
          dayId: 1,
          lifecycle: 'tracker_only',
          itemType: 'custom',
          title: 'Team meeting',
          state: 'planned',
          position: 0,
          createdAt: '2026-03-07T08:00:00Z',
          updatedAt: '2026-03-07T08:00:00Z',
        }}
      />
    );
    expect(screen.getByText('Team meeting')).toBeInTheDocument();
    expect(screen.queryByText('Jira')).not.toBeInTheDocument();
  });

  it('shows line-through for done items', async () => {
    const { TrackerItemRow } = await import('@/components/team-tracker/TrackerItemRow');

    render(
      <TrackerItemRow
        item={{
          id: 3,
          dayId: 1,
          lifecycle: 'tracker_only',
          itemType: 'custom',
          title: 'Finished task',
          state: 'done',
          position: 0,
          completedAt: '2026-03-07T12:00:00Z',
          createdAt: '2026-03-07T08:00:00Z',
          updatedAt: '2026-03-07T12:00:00Z',
        }}
      />
    );
    const textEl = screen.getByText('Finished task');
    expect(textEl.style.textDecoration).toBe('line-through');
  });

  it('saves edited notes through the provided callback', async () => {
    const { TrackerItemRow } = await import('@/components/team-tracker/TrackerItemRow');
    const onUpdateNote = vi.fn();

    render(
      <TrackerItemRow
        item={{
          id: 4,
          dayId: 1,
          lifecycle: 'tracker_only',
          itemType: 'custom',
          title: 'Investigate logs',
          note: 'Initial context',
          state: 'planned',
          position: 0,
          createdAt: '2026-03-07T08:00:00Z',
          updatedAt: '2026-03-07T08:00:00Z',
        }}
        onUpdateNote={onUpdateNote}
      />
    );

    fireEvent.click(screen.getByTitle('Edit note'));
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'Updated context' },
    });
    fireEvent.click(screen.getByText('Save'));

    expect(onUpdateNote).toHaveBeenCalledWith(4, 'Updated context');
  });

  it('sends null when an edited note is cleared', async () => {
    const { TrackerItemRow } = await import('@/components/team-tracker/TrackerItemRow');
    const onUpdateNote = vi.fn();

    render(
      <TrackerItemRow
        item={{
          id: 19,
          dayId: 1,
          lifecycle: 'tracker_only',
          itemType: 'custom',
          title: 'Clear stale note',
          note: 'Remove this context',
          state: 'planned',
          position: 0,
          createdAt: '2026-03-07T08:00:00Z',
          updatedAt: '2026-03-07T08:00:00Z',
        }}
        onUpdateNote={onUpdateNote}
      />
    );

    fireEvent.click(screen.getByTitle('Edit note'));
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: '   ' },
    });
    fireEvent.click(screen.getByText('Save'));

    expect(onUpdateNote).toHaveBeenCalledWith(19, null);
  });

  it('edits a title via click-to-edit and saves on Enter', async () => {
    const { TrackerItemRow } = await import('@/components/team-tracker/TrackerItemRow');
    const onUpdateTitle = vi.fn();

    render(
      <TrackerItemRow
        item={{
          id: 5,
          dayId: 1,
          lifecycle: 'tracker_only',
          itemType: 'custom',
          title: 'Original title',
          state: 'planned',
          position: 0,
          createdAt: '2026-03-07T08:00:00Z',
          updatedAt: '2026-03-07T08:00:00Z',
        }}
        onUpdateTitle={onUpdateTitle}
      />
    );

    fireEvent.click(screen.getByText('Original title'));
    const input = screen.getByLabelText('Edit title');
    fireEvent.change(input, { target: { value: 'Revised title' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onUpdateTitle).toHaveBeenCalledWith(5, 'Revised title');
  });

  it('cancels title editing on Escape', async () => {
    const { TrackerItemRow } = await import('@/components/team-tracker/TrackerItemRow');
    const onUpdateTitle = vi.fn();

    render(
      <TrackerItemRow
        item={{
          id: 6,
          dayId: 1,
          lifecycle: 'tracker_only',
          itemType: 'custom',
          title: 'Keep this title',
          state: 'planned',
          position: 0,
          createdAt: '2026-03-07T08:00:00Z',
          updatedAt: '2026-03-07T08:00:00Z',
        }}
        onUpdateTitle={onUpdateTitle}
      />
    );

    fireEvent.click(screen.getByText('Keep this title'));
    const input = screen.getByLabelText('Edit title');
    fireEvent.change(input, { target: { value: 'Changed' } });
    fireEvent.keyDown(input, { key: 'Escape' });

    // Should revert and not call the callback
    expect(onUpdateTitle).not.toHaveBeenCalled();
    expect(screen.getByText('Keep this title')).toBeInTheDocument();
  });

  it('opens shared task detail when an onOpen handler is provided', async () => {
    const { TrackerItemRow } = await import('@/components/team-tracker/TrackerItemRow');
    const onOpen = vi.fn();

    render(
      <TrackerItemRow
        item={{
          id: 16,
          dayId: 1,
          lifecycle: 'tracker_only',
          itemType: 'custom',
          title: 'Shared task launch checklist',
          state: 'planned',
          position: 0,
          createdAt: '2026-03-07T08:00:00Z',
          updatedAt: '2026-03-07T08:00:00Z',
        }}
        onOpen={onOpen}
        onUpdateTitle={vi.fn()}
        showDetailsToggle
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /^shared task launch checklist$/i }));

    expect(onOpen).toHaveBeenCalledWith(16, undefined);
    expect(screen.queryByRole('button', { name: /show task details for/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Edit title')).not.toBeInTheDocument();
  });

  it('uses an explicit title edit control when row click opens shared task detail', async () => {
    const { TrackerItemRow } = await import('@/components/team-tracker/TrackerItemRow');
    const onOpen = vi.fn();
    const onUpdateTitle = vi.fn();

    render(
      <TrackerItemRow
        item={{
          id: 18,
          dayId: 1,
          lifecycle: 'tracker_only',
          itemType: 'custom',
          title: 'Shared task launch checklist',
          state: 'planned',
          position: 0,
          createdAt: '2026-03-07T08:00:00Z',
          updatedAt: '2026-03-07T08:00:00Z',
        }}
        onOpen={onOpen}
        onUpdateTitle={onUpdateTitle}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /edit title: shared task launch checklist/i }));

    const input = screen.getByLabelText('Edit title');
    fireEvent.change(input, { target: { value: 'Shared task launch checklist v2' } });
    fireEvent.click(screen.getByTitle('Save title'));

    expect(onOpen).not.toHaveBeenCalled();
    expect(onUpdateTitle).toHaveBeenCalledWith(18, 'Shared task launch checklist v2');
  });

  it('reveals full title and note when details are toggled on', async () => {
    const { TrackerItemRow } = await import('@/components/team-tracker/TrackerItemRow');

    render(
      <TrackerItemRow
        item={{
          id: 7,
          dayId: 1,
          lifecycle: 'tracker_only',
          itemType: 'custom',
          title: 'Investigate the regional export failure that only appears after the nightly sync',
          note: 'Capture the exact failure mode.\nConfirm whether the queued retry path is still intact.',
          state: 'planned',
          position: 0,
          createdAt: '2026-03-07T08:00:00Z',
          updatedAt: '2026-03-07T08:00:00Z',
        }}
        showDetailsToggle
      />
    );

    expect(
      screen.queryByRole('region', { name: /task details for investigate the regional export failure/i })
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /show task details for investigate the regional export failure/i }));

    const details = screen.getByRole('region', { name: /task details for investigate the regional export failure/i });
    expect(within(details).getByText('Full title')).toBeInTheDocument();
    expect(within(details).getByText(/capture the exact failure mode/i)).toBeInTheDocument();
  });

  it('keeps title editing separate from the details reveal', async () => {
    const { TrackerItemRow } = await import('@/components/team-tracker/TrackerItemRow');
    const onUpdateTitle = vi.fn();

    render(
      <TrackerItemRow
        item={{
          id: 8,
          dayId: 1,
          lifecycle: 'tracker_only',
          itemType: 'custom',
          title: 'Follow up with infra on rollout sequencing',
          note: 'Details should stay closed when editing starts.',
          state: 'planned',
          position: 0,
          createdAt: '2026-03-07T08:00:00Z',
          updatedAt: '2026-03-07T08:00:00Z',
        }}
        onUpdateTitle={onUpdateTitle}
        showDetailsToggle
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /edit title: follow up with infra on rollout sequencing/i }));

    expect(screen.getByLabelText('Edit title')).toBeInTheDocument();
    expect(
      screen.queryByRole('region', { name: /task details for follow up with infra on rollout sequencing/i })
    ).not.toBeInTheDocument();
  });

  it('supports keyboard activation for the details toggle', async () => {
    const { TrackerItemRow } = await import('@/components/team-tracker/TrackerItemRow');

    render(
      <TrackerItemRow
        item={{
          id: 9,
          dayId: 1,
          lifecycle: 'tracker_only',
          itemType: 'custom',
          title: 'Validate keyboard access for task details',
          note: 'This should open without a mouse.',
          state: 'planned',
          position: 0,
          createdAt: '2026-03-07T08:00:00Z',
          updatedAt: '2026-03-07T08:00:00Z',
        }}
        showDetailsToggle
      />
    );

    const toggle = screen.getByRole('button', { name: /show task details for validate keyboard access for task details/i });
    toggle.focus();
    fireEvent.keyDown(toggle, { key: 'Enter' });

    expect(screen.getByRole('region', { name: /task details for validate keyboard access for task details/i })).toBeInTheDocument();
  });
});

describe('AddTrackerItemForm', () => {
  beforeEach(() => {
    mockTrackerIssueAssignments = [];
  });

  it('creates a descriptive task with an optional note', async () => {
    const { AddTrackerItemForm } = await import('@/components/team-tracker/AddTrackerItemForm');
    const onAdd = vi.fn();

    render(
      <AddTrackerItemForm
        onAdd={onAdd}
        date="2026-03-07"
        targetAccountId="dev-1"
        onOpenExistingAssignment={vi.fn()}
      />
    );

    fireEvent.click(screen.getByText('Add Task'));
    const titleInput = screen.getByPlaceholderText('Describe the work in one line');
    fireEvent.change(titleInput, {
      target: { value: 'Prep release notes' },
    });
    fireEvent.change(screen.getByPlaceholderText('Optional context or handoff detail'), {
      target: { value: 'Need this before standup' },
    });
    fireEvent.keyDown(titleInput, { key: 'Enter' });

    expect(onAdd).toHaveBeenCalledWith({
      title: 'Prep release notes',
      note: 'Need this before standup',
    });
  });

  it('creates a descriptive task with a linked Jira and optional note', async () => {
    const { AddTrackerItemForm } = await import('@/components/team-tracker/AddTrackerItemForm');
    const onAdd = vi.fn();

    render(
      <AddTrackerItemForm
        onAdd={onAdd}
        date="2026-03-07"
        targetAccountId="dev-1"
        onOpenExistingAssignment={vi.fn()}
        issues={[
          {
            jiraKey: 'AM-789',
            summary: 'Fix alert regression',
            priorityName: 'High',
            dueDate: '2026-03-10',
          },
        ]}
      />
    );

    fireEvent.click(screen.getByText('Add Task'));
    fireEvent.change(screen.getByPlaceholderText('Describe the work in one line'), {
      target: { value: 'Fix alert rendering regression' },
    });
    fireEvent.click(screen.getByText('Attach Jira'));
    fireEvent.change(screen.getByPlaceholderText('Search Jira issues'), {
      target: { value: 'AM-789' },
    });
    fireEvent.click(screen.getByText('Fix alert regression'));
    fireEvent.change(screen.getByPlaceholderText('Optional context or handoff detail'), {
      target: { value: 'Needs pairing with QA' },
    });
    fireEvent.click(screen.getByText('Add Task'));

    expect(onAdd).toHaveBeenCalledWith({
      jiraKey: 'AM-789',
      title: 'Fix alert rendering regression',
      note: 'Needs pairing with QA',
    });
  });

  it('keeps Jira links separate from issue selection in the picker', async () => {
    const { AddTrackerItemForm } = await import('@/components/team-tracker/AddTrackerItemForm');

    render(
      <AddTrackerItemForm
        onAdd={vi.fn()}
        date="2026-03-07"
        targetAccountId="dev-1"
        onOpenExistingAssignment={vi.fn()}
        issues={[
          {
            jiraKey: 'AM-789',
            summary: 'Fix alert regression',
            priorityName: 'High',
            dueDate: '2026-03-10',
          },
        ]}
      />
    );

    fireEvent.click(screen.getByText('Add Task'));
    fireEvent.click(screen.getByText('Attach Jira'));
    fireEvent.change(screen.getByPlaceholderText('Search Jira issues'), {
      target: { value: 'AM-789' },
    });

    fireEvent.click(screen.getByRole('link', { name: 'AM-789' }));
    expect(screen.queryByLabelText(/remove linked jira/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Fix alert regression'));
    expect(screen.getByLabelText(/remove linked jira/i)).toBeInTheDocument();
  });

  it('shows a stronger warning when the selected developer already has the Jira issue', async () => {
    const { AddTrackerItemForm } = await import('@/components/team-tracker/AddTrackerItemForm');

    mockTrackerIssueAssignments = [
      {
        date: '2026-03-07',
        jiraKey: 'AM-789',
        itemId: 91,
        title: 'Existing alert regression work',
        state: 'planned',
        developer: { accountId: 'dev-1', displayName: 'Alice Smith', isActive: true },
      },
    ];

    render(
      <AddTrackerItemForm
        onAdd={vi.fn()}
        date="2026-03-07"
        targetAccountId="dev-1"
        onOpenExistingAssignment={vi.fn()}
        issues={[
          {
            jiraKey: 'AM-789',
            summary: 'Fix alert regression',
            priorityName: 'High',
            dueDate: '2026-03-10',
          },
        ]}
      />
    );

    fireEvent.click(screen.getByText('Add Task'));
    fireEvent.click(screen.getByText('Attach Jira'));
    fireEvent.change(screen.getByPlaceholderText('Search Jira issues'), {
      target: { value: 'AM-789' },
    });
    fireEvent.click(screen.getByText('Fix alert regression'));

    expect(screen.getByText("AM-789 is already on Alice Smith's board today.")).toBeInTheDocument();
    expect(screen.getByText(/duplicates are still allowed in this flow/i)).toBeInTheDocument();
  });

  it('clears the conflict warning when the Jira selection is removed', async () => {
    const { AddTrackerItemForm } = await import('@/components/team-tracker/AddTrackerItemForm');

    mockTrackerIssueAssignments = [
      {
        date: '2026-03-07',
        jiraKey: 'AM-789',
        itemId: 91,
        title: 'Existing alert regression work',
        state: 'planned',
        developer: { accountId: 'dev-2', displayName: 'Bob Jones', isActive: true },
      },
    ];

    render(
      <AddTrackerItemForm
        onAdd={vi.fn()}
        date="2026-03-07"
        targetAccountId="dev-1"
        onOpenExistingAssignment={vi.fn()}
        issues={[
          {
            jiraKey: 'AM-789',
            summary: 'Fix alert regression',
            priorityName: 'High',
            dueDate: '2026-03-10',
          },
        ]}
      />
    );

    fireEvent.click(screen.getByText('Add Task'));
    fireEvent.click(screen.getByText('Attach Jira'));
    fireEvent.change(screen.getByPlaceholderText('Search Jira issues'), {
      target: { value: 'AM-789' },
    });
    fireEvent.click(screen.getByText('Fix alert regression'));

    expect(screen.getByText('AM-789 is already assigned in Team Tracker today.')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(/remove linked jira/i));

    expect(screen.queryByText('AM-789 is already assigned in Team Tracker today.')).not.toBeInTheDocument();
  });

  it('still submits when a Jira conflict exists', async () => {
    const { AddTrackerItemForm } = await import('@/components/team-tracker/AddTrackerItemForm');
    const onAdd = vi.fn();

    mockTrackerIssueAssignments = [
      {
        date: '2026-03-07',
        jiraKey: 'AM-789',
        itemId: 91,
        title: 'Existing alert regression work',
        state: 'planned',
        developer: { accountId: 'dev-2', displayName: 'Bob Jones', isActive: true },
      },
    ];

    render(
      <AddTrackerItemForm
        onAdd={onAdd}
        date="2026-03-07"
        targetAccountId="dev-1"
        onOpenExistingAssignment={vi.fn()}
        issues={[
          {
            jiraKey: 'AM-789',
            summary: 'Fix alert regression',
            priorityName: 'High',
            dueDate: '2026-03-10',
          },
        ]}
      />
    );

    fireEvent.click(screen.getByText('Add Task'));
    fireEvent.change(screen.getByPlaceholderText('Describe the work in one line'), {
      target: { value: 'Patch the regression anyway' },
    });
    fireEvent.click(screen.getByText('Attach Jira'));
    fireEvent.change(screen.getByPlaceholderText('Search Jira issues'), {
      target: { value: 'AM-789' },
    });
    fireEvent.click(screen.getByText('Fix alert regression'));
    fireEvent.click(screen.getByRole('button', { name: /^add task$/i }));

    expect(onAdd).toHaveBeenCalledWith({
      jiraKey: 'AM-789',
      title: 'Patch the regression anyway',
      note: undefined,
    });
  });

  it('opens an existing assignment from the conflict panel', async () => {
    const { AddTrackerItemForm } = await import('@/components/team-tracker/AddTrackerItemForm');
    const onOpenExistingAssignment = vi.fn();

    mockTrackerIssueAssignments = [
      {
        date: '2026-03-07',
        jiraKey: 'AM-789',
        itemId: 91,
        title: 'Existing alert regression work',
        state: 'planned',
        developer: { accountId: 'dev-2', displayName: 'Bob Jones', isActive: true },
      },
    ];

    render(
      <AddTrackerItemForm
        onAdd={vi.fn()}
        date="2026-03-07"
        targetAccountId="dev-1"
        onOpenExistingAssignment={onOpenExistingAssignment}
        issues={[
          {
            jiraKey: 'AM-789',
            summary: 'Fix alert regression',
            priorityName: 'High',
            dueDate: '2026-03-10',
          },
        ]}
      />
    );

    fireEvent.click(screen.getByText('Add Task'));
    fireEvent.click(screen.getByText('Attach Jira'));
    fireEvent.change(screen.getByPlaceholderText('Search Jira issues'), {
      target: { value: 'AM-789' },
    });
    fireEvent.click(screen.getByText('Fix alert regression'));
    fireEvent.click(screen.getByRole('button', { name: /open/i }));

    expect(onOpenExistingAssignment).toHaveBeenCalledWith(91);
    expect(screen.queryByText('AM-789 is already assigned in Team Tracker today.')).not.toBeInTheDocument();
  });
});
