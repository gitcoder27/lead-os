import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Alert, ManagerActionItem } from '@/types';
import { ManagerActionInbox } from '@/components/actions/ManagerActionInbox';
import { createTestQueryClient } from '@/test/wrapper';

const mockRunAction = vi.fn();
const mockDismiss = vi.fn();
const mockAddToast = vi.fn();

let mockActionsData:
  | { actions: ManagerActionItem[]; urgentCount: number; totalCount: number }
  | undefined;
let mockAlerts: Alert[] = [];

const useManagerActionsSpy = vi.fn();

vi.mock('@/hooks/useManagerActions', () => ({
  useManagerActions: (options: { enabled?: boolean }) => {
    useManagerActionsSpy(options);
    return {
      data: mockActionsData,
      isLoading: false,
      isError: false,
      isFetching: false,
    };
  },
}));

vi.mock('@/hooks/useTodayActions', () => ({
  useTodayActions: () => ({
    runAction: mockRunAction,
    runActionAsync: vi.fn(async () => undefined),
    isPending: false,
    pendingTarget: undefined,
    pendingKind: undefined,
  }),
}));

vi.mock('@/hooks/useTeamTracker', () => ({
  useTeamTracker: () => ({ data: undefined, isLoading: false }),
}));

vi.mock('@/hooks/useAlerts', () => ({
  useAlerts: () => ({ data: mockAlerts }),
  useDismissAlerts: () => ({ mutate: mockDismiss, isPending: false }),
}));

vi.mock('@/context/ToastContext', () => ({
  useToast: () => ({ addToast: mockAddToast }),
}));

vi.mock('@/components/today/TodayCheckInDialog', () => ({ TodayCheckInDialog: () => null }));
vi.mock('@/components/today/TodayConfirmDialog', () => ({ TodayConfirmDialog: () => null }));
vi.mock('@/components/today/TodayTextCaptureDialog', () => ({ TodayTextCaptureDialog: () => null }));

function makeAction(overrides: Partial<ManagerActionItem> = {}): ManagerActionItem {
  const target = { type: 'issue' as const, view: 'work' as const, issueKey: 'AM-1', filter: 'overdue' as const };
  return {
    id: 'action-1',
    type: 'overdue_issue',
    title: 'AM-1 is overdue',
    context: '',
    signal: 'Due yesterday',
    severity: 'critical',
    priority: 92,
    group: 'now',
    target,
    primaryAction: { kind: 'open', label: 'Open issue', target },
    secondaryActions: [],
    ...overrides,
  };
}

function makeAlert(overrides: Partial<Alert> = {}): Alert {
  return {
    id: 'blocked:AM-2',
    type: 'blocked',
    severity: 'high',
    issueKey: 'AM-2',
    message: 'Issue AM-2 is blocked.',
    detectedAt: '2026-03-09T10:00:00Z',
    ...overrides,
  };
}

function openInbox() {
  fireEvent.click(screen.getByRole('button', { name: 'Manager actions' }));
}

function renderInbox(props: { onOpenTarget?: (target: import('@/types').ManagerActionTarget) => void; onViewChange?: (view: import('@/App').AppView) => void } = {}) {
  const queryClient = createTestQueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <ManagerActionInbox
        onOpenTarget={props.onOpenTarget ?? vi.fn()}
        onViewChange={props.onViewChange ?? vi.fn()}
      />
    </QueryClientProvider>,
  );
}

describe('ManagerActionInbox', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockActionsData = { actions: [makeAction()], urgentCount: 1, totalCount: 1 };
    mockAlerts = [];
  });

  it('shows the badge with only the urgent action count when there are no signals', () => {
    renderInbox();

    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Manager actions' })).toHaveAttribute('title', '1 need attention');
  });

  it('merges attention signals into the badge and deduplicates alerts already shown as actions', () => {
    mockAlerts = [
      makeAlert({ id: 'overdue:AM-1', type: 'overdue', issueKey: 'AM-1', message: 'Issue AM-1 is overdue.' }),
      makeAlert(),
      makeAlert({
        id: 'idle_developer:dev-1',
        type: 'idle_developer',
        severity: 'medium',
        issueKey: undefined,
        developerAccountId: 'dev-1',
        developerName: 'Priya',
        message: 'Priya has no current or planned work today.',
      }),
    ];

    renderInbox();

    // 1 urgent action + 2 non-duplicated signals (AM-1 already appears as an action)
    expect(screen.getByText('3')).toBeInTheDocument();

    openInbox();

    expect(screen.getByText('Attention signals')).toBeInTheDocument();
    expect(screen.queryByText('Issue AM-1 is overdue.')).not.toBeInTheDocument();
    expect(screen.getByText('Issue AM-2 is blocked.')).toBeInTheDocument();
    expect(screen.getByText('Priya has no current or planned work today.')).toBeInTheDocument();
  });

  it('routes an issue signal click to the work view with the matching filter', () => {
    const onOpenTarget = vi.fn();
    mockAlerts = [makeAlert()];

    renderInbox({ onOpenTarget });
    openInbox();
    fireEvent.click(screen.getByText('Issue AM-2 is blocked.'));

    expect(onOpenTarget).toHaveBeenCalledWith({
      type: 'issue',
      view: 'work',
      issueKey: 'AM-2',
      filter: 'blocked',
    });
  });

  it('routes an idle developer signal click to the team view', () => {
    const onOpenTarget = vi.fn();
    mockAlerts = [
      makeAlert({
        id: 'idle_developer:dev-1',
        type: 'idle_developer',
        severity: 'medium',
        issueKey: undefined,
        developerAccountId: 'dev-1',
        developerName: 'Priya',
        message: 'Priya has no current or planned work today.',
      }),
    ];

    renderInbox({ onOpenTarget });
    openInbox();
    fireEvent.click(screen.getByText('Priya has no current or planned work today.'));

    expect(onOpenTarget).toHaveBeenCalledWith({
      type: 'developer',
      view: 'team',
      developerAccountId: 'dev-1',
    });
  });

  it('dismisses a single signal', () => {
    mockAlerts = [makeAlert()];

    renderInbox();
    openInbox();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss Blocked signal' }));

    expect(mockDismiss).toHaveBeenCalledWith({ alertIds: ['blocked:AM-2'] }, expect.anything());
  });

  it('clears all visible signals at once', () => {
    mockAlerts = [
      makeAlert({ id: 'overdue:AM-1', type: 'overdue', issueKey: 'AM-1', message: 'Issue AM-1 is overdue.' }),
      makeAlert(),
      makeAlert({ id: 'stale:AM-3', type: 'stale', severity: 'medium', issueKey: 'AM-3', message: 'Issue AM-3 is stale.' }),
    ];

    renderInbox();
    openInbox();
    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }));

    // AM-1's alert is deduplicated away, so only the visible signals are dismissed
    expect(mockDismiss).toHaveBeenCalledWith(
      { alertIds: ['blocked:AM-2', 'stale:AM-3'] },
      expect.anything()
    );
  });

  it('shows signals without the empty state when there are no actions', () => {
    mockActionsData = { actions: [], urgentCount: 0, totalCount: 0 };
    mockAlerts = [makeAlert()];

    renderInbox();
    openInbox();

    expect(screen.queryByText('No manager actions right now.')).not.toBeInTheDocument();
    expect(screen.getByText('Issue AM-2 is blocked.')).toBeInTheDocument();
  });
});
