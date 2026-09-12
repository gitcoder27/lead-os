import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import * as Popover from '@radix-ui/react-popover';
import {
  AlertTriangle,
  Ban,
  BellRing,
  CalendarClock,
  CheckCircle2,
  Clock3,
  ExternalLink,
  Loader2,
  MessageSquare,
  MoreHorizontal,
  Rows3,
  Sparkles,
  Target,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useManagerActions } from '@/hooks/useManagerActions';
import { useTodayActions } from '@/hooks/useTodayActions';
import { useAlerts, useDismissAlerts } from '@/hooks/useAlerts';
import { useToast } from '@/context/ToastContext';
import { getLocalIsoDate } from '@/lib/utils';
import type {
  Alert,
  FilterType,
  ManagerActionCommand,
  ManagerActionItem,
  ManagerActionTarget,
  TodayActionItemType,
} from '@/types';
import type { AppView } from '@/App';
import { TodayCheckInDialog } from '@/components/today/TodayCheckInDialog';
import { TodayConfirmDialog } from '@/components/today/TodayConfirmDialog';
import { TodayTextCaptureDialog } from '@/components/today/TodayTextCaptureDialog';

interface ManagerActionInboxProps {
  date?: string;
  enabled?: boolean;
  onOpenTarget: (target: ManagerActionTarget) => void;
  onViewChange: (view: AppView) => void;
}

type SnoozePreset = 'later_today' | 'tomorrow' | 'next_week';

const iconByType: Record<TodayActionItemType, LucideIcon> = {
  developer_attention: Users,
  overdue_issue: AlertTriangle,
  due_issue: CalendarClock,
  unassigned_issue: Users,
  stale_check_in: MessageSquare,
  follow_up_due: BellRing,
  meeting_outcome: CalendarClock,
  desk_carry_forward: Rows3,
  manual_work: Target,
  sync_attention: AlertTriangle,
  calm: CheckCircle2,
};

export function ManagerActionInbox({
  date = getLocalIsoDate(),
  enabled = true,
  onOpenTarget,
  onViewChange,
}: ManagerActionInboxProps) {
  const [open, setOpen] = useState(false);
  const [checkInDraft, setCheckInDraft] = useState<{
    command: ManagerActionCommand;
    developerName: string;
    defaultSummary: string;
  } | null>(null);
  const [textDraft, setTextDraft] = useState<{
    command: ManagerActionCommand;
    title: string;
    description: string;
    label: string;
    defaultValue: string;
    saveLabel: string;
    multiline?: boolean;
  } | null>(null);
  const [confirmDraft, setConfirmDraft] = useState<{
    command: ManagerActionCommand;
    preset?: SnoozePreset;
  } | null>(null);
  const managerActions = useManagerActions({ date, surface: 'header', limit: 8, enabled });
  const actions = managerActions.data?.actions ?? [];
  const urgentCount = managerActions.data?.urgentCount ?? 0;
  const actionRunner = useTodayActions({ date, onOpenTarget, onViewChange });
  const { addToast } = useToast();
  const alertsQuery = useAlerts({ enabled });
  const dismissAlerts = useDismissAlerts();

  const signals = useMemo(() => {
    const alerts = alertsQuery.data ?? [];
    const shownIssueKeys = new Set(actions.map((item) => item.target.issueKey).filter(Boolean));
    const shownDeveloperIds = new Set(actions.map((item) => item.target.developerAccountId).filter(Boolean));
    return alerts.filter(
      (alert) =>
        (alert.issueKey ? !shownIssueKeys.has(alert.issueKey) : true) &&
        (alert.developerAccountId ? !shownDeveloperIds.has(alert.developerAccountId) : true)
    );
  }, [actions, alertsQuery.data]);
  const attentionCount = urgentCount + signals.length;
  const pendingTargetKey = useMemo(
    () => (actionRunner.isPending ? targetKey(actionRunner.pendingTarget) : undefined),
    [actionRunner.isPending, actionRunner.pendingTarget],
  );

  const runCommand = (command: ManagerActionCommand, preset?: SnoozePreset) => {
    setOpen(false);

    if (command.kind === 'add_check_in') {
      setCheckInDraft({
        command,
        developerName: getDeveloperName(actions, command.target),
        defaultSummary: buildDefaultCheckInSummary(actions, command.target),
      });
      return;
    }

    if (command.kind === 'capture_follow_up') {
      setTextDraft({
        command,
        title: 'Capture follow-up',
        description: 'Save a linked follow-up.',
        label: 'Follow-up title',
        defaultValue: defaultFollowUpTitle(command.target),
        saveLabel: 'Save follow-up',
      });
      return;
    }

    if (command.kind === 'capture_meeting_outcome') {
      setTextDraft({
        command,
        title: 'Capture meeting outcome',
        description: 'Close the meeting loop.',
        label: 'Meeting outcome',
        defaultValue: '',
        saveLabel: 'Save outcome',
        multiline: true,
      });
      return;
    }

    if (command.confirm) {
      setConfirmDraft({ command, preset });
      return;
    }

    actionRunner.runAction(command, { preset });
  };

  const openTarget = (target: ManagerActionTarget) => {
    setOpen(false);
    onOpenTarget(target);
  };

  const runDismiss = (alertIds: string[]) => {
    dismissAlerts.mutate(
      { alertIds },
      {
        onError: () => {
          addToast({
            type: 'error',
            title: 'Failed to update alerts',
            message: 'The alert list could not be updated. Please try again.',
          });
        },
      },
    );
  };

  const clearSignals = () => {
    if (signals.length === 0) {
      return;
    }
    runDismiss(signals.map((alert) => alert.id));
  };

  const dialogLayer = typeof document === 'undefined'
    ? null
    : createPortal(
      <>
        {checkInDraft ? (
          <TodayCheckInDialog
            developerName={checkInDraft.developerName}
            defaultSummary={checkInDraft.defaultSummary}
            isSaving={actionRunner.isPending && actionRunner.pendingKind === 'add_check_in'}
            onClose={() => setCheckInDraft(null)}
            onSave={(summary) => {
              actionRunner.runAction(checkInDraft.command, { summary });
              setCheckInDraft(null);
            }}
          />
        ) : null}
        {textDraft ? (
          <TodayTextCaptureDialog
            title={textDraft.title}
            description={textDraft.description}
            label={textDraft.label}
            defaultValue={textDraft.defaultValue}
            saveLabel={textDraft.saveLabel}
            multiline={textDraft.multiline}
            isSaving={actionRunner.isPending && actionRunner.pendingKind === textDraft.command.kind}
            onClose={() => setTextDraft(null)}
            onSave={(value) => {
              actionRunner.runAction(textDraft.command, {
                title: textDraft.command.kind === 'capture_follow_up' ? value : undefined,
                outcome: textDraft.command.kind === 'capture_meeting_outcome' ? value : undefined,
              });
              setTextDraft(null);
            }}
          />
        ) : null}
        {confirmDraft ? (
          <TodayConfirmDialog
            {...getConfirmationCopy(confirmDraft.command)}
            isSaving={actionRunner.isPending && actionRunner.pendingKind === confirmDraft.command.kind}
            onClose={() => setConfirmDraft(null)}
            onConfirm={() => {
              actionRunner.runAction(confirmDraft.command, { preset: confirmDraft.preset });
              setConfirmDraft(null);
            }}
          />
        ) : null}
      </>,
      document.body,
    );

  return (
    <>
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger asChild>
          <button
            type="button"
            className="relative flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-[var(--bg-elevated)]"
            style={{
              background: open ? 'var(--bg-elevated)' : 'transparent',
              boxShadow: open ? 'var(--soft-shadow)' : 'none',
            }}
            title={attentionCount > 0 ? `${attentionCount} need attention` : 'Manager actions'}
            aria-label="Manager actions"
          >
            {managerActions.isFetching ? (
              <Loader2 size={16} className="animate-spin" style={{ color: 'var(--text-secondary)' }} />
            ) : (
              <Sparkles size={16} style={{ color: attentionCount > 0 ? 'var(--accent)' : 'var(--text-secondary)' }} />
            )}
            {attentionCount > 0 ? (
              <span
                className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold leading-none"
                style={{
                  background: 'var(--danger)',
                  color: '#fff',
                  boxShadow: '0 0 0 2px var(--bg-secondary)',
                }}
              >
                {attentionCount > 9 ? '9+' : attentionCount}
              </span>
            ) : null}
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            align="end"
            sideOffset={10}
            className="z-[620] w-[min(calc(100vw-24px),430px)] rounded-lg border p-0 outline-none"
            style={{
              background: 'color-mix(in srgb, var(--bg-primary) 94%, transparent)',
              borderColor: 'var(--border-strong)',
              boxShadow: '0 28px 90px rgba(0,0,0,0.34), inset 0 1px 0 rgba(255,255,255,0.04)',
              backdropFilter: 'blur(18px)',
            }}
          >
            <div className="border-b px-3.5 py-3" style={{ borderColor: 'var(--border)' }}>
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>
                    Action inbox
                  </p>
                  <p className="mt-0.5 text-[11px]" style={{ color: 'var(--text-muted)' }}>
                    {managerActions.isLoading ? 'Syncing queue' : `${managerActions.data?.totalCount ?? 0} open`}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    onViewChange('today');
                  }}
                  className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[11px] font-semibold transition-colors hover:bg-[var(--bg-tertiary)]"
                  style={{ color: 'var(--accent)' }}
                >
                  Today
                  <ExternalLink size={12} />
                </button>
              </div>
            </div>

            <div className="max-h-[min(64vh,520px)] overflow-auto py-1.5">
              {managerActions.isLoading ? (
                <InboxSkeleton />
              ) : (
                <>
                  {managerActions.isError ? (
                    <InboxEmpty title="Queue unavailable" detail="Retry from Today." />
                  ) : actions.length === 0 && signals.length === 0 ? (
                    <InboxEmpty title="Clear" detail="No manager actions right now." />
                  ) : (
                    actions.map((item) => (
                      <ManagerActionInboxRow
                        key={item.id}
                        item={item}
                        isPending={pendingTargetKey === targetKey(item.target)}
                        onOpenTarget={openTarget}
                        onRunCommand={runCommand}
                      />
                    ))
                  )}
                  {signals.length > 0 ? (
                    <div className="mt-1 border-t pt-1.5" style={{ borderColor: 'var(--border)' }}>
                      <div className="flex items-center justify-between px-3 py-1">
                        <span
                          className="text-[10.5px] font-semibold uppercase tracking-[0.1em]"
                          style={{ color: 'var(--text-muted)' }}
                        >
                          Attention signals
                        </span>
                        <button
                          type="button"
                          onClick={clearSignals}
                          disabled={dismissAlerts.isPending}
                          className="rounded px-1.5 py-0.5 text-[11px] font-medium transition-colors hover:bg-[var(--bg-tertiary)] disabled:opacity-45"
                          style={{ color: 'var(--text-muted)' }}
                        >
                          Clear all
                        </button>
                      </div>
                      {signals.map((alert) => (
                        <SignalRow
                          key={alert.id}
                          alert={alert}
                          onOpen={() => {
                            setOpen(false);
                            onOpenTarget(signalTarget(alert));
                          }}
                          onDismiss={() => runDismiss([alert.id])}
                        />
                      ))}
                    </div>
                  ) : null}
                </>
              )}
            </div>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>

      {dialogLayer}
    </>
  );
}

function ManagerActionInboxRow({
  item,
  isPending,
  onOpenTarget,
  onRunCommand,
}: {
  item: ManagerActionItem;
  isPending: boolean;
  onOpenTarget: (target: ManagerActionTarget) => void;
  onRunCommand: (command: ManagerActionCommand, preset?: SnoozePreset) => void;
}) {
  const Icon = iconByType[item.type] ?? Target;
  const tone = actionTone(item.severity);

  return (
    <div
      className="mx-1.5 grid grid-cols-[30px_minmax(0,1fr)_auto_auto] items-center gap-2 rounded-lg px-2 py-2 transition-colors hover:bg-[var(--bg-tertiary)]"
      style={{ boxShadow: 'inset 0 -1px 0 color-mix(in srgb, var(--border) 42%, transparent)' }}
    >
      <button
        type="button"
        onClick={() => onOpenTarget(item.target)}
        className="flex h-7 w-7 items-center justify-center rounded-md"
        style={{ background: tone.bg, color: tone.color, border: `1px solid ${tone.border}` }}
        aria-label={`Open ${item.title}`}
      >
        <Icon size={14} />
      </button>

      <button type="button" onClick={() => onOpenTarget(item.target)} className="min-w-0 text-left">
        <span className="block truncate text-[12.5px] font-semibold" style={{ color: 'var(--text-primary)' }}>
          {item.title}
        </span>
        <span className="mt-0.5 block truncate text-[11px]" style={{ color: 'var(--text-muted)' }}>
          {item.signal}
        </span>
      </button>

      <button
        type="button"
        onClick={() => onRunCommand(item.primaryAction)}
        disabled={isPending}
        className="h-7 rounded-md px-2 text-[11px] font-semibold transition-colors hover:bg-[var(--bg-elevated)] disabled:opacity-45"
        style={{ color: 'var(--accent)' }}
      >
        {isPending ? 'Working' : item.primaryAction.label}
      </button>

      <details className="relative">
        <summary
          className="flex h-7 w-7 cursor-pointer list-none items-center justify-center rounded-md transition-colors hover:bg-[var(--bg-elevated)] [&::-webkit-details-marker]:hidden"
          aria-label="More actions"
        >
          <MoreHorizontal size={14} style={{ color: 'var(--text-secondary)' }} />
        </summary>
        <div
          className="absolute right-0 top-8 z-[630] min-w-[148px] overflow-hidden rounded-lg border py-1"
          style={{
            background: 'var(--bg-primary)',
            borderColor: 'var(--border-strong)',
            boxShadow: 'var(--shadow-lg)',
          }}
        >
          {item.secondaryActions.length > 0 ? (
            item.secondaryActions.map((action) => (
              action.kind === 'snooze' ? (
                <SnoozeActions key={`${action.kind}-${action.label}`} action={action} onRunCommand={onRunCommand} />
              ) : (
                <button
                  key={`${action.kind}-${action.label}`}
                  type="button"
                  onClick={() => onRunCommand(action)}
                  className="block w-full px-3 py-2 text-left text-[12px] font-medium transition-colors hover:bg-[var(--bg-tertiary)]"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  {action.label}
                </button>
              )
            ))
          ) : (
            <button
              type="button"
              onClick={() => onOpenTarget(item.target)}
              className="block w-full px-3 py-2 text-left text-[12px] font-medium transition-colors hover:bg-[var(--bg-tertiary)]"
              style={{ color: 'var(--text-secondary)' }}
            >
              Open
            </button>
          )}
        </div>
      </details>
    </div>
  );
}

function SnoozeActions({
  action,
  onRunCommand,
}: {
  action: ManagerActionCommand;
  onRunCommand: (command: ManagerActionCommand, preset?: SnoozePreset) => void;
}) {
  return (
    <div className="border-y py-1" style={{ borderColor: 'var(--border)' }}>
      {[
        ['later_today', 'Later today'],
        ['tomorrow', 'Tomorrow'],
        ['next_week', 'Next week'],
      ].map(([preset, label]) => (
        <button
          key={preset}
          type="button"
          onClick={() => onRunCommand(action, preset as SnoozePreset)}
          className="block w-full px-3 py-1.5 text-left text-[12px] font-medium transition-colors hover:bg-[var(--bg-tertiary)]"
          style={{ color: 'var(--text-secondary)' }}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

const signalMeta = {
  overdue: { icon: AlertTriangle, label: 'Overdue' },
  stale: { icon: Clock3, label: 'Stale' },
  blocked: { icon: Ban, label: 'Blocked' },
  idle_developer: { icon: Users, label: 'No work today' },
  high_priority_not_started: { icon: AlertTriangle, label: 'High priority' },
} satisfies Record<Alert['type'], { icon: LucideIcon; label: string }>;

const signalFilterByType: Partial<Record<Alert['type'], FilterType>> = {
  overdue: 'overdue',
  blocked: 'blocked',
  stale: 'stale',
  high_priority_not_started: 'highPriority',
};

function signalTarget(alert: Alert): ManagerActionTarget {
  if (alert.issueKey) {
    return {
      type: 'issue',
      view: 'work',
      issueKey: alert.issueKey,
      filter: signalFilterByType[alert.type],
    };
  }
  return {
    type: 'developer',
    view: 'team',
    developerAccountId: alert.developerAccountId,
  };
}

function SignalRow({
  alert,
  onOpen,
  onDismiss,
}: {
  alert: Alert;
  onOpen: () => void;
  onDismiss: () => void;
}) {
  const meta = signalMeta[alert.type];
  const Icon = meta.icon;
  const tone = actionTone(alert.severity === 'high' ? 'critical' : 'warning');
  const detail = [meta.label, alert.issueKey ?? alert.developerName].filter(Boolean).join(' · ');

  return (
    <div
      className="mx-1.5 grid grid-cols-[30px_minmax(0,1fr)_auto] items-center gap-2 rounded-lg px-2 py-2 transition-colors hover:bg-[var(--bg-tertiary)]"
      style={{ boxShadow: 'inset 0 -1px 0 color-mix(in srgb, var(--border) 42%, transparent)' }}
    >
      <button
        type="button"
        onClick={onOpen}
        className="flex h-7 w-7 items-center justify-center rounded-md"
        style={{ background: tone.bg, color: tone.color, border: `1px solid ${tone.border}` }}
        aria-label={`Open ${meta.label} signal`}
      >
        <Icon size={14} />
      </button>

      <button type="button" onClick={onOpen} className="min-w-0 text-left">
        <span className="block truncate text-[12.5px] font-semibold" style={{ color: 'var(--text-primary)' }}>
          {alert.message}
        </span>
        <span className="mt-0.5 block truncate text-[11px]" style={{ color: 'var(--text-muted)' }}>
          {detail}
        </span>
      </button>

      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onDismiss();
        }}
        className="flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-[var(--bg-elevated)]"
        style={{ color: 'var(--text-muted)' }}
        aria-label={`Dismiss ${meta.label} signal`}
        title="Dismiss signal"
      >
        <X size={13} />
      </button>
    </div>
  );
}

function InboxSkeleton() {
  return (
    <div className="space-y-1.5 px-3 py-2">
      {[0, 1, 2].map((item) => (
        <div key={item} className="h-12 animate-pulse rounded-lg" style={{ background: 'var(--bg-tertiary)' }} />
      ))}
    </div>
  );
}

function InboxEmpty({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="px-5 py-8 text-center">
      <div
        className="mx-auto flex h-9 w-9 items-center justify-center rounded-lg"
        style={{
          background: 'color-mix(in srgb, var(--success) 12%, transparent)',
          color: 'var(--success)',
          border: '1px solid color-mix(in srgb, var(--success) 22%, var(--border))',
        }}
      >
        <CheckCircle2 size={16} />
      </div>
      <p className="mt-3 text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>
        {title}
      </p>
      <p className="mt-1 text-[11px]" style={{ color: 'var(--text-muted)' }}>
        {detail}
      </p>
    </div>
  );
}

function targetKey(target?: ManagerActionTarget): string | undefined {
  if (!target) {
    return undefined;
  }
  return [
    target.type,
    target.issueKey,
    target.developerAccountId,
    target.managerDeskItemId,
    target.trackerItemId,
  ].filter(Boolean).join(':');
}

function getDeveloperName(actions: ManagerActionItem[], target: ManagerActionTarget): string {
  if (!target.developerAccountId) {
    return 'developer';
  }

  const actionMatch = actions.find((item) => item.target.developerAccountId === target.developerAccountId);
  return actionMatch?.title ?? 'developer';
}

function buildDefaultCheckInSummary(actions: ManagerActionItem[], target: ManagerActionTarget): string {
  if (!target.developerAccountId) {
    return '';
  }

  const actionMatch = actions.find((item) => item.target.developerAccountId === target.developerAccountId);
  if (!actionMatch || actionMatch.type === 'calm') {
    return '';
  }

  return `Manager check-in: ${actionMatch.signal}`;
}

function defaultFollowUpTitle(target: ManagerActionTarget): string {
  if (target.issueKey) {
    return `Follow up on ${target.issueKey}`;
  }
  if (target.developerAccountId) {
    return 'Follow up with developer';
  }
  return 'Follow up';
}

function getConfirmationCopy(command: ManagerActionCommand): {
  title: string;
  description: string;
  confirmLabel: string;
} {
  if (command.kind === 'mark_done') {
    return {
      title: 'Mark done?',
      description: 'This will mark the Manager Desk item done.',
      confirmLabel: 'Mark done',
    };
  }

  if (command.kind === 'carry_forward') {
    return {
      title: 'Carry forward?',
      description: 'This will move the item into today.',
      confirmLabel: 'Carry forward',
    };
  }

  return {
    title: 'Confirm action?',
    description: `Run "${command.label}".`,
    confirmLabel: command.label,
  };
}

function actionTone(severity: ManagerActionItem['severity']): { bg: string; border: string; color: string } {
  if (severity === 'critical') {
    return {
      bg: 'color-mix(in srgb, var(--danger) 11%, transparent)',
      border: 'color-mix(in srgb, var(--danger) 24%, var(--border))',
      color: 'var(--danger)',
    };
  }
  if (severity === 'warning') {
    return {
      bg: 'color-mix(in srgb, var(--warning) 11%, transparent)',
      border: 'color-mix(in srgb, var(--warning) 24%, var(--border))',
      color: 'var(--warning)',
    };
  }
  if (severity === 'success') {
    return {
      bg: 'color-mix(in srgb, var(--success) 11%, transparent)',
      border: 'color-mix(in srgb, var(--success) 24%, var(--border))',
      color: 'var(--success)',
    };
  }
  return {
    bg: 'color-mix(in srgb, var(--accent) 9%, transparent)',
    border: 'color-mix(in srgb, var(--accent) 18%, var(--border))',
    color: 'var(--accent)',
  };
}
