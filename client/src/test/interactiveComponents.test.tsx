import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorBanner } from '@/components/alerts/ErrorBanner';
import { MyDayInactiveBanner } from '@/components/my-day/MyDayInactiveBanner';
import { DismissCell } from '@/components/table/DismissCell';
import { InlineEditAssignee } from '@/components/table/InlineEditAssignee';
import { InlineEditPriority } from '@/components/table/InlineEditPriority';

const mockUseOverview = vi.fn();
const mockUseSyncStatus = vi.fn();
const mockUseDevelopers = vi.fn();
const mockUpdateIssueMutate = vi.fn();
const mockAddToast = vi.fn();

vi.mock('@/hooks/useOverview', () => ({
  useOverview: () => mockUseOverview(),
}));

vi.mock('@/hooks/useSyncStatus', () => ({
  useSyncStatus: () => mockUseSyncStatus(),
}));
vi.mock('@/hooks/useTriggerSync', () => ({ useTriggerSync: () => ({ mutate: vi.fn(), isPending: false }) }));

vi.mock('@/hooks/useDevelopers', () => ({
  useDevelopers: (...args: unknown[]) => mockUseDevelopers(...args),
}));

vi.mock('@/hooks/useUpdateIssue', () => ({
  useUpdateIssue: () => ({
    mutate: (...args: unknown[]) => mockUpdateIssueMutate(...args),
  }),
}));

vi.mock('@/context/ToastContext', () => ({
  useToast: () => ({
    addToast: mockAddToast,
  }),
}));

describe('interactive utility components', () => {
  beforeEach(() => {
    mockUseOverview.mockReturnValue({ error: null });
    mockUseSyncStatus.mockReturnValue({ data: { status: 'idle' } });
    mockUseDevelopers.mockReturnValue({ data: [] });
    mockUpdateIssueMutate.mockReset();
    mockAddToast.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders no error banner when API and sync status are healthy', () => {
    const { container } = render(<ErrorBanner />);

    expect(container).toBeEmptyDOMElement();
  });

  it('prioritizes rate limit, API-down, and sync-error banner messages', () => {
    mockUseSyncStatus.mockReturnValue({
      data: { status: 'error', errorMessage: 'Jira RATE LIMIT exceeded' },
    });
    const rateLimited = render(<ErrorBanner />);
    expect(screen.getByText('Jira rate limit hit. Auto-retrying shortly.')).toBeInTheDocument();
    rateLimited.unmount();

    mockUseOverview.mockReturnValue({ error: new Error('Network down') });
    mockUseSyncStatus.mockReturnValue({ data: { status: 'idle' } });
    const apiDown = render(<ErrorBanner />);
    expect(screen.getByText('Cannot reach server. Showing last known data.')).toBeInTheDocument();
    apiDown.unmount();

    mockUseOverview.mockReturnValue({ error: null });
    mockUseSyncStatus.mockReturnValue({
      data: { status: 'error', errorMessage: 'Invalid JQL' },
    });
    render(<ErrorBanner />);
    expect(screen.getByText('Jira sync failed.')).toBeInTheDocument();
  });

  it('requires a second click before dismissing an issue', async () => {
    const onConfirm = vi.fn();
    const parentClick = vi.fn();

    render(
      <div onClick={parentClick}>
        <DismissCell issueKey="AM-12" onConfirm={onConfirm} />
      </div>
    );

    fireEvent.click(screen.getByRole('button', { name: /dismiss am-12/i }));

    expect(parentClick).not.toHaveBeenCalled();
    expect(await screen.findByRole('button', { name: /confirm dismiss am-12/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /cancel dismiss/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /confirm dismiss am-12/i }));

    expect(onConfirm).toHaveBeenCalledWith('AM-12', expect.any(Object));
    expect(parentClick).not.toHaveBeenCalled();
  });

  it('cancels dismiss confirmation without calling the confirm handler', async () => {
    const onConfirm = vi.fn();

    render(<DismissCell issueKey="AM-13" onConfirm={onConfirm} />);

    fireEvent.click(screen.getByRole('button', { name: /dismiss am-13/i }));
    fireEvent.click(await screen.findByRole('button', { name: /cancel dismiss/i }));

    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('filters inline assignee options to Jira-linked developers and keeps the current inactive assignee visible', () => {
    const onClose = vi.fn();
    mockUseDevelopers.mockReturnValue({
      data: [
        {
          accountId: 'alice-1',
          jiraAccountId: 'jira-alice',
          displayName: 'Alice',
          source: 'jira',
          isActive: true,
          availability: { state: 'active' },
        },
        {
          accountId: 'bob-2',
          jiraAccountId: 'jira-bob',
          displayName: 'Bob',
          source: 'jira',
          isActive: true,
          availability: { state: 'inactive' },
        },
        {
          accountId: 'manual-1',
          displayName: 'Manual Only',
          source: 'manual',
          isActive: true,
        },
        {
          accountId: 'carol-3',
          jiraAccountId: 'jira-carol',
          displayName: 'Carol',
          source: 'jira',
          isActive: true,
          availability: { state: 'inactive' },
        },
      ],
    });

    render(<InlineEditAssignee issueKey="AM-12" currentId="jira-bob" onClose={onClose} />);

    expect(mockUseDevelopers).toHaveBeenCalledWith(expect.any(String), { includeUnavailable: true });
    expect(screen.getByRole('option', { name: 'Alice' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Bob (inactive)' })).toBeDisabled();
    expect(screen.queryByRole('option', { name: 'Manual Only' })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Carol (inactive)' })).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'jira-alice' } });

    expect(mockUpdateIssueMutate).toHaveBeenCalledWith(
      { key: 'AM-12', update: { assigneeId: 'jira-alice' } },
      expect.objectContaining({ onError: expect.any(Function) })
    );
    expect(onClose).toHaveBeenCalled();
  });

  it('updates inline priority changes and closes without mutating unchanged values', () => {
    const onClose = vi.fn();

    const { rerender } = render(
      <InlineEditPriority issueKey="AM-12" currentValue="High" onClose={onClose} />
    );

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Low' } });

    expect(mockUpdateIssueMutate).toHaveBeenCalledWith(
      { key: 'AM-12', update: { priorityName: 'Low' } },
      expect.objectContaining({ onError: expect.any(Function) })
    );
    expect(onClose).toHaveBeenCalledTimes(1);

    mockUpdateIssueMutate.mockClear();
    rerender(<InlineEditPriority issueKey="AM-12" currentValue="High" onClose={onClose} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'High' } });

    expect(mockUpdateIssueMutate).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('shows inactive My Day messaging only for inactive availability', () => {
    const active = render(<MyDayInactiveBanner availability={{ state: 'active' }} />);
    expect(active.container).toBeEmptyDOMElement();
    active.unmount();

    const withNote = render(<MyDayInactiveBanner availability={{ state: 'inactive', note: 'PTO' }} />);
    expect(screen.getByText('You are marked inactive for this day')).toBeInTheDocument();
    expect(screen.getByText('PTO')).toBeInTheDocument();
    withNote.unmount();

    render(<MyDayInactiveBanner availability={{ state: 'inactive' }} />);
    expect(
      screen.getByText('A manager marked this day unavailable. Your workspace is read-only until you are reactivated.')
    ).toBeInTheDocument();
  });
});
