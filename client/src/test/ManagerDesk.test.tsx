import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, within } from '@testing-library/react';
import { TestWrapper } from '@/test/wrapper';
import type {
  ManagerDeskDayResponse,
  ManagerDeskItem,
  ManagerDeskSummary,
} from '@/types/manager-desk';

const mockIssuesByKey = {
  'PROJ-221': {
    jiraKey: 'PROJ-221',
    summary: 'Rahul blocker on review flow',
    description: '### Detail\nInvestigate the review flow regression.',
    aspenSeverity: 'High',
    priorityName: 'High',
    priorityId: '1',
    statusName: 'In Progress',
    statusCategory: 'indeterminate',
    assigneeId: 'bob-2',
    assigneeName: 'Bob Jones',
    reporterName: 'Lead',
    component: 'Review Flow',
    labels: ['review'],
    dueDate: '2026-03-10',
    developmentDueDate: '2026-03-09',
    flagged: true,
    createdAt: '2026-03-07T08:00:00.000Z',
    updatedAt: '2026-03-08T09:00:00.000Z',
    localTags: [],
    analysisNotes: 'Root cause points to the handoff validation step.',
  },
  'PROJ-321': {
    jiraKey: 'PROJ-321',
    summary: 'Investigate design gap in review flow',
    description: 'Follow up with design on the error-state coverage.',
    aspenSeverity: 'Medium',
    priorityName: 'Medium',
    priorityId: '2',
    statusName: 'To Do',
    statusCategory: 'new',
    assigneeId: 'alice-1',
    assigneeName: 'Alice Smith',
    reporterName: 'Lead',
    component: 'Design',
    labels: ['design'],
    dueDate: '2026-03-12',
    developmentDueDate: undefined,
    flagged: false,
    createdAt: '2026-03-07T08:00:00.000Z',
    updatedAt: '2026-03-08T08:00:00.000Z',
    localTags: [],
    analysisNotes: '',
  },
} as const;

// ── Mock data ───────────────────────────────────────────

const mockSummary: ManagerDeskSummary = {
  totalOpen: 5,
  inbox: 2,
  planned: 1,
  inProgress: 1,
  waiting: 1,
  overdueFollowUps: 0,
  meetings: 1,
  completed: 2,
};

const mockItem = (overrides: Partial<ManagerDeskItem> = {}): ManagerDeskItem => ({
  id: 1,
  dayId: 1,
  originDate: '2026-03-08',
  title: 'Test action item',
  kind: 'action',
  category: 'analysis',
  status: 'planned',
  priority: 'high',
  createdAt: '2026-03-08T09:00:00Z',
  updatedAt: '2026-03-08T09:00:00Z',
  links: [],
  ...overrides,
});

const mockDayResponse: ManagerDeskDayResponse = {
  date: '2026-03-08',
  viewMode: 'live',
  items: [
    mockItem({
      id: 1,
      title: 'Analyze root cause for DEF-241',
      status: 'planned',
      priority: 'high',
      assignee: {
        accountId: 'alice-1',
        displayName: 'Alice Smith',
        avatarUrl: 'https://example.com/alice.png',
      },
      links: [{ id: 11, itemId: 1, linkType: 'issue', issueKey: 'PROJ-221', displayLabel: 'PROJ-221', createdAt: '2026-03-08T09:00:00Z' }],
      nextAction: 'Follow up with QA after design review',
      outcome: 'Root cause and workaround captured',
    }),
    mockItem({ id: 2, title: 'Design sync with onshore', kind: 'meeting', category: 'design', status: 'planned', participants: 'Onshore Team' }),
    mockItem({ id: 3, title: 'Waiting on QA feedback', kind: 'waiting', category: 'follow_up', status: 'waiting' }),
    mockItem({ id: 4, title: 'Quick inbox thought', status: 'inbox', priority: 'low' }),
    mockItem({ id: 5, title: 'Completed analysis', status: 'done', outcome: 'Root cause identified' }),
  ],
  summary: mockSummary,
};

let currentMockDay: ManagerDeskDayResponse | undefined = mockDayResponse;
let mockIsLoading = false;
let mockError: Error | null = null;
const mockRefetch = vi.fn();

const mockCreateMutate = vi.fn();
const mockUpdateMutate = vi.fn();
const mockDeleteMutate = vi.fn();
const mockAddToast = vi.fn();
const mockCarryForwardMutate = vi.fn();
const mockCarryForwardPreviewData = {
  data: null as import('@/types/manager-desk').ManagerDeskCarryForwardPreviewResponse | null,
  isLoading: false,
  isFetching: false,
  isError: false,
};
const mockCarryForwardContextData = {
  data: null as import('@/types/manager-desk').ManagerDeskCarryForwardContextResponse | null,
  isLoading: false,
  isFetching: false,
  isError: false,
  refetch: vi.fn(),
};

// ── Mock hooks ──────────────────────────────────────────

vi.mock('@/hooks/useManagerDesk', () => ({
  useManagerDesk: () => ({
    data: currentMockDay,
    isLoading: mockIsLoading,
    isFetching: false,
    error: mockError,
    refetch: mockRefetch,
  }),
  useCreateManagerDeskItem: () => ({
    mutate: mockCreateMutate,
    isPending: false,
  }),
  useUpdateManagerDeskItem: () => ({
    mutate: mockUpdateMutate,
    isPending: false,
  }),
  useDeleteManagerDeskItem: () => ({
    mutate: mockDeleteMutate,
    isPending: false,
  }),
  useCancelDelegatedManagerDeskTask: () => ({
    mutate: vi.fn(),
    isPending: false,
  }),
  useCarryForwardManagerDesk: () => ({
    mutate: mockCarryForwardMutate,
    isPending: false,
  }),
  useManagerDeskCarryForwardContext: () => mockCarryForwardContextData,
  useManagerDeskCarryForwardPreview: () => mockCarryForwardPreviewData,
  useAddManagerDeskLink: () => ({
    mutate: vi.fn(),
    isPending: false,
  }),
  useRemoveManagerDeskLink: () => ({
    mutate: vi.fn(),
    isPending: false,
  }),
  useManagerDeskIssueLookup: () => ({ data: [], isLoading: false }),
  useManagerDeskDeveloperLookup: () => ({ data: [], isLoading: false }),
}));

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({
    user: { username: 'mgr', accountId: 'mgr-1', displayName: 'Test Manager', role: 'manager' },
    isLoading: false,
    isAuthenticated: true,
    login: vi.fn(),
    logout: vi.fn(),
  }),
  useAuthScopeKey: () => 'ws:mgr:manager:',
}));

let mockNoteSources: { itemId: number; noteId: number; date: string }[] = [];

vi.mock('@/hooks/useDailyNotes', () => ({
  useDailyNoteSources: (ids: number[]) => ({
    data: mockNoteSources.filter((source) => ids.includes(source.itemId)),
  }),
}));

vi.mock('@/context/ThemeContext', () => ({
  useTheme: () => ({
    theme: 'dark',
    toggleTheme: vi.fn(),
  }),
}));

vi.mock('@/context/ToastContext', () => ({
  useToast: () => ({
    addToast: mockAddToast,
  }),
}));

vi.mock('@/hooks/useDevelopers', () => ({
  useDevelopers: () => ({
    data: [
      { accountId: 'alice-1', displayName: 'Alice Smith', isActive: true },
      { accountId: 'bob-2', displayName: 'Bob Jones', isActive: true },
    ],
    isLoading: false,
  }),
}));

vi.mock('@/hooks/useIssueDetail', () => ({
  useIssueDetail: (key?: string) => ({
    data: key ? mockIssuesByKey[key as keyof typeof mockIssuesByKey] : undefined,
    isLoading: false,
  }),
}));

vi.mock('@/hooks/useConfig', () => ({
  useConfig: () => ({
    data: { jiraBaseUrl: 'https://test.atlassian.net', isConfigured: true },
  }),
}));

// Minimal framer-motion stub
vi.mock('framer-motion', async () => {
  const actual = await vi.importActual<typeof import('framer-motion')>('framer-motion');
  return {
    ...actual,
    AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  };
});

import { ManagerDeskPage } from '@/components/manager-desk/ManagerDeskPage';

// ── Tests ───────────────────────────────────────────────

describe('ManagerDeskPage', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-08T12:00:00.000Z'));
    currentMockDay = mockDayResponse;
    mockIsLoading = false;
    mockError = null;
    mockCreateMutate.mockReset();
    mockUpdateMutate.mockReset();
    mockDeleteMutate.mockReset();
    mockAddToast.mockReset();
    mockCarryForwardMutate.mockReset();
    mockRefetch.mockReset();
    mockCarryForwardPreviewData.data = null;
    mockCarryForwardPreviewData.isLoading = false;
    mockCarryForwardPreviewData.isFetching = false;
    mockCarryForwardPreviewData.isError = false;
    mockCarryForwardContextData.data = null;
    mockCarryForwardContextData.isLoading = false;
    mockCarryForwardContextData.isFetching = false;
    mockCarryForwardContextData.isError = false;
    mockCarryForwardContextData.refetch.mockReset();
    mockNoteSources = [];
    try { window.sessionStorage.clear(); } catch { /* noop */ }
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders the page title and date', () => {
    render(
      <TestWrapper>
        <ManagerDeskPage />
      </TestWrapper>,
    );
    expect(screen.getByText('Desk')).toBeInTheDocument();
    expect(screen.getByText(/March 8, 2026/)).toBeInTheDocument();
  });

  it('renders the command bar quick filters', () => {
    render(
      <TestWrapper>
        <ManagerDeskPage />
      </TestWrapper>,
    );
    expect(screen.getByRole('button', { name: /today 5/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /triage 1/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /planned 3/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^waiting \d+$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /needs attention/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /done 1/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /carried \d+/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /filters/i })).toBeInTheDocument();
  });

  it('renders quick capture input', () => {
    render(
      <TestWrapper>
        <ManagerDeskPage />
      </TestWrapper>,
    );
    const input = screen.getByPlaceholderText(/Quick capture/);
    expect(input).toBeInTheDocument();
  });

  it('does not auto-focus quick capture on initial render', () => {
    render(
      <TestWrapper>
        <ManagerDeskPage />
      </TestWrapper>,
    );

    const input = screen.getByPlaceholderText(/Quick capture/);
    expect(input).not.toHaveFocus();
  });

  it('renders manager work in a manager-rhythm desk list', () => {
    render(
      <TestWrapper>
        <ManagerDeskPage />
      </TestWrapper>,
    );
    expect(screen.getByRole('heading', { name: 'Today' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Needs triage' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Planned' })).toBeInTheDocument();
    expect(screen.queryByText('Rail')).not.toBeInTheDocument();
    expect(screen.queryByText('Focus')).not.toBeInTheDocument();
    expect(screen.getAllByText('Needs triage').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Analyze root cause for DEF-241').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Waiting on QA feedback').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Quick inbox thought').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Design sync with onshore').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Design sync with onshore').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Alice Smith').length).toBeGreaterThanOrEqual(1);
  });

  it('shows a persistent status indicator for started vs planned work in focus', () => {
    currentMockDay = {
      ...mockDayResponse,
      items: [
        mockItem({
          id: 1,
          title: 'Started incident review',
          status: 'in_progress',
          priority: 'high',
          assignee: {
            accountId: 'alice-1',
            displayName: 'Alice Smith',
            avatarUrl: 'https://example.com/alice.png',
          },
          nextAction: 'Keep the validation fix moving',
          delegatedExecution: {
            trackerItemId: 88,
            state: 'planned',
            updatedAt: '2026-03-08T09:15:00Z',
          },
        }),
        mockItem({
          id: 6,
          title: 'Planned stakeholder follow-up',
          status: 'planned',
          priority: 'medium',
        }),
        ...mockDayResponse.items.slice(2),
      ],
      summary: {
        ...mockDayResponse.summary,
        planned: 1,
        inProgress: 1,
      },
    };

    render(
      <TestWrapper>
        <ManagerDeskPage />
      </TestWrapper>,
    );

    const startedRow = screen.getByRole('button', { name: /^Open Started incident review$/i });
    expect(within(startedRow).getByText('Doing')).toBeInTheDocument();
    expect(within(startedRow).getByText('Alice Smith')).toBeInTheDocument();
    expect(within(startedRow).queryByText('Planned')).not.toBeInTheDocument();
    expect(screen.getAllByText('Planned').length).toBeGreaterThan(0);
  });

  it('labels active delegated work as a developer signal on desk rows', () => {
    currentMockDay = {
      ...mockDayResponse,
      items: [
        mockItem({
          id: 7,
          title: 'Delegate rollout validation',
          status: 'planned',
          priority: 'medium',
          assignee: {
            accountId: 'alice-1',
            displayName: 'Alice Smith',
            avatarUrl: 'https://example.com/alice.png',
          },
          delegatedExecution: {
            trackerItemId: 99,
            state: 'in_progress',
            updatedAt: '2026-03-08T09:20:00Z',
          },
        }),
      ],
      summary: {
        ...mockDayResponse.summary,
        planned: 1,
        inProgress: 0,
      },
    };

    render(
      <TestWrapper>
        <ManagerDeskPage />
      </TestWrapper>,
    );

    const delegatedRow = screen.getByRole('button', { name: /^Open Delegate rollout validation$/i });
    expect(within(delegatedRow).getByText('Dev active')).toBeInTheDocument();
    expect(within(delegatedRow).getByText('Alice Smith')).toBeInTheDocument();
    expect(within(delegatedRow).queryByText('In Progress')).not.toBeInTheDocument();
  });

  it('calls create mutation when quick capture is submitted', () => {
    render(
      <TestWrapper>
        <ManagerDeskPage />
      </TestWrapper>,
    );
    const input = screen.getByPlaceholderText(/Quick capture/);
    fireEvent.change(input, { target: { value: 'New task item' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(mockCreateMutate).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'New task item', date: '2026-03-08' }),
      expect.anything(),
    );

    const createCall = mockCreateMutate.mock.calls[0]!;
    expect(createCall).toBeDefined();
    const options = createCall[1] as { onSuccess: (item: ManagerDeskItem) => void };
    act(() => {
      options.onSuccess(mockItem({ id: 99, title: 'New task item', status: 'inbox' }));
    });

    expect(mockAddToast).toHaveBeenCalledWith('Captured to triage', 'success');
    expect(screen.queryByLabelText('Manager Desk item detail')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Assign New task item')).not.toBeInTheDocument();
  });

  it('filters the workbench from the global search box', () => {
    render(
      <TestWrapper>
        <ManagerDeskPage />
      </TestWrapper>,
    );

    fireEvent.change(screen.getByRole('textbox', { name: /search manager desk tasks/i }), {
      target: { value: 'QA feedback' },
    });

    expect(screen.getAllByText('Waiting on QA feedback').length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText('Design sync with onshore')).not.toBeInTheDocument();
  });

  it('keeps quick capture focused after submitting a task', () => {
    render(
      <TestWrapper>
        <ManagerDeskPage />
      </TestWrapper>,
    );

    const input = screen.getByPlaceholderText(/Quick capture/);
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'First follow-up task' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(input).toHaveFocus();
    expect(input).toHaveValue('');
  });

  it('collapses quick capture options after mouse submit', () => {
    render(
      <TestWrapper>
        <ManagerDeskPage />
      </TestWrapper>,
    );

    const input = screen.getByPlaceholderText(/Quick capture/);
    fireEvent.change(input, { target: { value: 'Mouse-added task' } });

    expect(screen.getByLabelText('Quick capture kind')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^add$/i }));

    expect(input).toHaveValue('');
    expect(screen.queryByLabelText('Quick capture kind')).not.toBeInTheDocument();
    expect(input).toHaveFocus();
  });

  it('opens inbox item detail without inline triage controls when selected', () => {
    render(
      <TestWrapper>
        <ManagerDeskPage />
      </TestWrapper>,
    );

    fireEvent.click(screen.getByRole('button', { name: /^Open Quick inbox thought$/i }));

    expect(screen.getByLabelText('Manager Desk item detail')).toBeInTheDocument();
    expect(screen.getByLabelText('Item title')).toHaveValue('Quick inbox thought');
    expect(screen.queryByLabelText('Assign Quick inbox thought')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Priority for Quick inbox thought')).not.toBeInTheDocument();
  });

  it('updates an inbox item from the hover quick action without opening the drawer', () => {
    render(
      <TestWrapper>
        <ManagerDeskPage />
      </TestWrapper>,
    );

    fireEvent.click(screen.getByRole('button', { name: /plan quick inbox thought/i }));

    expect(mockUpdateMutate).toHaveBeenCalledWith(
      {
        itemId: 4,
        status: 'planned',
      },
      expect.anything(),
    );
    expect(screen.queryByLabelText('Manager Desk item detail')).not.toBeInTheDocument();
  });

  it('keeps the planned quick action accessible from keyboard focus', () => {
    render(
      <TestWrapper>
        <ManagerDeskPage />
      </TestWrapper>,
    );

    const card = screen.getByRole('button', { name: /^Open Analyze root cause for DEF-241$/i });
    fireEvent.focus(card);

    const action = screen.getByRole('button', { name: /start analyze root cause for def-241/i });
    fireEvent.focus(action);
    fireEvent.click(action);

    expect(mockUpdateMutate).toHaveBeenCalledWith(
      {
        itemId: 1,
        status: 'in_progress',
      },
      expect.anything(),
    );
    expect(screen.queryByLabelText('Manager Desk item detail')).not.toBeInTheDocument();
  });

  it('shows loading state', () => {
    mockIsLoading = true;
    currentMockDay = undefined;
    render(
      <TestWrapper>
        <ManagerDeskPage />
      </TestWrapper>,
    );
    // Loading spinner should be visible (spin animation class)
    const spinner = document.querySelector('.animate-spin');
    expect(spinner).toBeInTheDocument();
  });

  it('shows error state with retry button', () => {
    mockError = new Error('Network failed');
    currentMockDay = undefined;
    render(
      <TestWrapper>
        <ManagerDeskPage />
      </TestWrapper>,
    );
    expect(screen.getByText('Failed to load Manager Desk')).toBeInTheDocument();
    expect(screen.getByText('Network failed')).toBeInTheDocument();
    expect(screen.getByText('Retry')).toBeInTheDocument();
  });

  it('shows empty day state when no items exist', () => {
    currentMockDay = {
      date: '2026-03-08',
      viewMode: 'live',
      items: [],
      summary: { totalOpen: 0, inbox: 0, planned: 0, inProgress: 0, waiting: 0, overdueFollowUps: 0, meetings: 0, completed: 0 },
    };
    render(
      <TestWrapper>
        <ManagerDeskPage />
      </TestWrapper>,
    );
    expect(screen.getByText('Clean slate')).toBeInTheDocument();
  });

  it('does not show a carry forward button in the persistent workspace model', () => {
    render(
      <TestWrapper>
        <ManagerDeskPage />
      </TestWrapper>,
    );
    expect(screen.queryByRole('button', { name: /^carry forward$/i })).not.toBeInTheDocument();
    expect(screen.getByText('Live')).toBeInTheDocument();
  });

  it('opens the item detail drawer with primary manager fields visible', () => {
    render(
      <TestWrapper>
        <ManagerDeskPage />
      </TestWrapper>,
    );

    fireEvent.click(screen.getByRole('button', { name: /^Open Analyze root cause for DEF-241$/i }));

    expect(screen.getByLabelText('Notes for today')).toBeInTheDocument();
    expect(screen.getByLabelText('Next Action')).toBeInTheDocument();
    expect(screen.getByLabelText('Assignee')).toHaveValue('alice-1');
  });

  it('lets a manager move a planned task back to inbox from the detail panel', () => {
    render(
      <TestWrapper>
        <ManagerDeskPage />
      </TestWrapper>,
    );

    fireEvent.click(screen.getByRole('button', { name: /^Open Analyze root cause for DEF-241$/i }));
    fireEvent.click(screen.getByRole('button', { name: /move to inbox/i }));

    expect(mockUpdateMutate).toHaveBeenCalledWith(
      {
        itemId: 1,
        status: 'inbox',
      },
      expect.anything(),
    );
  });

  it('lets a manager move a started task back to planned from the detail panel', () => {
    currentMockDay = {
      ...mockDayResponse,
      items: mockDayResponse.items.map((item) =>
        item.id === 1
          ? {
              ...item,
              status: 'in_progress',
            }
          : item,
      ),
    };

    render(
      <TestWrapper>
        <ManagerDeskPage />
      </TestWrapper>,
    );

    fireEvent.click(screen.getByRole('button', { name: /^Open Analyze root cause for DEF-241$/i }));
    fireEvent.click(screen.getByRole('button', { name: /back to planned/i }));

    expect(mockUpdateMutate).toHaveBeenCalledWith(
      {
        itemId: 1,
        status: 'planned',
      },
      expect.anything(),
    );
  });

  it('keeps later work in its parked desk section until it is brought back', () => {
    currentMockDay = {
      ...mockDayResponse,
      items: [
        ...mockDayResponse.items,
        mockItem({ id: 88, title: 'Review next quarter planning idea', status: 'backlog' }),
      ],
    };

    render(
      <TestWrapper>
        <ManagerDeskPage />
      </TestWrapper>,
    );

    expect(screen.getByRole('heading', { name: 'Today' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /later 1/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /later 1/i }));
    expect(screen.getByRole('heading', { name: 'Later' })).toBeInTheDocument();
    expect(screen.getByText('Review next quarter planning idea')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^Open Review next quarter planning idea$/i }));
    const dialog = screen.getByRole('dialog', { name: /manager desk item detail/i });
    fireEvent.click(within(dialog).getByRole('button', { name: /^bring back$/i }));

    expect(mockUpdateMutate).toHaveBeenCalledWith(
      {
        itemId: 88,
        status: 'inbox',
      },
      expect.anything(),
    );
  });

  it('moves open work to later from the detail panel more menu', () => {
    currentMockDay = {
      ...mockDayResponse,
      items: mockDayResponse.items.map((item) =>
        item.id === 1
          ? {
              ...item,
              status: 'in_progress',
            }
          : item,
      ),
    };

    render(
      <TestWrapper>
        <ManagerDeskPage />
      </TestWrapper>,
    );

    fireEvent.click(screen.getByRole('button', { name: /^Open Analyze root cause for DEF-241$/i }));
    const dialog = screen.getByRole('dialog', { name: /manager desk item detail/i });
    fireEvent.click(within(dialog).getByRole('button', { name: /move to later/i }));

    expect(mockUpdateMutate).toHaveBeenCalledWith(
      {
        itemId: 1,
        status: 'backlog',
      },
      expect.anything(),
    );
  });

  it('carries an item to a later day from the detail drawer', () => {
    render(
      <TestWrapper>
        <ManagerDeskPage />
      </TestWrapper>,
    );

    fireEvent.click(screen.getByRole('button', { name: /^Open Analyze root cause for DEF-241$/i }));
    const drawer = screen.getByRole('dialog', { name: /manager desk item detail/i });
    fireEvent.click(within(drawer).getByRole('button', { name: /carry forward analyze root cause/i }));

    const rescheduleDialog = screen.getByRole('dialog', { name: /^carry forward$/i });
    const dateInput = rescheduleDialog.querySelector('input[type="date"]') as HTMLInputElement;
    fireEvent.change(dateInput, { target: { value: '2026-03-10' } });
    fireEvent.click(within(rescheduleDialog).getByRole('button', { name: /^carry forward$/i }));

    expect(mockCarryForwardMutate).toHaveBeenCalledWith(
      { fromDate: '2026-03-08', toDate: '2026-03-10', itemIds: [1] },
      expect.anything(),
    );
  });

  it('moves started work to later from the row actions menu', () => {
    currentMockDay = {
      ...mockDayResponse,
      items: mockDayResponse.items.map((item) =>
        item.id === 1
          ? {
              ...item,
              status: 'in_progress',
            }
          : item,
      ),
    };

    render(
      <TestWrapper>
        <ManagerDeskPage />
      </TestWrapper>,
    );

    fireEvent.click(screen.getByRole('button', { name: /^More actions for Analyze root cause for DEF-241$/i }));
    fireEvent.click(screen.getByRole('button', { name: /^Move to later Analyze root cause for DEF-241$/i }));

    expect(mockUpdateMutate).toHaveBeenCalledWith(
      {
        itemId: 1,
        status: 'backlog',
      },
      expect.anything(),
    );
  });

  it('clears the row highlight and focus when the detail drawer closes', () => {
    render(
      <TestWrapper>
        <ManagerDeskPage />
      </TestWrapper>,
    );

    const firstCard = screen.getByRole('button', { name: /^Open Analyze root cause for DEF-241$/i });
    fireEvent.click(firstCard);

    expect(screen.getByLabelText('Manager Desk item detail')).toBeInTheDocument();
    expect(screen.getByTestId('selected-manager-desk-item-1')).toBeInTheDocument();

    const backdrop = document.querySelector('.workspace-shell-backdrop');
    expect(backdrop).toBeInTheDocument();
    fireEvent.click(backdrop as Element);

    expect(screen.queryByLabelText('Manager Desk item detail')).not.toBeInTheDocument();
    expect(screen.queryByTestId('selected-manager-desk-item-1')).not.toBeInTheDocument();
    expect(firstCard).not.toHaveFocus();
  });

  it('keeps only the currently opened row highlighted when switching tasks', () => {
    render(
      <TestWrapper>
        <ManagerDeskPage />
      </TestWrapper>,
    );

    const firstCard = screen.getByRole('button', { name: /^Open Analyze root cause for DEF-241$/i });
    const secondCard = screen.getByRole('button', { name: /^Open Quick inbox thought$/i });

    fireEvent.click(firstCard);
    expect(screen.getByTestId('selected-manager-desk-item-1')).toBeInTheDocument();

    fireEvent.click(secondCard);

    expect(screen.queryByTestId('selected-manager-desk-item-1')).not.toBeInTheDocument();
    expect(screen.getByTestId('selected-manager-desk-item-4')).toBeInTheDocument();
  });

  it('updates the assigned team member from the drawer', () => {
    render(
      <TestWrapper>
        <ManagerDeskPage />
      </TestWrapper>,
    );

    fireEvent.click(screen.getByRole('button', { name: /^Open Analyze root cause for DEF-241$/i }));
    fireEvent.change(screen.getByLabelText('Assignee'), { target: { value: 'bob-2' } });

    expect(mockUpdateMutate).toHaveBeenCalledWith(
      {
        itemId: 1,
        assigneeDeveloperAccountId: 'bob-2',
      },
      expect.anything(),
    );
  });

  it('keeps the owner field editable while delegated work is active', () => {
    currentMockDay = {
      ...mockDayResponse,
      items: mockDayResponse.items.map((item) =>
        item.id === 1
          ? {
              ...item,
              delegatedExecution: {
                trackerItemId: 88,
                state: 'in_progress' as const,
                updatedAt: '2026-03-08T09:15:00Z',
              },
            }
          : item,
      ),
    };

    render(
      <TestWrapper>
        <ManagerDeskPage />
      </TestWrapper>,
    );

    fireEvent.click(screen.getByRole('button', { name: /^Open Analyze root cause for DEF-241$/i }));

    const assigneeSelect = screen.getByLabelText('Assignee');
    expect(assigneeSelect).not.toBeDisabled();
    expect(within(assigneeSelect).getByRole('option', { name: 'Unassigned' })).toBeInTheDocument();
    expect(screen.getByText(/Delegated on the team board/i)).toBeInTheDocument();

    fireEvent.change(assigneeSelect, { target: { value: 'bob-2' } });
    expect(mockUpdateMutate).toHaveBeenCalledWith(
      { itemId: 1, assigneeDeveloperAccountId: 'bob-2' },
      expect.anything(),
    );

    fireEvent.change(assigneeSelect, { target: { value: '' } });
    expect(mockUpdateMutate).toHaveBeenCalledWith(
      { itemId: 1, assigneeDeveloperAccountId: null },
      expect.anything(),
    );
  });

  it('shows a compact Jira snapshot for linked issues in the drawer', () => {
    render(
      <TestWrapper>
        <ManagerDeskPage />
      </TestWrapper>,
    );

    fireEvent.click(screen.getByRole('button', { name: /^Open Analyze root cause for DEF-241$/i }));

    expect(screen.getByText('Linked Jira')).toBeInTheDocument();
    expect(screen.getByText('Rahul blocker on review flow')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /open in jira/i })).toHaveAttribute(
      'href',
      'https://test.atlassian.net/browse/PROJ-221',
    );
  });

  it('switches between linked Jira issues when multiple issue links exist', () => {
    currentMockDay = {
      ...mockDayResponse,
      items: mockDayResponse.items.map((item) =>
        item.id === 1
          ? {
              ...item,
              links: [
                { id: 11, itemId: 1, linkType: 'issue', issueKey: 'PROJ-221', displayLabel: 'PROJ-221', createdAt: '2026-03-08T09:00:00Z' },
                { id: 12, itemId: 1, linkType: 'issue', issueKey: 'PROJ-321', displayLabel: 'PROJ-321', createdAt: '2026-03-08T09:05:00Z' },
              ],
            }
          : item,
      ),
    };

    render(
      <TestWrapper>
        <ManagerDeskPage />
      </TestWrapper>,
    );

    fireEvent.click(screen.getByRole('button', { name: /^Open Analyze root cause for DEF-241$/i }));
    fireEvent.click(screen.getByRole('button', { name: 'PROJ-321' }));

    expect(screen.getByText('Investigate design gap in review flow')).toBeInTheDocument();
  });

  it('debounces context note updates from the drawer', () => {
    render(
      <TestWrapper>
        <ManagerDeskPage />
      </TestWrapper>,
    );

    fireEvent.click(screen.getByRole('button', { name: /^Open Analyze root cause for DEF-241$/i }));

    const notesField = screen.getByLabelText('Notes for today');
    fireEvent.change(notesField, { target: { value: 'Capture manager context in the detail drawer' } });

    expect(mockUpdateMutate).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(900);
    });

    expect(mockUpdateMutate).toHaveBeenCalledWith(
      {
        itemId: 1,
        contextNote: 'Mar 8, 2026:\nCapture manager context in the detail drawer',
      },
      expect.anything(),
    );
  });

  it('shows manager context as today plus past note entries', () => {
    currentMockDay = {
      ...mockDayResponse,
      items: mockDayResponse.items.map((item) =>
        item.id === 1
          ? {
              ...item,
              contextNote: 'Mar 7, 2026:\nReviewed blocker with QA and captured the dependency.',
            }
          : item,
      ),
    };

    render(
      <TestWrapper>
        <ManagerDeskPage />
      </TestWrapper>,
    );

    fireEvent.click(screen.getByRole('button', { name: /^Open Analyze root cause for DEF-241$/i }));

    expect(screen.getByLabelText('Notes for today')).toBeInTheDocument();
    expect(screen.getByText('Past entries')).toBeInTheDocument();
    expect(screen.getByText('Reviewed blocker with QA and captured the dependency.')).toBeInTheDocument();
  });

  it('commits next action changes on blur when the debounce has not fired yet', () => {
    render(
      <TestWrapper>
        <ManagerDeskPage />
      </TestWrapper>,
    );

    fireEvent.click(screen.getByRole('button', { name: /^Open Analyze root cause for DEF-241$/i }));

    const nextActionField = screen.getByLabelText('Next Action');
    fireEvent.change(nextActionField, { target: { value: 'Schedule follow-up with QA and product' } });
    fireEvent.blur(nextActionField);

    expect(mockUpdateMutate).toHaveBeenCalledWith(
      {
        itemId: 1,
        nextAction: 'Schedule follow-up with QA and product',
      },
      expect.anything(),
    );
  });

  it('sends null when optional drawer fields are cleared', () => {
    currentMockDay = {
      ...mockDayResponse,
      items: mockDayResponse.items.map((item) =>
        item.id === 1
          ? {
              ...item,
              nextAction: 'Follow up with QA after design review',
              plannedStartAt: '2026-03-08T10:00:00.000Z',
            }
          : item,
      ),
    };

    render(
      <TestWrapper>
        <ManagerDeskPage />
      </TestWrapper>,
    );

    fireEvent.click(screen.getByRole('button', { name: /^Open Analyze root cause for DEF-241$/i }));

    const nextActionField = screen.getByLabelText('Next Action');
    fireEvent.change(nextActionField, { target: { value: '   ' } });
    fireEvent.blur(nextActionField);

    fireEvent.click(screen.getByText('Details'));
    const startField = screen
      .getAllByLabelText('Start')
      .find((element) => element instanceof HTMLInputElement && element.type === 'datetime-local');
    expect(startField).toBeDefined();
    fireEvent.change(startField!, { target: { value: '' } });

    expect(mockUpdateMutate).toHaveBeenCalledWith(
      {
        itemId: 1,
        nextAction: null,
      },
      expect.anything(),
    );
    expect(mockUpdateMutate).toHaveBeenCalledWith(
      {
        itemId: 1,
        plannedStartAt: null,
      },
      expect.anything(),
    );
  });

  it('keeps next action primary and outcome in the secondary details section', () => {
    render(
      <TestWrapper>
        <ManagerDeskPage />
      </TestWrapper>,
    );

    fireEvent.click(screen.getByRole('button', { name: /^Open Analyze root cause for DEF-241$/i }));

    expect(screen.getByLabelText('Next Action')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Details'));
    expect(screen.getByLabelText('Outcome')).toBeInTheDocument();
  });

  it('shows the properties section with kind and status fields in the drawer', () => {
    render(
      <TestWrapper>
        <ManagerDeskPage />
      </TestWrapper>,
    );

    fireEvent.click(screen.getByRole('button', { name: /^Open Analyze root cause for DEF-241$/i }));

    expect(screen.getByLabelText('Notes for today')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Details'));
    expect(screen.getByLabelText('Kind')).toBeInTheDocument();
    expect(screen.getByLabelText('Status')).toBeInTheDocument();
    expect(screen.getByLabelText('Category')).toBeInTheDocument();
    expect(screen.getByLabelText('Priority')).toBeInTheDocument();
  });

  it('uses the desk map as the live desk status control', () => {
    render(
      <TestWrapper>
        <ManagerDeskPage />
      </TestWrapper>,
    );

    expect(screen.getByRole('button', { name: /today 5/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /now 0/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /triage 1/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /planned 3/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^waiting \d+$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /needs attention/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /done 1/i })).toBeInTheDocument();
    expect(screen.queryByText(/A new day changes the lens/i)).not.toBeInTheDocument();
  });

  it('keeps the desk pulse rail visible in filtered desk lenses', () => {
    render(
      <TestWrapper>
        <ManagerDeskPage />
      </TestWrapper>,
    );

    fireEvent.click(screen.getByRole('button', { name: /triage 1/i }));

    expect(screen.getByRole('heading', { name: 'Needs triage' })).toBeInTheDocument();
    const triageRail = screen.getByLabelText('Desk pulse');
    expect(within(triageRail).getByText('Pulse')).toBeInTheDocument();
    expect(within(triageRail).getByText('Planned')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /now 0/i }));

    expect(screen.getByText('Nothing is in motion right now.')).toBeInTheDocument();
    expect(screen.getByLabelText('Desk pulse')).toBeInTheDocument();
  });

  it('collapses and expands desk rhythm sections, expanded by default', () => {
    render(
      <TestWrapper>
        <ManagerDeskPage />
      </TestWrapper>,
    );

    const triageToggle = screen.getByRole('button', { name: 'Needs triage' });
    const plannedToggle = screen.getByRole('button', { name: 'Planned' });
    expect(triageToggle).toHaveAttribute('aria-expanded', 'true');
    expect(plannedToggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getAllByText('Quick inbox thought').length).toBeGreaterThan(0);

    fireEvent.click(triageToggle);

    expect(triageToggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Quick inbox thought')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Needs triage' })).toBeInTheDocument();
    // Other sections stay expanded.
    expect(plannedToggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getAllByText('Waiting on QA feedback').length).toBeGreaterThan(0);

    fireEvent.click(triageToggle);

    expect(triageToggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getAllByText('Quick inbox thought').length).toBeGreaterThan(0);
  });

  it('reveals carried-over items through the continued counts and marks them on cards', () => {
    currentMockDay = {
      ...mockDayResponse,
      items: [
        mockItem({ id: 10, title: 'Follow up on review escalation', originDate: '2026-03-06', status: 'planned' }),
        mockItem({ id: 11, title: 'Stale triage note', originDate: '2026-03-07', status: 'inbox' }),
        mockItem({ id: 12, title: 'Fresh capture today', originDate: '2026-03-08', status: 'inbox' }),
        mockItem({ id: 13, title: 'Closed earlier item', originDate: '2026-03-06', status: 'done' }),
      ],
    };

    render(
      <TestWrapper>
        <ManagerDeskPage />
      </TestWrapper>,
    );

    // Card markers distinguish carried items in the default rhythm view.
    expect(screen.getAllByText('Continued from Mar 6').length).toBe(1);
    expect(screen.getAllByText('Continued from Mar 7').length).toBe(1);
    const freshCard = screen.getByRole('button', { name: /^Open Fresh capture today$/i });
    expect(within(freshCard).queryByText(/Continued from/)).not.toBeInTheDocument();

    // The command bar chip and the header pill expose the same open carried set.
    expect(screen.getByRole('button', { name: /carried 2/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /show the 2 open items continued from earlier days/i }));

    expect(screen.getByRole('heading', { name: 'Carried over' })).toBeInTheDocument();
    expect(screen.getAllByText('Follow up on review escalation').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Stale triage note').length).toBeGreaterThan(0);
    expect(screen.queryByText('Fresh capture today')).not.toBeInTheDocument();
    expect(screen.queryByText('Closed earlier item')).not.toBeInTheDocument();

    // The pulse rail count reflects the same lens and marks itself active.
    const rail = screen.getByLabelText('Desk pulse');
    const railCarried = within(rail).getByRole('button', { name: /from earlier/i, hidden: true });
    expect(railCarried).toHaveAttribute('aria-pressed', 'true');
    expect(within(railCarried).getByText('2')).toBeInTheDocument();
  });

  it('activates the carried lens from the pulse rail count', () => {
    currentMockDay = {
      ...mockDayResponse,
      items: [
        mockItem({ id: 10, title: 'Follow up on review escalation', originDate: '2026-03-06', status: 'planned' }),
        mockItem({ id: 12, title: 'Fresh capture today', originDate: '2026-03-08', status: 'inbox' }),
      ],
    };

    render(
      <TestWrapper>
        <ManagerDeskPage />
      </TestWrapper>,
    );

    const rail = screen.getByLabelText('Desk pulse');
    fireEvent.click(within(rail).getByRole('button', { name: /from earlier/i, hidden: true }));

    expect(screen.getByRole('heading', { name: 'Carried over' })).toBeInTheDocument();
    expect(screen.getAllByText('Follow up on review escalation').length).toBeGreaterThan(0);
    expect(screen.queryByText('Fresh capture today')).not.toBeInTheDocument();
  });

  it('shows filter button and toggles filter bar', () => {
    render(
      <TestWrapper>
        <ManagerDeskPage />
      </TestWrapper>,
    );
    const filterBtn = screen.getByRole('button', { name: /filters/i });
    expect(filterBtn).toBeInTheDocument();
    fireEvent.click(filterBtn);
    expect(screen.getByText('Clear')).toBeInTheDocument();
  });

  it('resets search and desk map back to the today view', () => {
    render(
      <TestWrapper>
        <ManagerDeskPage />
      </TestWrapper>,
    );

    expect(screen.getByRole('heading', { name: 'Today' })).toBeInTheDocument();

    fireEvent.change(screen.getByRole('textbox', { name: /search manager desk tasks/i }), {
      target: { value: 'Design' },
    });

    fireEvent.click(screen.getByRole('button', { name: /^reset$/i }));

    expect(screen.getByRole('heading', { name: 'Today' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /search manager desk tasks/i })).toHaveValue('');
    expect(screen.queryByRole('button', { name: /^reset$/i })).not.toBeInTheDocument();
  });

  it('manually refreshes only the manager desk query from the page header', () => {
    render(
      <TestWrapper>
        <ManagerDeskPage />
      </TestWrapper>,
    );

    fireEvent.click(screen.getByRole('button', { name: /refresh/i }));

    expect(mockRefetch).toHaveBeenCalled();
  });

  it('shows a read-only history banner and disables capture on past dates', () => {
    currentMockDay = {
      ...mockDayResponse,
      viewMode: 'history',
      createdThatDayItems: [mockItem({ id: 44, title: 'Captured on that day', status: 'inbox' })],
    };

    render(
      <TestWrapper>
        <ManagerDeskPage />
      </TestWrapper>,
    );

    expect(screen.getByText('History')).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Quick capture/i)).toBeDisabled();
    expect(screen.getByRole('button', { name: /captured \(1\)/i })).toBeInTheDocument();
  });

  it('switches historical subviews between end-of-day and captured-that-day lists', () => {
    currentMockDay = {
      ...mockDayResponse,
      viewMode: 'history',
      items: [mockItem({ id: 1, title: 'Open at end of day', status: 'planned' })],
      createdThatDayItems: [mockItem({ id: 44, title: 'Captured on that day', status: 'inbox' })],
    };

    render(
      <TestWrapper>
        <ManagerDeskPage />
      </TestWrapper>,
    );

    expect(screen.getAllByText('Open at end of day').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: /captured \(1\)/i }));
    expect(screen.getAllByText('Captured on that day').length).toBeGreaterThan(0);
  });

  it('opens historical item detail in read-only mode', () => {
    currentMockDay = {
      ...mockDayResponse,
      viewMode: 'history',
      createdThatDayItems: [],
    };

    render(
      <TestWrapper>
        <ManagerDeskPage />
      </TestWrapper>,
    );

    fireEvent.click(screen.getByRole('button', { name: /^Open Analyze root cause for DEF-241$/i }));

    expect(screen.getByText(/historical record stays easy to inspect/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Start Analyze root cause for DEF-241$/i })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Item title')).toHaveAttribute('readonly');
  });

  it('still shows the private note source link on a read-only historical item', () => {
    currentMockDay = {
      ...mockDayResponse,
      viewMode: 'history',
      createdThatDayItems: [],
    };
    mockNoteSources = [{ itemId: 1, noteId: 9, date: '2026-03-05' }];

    render(
      <TestWrapper>
        <ManagerDeskPage />
      </TestWrapper>,
    );

    fireEvent.click(screen.getByRole('button', { name: /^Open Analyze root cause for DEF-241$/i }));

    expect(screen.getByLabelText('Item title')).toHaveAttribute('readonly');
    const link = screen.getByRole('link', { name: 'Open source note from 2026-03-05' });
    expect(link).toHaveAttribute('href', '/notes?date=2026-03-05');
    expect(link).toHaveTextContent('Source: Mar 5 notes');
  });

  it('shows a lighter planning banner for future dates', () => {
    currentMockDay = {
      ...mockDayResponse,
      viewMode: 'planning',
      items: [mockItem({ id: 77, title: 'Planned for tomorrow', originDate: '2026-03-09', status: 'planned' })],
    };

    render(
      <TestWrapper>
        <ManagerDeskPage />
      </TestWrapper>,
    );

    expect(screen.getByText('Planning')).toBeInTheDocument();
    expect(screen.getByText(/lighter scheduling view/i)).toBeInTheDocument();
    expect(screen.getAllByText('Planned for tomorrow').length).toBeGreaterThan(0);
  });
});
