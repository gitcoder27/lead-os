import { useCallback, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthScopeKey } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { api } from '@/lib/api';
import { useCaptureTask } from '@/hooks/useCapture';
import { optimisticTask, undoChanges } from '@/lib/task-list';
import { WriteAbandoned, expectedFrom, patchCachedTasks, taskWrites, type CacheShape, type CachedTaskRow } from '@/lib/task-writes';
import type { BulkUpdateTasksResponse, ManagerTask, TaskExpectedState, TaskViewTask, TaskViewTasksResponse, UpdateTaskRequest } from '@/types';
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

/** docs/61 TS-01: how an Undo attempt ended. `failed` leaves it retryable; `conflict` means a task changed and nothing was undone. */
export type UndoOutcome = 'undone' | 'conflict' | 'failed';

/** docs/61 TS-01: what a successful write hands back — the server's answer and the guarded way to reverse it. */
export interface TaskWriteReceipt {
  /** Tasks as the server acknowledged them, in request order. */
  tasks: ManagerTask[];
  /** Reverses the write only if every task still holds the acknowledged values. One attempt runs at a time. */
  undo: () => Promise<UndoOutcome>;
}

/** The server refused the guarded write: a task no longer holds the values the action expected. */
function isConflict(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { status?: unknown }).status === 409;
}

const UNDO_CONFLICT = 'Could not undo: a task changed since this action. Nothing was undone.';

interface GuardedItem extends TaskChangeItem {
  /** Set for an Undo, whose guard is the acknowledged postimage; forward writes derive theirs from `task`. */
  expected?: TaskExpectedState;
}

// docs/51 P1: counts aggregate across every view and re-run heavier queries —
// debounce them (~500ms trailing) so rapid bulk edits trigger one recount.
let countsTimer: ReturnType<typeof setTimeout> | null = null;

export function invalidateTaskSurfaces(qc: ReturnType<typeof useQueryClient>) {
  for (const key of ['tasks', 'task-detail', 'task-events', 'today', 'manager-desk', 'team-tracker', 'my-day', 'workload']) {
    qc.invalidateQueries({ queryKey: [key] });
  }
  if (countsTimer) clearTimeout(countsTimer);
  countsTimer = setTimeout(() => {
    countsTimer = null;
    void qc.invalidateQueries({ queryKey: ['task-view-counts'] });
  }, 500);
}

const listShape: CacheShape<TaskViewTasksResponse> = {
  rows: (data) => data.tasks as unknown as CachedTaskRow[],
  map: (data, update) => ({ ...data, tasks: data.tasks.map((task) => update(task as unknown as CachedTaskRow) as unknown as TaskViewTask) }),
};

/**
 * docs/49 §6/R7: every list mutation goes through `POST /api/tasks/bulk` —
 * optimistic cache patch, rollback on error, invalidation on settle, and an
 * Undo toast that re-applies each task's previous values.
 *
 * docs/61 TS-01 (D1): writes carry the values they expect the tasks to hold, so a
 * task that changed meanwhile refuses the whole action (409) instead of being
 * overwritten. Undo expects the values the server acknowledged. Writes to the same
 * task run in order, and a failure gives back only its own fields.
 */
export function useTaskListMutations() {
  const qc = useQueryClient();
  const scope = useAuthScopeKey();
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const { addToast } = useToast();
  const [pending, setPending] = useState(0);

  /** One guarded, ordered, optimistic write. Resolves with the acknowledged tasks and the items as actually written. */
  const write = useCallback(async (items: GuardedItem[]): Promise<{ tasks: ManagerTask[]; written: GuardedItem[] }> => {
    const coordinator = taskWrites(qc, scope);
    const since = coordinator.mark();
    setPending((count) => count + 1);
    try {
      return await coordinator.run(items.map((item) => item.task.taskKey), async () => {
        if (scopeRef.current !== scope) throw new WriteAbandoned();
        // A write queued behind another on the same task acts on what the server said after it.
        const written = items.map((item) => ({ ...item, task: item.expected ? item.task : coordinator.latest(item.task.taskKey, since) ?? item.task }));
        const viewFilter = { queryKey: ['tasks', scope, 'view'] };
        await qc.cancelQueries(viewFilter);
        const rollback = patchCachedTasks(qc, viewFilter, listShape, new Map(written.map((item) => [item.task.taskKey, (row) => optimisticTask(row as unknown as ManagerTask, item.changes) as unknown as CachedTaskRow])));
        try {
          const response = await api.post<BulkUpdateTasksResponse>('/tasks/bulk', {
            items: written.map((item) => ({ key: item.task.taskKey, changes: item.changes, expected: item.expected ?? expectedFrom(item.task, item.changes) })),
          });
          coordinator.acknowledge(response.tasks);
          return { tasks: response.tasks, written };
        } catch (error) {
          rollback();
          throw error;
        } finally {
          if (scopeRef.current === scope) invalidateTaskSurfaces(qc);
        }
      });
    } finally {
      setPending((count) => count - 1);
    }
  }, [qc, scope]);

  /** The inverse of a finished write, guarded by what the server acknowledged; `null` if any answer is missing. */
  const inverseOf = useCallback((written: GuardedItem[], acknowledged: ManagerTask[]): GuardedItem[] | null => {
    const byKey = new Map(acknowledged.map((task) => [task.taskKey, task]));
    const inverse: GuardedItem[] = [];
    for (const item of written) {
      const after = byKey.get(item.task.taskKey);
      if (!after) return null;
      const changes = undoChanges(item.task, item.changes);
      inverse.push({ task: after, changes, expected: expectedFrom(after, changes) });
    }
    return inverse;
  }, []);

  const attemptUndo = useCallback(async (inverse: GuardedItem[]): Promise<UndoOutcome> => {
    try {
      await write(inverse);
      return 'undone';
    } catch (error) {
      if (error instanceof WriteAbandoned) return 'failed';
      if (isConflict(error)) {
        addToast({ type: 'error', title: UNDO_CONFLICT });
        return 'conflict';
      }
      addToast({ type: 'error', title: 'Could not update tasks', message: error instanceof Error ? error.message : undefined });
      return 'failed';
    }
  }, [addToast, write]);

  // docs/54 K5: the latest undoable write, so `z` can reverse it like Today's.
  const lastUndo = useRef<{ run: () => void; expiresAt: number } | null>(null);

  const applyWithReceipt = useCallback(
    async (items: TaskChangeItem[], options: ApplyTaskChangesOptions): Promise<TaskWriteReceipt | null> => {
      if (!items.length) return null;
      let result;
      try {
        result = await write(items);
      } catch (error) {
        if (error instanceof WriteAbandoned) return null;
        addToast({ type: 'error', title: 'Could not update tasks', message: error instanceof Error ? error.message : undefined });
        return null;
      }
      if (scopeRef.current !== scope) return null;
      const inverse = inverseOf(result.written, result.tasks);
      let inFlight: Promise<UndoOutcome> | null = null;
      let settled = false;
      const receipt: TaskWriteReceipt = {
        tasks: result.tasks,
        undo: () => {
          if (!inverse) return Promise.resolve('failed');
          if (inFlight) return inFlight;
          inFlight = attemptUndo(inverse).then((outcome) => {
            if (outcome !== 'failed') settled = true;
            inFlight = null;
            return outcome;
          });
          return inFlight;
        },
      };
      if (options.undoable === false || !inverse) return receipt;
      const expiresAt = Date.now() + UNDO_WINDOW_MS;
      const runUndo = () => {
        if (settled || inFlight) return;
        if (lastUndo.current?.run === runUndo) lastUndo.current = null;
        options.onUndo?.();
        void receipt.undo().then((outcome) => {
          // A failed attempt stays retryable (`z`) until the window closes.
          if (outcome === 'failed' && Date.now() < expiresAt) lastUndo.current = { run: runUndo, expiresAt };
        });
      };
      lastUndo.current = { run: runUndo, expiresAt };
      addToast({
        type: 'success',
        title: options.label,
        duration: UNDO_WINDOW_MS,
        action: { label: 'Undo', onClick: runUndo },
      });
      return receipt;
    },
    [addToast, attemptUndo, inverseOf, scope, write],
  );

  const apply = useCallback(
    async (items: TaskChangeItem[], options: ApplyTaskChangesOptions): Promise<boolean> => (await applyWithReceipt(items, options)) !== null,
    [applyWithReceipt],
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

  return { apply, applyWithReceipt, create, undoLast, isPending: pending > 0 };
}
