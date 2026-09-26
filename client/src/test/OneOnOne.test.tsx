import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { OneOnOneSeriesDetail, OneOnOneSeriesSummary } from '@/types';
import { OneOnOneWorkspace } from '@/components/team-tracker/OneOnOneWorkspace';
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

let mockEnabled = true;
let mockList: { data?: { series: OneOnOneSeriesSummary[] }; isLoading: boolean } = { data: { series: [] }, isLoading: false };
let mockDetail: { data?: OneOnOneSeriesDetail; isError?: boolean } = { data: undefined };

vi.mock('@/context/ToastContext', () => ({
  useToast: () => ({ addToast: mockAddToast }),
}));

vi.mock('@/hooks/useOneOnOne', () => ({
  useOneOnOneEnabled: () => mockEnabled,
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
        task: { taskId: 1, taskKey: 'T-1', title: 'Review queue', status: 'open', ownerType: 'developer', ownerId: 'dev-1', deletedAt: null },
      },
      {
        id: 102,
        seriesId: 5,
        taskId: 2,
        position: 1,
        addedAt: '2026-03-05T08:00:00Z',
        carriedFrom: null,
        task: { taskId: 2, taskKey: 'T-2', title: 'Career goals', status: 'open', ownerType: 'developer', ownerId: 'dev-1', deletedAt: null },
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
});

describe('OneOnOneWorkspace', () => {
  it('renders the agenda, session, and history columns', () => {
    render(<OneOnOneWorkspace developerAccountId="dev-1" onClose={vi.fn()} />);
    expect(screen.getByTestId('one-on-one-workspace')).toBeInTheDocument();
    expect(screen.getByText('1:1 — Alice Smith')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '1:1 agenda' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '1:1 session' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '1:1 history' })).toBeInTheDocument();
    expect(screen.getByText('Review queue')).toBeInTheDocument();
    expect(screen.getByText('Career goals')).toBeInTheDocument();
    expect(screen.getByDisplayValue('2026-03-09')).toBeInTheDocument();
    expect(screen.getByText('Talked about the migration')).toBeInTheDocument();
  });

  it('renders the carried-from marker on carried agenda items', () => {
    render(<OneOnOneWorkspace developerAccountId="dev-1" onClose={vi.fn()} />);
    expect(screen.getByText('carried from 2026-03-02')).toBeInTheDocument();
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
    expect(mockCreateAction).toHaveBeenCalledWith({ sessionId: 11, title: 'Ship perf fix' }, expect.anything());
  });

  it('offers series creation when none exists and closes on Escape', () => {
    mockList = { data: { series: [] }, isLoading: false };
    mockDetail = { data: undefined };
    const onClose = vi.fn();
    render(<OneOnOneWorkspace developerAccountId="dev-2" onClose={onClose} />);
    expect(screen.getByText('No 1:1 series yet')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Start 1:1 series' }));
    expect(mockCreateSeries).toHaveBeenCalledWith({ developerAccountId: 'dev-2', cadence: 'weekly' }, expect.anything());

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
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
