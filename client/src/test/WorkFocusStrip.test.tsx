import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { WorkFocusStrip } from '@/components/work/WorkFocusStrip';
import type { OverviewCounts } from '@/types';

vi.mock('@/hooks/useOverview', () => ({
  useOverview: () => ({
    isLoading: false,
    data: { total: 12, recentlyAssigned: 2, dueToday: 3, overdue: 1, inProgress: 4 } as OverviewCounts,
  }),
}));

function renderStrip(props: Partial<React.ComponentProps<typeof WorkFocusStrip>> = {}) {
  const handlers = { onFilterChange: vi.fn() };
  render(<WorkFocusStrip activeFilter="all" {...handlers} {...props} />);
  return handlers;
}

/** docs/56 UX-31 (decision 3): Work shows its five defect tiles; Today owns attention and follow-ups. */
describe('WorkFocusStrip', () => {
  it('shows the five defect tiles and no non-defect tiles', () => {
    renderStrip();
    const tiles = screen.getAllByRole('button');
    expect(tiles.map((tile) => tile.textContent?.replace(/\d+$/, ''))).toEqual([
      'All defectsactive',
      'New to team24h',
      'Due todaydefects',
      'Overduelate',
      'In progressmoving',
    ]);
    expect(screen.getByRole('button', { name: /All defects/ })).toHaveTextContent('12');
    for (const name of [/Attention/, /Follow-ups/, /Stale/, /Sync/]) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
    }
  });

  it('tiles wrap and never truncate their labels', () => {
    renderStrip();
    const tile = screen.getByRole('button', { name: /New to team/ });
    expect(tile.parentElement).toHaveClass('flex-wrap');
    expect(tile.innerHTML).not.toContain('truncate');
  });

  it('a tile filters the defect list', () => {
    const { onFilterChange } = renderStrip();
    fireEvent.click(screen.getByRole('button', { name: /Overdue/ }));
    expect(onFilterChange).toHaveBeenCalledWith('overdue');
  });
});
