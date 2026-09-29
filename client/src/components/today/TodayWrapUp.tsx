import { useState } from 'react';
import { CircleCheck, NotebookPen, Pin, PinOff } from 'lucide-react';
import { firstName, formatClock, rowContext } from '@/lib/today-layout';
import { TodayCompactRow } from './TodayCompactRow';
import type { TodayRunCommand } from './TodayActionRow';
import { TODAY_TOP_LIMIT } from '@/types';
import type { TodayActionCommand, TodayActionTarget, TodayFocusPerson, TodayPlanFocus, TodayWrapUpFocus } from '@/types';
import { Avatar } from '@/components/ui/Avatar';

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
export function TodayWrapUp({ wrapUp, plan, pinning = false, onSetTomorrowTop3, today, queuedPeople, onRunCommand, onBulk, onOpenTarget }: TodayWrapUpProps) {
  const [showAllCarry, setShowAllCarry] = useState(false);
  const [showAllPromises, setShowAllPromises] = useState(false);
  const [showAllDone, setShowAllDone] = useState(false);
  const { openPromises, carryCandidates } = wrapUp;
  const missing = wrapUp.missingCheckIns.filter((person) => !queuedPeople.has(person.accountId));
  const askable = missing.map((person) => (!person.askedAt ? person.primaryAction : undefined)).filter((command): command is TodayActionCommand => Boolean(command));
  const carryCommands = carryCandidates.map((item) => item.primaryAction).filter((command) => command.kind === 'carry_forward');
  const allClosed = missing.length === 0 && openPromises.length === 0 && carryCandidates.length === 0;
  const done = plan?.doneToday.items ?? [];
  const doneRows = showAllDone ? done : done.slice(0, PREVIEW);
  const promises = showAllPromises ? openPromises : openPromises.slice(0, PREVIEW);
  const carries = showAllCarry ? carryCandidates : carryCandidates.slice(0, PREVIEW);

  return (
    <section className="today-panel" aria-labelledby="today-wrap-heading">
      <div className="today-panel-head">
        <h2 id="today-wrap-heading" className="today-section-title">Wrap-up</h2>
        <span className="today-section-actions">
          <button type="button" className="ui-btn-ghost" onClick={() => onOpenTarget(wrapUp.eodNoteTarget)}>
            <NotebookPen size={13} aria-hidden="true" />
            Write EOD note
          </button>
        </span>
      </div>

      {allClosed ? (
        <p className="today-panel-empty">
          <CircleCheck size={14} style={{ color: 'var(--success)' }} aria-hidden="true" />
          Loops closed for today.
        </p>
      ) : null}

      {plan && plan.doneToday.count > 0 ? (
        <div role="group" aria-label={`Done today (${plan.doneToday.count})`}>
          <h3 className="today-subhead">Done today · {plan.doneToday.count}</h3>
          {doneRows.map((item) => (
            <TodayDoneRow key={item.taskKey} title={item.title} onOpen={() => onOpenTarget(item.target)} />
          ))}
          {plan.doneToday.count > PREVIEW && done.length > PREVIEW ? (
            <MoreToggle total={done.length} open={showAllDone} onToggle={() => setShowAllDone((value) => !value)} />
          ) : null}
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
              <TodayCompactRow
                key={promise.id}
                title={promise.title}
                detail={promise.detail}
                severity={promise.severity}
                target={promise.target}
                primary={promise.primaryAction}
                secondary={snooze ? { command: snooze, label: 'Tomorrow', preset: 'tomorrow' } : undefined}
                onRunCommand={onRunCommand}
              />
            );
          })}
          <MoreToggle total={openPromises.length} open={showAllPromises} onToggle={() => setShowAllPromises((value) => !value)} />
        </div>
      ) : null}

      {carryCandidates.length > 0 ? (
        <div role="group" aria-label={`Carry to tomorrow (${carryCandidates.length})`}>
          <h3 className="today-subhead today-subhead-action">
            <span>Carry to tomorrow · {carryCandidates.length}</span>
            {carryCommands.length > 1 ? (
              <button
                type="button"
                className="ui-btn ui-btn-sm"
                onClick={() => onBulk(carryCommands, (count) => `Carried ${count} to tomorrow`)}
              >
                Carry all {carryCommands.length}
              </button>
            ) : null}
          </h3>
          {carries.map((item) => {
            const done = item.secondaryActions.find((action) => action.kind === 'mark_done');
            return (
              <TodayCompactRow
                key={item.id}
                title={item.title}
                detail={rowContext(item, today)}
                severity={item.severity}
                target={item.target}
                primary={{ ...item.primaryAction, label: 'Carry' }}
                secondary={done ? { command: done, label: 'Done' } : undefined}
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

function TodayDoneRow({ title, onOpen }: { title: string; onOpen: () => void }) {
  return (
    <div className="today-row today-tone-success" data-testid="today-done-row">
      <span className="today-row-icon" aria-hidden="true"><CircleCheck size={14} /></span>
      <button type="button" className="today-row-link" onClick={onOpen}>
        <span className="today-row-title-line"><span className="today-row-title">{title}</span></span>
      </button>
    </div>
  );
}

/**
 * docs/57 §6: pick up to three tasks that lead tomorrow. Candidates are what is
 * still open on today's plan; a pick never moves the task's date.
 */
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
  const candidates = plan.items.filter((item) => !pickedKeys.includes(item.taskKey)).slice(0, PREVIEW);
  const full = picked.length >= TODAY_TOP_LIMIT;
  if (picked.length === 0 && candidates.length === 0) return null;

  return (
    <div role="group" aria-label="Tomorrow's top 3">
      <h3 className="today-subhead">Tomorrow&apos;s top 3 · {picked.length}/{TODAY_TOP_LIMIT}</h3>
      {picked.map((item) => (
        <div key={item.taskKey} className="today-row today-tone-info" data-testid="tomorrow-top3-row">
          <span className="today-row-icon" aria-hidden="true"><Pin size={14} /></span>
          <button type="button" className="today-row-link" onClick={() => onOpenTarget(item.target)}>
            <span className="today-row-title-line"><span className="today-row-title">{item.title}</span></span>
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
      {!full ? candidates.map((item) => (
        <div key={item.taskKey} className="today-row today-tone-neutral" data-testid="tomorrow-top3-candidate">
          <span className="today-row-icon" aria-hidden="true"><Pin size={14} /></span>
          <button type="button" className="today-row-link" onClick={() => onOpenTarget(item.target)}>
            <span className="today-row-title-line"><span className="today-row-title">{item.title}</span></span>
          </button>
          <span className="today-row-actions">
            <button
              type="button"
              className="ui-btn"
              aria-label={`Pick ${item.title} for tomorrow's top ${TODAY_TOP_LIMIT}`}
              disabled={pinning}
              onClick={() => onSet([...pickedKeys, item.taskKey])}
            >
              Pick
            </button>
          </span>
        </div>
      )) : null}
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
