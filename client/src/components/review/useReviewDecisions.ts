import { useCallback, useRef, useState } from 'react';
import { useTaskListMutations } from '@/hooks/useTaskListMutations';
import { optimisticTask, undoChanges } from '@/lib/task-list';
import type { DecisionChoice } from '@/lib/weekly-review-decisions';
import type { ReviewDecision } from '@/lib/weekly-review';
import type { SaveWeeklyReviewRequest, WeeklyReviewTaskRow } from '@/types';

/**
 * docs/60 WR-04: decisions on tasks in the review. A decision is a normal task write (the Tasks
 * bulk endpoint, so Today and Tasks stay current), applied at once in the row and saved on the
 * week's record. It is not toasted: the row says what happened, and Undo is on the row and on `z`.
 * A failed write puts the row back to undecided (the write hook raises the persistent error toast).
 */
export function useReviewDecisions({
  patch,
  announce,
}: {
  patch: (change: SaveWeeklyReviewRequest) => void;
  announce: (message: string) => void;
}) {
  const { apply } = useTaskListMutations();
  const [decisions, setDecisions] = useState<ReadonlyMap<string, ReviewDecision>>(() => new Map());
  // Most recent last: `z` walks it backwards.
  const stack = useRef<string[]>([]);
  const busy = useRef(new Set<string>());

  const clear = useCallback((taskKey: string) => {
    setDecisions((current) => {
      const next = new Map(current);
      next.delete(taskKey);
      return next;
    });
    stack.current = stack.current.filter((key) => key !== taskKey);
    patch({ decisions: { [taskKey]: null } });
  }, [patch]);

  const decide = useCallback((row: WeeklyReviewTaskRow, choice: DecisionChoice) => {
    const taskKey = row.taskKey;
    if (busy.current.has(taskKey)) return;
    busy.current.add(taskKey);
    setDecisions((current) => new Map(current).set(taskKey, { taskKey, row, choice }));
    stack.current.push(taskKey);
    patch({ decisions: { [taskKey]: choice.action } });
    announce(`${choice.announce} Press z to undo.`);
    void apply([{ task: row, changes: choice.changes }], { label: choice.label, undoable: false }).then((ok) => {
      busy.current.delete(taskKey);
      if (!ok) {
        clear(taskKey);
        announce("Couldn't save that change. The task is unchanged.");
      }
    });
  }, [announce, apply, clear, patch]);

  const undoDecision = useCallback((taskKey: string) => {
    const decision = decisions.get(taskKey);
    if (!decision || busy.current.has(taskKey)) return;
    busy.current.add(taskKey);
    const { row, choice } = decision;
    clear(taskKey);
    announce('Undone.');
    void apply(
      [{ task: optimisticTask(row, choice.changes), changes: undoChanges(row, choice.changes) }],
      { label: 'Undone', undoable: false },
    ).then((ok) => {
      busy.current.delete(taskKey);
      // The inverse failed: the task still carries the decision, so show it as decided again.
      if (!ok) {
        setDecisions((current) => new Map(current).set(taskKey, decision));
        stack.current.push(taskKey);
        patch({ decisions: { [taskKey]: choice.action } });
      }
    });
  }, [announce, apply, clear, decisions, patch]);

  /** `z`: take back the latest decision; false when there is none. */
  const undoLast = useCallback((): boolean => {
    const taskKey = stack.current[stack.current.length - 1];
    if (!taskKey) return false;
    undoDecision(taskKey);
    return true;
  }, [undoDecision]);

  return { decisions, decide, undoDecision, undoLast };
}
