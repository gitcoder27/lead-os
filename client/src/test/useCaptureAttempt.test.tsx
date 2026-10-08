import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { createTaskViaCapture } from '@/hooks/useCapture';
import { useCaptureAttempt } from '@/hooks/useCaptureAttempt';
import type { CreateViaCapture } from '@/hooks/useCapture';
let scope = 'w:manager:a';
vi.mock('@/context/AuthContext', () => ({ useAuthScopeKey: () => scope }));
afterEach(() => { scope = 'w:manager:a'; vi.useRealTimers(); });

it('keeps the original day/zone over rollover, but renews identity after edits, context and auth changes', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-05T12:00:00Z'));
  const post = vi.fn<(input: CreateViaCapture) => Promise<boolean>>().mockResolvedValue(false);
  const form = renderHook(({ text, parentKey }) => useCaptureAttempt({ text, defaults: { parentKey } }), { initialProps: { text: 'Same', parentKey: 'T-1' } });
  await act(async () => { await form.result.current.run(post); });
  vi.setSystemTime(new Date('2026-10-08T12:00:00Z'));
  await act(async () => { await form.result.current.run(post); });
  expect(post.mock.calls[1]![0]).toEqual(post.mock.calls[0]![0]);
  form.rerender({ text: 'Edited', parentKey: 'T-1' });
  await act(async () => { await form.result.current.run(post); });
  form.rerender({ text: 'Edited', parentKey: 'T-2' });
  await act(async () => { await form.result.current.run(post); });
  scope = 'w:manager:b';
  form.rerender({ text: 'Edited', parentKey: 'T-2' });
  await act(async () => { await form.result.current.run(post); });
  expect(new Set(post.mock.calls.map(([input]) => input.requestId)).size).toBe(4);
});

it('isolates two forms and suppresses stale completions after editing, switching accounts or closing', async () => {
  const one = renderHook(({ text }) => useCaptureAttempt({ text }), { initialProps: { text: 'Same' } });
  const two = renderHook(() => useCaptureAttempt({ text: 'Same' }));
  const post = vi.fn<(input: CreateViaCapture) => Promise<boolean>>().mockResolvedValue(false);
  await act(async () => { await one.result.current.run(post); await two.result.current.run(post); });
  expect(post.mock.calls[0]![0].requestId).not.toBe(post.mock.calls[1]![0].requestId);
  let resolve!: (ok: boolean) => void;
  let pending!: Promise<boolean | undefined>;
  act(() => { pending = one.result.current.run(() => new Promise((done) => { resolve = done; })); });
  one.rerender({ text: 'New draft' });
  await act(async () => { resolve(true); expect(await pending).toBeUndefined(); });
  expect(one.result.current.isPending).toBe(false);
  act(() => { pending = one.result.current.run(() => new Promise((done) => { resolve = done; })); });
  scope = 'w:manager:b'; one.rerender({ text: 'New draft' });
  await act(async () => { resolve(true); expect(await pending).toBeUndefined(); });
  act(() => { pending = one.result.current.run(() => new Promise((done) => { resolve = done; })); });
  one.unmount();
  resolve(true); expect(await pending).toBeUndefined();
});


it('retains a Today default across rollover and reports an expired retry without minting another ID', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-05T12:00:00Z'));
  const form = renderHook(({ scheduledOn }) => useCaptureAttempt({ text: 'Same', defaults: { scheduledOn } }), { initialProps: { scheduledOn: '2026-10-05' } });
  const post = vi.fn<(input: CreateViaCapture) => Promise<boolean>>().mockResolvedValue(false);
  await act(async () => { await form.result.current.run(post); });
  vi.setSystemTime(new Date('2026-10-08T12:00:00Z'));
  form.rerender({ scheduledOn: '2026-10-08' });
  const expired = vi.fn().mockRejectedValue(new Error('Client today is out of sync'));
  await act(async () => { await expect(form.result.current.run((input) => { post(input).catch(() => {}); return createTaskViaCapture(expired, input); })).rejects.toThrow('earlier submission is unresolved'); });
  expect(post.mock.calls[1]![0]).toEqual(post.mock.calls[0]![0]);
  expect(form.result.current.isPending).toBe(false);
});
