import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TaskViewRail } from '@/components/tasks/TaskViewRail';
import { buildNavigationCommands } from '@/components/palette/paletteItems';
import type { TaskViewMeta } from '@/types';
const views: TaskViewMeta[] = [
  { id: 'today', name: 'Planned today', builtin: true, section: 'plan', definition: {} },
  { id: 'attention', name: 'Needs attention', builtin: true, section: 'review', definition: {} },
  { id: 'closed-week', name: 'Closed · last 7 days', builtin: true, section: 'review', definition: {} },
];
it('retains every task view while removing review and save doorways from the rail', () => {
  render(<TaskViewRail views={views} counts={undefined} selectedId="today" onSelect={vi.fn()} onRename={vi.fn()} onDelete={vi.fn()} />);
  expect(screen.queryByRole('button', { name: 'Weekly review' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Save current view' })).not.toBeInTheDocument();
  for (const view of views) expect(screen.getByRole('button', { name: view.name })).toBeInTheDocument();
});
describe('review palette doorway remains', () => {
  it('retains the task-feature gate and still opens review on Today', () => {
    const commands = buildNavigationCommands({ tasksPhase3: true });
    const review = commands.find((command) => command.title === 'Weekly review');
    expect(review).toMatchObject({ href: '/?mode=review' });
    expect(buildNavigationCommands({ tasksPhase3: false }).find((command) => command.title === 'Weekly review')).toBeUndefined();
  });
});
