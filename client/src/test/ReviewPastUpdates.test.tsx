import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ToastProvider } from '@/context/ToastContext';
import { ReviewPastUpdates } from '@/components/review/ReviewPastUpdates';
const copy = vi.fn().mockResolvedValue('text');
const weeks = ['2026-09-28', '2026-09-21', '2026-09-14', '2026-09-07', '2026-08-31'].map((weekStart, i) => ({ weekStart, completedAt: `${weekStart}T12:00:00Z`, reportMarkdown: `Update ${i + 1}` }));
vi.mock('@/hooks/useWeeklyReview', () => ({ useReviewPastWeeks: () => ({ data: { weeks }, isError: false, isPending: false }) }));
vi.mock('@/lib/report-clipboard', () => ({ copyReport: (...args: unknown[]) => copy(...args) }));
describe('Past updates', () => {
  it('copies the newest four completed reports in the supplied server order', async () => {
    render(<ToastProvider><ReviewPastUpdates /></ToastProvider>);
    fireEvent.click(screen.getByText('Past updates'));
    fireEvent.click(screen.getByRole('button', { name: 'Copy last 4 weeks' }));
    await waitFor(() => expect(copy).toHaveBeenCalledWith('Update 1\n\nUpdate 2\n\nUpdate 3\n\nUpdate 4'));
    fireEvent.click(screen.getByRole('button', { name: 'Copy update for 28 Sep – 2 Oct' }));
    await waitFor(() => expect(copy).toHaveBeenLastCalledWith('Update 1'));
  });
});
