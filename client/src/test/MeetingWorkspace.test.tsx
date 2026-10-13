import { MeetingActions } from '@/components/meetings/MeetingActions';
import type { Developer, ManagerTask } from '@/types';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { MeetingWorkspace } from '@/components/meetings/MeetingWorkspace';
const state = vi.hoisted(() => ({ oneOnOne: true, title: 'Release review', notesOmit: [] as string[], actions: [] as ManagerTask[], status: 'open' }));
vi.mock('@/context/AuthContext', () => ({ useAuthScopeKey: () => 'ws:a:manager:', useAuth: () => ({ features: { oneOnOne: state.oneOnOne } }) }));
vi.mock('@/hooks/useDevelopers', () => ({ useDevelopers: () => ({ data: [{ accountId: 'alex', displayName: 'Alex', isActive: true }] }) }));
vi.mock('@/hooks/useMeetingDocument', () => ({ useMeetingDocument: () => ({
  query: { data: { task: { taskKey: 'T-1', title: state.title, kind: 'meeting', status: state.status, participants: 'Alex', links: [{ kind: 'person', ref: 'alex' }] }, actions: state.actions, context: { previous: null, openActions: [], commitments: [], blockers: [], issues: [] } }, refetch: vi.fn() },
  body: { agenda: '', notes: '', outcome: '', noDecisions: false, actions: [] }, change: vi.fn(), flush: vi.fn(), status: 'Saved', conflict: undefined, recoveryAvailable: true,
}) }));
vi.mock('@/hooks/useMeetingCapture', () => ({ useMeetingCapture: () => ({ submit: vi.fn(), isPending: false, pending: null, diagnostics: null }) }));
vi.mock('@/components/notes/editor/NoteEditor', () => ({ NoteEditor: ({ omit }: { omit: string[] }) => { state.notesOmit = omit; return <div>Notes editor</div>; } }));
vi.mock('@/components/tasks/TaskDrawer', () => ({ TaskDrawer: ({ taskKey }: { taskKey: string | null }) => taskKey ? <div>Task drawer {taskKey}</div> : null }));
beforeEach(() => { window.history.replaceState(null, '', '/t/T-1?mode=meeting'); state.title = 'Release review'; state.oneOnOne = true; state.actions = []; state.status = 'open'; });
describe('focused meeting workspace', () => {
  it('labels private preparation and omits shared-update editor commands', () => {
    render(<MeetingWorkspace taskKey="T-1" />);
    expect(screen.getByLabelText('Agenda')).toBeInTheDocument();
    expect(screen.getByLabelText('Outcome')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Finish meeting' })).toBeInTheDocument();
    expect(state.notesOmit).toEqual(['update', 'follow-up', 'wrap-up']);
  });
  it('shows the actual developer audience when a title mention overrides the owner control', () => {
    render(<MeetingActions actions={[{ id: 'a1', text: 'Send notes @alex', ownerAccountId: null }]} people={[{ accountId: 'alex', displayName: 'Alex', isActive: true } as Developer]} onChange={vi.fn()} />);
    expect(screen.getByText('Visible to Alex · owner set in title')).toBeInTheDocument();
    expect(screen.getByLabelText('Action 1 owner')).toHaveValue('');
  });
  it('shows submitted developer actions on review with their current status and opens their drawer', () => {
    state.status = 'done';
    state.actions = [{ taskKey: 'T-2', title: 'Send report', status: 'done', ownerType: 'developer', ownerId: 'alex', scheduledOn: null } as ManagerTask];
    render(<MeetingWorkspace taskKey="T-1" />);
    expect(screen.getByRole('region', { name: 'Agreed actions' })).toBeInTheDocument();
    const row = screen.getByRole('button', { name: /Send report.*T-2 · Alex · No plan date.*Done/ });
    fireEvent.click(row);
    expect(screen.getByText('Task drawer T-2')).toBeInTheDocument();
    expect(screen.queryByLabelText('Action 1 title')).not.toBeInTheDocument();
  });
  it('bridges existing 1:1 meetings to their current workspace', async () => {
    state.title = '1:1 with Alex';
    render(<MeetingWorkspace taskKey="T-1" />);
    await waitFor(() => expect(window.location.pathname + window.location.search).toBe('/team?dev=alex&panel=one-on-one'));
  });
});
