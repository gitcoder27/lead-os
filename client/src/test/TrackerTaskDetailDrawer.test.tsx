import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ReactNode } from 'react';

const mockUseTrackerSharedTaskDetail = vi.fn();
const mockUpdateManagerDeskItemMutate = vi.fn();
const mockDeleteManagerDeskItemMutate = vi.fn();
const mockUpdateTrackerItemMutate = vi.fn();
const mockUpdateTrackerItemMutateAsync = vi.fn().mockResolvedValue(undefined);
const mockSetCurrentItemMutate = vi.fn();
const mockPromoteTrackerItemMutate = vi.fn();
const mockAddToast = vi.fn();

vi.mock('@/hooks/useManagerDesk', () => ({
  useTrackerSharedTaskDetail: (...args: unknown[]) => mockUseTrackerSharedTaskDetail(...args),
  useUpdateManagerDeskItem: () => ({ mutate: mockUpdateManagerDeskItemMutate, isPending: false }),
  useDeleteManagerDeskItem: () => ({ mutate: mockDeleteManagerDeskItemMutate, isPending: false }),
  useCancelDelegatedManagerDeskTask: () => ({ mutate: vi.fn(), isPending: false }),
  usePromoteTrackerItem: () => ({ mutate: mockPromoteTrackerItemMutate, isPending: false }),
}));

vi.mock('@/hooks/useTeamTrackerMutations', () => ({
  useUpdateTrackerItem: () => ({
    mutate: mockUpdateTrackerItemMutate,
    mutateAsync: mockUpdateTrackerItemMutateAsync,
    isPending: false,
  }),
  useSetCurrentItem: () => ({ mutate: mockSetCurrentItemMutate, isPending: false }),
}));

vi.mock('@/context/ToastContext', () => ({
  useToast: () => ({ addToast: mockAddToast }),
}));

vi.mock('@/hooks/useConfig', () => ({
  useConfig: () => ({ data: { jiraBaseUrl: 'https://test.atlassian.net', isConfigured: true } }),
}));

vi.mock('@/components/team-tracker/TrackerTaskExecutionPanel', () => ({
  TrackerTaskExecutionPanel: () => <div>Execution panel</div>,
}));

vi.mock('@/components/manager-desk/ItemDetailDrawer', () => ({
  ItemDetailDrawer: ({
    item,
    open,
    ariaLabel,
    topSlot,
    placeholder,
    stacked,
  }: {
    item: { title: string } | null;
    open: boolean;
    ariaLabel?: string;
    topSlot?: ReactNode;
    placeholder?: ReactNode;
    stacked?: boolean;
  }) =>
    open ? (
      <div role="dialog" aria-label={ariaLabel} data-stacked={stacked ? 'true' : undefined}>
        {item ? <div>{item.title}</div> : placeholder}
        {topSlot}
      </div>
    ) : null,
}));

import { TrackerTaskDetailDrawer } from '@/components/team-tracker/TrackerTaskDetailDrawer';

describe('TrackerTaskDetailDrawer', () => {
  beforeEach(() => {
    mockUseTrackerSharedTaskDetail.mockReset();
    mockUpdateManagerDeskItemMutate.mockReset();
    mockDeleteManagerDeskItemMutate.mockReset();
    mockUpdateTrackerItemMutate.mockReset();
    mockUpdateTrackerItemMutateAsync.mockClear();
    mockSetCurrentItemMutate.mockReset();
    mockPromoteTrackerItemMutate.mockReset();
    mockAddToast.mockReset();
  });

  it('renders loading content inside the drawer while detail is fetching', () => {
    mockUseTrackerSharedTaskDetail.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    render(
      <TrackerTaskDetailDrawer
        trackerItemId={10}
        initialManagerDeskItemId={110}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByRole('dialog', { name: /team tracker task detail/i })).toBeInTheDocument();
    expect(screen.getByText('Loading task detail')).toBeInTheDocument();
    expect(screen.getByText(/loading tracker task detail/i)).toBeInTheDocument();
  });

  it('renders the linked item detail content with Manager Desk controls', () => {
    mockUseTrackerSharedTaskDetail.mockReturnValue({
      data: {
        date: '2026-03-14',
        developer: { accountId: 'dev-1', displayName: 'Alice Smith', isActive: true },
        lifecycle: 'manager_desk_linked',
        managerDeskItem: {
          id: 110,
          dayId: 1,
          title: 'Fix login bug',
          kind: 'action',
          category: 'analysis',
          status: 'planned',
          priority: 'high',
          createdAt: '2026-03-14T09:00:00Z',
          updatedAt: '2026-03-14T09:00:00Z',
          links: [],
        },
        trackerItem: {
          id: 10,
          dayId: 1,
          managerDeskItemId: 110,
          lifecycle: 'manager_desk_linked',
          itemType: 'jira',
          title: 'Fix login bug',
          state: 'planned',
          position: 0,
          createdAt: '2026-03-14T09:00:00Z',
          updatedAt: '2026-03-14T09:00:00Z',
        },
      },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    render(
      <TrackerTaskDetailDrawer
        trackerItemId={10}
        initialManagerDeskItemId={110}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByRole('dialog', { name: /team tracker task detail/i })).toBeInTheDocument();
    expect(screen.getByText('Fix login bug')).toBeInTheDocument();
    expect(screen.getByText('Execution panel')).toBeInTheDocument();
    expect(screen.queryByText('Loading task detail')).not.toBeInTheDocument();
    expect(screen.queryByText(/promote to manager follow-up/i)).not.toBeInTheDocument();
  });

  it('renders the tracker-only detail with promote CTA when lifecycle is tracker_only', () => {
    mockUseTrackerSharedTaskDetail.mockReturnValue({
      data: {
        date: '2026-03-14',
        developer: { accountId: 'dev-1', displayName: 'Alice Smith', isActive: true },
        lifecycle: 'tracker_only',
        trackerItem: {
          id: 10,
          dayId: 1,
          lifecycle: 'tracker_only',
          itemType: 'custom',
          title: 'Review pull request',
          state: 'planned',
          position: 0,
          createdAt: '2026-03-14T09:00:00Z',
          updatedAt: '2026-03-14T09:00:00Z',
        },
      },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    render(
      <TrackerTaskDetailDrawer
        trackerItemId={10}
        initialManagerDeskItemId={null}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByRole('dialog', { name: /team tracker task detail/i })).toBeInTheDocument();
    expect(screen.getByText('Review pull request')).toBeInTheDocument();
    expect(screen.getByText('Tracker Only')).toBeInTheDocument();
    expect(screen.getByText('Execution panel')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /promote to manager follow-up/i })).toBeInTheDocument();
  });

  it('calls the promote mutation when the promote CTA is clicked', () => {
    mockUseTrackerSharedTaskDetail.mockReturnValue({
      data: {
        date: '2026-03-14',
        developer: { accountId: 'dev-1', displayName: 'Alice Smith', isActive: true },
        lifecycle: 'tracker_only',
        trackerItem: {
          id: 10,
          dayId: 1,
          lifecycle: 'tracker_only',
          itemType: 'custom',
          title: 'Review pull request',
          state: 'planned',
          position: 0,
          createdAt: '2026-03-14T09:00:00Z',
          updatedAt: '2026-03-14T09:00:00Z',
        },
      },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    render(
      <TrackerTaskDetailDrawer
        trackerItemId={10}
        initialManagerDeskItemId={null}
        onClose={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /promote to manager follow-up/i }));

    expect(mockPromoteTrackerItemMutate).toHaveBeenCalledWith(10, expect.objectContaining({
      onSuccess: expect.any(Function),
      onError: expect.any(Function),
    }));
  });

  it('shows the developer name on the tracker-only drawer', () => {
    mockUseTrackerSharedTaskDetail.mockReturnValue({
      data: {
        date: '2026-03-14',
        developer: { accountId: 'dev-1', displayName: 'Alice Smith', isActive: true },
        lifecycle: 'tracker_only',
        trackerItem: {
          id: 10,
          dayId: 1,
          lifecycle: 'tracker_only',
          itemType: 'jira',
          jiraKey: 'AM-123',
          title: 'Linked Jira task',
          state: 'in_progress',
          position: 0,
          createdAt: '2026-03-14T09:00:00Z',
          updatedAt: '2026-03-14T09:00:00Z',
        },
      },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    render(
      <TrackerTaskDetailDrawer
        trackerItemId={10}
        initialManagerDeskItemId={null}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByText('Alice Smith')).toBeInTheDocument();
    expect(screen.getByText('AM-123')).toBeInTheDocument();
  });

  it('closes immediately when the selected task is cleared', () => {
    mockUseTrackerSharedTaskDetail.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    const { rerender } = render(
      <TrackerTaskDetailDrawer
        trackerItemId={10}
        initialManagerDeskItemId={110}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByRole('dialog', { name: /team tracker task detail/i })).toBeInTheDocument();

    rerender(
      <TrackerTaskDetailDrawer
        trackerItemId={null}
        initialManagerDeskItemId={null}
        onClose={vi.fn()}
      />
    );

    expect(screen.queryByRole('dialog', { name: /team tracker task detail/i })).not.toBeInTheDocument();
    expect(screen.queryByText('Loading task detail')).not.toBeInTheDocument();
  });

  it('renders a back-to-developer control and stacked layer for linked detail when backTo is provided', () => {
    mockUseTrackerSharedTaskDetail.mockReturnValue({
      data: {
        date: '2026-03-14',
        developer: { accountId: 'dev-1', displayName: 'Alice Smith', isActive: true },
        lifecycle: 'manager_desk_linked',
        managerDeskItem: {
          id: 110,
          dayId: 1,
          title: 'Fix login bug',
          kind: 'action',
          category: 'analysis',
          status: 'planned',
          priority: 'high',
          createdAt: '2026-03-14T09:00:00Z',
          updatedAt: '2026-03-14T09:00:00Z',
          links: [],
        },
        trackerItem: {
          id: 10,
          dayId: 1,
          managerDeskItemId: 110,
          lifecycle: 'manager_desk_linked',
          itemType: 'jira',
          title: 'Fix login bug',
          state: 'planned',
          position: 0,
          createdAt: '2026-03-14T09:00:00Z',
          updatedAt: '2026-03-14T09:00:00Z',
        },
      },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    const onClose = vi.fn();
    render(
      <TrackerTaskDetailDrawer
        trackerItemId={10}
        initialManagerDeskItemId={110}
        backTo="Alice Smith"
        onClose={onClose}
      />
    );

    expect(screen.getByRole('dialog', { name: /team tracker task detail/i })).toHaveAttribute('data-stacked', 'true');
    fireEvent.click(screen.getByRole('button', { name: /back to alice smith/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders a back-to-developer control on the tracker-only drawer when backTo is provided', () => {
    mockUseTrackerSharedTaskDetail.mockReturnValue({
      data: {
        date: '2026-03-14',
        developer: { accountId: 'dev-1', displayName: 'Alice Smith', isActive: true },
        lifecycle: 'tracker_only',
        trackerItem: {
          id: 10,
          dayId: 1,
          lifecycle: 'tracker_only',
          itemType: 'custom',
          title: 'Review pull request',
          state: 'planned',
          position: 0,
          createdAt: '2026-03-14T09:00:00Z',
          updatedAt: '2026-03-14T09:00:00Z',
        },
      },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    const onClose = vi.fn();
    render(
      <TrackerTaskDetailDrawer
        trackerItemId={10}
        initialManagerDeskItemId={null}
        backTo="Alice Smith"
        onClose={onClose}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /back to alice smith/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('omits the back control when there is no developer panel to return to', () => {
    mockUseTrackerSharedTaskDetail.mockReturnValue({
      data: {
        date: '2026-03-14',
        developer: { accountId: 'dev-1', displayName: 'Alice Smith', isActive: true },
        lifecycle: 'tracker_only',
        trackerItem: {
          id: 10,
          dayId: 1,
          lifecycle: 'tracker_only',
          itemType: 'custom',
          title: 'Review pull request',
          state: 'planned',
          position: 0,
          createdAt: '2026-03-14T09:00:00Z',
          updatedAt: '2026-03-14T09:00:00Z',
        },
      },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    render(
      <TrackerTaskDetailDrawer
        trackerItemId={10}
        initialManagerDeskItemId={null}
        onClose={vi.fn()}
      />
    );

    expect(screen.queryByRole('button', { name: /back to/i })).not.toBeInTheDocument();
  });

  it('closes the tracker-only drawer on Escape', () => {
    mockUseTrackerSharedTaskDetail.mockReturnValue({
      data: {
        date: '2026-03-14',
        developer: { accountId: 'dev-1', displayName: 'Alice Smith', isActive: true },
        lifecycle: 'tracker_only',
        trackerItem: {
          id: 10,
          dayId: 1,
          lifecycle: 'tracker_only',
          itemType: 'custom',
          title: 'Review pull request',
          state: 'planned',
          position: 0,
          createdAt: '2026-03-14T09:00:00Z',
          updatedAt: '2026-03-14T09:00:00Z',
        },
      },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    const onClose = vi.fn();
    render(
      <TrackerTaskDetailDrawer
        trackerItemId={10}
        initialManagerDeskItemId={null}
        onClose={onClose}
      />
    );

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
