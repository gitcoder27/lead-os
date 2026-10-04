import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AnalysisStatusCell } from '@/components/table/AnalysisStatusCell';
import { TrackerAssignmentsCell } from '@/components/table/TrackerAssignmentsCell';
import { CommentForm } from '@/components/triage/CommentForm';

vi.mock('@/hooks/useAddComment', () => ({ useAddComment: () => ({ mutate: vi.fn(), isPending: false }) }));

/** docs/56 UX-23: icon-only status marks are images with names; icon buttons have names. */
describe('Work and Triage accessible names (UX-23)', () => {
  it('status icons in the defect table are named images, not label-only spans', () => {
    render(<><AnalysisStatusCell hasNotes={false} /><AnalysisStatusCell hasNotes /><TrackerAssignmentsCell activeCount={0} developerNames={[]} /><TrackerAssignmentsCell activeCount={2} developerNames={['Alice']} /></>);
    expect(screen.getByRole('img', { name: 'Analysis pending' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Analysis complete' })).toBeInTheDocument();
    expect(screen.getAllByRole('img', { name: /linked/ })).toHaveLength(2);
  });

  it('the triage comment send button has a name', () => {
    render(<CommentForm issueKey="AM-1" />);
    expect(screen.getByRole('button', { name: 'Add comment' })).toBeInTheDocument();
  });
});
