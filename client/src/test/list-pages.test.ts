import { beforeEach, expect, it, vi } from 'vitest';
import { api } from '@/lib/api';
import { readListPages } from '@/lib/list-pages';

vi.mock('@/lib/api', () => ({ api: { get: vi.fn() } }));
beforeEach(() => vi.clearAllMocks());

it('assembles every bounded page with the same filters for whole-view actions', async () => {
  vi.mocked(api.get).mockResolvedValueOnce({ issues: ['A', 'B'], total: 3, nextOffset: 2 })
    .mockResolvedValueOnce({ issues: ['C'], total: 3, nextOffset: null });
  const signal = new AbortController().signal;
  expect(await readListPages('/issues?filter=blocked&tags=1', 'issues', signal)).toEqual(['A', 'B', 'C']);
  expect(api.get).toHaveBeenNthCalledWith(1, '/issues?filter=blocked&tags=1&limit=200&offset=0', { signal });
  expect(api.get).toHaveBeenNthCalledWith(2, '/issues?filter=blocked&tags=1&limit=200&offset=2', { signal });
});

it('does not publish a partial list when a later page fails', async () => {
  vi.mocked(api.get).mockResolvedValueOnce({ tasks: ['T-1'], nextOffset: 1 }).mockRejectedValueOnce(new Error('Offline'));
  await expect(readListPages('/tasks?viewDef=abc&tz=UTC', 'tasks')).rejects.toThrow('Offline');
});

it('stops superseded reads and rejects non-advancing cursors', async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(readListPages('/issues', 'issues', controller.signal)).rejects.toThrow();
  expect(api.get).not.toHaveBeenCalled();
  vi.mocked(api.get).mockResolvedValueOnce({ issues: ['A'], nextOffset: 0 });
  await expect(readListPages('/issues', 'issues')).rejects.toThrow('Invalid list page cursor');
});
