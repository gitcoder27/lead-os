import { useCallback, useRef } from 'react';
import { useAuthScopeKey } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { previewPlacement, usePlacementWrites } from '@/hooks/useProjects';
import { UNDO_WINDOW_MS } from '@/lib/undo';
import type { TaskPlacement } from '@/types';

/**
 * docs/73 UXD-16: move tasks to a project in one pick. Uses the same guarded preview → bulk
 * endpoints as the Move dialog (so a stale or racing write is refused, not applied), with the
 * same Undo toast. A refused write offers Retry instead of failing silently.
 */
export function useQuickPlacement() {
  const write = usePlacementWrites();
  const { addToast } = useToast();
  const scope = useAuthScopeKey();
  const currentScope = useRef(scope);
  currentScope.current = scope;

  const move = useCallback(async (keys: string[], placement: TaskPlacement | null): Promise<boolean> => {
    const submittedScope = currentScope.current;
    try {
      const preview = await previewPlacement({ keys, includeSubtasks: false });
      if (!preview.tasks.length) return false;
      const receipt = await write.mutateAsync({ preview, placement });
      if (currentScope.current !== submittedScope) return true;
      addToast({
        type: 'success',
        title: placement ? `Moved to project · ${receipt.count} ${receipt.count === 1 ? 'task' : 'tasks'}` : `Removed from project · ${receipt.count} ${receipt.count === 1 ? 'task' : 'tasks'}`,
        duration: UNDO_WINDOW_MS,
        action: {
          label: 'Undo',
          onClick: () => {
            if (currentScope.current !== submittedScope) return;
            void write.mutateAsync(receipt.undo).then(
              () => addToast('Project placement restored', 'success'),
              (reason: Error) => addToast(reason.message, 'error'),
            );
          },
        },
      });
      return true;
    } catch (reason) {
      if (currentScope.current !== submittedScope) return false;
      addToast({
        type: 'error',
        title: "Couldn't move the task",
        message: reason instanceof Error ? reason.message : undefined,
        action: { label: 'Retry', onClick: () => { void move(keys, placement); } },
      });
      return false;
    }
  }, [addToast, write]);

  return { move, pending: write.isPending };
}
