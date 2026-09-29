import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkFocusStrip } from '@/components/work/WorkFocusStrip';
import type { OverviewCounts, TodaySummaryMetric } from '@/types';

const todayMock = vi.hoisted(() => ({ summary: [] as TodaySummaryMetric[], isFetching: false }));

vi.mock('@/hooks/useOverview', () => ({
  useOverview: () => ({
    isLoading: false,
    data: { total: 12, recentlyAssigned: 2, dueToday: 3, overdue: 1, inProgress: 4 } as OverviewCounts,
  }),
}));
vi.mock('@/hooks/useToday', () => ({
  useToday: () => ({ data: { summary: todayMock.summary }, isFetching: todayMock.isFetching }),
}));

const followUpTarget = { type: 'follow_up', view: 'follow-ups' } as const;

function metric(id: string, label: string, value: number, extra: Partial<TodaySummaryMetric> = {}): TodaySummaryMetric {
  return { id, label, value, detail: `${label} detail`, severity: value > 0 ? 'warning' : 'neutral', ...extra };
}

/** What `/api/today` sends for a solo workspace: no stale metric. */
const soloSummary = [
  metric('attention', 'Attention', 7),
  metric('work', 'Active defects', 12, { target: { type: 'view', view: 'work' } }),
  metric('team', 'People', 2, { target: { type: 'view', view: 'team' } }),
  metric('due-work', 'Due today', 3),
  metric('promises', 'Follow-ups', 2, { target: followUpTarget }),
];

function renderStrip(props: Partial<React.ComponentProps<typeof WorkFocusStrip>> = {}) {
  const handlers = { onFilterChange: vi.fn(), onOpenTarget: vi.fn(), onViewChange: vi.fn() };
  render(<WorkFocusStrip activeFilter="all" {...handlers} {...props} />);
  return handlers;
}

describe('WorkFocusStrip reads Today\'s server signals (docs/56 P1-06)', () => {
  beforeEach(() => {
    todayMock.summary = soloSummary;
    todayMock.isFetching = false;
  });

  it('keeps the defect tiles and shows Today\'s attention and follow-up metrics', () => {
    renderStrip();
    expect(screen.getByRole('button', { name: /All defects/ })).toHaveTextContent('12');
    expect(screen.getByRole('button', { name: /Overdue/ })).toHaveTextContent('1');
    expect(screen.getByRole('button', { name: /Attention/ })).toHaveTextContent('7');
    expect(screen.getByRole('button', { name: /Follow-ups/ })).toHaveTextContent('2');
  });

  it('drops the second attention model\'s tiles and Today\'s inventory metrics', () => {
    renderStrip();
    for (const name of [/Manual work/, /Due soon/, /^Blocked/, /Active defects/, /People/]) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
    }
    // "Due today" comes from the defect tiles only, so it is not shown twice.
    expect(screen.getAllByRole('button', { name: /Due today/ })).toHaveLength(1);
  });

  it('shows no stale tile when Today does not send one (solo)', () => {
    renderStrip();
    expect(screen.queryByRole('button', { name: /Stale/ })).not.toBeInTheDocument();
  });

  it('shows stale and sync tiles when Today includes them', () => {
    todayMock.summary = [
      ...soloSummary,
      metric('stale', 'Stale check-ins', 1, { target: { type: 'view', view: 'team' } }),
      metric('sync', 'Sync', 1, { severity: 'critical', target: { type: 'view', view: 'settings' } }),
    ];
    renderStrip();
    expect(screen.getByRole('button', { name: /Stale check-ins/ })).toHaveTextContent('1');
    expect(screen.getByRole('button', { name: /Sync/ })).toHaveTextContent('1');
  });

  it('opens the metric\'s own target, and Today for the untargeted attention total', () => {
    const { onOpenTarget, onViewChange, onFilterChange } = renderStrip();
    fireEvent.click(screen.getByRole('button', { name: /Follow-ups/ }));
    expect(onOpenTarget).toHaveBeenCalledWith(followUpTarget);

    fireEvent.click(screen.getByRole('button', { name: /Attention/ }));
    expect(onViewChange).toHaveBeenCalledWith('today');

    fireEvent.click(screen.getByRole('button', { name: /Overdue/ }));
    expect(onFilterChange).toHaveBeenCalledWith('overdue');
  });

  it('renders only the defect tiles until Today has loaded', () => {
    todayMock.summary = [];
    renderStrip();
    expect(screen.getByRole('button', { name: /All defects/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Attention/ })).not.toBeInTheDocument();
  });
});
