import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TeamRosterEmpty } from '@/components/team-tracker/TeamRosterEmpty';
import { TrackerBoardToolbar } from '@/components/team-tracker/TrackerBoardToolbar';
import { TestWrapper } from './wrapper';

const mockPost = vi.fn();
const mockAddToast = vi.fn();
const syncMock = vi.hoisted(() => ({ jiraConfigured: false }));

vi.mock('@/lib/api', () => ({ api: { post: (...args: unknown[]) => mockPost(...args), get: vi.fn(), patch: vi.fn(), delete: vi.fn() } }));
vi.mock('@/context/ToastContext', () => ({ useToast: () => ({ addToast: mockAddToast }) }));
vi.mock('@/hooks/useSyncStatus', () => ({ useSyncStatus: () => ({ data: { jiraConfigured: syncMock.jiraConfigured } }) }));

beforeEach(() => {
  vi.clearAllMocks();
  syncMock.jiraConfigured = false;
  mockPost.mockResolvedValue({ accountId: 'manual:priya-1' });
});

describe('zero-roster Team page (UX-13)', () => {
  it('asks for the people you manage and adds one in place', async () => {
    render(<TestWrapper><TeamRosterEmpty /></TestWrapper>);
    expect(screen.getByText('Add the people you manage')).toBeInTheDocument();
    expect(screen.queryByText(/change the filters/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Import from Jira' })).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Priya Raman' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add person' }));
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/team/developers/manual', { displayName: 'Priya Raman', email: '' }));
    await waitFor(() => expect(mockAddToast).toHaveBeenCalledWith(expect.objectContaining({ type: 'success', title: 'Added Priya Raman' })));
  });

  it('offers Import from Jira only when Jira is connected', () => {
    syncMock.jiraConfigured = true;
    render(<TestWrapper><TeamRosterEmpty /></TestWrapper>);
    fireEvent.click(screen.getByRole('button', { name: 'Import from Jira' }));
    expect(window.location.pathname + window.location.search).toBe('/settings?section=team');
  });

  it('disables Standup and 1:1s until someone is on the roster', () => {
    const onStartStandup = vi.fn();
    render(
      <TestWrapper>
        <TrackerBoardToolbar
          searchQuery=""
          onSearchChange={vi.fn()}
          sortBy="name"
          onSortChange={vi.fn()}
          groupBy="none"
          onGroupChange={vi.fn()}
          visibleCount={0}
          totalCount={0}
          views={[]}
          describe={() => ''}
          activeViewId={null}
          isDirty={false}
          isViewsLoading={false}
          onApplyView={vi.fn()}
          onClearView={vi.fn()}
          onSaveNew={vi.fn()}
          onUpdateView={vi.fn()}
          onDeleteView={vi.fn()}
          isSaving={false}
          onStartStandup={onStartStandup}
          onOpenOneOnOnes={vi.fn()}
          rosterEmpty
        />
      </TestWrapper>,
    );
    expect(screen.getByRole('button', { name: 'Start standup' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Open 1:1s' })).toBeDisabled();
  });
});
