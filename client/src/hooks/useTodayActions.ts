import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useToast } from '@/context/ToastContext';
import type {
  ManagerActionCommandResponse,
  TodayActionCommand,
  TodayActionTarget,
  TodayResponse,
} from '@/types';

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
};

// docs/53 P4: navigation commands never hit the mutation pipeline — they just
// open the target, so they can't invalidate/cancel the destination page's
// fetches or flash a "Working" state.
const NAVIGATION_KINDS = new Set<TodayActionCommand['kind']>(['open', 'assign_owner', 'ask_check_in']);

function isNavigationCommand(command: TodayActionCommand): boolean {
  return NAVIGATION_KINDS.has(command.kind);
}

export function useTodayActions({ date, onOpenTarget }: UseTodayActionsOptions) {
  const qc = useQueryClient();
  const { addToast } = useToast();

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
      return {
        ...current,
        currentPriority: current.currentPriority && matchesTarget(current.currentPriority.target)
          ? actionItems[0]
          : current.currentPriority,
        actionItems,
        promises: current.promises.filter((item) => !matchesTarget(item.target)),
        meetingPrompts: current.meetingPrompts.filter((item) => !matchesTarget(item.target)),
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

  const mutation = useMutation({
    mutationFn: async ({ command, outcome, preset, summary, title, taskKeys }: TodayActionVariables) => {
      const { target } = command;

      if (command.kind === 'mark_done' && target.managerDeskItemId) {
        return api.post<ManagerActionCommandResponse>('/manager-actions/commands', { date, command });
      }

      if (command.kind === 'snooze' && target.managerDeskItemId) {
        return api.post<ManagerActionCommandResponse>('/manager-actions/commands', { date, command, preset });
      }

      if (command.kind === 'add_check_in' && target.developerAccountId) {
        if (!summary?.trim()) {
          return { cancelled: true };
        }
        return api.post<ManagerActionCommandResponse>('/manager-actions/commands', { date, command, summary: summary.trim(), taskKeys });
      }

      if (command.kind === 'set_current_work' && target.trackerItemId) {
        return api.post<ManagerActionCommandResponse>('/manager-actions/commands', { date, command });
      }

      if (command.kind === 'capture_follow_up') {
        if (!title?.trim()) {
          return { cancelled: true };
        }
        return api.post<ManagerActionCommandResponse>('/manager-actions/commands', { date, command, title: title.trim(), preset });
      }

      if (command.kind === 'carry_forward' && target.managerDeskItemId) {
        return api.post<ManagerActionCommandResponse>('/manager-actions/commands', { date, command });
      }

      if (command.kind === 'capture_meeting_outcome' && target.managerDeskItemId) {
        if (!outcome?.trim()) {
          return { cancelled: true };
        }
        return api.post<ManagerActionCommandResponse>('/manager-actions/commands', { date, command, outcome: outcome.trim() });
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
    },
    onSuccess: (result, variables) => {
      if (isActionResult(result, 'cancelled')) {
        return;
      }
      invalidateToday();
      if (isActionResult(result, 'skipToast')) {
        return;
      }
      addToast(actionToastTitle(variables.command.kind), 'success');
    },
    onError: (error) => {
      invalidateToday();
      addToast(error.message, 'error');
    },
  });

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
    isPending: mutation.isPending,
    pendingKind: mutation.variables?.command.kind,
    pendingTarget: mutation.variables?.command.target,
  };
}

function isActionResult(result: unknown, key: 'cancelled' | 'skipToast'): boolean {
  return Boolean(result && typeof result === 'object' && key in result);
}

function actionToastTitle(kind: TodayActionCommand['kind']): string {
  if (kind === 'mark_done') return 'Marked done';
  if (kind === 'snooze') return 'Snoozed';
  if (kind === 'add_check_in') return 'Check-in added';
  if (kind === 'capture_follow_up') return 'Follow-up captured';
  if (kind === 'carry_forward') return 'Carried forward';
  if (kind === 'capture_meeting_outcome') return 'Outcome captured';
  if (kind === 'set_current_work') return 'Current work set';
  return 'Updated';
}
