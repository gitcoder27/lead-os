import { render, screen, fireEvent, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ManagerTask } from '@/types';
import { PersonCommitments } from '@/components/team-tracker/PersonCommitments';
const refetch = vi.fn();
let query: { data?: { tasks: ManagerTask[] }; isError: boolean; isLoading: boolean; isFetching: boolean; refetch: typeof refetch };
vi.mock('@/hooks/usePersonCommitments', () => ({ usePersonCommitments: () => query }));
vi.mock('@/components/tasks/TaskDrawer', () => ({ TaskDrawer: ({ taskKey, onClose }: { taskKey: string | null; onClose: () => void }) => taskKey && <div role="dialog" aria-label={`Task ${taskKey}`}><button onClick={onClose}>Close task</button></div> }));
function task(taskKey: string, overrides: Partial<ManagerTask> = {}): ManagerTask {
  return { taskKey, title: taskKey, status: 'open', updatedAt: new Date().toISOString(), scheduledOn: null, later: false, ownerType: 'manager', ownerId: 'me', ...overrides } as ManagerTask;
}
beforeEach(() => { refetch.mockClear(); query = { data: { tasks: [] }, isError: false, isLoading: false, isFetching: false, refetch }; });
describe('person commitments', () => {
  it('separates owed and waiting, renders all-date next actions, opens exact task and returns to person context', () => {
    query.data = { tasks: [task('T-1', { title: 'Future decision', scheduledOn: '2027-01-01', followUpAt: new Date('2027-01-02T10:00:00').toISOString(), nextAction: 'Prepare options' }), task('T-2', { ownerType: 'developer', ownerId: 'dev' }), task('T-3', { waitingOn: { type: 'developer', ref: 'dev', label: 'Person', since: new Date().toISOString() } }), task('T-4', { later: true })] };
    render(<PersonCommitments accountId="dev" onCapture={vi.fn()} />);
    const owed = screen.getByRole('region', { name: 'I owe them' });
    const waiting = screen.getByRole('region', { name: 'Waiting on them' });
    expect(within(owed).getByText('Next: Prepare options')).toBeInTheDocument();
    // UX-17: one date style — no ISO or locale strings.
    expect(within(owed).getByText(/Fri 1 Jan 2027 · Next check Sat 2 Jan 2027, 10:00/)).toBeInTheDocument();
    expect(within(owed).queryByText(/2027-01-01|1\/2\/2027/)).toBeNull();
    expect(within(owed).getByText(/Later/)).toBeInTheDocument();
    expect(within(waiting).getAllByRole('button')).toHaveLength(2);
    fireEvent.click(within(owed).getByRole('button', { name: /Future decision/ }));
    expect(screen.getByRole('dialog', { name: 'Task T-1' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close task' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(owed).toBeInTheDocument();
  });
  it('failed reads offer Retry and cached commitments survive refresh errors', () => {
    query.isError = true;
    const { rerender } = render(<PersonCommitments accountId="dev" onCapture={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' })); expect(refetch).toHaveBeenCalledOnce();
    query.data = { tasks: [task('T-5', { title: 'Retained' })] };
    rerender(<PersonCommitments accountId="dev" onCapture={vi.fn()} />);
    expect(screen.getByText(/Retained/)).toBeInTheDocument();
  });
  it('does not chase the manager linked to their own roster record', () => {
    query.data = { tasks: [task('T-2', { ownerType: 'developer', ownerId: 'dev' })] };
    render(<PersonCommitments accountId="dev" onCapture={vi.fn()} isSelf />);
    expect(screen.getByRole('region', { name: 'My open commitments' })).toBeInTheDocument();
    expect(screen.queryByText(/Waiting on them/)).not.toBeInTheDocument();
  });
});
