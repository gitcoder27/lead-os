import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { addDays, format } from 'date-fns';
import type { OneOnOneAgendaItem, OneOnOneSeriesDetail, OneOnOneSeriesSummary, OneOnOneSuggestionsResponse } from '@/types';
import { OneOnOneWorkspace } from '@/components/team-tracker/OneOnOneWorkspace';
import { OneOnOneAgendaButton } from '@/components/team-tracker/OneOnOneAgendaButton';
import { TrackerItemRowActions } from '@/components/team-tracker/TrackerItemRowActions';
import { getLocalIsoDate } from '@/lib/utils';
import { OneOnOneSeriesPanel } from '@/components/team-tracker/OneOnOneSeriesPanel';
import { TrackerBoardToolbar } from '@/components/team-tracker/TrackerBoardToolbar';

const mockCreateSeries = vi.fn();
const mockUpdateSeries = vi.fn();
const mockUpdateSession = vi.fn();
const mockCreateSession = vi.fn();
const mockCreateAction = vi.fn();
const mockAttach = vi.fn();
const mockReorder = vi.fn();
const mockDetach = vi.fn();
const mockAddToast = vi.fn();
const mockQuickAttach = vi.fn();

let mockEnabled = true;
let mockList: { data?: { series: OneOnOneSeriesSummary[] }; isLoading: boolean } = { data: { series: [] }, isLoading: false };
let mockDetail: { data?: OneOnOneSeriesDetail; isError?: boolean } = { data: undefined };
let mockSuggestions: { data?: OneOnOneSuggestionsResponse; isLoading: boolean } = { data: undefined, isLoading: false };

vi.mock('@/context/ToastContext', () => ({
  useToast: () => ({ addToast: mockAddToast }),
}));

vi.mock('@/hooks/useNoteEntityLookups', () => ({
  useNoteEntityLookups: () => ({
    previewTask: async () => null,
    previewIssue: async () => null,
    searchTasks: async () => [],
    searchIssues: async () => [],
  }),
}));

vi.mock('@/hooks/useOneOnOne', () => ({
  useOneOnOneEnabled: () => mockEnabled,
  useOneOnOneSuggestions: () => mockSuggestions,
  useQuickAttachOneOnOneAgenda: () => ({ mutate: mockQuickAttach, isPending: false }),
  useOneOnOneSeriesList: () => mockList,
  useOneOnOneSeries: () => mockDetail,
  useOneOnOneSeriesForDeveloper: (accountId: string | undefined) => ({
    ...mockList,
    series: accountId ? mockList.data?.series.find((entry) => entry.developerAccountId === accountId) ?? null : null,
  }),
  useCreateOneOnOneSeries: () => ({ mutate: mockCreateSeries, isPending: false }),
  useUpdateOneOnOneSeries: () => ({ mutate: mockUpdateSeries, isPending: false }),
  useUpdateOneOnOneSession: () => ({ mutate: mockUpdateSession, isPending: false }),
  useCreateOneOnOneSession: () => ({ mutate: mockCreateSession, isPending: false }),
  useCreateOneOnOneSessionAction: () => ({ mutate: mockCreateAction, isPending: false }),
  useAttachOneOnOneAgendaItem: () => ({ mutate: mockAttach, isPending: false }),
  useAttachOneOnOneAgendaItemToSeries: () => ({ mutate: mockAttach, isPending: false }),
  useReorderOneOnOneAgenda: () => ({ mutate: mockReorder, isPending: false }),
  useDetachOneOnOneAgendaItem: () => ({ mutate: mockDetach, isPending: false }),
}));

function summary(overrides: Partial<OneOnOneSeriesSummary> = {}): OneOnOneSeriesSummary {
  return {
    id: 5,
    developerAccountId: 'dev-1',
    developerName: 'Alice Smith',
    cadence: 'weekly',
    preferredWeekday: null,
    active: true,
    nextSessionDate: '2026-03-09',
    nextSessionOverdueDays: 0,
    openAgendaCount: 2,
    createdAt: '2026-03-01T08:00:00Z',
    ...overrides,
  };
}

function agendaTask(overrides: Partial<OneOnOneAgendaItem['task']> & Pick<OneOnOneAgendaItem['task'], 'taskId' | 'taskKey' | 'title'>): OneOnOneAgendaItem['task'] {
  return {
    status: 'open',
    ownerType: 'developer',
    ownerId: 'dev-1',
    priority: 'normal',
    scheduledOn: null,
    dueAt: null,
    closedAt: null,
    deletedAt: null,
    ...overrides,
  };
}

function agendaItem(id: number, task: OneOnOneAgendaItem['task'], overrides: Partial<OneOnOneAgendaItem> = {}): OneOnOneAgendaItem {
  return { id, seriesId: 5, taskId: task.taskId, position: id, addedAt: '2026-03-05T08:00:00Z', carriedFrom: null, task, ...overrides };
}

function detail(overrides: Partial<OneOnOneSeriesDetail> = {}): OneOnOneSeriesDetail {
  return {
    series: summary(),
    upcoming: {
      id: 11,
      seriesId: 5,
      scheduledFor: '2026-03-09',
      status: 'scheduled',
      notes: '',
      startedAt: null,
      completedAt: null,
      createdAt: '2026-03-02T08:00:00Z',
      agendaCount: 2,
    },
    sessions: [
      {
        id: 11,
        seriesId: 5,
        scheduledFor: '2026-03-09',
        status: 'scheduled',
        notes: '',
        startedAt: null,
        completedAt: null,
        createdAt: '2026-03-02T08:00:00Z',
        agendaCount: 2,
      },
      {
        id: 10,
        seriesId: 5,
        scheduledFor: '2026-03-02',
        status: 'done',
        notes: 'Talked about the migration',
        startedAt: '2026-03-02T09:00:00Z',
        completedAt: '2026-03-02T09:30:00Z',
        createdAt: '2026-02-23T08:00:00Z',
        agendaCount: 1,
      },
    ],
    agenda: [
      {
        id: 101,
        seriesId: 5,
        taskId: 1,
        position: 0,
        addedAt: '2026-02-20T08:00:00Z',
        carriedFrom: '2026-03-02',
        task: agendaTask({ taskId: 1, taskKey: 'T-1', title: 'Review queue' }),
      },
      {
        id: 102,
        seriesId: 5,
        taskId: 2,
        position: 1,
        addedAt: '2026-03-05T08:00:00Z',
        carriedFrom: null,
        task: agendaTask({ taskId: 2, taskKey: 'T-2', title: 'Career goals' }),
      },
    ],
    ...overrides,
  };
}

const toolbarProps = {
  searchQuery: '',
  onSearchChange: vi.fn(),
  sortBy: 'name' as const,
  onSortChange: vi.fn(),
  groupBy: 'none' as const,
  onGroupChange: vi.fn(),
  visibleCount: 2,
  totalCount: 2,
  views: [],
  activeViewId: undefined,
  isDirty: false,
  isViewsLoading: false,
  onApplyView: vi.fn(),
  onClearView: vi.fn(),
  onSaveNew: vi.fn(),
  onUpdateView: vi.fn(),
  onDeleteView: vi.fn(),
  isSaving: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockEnabled = true;
  mockList = { data: { series: [summary()] }, isLoading: false };
  mockDetail = { data: detail() };
  mockSuggestions = { data: { tasks: [], checkIn: null }, isLoading: false };
});

describe('OneOnOneWorkspace', () => {
  it('renders the agenda, session, and history columns', () => {
    render(<OneOnOneWorkspace developerAccountId="dev-1" onClose={vi.fn()} />);
    expect(screen.getByTestId('one-on-one-workspace')).toBeInTheDocument();
    expect(screen.getByText('1:1 — Alice Smith')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '1:1 agenda' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '1:1 session' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '1:1 history' })).toBeInTheDocument();
    const agenda = screen.getByTestId('one-on-one-agenda');
    expect(within(agenda).getByText('Review queue')).toBeInTheDocument();
    expect(within(agenda).getByText('Career goals')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Session date: Mon, Mar 9/ })).toBeInTheDocument();
    expect(screen.getByText('Talked about the migration')).toBeInTheDocument();
  });

  it('renders the carried-from marker on carried agenda items', () => {
    render(<OneOnOneWorkspace developerAccountId="dev-1" onClose={vi.fn()} />);
    expect(screen.getByText(/carried from Mar 2/)).toBeInTheDocument();
    // The non-carried item renders no marker.
    expect(screen.queryAllByText(/carried from/)).toHaveLength(1);
  });

  it('reorders with Alt+ArrowDown and detaches via the remove button', () => {
    render(<OneOnOneWorkspace developerAccountId="dev-1" onClose={vi.fn()} />);
    fireEvent.keyDown(screen.getByTestId('agenda-item-101'), { key: 'ArrowDown', altKey: true });
    expect(mockReorder).toHaveBeenCalledWith({ itemIds: [102, 101] }, expect.anything());

    fireEvent.click(screen.getByLabelText('Remove T-2 from agenda'));
    expect(mockDetach).toHaveBeenCalledWith(102, expect.anything());
  });

  it('completes a session through the keep-open confirm', () => {
    render(<OneOnOneWorkspace developerAccountId="dev-1" onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Complete' }));
    fireEvent.click(screen.getByRole('button', { name: 'Keep open — complete' }));
    expect(mockUpdateSession).toHaveBeenCalledWith(
      { sessionId: 11, status: 'done', reopenCarried: true },
      expect.anything(),
    );
  });

  it('completes with detach when the manager declines carry', () => {
    render(<OneOnOneWorkspace developerAccountId="dev-1" onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Complete' }));
    fireEvent.click(screen.getByRole('button', { name: 'Detach items — complete' }));
    expect(mockUpdateSession).toHaveBeenCalledWith(
      { sessionId: 11, status: 'done', reopenCarried: false },
      expect.anything(),
    );
  });

  it('skips a session and starts a live session', () => {
    render(<OneOnOneWorkspace developerAccountId="dev-1" onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
    expect(mockUpdateSession).toHaveBeenCalledWith({ sessionId: 11, status: 'skipped' }, expect.anything());

    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    expect(mockUpdateSession).toHaveBeenCalledWith({ sessionId: 11, started: true }, expect.anything());
  });

  it('creates freeform agenda items and session action items', () => {
    render(<OneOnOneWorkspace developerAccountId="dev-1" onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Add to agenda'), { target: { value: 'Ask about PTO' } });
    fireEvent.submit(screen.getByLabelText('Add to agenda').closest('form')!);
    expect(mockAttach).toHaveBeenCalledWith({ title: 'Ask about PTO' }, expect.anything());

    fireEvent.change(screen.getByLabelText('Add action item'), { target: { value: 'Ship perf fix' } });
    fireEvent.click(screen.getByLabelText('Create action item'));
    // P0-S5: private by default — the developer never sees it unless assigned.
    expect(mockCreateAction).toHaveBeenCalledWith({ sessionId: 11, title: 'Ship perf fix', ownerType: 'manager' }, expect.anything());
    expect(screen.getByText(/stay private/)).toBeInTheDocument();
  });

  it('assigns action items to the developer only after an explicit, labelled choice', () => {
    render(<OneOnOneWorkspace developerAccountId="dev-1" onClose={vi.fn()} />);
    fireEvent.click(screen.getByLabelText(/Assign action items to/));
    expect(screen.getByText(/visible to .* in My Day/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Add action item'), { target: { value: 'Write the RFC' } });
    fireEvent.click(screen.getByLabelText('Create action item'));
    expect(mockCreateAction).toHaveBeenCalledWith({ sessionId: 11, title: 'Write the RFC', ownerType: 'developer' }, expect.anything());
  });

  it('offers series creation when none exists and closes on Escape', () => {
    mockList = { data: { series: [] }, isLoading: false };
    mockDetail = { data: undefined };
    const onClose = vi.fn();
    render(<OneOnOneWorkspace developerAccountId="dev-2" onClose={onClose} />);
    expect(screen.getByText('No 1:1 series yet')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Start 1:1 series' }));
    expect(mockCreateSeries).toHaveBeenCalledWith({ developerAccountId: 'dev-2', cadence: 'weekly' }, expect.anything());

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('leaves Escape to a layer stacked above it and blurs a focused field first (docs/54)', () => {
    const onClose = vi.fn();
    render(<OneOnOneWorkspace developerAccountId="dev-1" onClose={onClose} />);

    const layer = document.createElement('div');
    layer.setAttribute('aria-modal', 'true');
    document.body.appendChild(layer);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    layer.remove();

    const agenda = screen.getByLabelText('Add to agenda');
    agenda.focus();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    expect(document.activeElement).not.toBe(agenda);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('n focuses the agenda input and ? opens the shortcut sheet (docs/54 K2)', () => {
    render(<OneOnOneWorkspace developerAccountId="dev-1" onClose={vi.fn()} />);
    fireEvent.keyDown(document, { key: 'n' });
    expect(screen.getByLabelText('Add to agenda')).toHaveFocus();
    (document.activeElement as HTMLElement).blur();
    fireEvent.keyDown(document, { key: '?' });
    expect(screen.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeInTheDocument();
  });
});

describe('OneOnOneWorkspace — agenda guidance and suggestions', () => {
  it('teaches the model when the agenda is empty', () => {
    mockDetail = { data: detail({ agenda: [] }) };
    render(<OneOnOneWorkspace developerAccountId="dev-1" onClose={vi.fn()} />);
    expect(screen.getByText(/Topics to raise with Alice/)).toBeInTheDocument();
    const empty = screen.getByTestId('one-on-one-agenda-empty');
    expect(within(empty).getByText('Nothing on the agenda yet')).toBeInTheDocument();
    expect(within(empty).getByText(/Add to 1:1 agenda/)).toBeInTheDocument();
  });

  it('offers one-tap suggestions with reasons, including a no-check-in topic', () => {
    mockSuggestions = {
      isLoading: false,
      data: {
        tasks: [
          { task: agendaTask({ taskId: 7, taskKey: 'T-7', title: 'Flaky deploy', status: 'blocked' }), reasons: [{ code: 'blocked' }, { code: 'stale', days: 6 }] },
          { task: agendaTask({ taskId: 8, taskKey: 'T-8', title: 'Quarterly report' }), reasons: [{ code: 'overdue', days: 2, source: 'due' }] },
        ],
        checkIn: { lastCheckInAt: null, days: null },
      },
    };
    render(<OneOnOneWorkspace developerAccountId="dev-1" onClose={vi.fn()} />);
    const panel = screen.getByTestId('one-on-one-suggestions');
    expect(within(panel).getByText("Suggested from Alice's work")).toBeInTheDocument();
    expect(within(panel).getByText('Blocked')).toBeInTheDocument();
    expect(within(panel).getByText('Quiet 6d')).toBeInTheDocument();
    expect(within(panel).getByText('Overdue 2d')).toBeInTheDocument();
    expect(within(panel).getByText('No check-ins yet')).toBeInTheDocument();

    fireEvent.click(within(panel).getByRole('button', { name: 'Add to agenda: Flaky deploy' }));
    expect(mockAttach).toHaveBeenCalledWith({ taskId: 7 }, expect.anything());
    fireEvent.click(within(panel).getByRole('button', { name: 'Add to agenda: Check in — how are things going?' }));
    expect(mockAttach).toHaveBeenCalledWith({ title: 'Check in — how are things going?' }, expect.anything());

    fireEvent.click(within(panel).getByRole('button', { name: 'Dismiss suggestion: Quarterly report' }));
    expect(within(panel).queryByText('Quarterly report')).not.toBeInTheDocument();
  });

  it('caps suggestions and reveals the rest on demand', () => {
    mockSuggestions = {
      isLoading: false,
      data: {
        tasks: [1, 2, 3, 4, 5].map((n) => ({
          task: agendaTask({ taskId: 20 + n, taskKey: `T-2${n}`, title: `Idle thing ${n}` }),
          reasons: [{ code: 'stale' as const, days: 5 + n }],
        })),
        checkIn: null,
      },
    };
    render(<OneOnOneWorkspace developerAccountId="dev-1" onClose={vi.fn()} />);
    expect(screen.queryByText('Idle thing 4')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show 2 more' }));
    expect(screen.getByText('Idle thing 5')).toBeInTheDocument();
  });

  it('agenda rows show live task state and reorder keeps closed links in the permutation', () => {
    const past = format(addDays(new Date(), -3), 'yyyy-MM-dd');
    mockDetail = {
      data: detail({
        agenda: [
          agendaItem(101, agendaTask({ taskId: 1, taskKey: 'T-1', title: 'Review queue', status: 'blocked', priority: 'high' })),
          agendaItem(102, agendaTask({ taskId: 2, taskKey: 'T-2', title: 'Career goals', dueAt: `${past}T12:00:00Z` })),
          agendaItem(103, agendaTask({ taskId: 3, taskKey: 'T-3', title: 'Shipped the fix', status: 'done', closedAt: '2026-03-04T10:00:00Z' })),
        ],
      }),
    };
    render(<OneOnOneWorkspace developerAccountId="dev-1" onClose={vi.fn()} />);
    const blocked = screen.getByTestId('agenda-item-101');
    expect(within(blocked).getByText('Blocked')).toBeInTheDocument();
    expect(within(blocked).getByLabelText('High priority')).toBeInTheDocument();
    expect(within(screen.getByTestId('agenda-item-102')).getByText(/3d late/)).toBeInTheDocument();
    // The closed topic leaves the open list but is a talking point since the last session.
    expect(screen.queryByTestId('agenda-item-103')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Closed since last 1:1/ }));
    expect(screen.getByText('Shipped the fix')).toBeInTheDocument();

    fireEvent.keyDown(blocked, { key: 'ArrowDown', altKey: true });
    expect(mockReorder).toHaveBeenCalledWith({ itemIds: [102, 101, 103] }, expect.anything());
  });
});

describe('OneOnOneWorkspace — session and history', () => {
  it('reschedules through the date popover', () => {
    render(<OneOnOneWorkspace developerAccountId="dev-1" onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Session date:/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Tomorrow/ }));
    const tomorrow = format(addDays(new Date(`${getLocalIsoDate()}T00:00:00`), 1), 'yyyy-MM-dd');
    expect(mockUpdateSession).toHaveBeenCalledWith({ sessionId: 11, scheduledFor: tomorrow }, expect.anything());
  });

  it('schedules a session when none is upcoming', () => {
    mockDetail = { data: detail({ upcoming: null }) };
    render(<OneOnOneWorkspace developerAccountId="dev-1" onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Schedule for today' }));
    expect(mockCreateSession).toHaveBeenCalledWith({ scheduledFor: getLocalIsoDate() }, expect.anything());
  });

  it('pauses and resumes the series from the controls', () => {
    render(<OneOnOneWorkspace developerAccountId="dev-1" onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Pause series/ }));
    expect(mockUpdateSeries).toHaveBeenCalledWith({ active: false }, expect.anything());
  });

  it('shows the live chip once started and renders session notes in the Notes editor', () => {
    const base = detail();
    mockDetail = { data: { ...base, upcoming: { ...base.upcoming!, startedAt: '2026-03-09T09:00:00Z', notes: 'Asked about **on-call**' } } };
    render(<OneOnOneWorkspace developerAccountId="dev-1" onClose={vi.fn()} />);
    expect(screen.getByText(/Live · since/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Session notes')).toBeInTheDocument();
    expect(screen.getByTestId('one-on-one-notes')).toHaveTextContent('on-call');
  });

  it('leads history with the last session: notes and the topics that were on the agenda', () => {
    render(<OneOnOneWorkspace developerAccountId="dev-1" onClose={vi.fn()} />);
    const last = screen.getByTestId('one-on-one-last-session');
    expect(within(last).getByText('Last time')).toBeInTheDocument();
    expect(within(last).getByText('Talked about the migration')).toBeInTheDocument();
    // T-1 was attached before the Mar 2 session closed; T-2 came after.
    expect(within(last).getByText('Review queue')).toBeInTheDocument();
    expect(within(last).queryByText('Career goals')).not.toBeInTheDocument();
  });

  it('lists earlier sessions with a one-line preview', () => {
    const base = detail();
    mockDetail = {
      data: {
        ...base,
        sessions: [
          ...base.sessions,
          {
            id: 9,
            seriesId: 5,
            scheduledFor: '2026-02-23',
            status: 'skipped',
            notes: '- [ ] Revisit **hiring** plan',
            startedAt: null,
            completedAt: '2026-02-23T10:00:00Z',
            createdAt: '2026-02-16T08:00:00Z',
            agendaCount: 0,
          },
        ],
      },
    };
    render(<OneOnOneWorkspace developerAccountId="dev-1" onClose={vi.fn()} />);
    expect(screen.getByText('Earlier')).toBeInTheDocument();
    expect(screen.getByText('Revisit hiring plan')).toBeInTheDocument();
    expect(screen.getByText('Skipped')).toBeInTheDocument();
  });
});

describe('Add to 1:1 agenda (developer drawer rows)', () => {
  it('attaches by developer and offers to open the workspace', () => {
    mockQuickAttach.mockImplementation((_body: unknown, options?: { onSuccess?: (result: unknown) => void }) =>
      options?.onSuccess?.({ item: {}, seriesId: 5, developerName: 'Alice Smith', seriesCreated: true }),
    );
    const onOpenOneOnOne = vi.fn();
    render(<OneOnOneAgendaButton developerAccountId="dev-1" taskKey="T-9" title="Ship it" onOpenOneOnOne={onOpenOneOnOne} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add Ship it to 1:1 agenda' }));
    expect(mockQuickAttach).toHaveBeenCalledWith({ developerAccountId: 'dev-1', taskKey: 'T-9' }, expect.anything());
    const toast = mockAddToast.mock.calls[0]![0] as { title: string; message?: string; action?: { onClick: () => void } };
    expect(toast.title).toBe("Added to Alice's 1:1 agenda");
    expect(toast.message).toMatch(/Started a weekly 1:1 series/);
    toast.action!.onClick();
    expect(onOpenOneOnOne).toHaveBeenCalledWith('dev-1');
  });

  it('reports a duplicate as info rather than an error', () => {
    mockQuickAttach.mockImplementation((_body: unknown, options?: { onError?: (error: unknown) => void }) =>
      options?.onError?.(new Error('Task is already on the agenda')),
    );
    render(<OneOnOneAgendaButton developerAccountId="dev-1" taskKey="T-9" title="Ship it" />);
    fireEvent.click(screen.getByRole('button', { name: 'Add Ship it to 1:1 agenda' }));
    expect(mockAddToast).toHaveBeenCalledWith('Already on the 1:1 agenda', 'info');
  });

  it('renders in the drawer row hover toolbar', () => {
    render(
      <TrackerItemRowActions
        itemId={1}
        itemTitle="Ship it"
        itemState="planned"
        actionPreset="hover-start"
        onSetCurrent={vi.fn()}
        extraActions={<OneOnOneAgendaButton developerAccountId="dev-1" taskKey="T-9" title="Ship it" />}
      />,
    );
    expect(screen.getByRole('button', { name: 'Start Ship it' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add Ship it to 1:1 agenda' })).toBeInTheDocument();
  });
});

describe('OneOnOneSeriesPanel', () => {
  it('lists series with next session, overdue state and agenda counts', () => {
    mockList = {
      data: {
        series: [
          summary(),
          summary({ id: 6, developerAccountId: 'dev-2', developerName: 'Bob Jones', nextSessionDate: '2026-03-01', nextSessionOverdueDays: 6, openAgendaCount: 0 }),
        ],
      },
      isLoading: false,
    };
    const onOpenDeveloper = vi.fn();
    render(
      <OneOnOneSeriesPanel
        developers={[
          { accountId: 'dev-1', displayName: 'Alice Smith', isActive: true },
          { accountId: 'dev-2', displayName: 'Bob Jones', isActive: true },
        ]}
        onOpenDeveloper={onOpenDeveloper}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByTestId('one-on-one-series-panel')).toBeInTheDocument();
    expect(screen.getByText('Alice Smith')).toBeInTheDocument();
    expect(screen.getByText('overdue 6d')).toBeInTheDocument();
    expect(screen.getAllByText(/agenda$/)).toHaveLength(2);

    fireEvent.click(screen.getByTestId('one-on-one-series-dev-2'));
    expect(onOpenDeveloper).toHaveBeenCalledWith('dev-2');
  });

  it('shows the empty state and creates a series for a picked developer', () => {
    mockList = { data: { series: [] }, isLoading: false };
    mockCreateSeries.mockImplementation((_body: unknown, options?: { onSuccess?: (d: OneOnOneSeriesDetail) => void }) =>
      options?.onSuccess?.(detail()),
    );
    const onOpenDeveloper = vi.fn();
    render(
      <OneOnOneSeriesPanel
        developers={[{ accountId: 'dev-1', displayName: 'Alice Smith', isActive: true }]}
        onOpenDeveloper={onOpenDeveloper}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText('Pick a developer to start a 1:1 series.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /New series/ }));
    fireEvent.change(screen.getByLabelText('Developer'), { target: { value: 'dev-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create series' }));
    expect(mockCreateSeries).toHaveBeenCalledWith({ developerAccountId: 'dev-1', cadence: 'weekly' }, expect.anything());
    expect(onOpenDeveloper).toHaveBeenCalledWith('dev-1');
  });
});

describe('flag-off invisibility', () => {
  it('hides the toolbar 1:1s button when the entry point is not provided', () => {
    const { rerender } = render(<TrackerBoardToolbar {...toolbarProps} />);
    expect(screen.queryByRole('button', { name: 'Open 1:1s' })).not.toBeInTheDocument();

    const onOpenOneOnOnes = vi.fn();
    rerender(<TrackerBoardToolbar {...toolbarProps} onOpenOneOnOnes={onOpenOneOnOnes} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open 1:1s' }));
    expect(onOpenOneOnOnes).toHaveBeenCalled();
  });
});
