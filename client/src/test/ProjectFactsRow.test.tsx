import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ProjectFactsRow } from '@/components/tasks/ProjectFactsRow';

const facts = (at: string) => ({ open: 3, blocked: 0, overdue: 0, followUpDue: 0, nextCheck: { taskKey: 'T-9', title: 'Vendor call', at } });
const now = new Date('2026-10-11T12:00:00');

describe('ProjectFactsRow next check (docs/73 UXD-28)', () => {
  it('reads a future check quietly, in the one date style', () => {
    render(<ProjectFactsRow facts={facts('2026-10-13T10:00:00')} openTask={vi.fn()} now={now} />);
    const check = screen.getByRole('button', { name: /Next check/ });
    expect(check).toHaveTextContent('Next check · Tue 13 Oct, 10:00 · T-9');
    expect(check).not.toHaveAttribute('data-past');
  });

  it('says a passed check was due, in the warning tone, and still opens the task', () => {
    const openTask = vi.fn();
    render(<ProjectFactsRow facts={facts('2026-10-09T10:00:00')} openTask={openTask} now={now} />);
    const check = screen.getByRole('button', { name: /Check was due/ });
    expect(check).toHaveAttribute('data-past', 'true');
    expect(check).toHaveStyle({ color: 'var(--warning-text)' });
    fireEvent.click(check);
    expect(openTask).toHaveBeenCalledWith('T-9');
  });
});
