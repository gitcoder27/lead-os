import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TeamMode } from '@/types';
import { StatusRationaleDialog } from '@/components/team-tracker/StatusRationaleDialog';

let mode: TeamMode = 'collab';
vi.mock('@/hooks/useTeamMode', () => ({ useTeamMode: () => mode }));

const tasks = [{ taskKey: 'T-7', title: 'Vendor contract' }];

function renderDialog(props: { developerParticipates?: boolean; withTasks?: boolean } = {}) {
  const onSubmit = vi.fn();
  render(
    <StatusRationaleDialog
      status="blocked"
      developerName="Alice Smith"
      tasks={props.withTasks ? tasks : []}
      isPending={false}
      developerParticipates={props.developerParticipates}
      onClose={vi.fn()}
      onSubmit={onSubmit}
    />,
  );
  return onSubmit;
}

describe('StatusRationaleDialog visibility (docs/56 P0-S6)', () => {
  beforeEach(() => {
    mode = 'collab';
  });

  it('says the rationale is visible to the developer in collab mode', () => {
    renderDialog();
    expect(screen.getByText('Visible to Alice')).toBeInTheDocument();
    expect(screen.getByText(/Alice sees the status and this rationale on My Day/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Visible to Alice/)).toBeChecked();
  });

  it('submits a shared update by default, without a visibility flag', () => {
    const onSubmit = renderDialog();
    fireEvent.change(screen.getByLabelText(/Rationale/), { target: { value: 'Waiting on vendor' } });
    fireEvent.click(screen.getByRole('button', { name: 'Set status' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0]![0]).toEqual({ rationale: 'Waiting on vendor', taskKey: undefined, nextFollowUpAt: undefined });
  });

  it('offers a private variant that submits visibility private and drops the task link', () => {
    const onSubmit = renderDialog({ withTasks: true });
    expect(screen.getByText(/Link a task/)).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(/Private — only you/));
    expect(screen.queryByText(/Link a task/)).not.toBeInTheDocument();
    expect(screen.getByText(/still sees the new status, but not the rationale or follow-up/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Rationale/), { target: { value: 'Concern about pace' } });
    fireEvent.click(screen.getByRole('button', { name: 'Set status' }));
    expect(onSubmit.mock.calls[0]![0]).toMatchObject({ rationale: 'Concern about pace', visibility: 'private', taskKey: undefined });
  });

  it('stays simple in solo mode: no visibility copy and nothing private is sent', () => {
    mode = 'solo';
    const onSubmit = renderDialog();
    expect(screen.queryByText(/Visible to/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Private — only you/)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Rationale/), { target: { value: 'Blocked on infra' } });
    fireEvent.click(screen.getByRole('button', { name: 'Set status' }));
    expect(onSubmit.mock.calls[0]![0]).not.toHaveProperty('visibility');
  });

  it('does not warn about a developer who has no login, even in collab mode', () => {
    renderDialog({ developerParticipates: false });
    expect(screen.queryByText(/Visible to/)).not.toBeInTheDocument();
  });
});
