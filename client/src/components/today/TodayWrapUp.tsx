import { useState } from 'react';
import { CircleCheck, NotebookPen } from 'lucide-react';
import { firstName, formatClock, rowContext } from '@/lib/today-layout';
import { TodayCompactRow } from './TodayCompactRow';
import type { TodayRunCommand } from './TodayActionRow';
import type { TodayActionCommand, TodayActionTarget, TodayFocusPerson, TodayWrapUpFocus } from '@/types';
import { Avatar } from '@/components/ui/Avatar';

export type TodayBulkRun = (commands: TodayActionCommand[], title: (count: number) => string) => void;

interface TodayWrapUpProps {
  wrapUp: TodayWrapUpFocus;
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
export function TodayWrapUp({ wrapUp, today, queuedPeople, onRunCommand, onBulk, onOpenTarget }: TodayWrapUpProps) {
  const [showAllCarry, setShowAllCarry] = useState(false);
  const [showAllPromises, setShowAllPromises] = useState(false);
  const { openPromises, carryCandidates } = wrapUp;
  const missing = wrapUp.missingCheckIns.filter((person) => !queuedPeople.has(person.accountId));
  const askable = missing.map((person) => (!person.askedAt ? person.primaryAction : undefined)).filter((command): command is TodayActionCommand => Boolean(command));
  const carryCommands = carryCandidates.map((item) => item.primaryAction).filter((command) => command.kind === 'carry_forward');
  const allClosed = missing.length === 0 && openPromises.length === 0 && carryCandidates.length === 0;
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
