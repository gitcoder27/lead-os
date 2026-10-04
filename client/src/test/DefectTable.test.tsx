import type * as Csv from '@/lib/csv';
import * as React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { DefectTable } from '@/components/table/DefectTable';
import { ThemeProvider, useTheme } from '@/context/ThemeContext';
import { TestWrapper } from '@/test/wrapper';
import { QuickActionsProvider } from '@/context/QuickActionsContext';
import type { SyncStatus } from '@/types';
import type { Issue } from '@/types';

vi.mock('framer-motion', () => {
  const motion = new Proxy(
    {},
    {
      get: (_target, tag: string) =>
        React.forwardRef<HTMLElement, React.HTMLAttributes<HTMLElement> & {
          initial?: unknown;
          animate?: unknown;
          transition?: unknown;
          whileHover?: unknown;
        }>(({ children, initial, animate: _animate, transition, whileHover: _whileHover, ...props }, ref) =>
          React.createElement(tag, {
            ...props,
            ref,
            'data-motion-initial': initial === false ? 'false' : JSON.stringify(initial),
            'data-motion-transition': transition ? JSON.stringify(transition) : '',
          }, children)
        ),
    }
  );

  return { motion };
});

const mockCsvDownload = vi.fn();
vi.mock('@/lib/csv', async (original) => ({ ...await original<typeof Csv>(), downloadCsv: (...args: unknown[]) => mockCsvDownload(...args) }));
const mockIssues: Issue[] = [
  {
    jiraKey: 'PROJ-101',
    summary: 'Login page crashes on submit',
    aspenSeverity: '1 - Critical',
    priorityName: 'Highest',
    priorityId: '1',
    statusName: 'To Do',
    statusCategory: 'new',
    assigneeName: 'Alice',
    assigneeId: 'alice-1',
    labels: [],
    flagged: false,
    createdAt: '2026-03-04T09:00:00Z',
    updatedAt: '2026-03-05T09:00:00Z',
    localTags: [],
    analysisNotes: 'Initial root-cause analysis completed.',
    trackerAssignmentsToday: {
      activeCount: 2,
      developerNames: ['Alice', 'Bob'],
    },
  },
  {
    jiraKey: 'PROJ-102',
    summary: 'Cart total calculation error',
    aspenSeverity: '2 - Major',
    priorityName: 'High',
    priorityId: '2',
    statusName: 'In Progress',
    statusCategory: 'indeterminate',
    assigneeName: 'Bob',
    assigneeId: 'bob-2',
    labels: [],
    flagged: true,
    createdAt: '2026-03-03T09:00:00Z',
    updatedAt: '2026-03-05T07:00:00Z',
    dueDate: '2026-03-07',
    localTags: [],
  },
  {
    jiraKey: 'PROJ-103',
    summary: 'Stale defect not updated',
    aspenSeverity: '4 - Low',
    priorityName: 'Medium',
    priorityId: '3',
    statusName: 'To Do',
    statusCategory: 'new',
    assigneeName: 'Charlie',
    assigneeId: 'charlie-3',
    labels: [],
    flagged: false,
    createdAt: '2026-02-01T09:00:00Z',
    updatedAt: '2026-02-01T09:00:00Z',
    // docs/56 P1-05: staleness is decided by the server's Attention rules.
    stale: true,
    localTags: [],
  },
];

const mockCreateTagMutate = vi.fn();
const mockSetIssueTagsMutate = vi.fn();
const mockUpdateIssueMutate = vi.fn();
let currentIssues: Issue[] | undefined = mockIssues;
let issueQueryState = {
  isLoading: false,
  isError: false,
  error: null as Error | null,
  isFetching: false,
  refetch: vi.fn(),
};

function ThemeToggleHarness(props: React.ComponentProps<typeof DefectTable>) {
  const { toggleTheme } = useTheme();

  return (
    <>
      <button type="button" onClick={toggleTheme}>
        Toggle theme
      </button>
      <DefectTable {...props} />
    </>
  );
}

const animatedRows: Issue[] = Array.from({ length: 14 }, (_, index) => ({
  jiraKey: `PROJ-${200 + index}`,
  summary: `Animated defect ${index + 1}`,
  aspenSeverity: '2 - Major',
  priorityName: 'High',
  priorityId: '2',
  statusName: 'To Do',
  statusCategory: 'new',
  assigneeName: `Engineer ${index + 1}`,
  assigneeId: `engineer-${index + 1}`,
  labels: [],
  flagged: false,
  createdAt: '2026-03-03T09:00:00Z',
  updatedAt: '2026-03-05T09:00:00Z',
  localTags: [],
}));

vi.mock('@/hooks/useIssues', () => ({
  useIssues: () => ({
    data: currentIssues,
    isLoading: issueQueryState.isLoading,
    isError: issueQueryState.isError,
    error: issueQueryState.error,
    isFetching: issueQueryState.isFetching,
    refetch: issueQueryState.refetch,
  }),
}));

vi.mock('@/hooks/useConfig', () => ({
  useConfig: () => ({ data: { jiraBaseUrl: 'https://test.atlassian.net', isConfigured: true, jiraSyncScopeMode: 'team_assignees' } }),
}));

let mockSyncStatus: SyncStatus | undefined;
vi.mock('@/hooks/useSyncStatus', () => ({
  useSyncStatus: () => ({ data: mockSyncStatus }),
}));

vi.mock('@/hooks/useTags', () => ({
  useTags: () => ({ data: [{ id: 1, name: 'Backend', color: '#6366f1' }] }),
  useCreateTag: () => ({ mutate: mockCreateTagMutate, isPending: false }),
  useSetIssueTags: () => ({ mutate: mockSetIssueTagsMutate, isPending: false }),
}));

vi.mock('@/hooks/useUpdateIssue', () => ({
  useUpdateIssue: () => ({ mutate: mockUpdateIssueMutate, isPending: false }),
}));

describe('DefectTable', () => {
  const onSelectIssue = vi.fn();
  const onFocusedIndexChange = vi.fn();
  const onClearFilters = vi.fn();
  const defaultProps = {
    filter: 'all' as const,
    onSelectIssue,
    focusedIndex: -1,
    onFocusedIndexChange,
    hasAnimated: true,
    onClearFilters,
  };

  beforeEach(() => {
    currentIssues = mockIssues;
    issueQueryState = {
      isLoading: false,
      isError: false,
      error: null,
      isFetching: false,
      refetch: vi.fn(),
    };
    onSelectIssue.mockClear();
    onFocusedIndexChange.mockClear();
    onClearFilters.mockClear();
    mockCreateTagMutate.mockClear();
    mockSetIssueTagsMutate.mockClear();
    mockUpdateIssueMutate.mockClear();
    window.localStorage.clear();
    mockSyncStatus = undefined;
  });

  describe('empty states (docs/56 P2-03)', () => {
    const openCapture = vi.fn();
    const renderEmpty = (props: Partial<React.ComponentProps<typeof DefectTable>> = {}) => {
      currentIssues = [];
      return render(
        <TestWrapper>
          <QuickActionsProvider value={{ openCapture, openCommandPalette: vi.fn() }}>
            <DefectTable {...defaultProps} {...props} />
          </QuickActionsProvider>
        </TestWrapper>,
      );
    };

    beforeEach(() => openCapture.mockClear());

    it('without a Jira connection: "Connect Jira, or add tasks manually" instead of "Your project is clean"', () => {
      mockSyncStatus = { status: 'idle', jiraConfigured: false };
      const onConnectJira = vi.fn();
      renderEmpty({ onConnectJira });

      expect(screen.getByText('Connect Jira, or add tasks manually')).toBeInTheDocument();
      expect(screen.queryByText(/project is clean/i)).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Connect Jira' }));
      expect(onConnectJira).toHaveBeenCalledTimes(1);
      fireEvent.click(screen.getByRole('button', { name: 'Add a task' }));
      expect(openCapture).toHaveBeenCalledTimes(1);
    });

    it('without a Jira connection there is no red sync-error card, even if an old error is on record', () => {
      mockSyncStatus = { status: 'error', errorMessage: 'Missing jira_project_key in config', jiraConfigured: false };
      renderEmpty();

      expect(screen.getByTestId('work-jira-not-connected')).toBeInTheDocument();
      expect(screen.queryByText(/could not be refreshed/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/Missing jira_project_key/)).not.toBeInTheDocument();
    });

    it('connected but never synced: says what was tried instead of "clean"', () => {
      mockSyncStatus = { status: 'idle', jiraConfigured: true };
      const onOpenSyncSettings = vi.fn();
      renderEmpty({ onOpenSyncSettings });

      const card = screen.getByTestId('work-nothing-synced');
      expect(within(card).getByText('Jira is connected, but nothing has synced yet')).toBeInTheDocument();
      expect(within(card).getByText('Never')).toBeInTheDocument();
      expect(within(card).getByText('Issues synced').nextElementSibling).toHaveTextContent('0');
      expect(within(card).getByText(/Team assignees/)).toBeInTheDocument();
      expect(within(card).getByText(/only pulls issues assigned to people on your team/i)).toBeInTheDocument();
      expect(screen.queryByText(/project is clean/i)).not.toBeInTheDocument();
      fireEvent.click(within(card).getByRole('button', { name: 'Open sync settings' }));
      expect(onOpenSyncSettings).toHaveBeenCalledTimes(1);
    });

    it('the diagnostic shows synced count, scope and roster size (docs/56 P5-01)', () => {
      mockSyncStatus = {
        status: 'idle',
        jiraConfigured: true,
        lastSyncedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
        issuesSynced: 0,
        syncScope: { mode: 'team_assignees', rosterSize: 0 },
      };
      renderEmpty();

      const card = screen.getByTestId('work-nothing-synced');
      expect(within(card).getByText('Issues synced').nextElementSibling).toHaveTextContent('0');
      expect(within(card).getByText('Scope').nextElementSibling).toHaveTextContent(/Team assignees/);
      expect(within(card).getByText('Roster size').nextElementSibling).toHaveTextContent('0 tracked people');
      expect(within(card).getByText(/your roster is empty, so nothing can match/i)).toBeInTheDocument();
    });

    it('roster-only scope with people on the roster points at unassigned issues instead of blaming the roster', () => {
      mockSyncStatus = { status: 'idle', jiraConfigured: true, syncScope: { mode: 'team_assignees', rosterSize: 1 } };
      renderEmpty();

      const card = screen.getByTestId('work-nothing-synced');
      expect(within(card).getByText('Roster size').nextElementSibling).toHaveTextContent('1 tracked person');
      expect(within(card).queryByText(/roster is empty/i)).not.toBeInTheDocument();
      expect(within(card).getByText(/switch the scope to include unassigned issues/i)).toBeInTheDocument();
    });

    it('connected and the last sync returned nothing: still the diagnostic, with the sync time', () => {
      mockSyncStatus = { status: 'idle', jiraConfigured: true, lastSyncedAt: new Date(Date.now() - 5 * 60_000).toISOString(), issuesSynced: 0 };
      renderEmpty();

      const card = screen.getByTestId('work-nothing-synced');
      expect(within(card).queryByText('Never')).not.toBeInTheDocument();
      expect(within(card).getByText('Last sync').nextElementSibling).toHaveTextContent(/5 minutes ago/);
    });

    it('keeps "Your project is clean" when a sync did return issues and none are open', () => {
      mockSyncStatus = { status: 'idle', jiraConfigured: true, lastSyncedAt: '2026-03-05T09:00:00Z', issuesSynced: 12 };
      renderEmpty();

      expect(screen.getByText('No open defects. Your project is clean.')).toBeInTheDocument();
      expect(screen.queryByTestId('work-nothing-synced')).not.toBeInTheDocument();
    });

    it('keeps the old behaviour while the sync status is still loading', () => {
      mockSyncStatus = undefined;
      renderEmpty();

      expect(screen.getByText('No open defects. Your project is clean.')).toBeInTheDocument();
      expect(screen.queryByTestId('work-jira-not-connected')).not.toBeInTheDocument();
    });

    it('a filter with no matches is still just the filter message, connected or not', () => {
      mockSyncStatus = { status: 'idle', jiraConfigured: false };
      renderEmpty({ filter: 'overdue' });

      expect(screen.getByText('No defects match the current filters.')).toBeInTheDocument();
      expect(screen.queryByTestId('work-jira-not-connected')).not.toBeInTheDocument();
    });
  });

  it('renders rows from mock data', () => {
    render(
      <TestWrapper>
        <DefectTable {...defaultProps} />
      </TestWrapper>
    );

    expect(screen.getByText('PROJ-101')).toBeInTheDocument();
    expect(screen.getByText('PROJ-102')).toBeInTheDocument();
    expect(screen.getByText('Login page crashes on submit')).toBeInTheDocument();
    expect(screen.getByText('Cart total calculation error')).toBeInTheDocument();
  });

  it('shows cards, not a scrolling table, on a phone (UX-25)', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ media: query, matches: query === '(max-width: 640px)', addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    try {
      const onSelectIssue = vi.fn();
      render(
        <TestWrapper>
          <DefectTable {...defaultProps} onSelectIssue={onSelectIssue} />
        </TestWrapper>
      );
      expect(screen.queryByRole('table')).toBeNull();
      const cards = screen.getAllByTestId('defect-card');
      expect(cards.length).toBeGreaterThanOrEqual(2);
      const first = cards.find((card) => card.textContent?.includes('PROJ-101'))!;
      expect(first).toHaveTextContent('Login page crashes on submit');
      expect(first).toHaveTextContent('Alice');
      expect(first).toHaveTextContent('To Do');
      fireEvent.click(first);
      expect(onSelectIssue).toHaveBeenCalledWith('PROJ-101');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('calls onSelectIssue when a row is clicked', () => {
    render(
      <TestWrapper>
        <DefectTable {...defaultProps} />
      </TestWrapper>
    );

    fireEvent.click(screen.getByText('Login page crashes on submit'));
    expect(onSelectIssue).toHaveBeenCalledWith('PROJ-101');
  });

  it('exposes an explicit Open button for keyboard and assistive tech users', () => {
    render(
      <TestWrapper>
        <DefectTable {...defaultProps} />
      </TestWrapper>
    );

    fireEvent.click(screen.getByRole('button', { name: /open triage for proj-101/i }));

    expect(onSelectIssue).toHaveBeenCalledWith('PROJ-101');
  });

  it('marks the active row with the hover surface state', () => {
    render(
      <TestWrapper>
        <DefectTable {...defaultProps} selectedKey="PROJ-101" highlightedKey="PROJ-101" />
      </TestWrapper>
    );

    const row = screen.getByText('PROJ-101').closest('tr');
    expect(row).toHaveAttribute('data-selection-state', 'active');
    expect(row?.getAttribute('style')).toContain('background-color: color-mix(in srgb, var(--bg-tertiary) 72%, transparent)');
    expect(screen.getByLabelText('Row indicator: Open in triage')).toBeInTheDocument();
  });

  it('marks the retained row with the hover surface state', () => {
    render(
      <TestWrapper>
        <DefectTable {...defaultProps} highlightedKey="PROJ-102" />
      </TestWrapper>
    );

    const row = screen.getByText('PROJ-102').closest('tr');
    expect(row).toHaveAttribute('data-selection-state', 'retained');
    expect(row?.getAttribute('style')).toContain('background-color: color-mix(in srgb, var(--bg-tertiary) 72%, transparent)');
    expect(screen.getByLabelText('Row indicator: Last opened defect')).toBeInTheDocument();
  });

  it('renders sort headers', () => {
    render(
      <TestWrapper>
        <DefectTable {...defaultProps} />
      </TestWrapper>
    );

    expect(screen.getByText('Sev')).toBeInTheDocument();
    expect(screen.getByText('ID')).toBeInTheDocument();
    expect(screen.getByText('Title')).toBeInTheDocument();
    expect(screen.getByText('Tags')).toBeInTheDocument();
    expect(screen.getByText('Assignee')).toBeInTheDocument();
    expect(screen.getByText('Due Date')).toBeInTheDocument();
    expect(screen.getByText('Status')).toBeInTheDocument();
    // UX-31: Notes and Tracker are one "Linked" column; there is no OPEN column.
    expect(screen.getByText('Linked')).toBeInTheDocument();
    expect(screen.queryByText('Notes')).toBeNull();
    expect(screen.queryByText('Tracker')).toBeNull();
    expect(screen.queryByRole('columnheader', { name: /^open$/i })).toBeNull();
    expect(screen.getByRole('columnheader', { name: /linked/i })).toHaveAttribute('aria-sort', 'none');
  });

  it('uses button semantics for inline assignee and due-date edits', () => {
    render(
      <TestWrapper>
        <DefectTable {...defaultProps} />
      </TestWrapper>
    );

    expect(screen.getByRole('button', { name: /edit assignee for proj-101/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /edit due date for proj-102/i })).toBeInTheDocument();
  });

  it('renders issue query failures as retryable errors instead of empty data', () => {
    issueQueryState = {
      isError: true,
      error: new Error('Query exploded'),
      isFetching: false,
      refetch: vi.fn(),
    };

    render(
      <TestWrapper>
        <DefectTable {...defaultProps} />
      </TestWrapper>
    );

    expect(screen.getByText('Could not load defects')).toBeInTheDocument();
    expect(screen.getByText('Query exploded')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^retry$/i }));
    expect(issueQueryState.refetch).toHaveBeenCalled();
  });

  it('renders Jira links for issue IDs when config available', () => {
    render(
      <TestWrapper>
        <DefectTable {...defaultProps} />
      </TestWrapper>
    );

    const link101 = screen.getByText('PROJ-101').closest('a');
    expect(link101).toHaveAttribute('href', 'https://test.atlassian.net/browse/PROJ-101');
    expect(link101).toHaveAttribute('target', '_blank');
    expect(link101).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('keeps the first follow-up interaction working after a Jira link is highlighted', async () => {
    render(
      <TestWrapper>
        <DefectTable {...defaultProps} />
      </TestWrapper>
    );

    const jiraLink = screen.getByText('PROJ-101').closest('a');
    expect(jiraLink).toBeTruthy();
    if (!jiraLink) {
      throw new Error('Expected Jira link for PROJ-101');
    }

    fireEvent.click(jiraLink);
    expect(screen.getByLabelText('Row indicator: Last opened in Jira')).toBeInTheDocument();

    const openSearchButton = screen.getByLabelText('Open defect search');
    fireEvent.mouseDown(openSearchButton);
    expect(screen.getByLabelText('Row indicator: Last opened in Jira')).toBeInTheDocument();

    fireEvent.click(openSearchButton);
    expect(screen.getByLabelText('Search defects by ID or title')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByLabelText('Row indicator: Last opened in Jira')).not.toBeInTheDocument();
    });
  });

  it('renders stale row in the table', () => {
    render(
      <TestWrapper>
        <DefectTable {...defaultProps} />
      </TestWrapper>
    );

    // PROJ-103 is stale because the server says so; no client threshold.
    expect(screen.getByText('PROJ-103')).toBeInTheDocument();
    expect(screen.getByText('Stale defect not updated')).toBeInTheDocument();
    const staleLabel = 'Row indicator: Stale: no recent Jira update (see Attention rules)';
    expect(screen.getAllByLabelText(staleLabel).length).toBe(1);
  });

  it('animates rows beyond the initial viewport cutoff on first load', () => {
    currentIssues = animatedRows;

    render(
      <TestWrapper>
        <DefectTable {...defaultProps} hasAnimated={false} />
      </TestWrapper>
    );

    const laterRow = screen.getByText('PROJ-212').closest('tr');
    expect(laterRow).toHaveAttribute('data-motion-initial', JSON.stringify({ opacity: 0, y: 6 }));
    expect(laterRow).toHaveAttribute('data-motion-transition', JSON.stringify({ duration: 0.2, delay: 0.76 }));
  });

  it('remounts animated rows when the theme changes so row surfaces repaint', async () => {
    render(
      <ThemeProvider>
        <TestWrapper>
          <ThemeToggleHarness {...defaultProps} />
        </TestWrapper>
      </ThemeProvider>
    );

    const originalRow = screen.getByText('PROJ-101').closest('tr');
    expect(originalRow).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Toggle theme' }));

    await waitFor(() => {
      expect(document.documentElement).toHaveClass('dark');
    });

    const themedRow = screen.getByText('PROJ-101').closest('tr');
    expect(themedRow).toBeTruthy();
    expect(themedRow).not.toBe(originalRow);
  });

  it('uses ASPEN Severity values for the first-column indicators', () => {
    render(
      <TestWrapper>
        <DefectTable {...defaultProps} />
      </TestWrapper>
    );

    expect(screen.getByTitle('1 - Critical')).toBeInTheDocument();
    expect(screen.getByTitle('2 - Major')).toBeInTheDocument();
    expect(screen.getByTitle('4 - Low')).toBeInTheDocument();
  });

  it('renders inline tag manage action in Tags column', () => {
    render(
      <TestWrapper>
        <DefectTable {...defaultProps} />
      </TestWrapper>
    );

    expect(screen.getByLabelText('Manage tags for PROJ-101')).toBeInTheDocument();
  });

  it('does not select triage issue when clicking the tag manage action', () => {
    render(
      <TestWrapper>
        <DefectTable {...defaultProps} />
      </TestWrapper>
    );

    fireEvent.click(screen.getByLabelText('Manage tags for PROJ-101'));
    expect(onSelectIssue).not.toHaveBeenCalledWith('PROJ-101');
  });

  it('selects the row when clicking back into the table while the tag editor is open', () => {
    render(
      <TestWrapper>
        <DefectTable {...defaultProps} />
      </TestWrapper>
    );

    fireEvent.click(screen.getByLabelText('Manage tags for PROJ-101'));
    expect(screen.getByPlaceholderText('Search or create tag…')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Login page crashes on submit'));

    expect(onSelectIssue).toHaveBeenCalledWith('PROJ-101');
  });

  it('selects the row after triggering an inline tag update from the popover', () => {
    render(
      <TestWrapper>
        <DefectTable {...defaultProps} />
      </TestWrapper>
    );

    fireEvent.click(screen.getByLabelText('Manage tags for PROJ-101'));
    fireEvent.change(screen.getByPlaceholderText('Search or create tag…'), { target: { value: 'Backend' } });
    fireEvent.click(screen.getByRole('button', { name: 'Use' }));

    expect(mockSetIssueTagsMutate).toHaveBeenCalled();

    fireEvent.click(screen.getByText('Login page crashes on submit'));

    expect(onSelectIssue).toHaveBeenCalledWith('PROJ-101');
  });

  it('shows what a defect is linked to in one column, and nothing for an unlinked one (UX-31)', () => {
    render(
      <TestWrapper>
        <DefectTable {...defaultProps} />
      </TestWrapper>
    );

    expect(screen.getByRole('img', { name: 'Analysis notes' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: '2 Team board tasks: Alice, Bob' })).toBeInTheDocument();
    expect(screen.queryByLabelText(/Analysis pending|No Team Tracker/)).toBeNull();
  });

  it('sorts by the Linked header, most linked first', () => {
    render(
      <TestWrapper>
        <DefectTable {...defaultProps} />
      </TestWrapper>
    );

    fireEvent.click(screen.getByText('Linked'));

    const rows = screen.getAllByRole('row');
    expect(rows[1]).toHaveTextContent('PROJ-101');
  });

  it('shows tags only when present (UX-31)', () => {
    render(
      <TestWrapper>
        <DefectTable {...defaultProps} />
      </TestWrapper>
    );
    expect(screen.queryByText('No tags')).toBeNull();
    // The add control stays reachable for every row.
    expect(screen.getByRole('button', { name: 'Manage tags for PROJ-102' })).toBeInTheDocument();
  });

  it('exports exactly the filtered Work rows without private analysis notes', () => {
    mockCsvDownload.mockClear();
    render(<TestWrapper><DefectTable {...defaultProps} /></TestWrapper>);
    fireEvent.click(screen.getByLabelText('Open defect search'));
    fireEvent.change(screen.getByLabelText('Search defects by ID or title'), { target: { value: 'PROJ-101' } });
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    const csv = mockCsvDownload.mock.calls[0]?.[0];
    expect(csv).toContain('PROJ-101'); expect(csv).not.toMatch(/PROJ-102|PROJ-103|Initial root-cause/);
  });

  it('filters visible defects by Jira ID from search', () => {
    render(
      <TestWrapper>
        <DefectTable {...defaultProps} />
      </TestWrapper>
    );

    fireEvent.click(screen.getByLabelText('Open defect search'));
    fireEvent.change(screen.getByLabelText('Search defects by ID or title'), { target: { value: 'PROJ-102' } });

    expect(screen.getByText('PROJ-102')).toBeInTheDocument();
    expect(screen.queryByText('PROJ-101')).not.toBeInTheDocument();
    expect(screen.queryByText('PROJ-103')).not.toBeInTheDocument();
  });

  it('filters visible defects by title from search', () => {
    render(
      <TestWrapper>
        <DefectTable {...defaultProps} />
      </TestWrapper>
    );

    fireEvent.click(screen.getByLabelText('Open defect search'));
    fireEvent.change(screen.getByLabelText('Search defects by ID or title'), { target: { value: 'stale defect' } });

    expect(screen.getByText('PROJ-103')).toBeInTheDocument();
    expect(screen.queryByText('PROJ-101')).not.toBeInTheDocument();
    expect(screen.queryByText('PROJ-102')).not.toBeInTheDocument();
  });

  it('clears dashboard filters and local search from the toolbar action', () => {
    render(
      <TestWrapper>
        <DefectTable {...defaultProps} filter="blocked" assigneeFilter="alice-1" tagId={1} noTags />
      </TestWrapper>
    );

    fireEvent.click(screen.getByLabelText('Open defect search'));
    fireEvent.change(screen.getByLabelText('Search defects by ID or title'), { target: { value: 'PROJ-102' } });
    fireEvent.click(screen.getByLabelText('Clear all defect filters'));

    expect(onClearFilters).toHaveBeenCalled();
    expect(screen.queryByLabelText('Search defects by ID or title')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Open defect search')).toBeInTheDocument();
  });

  it('treats persisted status exclusions as active filters and clears them from the toolbar action', () => {
    window.localStorage.setItem('lead-os:anonymous:dcc:defect-table:excluded-statuses', JSON.stringify(['To Do']));

    render(
      <TestWrapper>
        <DefectTable {...defaultProps} />
      </TestWrapper>
    );

    expect(screen.queryByText('PROJ-101')).not.toBeInTheDocument();
    expect(screen.getByText('PROJ-102')).toBeInTheDocument();
    expect(screen.queryByText('PROJ-103')).not.toBeInTheDocument();

    const clearButton = screen.getByLabelText('Clear all defect filters');
    expect(clearButton).not.toBeDisabled();
    fireEvent.click(clearButton);

    expect(screen.getByText('PROJ-101')).toBeInTheDocument();
    expect(screen.getByText('PROJ-102')).toBeInTheDocument();
    expect(screen.getByText('PROJ-103')).toBeInTheDocument();
    expect(window.localStorage.getItem('lead-os:anonymous:dcc:defect-table:excluded-statuses')).toBeNull();
    expect(onClearFilters).toHaveBeenCalled();
  });

  it('reports zero visible issue keys once when a filter has no matches', async () => {
    currentIssues = [];
    const visibleKeysChange = vi.fn();

    function VisibleIssueKeysHarness() {
      const [reportedKeys, setReportedKeys] = React.useState<string[]>(['PROJ-101']);
      const handleVisibleIssueKeysChange = React.useCallback((keys: string[]) => {
        visibleKeysChange(keys);
        setReportedKeys(keys);
      }, []);

      return (
        <>
          <div data-testid="reported-visible-keys">
            {reportedKeys.length > 0 ? reportedKeys.join(',') : 'empty'}
          </div>
          <DefectTable
            {...defaultProps}
            filter="overdue"
            onVisibleIssueKeysChange={handleVisibleIssueKeysChange}
          />
        </>
      );
    }

    render(
      <TestWrapper>
        <VisibleIssueKeysHarness />
      </TestWrapper>
    );

    await waitFor(() => {
      expect(screen.getByTestId('reported-visible-keys')).toHaveTextContent('empty');
    });
    expect(visibleKeysChange).toHaveBeenCalledTimes(1);
    expect(visibleKeysChange).toHaveBeenCalledWith([]);
  });

  it('keeps visible issue keys stable while a filtered issue query is loading', async () => {
    currentIssues = undefined;
    issueQueryState = {
      ...issueQueryState,
      isLoading: true,
      isFetching: true,
    };
    const visibleKeysChange = vi.fn();

    function LoadingFilterHarness() {
      const [reportedKeys, setReportedKeys] = React.useState<string[]>(['PROJ-101']);
      const handleVisibleIssueKeysChange = React.useCallback((keys: string[]) => {
        visibleKeysChange(keys);
        setReportedKeys(keys);
      }, []);

      return (
        <>
          <div data-testid="reported-visible-keys">
            {reportedKeys.length > 0 ? reportedKeys.join(',') : 'empty'}
          </div>
          <DefectTable
            {...defaultProps}
            filter="overdue"
            onVisibleIssueKeysChange={handleVisibleIssueKeysChange}
          />
        </>
      );
    }

    render(
      <TestWrapper>
        <LoadingFilterHarness />
      </TestWrapper>
    );

    expect(screen.getByText('Loading defects')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByTestId('reported-visible-keys')).toHaveTextContent('empty');
    });
    expect(visibleKeysChange).toHaveBeenCalledTimes(1);
    expect(visibleKeysChange).toHaveBeenCalledWith([]);
  });

  it('auto-hides search on blur when query is empty', () => {
    render(
      <TestWrapper>
        <DefectTable {...defaultProps} />
      </TestWrapper>
    );

    fireEvent.click(screen.getByLabelText('Open defect search'));
    const input = screen.getByLabelText('Search defects by ID or title');
    fireEvent.blur(input);

    expect(screen.queryByLabelText('Search defects by ID or title')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Open defect search')).toBeInTheDocument();
  });

  it('keeps search open on blur when query has text', () => {
    render(
      <TestWrapper>
        <DefectTable {...defaultProps} />
      </TestWrapper>
    );

    fireEvent.click(screen.getByLabelText('Open defect search'));
    const input = screen.getByLabelText('Search defects by ID or title');
    fireEvent.change(input, { target: { value: 'PROJ' } });
    fireEvent.blur(input);

    expect(screen.getByLabelText('Search defects by ID or title')).toBeInTheDocument();
  });

  it('opens the due-date editor without calling showPicker', () => {
    const showPicker = vi.fn(() => {
      throw new DOMException(
        "Failed to execute 'showPicker' on 'HTMLInputElement': HTMLInputElement::showPicker() requires a user gesture.",
        'NotAllowedError'
      );
    });
    const originalShowPicker = HTMLInputElement.prototype.showPicker;
    HTMLInputElement.prototype.showPicker = showPicker;

    try {
      render(
        <TestWrapper>
          <DefectTable {...defaultProps} />
        </TestWrapper>
      );

      fireEvent.click(screen.getByText('Mar 7'));

      expect(screen.getByDisplayValue('2026-03-07')).toBeInTheDocument();
      expect(showPicker).not.toHaveBeenCalled();
      expect(screen.getByText('PROJ-102')).toBeInTheDocument();
    } finally {
      HTMLInputElement.prototype.showPicker = originalShowPicker;
    }
  });

  it('prefills the due-date editor from the effective displayed due date', () => {
    render(
      <TestWrapper>
        <DefectTable {...defaultProps} />
      </TestWrapper>
    );

    fireEvent.click(screen.getByText('Mar 7'));

    expect(screen.getByDisplayValue('2026-03-07')).toBeInTheDocument();
  });

  it('updates developmentDueDate when a due date is changed from the table', () => {
    render(
      <TestWrapper>
        <DefectTable {...defaultProps} />
      </TestWrapper>
    );

    fireEvent.click(screen.getByText('Mar 7'));
    const editor =screen.getByDisplayValue('2026-03-07');
    fireEvent.change(editor, { target: { value: '2026-03-10' } });
    expect(mockUpdateIssueMutate).not.toHaveBeenCalled();
    fireEvent.keyDown(editor, { key: 'Enter' });

    expect(mockUpdateIssueMutate).toHaveBeenCalledWith(
      { key: 'PROJ-102', update: { developmentDueDate: '2026-03-10' } },
      expect.objectContaining({
        onError: expect.any(Function),
      })
    );
  });

  it('uses developmentDueDate as the row due-state source for left indicators', () => {
    const targetIssue = mockIssues.find((issue) => issue.jiraKey === 'PROJ-102');
    expect(targetIssue).toBeDefined();
    if (!targetIssue) {
      throw new Error('Expected PROJ-102 in mockIssues');
    }

    const originalDueDate = targetIssue.dueDate;
    const originalDevDueDate = targetIssue.developmentDueDate;

    // Make sources conflict: Jira due date is overdue, dev due date is far-future.
    targetIssue.dueDate = '2020-01-01';
    targetIssue.developmentDueDate = '2099-01-01';

    try {
      render(
        <TestWrapper>
          <DefectTable {...defaultProps} />
        </TestWrapper>
      );

      const row = screen.getByText('PROJ-102').closest('tr');
      expect(row).toBeTruthy();

      // If dueDate was used, this would be var(--danger); with developmentDueDate precedence,
      // PROJ-102 falls back to flagged styling.
      expect(within(row as HTMLElement).getByLabelText('Row indicator: Flagged issue')).toBeInTheDocument();
    } finally {
      targetIssue.dueDate = originalDueDate;
      targetIssue.developmentDueDate = originalDevDueDate;
    }
  });
});
