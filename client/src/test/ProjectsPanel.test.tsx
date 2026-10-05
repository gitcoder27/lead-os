import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectsPanel } from '@/components/tasks/ProjectsPanel';
import { TaskListEmpty } from '@/components/tasks/TaskListStates';
import type { ProjectDetail, ProjectFacts } from '@/types';

const hooks = vi.hoisted(() => ({ list: vi.fn(), detail: vi.fn(), write: vi.fn(), retry: vi.fn() }));
vi.mock('@/hooks/useProjects', () => ({ useProjects: hooks.list, useProject: hooks.detail, useProjectWrites: () => ({ mutate: hooks.write, isPending: false }) }));
const facts: ProjectFacts = { open: 3, blocked: 1, overdue: 2, followUpDue: 0, nextCheck: { taskKey: 'T-9', title: 'Review rollout', at: '2026-10-07T09:00:00Z' } };
const project = { id: 1, name: 'Platform migration', outcome: 'Ship a tested rollback', summary: 'Rehearsal ready', summaryUpdatedAt: '2026-10-05T09:00:00Z', archivedAt: null, createdAt: '', updatedAt: '' };
const detail: ProjectDetail = { project, facts, tracks: [{ ...project, id: 2, projectId: 1, name: 'Rollout', facts }, { ...project, id: 3, projectId: 1, name: 'Old track', archivedAt: '2026-10-01', facts: { ...facts, open: 0 } }] };
const props = { today: '2026-10-05', archived: false, query: '', onQuery: vi.fn(), onNavigate: vi.fn(), onArchiveFilter: vi.fn(), openTask: vi.fn() };
beforeEach(() => {
  vi.clearAllMocks();
  hooks.list.mockReturnValue({ data: { projects: [{ ...project, facts }, { ...project, id: 4, name: 'Hiring', outcome: 'Build the team', facts: { ...facts, blocked: 0, overdue: 0, nextCheck: null } }] }, refetch: hooks.retry });
  hooks.detail.mockReturnValue({ data: detail, refetch: hooks.retry });
});
afterEach(cleanup);

describe('Projects browsing and lifecycle', () => {
  it('searches names and outcomes and separates directory controls from task controls', () => {
    const { rerender } = render(<ProjectsPanel {...props} />);
    expect(screen.getAllByRole('heading', { name: 'Projects' })).toHaveLength(1);
    expect(screen.queryByText('0 blocked')).not.toBeInTheDocument();
    expect(screen.queryByText('No check scheduled')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'View options' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: 'Search projects' }), { target: { value: 'rollback' } });
    expect(props.onQuery).toHaveBeenCalledWith('rollback');
    rerender(<ProjectsPanel {...props} query="ROLLBACK" />);
    expect(screen.queryByRole('button', { name: 'Hiring' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Platform migration' }));
    expect(props.onNavigate).toHaveBeenCalledWith(1);
    fireEvent.click(screen.getByRole('button', { name: /Next check/ }));
    expect(props.openTask).toHaveBeenCalledWith('T-9');
    fireEvent.click(screen.getByRole('button', { name: 'Archived', exact: true }));
    expect(props.onArchiveFilter).toHaveBeenCalledWith(true);
  });

  it('offers recovery for no matches, loading and failed requests', () => {
    const { rerender } = render(<ProjectsPanel {...props} query="missing" />);
    expect(screen.getByText('No matching projects')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(props.onQuery).toHaveBeenCalledWith('');
    hooks.list.mockReturnValue({ isLoading: true });
    rerender(<ProjectsPanel {...props} />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading projects');
    expect(screen.queryByText('No projects yet')).not.toBeInTheDocument();
    hooks.list.mockReturnValue({ error: new Error('Connection failed'), refetch: hooks.retry });
    rerender(<ProjectsPanel {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(hooks.retry).toHaveBeenCalledOnce();
  });

  it('creates a project and navigates directly to it', () => {
    render(<ProjectsPanel {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'New project' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('button', { name: 'Create project' })).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: '  Mobile launch  ' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create project' }));
    expect(within(dialog).getByRole('textbox', { name: 'Outcome (optional)', exact: true })).toHaveAccessibleDescription('Describe the result you’re working toward.');
    expect(hooks.write.mock.calls[0]?.[0].changes.name).toBe('Mobile launch');
    act(() => hooks.write.mock.calls[0]?.[1].onSuccess({ ...project, id: 8 }));
    expect(props.onNavigate).toHaveBeenCalledWith(8, undefined);
  });


  it('edits private summaries without navigating away or changing placement', () => {
    render(<ProjectsPanel {...props} projectId={1} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit details' }));
    const dialog = screen.getByRole('dialog');
    const summary = within(dialog).getByRole('textbox', { name: 'Summary', exact: true });
    expect(summary).toHaveAccessibleDescription('A private snapshot of progress. LeadOS records when you update it.');
    fireEvent.change(summary, { target: { value: 'Ready for rollout' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    expect(hooks.write.mock.calls[0]?.[0]).toMatchObject({ id: 1, changes: { name: project.name, outcome: project.outcome, summary: 'Ready for rollout' } });
    act(() => hooks.write.mock.calls[0]?.[1].onSuccess(project));
    expect(props.onNavigate).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('makes tracks optional, filters archived tracks, and creates in project context', () => {
    const { rerender } = render(<ProjectsPanel {...props} projectId={1} />);
    expect(screen.getByRole('heading', { name: project.name })).toBeInTheDocument();
    expect(screen.getByText('Optional')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Old track' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Rollout' }));
    expect(props.onNavigate).toHaveBeenCalledWith(1, 2);
    fireEvent.click(screen.getByLabelText('Show archived tracks'));
    expect(props.onArchiveFilter).toHaveBeenCalledWith(true);
    rerender(<ProjectsPanel {...props} projectId={1} archived />);
    expect(screen.getByRole('button', { name: 'Old track' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'New track' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Validation' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create track' }));
    expect(hooks.write.mock.calls[0]?.[0]).toMatchObject({ projectId: 1, track: true });
    act(() => hooks.write.mock.calls[0]?.[1].onSuccess({ ...project, id: 7, projectId: 1 }));
    expect(props.onNavigate).toHaveBeenCalledWith(1, 7);
  });

  it('keeps track breadcrumbs and rejects unavailable tracks', () => {
    const { rerender } = render(<ProjectsPanel {...props} projectId={1} trackId={2} />);
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Project breadcrumbs' })).getByRole('button', { name: project.name }));
    expect(props.onNavigate).toHaveBeenCalledWith(1);
    expect(screen.queryByRole('button', { name: 'New track' })).not.toBeInTheDocument();
    rerender(<ProjectsPanel {...props} projectId={1} trackId={99} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Project or track unavailable');
    expect(screen.queryByRole('heading', { name: project.name })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Back to projects' }));
    expect(props.onNavigate).toHaveBeenLastCalledWith();
  });

  it('previews archive impact and preserves restore for archived projects', () => {
    const { rerender } = render(<ProjectsPanel {...props} projectId={1} />);
    fireEvent.click(screen.getByRole('button', { name: 'Archive', exact: true }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('3 open tasks remain actionable');
    hooks.detail.mockReturnValue({ data: { ...detail, facts: { ...facts, open: 4 } } });
    rerender(<ProjectsPanel {...props} projectId={1} />);
    expect(dialog).toHaveTextContent('4 open tasks remain actionable');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Archive project' }));
    expect(hooks.write.mock.calls[0]?.[0]).toMatchObject({ id: 1, changes: { archived: true } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    hooks.detail.mockReturnValue({ data: { ...detail, project: { ...project, archivedAt: '2026-10-05' } } });
    rerender(<ProjectsPanel {...props} projectId={1} />);
    expect(screen.queryByRole('button', { name: 'New track' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Restore' })).toBeInTheDocument();
  });

  it('explains archived empty task lists without recommending capture', () => {
    render(<TaskListEmpty viewId="projects" archived filtered={false} candidates={0} onPlanDay={vi.fn()} onClearFilters={vi.fn()} />);
    expect(screen.getByText('Restore this project or track to add new tasks.')).toBeInTheDocument();
    expect(screen.queryByText(/capture one/)).not.toBeInTheDocument();
  });
});
