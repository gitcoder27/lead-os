import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { IssueStatusActions } from '@/components/triage/IssueStatusActions';
import { ToastProvider } from '@/context/ToastContext';
import type { Issue } from '@/types';
const apply = vi.fn(), refetch = vi.fn();
const data = { currentStatus: { name: 'Open', category: 'new' }, transitions: [{ id: '21', name: 'Start', supported: true, to: { name: 'In Progress', category: 'indeterminate' } }, { id: '31', name: 'Resolve with form', supported: false, to: { name: 'Done', category: 'done' } }] };
vi.mock('@/hooks/useJiraExecution', () => ({ useIssueTransitions: () => ({ data, refetch, isPending: false, isError: false }), useJiraExecution: () => ({ transition: { mutateAsync: apply, isPending: false } }) }));
beforeEach(() => vi.resetAllMocks());
describe('allowed Jira status actions', () => {
  it('shows current Jira status and rejects form actions; failures stay reviewable', async () => {
    apply.mockRejectedValueOnce(new Error('Status changed. Refresh.')).mockResolvedValueOnce({ issue: { statusName: 'In Progress' }, refreshPending: true });
    render(<ToastProvider><IssueStatusActions issue={{ jiraKey: 'AB2-1' } as Issue} /></ToastProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Change Jira status' }));
    expect(screen.getByRole('menuitem', { name: 'Resolve with form → Done' })).toBeDisabled();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Start → In Progress' }));
    await screen.findByText('Status changed. Refresh.'); expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(apply).toHaveBeenCalledWith({ key: 'AB2-1', transitionId: '21', expectedStatus: { name: 'Open', category: 'new' } });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh transitions' })); expect(refetch).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Start → In Progress' }));
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
    expect(screen.getByText('Changed in Jira; status refresh is pending.')).toBeInTheDocument();
  });
});
