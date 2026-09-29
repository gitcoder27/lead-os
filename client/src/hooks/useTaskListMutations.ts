import { useCallback, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuthScopeKey } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { api } from '@/lib/api';
import { useCaptureTask } from '@/hooks/useCapture';
import { optimisticTask, undoChanges } from '@/lib/task-list';
import type { BulkUpdateTasksResponse, ManagerTask, TaskViewTasksResponse, UpdateTaskRequest } from '@/types';
import { UNDO_WINDOW_MS } from '@/lib/undo';

export interface TaskChangeItem {
  task: ManagerTask;
  changes: UpdateTaskRequest;
}

export interface ApplyTaskChangesOptions {
  /** Toast title on success, e.g. "Marked 3 done". */
  label: string;
  /** docs/49 §6: offer Undo (default true). */
  undoable?: boolean;
  onUndo?: () => void;
}


// docs/51 P1: counts aggregate across every view and re-run heavier queries —
// debounce them (~500ms trailing) so rapid bulk edits trigger one recount.
let countsTimer: ReturnType<typeof setTimeout> | null = null;

function invalidateTaskSurfaces(qc: ReturnType<typeof useQueryClient>) {
  for (const key of ['tasks', 'task-detail', 'task-events', 'today', 'manager-desk', 'team-tracker', 'my-day', 'workload']) {
    qc.invalidateQueries({ queryKey: [key] });
  }
  if (countsTimer) clearTimeout(countsTimer);
  countsTimer = setTimeout(() => {
    countsTimer = null;
    void qc.invalidateQueries({ queryKey: ['task-view-counts'] });
  }, 500);
}

/**
 * docs/49 §6/R7: every list mutation goes through `POST /api/tasks/bulk` —
 * optimistic cache patch, rollback on error, invalidation on settle, and an
 * Undo toast that re-applies each task's previous values.
 */
export function useTaskListMutations() {
  const qc = useQueryClient();
  const scope = useAuthScopeKey();
  const { addToast } = useToast();
  const viewKey = ['tasks', scope, 'view'];

  const bulk = useMutation({
    mutationFn: (items: TaskChangeItem[]) =>
      api.post<BulkUpdateTasksResponse>('/tasks/bulk', {
        items: items.map((item) => ({ key: item.task.taskKey, changes: item.changes })),
      }),
    onMutate: async (items) => {
      await qc.cancelQueries({ queryKey: viewKey });
      const snapshot = qc.getQueriesData<TaskViewTasksResponse>({ queryKey: viewKey });
      const byKey = new Map(items.map((item) => [item.task.taskKey, item.changes]));
      qc.setQueriesData<TaskViewTasksResponse>({ queryKey: viewKey }, (old) =>
        old ? { ...old, tasks: old.tasks.map((task) => (byKey.has(task.taskKey) ? optimisticTask(task, byKey.get(task.taskKey)!) : task)) } : old,
      );
      return { snapshot };
    },
    onError: (_error, _items, context) => {
      for (const [key, data] of context?.snapshot ?? []) qc.setQueryData(key, data);
    },
    onSettled: () => invalidateTaskSurfaces(qc),
  });

  // docs/54 K5: the latest undoable write, so `z` can reverse it like Today's.
  const lastUndo = useRef<{ run: () => void; expiresAt: number } | null>(null);

  const apply = useCallback(
    async (items: TaskChangeItem[], options: ApplyTaskChangesOptions): Promise<boolean> => {
      if (!items.length) return false;
      try {
        await bulk.mutateAsync(items);
      } catch (error) {
        addToast({ type: 'error', title: 'Could not update tasks', message: error instanceof Error ? error.message : undefined });
        return false;
      }
      if (options.undoable === false) return true;
      const inverse: TaskChangeItem[] = items.map((item) => ({
        task: optimisticTask(item.task, item.changes),
        changes: undoChanges(item.task, item.changes),
      }));
      let undone = false;
      const runUndo = () => {
        if (undone) return;
        undone = true;
        if (lastUndo.current?.run === runUndo) lastUndo.current = null;
        options.onUndo?.();
        void apply(inverse, { label: 'Undone', undoable: false });
      };
      lastUndo.current = { run: runUndo, expiresAt: Date.now() + UNDO_WINDOW_MS };
      addToast({
        type: 'success',
        title: options.label,
        duration: UNDO_WINDOW_MS,
        action: { label: 'Undo', onClick: runUndo },
      });
      return true;
    },
    [addToast, bulk],
  );

  /** Reverses the latest write still inside the Undo window; false when there is none. */
  const undoLast = useCallback((): boolean => {
    const entry = lastUndo.current;
    if (!entry || entry.expiresAt < Date.now()) return false;
    entry.run();
    return true;
  }, []);

  // docs/57 §3 (P3-05): inline add is a capture — the title goes through the
  // shared grammar and the group's context rides as `defaults`.
  const captureTask = useCaptureTask();
  const create = { mutateAsync: captureTask.create, isPending: captureTask.isPending };

  return { apply, create, undoLast, isPending: bulk.isPending };
}
