import type { TaskPlacementContext , TodayActionCommand, TodayActionItem, TodayActionTarget, TodayFocusPerson, TodayPlanFocus, TodayPlanItem, TodayWrapUpFocus } from '@/types';
import { TaskPlacementLabel } from '@/components/tasks/TaskPlacementLabel';
import { useState } from 'react';
import { Bell, CalendarArrowUp, CircleCheck, ListTodo, NotebookPen, Pin, PinOff, Rows3, type LucideIcon } from 'lucide-react';
import { firstName, formatClock, rowContext } from '@/lib/today-layout';
import { planDetail } from './TodayPlanPanel';
import type { TodayRunCommand } from './TodayActionRow';
import { TODAY_TOP_LIMIT } from '@/types';
import { Avatar } from '@/components/ui/Avatar';
import { shiftLocalIsoDate } from '@/lib/utils';

export type TodayBulkRun = (commands: TodayActionCommand[], title: (count: number) => string) => void;

interface TodayWrapUpProps {
  wrapUp: TodayWrapUpFocus;
  /** docs/57 §6: real completions and tomorrow's pins; absent without the canonical task model. */
  plan?: TodayPlanFocus;
  /** A pin write is in flight. */
  pinning?: boolean;
  /** Replace tomorrow's top 3 (keys in order). */
  onSetTomorrowTop3?: (taskKeys: string[]) => void;
  today: string;
  /** Every Today source loaded; otherwise no "nothing left" claim is made. */
  complete?: boolean;
  /** People the queue already covers (its group row asks them). */
  queuedPeople: Set<string>;
  onRunCommand: TodayRunCommand;
  onBulk: TodayBulkRun;
  onOpenTarget: (target: TodayActionTarget) => void;
}

const PREVIEW = 3;

/**
 * docs/53 §5 wrap-up, as the stage panel: promises to clear or push, what
 * carries to tomorrow (in one move), anyone quiet the queue doesn't already
 * show, then the EOD note. Long lists preview three rows.
 */
export function TodayWrapUp({ wrapUp, plan, pinning = false, onSetTomorrowTop3, today, complete = true, queuedPeople, onRunCommand, onBulk, onOpenTarget }: TodayWrapUpProps) {
  const [showAllCarry, setShowAllCarry] = useState(false);
  const [showAllPromises, setShowAllPromises] = useState(false);
  const [showAllDone, setShowAllDone] = useState(false);
  const [showAllOpen, setShowAllOpen] = useState(false);
  const { openPromises } = wrapUp;
  const missing = wrapUp.missingCheckIns.filter((person) => !queuedPeople.has(person.accountId));
  const askable = missing.map((person) => (!person.askedAt ? person.primaryAction : undefined)).filter((command): command is TodayActionCommand => Boolean(command));
  // The whole unfinished plan stays here (tomorrow's picks live in their own group). A carry row for a
  // task that is already on the plan folds into that row instead of listing the task twice.
  const pickedKeys = new Set((plan?.tomorrowTop3.items ?? []).map((item) => item.taskKey));
  const stillOpen = (plan?.items ?? []).filter((item) => !pickedKeys.has(item.taskKey));
  const planKeys = new Set((plan?.items ?? []).map((item) => item.taskKey));
  const carryByTask = new Map<string, TodayActionItem>();
  for (const candidate of wrapUp.carryCandidates) {
    if (candidate.target.taskKey && planKeys.has(candidate.target.taskKey)) carryByTask.set(candidate.target.taskKey, candidate);
  }
  const carryCandidates = wrapUp.carryCandidates.filter((item) => !(item.target.taskKey && carryByTask.has(item.target.taskKey)));
  // A claim about exactly what was checked: the plan, promises, carry-over and check-ins. It is never
  // shown while any of them has a row, and a day with nothing planned or finished gets no claim at all.
  const nothingOpen = complete && missing.length === 0 && openPromises.length === 0 && wrapUp.carryCandidates.length === 0 && (plan?.items.length ?? 0) === 0;
  const finishedSomething = (plan?.doneToday.count ?? 0) > 0;
  const done = plan?.doneToday.items ?? [];
  const doneRows = showAllDone ? done : done.slice(0, PREVIEW);
  const promises = showAllPromises ? openPromises : openPromises.slice(0, PREVIEW);
  const carries = showAllCarry ? carryCandidates : carryCandidates.slice(0, PREVIEW);
  const openRows = showAllOpen ? stillOpen : stillOpen.slice(0, PREVIEW);
  // docs/56 UX-26: one move for everything still open — the plan, promises and carry-over go to
  // tomorrow together (one Undo). Each task is moved once.
  const tomorrow = shiftLocalIsoDate(today, 1);
  const moveRest: TodayActionCommand[] = [];
  const moved = new Set<string>();
  const keep = (key: string | undefined, command: TodayActionCommand) => {
    const id = key ?? `${command.kind}:${JSON.stringify(command.target)}`;
    if (moved.has(id)) return;
    moved.add(id);
    moveRest.push(command);
  };
  for (const item of stillOpen) keep(item.taskKey, tomorrowCommand(item.target, carryByTask.get(item.taskKey), tomorrow));
  for (const promise of openPromises) {
    const snooze = promise.secondaryActions.find((action) => action.kind === 'snooze');
    if (snooze) keep(promise.target.taskKey, snooze);
  }
  for (const item of carryCandidates) keep(item.target.taskKey, { ...item.primaryAction, toDate: tomorrow });

  return (
    <section className="today-panel" aria-labelledby="today-wrap-heading">
      <div className="today-panel-head">
        <h2 id="today-wrap-heading" tabIndex={-1} className="today-section-title today-jump-target">Wrap-up</h2>
        <span className="today-section-actions">
          {moveRest.length > 1 ? (
            <button
              type="button"
              className="ui-btn"
              onClick={() => onBulk(moveRest, (count) => `Moved ${count} to tomorrow`)}
            >
              <CalendarArrowUp size={13} aria-hidden="true" />
              Move the rest to tomorrow · {moveRest.length}
            </button>
          ) : null}
          <button type="button" className="ui-btn-ghost" onClick={() => onOpenTarget(wrapUp.eodNoteTarget)}>
            <NotebookPen size={13} aria-hidden="true" />
            Write EOD note
          </button>
        </span>
      </div>

      {nothingOpen ? (
        <p className="today-panel-empty">
          {plan && finishedSomething ? <CircleCheck size={14} style={{ color: 'var(--success)' }} aria-hidden="true" /> : null}
          {!plan
            ? 'No open promises, carry-over or missing check-ins.'
            : finishedSomething
              ? 'Nothing left on your plan, promises, carry-over or check-ins.'
              : 'Nothing was planned or finished today.'}
        </p>
      ) : null}

      {plan && plan.doneToday.count > 0 ? (
        <div role="group" aria-label={`Done today (${plan.doneToday.count})`}>
          <h3 className="today-subhead">Done today · {plan.doneToday.count}</h3>
          {doneRows.map((item) => (
            <TodayDoneRow key={item.taskKey} title={item.title} placement={item.placement} onOpen={() => onOpenTarget(item.target)} />
          ))}
          {plan.doneToday.count > PREVIEW && done.length > PREVIEW ? (
            <MoreToggle total={done.length} open={showAllDone} onToggle={() => setShowAllDone((value) => !value)} />
          ) : null}
        </div>
      ) : null}

      {stillOpen.length > 0 ? (
        <div role="group" aria-label={`Still open today (${stillOpen.length})`}>
          <h3 id="today-open-plan-heading" tabIndex={-1} className="today-subhead today-jump-target">Still open today · {stillOpen.length}</h3>
          {openRows.map((item) => (
            <StillOpenRow
              key={item.taskKey}
              item={item}
              today={today}
              tomorrow={tomorrowCommand(item.target, carryByTask.get(item.taskKey), tomorrow)}
              canPick={Boolean(onSetTomorrowTop3)}
              full={pickedKeys.size >= TODAY_TOP_LIMIT}
              pinning={pinning}
              onPick={() => onSetTomorrowTop3?.([...pickedKeys, item.taskKey])}
              onRunCommand={onRunCommand}
            />
          ))}
          <MoreToggle total={stillOpen.length} open={showAllOpen} onToggle={() => setShowAllOpen((value) => !value)} />
        </div>
      ) : null}

      {plan && onSetTomorrowTop3 ? (
        <TomorrowTopThree plan={plan} pinning={pinning} onSet={onSetTomorrowTop3} onOpenTarget={onOpenTarget} />
      ) : null}

      {openPromises.length > 0 ? (
        <div role="group" aria-label={`Open promises (${openPromises.length})`}>
          <h3 className="today-subhead">Open promises · {openPromises.length}</h3>
          {promises.map((promise) => {
            const snooze = promise.secondaryActions.find((action) => action.kind === 'snooze');
            return (
              <WrapUpRow
                key={promise.id}
                icon={Bell}
                title={promise.title}
                detail={promise.detail}
                severity={promise.severity}
                target={promise.target}
                done={promise.primaryAction.kind === 'mark_done' ? promise.primaryAction : undefined}
                tomorrow={snooze ? { command: snooze, preset: 'tomorrow' } : undefined}
                onRunCommand={onRunCommand}
              />
            );
          })}
          <MoreToggle total={openPromises.length} open={showAllPromises} onToggle={() => setShowAllPromises((value) => !value)} />
        </div>
      ) : null}

      {carryCandidates.length > 0 ? (
        <div role="group" aria-label={`Carry to tomorrow (${carryCandidates.length})`}>
          <h3 className="today-subhead">Carry to tomorrow · {carryCandidates.length}</h3>
          {carries.map((item) => {
            const done = item.secondaryActions.find((action) => action.kind === 'mark_done');
            return (
              <WrapUpRow
                key={item.id}
                icon={Rows3}
                title={item.title} placement={item.placement}
                detail={rowContext(item, today)}
                severity={item.severity}
                target={item.target}
                done={done}
                tomorrow={{ command: { ...item.primaryAction, toDate: tomorrow } }}
                onRunCommand={onRunCommand}
              />
            );
          })}
          <MoreToggle total={carryCandidates.length} open={showAllCarry} onToggle={() => setShowAllCarry((value) => !value)} />
        </div>
      ) : null}

      {missing.length > 0 ? (
        <div role="group" aria-label={`No check-in today (${missing.length})`}>
          <h3 className="today-subhead today-subhead-action">
            <span>No check-in today · {missing.length}</span>
            {askable.length > 1 ? (
              <button
                type="button"
                className="ui-btn ui-btn-sm"
                onClick={() => onBulk(askable, (count) => `Asked ${count} for an update`)}
              >
                Ask all {askable.length}
              </button>
            ) : null}
          </h3>
          <div className="today-people-row">
            {missing.map((person) => (
              <PersonAsk key={person.accountId} person={person} onRunCommand={onRunCommand} onOpenTarget={onOpenTarget} />
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function TodayDoneRow({ title, placement, onOpen }: { title: string; placement?: TaskPlacementContext; onOpen: () => void }) {
  return (
    <div className="today-row today-tone-success" data-testid="today-done-row">
      <span className="today-row-icon" aria-hidden="true"><CircleCheck size={14} /></span>
      <button type="button" className="today-row-link" onClick={onOpen}>
        <span className="today-row-title-line"><span className="today-row-title">{title}</span><TaskPlacementLabel placement={placement} /></span>
      </button>
    </div>
  );
}

/** docs/56 UX-26: a wrap-up list item moves "Tomorrow": a plan date for tasks, the item's own carry otherwise. */
function tomorrowCommand(target: TodayActionTarget, carry: TodayActionItem | undefined, tomorrow: string): TodayActionCommand {
  if (carry) return { ...carry.primaryAction, label: 'Tomorrow', toDate: tomorrow };
  return { kind: 'carry_forward', label: 'Tomorrow', target, toDate: tomorrow, confirm: false, undoable: true };
}

/**
 * docs/56 UX-26: every wrap-up list speaks the same three verbs — Done · Tomorrow · Drop. Drop is
 * offered for tasks (it is a status, reversible with Undo); legacy Desk rows keep Done and Tomorrow.
 */
function WrapUpRow({
  icon: Icon,
  title,
  placement,
  detail,
  detailWarning = false,
  severity,
  target,
  done,
  tomorrow,
  leading,
  onRunCommand,
}: {
  icon: LucideIcon;
  title: string;
  placement?: TaskPlacementContext;
  detail?: string;
  detailWarning?: boolean;
  severity: string;
  target: TodayActionTarget;
  done?: TodayActionCommand;
  tomorrow?: { command: TodayActionCommand; preset?: 'tomorrow' };
  /** Extra controls before the verbs (the tomorrow top-3 pick). */
  leading?: React.ReactNode;
  onRunCommand: TodayRunCommand;
}) {
  const drop: TodayActionCommand | undefined = target.taskKey
    ? { kind: 'drop', label: 'Drop', target, confirm: false, undoable: true }
    : undefined;
  return (
    <div className={`today-row today-wrapup-row today-tone-${severity}`} data-testid="today-wrapup-row">
      <span className="today-row-icon" aria-hidden="true"><Icon size={14} /></span>
      <button type="button" className="today-row-link" onClick={() => onRunCommand({ kind: 'open', label: 'Open', target })}>
        <span className="today-row-title-line"><span className="today-row-title">{title}</span><TaskPlacementLabel placement={placement} /></span>
        {detail ? <span className="today-row-meta" style={detailWarning ? { color: 'var(--warning-text)' } : undefined}>{detail}</span> : null}
      </button>
      <span className="today-row-actions">
        {leading}
        {done ? (
          <button type="button" className="ui-btn" aria-label={`Done: ${title}`} onClick={() => onRunCommand(done)}>Done</button>
        ) : null}
        {tomorrow ? (
          <button type="button" className="ui-btn-ghost" aria-label={`Tomorrow: ${title}`} onClick={() => onRunCommand(tomorrow.command, tomorrow.preset)}>Tomorrow</button>
        ) : null}
        {drop ? (
          <button type="button" className="ui-btn-ghost" aria-label={`Drop: ${title}`} onClick={() => onRunCommand(drop)}>Drop</button>
        ) : null}
      </span>
    </div>
  );
}

/** One unfinished plan task: Done · Tomorrow · Drop, or pick it for tomorrow's top 3. */
function StillOpenRow({
  item,
  today,
  tomorrow,
  canPick,
  full,
  pinning,
  onPick,
  onRunCommand,
}: {
  item: TodayPlanItem;
  today: string;
  tomorrow: TodayActionCommand;
  canPick: boolean;
  full: boolean;
  pinning: boolean;
  onPick: () => void;
  onRunCommand: TodayRunCommand;
}) {
  const detail = planDetail(item, today);
  return (
    <div data-testid="tomorrow-top3-candidate">
      <WrapUpRow
        icon={ListTodo}
        title={item.title} placement={item.placement}
        detail={detail?.text}
        detailWarning={detail?.overdue}
        severity={item.priority === 'high' ? 'warning' : 'neutral'}
        target={item.target}
        done={item.primaryAction}
        tomorrow={{ command: tomorrow }}
        leading={canPick ? (
          <button
            type="button"
            className="ui-btn-ghost"
            aria-label={`Pick ${item.title} for tomorrow's top ${TODAY_TOP_LIMIT}`}
            title={full ? `Tomorrow's top ${TODAY_TOP_LIMIT} is full — remove one first` : `Pick for tomorrow's top ${TODAY_TOP_LIMIT}`}
            disabled={pinning || full}
            onClick={onPick}
          >
            <Pin size={13} aria-hidden="true" />
          </button>
        ) : null}
        onRunCommand={onRunCommand}
      />
    </div>
  );
}

/** docs/57 §6: the tasks that lead tomorrow (at most three). A pick never moves the task's date. */
function TomorrowTopThree({
  plan,
  pinning,
  onSet,
  onOpenTarget,
}: {
  plan: TodayPlanFocus;
  pinning: boolean;
  onSet: (taskKeys: string[]) => void;
  onOpenTarget: (target: TodayActionTarget) => void;
}) {
  const picked = plan.tomorrowTop3.items;
  const pickedKeys = picked.map((item) => item.taskKey);
  if (picked.length === 0) return null;

  return (
    <div role="group" aria-label="Tomorrow's top 3">
      <h3 className="today-subhead">Tomorrow&apos;s top 3 · {picked.length}/{TODAY_TOP_LIMIT}</h3>
      {picked.map((item) => (
        <div key={item.taskKey} className="today-row today-tone-info" data-testid="tomorrow-top3-row">
          <span className="today-row-icon" aria-hidden="true"><Pin size={14} /></span>
          <button type="button" className="today-row-link" onClick={() => onOpenTarget(item.target)}>
            <span className="today-row-title-line"><span className="today-row-title">{item.title}</span><TaskPlacementLabel placement={item.placement} /></span>
          </button>
          <span className="today-row-actions">
            <button
              type="button"
              className="ui-btn-ghost"
              aria-label={`Remove ${item.title} from tomorrow's top ${TODAY_TOP_LIMIT}`}
              disabled={pinning}
              onClick={() => onSet(pickedKeys.filter((key) => key !== item.taskKey))}
            >
              <PinOff size={13} aria-hidden="true" />
            </button>
          </span>
        </div>
      ))}
    </div>
  );
}

function MoreToggle({ total, open, onToggle }: { total: number; open: boolean; onToggle: () => void }) {
  if (total <= PREVIEW) return null;
  return (
    <button type="button" className="today-panel-more" aria-expanded={open} onClick={onToggle}>
      {open ? 'Show fewer' : `+${total - PREVIEW} more`}
    </button>
  );
}

function PersonAsk({
  person,
  onRunCommand,
  onOpenTarget,
}: {
  person: TodayFocusPerson;
  onRunCommand: TodayRunCommand;
  onOpenTarget: (target: TodayActionTarget) => void;
}) {
  const asked = formatClock(person.askedAt);
  return (
    <span className="inline-flex items-center gap-1">
      <button type="button" className="today-person-chip" onClick={() => onOpenTarget(person.target)}>
        <Avatar name={person.displayName} seed={person.accountId} size={22} tone="var(--tone, var(--border))" />
        {firstName(person.displayName)}
      </button>
      {asked ? (
        <span className="text-[12px]" style={{ color: 'var(--text-muted)' }}>asked {asked}</span>
      ) : person.primaryAction ? (
        <button
          type="button"
          className="ui-btn-ghost"
          aria-label={`Ask ${person.displayName} for an update`}
          onClick={() => onRunCommand(person.primaryAction!)}
        >
          Ask
        </button>
      ) : null}
    </span>
  );
}
