import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { TestWrapper } from './wrapper';

const mockTriggerSync = {
  mutate: vi.fn(),
};

const defectTableSpy = vi.fn();
const filterSidebarSpy = vi.fn();
const useMediaQueryMock = vi.fn(() => false);

let mockJiraConfigured: boolean | undefined;
vi.mock('@/hooks/useSyncStatus', () => ({
  useSyncStatus: () => ({ data: { status: 'idle', jiraConfigured: mockJiraConfigured } }),
}));

vi.mock('@/hooks/useTriggerSync', () => ({
  useTriggerSync: () => mockTriggerSync,
}));

vi.mock('@/hooks/useMediaQuery', () => ({
  useMediaQuery: () => useMediaQueryMock(),
}));

vi.mock('@/components/layout/Header', () => ({
  Header: ({ onOpenMobileSidebar }: { onOpenMobileSidebar?: () => void }) => (
    <button onClick={onOpenMobileSidebar}>Header</button>
  ),
}));

vi.mock('@/components/alerts/ErrorBanner', () => ({
  ErrorBanner: () => null,
}));

vi.mock('@/components/filters/FilterSidebar', () => ({
  FilterSidebar: (props: {
    onCollapse?: () => void;
    onFilterChange?: (filter: 'blocked') => void;
    onClearFilter?: () => void;
    onDeveloperChange?: (accountId?: string) => void;
    onClearDeveloper?: () => void;
    onTagToggle?: (tagId: number) => void;
  }) => {
    filterSidebarSpy(props);
    return (
      <div>
        <button onClick={props.onCollapse}>Sidebar</button>
        <button onClick={() => props.onFilterChange?.('blocked')}>Sidebar Blocked</button>
        <button onClick={() => props.onDeveloperChange?.('dev-2')}>Sidebar Developer</button>
        <button onClick={() => props.onTagToggle?.(1)}>Sidebar Tag</button>
        <button onClick={props.onClearFilter}>Sidebar Clear Filter</button>
        <button onClick={props.onClearDeveloper}>Sidebar Clear Developer</button>
      </div>
    );
  },
}));

vi.mock('@/components/table/DefectTable', () => ({
  DefectTable: (props: {
    selectedKey?: string;
    highlightedKey?: string;
    onSelectIssue?: (key: string) => void;
    onClearFilters?: () => void;
    onVisibleIssueKeysChange?: (keys: string[]) => void;
  }) => {
    const [inlineEditorOpen, setInlineEditorOpen] = React.useState(false);

    React.useEffect(() => {
      props.onVisibleIssueKeysChange?.(['PROJ-102', 'PROJ-101']);
    }, [props]);

    defectTableSpy(props);
    return (
      <div>
        <div>Defect Table</div>
        <div data-testid="selected-key">{props.selectedKey ?? 'none'}</div>
        <div data-testid="highlighted-key">{props.highlightedKey ?? 'none'}</div>
        <div data-testid="inline-editor-state">{inlineEditorOpen ? 'open' : 'closed'}</div>
        <button onClick={() => props.onSelectIssue?.('PROJ-101')}>Open PROJ-101</button>
        <button onClick={() => props.onSelectIssue?.('PROJ-102')}>Open PROJ-102</button>
        <span
          role="button"
          tabIndex={0}
          data-inline-edit-trigger="assignee"
          onClick={() => setInlineEditorOpen(true)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              setInlineEditorOpen(true);
            }
          }}
        >
          Open Assignee Inline Edit
        </span>
        <button onClick={props.onClearFilters}>Clear Table Filters</button>
      </div>
    );
  },
}));

vi.mock('@/components/triage/TriagePanel', () => ({
  TriagePanel: ({ issueKey, onClose }: { issueKey?: string; onClose: () => void }) => (
    issueKey ? <button onClick={onClose}>Close Triage</button> : null
  ),
}));

vi.mock('@/components/workload/WorkloadBar', () => ({
  WorkloadBar: ({ activeDeveloper, onDeveloperClick }: { activeDeveloper?: string; onDeveloperClick: (accountId?: string) => void }) => (
    <button onClick={() => onDeveloperClick(activeDeveloper === 'dev-1' ? undefined : 'dev-1')}>Select Developer</button>
  ),
}));

vi.mock('@/components/work/WorkFocusStrip', () => ({
  WorkFocusStrip: ({ onFilterChange }: { onFilterChange: (filter: 'new') => void }) => (
    <button onClick={() => onFilterChange('new')}>Work Signal</button>
  ),
}));

vi.mock('@/components/settings/SettingsPanel', () => ({
  SettingsPanel: () => null,
}));

describe('DashboardLayout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockJiraConfigured = undefined;
    useMediaQueryMock.mockReturnValue(false);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps the active developer when a top work signal is clicked', () => {
    render(<DashboardLayout />, { wrapper: TestWrapper });

    fireEvent.click(screen.getByText('Select Developer'));
    fireEvent.click(screen.getByText('Work Signal'));

    const lastCall = defectTableSpy.mock.calls.at(-1)?.[0] as { filter: string; assigneeFilter?: string };
    expect(lastCall.filter).toBe('new');
    expect(lastCall.assigneeFilter).toBe('dev-1');
  });

  it('renders the desktop sidebar collapsed by default', () => {
    render(<DashboardLayout />, { wrapper: TestWrapper });

    const lastCall = filterSidebarSpy.mock.calls.at(-1)?.[0] as { collapsed: boolean; open: boolean; isMobile: boolean };
    expect(lastCall.isMobile).toBe(false);
    expect(lastCall.open).toBe(true);
    expect(lastCall.collapsed).toBe(true);
  });

  it('syncs workload developer selection into the sidebar and defect table filters', () => {
    render(<DashboardLayout />, { wrapper: TestWrapper });

    fireEvent.click(screen.getByText('Select Developer'));

    const lastSidebarCall = filterSidebarSpy.mock.calls.at(-1)?.[0] as { activeDeveloper?: string };
    const lastTableCall = defectTableSpy.mock.calls.at(-1)?.[0] as { assigneeFilter?: string };

    expect(lastSidebarCall.activeDeveloper).toBe('dev-1');
    expect(lastTableCall.assigneeFilter).toBe('dev-1');
  });

  it('keeps the active jira filter when a workload developer is selected', () => {
    render(<DashboardLayout />, { wrapper: TestWrapper });

    fireEvent.click(screen.getByText('Work Signal'));
    fireEvent.click(screen.getByText('Select Developer'));

    const lastSidebarCall = filterSidebarSpy.mock.calls.at(-1)?.[0] as { activeFilter: string; activeDeveloper?: string };
    const lastTableCall = defectTableSpy.mock.calls.at(-1)?.[0] as { filter: string; assigneeFilter?: string };

    expect(lastSidebarCall.activeFilter).toBe('new');
    expect(lastSidebarCall.activeDeveloper).toBe('dev-1');
    expect(lastTableCall.filter).toBe('new');
    expect(lastTableCall.assigneeFilter).toBe('dev-1');
  });

  it('opens the mobile drawer from the header toggle', () => {
    useMediaQueryMock.mockReturnValue(true);

    render(<DashboardLayout />, { wrapper: TestWrapper });

    fireEvent.click(screen.getByText('Header'));

    const lastCall = filterSidebarSpy.mock.calls.at(-1)?.[0] as { collapsed: boolean; open: boolean; isMobile: boolean };
    expect(lastCall.isMobile).toBe(true);
    expect(lastCall.open).toBe(true);
    expect(lastCall.collapsed).toBe(false);
  });

  it('retains the last opened row highlight after triage closes', () => {
    render(<DashboardLayout />, { wrapper: TestWrapper });

    fireEvent.click(screen.getByText('Open PROJ-101'));
    expect(screen.getByTestId('selected-key')).toHaveTextContent('PROJ-101');
    expect(screen.getByTestId('highlighted-key')).toHaveTextContent('PROJ-101');

    fireEvent.click(screen.getByText('Close Triage'));

    expect(screen.getByTestId('selected-key')).toHaveTextContent('none');
    expect(screen.getByTestId('highlighted-key')).toHaveTextContent('PROJ-101');
  });

  it('clears the retained highlight on the next interaction after triage closes', () => {
    vi.useFakeTimers();

    render(<DashboardLayout />, { wrapper: TestWrapper });

    fireEvent.click(screen.getByText('Open PROJ-101'));
    fireEvent.click(screen.getByText('Close Triage'));

    act(() => {
      vi.advanceTimersByTime(1500);
    });
    fireEvent.click(document.body);
    act(() => {
      vi.advanceTimersByTime(1500);
    });

    expect(screen.getByTestId('highlighted-key')).toHaveTextContent('none');
  });

  it('replaces the retained highlight when another defect is opened next', () => {
    vi.useFakeTimers();

    render(<DashboardLayout />, { wrapper: TestWrapper });

    fireEvent.click(screen.getByText('Open PROJ-101'));
    fireEvent.click(screen.getByText('Close Triage'));

    act(() => {
      vi.advanceTimersByTime(1500);
    });
    fireEvent.click(screen.getByText('Open PROJ-102'));
    act(() => {
      vi.advanceTimersByTime(1500);
    });

    expect(screen.getByTestId('selected-key')).toHaveTextContent('PROJ-102');
    expect(screen.getByTestId('highlighted-key')).toHaveTextContent('PROJ-102');
  });

  it('does not clear the retained highlight when the next click opens an inline table control', () => {
    vi.useFakeTimers();

    render(<DashboardLayout />, { wrapper: TestWrapper });

    fireEvent.click(screen.getByText('Open PROJ-101'));
    fireEvent.click(screen.getByText('Close Triage'));

    act(() => {
      vi.advanceTimersByTime(1500);
    });

    fireEvent.click(screen.getByText('Open Assignee Inline Edit'));

    act(() => {
      vi.advanceTimersByTime(1500);
    });

    expect(screen.getByTestId('inline-editor-state')).toHaveTextContent('open');
    expect(screen.getByTestId('highlighted-key')).toHaveTextContent('PROJ-101');
  });

  it('clears active dashboard filters from the defect table toolbar action', () => {
    render(<DashboardLayout />, { wrapper: TestWrapper });

    fireEvent.click(screen.getByText('Work Signal'));
    fireEvent.click(screen.getByText('Select Developer'));
    fireEvent.click(screen.getByText('Clear Table Filters'));

    const lastSidebarCall = filterSidebarSpy.mock.calls.at(-1)?.[0] as { activeFilter: string; activeDeveloper?: string; selectedTagId?: number; noTagsFilter: boolean };
    const lastTableCall = defectTableSpy.mock.calls.at(-1)?.[0] as { filter: string; assigneeFilter?: string; tagId?: number; noTags?: boolean };

    expect(lastSidebarCall.activeFilter).toBe('all');
    expect(lastSidebarCall.activeDeveloper).toBeUndefined();
    expect(lastSidebarCall.selectedTagId).toBeUndefined();
    expect(lastSidebarCall.noTagsFilter).toBe(false);
    expect(lastTableCall.filter).toBe('all');
    expect(lastTableCall.assigneeFilter).toBeUndefined();
    expect(lastTableCall.tagId).toBeUndefined();
    expect(lastTableCall.noTags).toBe(false);
  });

  it('clears only the primary filter back to all from the sidebar header action', () => {
    render(<DashboardLayout />, { wrapper: TestWrapper });

    fireEvent.click(screen.getByText('Sidebar Blocked'));
    fireEvent.click(screen.getByText('Sidebar Developer'));
    fireEvent.click(screen.getByText('Sidebar Tag'));
    fireEvent.click(screen.getByText('Sidebar Clear Filter'));

    const lastSidebarCall = filterSidebarSpy.mock.calls.at(-1)?.[0] as {
      activeFilter: string;
      activeDeveloper?: string;
      selectedTagId?: number;
      noTagsFilter: boolean;
    };
    const lastTableCall = defectTableSpy.mock.calls.at(-1)?.[0] as {
      filter: string;
      assigneeFilter?: string;
      tagId?: number;
      noTags?: boolean;
    };

    expect(lastSidebarCall.activeFilter).toBe('all');
    expect(lastSidebarCall.activeDeveloper).toBe('dev-2');
    expect(lastSidebarCall.selectedTagId).toBe(1);
    expect(lastSidebarCall.noTagsFilter).toBe(false);
    expect(lastTableCall.filter).toBe('all');
    expect(lastTableCall.assigneeFilter).toBe('dev-2');
    expect(lastTableCall.tagId).toBe(1);
    expect(lastTableCall.noTags).toBe(false);
  });

  it('clears only the active developer from the sidebar header action', () => {
    render(<DashboardLayout />, { wrapper: TestWrapper });

    fireEvent.click(screen.getByText('Work Signal'));
    fireEvent.click(screen.getByText('Sidebar Developer'));
    fireEvent.click(screen.getByText('Sidebar Tag'));
    fireEvent.click(screen.getByText('Sidebar Clear Developer'));

    const lastSidebarCall = filterSidebarSpy.mock.calls.at(-1)?.[0] as {
      activeFilter: string;
      activeDeveloper?: string;
      selectedTagId?: number;
      noTagsFilter: boolean;
    };
    const lastTableCall = defectTableSpy.mock.calls.at(-1)?.[0] as {
      filter: string;
      assigneeFilter?: string;
      tagId?: number;
      noTags?: boolean;
    };

    expect(lastSidebarCall.activeFilter).toBe('new');
    expect(lastSidebarCall.activeDeveloper).toBeUndefined();
    expect(lastSidebarCall.selectedTagId).toBe(1);
    expect(lastSidebarCall.noTagsFilter).toBe(false);
    expect(lastTableCall.filter).toBe('new');
    expect(lastTableCall.assigneeFilter).toBeUndefined();
    expect(lastTableCall.tagId).toBe(1);
    expect(lastTableCall.noTags).toBe(false);
  });

  it('opens the focused visible table row from keyboard navigation', () => {
    render(<DashboardLayout />, { wrapper: TestWrapper });

    fireEvent.keyDown(window, { key: 'ArrowDown' });
    fireEvent.keyDown(window, { key: 'Enter' });

    expect(screen.getByTestId('selected-key')).toHaveTextContent('PROJ-102');
  });

  it('r starts a sync when Jira is connected or not yet known (docs/56 P2-03)', () => {
    for (const configured of [true, undefined]) {
      mockJiraConfigured = configured;
      mockTriggerSync.mutate.mockClear();
      const { unmount } = render(<DashboardLayout />, { wrapper: TestWrapper });
      fireEvent.keyDown(window, { key: 'r' });
      expect(mockTriggerSync.mutate).toHaveBeenCalledTimes(1);
      unmount();
    }
  });

  it('r is inert when Jira is not connected, and still does not trigger a sync (docs/56 P2-03)', () => {
    mockJiraConfigured = false;
    render(<DashboardLayout />, { wrapper: TestWrapper });

    fireEvent.keyDown(window, { key: 'r' });

    expect(mockTriggerSync.mutate).not.toHaveBeenCalled();
  });

  it('does not hijack browser shortcuts that use modifier keys', () => {
    render(<DashboardLayout />, { wrapper: TestWrapper });

    fireEvent.keyDown(window, { key: 'r', ctrlKey: true });
    fireEvent.keyDown(window, { key: 'r', metaKey: true });
    fireEvent.keyDown(window, { key: 'ArrowDown', altKey: true });

    expect(mockTriggerSync.mutate).not.toHaveBeenCalled();
    expect(screen.getByTestId('selected-key')).toHaveTextContent('none');
  });
});
