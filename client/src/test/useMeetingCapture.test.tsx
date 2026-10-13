import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useMeetingCapture } from '@/hooks/useMeetingCapture';
import { advanceAuthEpoch } from '@/lib/auth-epoch';
import { meetingBody } from '@/hooks/useMeetingDocument';
const mocks = vi.hoisted(() => ({ post: vi.fn(), toast: vi.fn() }));
vi.mock('@/lib/api', async () => ({ ...await vi.importActual('@/lib/api'), api: { post: mocks.post } }));
vi.mock('@/context/AuthContext', () => ({ useAuthScopeKey: () => 'ws:a:manager:', useAuth: () => ({ user: { username: 'a', workspaceId: 'ws' } }) }));
vi.mock('@/context/ToastContext', () => ({ useToast: () => ({ addToast: mocks.toast }) }));
const document = { ...meetingBody(), id: 'd', revision: 1, previousMeetingKey: null, updatedAt: '' };
const editor = { flush: vi.fn().mockResolvedValue(true), document: () => document, accept: vi.fn() };
const success = () => ({ operation: 'meeting-finish', diagnostics: [], document: { ...document, revision: 2 }, task: { taskKey: 'T-1', status: 'done' }, actions: [], undo: { requestId: 'receipt', expiresAt: new Date(Date.now() + 6000).toISOString() } });
function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  return { ...renderHook(() => useMeetingCapture('T-1', editor), { wrapper }), qc };
}
beforeEach(() => { localStorage.clear(); vi.clearAllMocks(); editor.flush.mockResolvedValue(true); });
describe('meeting submission receipts', () => {
  it('retains the exact request across a lost response and refresh', async () => {
    mocks.post.mockRejectedValueOnce(new Error('Lost response')).mockResolvedValueOnce(success());
    const first = mount();
    await act(async () => { await first.result.current.submit({}); });
    const sent = mocks.post.mock.calls[0]![1];
    expect(first.result.current.pending?.requestId).toBe(sent.requestId);
    first.unmount();
    const second = mount();
    await act(async () => { await second.result.current.submit({}); });
    expect(mocks.post.mock.calls[1]![1]).toEqual(sent);
    expect(editor.flush).toHaveBeenCalledTimes(1);
    expect(second.result.current.pending).toBeNull();
    expect(editor.accept).toHaveBeenCalledWith(expect.objectContaining({ revision: 2 }));
    second.unmount();
  });
  it('coalesces double clicks and confirms grammar warnings with the same identity', async () => {
    let resolve!: (value: unknown) => void;
    mocks.post.mockImplementationOnce(() => new Promise((done) => { resolve = done; })).mockResolvedValueOnce(success());
    const hook = mount();
    let first!: Promise<unknown>;
    act(() => { first = hook.result.current.submit({}); });
    await waitFor(() => expect(mocks.post).toHaveBeenCalledTimes(1));
    await act(async () => { await hook.result.current.submit({}); resolve({ operation: 'meeting-finish', diagnostics: [{ code: 'malformed-mention', message: 'Confirm literal mention' }], confirmRequired: true }); await first; });
    const requestId = hook.result.current.pending?.requestId;
    await act(async () => { await hook.result.current.submit({ confirm: true }); });
    expect(mocks.post.mock.calls[1]![1]).toMatchObject({ requestId, confirm: true });
    hook.unmount();
  });
  it('revokes pending flush continuations and toast Undo callbacks on account changes', async () => {
    let resolve!: (value: boolean) => void;
    editor.flush.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const hook = mount();
    let pending!: Promise<unknown>;
    act(() => { pending = hook.result.current.submit({}); });
    await waitFor(() => expect(editor.flush).toHaveBeenCalled());
    advanceAuthEpoch(hook.qc);
    await act(async () => { resolve(true); await pending; });
    expect(mocks.post).not.toHaveBeenCalled();
    mocks.post.mockResolvedValue(success());
    await act(async () => { await hook.result.current.submit({}); });
    expect(mocks.toast).toHaveBeenCalled();
    advanceAuthEpoch(hook.qc);
    mocks.toast.mock.calls[0]![0].action.onClick();
    expect(mocks.post).toHaveBeenCalledTimes(1);
    hook.unmount();
  });
});
