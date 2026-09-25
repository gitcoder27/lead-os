import { describe, it, expect, vi, beforeEach } from 'vitest';
import { format } from 'date-fns';
import { act, render, renderHook, screen, fireEvent, within } from '@testing-library/react';
import { MyDayPage } from '@/components/my-day/MyDayPage';
import { useMyDayHandlers } from '@/components/my-day/useMyDayHandlers';
import { TestWrapper } from '@/test/wrapper';
import type { MyDayResponse, TrackerWorkItem } from '@/types';

const mockRefetch = vi.fn();
const mockLogout = vi.fn();
const mockAddToast = vi.fn();
const mockUpdateStatusMutate = vi.fn();
const mockAddItemMutate = vi.fn();
const mockUpdateItemMutate = vi.fn();
const mockSetCurrentMutate = vi.fn();
const mockAddCheckInMutate = vi.fn();
const mockAddMyDayTaskEventMutate = vi.fn();

let mockDay: MyDayResponse;

function createItem(overrides: Partial<TrackerWorkItem>): TrackerWorkItem {
  return {
    id: 1,
    dayId: 10,
    originDate: '2026-03-10',
    itemType: 'custom',
    title: 'Task title',
    state: 'planned',
    position: 0,
    createdAt: '2026-03-10T09:00:00.000Z',
    updatedAt: '2026-03-10T09:00:00.000Z',
    ...overrides,
    lifecycle: overrides.lifecycle ?? 'tracker_only',
  };
}

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({
    user: { displayName: 'Alice Smith', role: 'developer', developerAccountId: 'dev-1' },
    logout: mockLogout,
  }),
  useAuthScopeKey: () => 'dev-1',
}));

vi.mock('@/context/ThemeContext', () => ({
  useTheme: () => ({
    theme: 'light',
    toggleTheme: vi.fn(),
  }),
}));

vi.mock('@/context/ToastContext', () => ({
  useToast: () => ({
    addToast: mockAddToast,
  }),
}));

vi.mock('@/hooks/useConfig', () => ({
  useConfig: () => ({ data: { jiraBaseUrl: 'https://test.atlassian.net', isConfigured: true } }),
}));

vi.mock('@/hooks/useMyDay', () => ({
  useMyDay: () => ({
    data: mockDay,
    isLoading: false,
    isFetching: false,
    error: null,
    refetch: mockRefetch,
  }),
  useUpdateMyDayStatus: () => ({ mutate: mockUpdateStatusMutate, isPending: false }),
  useAddMyDayItem: () => ({ mutate: mockAddItemMutate, isPending: false }),
  useUpdateMyDayItem: () => ({ mutate: mockUpdateItemMutate, isPending: false }),
  useSetMyDayCurrent: () => ({ mutate: mockSetCurrentMutate, isPending: false }),
  useAddMyDayCheckIn: () => ({ mutate: mockAddCheckInMutate, isPending: false }),
}));

vi.mock('@/hooks/useTasks', () => ({
  useTaskResolution: () => ({ data: undefined, isError: false, isLoading: false }),
  useAddMyDayTaskEvent: () => ({ mutate: mockAddMyDayTaskEventMutate, isPending: false }),
  useAddTaskEvent: () => ({ mutate: vi.fn(), isPending: false }),
  useMyDayTaskEvents: () => ({ data: { pages: [{ events: [{ id: 1, taskKey: 'T-1', type: 'update', body: 'Earlier shared progress', visibility: 'shared', author: { type: 'developer', id: 'dev-1' }, occurredAt: new Date().toISOString(), approximateTime: false }], nextCursor: null }] } }),
  useTaskEvents: () => ({ data: undefined }),
  useRedactTaskEvent: () => ({ mutate: vi.fn() }),
  useUpdateTaskEventVisibility: () => ({ mutate: vi.fn() }),
}));

vi.mock('@/components/my-day/AddTaskForm', () => ({
  AddTaskForm: () => <div>Add Task Form</div>,
}));

vi.mock('@/components/my-day/CheckInFeed', () => ({
  CheckInFeed: () => <div>Check-ins</div>,
}));

vi.mock('@/components/my-day/StatusSelector', () => ({
  StatusSelector: () => <div>Status Selector</div>,
  getStatusInfo: () => ({
    label: 'On Track',
    color: 'var(--accent)',
    bg: 'var(--accent-glow)',
  }),
}));

vi.mock('framer-motion', async () => {
  const React = await import('react');

  type MotionLikeProps = React.HTMLAttributes<HTMLElement> & {
    initial?: unknown;
    animate?: unknown;
    exit?: unknown;
    transition?: unknown;
    variants?: unknown;
    layout?: unknown;
    whileTap?: unknown;
    whileDrag?: unknown;
    onReorder?: unknown;
    values?: unknown;
    value?: unknown;
    as?: unknown;
  };

  function stripMotionProps(props: MotionLikeProps): React.HTMLAttributes<HTMLElement> {
    const {
      initial,
      animate,
      exit,
      transition,
      variants,
      layout,
      whileTap,
      whileDrag,
      onReorder,
      values,
      value,
      as,
      ...rest
    } = props;
    void initial;
    void animate;
    void exit;
    void transition;
    void variants;
    void layout;
    void whileTap;
    void whileDrag;
    void onReorder;
    void values;
    void value;
    void as;
    return rest;
  }

  const makeComponent = (tag: keyof JSX.IntrinsicElements) =>
    React.forwardRef<HTMLElement, MotionLikeProps>((props, ref) =>
      React.createElement(tag, { ...stripMotionProps(props), ref }, props.children)
    );

  return {
    motion: new Proxy(
      {},
      {
        get: (_target, tag: string) => makeComponent((tag as keyof JSX.IntrinsicElements) ?? 'div'),
      }
    ),
    AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    Reorder: {
      Group: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
        <div {...stripMotionProps(props)}>{children}</div>
      ),
      Item: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
        <div {...stripMotionProps(props)}>{children}</div>
      ),
    },
  };
});

describe('MyDayPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDay = {
      date: '2026-03-10',
      viewMode: 'live',
      developer: { accountId: 'dev-1', displayName: 'Alice Smith', isActive: true },
      status: 'on_track',
      availability: { state: 'active' },
      isReadOnly: false,
      lastCheckInAt: '2026-03-10T08:30:00.000Z',
      currentItem: createItem({
        id: 101,
        title: 'Review PR comments',
        state: 'in_progress',
        note: 'Focus on the auth edge cases',
      }),
      plannedItems: [
        createItem({
          id: 102,
          title: 'Prepare release checklist',
          position: 1,
          note: 'Coordinate with QA before lunch',
        }),
      ],
      completedItems: [
        createItem({
          id: 103,
          title: 'Write incident summary',
          state: 'done',
          position: 2,
          note: 'Include rollback timing',
          completedAt: '2026-03-10T10:00:00.000Z',
        }),
      ],
      droppedItems: [
        createItem({
          id: 104,
          title: 'Shadow deploy follow-up',
          state: 'dropped',
          position: 3,
          note: 'Waiting on staging access',
        }),
      ],
      checkIns: [],
      isStale: false,
    };
  });

  it('opens shared activity from current and planned tasks without manager controls', () => {
    mockDay.currentItem = createItem({ id: 101, taskKey: 'T-1', title: 'Current keyed task', state: 'in_progress' });
    mockDay.plannedItems = [createItem({ id: 102, taskKey: 'T-2', title: 'Planned keyed task' })];
    render(<MyDayPage />, { wrapper: TestWrapper });
    expect(screen.queryByText('Earlier shared progress')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Activity for T-1' }));
    expect(screen.getByText('Earlier shared progress')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Redact event' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Activity for T-2' }));
    expect(screen.getAllByText('Earlier shared progress')).toHaveLength(2);
  });

  it('shows synced task notes across current, planned, completed, and dropped work', () => {
    render(
      <TestWrapper>
        <MyDayPage />
      </TestWrapper>
    );

    expect(screen.getByText('Focus on the auth edge cases')).toBeInTheDocument();
    expect(screen.getByText('Coordinate with QA before lunch')).toBeInTheDocument();
    expect(screen.getByText('Include rollback timing')).toBeInTheDocument();
    expect(screen.getByText('Waiting on staging access')).toBeInTheDocument();
  });

  it('renders related issue chips across My Day work cards', () => {
    mockDay.currentItem = createItem({
      id: 101,
      title: 'Review PR comments',
      state: 'in_progress',
      relatedIssueKeys: ['AUTH-2'],
    });
    mockDay.plannedItems = [
      createItem({
        id: 102,
        title: 'Prepare release checklist',
        position: 1,
        relatedIssueKeys: ['REL-8'],
      }),
    ];
    mockDay.completedItems = [
      createItem({
        id: 103,
        title: 'Write incident summary',
        state: 'done',
        position: 2,
        relatedIssueKeys: ['INC-5'],
      }),
    ];
    mockDay.droppedItems = [
      createItem({
        id: 104,
        title: 'Shadow deploy follow-up',
        state: 'dropped',
        position: 3,
        relatedIssueKeys: ['OPS-9'],
      }),
    ];

    render(
      <TestWrapper>
        <MyDayPage />
      </TestWrapper>
    );

    expect(screen.getByText('AUTH-2')).toBeInTheDocument();
    expect(screen.getByText('REL-8')).toBeInTheDocument();
    expect(screen.getByText('INC-5')).toBeInTheDocument();
    expect(screen.getByText('OPS-9')).toBeInTheDocument();
  });

  it('posts a planned task update through the inline task-event composer', () => {
    mockDay.plannedItems = [
      createItem({ id: 102, title: 'Prepare release checklist', position: 1, taskKey: 'T-3' }),
    ];

    render(
      <TestWrapper>
        <MyDayPage />
      </TestWrapper>
    );

    const upNextSection = screen.getByText('Up Next').closest('section');
    expect(upNextSection).toBeTruthy();

    fireEvent.click(within(upNextSection as HTMLElement).getByText('Add an update…'));
    fireEvent.change(within(upNextSection as HTMLElement).getByRole('textbox'), {
      target: { value: 'Updated handoff note' },
    });
    fireEvent.click(within(upNextSection as HTMLElement).getByText('Post'));

    expect(mockAddMyDayTaskEventMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        date: format(new Date(), 'yyyy-MM-dd'),
        type: 'update',
        body: 'Updated handoff note',
        requestId: expect.any(String),
      }),
      expect.objectContaining({
        onSuccess: expect.any(Function),
        onError: expect.any(Function),
      })
    );
  });

  it('renders continued-from context for inherited live work', () => {
    mockDay.currentItem = createItem({
      id: 101,
      title: 'Review PR comments',
      state: 'in_progress',
      originDate: '2026-03-09',
    });
    mockDay.plannedItems = [
      createItem({
        id: 102,
        title: 'Prepare release checklist',
        originDate: '2026-03-09',
      }),
    ];

    render(
      <TestWrapper>
        <MyDayPage />
      </TestWrapper>
    );

    expect(screen.getAllByText(/Continued from Mar 9/)).toHaveLength(2);
  });

  it('disables task controls when My Day is viewing history', () => {
    mockDay.viewMode = 'history';
    mockDay.readOnlyReason = 'history';
    mockDay.isReadOnly = true;

    render(
      <TestWrapper>
        <MyDayPage />
      </TestWrapper>
    );

    expect(screen.queryByTitle('Edit note')).not.toBeInTheDocument();
    expect(screen.getByText('Review PR comments').closest('button')).toBeNull();
  });

  it('edits the current task title through the shared My Day mutation', () => {
    render(
      <TestWrapper>
        <MyDayPage />
      </TestWrapper>
    );

    fireEvent.click(screen.getByText('Review PR comments'));
    const titleInput = screen.getByLabelText('Edit title');
    fireEvent.change(titleInput, {
      target: { value: 'Review production PR comments' },
    });
    fireEvent.click(screen.getByTitle('Save title'));

    expect(mockUpdateItemMutate).toHaveBeenCalledWith(
      { itemId: 101, title: 'Review production PR comments' },
      expect.objectContaining({
        onSuccess: expect.any(Function),
        onError: expect.any(Function),
      })
    );
  });

  it('guards read-only My Day mutation handlers for keyboard and programmatic calls', () => {
    const { result } = renderHook(() => useMyDayHandlers('2026-03-10', true), { wrapper: TestWrapper });

    act(() => {
      result.current.handleStatusUpdate('blocked');
      result.current.handleAddItem({ title: 'Historical edit' });
      result.current.handleAddCheckIn('Historical update');
      result.current.handleUpdateItemTitle(101, 'Changed');
    });

    expect(mockUpdateStatusMutate).not.toHaveBeenCalled();
    expect(mockAddItemMutate).not.toHaveBeenCalled();
    expect(mockAddCheckInMutate).not.toHaveBeenCalled();
    expect(mockUpdateItemMutate).not.toHaveBeenCalled();
    expect(mockAddToast).toHaveBeenCalledWith('This day is read-only', 'warning');
  });
});
