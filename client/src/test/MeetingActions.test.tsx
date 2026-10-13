import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MeetingActions } from '@/components/meetings/MeetingActions';
import type { Developer, MeetingActionDraft } from '@/types';
const people = [{ accountId: 'alex', displayName: 'Alex', isActive: true }, { accountId: 'away', displayName: 'Away', isActive: true, availability: { state: 'inactive' } }] as Developer[];
function Composer({ initial = [], changed = vi.fn() }: { initial?: MeetingActionDraft[]; changed?: (rows: MeetingActionDraft[]) => void }) {
  const [actions, setActions] = useState(initial);
  return <MeetingActions actions={actions} people={people} onChange={(rows) => { changed(rows); setActions(rows); }} />;
}
describe('compact meeting action entry', () => {
  it('persists typing without an Add click, keeps focus, and uses Enter for the next draft', () => {
    const changed = vi.fn();
    render(<Composer changed={changed} />);
    const input = screen.getByRole('textbox', { name: 'New action' });
    input.focus();
    fireEvent.change(input, { target: { value: 'Send report' } });
    expect(screen.getByLabelText('Action 1 title')).toBe(input);
    expect(input).toHaveFocus();
    expect(changed.mock.lastCall?.[0]).toEqual([expect.objectContaining({ text: 'Send report' })]);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByLabelText('New action')).toHaveFocus();
    fireEvent.change(screen.getByLabelText('New action'), { target: { value: 'Test rollback' } });
    expect(changed.mock.lastCall?.[0].map((row: MeetingActionDraft) => row.text)).toEqual(['Send report', 'Test rollback']);
    expect(screen.queryByRole('button', { name: 'Add action' })).not.toBeInTheDocument();
  });
  it('keeps extras collapsed, records owner/date, and discards only the chosen private draft', () => {
    const changed = vi.fn();
    render(<Composer initial={[{ id: 'a1', text: 'Send report' }, { id: 'a2', text: 'Test rollback' }]} changed={changed} />);
    expect(screen.getByLabelText('Action 1 deadline')).not.toBeVisible();
    fireEvent.change(screen.getByLabelText('Action 1 owner'), { target: { value: 'alex' } });
    expect(screen.getByText('Visible to Alex')).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Away' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Action 1 plan date' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Tomorrow' }));
    expect(changed.mock.lastCall?.[0][0].scheduledOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    fireEvent.click(screen.getAllByRole('button', { name: 'More', exact: true })[0]!);
    fireEvent.change(screen.getByLabelText('Action 1 waiting on'), { target: { value: 'Security review' } });
    expect(screen.getByRole('button', { name: 'More · 1' })).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Discard action 1 draft' }));
    expect(changed.mock.lastCall?.[0]).toEqual([{ id: 'a2', text: 'Test rollback' }]);
  });
  it('does not create empty placeholders and retains unavailable saved owner selections', () => {
    const changed = vi.fn();
    render(<Composer initial={[{ id: 'a1', text: 'Follow up', ownerAccountId: 'gone' }]} changed={changed} />);
    expect(screen.getByLabelText('Action 1 owner')).toHaveValue('gone');
    expect(screen.getByRole('option', { name: 'Unavailable owner' })).toBeInTheDocument();
    fireEvent.keyDown(screen.getByLabelText('New action'), { key: 'Enter' });
    expect(changed).not.toHaveBeenCalled();
  });
});
