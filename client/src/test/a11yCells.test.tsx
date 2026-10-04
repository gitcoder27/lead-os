import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LinkedCell } from '@/components/table/LinkedCell';
import { CommentForm } from '@/components/triage/CommentForm';

vi.mock('@/hooks/useAddComment', () => ({ useAddComment: () => ({ mutate: vi.fn(), isPending: false }) }));

/** docs/56 UX-23: icon-only status marks are images with names; icon buttons have names. */
describe('Work and Triage accessible names (UX-23)', () => {
  it('the Linked cell names what is linked and is empty when nothing is (UX-23, UX-31)', () => {
    const { container, rerender } = render(<LinkedCell hasNotes trackerCount={2} developerNames={['Alice']} />);
    expect(screen.getByRole('img', { name: 'Analysis notes' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: '2 Team board tasks: Alice' })).toBeInTheDocument();
    rerender(<LinkedCell hasNotes={false} trackerCount={0} developerNames={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('the triage comment send button has a name', () => {
    render(<CommentForm issueKey="AM-1" />);
    expect(screen.getByRole('button', { name: 'Add comment' })).toBeInTheDocument();
  });
});
