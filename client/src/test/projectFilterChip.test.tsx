import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectFilterChip } from '@/components/tasks/ProjectFilters';
import { TaskPlacementLabel } from '@/components/tasks/TaskPlacementLabel';
import type { TaskViewDefinition } from '@/types';

let projects: { id: number; name: string }[] = [];
const tracks = [{ id: 11, name: 'Migration' }, { id: 12, name: 'Testing' }];
vi.mock('@/hooks/useProjects', () => ({
  useProjects: () => ({ data: { projects } }),
  useProject: (id?: number) => ({ data: id ? { project: { id, name: projects.find((p) => p.id === id)?.name ?? 'Gone' }, tracks } : undefined }),
}));

const definition = (filters: TaskViewDefinition['filters'] = {}) => ({ filters } as TaskViewDefinition);

describe('ProjectFilterChip (docs/73 UXD-12)', () => {
  beforeEach(() => { projects = [{ id: 1, name: 'Atlas payments migration' }, { id: 2, name: 'Q4 hiring' }]; });

  it('reads "Project: All" and writes the same project/track overrides the band did', () => {
    const onChange = vi.fn();
    render(<ProjectFilterChip today="2026-10-10" definition={definition()} onChange={onChange} />);
    const chip = screen.getByRole('button', { name: 'Project filter: All' });
    fireEvent.click(chip);
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Q4 hiring' }));
    expect(onChange).toHaveBeenCalledWith({ project: 2, track: 'all' });
    fireEvent.click(chip);
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'No project' }));
    expect(onChange).toHaveBeenLastCalledWith({ project: 'none', track: 'all' });
  });

  it('offers tracks once a project is chosen and names both in the chip', () => {
    const onChange = vi.fn();
    render(<ProjectFilterChip today="2026-10-10" definition={definition({ project: 1, track: 11 })} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Project filter: Atlas payments migration / Migration' }));
    expect(screen.getByRole('menuitemradio', { name: 'Migration' })).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'No track' }));
    expect(onChange).toHaveBeenCalledWith({ track: 'none' });
  });

  it('stays out of the way in a workspace without projects, unless a project filter is applied', () => {
    projects = [];
    const { rerender } = render(<ProjectFilterChip today="2026-10-10" definition={definition()} onChange={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /Project filter/ })).toBeNull();
    rerender(<ProjectFilterChip today="2026-10-10" definition={definition({ project: 'none' })} onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Project filter: No project' })).toBeInTheDocument();
  });
});

describe('TaskPlacementLabel scope (docs/73 UXD-12)', () => {
  const placement = { projectId: 1, projectName: 'Atlas payments migration', trackId: 11, trackName: 'Migration' } as never;
  it('drops what a project- or track-scoped list already says', () => {
    const { rerender, container } = render(<TaskPlacementLabel placement={placement} />);
    expect(container.textContent).toBe('Atlas payments migration / Migration');
    rerender(<TaskPlacementLabel placement={placement} scope="project" />);
    expect(container.textContent).toBe('Migration');
    rerender(<TaskPlacementLabel placement={placement} scope="track" />);
    expect(container.textContent).toBe('');
  });
});
