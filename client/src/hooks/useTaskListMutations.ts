import { useCallback } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuthScopeKey } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { api } from '@/lib/api';
import { optimisticTask, undoChanges } from '@/lib/task-list';
import type { BulkUpdateTasksResponse, CreateTaskRequest, ManagerTask, TaskViewTasksResponse, UpdateTaskRequest } from '@/types';

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

const UNDO_TOAST_MS = 6000;

function invalidateTaskSurfaces(qc: ReturnType<typeof useQueryClient>) {
  for (const key of ['tasks', 'task-view-counts', 'task-detail', 'task-events', 'today', 'manager-desk', 'team-tracker', 'my-day', 'workload']) {
    qc.invalidateQueries({ queryKey: [key] });
  }
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
      addToast({
        type: 'success',
        title: options.label,
        duration: UNDO_TOAST_MS,
        action: {
          label: 'Undo',
          onClick: () => {
            options.onUndo?.();
            void apply(inverse, { label: 'Undone', undoable: false });
          },
        },
      });
      return true;
    },
    [addToast, bulk],
  );

  const create = useMutation({
    mutationFn: (input: CreateTaskRequest) => api.post<ManagerTask>('/tasks', input),
    onSettled: () => invalidateTaskSurfaces(qc),
  });

  return { apply, create, isPending: bulk.isPending };
}
