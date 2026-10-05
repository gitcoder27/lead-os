import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlacementPicker } from '@/components/tasks/PlacementPicker';
import { PlacementDialog } from '@/components/tasks/PlacementDialog';
import type { PlacementPreview } from '@/types';

const mocks = vi.hoisted(() => ({ preview: vi.fn(), write: vi.fn(), toast: vi.fn(), list: vi.fn(), detail: vi.fn() }));
let scope = 'ws:manager';
vi.mock('@/context/AuthContext', () => ({ useAuthScopeKey: () => scope }));
vi.mock('@/context/ToastContext', () => ({ useToast: () => ({ addToast: mocks.toast }) }));
vi.mock('@/hooks/useLocalDate', () => ({ useLocalDate: () => '2026-10-05' }));
vi.mock('@/hooks/useProjects', () => ({ useProjects: mocks.list, useProject: mocks.detail, previewPlacement: mocks.preview, usePlacementWrites: () => ({ mutateAsync: mocks.write, isPending: false }) }));
const project = { id: 1, name: 'Platform migration', outcome: 'Ship a tested rollback', archivedAt: null };
const track = { id: 2, projectId: 1, name: 'Rollout', archivedAt: null };
const preview: PlacementPreview = { keys: ['T-1'], includeSubtasks: false, tasks: [{ taskKey: 'T-1', title: 'Validate rollback', placement: null }] };
const childPreview: PlacementPreview = { ...preview, includeSubtasks: true, tasks: [...preview.tasks, { taskKey: 'T-2', title: 'Document recovery', placement: null }] };
beforeEach(() => {
  vi.clearAllMocks(); scope = 'ws:manager';
  mocks.list.mockReturnValue({ data: { projects: [project, { ...project, id: 3, name: 'Hiring' }] } });
  mocks.detail.mockImplementation((id: number | undefined) => ({ data: id ? { project: { ...project, id }, tracks: [track, { ...track, id: 4, name: 'Old track', archivedAt: '2026-10-01' }] } : undefined }));
  mocks.preview.mockImplementation((input: { includeSubtasks: boolean }) => Promise.resolve(input.includeSubtasks ? childPreview : preview));
  mocks.write.mockResolvedValue({ count: 2, undo: { restore: [{ taskKey: 'T-1', placement: null }] } });
});
afterEach(cleanup);

describe('searchable project choice', () => {
  it('chooses a project directly, resets its track, and preserves the selection while searching', () => {
    const onChange = vi.fn();
    const { rerender } = render(<PlacementPicker today="2026-10-05" value={null} onChange={onChange} />);
    fireEvent.click(screen.getByRole('radio', { name: /Platform migration/ }));
    expect(onChange).toHaveBeenCalledWith({ projectId: 1, trackId: null });
    rerender(<PlacementPicker today="2026-10-05" value={{ projectId: 1, trackId: 2 }} onChange={onChange} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Search projects' }), { target: { value: 'Hiring' } });
    expect(screen.queryByRole('radio', { name: /Platform migration/ })).not.toBeInTheDocument();
    expect(screen.getByText('Selected:', { exact: false })).toHaveTextContent('Platform migration');
    expect(screen.getByRole('combobox', { name: 'Track (optional)' })).toHaveValue('2');
    fireEvent.click(screen.getByRole('radio', { name: /Hiring/ }));
    expect(onChange).toHaveBeenLastCalledWith({ projectId: 3, trackId: null });
    fireEvent.click(screen.getByRole('radio', { name: /No project/ }));
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it('keeps tracks optional and excludes archived tracks from new destinations', () => {
    const onChange = vi.fn();
    render(<PlacementPicker today="2026-10-05" value={{ projectId: 1, trackId: null }} onChange={onChange} />);
    expect(screen.queryByRole('option', { name: 'Old track' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox', { name: 'Track (optional)' }), { target: { value: '2' } });
    expect(onChange).toHaveBeenCalledWith({ projectId: 1, trackId: 2 });
    fireEvent.change(screen.getByRole('combobox', { name: 'Track (optional)' }), { target: { value: '' } });
    expect(onChange).toHaveBeenLastCalledWith({ projectId: 1, trackId: null });
  });

  it('explains archived selections and prevents choosing tracks in an archived project', () => {
    mocks.detail.mockReturnValue({ data: { project: { ...project, archivedAt: '2026-10-01' }, tracks: [] } });
    render(<PlacementPicker today="2026-10-05" value={{ projectId: 1, trackId: null }} onChange={vi.fn()} />);
    expect(screen.getByRole('combobox', { name: 'Track (optional)' })).toBeDisabled();
    expect(screen.getByText(/Choose an active project/)).toBeInTheDocument();
  });

  it('provides useful no-match and request-failure states', () => {
    const retry = vi.fn();
    const { rerender } = render(<PlacementPicker today="2026-10-05" value={null} onChange={vi.fn()} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Search projects' }), { target: { value: 'Missing' } });
    expect(screen.getByRole('status')).toHaveTextContent('No matching projects');
    mocks.list.mockReturnValue({ error: new Error('Failed'), refetch: retry });
    rerender(<PlacementPicker today="2026-10-05" value={null} onChange={vi.fn()} />);
    fireEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalledOnce();
  });
});

describe('guarded task moves', () => {
  it('shows the destination and exact subtask count, applies the preview, and offers Undo', async () => {
    const close = vi.fn();
    render(<PlacementDialog keys={['T-1']} onClose={close} />);
    fireEvent.click(screen.getByRole('radio', { name: /Platform migration/ }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Track (optional)' }), { target: { value: '2' } });
    fireEvent.click(screen.getByLabelText('Include subtasks'));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Move 2 tasks' })).toBeEnabled());
    const movePreview = screen.getByRole('region', { name: 'Move preview' });
    expect(movePreview).toHaveTextContent('Destination: Platform migration / Rollout');
    expect(movePreview).toHaveTextContent('Document recovery');
    fireEvent.click(screen.getByRole('button', { name: 'Move 2 tasks' }));
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
    expect(mocks.write).toHaveBeenCalledWith({ preview: childPreview, placement: { projectId: 1, trackId: 2 } });
    const toast = mocks.toast.mock.calls[0]?.[0];
    expect(toast.action.label).toBe('Undo');
    act(() => toast.action.onClick());
    await waitFor(() => expect(mocks.write).toHaveBeenCalledWith({ restore: [{ taskKey: 'T-1', placement: null }] }));
  });

  it('disables apply until the new subtask preview arrives and ignores an older response', async () => {
    let resolveFirst!: (value: PlacementPreview) => void;
    let resolveSecond!: (value: PlacementPreview) => void;
    mocks.preview.mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; })).mockImplementationOnce(() => new Promise((resolve) => { resolveSecond = resolve; }));
    render(<PlacementDialog keys={['T-1']} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('radio', { name: /Platform migration/ }));
    fireEvent.click(screen.getByLabelText('Include subtasks'));
    expect(screen.getByRole('button', { name: 'Move 0 tasks' })).toBeDisabled();
    await act(async () => resolveSecond(childPreview));
    expect(screen.getByRole('button', { name: 'Move 2 tasks' })).toBeEnabled();
    await act(async () => resolveFirst(preview));
    expect(screen.getByRole('button', { name: 'Move 2 tasks' })).toBeEnabled();
  });

  it('removes organization explicitly, keeps zero-task moves disabled, and surfaces failures', async () => {
    mocks.preview.mockResolvedValue({ ...preview, tasks: [] });
    const { unmount } = render(<PlacementDialog keys={['T-1']} onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('0 tasks'));
    expect(screen.getByRole('button', { name: 'Remove from project' })).toBeDisabled();
    unmount();
    mocks.preview.mockResolvedValue(preview);
    mocks.write.mockRejectedValue(new Error('Task changed; review and try again'));
    const close = vi.fn();
    render(<PlacementDialog keys={['T-1']} initial={{ projectId: 1, trackId: 2 }} onClose={close} />);
    fireEvent.click(screen.getByRole('radio', { name: /No project/ }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Remove from project' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Remove from project' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Task changed'));
    expect(mocks.write).toHaveBeenCalledWith({ preview, placement: null });
    expect(close).not.toHaveBeenCalled();
    mocks.preview.mockResolvedValue({ ...preview, tasks: [{ ...preview.tasks[0]!, title: 'Updated rollback task' }] });
    fireEvent.click(screen.getByRole('button', { name: 'Review affected tasks' }));
    await waitFor(() => expect(screen.getByRole('region', { name: 'Move preview' })).toHaveTextContent('Updated rollback task'));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('does not run Undo under a different authentication scope', async () => {
    const { rerender } = render(<PlacementDialog keys={['T-1']} onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Remove from project' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Remove from project' }));
    await waitFor(() => expect(mocks.toast).toHaveBeenCalled());
    scope = 'ws:other-manager';
    rerender(<PlacementDialog keys={['T-1']} onClose={vi.fn()} />);
    act(() => mocks.toast.mock.calls[0]?.[0].action.onClick());
    expect(mocks.write).toHaveBeenCalledOnce();
  });
});
