import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useToday } from '@/hooks/useToday';
import { writeTodaySnapshot } from '@/lib/today-snapshot-cache';
import type { TodayResponse } from '@/types';

const mockGet = vi.fn();

vi.mock('@/context/AuthContext', () => ({
  useAuthScopeKey: () => 'workspace-a:manager:manager:',
}));

vi.mock('@/lib/api', () => ({
  api: {
    get: (...args: unknown[]) => mockGet(...args),
  },
}));

const cachedToday: TodayResponse = {
  date: '2026-08-27',
  generatedAt: '2026-08-27T08:00:00.000Z',
  rhythm: { stage: 'morning_plan', label: 'Morning plan', detail: 'Set direction' },
  summary: [],
  actionItems: [],
  teamPulse: [],
  promises: [],
  standupPrompts: [],
  meetingPrompts: [],
};

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe('useToday', () => {
  beforeEach(() => {
    mockGet.mockReset();
    window.sessionStorage.clear();
  });

  it('hydrates a scoped session snapshot immediately and revalidates it', async () => {
    writeTodaySnapshot('workspace-a:manager:manager:', cachedToday.date, cachedToday, Date.now());
    mockGet.mockImplementation(() => new Promise(() => undefined));

    const { result } = renderHook(() => useToday(cachedToday.date), { wrapper: createWrapper() });

    expect(result.current.data).toEqual(cachedToday);
    await waitFor(() => expect(result.current.isFetching).toBe(true));
    expect(mockGet).toHaveBeenCalledWith(
      // docs/53 F5: the browser zone rides along.
      expect.stringMatching(/^\/today\?date=2026-08-27(&tz=[^&]+)?$/),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });
});