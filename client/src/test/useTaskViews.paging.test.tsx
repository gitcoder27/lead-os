import { expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useTaskViewTasks } from '@/hooks/useTaskViews';
import { api } from '@/lib/api';
import { TestWrapper } from '@/test/wrapper';

vi.mock('@/context/AuthContext', () => ({ useAuthScopeKey: () => 'paging-manager' }));
vi.mock('@/lib/api', () => ({ api: { get: vi.fn() } }));

it('loads all bounded Tasks pages with identical view, day and zone before exposing actions', async () => {
  const all = Array.from({ length: 451 }, (_, index) => ({ taskKey: `T-${index + 1}` }));
  vi.mocked(api.get).mockImplementation(async (url) => {
    const params = new URLSearchParams(url.split('?')[1]);
    const offset = Number(params.get('offset'));
    const limit = Number(params.get('limit'));
    return { tasks: all.slice(offset, offset + limit), total: all.length, nextOffset: offset + limit < all.length ? offset + limit : null };
  });
  const { result } = renderHook(() => useTaskViewTasks({ filters: { owner: 'me' }, group: 'scheduled' }, true, '2026-10-06'), { wrapper: TestWrapper });
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(result.current.data?.tasks).toEqual(all);
  expect(result.current.data?.total).toBe(451);
  const calls = vi.mocked(api.get).mock.calls.map(([url]) => new URLSearchParams(url.split('?')[1]));
  expect(calls.map((params) => params.get('offset'))).toEqual(['0', '200', '400']);
  expect(new Set(calls.map((params) => params.get('viewDef'))).size).toBe(1);
  expect(calls.every((params) => params.get('limit') === '200' && params.get('today') === '2026-10-06')).toBe(true);
  expect(new Set(calls.map((params) => params.get('tz'))).size).toBe(1);
});
