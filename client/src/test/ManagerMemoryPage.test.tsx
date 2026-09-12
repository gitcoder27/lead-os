import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { ManagerMemoryPage } from '@/components/manager-memory';
import type { ManagerDeskDayResponse, ManagerDeskItem } from '@/types/manager-desk';

const mockAddToast = vi.fn();
const mockCreateMutate = vi.fn();
const mockUpdateMutate = vi.fn();
const mockRefetch = vi.fn();

let mockDay: ManagerDeskDayResponse | undefined;
let mockDayError: Error | null = null;
let mockDayLoading = false;
let mockNoteSources: { itemId: number; noteId: number; date: string }[] = [];

const baseItem = (overrides: Partial<ManagerDeskItem>): ManagerDeskItem => ({
  id: overrides.id ?? 1,
  dayId: 1,
  originDate: '2026-04-28',
  title: overrides.title ?? 'Check in with QA',
  kind: overrides.kind ?? 'action',
  category: overrides.category ?? 'follow_up',
  status: overrides.status ?? 'planned',
  priority: overrides.priority ?? 'medium',
  createdAt: overrides.createdAt ?? '2026-04-28T03:00:00.000Z',
  updatedAt: overrides.updatedAt ?? '2026-04-28T03:00:00.000Z',
  links: overrides.links ?? [],
  ...overrides,
});

vi.mock('@/context/ToastContext', () => ({
  useToast: () => ({ addToast: mockAddToast }),
}));

vi.mock('@/hooks/useDevelopers', () => ({
  useDevelopers: () => ({
    data: [{ accountId: 'dev-1', displayName: 'Alice Smith', isActive: true }],
  }),
}));

vi.mock('@/hooks/useManagerDesk', () => ({
  useManagerDesk: () => ({
    data: mockDay,
    isLoading: mockDayLoading,
    isFetching: false,
    error: mockDayError,
    refetch: mockRefetch,
  }),
  useCreateManagerDeskItem: () => ({ mutate: mockCreateMutate, isPending: false }),
  useUpdateManagerDeskItem: () => ({ mutate: mockUpdateMutate, isPending: false }),
}));

vi.mock('@/hooks/useDailyNotes', () => ({
  useDailyNoteSources: (ids: number[]) => ({ data: mockNoteSources.filter((s) => ids.includes(s.itemId)) }),
}));

function renderMemory(mode: 'follow-ups' | 'meetings') {
  return render(<ManagerMemoryPage mode={mode} onViewChange={vi.fn()} />);
}

describe('ManagerMemoryPage', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-28T09:00:00.000Z'));
    mockAddToast.mockReset();
    mockCreateMutate.mockReset();
    mockUpdateMutate.mockReset();
    mockRefetch.mockReset();
    mockDayError = null;
    mockDayLoading = false;
    mockNoteSources = [];
    mockDay = {
      date: '2026-04-28',
      viewMode: 'live',
      items: [
        baseItem({ id: 1, title: 'Check in with QA', followUpAt: '2026-04-28T11:00:00.000Z' }),
        baseItem({ id: 2, title: 'Release owner follow-up', followUpAt: '2026-04-29T11:00:00.000Z' }),
        baseItem({
          id: 3,
          title: 'Payments sync',
          kind: 'meeting',
          category: 'planning',
          participants: 'Product, QA',
          plannedStartAt: '2026-04-28T10:00:00.000Z',
          nextAction: 'Send notes',
        }),
      ],
      summary: {
        totalOpen: 3,
        inbox: 0,
        planned: 3,
        inProgress: 0,
        waiting: 0,
        overdueFollowUps: 0,
        meetings: 1,
        completed: 0,
      },
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders follow-ups directly and filters them by search', () => {
    renderMemory('follow-ups');

    expect(screen.getByRole('heading', { name: 'Follow-ups' })).toBeInTheDocument();
    expect(screen.getByText('Check in with QA')).toBeInTheDocument();
    expect(screen.queryByText('Payments sync')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Search follow-ups'), { target: { value: 'release owner' } });

    expect(screen.queryByText('Check in with QA')).not.toBeInTheDocument();
    expect(screen.getByText('Release owner follow-up')).toBeInTheDocument();
  });

  it('creates a follow-up through the focused screen composer', () => {
    renderMemory('follow-ups');

    fireEvent.change(screen.getByLabelText('Follow-up'), { target: { value: 'Ping API owner' } });
    fireEvent.click(screen.getByRole('button', { name: /add follow-up/i }));

    expect(mockCreateMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Ping API owner',
        kind: 'action',
        category: 'follow_up',
      }),
      expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) }),
    );
  });

  it('updates follow-up status from the direct screen list', () => {
    renderMemory('follow-ups');

    const row = screen.getByText('Check in with QA').closest('article');
    expect(row).toBeTruthy();
    fireEvent.click(within(row as HTMLElement).getByRole('button', { name: /^done$/i }));

    expect(mockUpdateMutate).toHaveBeenCalledWith(
      { itemId: 1, status: 'done' },
      expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) }),
    );
  });

  it('renders meetings directly and captures a meeting from the composer', () => {
    renderMemory('meetings');

    expect(screen.getByRole('heading', { name: 'Meetings' })).toBeInTheDocument();
    expect(screen.getByText('Payments sync')).toBeInTheDocument();
    expect(screen.queryByText('Check in with QA')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Meeting'), { target: { value: 'Architecture review' } });
    fireEvent.change(screen.getByLabelText('Attendees'), { target: { value: 'Platform, QA' } });
    fireEvent.change(screen.getByLabelText('Next action'), { target: { value: 'Send decision notes' } });
    fireEvent.click(screen.getByRole('button', { name: /add meeting/i }));

    expect(mockCreateMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Architecture review',
        kind: 'meeting',
        category: 'planning',
        participants: 'Platform, QA',
        nextAction: 'Send decision notes',
      }),
      expect.any(Object),
    );
  });

  it('shows the direct screen error state with retry', () => {
    mockDay = undefined;
    mockDayError = new Error('Desk read failed');

    renderMemory('follow-ups');

    expect(screen.getByText('Desk read failed')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(mockRefetch).toHaveBeenCalled();
  });

  it('renders a private note source link only for owned associations', () => {
    mockNoteSources = [{ itemId: 1, noteId: 42, date: '2026-04-27' }];

    renderMemory('follow-ups');

    const link = screen.getByRole('link', { name: 'Open source note from 2026-04-27' });
    expect(link).toHaveAttribute('href', '/notes?date=2026-04-27');
    expect(link).toHaveTextContent('Source: Apr 27 notes');
    expect(screen.getAllByText(/Source: .* notes/)).toHaveLength(1);
  });

  it('opens the exact desk item when an onOpenTarget handler is provided', () => {
    const onOpenTarget = vi.fn();

    render(
      <ManagerMemoryPage mode="follow-ups" onViewChange={vi.fn()} onOpenTarget={onOpenTarget} />,
    );

    const row = screen.getByText('Check in with QA').closest('article')!;
    fireEvent.click(within(row).getByRole('button', { name: /^Desk$/ }));

    expect(onOpenTarget).toHaveBeenCalledWith({
      type: 'manager_desk_item',
      view: 'desk',
      managerDeskItemId: 1,
      date: '2026-04-28',
    });
  });

  it('falls back to onViewChange when no onOpenTarget handler is provided', () => {
    const onViewChange = vi.fn();

    render(<ManagerMemoryPage mode="follow-ups" onViewChange={onViewChange} />);

    const row = screen.getByText('Check in with QA').closest('article')!;
    fireEvent.click(within(row).getByRole('button', { name: /^Desk$/ }));

    expect(onViewChange).toHaveBeenCalledWith('desk');
  });
});
