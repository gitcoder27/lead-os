import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { AuthProvider, useAuth } from '@/context/AuthContext';
import { useReviewProgress } from '@/hooks/useWeeklyReview';
import { useCreateDailyNoteTask, useCreateDailyNoteFollowUp } from '@/hooks/useDailyNotes';
import { blankSavedState } from '@/lib/weekly-review';

const transport = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), addToast: vi.fn() }));
vi.mock('@/lib/api', () => ({ api: transport }));
vi.mock('@/context/ToastContext', () => ({ useToast: () => ({ addToast: transport.addToast }) }));
const user = (name: string) => ({ username: name, accountId: name, workspaceId: name, role: 'manager', displayName: name });
const WEEK = '2026-10-12';
function setup() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}><AuthProvider>{children}</AuthProvider></QueryClientProvider>;
  return { client, wrapper };
}
beforeEach(() => {
  vi.clearAllMocks();
  transport.get.mockResolvedValue({ user: user('A') });
  transport.post.mockImplementation((path, body) => {
    if (path === '/auth/login') return Promise.resolve({ user: user(body.username) });
    if (path === '/auth/logout') return Promise.reject(new Error('Offline logout'));
    throw new Error('Unexpected request');
  });
});
it.each(['B', 'A'])('revokes queued review writes after failed logout and login as %s', async (next) => {
  const { wrapper } = setup();
  const hooks = renderHook(() => ({ auth: useAuth(), review: useReviewProgress(WEEK, null) }), { wrapper });
  await waitFor(() => expect(hooks.result.current.auth.user?.username).toBe('A'));
  let release!: (value: unknown) => void;
  transport.put.mockReturnValueOnce(new Promise((resolve) => { release = resolve; }));
  let pending!: Promise<unknown>;
  act(() => { hooks.result.current.review.patch({ reportMarkdown: 'A secret one' }); pending = hooks.result.current.review.flush(); });
  act(() => hooks.result.current.review.patch({ reportMarkdown: 'A secret two' }));
  await act(async () => { await hooks.result.current.auth.logout().catch(() => {}); await hooks.result.current.auth.login(next, 'fixture'); });
  await act(async () => { release({ saved: blankSavedState(WEEK) }); await pending; });
  expect(transport.put).toHaveBeenCalledTimes(1);
  hooks.unmount();
  expect(transport.put).toHaveBeenCalledTimes(1);
});
it('flushes pending review edits on ordinary navigation in the same session', async () => {
  const { wrapper } = setup();
  const auth = renderHook(useAuth, { wrapper });
  await waitFor(() => expect(auth.result.current.user?.username).toBe('A'));
  // Mount after the initial session epoch was established.
  const review = renderHook(() => useReviewProgress(WEEK, null), { wrapper: ({ children }) => <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider> });
  transport.put.mockResolvedValue({ saved: blankSavedState(WEEK) });
  act(() => review.result.current.patch({ reportMarkdown: 'Navigation save' }));
  review.unmount();
  await waitFor(() => expect(transport.put).toHaveBeenCalledWith(`/review/week/${WEEK}`, { reportMarkdown: 'Navigation save' }));
});
it.each(['task', 'follow-up', 'confirmation'])('stops a note %s continuation after account switch', async (kind) => {
  const { wrapper } = setup();
  const hooks = renderHook(() => ({ auth: useAuth(), task: useCreateDailyNoteTask(WEEK), follow: useCreateDailyNoteFollowUp(WEEK) }), { wrapper });
  await waitFor(() => expect(hooks.result.current.auth.user?.username).toBe('A'));
  let release!: (value: unknown) => void;
  transport.post.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
  let pending!: Promise<unknown>;
  act(() => { pending = (kind === 'follow-up' ? hooks.result.current.follow.mutateAsync({ title: 'A secret @missing', date: WEEK, requestId: 'fixture' }) : hooks.result.current.task.mutateAsync({ title: 'A secret @missing', context: 'private context', requestId: 'fixture' })).catch((e) => e); });
  await waitFor(() => expect(transport.post).toHaveBeenCalledWith('/capture', expect.anything()));
  await act(async () => { await hooks.result.current.auth.logout().catch(() => {}); await hooks.result.current.auth.login('B', 'fixture'); });
  await act(async () => {
    release(kind === 'confirmation' ? { confirmRequired: true, diagnostics: [] } : { blocked: true, diagnostics: [{ severity: 'error', code: 'unknown-person', token: '@missing', message: 'Unknown person' }] });
    expect(await pending).toBeInstanceOf(Error);
  });
  expect(transport.post.mock.calls.filter(([path]) => path === '/capture')).toHaveLength(1);
});
