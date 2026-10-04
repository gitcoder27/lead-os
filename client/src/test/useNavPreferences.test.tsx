import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useNavPreferences } from '@/hooks/useNavPreferences';

function createWrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { role: 'manager', accountId: 'manager-a' } }),
  useAuthScopeKey: () => 'ws:manager-a:manager',
}));
vi.mock('@/hooks/useTasksPhase3', () => ({ useTasksPhase3: () => true }));
vi.mock('@/lib/nav-preferences-cache', () => ({ readNavPreferencesCache: () => null, writeNavPreferencesCache: vi.fn() }));
const mockGet = vi.fn();
vi.mock('@/lib/api', () => ({ api: { get: (...args: unknown[]) => mockGet(...args) } }));

describe('useNavPreferences', () => {
  it('keeps one fallback object while the read fails, so syncing consumers settle (UX-12)', async () => {
    mockGet.mockRejectedValue(new Error('offline'));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result, rerender } = renderHook(() => useNavPreferences(), { wrapper: createWrapper(client) });
    await waitFor(() => expect(mockGet).toHaveBeenCalled());
    const first = result.current.preferences;
    rerender();
    rerender();
    expect(result.current.preferences).toBe(first);
    expect(first.topNav).toContain('tasks');
  });
});
