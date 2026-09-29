import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useNavAvailability } from '@/hooks/useNavAvailability';
import { applyNavAvailability } from '@/lib/nav-pages';
import type { NavPreferences } from '@/types';

/** docs/56 P2-04: Team shows once the roster exists, Work once Jira is connected. */
const apiGet = vi.fn();
let role = 'manager';
let jiraConfigured: boolean | undefined;

vi.mock('@/lib/api', () => ({ api: { get: (...args: unknown[]) => apiGet(...args) } }));
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { role } }),
  useAuthScopeKey: () => 'ws:manager',
}));
vi.mock('@/hooks/useSyncStatus', () => ({
  useSyncStatus: () => ({ data: jiraConfigured === undefined ? undefined : { status: 'idle', jiraConfigured } }),
}));

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  vi.clearAllMocks();
  role = 'manager';
  jiraConfigured = true;
});

describe('useNavAvailability', () => {
  it('is available while the roster is still loading, so nothing flickers away', () => {
    apiGet.mockReturnValue(new Promise(() => undefined));
    const { result } = renderHook(() => useNavAvailability(), { wrapper });
    expect(result.current).toEqual({ team: true, work: true });
  });

  it('holds Team back once the roster loads empty, and releases it when people exist', async () => {
    apiGet.mockResolvedValue({ developers: [] });
    const empty = renderHook(() => useNavAvailability(), { wrapper });
    await waitFor(() => expect(empty.result.current.team).toBe(false));
    expect(apiGet).toHaveBeenCalledWith('/team/developers');

    apiGet.mockResolvedValue({ developers: [{ accountId: 'a', displayName: 'A' }] });
    const staffed = renderHook(() => useNavAvailability(), { wrapper });
    await waitFor(() => expect(apiGet).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(staffed.result.current.team).toBe(true));
  });

  it('keeps Team available when the roster request fails', async () => {
    apiGet.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useNavAvailability(), { wrapper });
    await waitFor(() => expect(apiGet).toHaveBeenCalled());
    expect(result.current.team).toBe(true);
  });

  it('holds Work back only when Jira is known to be missing', () => {
    apiGet.mockReturnValue(new Promise(() => undefined));
    jiraConfigured = false;
    expect(renderHook(() => useNavAvailability(), { wrapper }).result.current.work).toBe(false);
    jiraConfigured = undefined;
    expect(renderHook(() => useNavAvailability(), { wrapper }).result.current.work).toBe(true);
    jiraConfigured = true;
    expect(renderHook(() => useNavAvailability(), { wrapper }).result.current.work).toBe(true);
  });

  it('does not ask a developer session for the roster', () => {
    role = 'developer';
    const { result } = renderHook(() => useNavAvailability(), { wrapper });
    expect(apiGet).not.toHaveBeenCalled();
    expect(result.current.team).toBe(true);
  });
});

describe('applyNavAvailability', () => {
  const saved: NavPreferences = { topNav: ['tasks', 'team', 'notes'], moreNav: ['work'], hidden: [] };

  it('leaves the layout alone when everything is available', () => {
    expect(applyNavAvailability(saved, { team: true, work: true })).toEqual(saved);
  });

  it('drops Team and Work from both zones, in place, without touching the rest', () => {
    expect(applyNavAvailability(saved, { team: false, work: false })).toEqual({ topNav: ['tasks', 'notes'], moreNav: [], hidden: [] });
    expect(applyNavAvailability(saved, { team: false, work: true })).toEqual({ topNav: ['tasks', 'notes'], moreNav: ['work'], hidden: [] });
    expect(applyNavAvailability(saved, { team: true, work: false })).toEqual({ topNav: ['tasks', 'team', 'notes'], moreNav: [], hidden: [] });
  });

  it('never mutates the saved layout', () => {
    const copy = structuredClone(saved);
    applyNavAvailability(saved, { team: false, work: false });
    expect(saved).toEqual(copy);
  });
});
