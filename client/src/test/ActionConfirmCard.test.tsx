import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ActionConfirmCard } from '@/components/assistant/ActionConfirmCard';
import { readableActionPreview } from '@/lib/action-preview';
import { parseCapture, resolveCapture } from 'shared/capture-grammar';
import type { AssistantActionProposal } from '@/types';
vi.mock('@/hooks/useDevelopers', () => ({
  useDevelopers: () => ({ data: [{ accountId: 'dev', jiraAccountId: 'jira:dev', displayName: 'Priya Rao' }] }),
}));
vi.mock('@/hooks/useContacts', () => ({ useContacts: () => ({ data: [{ id: 7, displayName: 'Acme Legal' }] }) }));
const proposal: AssistantActionProposal = {
  conversationId: 1,
  toolCallId: 'call',
  tool: 'update_task',
  summary: 'Update T-4',
  preview: {
    taskKey: 'T-4',
    ownerId: 'dev',
    priority: 'high',
    followUpAt: null,
    details: 'Keep this literal <script> message',
  },
  jiraMutating: false,
  status: 'pending',
};
describe('readable action confirmation', () => {
  it('shows the exact target and proposed fields before any disclosure, and never writes without a decision', async () => {
    const decision = vi.fn();
    render(<ActionConfirmCard proposal={proposal} busy={false} onDecision={decision} />);
    await waitFor(() => expect(screen.getByText('Task · T-4')).toBeVisible());
    expect(screen.getByText('Priya Rao')).toBeVisible();
    expect(screen.getByText('Check again')).toBeVisible();
    expect(screen.getByText('Clear')).toBeVisible();
    expect(screen.getByText('High')).toBeVisible();
    expect(screen.getByText('Keep this literal <script> message')).toBeVisible();
    expect(document.querySelector('script')).toBeNull();
    expect(screen.getByText('Technical details').closest('details')?.open).toBe(false);
    expect(decision).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm action' }));
    expect(decision).toHaveBeenCalledExactlyOnceWith('confirm');
  });
  it('disables both decisions while busy and supports cancel', () => {
    const decision = vi.fn();
    const { rerender } = render(<ActionConfirmCard proposal={proposal} busy onDecision={decision} />);
    expect(screen.getByRole('button', { name: 'Confirm action' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel action' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm action' }));
    expect(decision).not.toHaveBeenCalled();
    rerender(<ActionConfirmCard proposal={proposal} busy={false} onDecision={decision} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel action' }));
    expect(decision).toHaveBeenCalledWith('cancel');
  });
  it('renders nested updates, before/after and contacts without changing or hiding payload fields', () => {
    const args = {
      jiraKey: 'AB2-1',
      fields: {
        assigneeId: null,
        priorityName: { from: 'Low', to: 'High' },
        customConfig: { someSetting: true },
        waitingOn: { type: 'contact', ref: '7' },
        participants: '["dev"]',
      },
    };
    const snapshot = JSON.stringify(args);
    const result = readableActionPreview(
      args,
      new Map([
        ['dev', 'Priya Rao'],
        ['contact:7', 'Acme Legal'],
      ]),
    );
    expect(result.target).toBe('Jira issue · AB2-1');
    expect(result.rows).toEqual(
      expect.arrayContaining([
        { label: 'Assignee', value: 'Unassigned' },
        { label: 'Priority', before: 'Low', value: 'High' },
        { label: 'Custom Config', value: 'Some Setting: Yes' },
        { label: 'Waiting On', value: 'Acme Legal' },
        { label: 'Participants', value: 'Priya Rao' },
      ]),
    );
    expect(JSON.stringify(args)).toBe(snapshot);
  });
  it('uses examples already supported by the capture grammar', () => {
    for (const [text, intent] of [
      ['Prepare the release update', 'create'],
      ['Review the rollout checklist !tomorrow', 'create'],
      ['/note Decision: keep Friday for verification', 'note'],
    ]) {
      const resolved = resolveCapture(parseCapture(text!, '2026-10-02'), { people: [] });
      expect(resolved.intent).toBe(intent);
      expect(resolved.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    }
  });
});
