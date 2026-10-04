import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useState } from 'react';
import { FilterSidebar } from '@/components/filters/FilterSidebar';
import { TestWrapper } from '@/test/wrapper';
import type { OverviewCounts, DeveloperWorkload } from '@/types';

const mockOverview: OverviewCounts = {
  new: 3,
  recentlyAssigned: 4,
  reopened: 1,
  unassigned: 5,
  dueToday: 2,
  dueThisWeek: 6,
  noDueDate: 2,
  overdue: 1,
  blocked: 2,
  stale: 4,
  highPriority: 7,
  inProgress: 8,
  total: 24,
};

const mockWorkload: DeveloperWorkload[] = [
  {
    developer: { accountId: 'alice-1', displayName: 'Alice', isActive: true },
    activeDefects: 4,
    dueToday: 1,
    blocked: 0,
    score: 9,
    level: 'medium',
  },
  {
    developer: { accountId: 'bob-2', displayName: 'Bob', isActive: true },
    activeDefects: 0,
    dueToday: 0,
    blocked: 0,
    score: 0,
    level: 'light',
  },
];

vi.mock('@/hooks/useOverview', () => ({
  useOverview: () => ({ data: mockOverview }),
}));

vi.mock('@/hooks/useWorkload', () => ({
  useWorkload: () => ({ data: mockWorkload }),
}));

vi.mock('@/hooks/useTags', () => ({
  useTags: () => ({ data: [
    { id: 1, name: 'ANALYSIS', color: '#6366f1' },
    { id: 2, name: 'AMAR', color: '#ec4899' },
  ] }),
}));

vi.mock('@/hooks/useTagCounts', () => ({
  useTagCounts: () => ({ data: {
    counts: [{ tagId: 1, count: 5 }, { tagId: 2, count: 3 }],
    untaggedCount: 2,
  } }),
}));

describe('FilterSidebar', () => {
  const onFilterChange = vi.fn();
  const onClearFilter = vi.fn();
  const onDeveloperChange = vi.fn();
  const onClearDeveloper = vi.fn();
  const onTagToggle = vi.fn();
  const onNoTagsToggle = vi.fn();
  const onClearTagFilters = vi.fn();
  const onClose = vi.fn();
  const onCollapse = vi.fn();
  const onExpand = vi.fn();

  const defaultProps = {
    activeFilter: 'all' as const,
    onFilterChange,
    onClearFilter,
    onDeveloperChange,
    onClearDeveloper,
    selectedTagId: undefined as number | undefined,
    noTagsFilter: false,
    onTagToggle,
    onNoTagsToggle,
    onClearTagFilters,
    collapsed: false,
    isMobile: false,
    open: true,
    onClose,
    onCollapse,
    onExpand,
  };

  function InteractiveSidebar(props: Partial<typeof defaultProps>) {
    const [collapsed, setCollapsed] = useState(true);

    return (
      <FilterSidebar
        {...defaultProps}
        {...props}
        collapsed={collapsed}
        onCollapse={() => setCollapsed(true)}
        onExpand={() => setCollapsed(false)}
      />
    );
  }

  beforeEach(() => {
    onFilterChange.mockClear();
    onClearFilter.mockClear();
    onDeveloperChange.mockClear();
    onClearDeveloper.mockClear();
    onTagToggle.mockClear();
    onNoTagsToggle.mockClear();
    onClearTagFilters.mockClear();
    onClose.mockClear();
    onCollapse.mockClear();
    onExpand.mockClear();
  });

  it('renders filter buttons with counts', () => {
    render(
      <TestWrapper>
        <FilterSidebar {...defaultProps} />
      </TestWrapper>
    );

    expect(screen.getByText('All')).toBeInTheDocument();
    expect(screen.getByText('Unassigned')).toBeInTheDocument();
    expect(screen.getByText('Due This Week')).toBeInTheDocument();
    expect(screen.getByText('Overdue')).toBeInTheDocument();
    expect(screen.getByText('Blocked')).toBeInTheDocument();
  });

  it('activates filter on click', () => {
    render(
      <TestWrapper>
        <FilterSidebar {...defaultProps} />
      </TestWrapper>
    );

    fireEvent.click(screen.getByText('Unassigned'));
    expect(onFilterChange).toHaveBeenCalledWith('unassigned');
    expect(onDeveloperChange).not.toHaveBeenCalled();
  });

  it('renders developer buttons', () => {
    render(
      <TestWrapper>
        <FilterSidebar {...defaultProps} />
      </TestWrapper>
    );

    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
  });

  it('shows correct counts for dueThisWeek, stale, highPriority', () => {
    render(
      <TestWrapper>
        <FilterSidebar {...defaultProps} />
      </TestWrapper>
    );

    // These filters now show real counts instead of total
    // Use getAllByText since shortcut badges may also display the same number
    expect(screen.getAllByText('6').length).toBeGreaterThanOrEqual(1); // dueThisWeek
    expect(screen.getAllByText('4').length).toBeGreaterThanOrEqual(1); // stale
    expect(screen.getAllByText('7').length).toBeGreaterThanOrEqual(1); // highPriority
  });

  it('renders tag filter section with tags when expanded', () => {
    render(
      <TestWrapper>
        <FilterSidebar {...defaultProps} />
      </TestWrapper>
    );

    expect(screen.getAllByText('Tags').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('AMAR')).toBeInTheDocument();
    expect(screen.getByText('ANALYSIS')).toBeInTheDocument();
    expect(screen.getByText('No tags')).toBeInTheDocument();
  });

  it('sorts tags by defect count before name', () => {
    render(
      <TestWrapper>
        <FilterSidebar {...defaultProps} />
      </TestWrapper>
    );

    const analysisButton = screen.getByText('ANALYSIS').closest('button');
    const amarButton = screen.getByText('AMAR').closest('button');

    expect(analysisButton).not.toBeNull();
    expect(amarButton).not.toBeNull();
    expect(
      (analysisButton as HTMLElement).compareDocumentPosition(amarButton as HTMLElement) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it('calls onTagToggle when a tag is clicked', () => {
    render(
      <TestWrapper>
        <FilterSidebar {...defaultProps} />
      </TestWrapper>
    );

    fireEvent.click(screen.getByText('ANALYSIS'));
    expect(onTagToggle).toHaveBeenCalledWith(1);
  });

  it('calls onNoTagsToggle when No tags is clicked', () => {
    render(
      <TestWrapper>
        <FilterSidebar {...defaultProps} />
      </TestWrapper>
    );

    fireEvent.click(screen.getByText('No tags'));
    expect(onNoTagsToggle).toHaveBeenCalled();
  });

  it('renders a collapsed rail and expands from the rail controls', () => {
    render(
      <TestWrapper>
        <FilterSidebar {...defaultProps} collapsed />
      </TestWrapper>
    );

    expect(screen.queryByText('Refine the queue')).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Expand tags'));
    expect(onExpand).toHaveBeenCalled();
  });

  it('labels the collapsed rail icons in text (UX-20)', () => {
    render(
      <TestWrapper>
        <FilterSidebar {...defaultProps} collapsed />
      </TestWrapper>
    );
    for (const label of ['Filters', 'Tags', 'People']) expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.getByTitle('Active filters')).toBeInTheDocument();
  });

  it('expands only the tags section when the tags rail button is clicked', () => {
    render(
      <TestWrapper>
        <InteractiveSidebar />
      </TestWrapper>
    );

    fireEvent.click(screen.getByLabelText('Expand tags'));

    expect(screen.queryByText('All')).not.toBeInTheDocument();
    expect(screen.getByText('ANALYSIS')).toBeInTheDocument();
    expect(screen.queryByText('Alice')).not.toBeInTheDocument();
  });

  it('expands only the developers section when the developers rail button is clicked', () => {
    render(
      <TestWrapper>
        <InteractiveSidebar />
      </TestWrapper>
    );

    fireEvent.click(screen.getByLabelText('Expand developers'));

    expect(screen.queryByText('All')).not.toBeInTheDocument();
    expect(screen.queryByText('ANALYSIS')).not.toBeInTheDocument();
    expect(screen.getByText('Alice')).toBeInTheDocument();
  });

  it('keeps the all filter active while a developer filter is also active', () => {
    render(
      <TestWrapper>
        <FilterSidebar {...defaultProps} activeDeveloper="alice-1" />
      </TestWrapper>
    );

    expect(screen.getByRole('button', { name: /All/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /Alice/ })).toHaveAttribute('aria-pressed', 'true');
  });

  it('shows a clear button for an active filter selection', () => {
    render(
      <TestWrapper>
        <FilterSidebar {...defaultProps} activeFilter="blocked" />
      </TestWrapper>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Clear filter selection' }));
    expect(onClearFilter).toHaveBeenCalledTimes(1);
  });

  it('shows a clear button for an active developer selection', () => {
    render(
      <TestWrapper>
        <FilterSidebar {...defaultProps} activeDeveloper="alice-1" />
      </TestWrapper>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Clear developer selection' }));
    expect(onClearDeveloper).toHaveBeenCalledTimes(1);
  });
});
