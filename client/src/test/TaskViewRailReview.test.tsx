import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { TaskViewRail } from '@/components/tasks/TaskViewRail';
import type { TaskViewMeta } from '@/types';

/** docs/59 §5.1: the Tasks rail's door to the weekly review. */
const views: TaskViewMeta[] = [
  { id: 'today', name: 'Planned today', builtin: true, section: 'plan', definition: {} },
  { id: 'attention', name: 'Needs attention', builtin: true, section: 'review', definition: {} },
  { id: 'closed-week', name: 'Closed · last 7 days', builtin: true, section: 'review', definition: {} },
];

describe('TaskViewRail weekly review link', () => {
  it('sits under the Review section, after Closed · last 7 days, and opens the review', () => {
    const popstate = vi.fn();
    window.addEventListener('popstate', popstate);
    render(
      <TaskViewRail views={views} counts={undefined} selectedId="today" onSelect={vi.fn()} onRename={vi.fn()} onDelete={vi.fn()} onSaveView={vi.fn()} saving={false} canSave />,
    );
    const nav = screen.getByRole('navigation', { name: 'Task views' });
    const buttons = [...nav.querySelectorAll('button')].map((button) => button.textContent);
    expect(buttons.slice(buttons.indexOf('Closed · last 7 days'))[1]).toBe('Weekly review');

    fireEvent.click(screen.getByRole('button', { name: 'Weekly review' }));
    expect(window.location.pathname + window.location.search).toBe('/?mode=review');
    expect(popstate).toHaveBeenCalled();
    window.removeEventListener('popstate', popstate);
  });

  it('is absent when the rail has no Review section', () => {
    render(
      <TaskViewRail views={views.slice(0, 1)} counts={undefined} selectedId="today" onSelect={vi.fn()} onRename={vi.fn()} onDelete={vi.fn()} onSaveView={vi.fn()} saving={false} canSave />,
    );
    expect(screen.queryByRole('button', { name: 'Weekly review' })).not.toBeInTheDocument();
  });
});
