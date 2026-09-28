import { useCallback, useEffect, useMemo, useRef, useState, type FocusEvent } from 'react';
import type { AppView } from '@/App';
import { useToday } from '@/hooks/useToday';
import { useTodayActions } from '@/hooks/useTodayActions';
import { useTodayKeyboardTriage } from '@/hooks/useTodayKeyboardTriage';
import { useTodayProgress } from '@/hooks/useTodayProgress';
import { useTeamTracker } from '@/hooks/useTeamTracker';
import { useLocalDate } from '@/hooks/useLocalDate';
import { buildTodayQueueView, shouldIgnoreTriageEvent } from '@/lib/today-triage';
import {
  checkInPlaceholder,
  deltaChips,
  defaultFollowUpTitle,
  developerNameFor,
  formatClock,
  railItems,
  splitPulse,
  standupFocus,
  groupQueueItems,
  splitPanelRows,
  todayPanelOrder,
  withoutWrapUpItems,
  type TodayPanelSectionId,
  type TodayQueueGroup,
} from '@/lib/today-layout';
import { tasksFromItems } from '@/components/tasks/TaskPicker';
import type {
  FilterType,
  TodayActionCommand,
  TodayActionItem,
  TodayActionTarget,
  TodayResponse,
  TodayRhythmStage,
  TodaySourceName,
} from '@/types';
import { snoozePresets } from './TodayActionMenu';
import { TodayActionQueue, targetKey } from './TodayActionQueue';
import { TodayCheckInDialog } from './TodayCheckInDialog';
import { TodayConfirmDialog } from './TodayConfirmDialog';
import { TodayDueSoon } from './TodayDueSoon';
import { TodayPeoplePulse, pulsePersonFromFocus, pulsePersonFromItem } from './TodayPeoplePulse';
import { TodayPromisesList } from './TodayPromisesList';
import { TodayRhythmHeader } from './TodayRhythmHeader';
import { TodaySinceStrip } from './TodaySinceStrip';
import { TodayStandupCard } from './TodayStandupStatus';
import { TodayPanelList } from './TodayPanelList';
import { TodayTextCaptureDialog, type TodayCaptureExtras, type TodayCapturePreset } from './TodayTextCaptureDialog';
import { TodayWrapUp } from './TodayWrapUp';
import './today.css';

type SnoozePreset = 'later_today' | 'tomorrow' | 'next_week';

/** Enough rows to fill a laptop-height column before "+N more". */
const QUEUE_VISIBLE_ROWS = 12;

interface TodayPageProps {
  onViewChange: (view: AppView) => void;
  onSelectWorkFilter?: (filter: FilterType) => void;
  onOpenTodayTarget?: (target: TodayActionTarget) => void;
}

const stageLabels: Record<TodayRhythmStage, string> = {
  morning_plan: 'Morning plan',
  standup_window: 'Standup window',
  midday_check: 'Midday check',
  wrap_up: 'Wrap-up',
};

export function TodayPage({ onViewChange, onSelectWorkFilter, onOpenTodayTarget }: TodayPageProps) {
  const date = useLocalDate();
  const [checkInDraft, setCheckInDraft] = useState<{
    command: TodayActionCommand;
    developerName: string;
    placeholder: string;
    error?: string;
  } | null>(null);
  const [textDraft, setTextDraft] = useState<{
    command: TodayActionCommand;
    title: string;
    description?: string;
    label: string;
    defaultValue: string;
    saveLabel: string;
    multiline?: boolean;
    preset?: TodayCapturePreset;
    error?: string;
  } | null>(null);
  const [confirmDraft, setConfirmDraft] = useState<{
    command: TodayActionCommand;
    preset?: SnoozePreset;
    /** A bulk write waiting on one confirmation (e.g. legacy "Carry all"). */
    bulk?: { commands: TodayActionCommand[]; title: (count: number) => string };
    error?: string;
  } | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => new Set());
  const [queueExpanded, setQueueExpanded] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const queueHeadingRef = useRef<HTMLHeadingElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastRowIndex = useRef(0);

  const today = useToday(date);
  const snapshot = today.data;
  // Only fetch the board while a dialog that needs it is open — it provides the
  // developer's tasks for the check-in picker and the outcome owner list.
  const needsBoard = Boolean(checkInDraft) || textDraft?.command.kind === 'capture_meeting_outcome';
  const checkInBoard = useTeamTracker(date, undefined, needsBoard);
  const outcomeOwners = useMemo(
    () => (checkInBoard.data?.developers ?? []).map((day) => ({
      accountId: day.developer.accountId,
      displayName: day.developer.displayName,
    })),
    [checkInBoard.data],
  );
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

  const actions = useTodayActions({ date, onOpenTarget: openTarget });
  const pendingTargetKey = useMemo(
    () => (actions.isPending && actions.pendingTarget ? targetKey({ target: actions.pendingTarget }) : undefined),
    [actions.isPending, actions.pendingTarget],
  );

  // ── Derived layout ────────────────────────────────────────────────────
  const stage = snapshot?.rhythm.stage;
  const focus = snapshot?.focus;
  const allQueueItems = useMemo(
    () => [...(snapshot?.actionItems ?? []), ...(snapshot?.overflowActionItems ?? [])],
    [snapshot?.actionItems, snapshot?.overflowActionItems],
  );
  // The panel owns standup, 1:1s and carry-forward (and wrap-up's promises);
  // what's left is grouped one-row-per-fact. Totals shrink by exactly what
  // moved or folded.
  const { queueView, queueGroups, groupByCommand, panelRows } = useMemo(() => {
    const visible = withoutWrapUpItems(snapshot?.actionItems ?? [], focus);
    const overflow = withoutWrapUpItems(snapshot?.overflowActionItems ?? [], focus);
    const split = splitPanelRows([...visible, ...overflow]);
    const grouped = groupQueueItems(split.queue);
    const shipped = (snapshot?.actionItems.length ?? 0) + (snapshot?.overflowActionItems?.length ?? 0);
    const removed = shipped - grouped.items.length;
    // Group rows are synthetic: their primary command is recognised by identity.
    const byCommand = new Map<TodayActionCommand, TodayQueueGroup>();
    for (const item of grouped.items) {
      const group = grouped.groups.get(item.id);
      if (group) byCommand.set(item.primaryAction, group);
    }
    return {
      panelRows: split,
      queueGroups: grouped.groups,
      groupByCommand: byCommand,
      queueView: buildTodayQueueView({
        items: grouped.items,
        totalCount: snapshot?.totalCount === undefined ? undefined : Math.max(snapshot.totalCount - removed, 0),
        expanded: queueExpanded,
        visibleLimit: QUEUE_VISIBLE_ROWS,
      }),
    };
  }, [snapshot?.actionItems, snapshot?.overflowActionItems, snapshot?.totalCount, focus, queueExpanded]);
  const cleared = useTodayProgress(date, snapshot ? allQueueItems : undefined);
  const pulse = useMemo(() => splitPulse(snapshot?.teamPulse ?? [], allQueueItems), [snapshot?.teamPulse, allQueueItems]);
  const rail = useMemo(
    () => railItems(focus && 'wrapUp' in focus ? [] : snapshot?.promises ?? [], snapshot?.meetingPrompts ?? [], allQueueItems),
    [focus, snapshot?.promises, snapshot?.meetingPrompts, allQueueItems],
  );
  const nextUp = snapshot?.rhythm.nextStage
    ? `${stageLabels[snapshot.rhythm.nextStage.stage]} at ${formatClock(snapshot.rhythm.nextStage.startsAt)}`
    : undefined;

  // ── docs/53 A5: focus never falls to <body> after an optimistic removal ──
  const restoreFocus = useCallback(() => {
    requestAnimationFrame(() => {
      const active = document.activeElement;
      if (active && active !== document.body && active.isConnected) return;
      const links = scrollRef.current?.querySelectorAll<HTMLElement>('[data-today-queue] [data-row-link]');
      const target = links?.[Math.min(lastRowIndex.current, (links?.length ?? 1) - 1)] ?? queueHeadingRef.current;
      target?.focus();
    });
  }, []);

  const trackRowFocus = (event: FocusEvent<HTMLElement>) => {
    const link = (event.target as HTMLElement).closest('[data-row-link]');
    if (!link) return;
    const links = Array.from(scrollRef.current?.querySelectorAll('[data-today-queue] [data-row-link]') ?? []);
    const index = links.indexOf(link);
    if (index >= 0) lastRowIndex.current = index;
  };

  const toggleGroup = (id: string) => {
    setExpandedGroups((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const runBulk = (commands: TodayActionCommand[], title: (count: number) => string) => {
    if (commands.length === 0) return;
    if (commands.some((command) => command.confirm)) {
      setConfirmDraft({ command: commands[0]!, bulk: { commands, title } });
      return;
    }
    void actions.runBulk(commands, title).then(restoreFocus);
  };

  const runCommand = (command: TodayActionCommand, preset?: SnoozePreset) => {
    // A group row's primary ("Ask all") fans out to each member.
    // A group row's primary ("Ask all", "Done all") fans out to each member.
    const group = groupByCommand.get(command);
    if (group?.bulk) {
      runBulk(group.bulk.commands, group.bulk.toast);
      return;
    }
    if (group && group.kind === 'people') {
      openTarget({ type: 'view', view: 'team', date: snapshot?.date });
      return;
    }

    if (command.kind === 'add_check_in') {
      setCheckInDraft({
        command,
        developerName: developerNameFor(snapshot, command.target.developerAccountId) ?? 'Developer',
        placeholder: checkInPlaceholder(snapshot, command.target.developerAccountId),
      });
      return;
    }

    if (command.kind === 'capture_follow_up') {
      setTextDraft({
        command,
        title: 'Capture follow-up',
        label: 'Follow-up title',
        defaultValue: defaultFollowUpTitle(snapshot, command.target),
        saveLabel: 'Save follow-up',
        preset: 'tomorrow',
      });
      return;
    }

    if (command.kind === 'capture_meeting_outcome') {
      setTextDraft({
        command,
        title: 'Capture outcome',
        description: meetingTitle(snapshot, command.target),
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
    restoreFocus();
  };

  // docs/53 U4: keyboard triage over the rows in display order.
  const dialogOpen = Boolean(checkInDraft || textDraft || confirmDraft);
  const triage = useTodayKeyboardTriage({
    items: queueView.ordered,
    enabled: Boolean(snapshot) && !dialogOpen && !shortcutsOpen,
    onOpen: (item) => (queueGroups.has(item.id) ? toggleGroup(item.id) : openTarget(item.target)),
    onRunCommand: runCommand,
    onUndo: actions.undoLast,
  });

  // `?` opens the shortcuts sheet (the map lives there, not in copy).
  useEffect(() => {
    if (!snapshot || dialogOpen) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== '?' || shouldIgnoreTriageEvent(event)) return;
      event.preventDefault();
      setShortcutsOpen((open) => !open);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [snapshot, dialogOpen]);

  const closeDialog = (close: () => void) => {
    close();
    restoreFocus();
  };

  const focusQueue = () => {
    queueHeadingRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    queueHeadingRef.current?.focus({ preventScroll: true });
  };

  const queuedPeople = useMemo(() => new Set(pulse.queued.map((person) => person.accountId)), [pulse.queued]);
  const quietPeople = focus && 'midday' in focus
    ? focus.midday.silentSinceStandup
      .filter((person) => !queuedPeople.has(person.accountId))
      .map((person) => pulsePersonFromFocus(person, snapshot?.teamPulse.find((entry) => entry.accountId === person.accountId)))
    : [];
  const otherPeople = pulse.rows
    .filter((person) => !quietPeople.some((quiet) => quiet.accountId === person.accountId))
    .map(pulsePersonFromItem);

  const renderPanelSection = (section: TodayPanelSectionId) => {
    if (!snapshot) return null;
    switch (section) {
      case 'delta':
        return <TodaySinceStrip key="delta" delta={snapshot.delta} date={snapshot.date} onOpenTarget={openTarget} />;
      case 'standup':
        return (
          <TodayStandupCard
            key="standup"
            standup={standupFocus(focus)}
            row={panelRows.standup}
            completedOnly={stage === 'midday_check'}
            onOpenTarget={openTarget}
          />
        );
      case 'oneOnOnes':
        return <TodayPanelList key="oneOnOnes" title="1:1s" icon="calendar" items={panelRows.oneOnOnes} today={snapshot.date} onRunCommand={runCommand} />;
      case 'carry': {
        const carryCommands = panelRows.carry.map((item) => item.primaryAction).filter((command) => command.kind === 'carry_forward');
        return (
          <TodayPanelList
            key="carry"
            title="Carry from earlier"
            icon="desk"
            items={panelRows.carry}
            today={snapshot.date}
            bulk={carryCommands.length > 1
              ? { label: `Carry all ${carryCommands.length}`, onRun: () => runBulk(carryCommands, (count) => `Carried ${count} into today`) }
              : undefined}
            onRunCommand={runCommand}
          />
        );
      }
      case 'wrapUp':
        return focus && 'wrapUp' in focus ? (
          <TodayWrapUp
            key="wrapUp"
            wrapUp={focus.wrapUp}
            today={snapshot.date}
            queuedPeople={queuedPeople}
            onRunCommand={runCommand}
            onBulk={runBulk}
            onOpenTarget={openTarget}
          />
        ) : null;
      case 'dueSoon':
        return focus && 'midday' in focus
          ? <TodayDueSoon key="dueSoon" items={focus.midday.dueSoon} onRunCommand={runCommand} />
          : null;
      case 'quiet':
        return (
          <TodayPeoplePulse
            key="quiet"
            title="Quiet since standup"
            people={quietPeople}
            onRunCommand={runCommand}
            onViewAll={() => openTarget({ type: 'view', view: 'team', date: snapshot.date })}
          />
        );
      case 'promises':
        return <TodayPromisesList key="promises" items={rail} onRunCommand={runCommand} />;
      case 'people':
        return (
          <TodayPeoplePulse
            key="people"
            title="People"
            people={otherPeople}
            onRunCommand={runCommand}
            onViewAll={() => openTarget({ type: 'view', view: 'team', date: snapshot.date })}
          />
        );
      default:
        return null;
    }
  };

  // Only sections with data render — the column never shows as an empty slab,
  // and without any the queue takes the full width.
  const standup = standupFocus(focus);
  const hasSection = (section: TodayPanelSectionId): boolean => {
    if (!snapshot) return false;
    switch (section) {
      case 'wrapUp': return Boolean(focus && 'wrapUp' in focus);
      case 'standup': return Boolean(standup && (standup.status === 'completed' || stage !== 'midday_check'));
      case 'delta': return deltaChips(snapshot.delta, snapshot.date).length > 0;
      case 'dueSoon': return Boolean(focus && 'midday' in focus && focus.midday.dueSoon.length > 0);
      case 'quiet': return quietPeople.length > 0;
      case 'oneOnOnes': return panelRows.oneOnOnes.length > 0;
      case 'carry': return panelRows.carry.length > 0;
      case 'promises': return rail.length > 0;
      case 'people': return otherPeople.length > 0;
      default: return false;
    }
  };
  const panelSections = snapshot ? todayPanelOrder(stage).filter(hasSection).map(renderPanelSection) : [];

  return (
    <main className="today-page">
      {snapshot ? (
        <>
          <TodayRhythmHeader
            today={snapshot}
            isFetching={today.isFetching}
            freshness={today.freshness}
            shortcutsOpen={shortcutsOpen}
            onToggleShortcuts={setShortcutsOpen}
            onRefresh={() => void today.refetch()}
            onOpenMetric={openTarget}
            onFocusQueue={focusQueue}
          />
          {snapshot.isPartial ? (
            <TodayPartialDataNotice
              sourceStatus={snapshot.sourceStatus}
              isFetching={today.isFetching}
              onRetry={() => void today.refetch()}
            />
          ) : null}
          {/* Queue left, stage panel right; each scrolls on desktop, one scroll on phones. */}
          <div
            ref={scrollRef}
            className="today-body"
            data-stage={stage}
            data-panel={panelSections.length > 0 ? 'true' : 'false'}
            onFocus={trackRowFocus}
          >
            <div className="today-main-col">
              <TodayActionQueue
                ref={queueHeadingRef}
                view={queueView}
                expanded={queueExpanded}
                onToggleExpanded={() => setQueueExpanded((current) => !current)}
                groups={queueGroups}
                expandedGroups={expandedGroups}
                onToggleGroup={toggleGroup}
                today={snapshot.date}
                activeItemId={triage.activeId}
                pendingTargetKey={pendingTargetKey}
                cleared={cleared}
                nextUp={nextUp}
                onRunCommand={runCommand}
              />
            </div>
            {panelSections.length > 0 ? (
              <aside className="today-panel-col" aria-label={`${snapshot.rhythm.label} panel`}>
                {panelSections}
              </aside>
            ) : null}
          </div>
        </>
      ) : (
        <TodayLoadingState isError={today.isError} onRetry={() => void today.refetch()} />
      )}

      {checkInDraft ? (
        <TodayCheckInDialog
          developerName={checkInDraft.developerName}
          placeholder={checkInDraft.placeholder}
          tasks={checkInTasks}
          initialTaskKeys={checkInDraft.command.target.context?.taskKey ? [checkInDraft.command.target.context.taskKey] : undefined}
          isSaving={actions.isPending && actions.pendingKind === 'add_check_in'}
          errorMessage={checkInDraft.error}
          onClose={() => closeDialog(() => setCheckInDraft(null))}
          onSave={(summary, taskKeys) => {
            void actions
              .runActionAsync(checkInDraft.command, { summary, taskKeys })
              .then(() => closeDialog(() => setCheckInDraft(null)))
              .catch((error: unknown) => {
                setCheckInDraft((current) => (current ? { ...current, error: errorMessage(error) } : current));
              });
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
          presets={textDraft.command.kind === 'capture_follow_up' ? followUpPresetOptions() : undefined}
          preset={textDraft.preset}
          onPresetChange={(preset) => setTextDraft((current) => (current ? { ...current, preset } : current))}
          nextActionOwners={textDraft.command.kind === 'capture_meeting_outcome' ? outcomeOwners : undefined}
          isSaving={actions.isPending && actions.pendingKind === textDraft.command.kind}
          errorMessage={textDraft.error}
          onClose={() => closeDialog(() => setTextDraft(null))}
          onSave={(value, extras?: TodayCaptureExtras) => {
            void actions
              .runActionAsync(textDraft.command, {
                title: textDraft.command.kind === 'capture_follow_up' ? value : undefined,
                outcome: textDraft.command.kind === 'capture_meeting_outcome' ? value : undefined,
                preset: textDraft.command.kind === 'capture_follow_up' ? textDraft.preset : undefined,
                nextAction: extras?.nextAction,
                nextActionOwnerAccountId: extras?.nextActionOwnerAccountId,
              })
              .then(() => closeDialog(() => setTextDraft(null)))
              .catch((error: unknown) => {
                setTextDraft((current) => (current ? { ...current, error: errorMessage(error) } : current));
              });
          }}
        />
      ) : null}
      {confirmDraft ? (
        <TodayConfirmDialog
          {...(confirmDraft.bulk
            ? {
                title: `Carry ${confirmDraft.bulk.commands.length} items?`,
                description: 'Moves each item forward. This can’t be undone from here.',
                confirmLabel: `Carry ${confirmDraft.bulk.commands.length}`,
              }
            : getConfirmationCopy(confirmDraft.command))}
          isSaving={actions.isPending && actions.pendingKind === confirmDraft.command.kind}
          errorMessage={confirmDraft.error}
          onClose={() => closeDialog(() => setConfirmDraft(null))}
          onConfirm={() => {
            if (confirmDraft.bulk) {
              const { commands, title } = confirmDraft.bulk;
              closeDialog(() => setConfirmDraft(null));
              void actions.runBulk(commands, title);
              return;
            }
            void actions
              .runActionAsync(confirmDraft.command, { preset: confirmDraft.preset })
              .then(() => closeDialog(() => setConfirmDraft(null)))
              .catch((error: unknown) => {
                setConfirmDraft((current) => (current ? { ...current, error: errorMessage(error) } : current));
              });
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
  const labels: Record<TodaySourceName, string> = {
    issues: 'Work',
    team: 'Team',
    desk: 'Desk',
    sync: 'Sync',
    drift: 'Jira drift',
    one_on_one: '1:1s',
  };
  const unavailable = sourceStatus
    ? (Object.entries(sourceStatus) as Array<[TodaySourceName, 'ready' | 'unavailable']>)
        .filter(([, status]) => status === 'unavailable')
        .map(([source]) => labels[source])
        .filter(Boolean)
    : [];

  return (
    <div className="today-notice" role="status">
      <p>{unavailable.join(', ') || 'Some sources'} unavailable — showing what loaded.</p>
      <button type="button" onClick={onRetry} disabled={isFetching} className="ui-btn-ghost" style={{ color: 'var(--warning)' }}>
        {isFetching ? 'Retrying…' : 'Retry'}
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
        <p className="text-[14px] font-medium" style={{ color: 'var(--text-primary)' }}>Today didn&apos;t load</p>
        <button type="button" onClick={onRetry} className="ui-btn-solid mt-3">Retry</button>
      </div>
    </section>
  );
}

function TodayPageSkeleton() {
  return (
    <section className="flex min-h-0 flex-1 flex-col" role="status" aria-live="polite" aria-label="Loading Today">
      <span className="sr-only">Loading Today</span>
      <div aria-hidden="true" className="flex min-h-0 flex-1 flex-col">
        <div className="today-band">
          <span className="today-skeleton h-5 w-32 rounded-full" />
          <span className="today-skeleton h-4 w-20" />
          {[0, 1, 2, 3].map((item) => <span key={item} className="today-skeleton h-4 w-16" />)}
        </div>
        <div className="today-body">
          <div className="today-main-col">
            <div>
            <span className="today-skeleton block h-4 w-24" />
            <div className="today-list mt-3">
              {[0, 1, 2, 3, 4, 5].map((row) => (
                <div key={row} className="grid grid-cols-[22px_minmax(0,1fr)_72px] items-center gap-3 px-2 py-3" style={{ borderBottom: '1px solid var(--border)' }}>
                  <span className="today-skeleton h-4 w-4" />
                  <span>
                    <span className="today-skeleton block h-3.5 w-3/4" />
                    <span className="today-skeleton mt-2 block h-3 w-1/2" />
                  </span>
                  <span className="today-skeleton h-7 w-full" />
                </div>
              ))}
            </div>
            </div>
          </div>
          <div className="today-panel-col gap-3 p-4">
            <span className="today-skeleton h-4 w-20" />
            {[0, 1, 2].map((row) => <span key={row} className="today-skeleton h-10 w-full" />)}
          </div>
        </div>
      </div>
    </section>
  );
}

function meetingTitle(snapshot: TodayResponse | undefined, target: TodayActionTarget): string | undefined {
  if (!snapshot || !target.managerDeskItemId) return undefined;
  const match = [...snapshot.actionItems, ...snapshot.meetingPrompts].find((item) => item.target.managerDeskItemId === target.managerDeskItemId);
  return match?.title;
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'Something went wrong. Try again.';
}

function followUpPresetOptions(): Array<{ id: TodayCapturePreset; label: string }> {
  return snoozePresets().map(([id, label]) => ({ id, label }));
}

function getConfirmationCopy(command: TodayActionCommand): {
  title: string;
  description: string;
  confirmLabel: string;
} {
  if (command.kind === 'mark_done') {
    return {
      title: 'Mark done?',
      description: 'The item leaves Today.',
      confirmLabel: 'Mark done',
    };
  }

  if (command.kind === 'carry_forward') {
    return {
      title: 'Carry forward?',
      description: `Moves the item to ${command.toDate ? 'tomorrow' : 'today'}. This can’t be undone from here.`,
      confirmLabel: 'Carry forward',
    };
  }

  return {
    title: `${command.label}?`,
    description: 'This can’t be undone from here.',
    confirmLabel: command.label,
  };
}
