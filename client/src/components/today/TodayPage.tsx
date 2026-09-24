import { useMemo, useState } from 'react';
import type { AppView } from '@/App';
import { useToday } from '@/hooks/useToday';
import { useTodayActions } from '@/hooks/useTodayActions';
import { useTeamTracker } from '@/hooks/useTeamTracker';
import { tasksFromItems } from '@/components/tasks/TaskPicker';
import { getLocalIsoDate } from '@/lib/utils';
import type { FilterType, TodayActionCommand, TodayActionTarget, TodayResponse } from '@/types';
import { TodayActionQueue } from './TodayActionQueue';
import { TodayCheckInDialog } from './TodayCheckInDialog';
import { TodayCommandFooter } from './TodayCommandFooter';
import { TodayConfirmDialog } from './TodayConfirmDialog';
import { TodayCurrentPriority } from './TodayCurrentPriority';
import { TodayPeoplePulse } from './TodayPeoplePulse';
import { TodayRhythmHeader } from './TodayRhythmHeader';
import { TodayRhythmRail } from './TodayRhythmRail';
import { TodayTextCaptureDialog } from './TodayTextCaptureDialog';

interface TodayPageProps {
  onViewChange: (view: AppView) => void;
  onSelectWorkFilter?: (filter: FilterType) => void;
  onOpenTodayTarget?: (target: TodayActionTarget) => void;
}

export function TodayPage({ onViewChange, onSelectWorkFilter, onOpenTodayTarget }: TodayPageProps) {
  const date = getLocalIsoDate();
  const [checkInDraft, setCheckInDraft] = useState<{
    command: TodayActionCommand;
    developerName: string;
    defaultSummary: string;
  } | null>(null);
  const [textDraft, setTextDraft] = useState<{
    command: TodayActionCommand;
    title: string;
    description: string;
    label: string;
    defaultValue: string;
    saveLabel: string;
    multiline?: boolean;
  } | null>(null);
  const [confirmDraft, setConfirmDraft] = useState<{
    command: TodayActionCommand;
    preset?: 'later_today' | 'tomorrow' | 'next_week';
  } | null>(null);
  const today = useToday(date);
  const snapshot = today.data;
  // Only fetch the board while the check-in dialog is open — it provides the
  // developer's current/planned tasks for the task picker.
  const checkInBoard = useTeamTracker(date, undefined, Boolean(checkInDraft));
  const checkInTasks = useMemo(() => {
    const devDay = checkInBoard.data?.developers?.find(
      (developerDay) => developerDay.developer.accountId === checkInDraft?.command.target.developerAccountId,
    );
    return tasksFromItems(devDay?.currentItem ? [devDay.currentItem] : undefined, devDay?.plannedItems);
  }, [checkInBoard.data, checkInDraft]);

  const openTarget = (target: TodayActionTarget) => {
    if (onOpenTodayTarget) {
      onOpenTodayTarget(target);
      return;
    }

    if (target.view === 'work' && target.filter && onSelectWorkFilter) {
      onSelectWorkFilter(target.filter);
      return;
    }

    onViewChange(target.view as AppView);
  };

  const actions = useTodayActions({ date, onOpenTarget: openTarget, onViewChange });
  const pendingTargetKey = useMemo(
    () => (actions.isPending ? targetKey(actions.pendingTarget) : undefined),
    [actions.isPending, actions.pendingTarget],
  );

  const runCommand = (command: TodayActionCommand, preset?: 'later_today' | 'tomorrow' | 'next_week') => {
    if (command.kind === 'add_check_in') {
      setCheckInDraft({
        command,
        developerName: getDeveloperName(snapshot, command.target),
        defaultSummary: buildDefaultCheckInSummary(snapshot, command.target),
      });
      return;
    }

    if (command.kind === 'capture_follow_up') {
      setTextDraft({
        command,
        title: 'Capture follow-up',
        description: 'Save a Manager Desk follow-up without leaving Today.',
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
        description: 'Mark the meeting complete and save the outcome to Manager Desk.',
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

    actions.runAction(command, { preset });
  };

  return (
    <main
      className="flex min-h-0 flex-1 flex-col overflow-hidden"
      style={{
        background: 'linear-gradient(180deg, color-mix(in srgb, var(--bg-canvas) 96%, var(--accent) 4%), var(--bg-canvas))',
        ['--today-line' as string]: 'color-mix(in srgb, var(--border) 34%, transparent)',
        ['--today-line-strong' as string]: 'color-mix(in srgb, var(--border-strong) 24%, transparent)',
        ['--today-hover' as string]: 'color-mix(in srgb, var(--bg-tertiary) 34%, transparent)',
        ['--today-muted-panel' as string]: 'color-mix(in srgb, var(--bg-secondary) 20%, transparent)',
        ['--today-soft-panel' as string]: 'color-mix(in srgb, var(--bg-secondary) 38%, transparent)',
      }}
    >
      {snapshot ? (
        <>
          <TodayRhythmHeader
            today={snapshot}
            isFetching={today.isFetching}
            onRefresh={() => void today.refetch()}
            onOpenMetric={openTarget}
          />
          {snapshot.isPartial ? (
            <TodayPartialDataNotice
              sourceStatus={snapshot.sourceStatus}
              isFetching={today.isFetching}
              onRetry={() => void today.refetch()}
            />
          ) : null}
          <TodayCurrentPriority
            item={snapshot.currentPriority}
            onRunAction={(item) => runCommand(item.primaryAction)}
          />
          <section className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1.08fr)_minmax(360px,0.92fr)]">
            <TodayActionQueue
              isLoading={today.isLoading}
              items={snapshot.actionItems}
              pendingTargetKey={pendingTargetKey}
              onRunCommand={runCommand}
            />
            <aside className="min-h-0 overflow-auto px-5 py-5 xl:px-8">
              <TodayPeoplePulse
                people={snapshot.teamPulse}
                onRunCommand={runCommand}
                onViewAll={() => onViewChange('team')}
              />
              <TodayRhythmRail
                promises={snapshot.promises}
                standupPrompts={snapshot.standupPrompts}
                meetingPrompts={snapshot.meetingPrompts}
                onRunCommand={runCommand}
              />
            </aside>
          </section>
        </>
      ) : (
        <TodayLoadingState isError={today.isError} onRetry={() => void today.refetch()} />
      )}

      <TodayCommandFooter onViewChange={onViewChange} onSelectWorkFilter={onSelectWorkFilter} />
      {checkInDraft ? (
        <TodayCheckInDialog
          developerName={checkInDraft.developerName}
          defaultSummary={checkInDraft.defaultSummary}
          tasks={checkInTasks}
          isSaving={actions.isPending && actions.pendingKind === 'add_check_in'}
          onClose={() => setCheckInDraft(null)}
          onSave={(summary, taskKeys) => {
            actions.runAction(checkInDraft.command, { summary, taskKeys });
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
          isSaving={actions.isPending && actions.pendingKind === textDraft.command.kind}
          onClose={() => setTextDraft(null)}
          onSave={(value) => {
            actions.runAction(textDraft.command, {
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
          isSaving={actions.isPending && actions.pendingKind === confirmDraft.command.kind}
          onClose={() => setConfirmDraft(null)}
          onConfirm={() => {
            actions.runAction(confirmDraft.command, { preset: confirmDraft.preset });
            setConfirmDraft(null);
          }}
        />
      ) : null}
    </main>
  );
}

function TodayPartialDataNotice({
  sourceStatus,
  isFetching,
  onRetry,
}: {
  sourceStatus: TodayResponse['sourceStatus'];
  isFetching: boolean;
  onRetry: () => void;
}) {
  const labels = { issues: 'Work', team: 'Team', desk: 'Desk', sync: 'Sync' } as const;
  const unavailable = sourceStatus
    ? (Object.entries(sourceStatus) as Array<[keyof typeof labels, 'ready' | 'unavailable']>)
        .filter(([, status]) => status === 'unavailable')
        .map(([source]) => labels[source])
    : [];

  return (
    <div
      className="flex shrink-0 items-center justify-between gap-4 border-b px-5 py-2 text-[12px] xl:px-8"
      style={{ borderColor: 'var(--today-line)', background: 'color-mix(in srgb, var(--warning) 7%, transparent)' }}
      role="status"
    >
      <p style={{ color: 'var(--text-secondary)' }}>
        {unavailable.join(', ') || 'Some'} data is temporarily unavailable. Available actions remain current.
      </p>
      <button
        type="button"
        onClick={onRetry}
        disabled={isFetching}
        className="shrink-0 rounded-md px-2.5 py-1 font-medium active:scale-[0.98] disabled:cursor-wait disabled:opacity-60"
        style={{ color: 'var(--warning)', border: '1px solid color-mix(in srgb, var(--warning) 30%, transparent)' }}
      >
        {isFetching ? 'Retrying' : 'Retry'}
      </button>
    </div>
  );
}

function TodayLoadingState({ isError, onRetry }: { isError: boolean; onRetry: () => void }) {
  if (!isError) {
    return <TodayPageSkeleton />;
  }

  return (
    <section className="flex min-h-0 flex-1 items-center justify-center px-5">
      <div className="text-center">
        <p className="text-[14px] font-medium" style={{ color: 'var(--text-primary)' }}>
          Today could not load
        </p>
        <p className="mt-1 text-[12px]" style={{ color: 'var(--text-muted)' }}>
          Retry the cockpit read model.
        </p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-4 rounded-md px-3 py-1.5 text-[12px] font-medium active:scale-[0.98]"
          style={{ background: 'var(--accent)', color: '#fff' }}
        >
          Retry
        </button>
      </div>
    </section>
  );
}

function TodayPageSkeleton() {
  return (
    <section className="flex min-h-0 flex-1 flex-col" role="status" aria-live="polite" aria-label="Loading Today">
      <span className="sr-only">Loading Today</span>
      <div aria-hidden="true" className="flex min-h-0 flex-1 flex-col">
        <div className="shrink-0 border-b px-2 py-1.5" style={{ borderColor: 'var(--today-line)' }}>
          <div className="grid gap-1.5 border-b border-t py-1.5 lg:grid-cols-[190px_repeat(6,minmax(0,1fr))_126px]" style={{ borderColor: 'var(--today-line)' }}>
            {[0, 1, 2, 3, 4, 5, 6, 7].map((item) => (
              <div key={item} className="min-h-[58px] rounded-lg px-3.5 py-2.5">
                <SkeletonBlock className={item === 0 ? 'h-4 w-24' : 'h-5 w-16'} />
                <SkeletonBlock className="mt-2 h-3 w-20" />
              </div>
            ))}
          </div>
        </div>
        <div className="shrink-0 border-b px-5 py-3 xl:px-8" style={{ borderColor: 'var(--today-line)' }}>
          <div className="grid min-h-[62px] grid-cols-[92px_minmax(0,1fr)_120px] items-center gap-3 px-3.5">
            <SkeletonBlock className="h-3 w-16" />
            <div>
              <SkeletonBlock className="h-4 w-2/3" />
              <SkeletonBlock className="mt-2 h-3 w-1/3" />
            </div>
            <SkeletonBlock className="h-8 w-full" />
          </div>
        </div>
        <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1.08fr)_minmax(360px,0.92fr)]">
          <div className="border-b px-5 py-5 lg:border-b-0 lg:border-r xl:px-8" style={{ borderColor: 'var(--today-line-strong)' }}>
            <SkeletonBlock className="h-5 w-32" />
            <SkeletonBlock className="mt-2 h-3 w-48" />
            <div className="mt-5 space-y-2">
              {[0, 1, 2, 3, 4].map((row) => (
                <div key={row} className="grid min-h-[52px] grid-cols-[30px_minmax(0,1fr)_112px] items-center gap-4 border-b px-1 py-3" style={{ borderColor: 'var(--today-line)' }}>
                  <SkeletonBlock className="h-6 w-6" />
                  <SkeletonBlock className="h-4 w-4/5" />
                  <SkeletonBlock className="h-7 w-full" />
                </div>
              ))}
            </div>
          </div>
          <aside className="min-h-0 px-5 py-5 xl:px-8">
            <SkeletonBlock className="h-5 w-28" />
            <div className="mt-5 space-y-3">
              {[0, 1, 2, 3].map((row) => (
                <div key={row} className="grid min-h-[46px] grid-cols-[32px_minmax(0,1fr)_80px] items-center gap-3 border-b" style={{ borderColor: 'var(--today-line)' }}>
                  <SkeletonBlock className="h-7 w-7" />
                  <SkeletonBlock className="h-4 w-3/4" />
                  <SkeletonBlock className="h-6 w-full" />
                </div>
              ))}
            </div>
            <SkeletonBlock className="mt-8 h-8 w-full" />
            <SkeletonBlock className="mt-4 h-16 w-full" />
          </aside>
        </div>
      </div>
    </section>
  );
}

function SkeletonBlock({ className }: { className: string }) {
  return (
    <div
      className={`${className} animate-pulse rounded-sm motion-reduce:animate-none`}
      style={{ background: 'color-mix(in srgb, var(--bg-tertiary) 78%, transparent)' }}
    />
  );
}

function targetKey(target?: TodayActionTarget): string | undefined {
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

function getDeveloperName(snapshot: TodayResponse | undefined, target: TodayActionTarget): string {
  if (!snapshot || !target.developerAccountId) {
    return 'developer';
  }

  const pulseMatch = snapshot.teamPulse.find((person) => person.accountId === target.developerAccountId);
  if (pulseMatch) {
    return pulseMatch.displayName;
  }

  const actionMatch = snapshot.actionItems.find((item) => item.target.developerAccountId === target.developerAccountId);
  return actionMatch?.title ?? 'developer';
}

function buildDefaultCheckInSummary(snapshot: TodayResponse | undefined, target: TodayActionTarget): string {
  if (!snapshot || !target.developerAccountId) {
    return '';
  }

  const actionMatch = snapshot.actionItems.find((item) => item.target.developerAccountId === target.developerAccountId);
  if (!actionMatch || actionMatch.type === 'calm') {
    return '';
  }

  return `Manager check-in: ${actionMatch.signal}`;
}

function defaultFollowUpTitle(target: TodayActionTarget): string {
  if (target.issueKey) {
    return `Follow up on ${target.issueKey}`;
  }
  if (target.developerAccountId) {
    return 'Follow up with developer';
  }
  return 'Follow up';
}

function getConfirmationCopy(command: TodayActionCommand): {
  title: string;
  description: string;
  confirmLabel: string;
} {
  if (command.kind === 'mark_done') {
    return {
      title: 'Mark done?',
      description: 'This will mark the Manager Desk item done and remove it from Today.',
      confirmLabel: 'Mark done',
    };
  }

  if (command.kind === 'carry_forward') {
    return {
      title: 'Carry forward?',
      description: 'This will create today\'s carry-forward item and remove the current row from Today.',
      confirmLabel: 'Carry forward',
    };
  }

  return {
    title: 'Confirm action?',
    description: `Run "${command.label}" from Today.`,
    confirmLabel: command.label,
  };
}
