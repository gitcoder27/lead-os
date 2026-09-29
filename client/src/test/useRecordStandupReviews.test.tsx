import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { createTestQueryClient } from '@/test/wrapper';
import { useRecordStandupReviews } from '@/hooks/useTeamTrackerMutations';

const post = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', () => ({ api: { post } }));

describe('useRecordStandupReviews (docs/56 P1-07)', () => {
  it('posts the reviewed accounts and does not refetch the board', async () => {
    post.mockResolvedValue({ recorded: ['dev-1'] });
    const queryClient = createTestQueryClient();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useRecordStandupReviews(), { wrapper });

    result.current.mutate({ date: '2026-03-07', accountIds: ['dev-1'] });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(post).toHaveBeenCalledWith('/team-tracker/standup/reviews', { date: '2026-03-07', accountIds: ['dev-1'] });
    // Standup walks the board by index, so a review must not trigger a refetch mid-round.
    expect(invalidate).not.toHaveBeenCalled();
  });
});
