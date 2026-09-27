import { CheckCircle2, NotebookPen } from 'lucide-react';
import { firstName, formatClock } from '@/lib/today-layout';
import { TodayCompactRow } from './TodayCompactRow';
import type { TodayRunCommand } from './TodayActionRow';
import type { TodayActionTarget, TodayFocusPerson, TodayWrapUpFocus } from '@/types';

interface TodayWrapUpProps {
  wrapUp: TodayWrapUpFocus;
  onRunCommand: TodayRunCommand;
  onOpenTarget: (target: TodayActionTarget) => void;
}

/**
 * docs/53 §5 wrap-up: close loops in one pass — ask the people who went
 * quiet, clear or push promises, carry what's left to tomorrow, then write
 * the EOD note (shared ritual with Notes, docs/52 §5).
 */
export function TodayWrapUp({ wrapUp, onRunCommand, onOpenTarget }: TodayWrapUpProps) {
  const { missingCheckIns, openPromises, carryCandidates } = wrapUp;
  const askable = missingCheckIns.filter((person) => person.primaryAction && !person.askedAt);
  const allClosed = missingCheckIns.length === 0 && openPromises.length === 0 && carryCandidates.length === 0;

  return (
    <section className="today-wrap" aria-labelledby="today-wrap-heading">
      <div className="today-section-head">
        <h2 id="today-wrap-heading" className="today-section-title">Wrap-up</h2>
        <span className="today-section-actions">
          <button type="button" className="today-ghost" onClick={() => onOpenTarget(wrapUp.eodNoteTarget)}>
            <NotebookPen size={13} aria-hidden="true" />
            Write EOD note
          </button>
        </span>
      </div>

      {allClosed ? (
        <p className="flex items-center gap-2 px-3 pb-3 text-[12.5px]" style={{ color: 'var(--text-secondary)' }}>
          <CheckCircle2 size={14} style={{ color: 'var(--success)' }} aria-hidden="true" />
          Loops closed for today.
        </p>
      ) : null}

      {missingCheckIns.length > 0 ? (
        <div role="group" aria-label={`No check-in today (${missingCheckIns.length})`}>
          <h3 className="today-subhead flex items-center gap-2">
            No check-in today · {missingCheckIns.length}
            {askable.length > 1 ? (
              <button
                type="button"
                className="today-link ml-auto normal-case tracking-normal"
                onClick={() => askable.forEach((person) => onRunCommand(person.primaryAction!))}
              >
                Ask all {askable.length}
              </button>
            ) : null}
          </h3>
          <div className="today-people-row">
            {missingCheckIns.map((person) => (
              <PersonAsk key={person.accountId} person={person} onRunCommand={onRunCommand} onOpenTarget={onOpenTarget} />
            ))}
          </div>
        </div>
      ) : null}

      {openPromises.length > 0 ? (
        <div role="group" aria-label={`Open promises (${openPromises.length})`}>
          <h3 className="today-subhead">Open promises · {openPromises.length}</h3>
          {openPromises.map((promise) => {
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
        </div>
      ) : null}

      {carryCandidates.length > 0 ? (
        <div role="group" aria-label={`Carry to tomorrow (${carryCandidates.length})`}>
          <h3 className="today-subhead">Carry to tomorrow · {carryCandidates.length}</h3>
          {carryCandidates.map((item) => {
            const done = item.secondaryActions.find((action) => action.kind === 'mark_done');
            return (
              <TodayCompactRow
                key={item.id}
                title={item.title}
                detail={item.context}
                severity={item.severity}
                target={item.target}
                primary={{ ...item.primaryAction, label: 'Carry' }}
                secondary={done ? { command: done, label: 'Done' } : undefined}
                onRunCommand={onRunCommand}
              />
            );
          })}
        </div>
      ) : null}
    </section>
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
        <span className="today-avatar" aria-hidden="true">{initials(person.displayName)}</span>
        {firstName(person.displayName)}
      </button>
      {asked ? (
        <span className="text-[11.5px]" style={{ color: 'var(--text-muted)' }}>asked {asked}</span>
      ) : person.primaryAction ? (
        <button
          type="button"
          className="today-ghost"
          aria-label={`Ask ${person.displayName} for an update`}
          onClick={() => onRunCommand(person.primaryAction!)}
        >
          Ask
        </button>
      ) : null}
    </span>
  );
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || '?';
}
