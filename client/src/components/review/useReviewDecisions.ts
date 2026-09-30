import { useCallback, useRef, useState } from 'react';
import { useTaskListMutations, type TaskWriteReceipt } from '@/hooks/useTaskListMutations';
import type { DecisionChoice } from '@/lib/weekly-review-decisions';
import type { ReviewDecision } from '@/lib/weekly-review';
import type { SaveWeeklyReviewRequest, WeeklyReviewTaskRow } from '@/types';

/**
 * docs/60 WR-04: decisions on tasks in the review. A decision is a normal task write (the Tasks
 * bulk endpoint, so Today and Tasks stay current), applied at once in the row and saved on the
 * week's record. It is not toasted: the row says what happened, and Undo is on the row and on `z`.
 * A failed write puts the row back to undecided (the write hook raises the persistent error toast).
 * docs/61 TS-01: Undo is the write's own guarded receipt. The decision stays until the inverse
 * succeeds; if a task changed meanwhile the inverse is refused as a whole and the decision remains.
 */
export function useReviewDecisions({
  patch,
  announce,
}: {
  patch: (change: SaveWeeklyReviewRequest) => void;
  announce: (message: string) => void;
}) {
  const { applyWithReceipt } = useTaskListMutations();
  const [decisions, setDecisions] = useState<ReadonlyMap<string, ReviewDecision>>(() => new Map());
  // Most recent last: `z` walks it backwards.
  const stack = useRef<string[]>([]);
  const busy = useRef(new Set<string>());
  // The acknowledged write behind each decision, kept for the length of the session.
  const receipts = useRef(new Map<string, TaskWriteReceipt>());

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
    void applyWithReceipt([{ task: row, changes: choice.changes }], { label: choice.label, undoable: false }).then((receipt) => {
      busy.current.delete(taskKey);
      if (receipt) {
        receipts.current.set(taskKey, receipt);
        return;
      }
      clear(taskKey);
      announce("Couldn't save that change. The task is unchanged.");
    });
  }, [announce, applyWithReceipt, clear, patch]);

  const undoDecision = useCallback((taskKey: string) => {
    const receipt = receipts.current.get(taskKey);
    if (!decisions.has(taskKey) || !receipt || busy.current.has(taskKey)) return;
    busy.current.add(taskKey);
    void receipt.undo().then((outcome) => {
      busy.current.delete(taskKey);
      if (outcome === 'undone') {
        receipts.current.delete(taskKey);
        clear(taskKey);
        announce('Undone.');
      } else if (outcome === 'conflict') {
        announce("Couldn't undo: the task changed since this decision. Nothing was undone.");
      } else {
        announce("Couldn't undo. The decision stands. Try again.");
      }
    });
  }, [announce, clear, decisions]);

  /** `z`: take back the latest decision; false when there is none. */
  const undoLast = useCallback((): boolean => {
    const taskKey = stack.current[stack.current.length - 1];
    if (!taskKey) return false;
    undoDecision(taskKey);
    return true;
  }, [undoDecision]);

  return { decisions, decide, undoDecision, undoLast };
}
