import { describe, expect, it, vi } from 'vitest';
import type { CaptureResponseBody } from 'shared/capture-grammar';
import { CaptureRejectedError, createTaskViaCapture } from '@/hooks/useCapture';

const task = { taskKey: 'T-9', title: 'x' } as CaptureResponseBody['task'];

describe('createTaskViaCapture (docs/63 #8)', () => {
  it('accepts a past date on the caller\'s behalf: these paths have no confirm step', async () => {
    const post = vi.fn()
      .mockResolvedValueOnce({ intent: 'create', confirmRequired: true, diagnostics: [{ severity: 'warning', code: 'past-date', message: 'in the past' }] })
      .mockResolvedValueOnce({ intent: 'create', diagnostics: [], task });
    const created = await createTaskViaCapture(post, { text: 'Retro !2020-01-01' });
    expect(created.task.taskKey).toBe('T-9');
    expect(post.mock.calls[1]![0]).toMatchObject({ confirm: true });
  });

  it('refuses a malformed @mention as an error and never posts the confirm', async () => {
    const post = vi.fn().mockResolvedValueOnce({
      intent: 'create',
      confirmRequired: true,
      diagnostics: [{ severity: 'warning', code: 'malformed-mention', token: '@harsha,', message: '"@harsha," isn\'t a valid mention' }],
    });
    await expect(createTaskViaCapture(post, { text: 'Ask @harsha, about it' })).rejects.toBeInstanceOf(CaptureRejectedError);
    await expect(createTaskViaCapture(post.mockResolvedValueOnce({
      intent: 'create',
      confirmRequired: true,
      diagnostics: [{ severity: 'warning', code: 'malformed-mention', token: '@harsha,', message: '"@harsha," isn\'t a valid mention' }],
    }), { text: 'Ask @harsha, about it' })).rejects.toThrow("isn't a valid mention");
    expect(post).toHaveBeenCalledTimes(2);
    expect(post.mock.calls.every(([body]) => body.confirm === undefined)).toBe(true);
  });
});
