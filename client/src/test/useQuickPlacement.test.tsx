import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useQuickPlacement } from '@/hooks/useQuickPlacement';

const preview = vi.fn();
const mutateAsync = vi.fn();
const addToast = vi.fn();
vi.mock('@/hooks/useProjects', () => ({
  previewPlacement: (...args: unknown[]) => preview(...args),
  usePlacementWrites: () => ({ mutateAsync, isPending: false }),
}));
vi.mock('@/context/ToastContext', () => ({ useToast: () => ({ addToast }) }));
vi.mock('@/context/AuthContext', () => ({ useAuthScopeKey: () => 'ws:manager:maya' }));

describe('useQuickPlacement (docs/73 UXD-16)', () => {
  beforeEach(() => { preview.mockReset(); mutateAsync.mockReset(); addToast.mockReset(); });

  it('moves through the guarded preview → bulk write and offers Undo', async () => {
    const guarded = { keys: ['T-4'], includeSubtasks: false, tasks: [{ taskKey: 'T-4', title: 'Approve', placement: null }] };
    preview.mockResolvedValue(guarded);
    mutateAsync.mockResolvedValueOnce({ count: 1, undo: { preview: guarded, restore: [] } }).mockResolvedValueOnce({ count: 1 });
    const { result } = renderHook(() => useQuickPlacement());
    await act(async () => { await result.current.move(['T-4'], { projectId: 2, trackId: null }); });
    expect(preview).toHaveBeenCalledWith({ keys: ['T-4'], includeSubtasks: false });
    expect(mutateAsync).toHaveBeenCalledWith({ preview: guarded, placement: { projectId: 2, trackId: null } });
    const toast = addToast.mock.calls[0]![0];
    expect(toast).toMatchObject({ type: 'success', title: 'Moved to project · 1 task', action: { label: 'Undo' } });
    await act(async () => { toast.action.onClick(); });
    expect(mutateAsync).toHaveBeenLastCalledWith({ preview: guarded, restore: [] });
  });

  it('shows a Retry toast when the guarded write is refused', async () => {
    preview.mockResolvedValue({ keys: ['T-4'], includeSubtasks: false, tasks: [{ taskKey: 'T-4', title: 'Approve', placement: null }] });
    mutateAsync.mockRejectedValue(new Error('The task changed since the preview'));
    const { result } = renderHook(() => useQuickPlacement());
    await act(async () => { expect(await result.current.move(['T-4'], { projectId: 2, trackId: null })).toBe(false); });
    expect(addToast).toHaveBeenCalledWith(expect.objectContaining({ type: 'error', title: "Couldn't move the task", message: 'The task changed since the preview', action: expect.objectContaining({ label: 'Retry' }) }));
  });
});
