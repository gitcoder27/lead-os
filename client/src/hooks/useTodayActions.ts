import { useCallback, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useToast } from '@/context/ToastContext';
import { getLocalTimeZone } from '@/lib/utils';
import type {
  ManagerActionCommandRequest,
  ManagerActionCommandResponse,
  ManagerActionUndo,
  TodayActionCommand,
  TodayActionTarget,
  TodayResponse,
} from '@/types';
import { UNDO_WINDOW_MS } from '@/lib/undo';

interface UseTodayActionsOptions {
  date: string;
  onOpenTarget: (target: TodayActionTarget) => void;
}

type TodayActionVariables = {
  command: TodayActionCommand;
  title?: string;
  outcome?: string;
  preset?: 'later_today' | 'tomorrow' | 'next_week';
  summary?: string;
  taskKeys?: string[];
  /** docs/53 F14: optional follow-up created with a meeting outcome. */
  nextAction?: string;
  nextActionOwnerAccountId?: string;
};

/** docs/53 F11: matches the /tasks Undo window. */
export const TODAY_UNDO_WINDOW_MS = UNDO_WINDOW_MS;

// docs/53 P4: navigation commands never hit the mutation pipeline — they just
// open the target, so they can't invalidate/cancel the destination page's
// fetches or flash a "Working" state.
const NAVIGATION_KINDS = new Set<TodayActionCommand['kind']>(['open', 'assign_owner']);

function isNavigationCommand(command: TodayActionCommand): boolean {
  return NAVIGATION_KINDS.has(command.kind);
}

/** One Undo can reverse a whole bulk write (Carry all, Ask all). */
type PendingUndo = { undos: ManagerActionUndo[]; title: string; expiresAt: number };

export function useTodayActions({ date, onOpenTarget }: UseTodayActionsOptions) {
  const qc = useQueryClient();
  const { addToast } = useToast();
  // docs/53 U4: `z` undoes the most recent write still inside its window.
  const undoStack = useRef<PendingUndo[]>([]);

  const invalidateToday = () => {
    qc.invalidateQueries({ queryKey: ['today'] });
    qc.invalidateQueries({ queryKey: ['manager-actions'] });
    qc.invalidateQueries({ queryKey: ['manager-desk'] });
    qc.invalidateQueries({ queryKey: ['team-tracker'] });
    qc.invalidateQueries({ queryKey: ['workload'] });
  };

  const removeTargetOptimistically = (target: TodayActionTarget) => {
    qc.setQueriesData<TodayResponse>({ queryKey: ['today', date] }, (current) => {
      if (!current) {
        return current;
      }

      const matchesTarget = (itemTarget: TodayActionTarget) =>
        itemTarget.managerDeskItemId === target.managerDeskItemId &&
        itemTarget.developerAccountId === target.developerAccountId &&
        itemTarget.issueKey === target.issueKey &&
        itemTarget.trackerItemId === target.trackerItemId &&
        itemTarget.type === target.type;

      const actionItems = current.actionItems.filter((item) => !matchesTarget(item.target));
      const removed = current.actionItems.length - actionItems.length;
      return {
        ...current,
        currentPriority: current.currentPriority && matchesTarget(current.currentPriority.target)
          ? actionItems[0]
          : current.currentPriority,
        actionItems,
        overflowActionItems: current.overflowActionItems?.filter((item) => !matchesTarget(item.target)),
        totalCount: current.totalCount === undefined ? undefined : Math.max(current.totalCount - removed, 0),
        promises: current.promises.filter((item) => !matchesTarget(item.target)),
        meetingPrompts: current.meetingPrompts.filter((item) => !matchesTarget(item.target)),
      };
    });
  };

  const markAskedOptimistically = (target: TodayActionTarget) => {
    const accountId = target.developerAccountId;
    if (!accountId) {
      return;
    }
    const askedAt = new Date().toISOString();
    qc.setQueriesData<TodayResponse>({ queryKey: ['today', date] }, (current) => {
      if (!current) {
        return current;
      }
      const withoutAsk = <T extends { secondaryActions: TodayActionCommand[] }>(entry: T): T => ({
        ...entry,
        secondaryActions: entry.secondaryActions.filter((action) => action.kind !== 'ask_check_in'),
      });
      return {
        ...current,
        actionItems: current.actionItems.map((item) =>
          item.target.developerAccountId === accountId ? { ...withoutAsk(item), askedAt } : item,
        ),
        teamPulse: current.teamPulse.map((person) =>
          person.accountId === accountId ? { ...withoutAsk(person), askedAt } : person,
        ),
      };
    });
  };

  const completeDeveloperCheckInOptimistically = (target: TodayActionTarget) => {
    if (!target.developerAccountId) {
      return;
    }

    qc.setQueriesData<TodayResponse>({ queryKey: ['today', date] }, (current) => {
      if (!current) {
        return current;
      }

      const matchesDeveloper = (itemTarget: TodayActionTarget) =>
        itemTarget.developerAccountId === target.developerAccountId;
      const openCommand = (label: string): TodayActionCommand => ({
        kind: 'open',
        label,
        target: {
          ...target,
          type: 'developer',
          view: 'team',
        },
      });
      const updateActionItem = (item: TodayResponse['actionItems'][number]) => {
        if (!matchesDeveloper(item.target) || item.primaryAction.kind !== 'add_check_in') {
          return item;
        }
        return {
          ...item,
          target: openCommand('Open developer').target,
          primaryAction: openCommand('Open developer'),
        };
      };

      return {
        ...current,
        currentPriority: current.currentPriority ? updateActionItem(current.currentPriority) : current.currentPriority,
        actionItems: current.actionItems.map(updateActionItem),
        teamPulse: current.teamPulse.map((person) => {
          if (person.accountId !== target.developerAccountId || person.primaryAction.kind !== 'add_check_in') {
            return person;
          }
          return {
            ...person,
            target: openCommand('Open').target,
            primaryAction: openCommand('Open'),
            lastUpdate: 'Just now',
          };
        }),
        standupPrompts: current.standupPrompts.map((prompt) => {
          if (!matchesDeveloper(prompt.target) || prompt.primaryAction.kind !== 'add_check_in') {
            return prompt;
          }
          return {
            ...prompt,
            target: openCommand('Open developer').target,
            primaryAction: openCommand('Open developer'),
          };
        }),
      };
    });
  };

  const postCommand = (body: Omit<ManagerActionCommandRequest, 'date' | 'tz'> & { date?: string }) =>
    api.post<ManagerActionCommandResponse>('/manager-actions/commands', {
      date,
      tz: getLocalTimeZone(),
      ...body,
    });

  const mutation = useMutation({
    mutationFn: async ({ command, outcome, preset, summary, title, taskKeys, nextAction, nextActionOwnerAccountId }: TodayActionVariables) => {
      const { target } = command;

      if (command.kind === 'mark_done' && target.managerDeskItemId) {
        return postCommand({ command });
      }

      if (command.kind === 'snooze' && target.managerDeskItemId) {
        return postCommand({ command, preset });
      }

      if (command.kind === 'add_check_in' && target.developerAccountId) {
        if (!summary?.trim()) {
          return { cancelled: true };
        }
        return postCommand({ command, summary: summary.trim(), taskKeys });
      }

      // docs/53 F15: "Ask for update" is a write — a check-in request task on
      // the developer's My Day plus an asked-at stamp on their row.
      if (command.kind === 'ask_check_in' && target.developerAccountId) {
        return postCommand({ command, title: title?.trim() || undefined });
      }

      if (command.kind === 'set_current_work' && target.trackerItemId) {
        return postCommand({ command });
      }

      if (command.kind === 'capture_follow_up') {
        if (!title?.trim()) {
          return { cancelled: true };
        }
        return postCommand({ command, title: title.trim(), preset });
      }

      if (command.kind === 'carry_forward' && target.managerDeskItemId) {
        return postCommand({ command });
      }

      if (command.kind === 'capture_meeting_outcome' && target.managerDeskItemId) {
        if (!outcome?.trim()) {
          return { cancelled: true };
        }
        return postCommand({
          command,
          outcome: outcome.trim(),
          nextAction: nextAction?.trim() || undefined,
          nextActionOwnerAccountId: nextAction?.trim() ? nextActionOwnerAccountId || undefined : undefined,
        });
      }

      onOpenTarget(target);
      return { label: command.label, skipToast: true };
    },
    onMutate: async ({ command, summary }) => {
      // docs/53 P5: every mutating kind cancels the in-flight Today poll so a
      // stale response can't overwrite the optimistic write.
      await qc.cancelQueries({ queryKey: ['today', date] });
      if (
        command.kind === 'mark_done' ||
        command.kind === 'snooze' ||
        command.kind === 'carry_forward' ||
        command.kind === 'capture_meeting_outcome' ||
        command.kind === 'set_current_work'
      ) {
        removeTargetOptimistically(command.target);
      }
      if (command.kind === 'add_check_in' && summary?.trim()) {
        completeDeveloperCheckInOptimistically(command.target);
      }
      if (command.kind === 'ask_check_in') {
        markAskedOptimistically(command.target);
      }
    },
    onSuccess: (result, variables) => {
      if (isActionResult(result, 'cancelled')) {
        return;
      }
      invalidateToday();
      if (isActionResult(result, 'skipToast')) {
        return;
      }
      const title = actionToastTitle(variables.command);
      const undo = (result as ManagerActionCommandResponse).undo;
      if (undo) {
        offerUndo([undo], title);
        return;
      }
      addToast(title, 'success');
    },
    onError: (error) => {
      invalidateToday();
      addToast(error.message, 'error');
    },
  });

  const runUndo = useCallback(async (entry: PendingUndo) => {
    undoStack.current = undoStack.current.filter((candidate) => candidate !== entry);
    await qc.cancelQueries({ queryKey: ['today', date] });
    try {
      // Reverse order, so a bulk write unwinds last-in first-out.
      for (const undo of [...entry.undos].reverse()) {
        await api.post<ManagerActionCommandResponse>('/manager-actions/commands', {
          tz: getLocalTimeZone(),
          ...undo.request,
        });
      }
      addToast('Undone', 'success');
    } catch (error) {
      addToast({ type: 'error', title: 'Could not undo', message: error instanceof Error ? error.message : undefined });
    } finally {
      invalidateToday();
    }
  }, [addToast, date, qc]);

  function offerUndo(undos: ManagerActionUndo[], title: string) {
    if (undos.length === 0) {
      addToast(title, 'success');
      return;
    }
    const entry: PendingUndo = { undos, title, expiresAt: Date.now() + TODAY_UNDO_WINDOW_MS };
    undoStack.current = [...pruneExpired(undoStack.current), entry];
    addToast({
      type: 'success',
      title,
      duration: TODAY_UNDO_WINDOW_MS,
      action: { label: 'Undo', onClick: () => void runUndo(entry) },
    });
  }

  /**
   * Bulk writes ("Carry all", "Ask all"): optimistic for every row, posted
   * one by one, then a single toast whose Undo reverses them all. Stops at
   * the first failure and reports how many landed.
   */
  const runBulk = async (commands: TodayActionCommand[], title: (count: number) => string) => {
    if (commands.length === 0) return;
    await qc.cancelQueries({ queryKey: ['today', date] });
    for (const command of commands) {
      if (command.kind === 'ask_check_in') markAskedOptimistically(command.target);
      else removeTargetOptimistically(command.target);
    }
    const undos: ManagerActionUndo[] = [];
    let done = 0;
    try {
      for (const command of commands) {
        const response = await postCommand({ command });
        if (response.undo) undos.push(response.undo);
        done += 1;
      }
      offerUndo(undos, title(done));
    } catch (error) {
      addToast({
        type: 'error',
        title: done > 0 ? `${title(done)} — then stopped` : 'Could not complete',
        message: error instanceof Error ? error.message : undefined,
      });
      if (undos.length) offerUndo(undos, title(done));
    } finally {
      invalidateToday();
    }
  };

  /** docs/53 U4 `z`: undo the latest write still inside its window. */
  const undoLast = useCallback((): boolean => {
    undoStack.current = pruneExpired(undoStack.current);
    const latest = undoStack.current[undoStack.current.length - 1];
    if (!latest) {
      return false;
    }
    void runUndo(latest);
    return true;
  }, [runUndo]);

  const runAction = (command: TodayActionCommand, options: Omit<TodayActionVariables, 'command'> = {}) => {
    if (isNavigationCommand(command)) {
      onOpenTarget(command.target);
      return;
    }
    mutation.mutate({ command, ...options });
  };

  // docs/53 F9: dialogs await the action so they can stay open with an inline
  // error when the write fails instead of silently discarding input.
  const runActionAsync = async (command: TodayActionCommand, options: Omit<TodayActionVariables, 'command'> = {}) => {
    if (isNavigationCommand(command)) {
      onOpenTarget(command.target);
      return;
    }
    await mutation.mutateAsync({ command, ...options });
  };

  return {
    runAction,
    runActionAsync,
    runBulk,
    undoLast,
    isPending: mutation.isPending,
    pendingKind: mutation.variables?.command.kind,
    pendingTarget: mutation.variables?.command.target,
  };
}

function pruneExpired(entries: PendingUndo[], now = Date.now()): PendingUndo[] {
  return entries.filter((entry) => entry.expiresAt > now);
}

function isActionResult(result: unknown, key: 'cancelled' | 'skipToast'): boolean {
  return Boolean(result && typeof result === 'object' && key in result);
}

function actionToastTitle({ kind, label }: Pick<TodayActionCommand, 'kind' | 'label'>): string {
  if (kind === 'mark_done') return 'Marked done';
  if (kind === 'snooze') return 'Snoozed';
  // docs/56 P1-04: Today relabels the command "Add note" for people who do not check in.
  if (kind === 'add_check_in') return /note/i.test(label) ? 'Note added' : 'Check-in added';
  if (kind === 'ask_check_in') return 'Asked for an update';
  if (kind === 'capture_follow_up') return 'Follow-up captured';
  if (kind === 'carry_forward') return 'Carried forward';
  if (kind === 'capture_meeting_outcome') return 'Outcome captured';
  if (kind === 'set_current_work') return 'Current work set';
  return 'Updated';
}
