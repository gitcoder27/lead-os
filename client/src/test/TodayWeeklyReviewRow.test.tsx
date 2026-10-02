import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { ToastProvider } from '@/context/ToastContext';
import { TodayWeeklyReviewRow } from '@/components/today/TodayWeeklyReviewRow';
import type { TodayWeeklyReview } from '@/types';

/** docs/59 §5.1 (WR-06): the review row in Today's stage panel. */
const apiPut = vi.fn();
vi.mock('@/lib/api', () => ({ api: { put: (url: string, body: unknown) => apiPut(url, body) } }));
vi.mock('@/context/AuthContext', () => ({ useAuthScopeKey: () => 'scope' }));

function renderRow(review: TodayWeeklyReview) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}><ToastProvider>{children}</ToastProvider></QueryClientProvider>
  );
  return { invalidate, ...render(<TodayWeeklyReviewRow review={review} />, { wrapper }) };
}

const popstate = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  apiPut.mockReset();
  apiPut.mockResolvedValue({ saved: {} });
  window.history.pushState(null, '', '/');
  window.addEventListener('popstate', popstate);
});

describe('TodayWeeklyReviewRow', () => {
  it('invites the review on the review day and opens it for that week', () => {
    renderRow({ due: true, weekStart: '2026-09-28' });
    expect(screen.getByText('Weekly review')).toBeInTheDocument();
    expect(screen.getByText('~10 min')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Not this week' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Start review' }));
    expect(window.location.pathname + window.location.search).toBe('/?mode=review&week=2026-09-28');
    expect(popstate).toHaveBeenCalled();
  });

  it('reads "done" with the finish time afterwards, and can reopen the review', () => {
    // A local timestamp so the expected clock does not depend on the zone the tests run in.
    const completedAt = new Date(2026, 9, 2, 15, 42).toISOString();
    renderRow({ due: false, completedAt, weekStart: '2026-09-28' });
    expect(screen.getByText('Weekly review done · 15:42')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start review' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Copy update' }));
    expect(window.location.search).toBe('?mode=review&week=2026-09-28&step=send');
  });

  it('offers the catch-up on Monday with Start and Not this week; the dismissal is for that week only', async () => {
    const { invalidate } = renderRow({ due: true, catchUp: true, weekStart: '2026-09-28' });
    expect(screen.getByText('Review last week')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Not this week' }));
    await waitFor(() => expect(apiPut).toHaveBeenCalledWith('/review/week/2026-09-28', { dismissed: true }));
    // Today refetches so the row goes away.
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['today'] }));

    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    expect(window.location.search).toBe('?mode=review&week=2026-09-28');
  });

  it('raises a persistent error when the dismissal fails', async () => {
    apiPut.mockRejectedValueOnce(new Error('nope'));
    renderRow({ due: true, catchUp: true, weekStart: '2026-09-28' });
    fireEvent.click(screen.getByRole('button', { name: 'Not this week' }));
    expect(await screen.findByText("Couldn't dismiss the review")).toBeInTheDocument();
  });

  it('renders nothing when there is nothing to offer', () => {
    renderRow({ due: false, weekStart: '2026-09-28' });
    expect(screen.queryByTestId('today-weekly-review')).not.toBeInTheDocument();
  });
});
