import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { WorkBulkTriage } from '@/components/work/WorkBulkTriage';
import type { Issue } from '@/types';
const mutate = vi.fn();
vi.mock('@/hooks/useJiraExecution', () => ({
  useJiraExecution: () => ({ bulk: { mutateAsync: mutate, isPending: false } }),
}));
vi.mock('@/hooks/useDevelopers', () => ({ useDevelopers: () => ({ data: [] }) }));
const issues = [1, 2].map(
  (n) => ({ jiraKey: `AB2-${n}`, summary: `Synthetic ${n}`, statusName: 'Open', statusCategory: 'new' }) as Issue,
);
beforeEach(() => vi.resetAllMocks());
describe('bounded Work bulk triage', () => {
  it('retains the reviewed targets after a query refresh and retries only failed issues', async () => {
    mutate
      .mockResolvedValueOnce({
        results: [
          { key: 'AB2-1', ok: true },
          { key: 'AB2-2', ok: false, error: 'Jira denied' },
        ],
      })
      .mockResolvedValueOnce({ results: [{ key: 'AB2-2', ok: true }] });
    const applied = vi.fn();
    const props = { issues, onClose: vi.fn(), onApplied: applied, onOpen: vi.fn() };
    const { rerender } = render(<WorkBulkTriage {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Apply to 2 defects' }));
    await screen.findByText('Jira denied');
    rerender(<WorkBulkTriage {...props} issues={[]} />);
    expect(screen.getByText('Synthetic 1')).toBeInTheDocument();
    expect(applied).toHaveBeenCalledWith(['AB2-1']);
    fireEvent.click(screen.getByRole('button', { name: 'Retry 1 failed' }));
    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(2));
    expect(mutate.mock.calls[1]?.[0]).toEqual([
      { key: 'AB2-2', operation: { kind: 'update', update: { flagged: true } } },
    ]);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Retry 1 failed' })).not.toBeInTheDocument());
  });
  it('requires review after an unknown whole-request outcome and can clear assignees', async () => {
    mutate.mockRejectedValueOnce(new Error('Connection lost'));
    render(<WorkBulkTriage issues={issues} onClose={vi.fn()} onApplied={vi.fn()} onOpen={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Action'), { target: { value: 'unassign' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply to 2 defects' }));
    await screen.findByText('Connection lost');
    expect(screen.queryByRole('button', { name: /Retry/ })).not.toBeInTheDocument();
    expect(mutate.mock.calls[0]?.[0][0].operation).toEqual({ kind: 'update', update: { assigneeId: null } });
    fireEvent.click(screen.getByRole('button', { name: 'Review targets again' }));
    expect(screen.getByLabelText('Action')).toBeInTheDocument();
  });
  it('refuses more than twenty targets', () => {
    render(
      <WorkBulkTriage
        issues={Array.from({ length: 21 }, (_, n) => ({ ...issues[0], jiraKey: `AB2-${n}` }) as Issue)}
        onClose={vi.fn()}
        onApplied={vi.fn()}
        onOpen={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: 'Apply to 21 defects' })).toBeDisabled();
    expect(mutate).not.toHaveBeenCalled();
  });
});
