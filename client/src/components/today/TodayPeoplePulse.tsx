import { formatClock } from '@/lib/today-layout';
import { TodayActionMenu } from './TodayActionMenu';
import { initials } from './TodayWrapUp';
import type { TodayRunCommand } from './TodayActionRow';
import type { TodayActionCommand, TodayActionSeverity, TodayActionTarget, TodayFocusPerson, TodayTeamPulseItem } from '@/types';

export interface TodayPulsePerson {
  accountId: string;
  displayName: string;
  tone: TodayActionSeverity;
  status?: string;
  meta?: string;
  askedAt?: string;
  target: TodayActionTarget;
  primary?: TodayActionCommand;
  secondary: TodayActionCommand[];
}

export function pulsePersonFromItem(person: TodayTeamPulseItem): TodayPulsePerson {
  return {
    accountId: person.accountId,
    displayName: person.displayName,
    tone: person.tone,
    status: person.status,
    meta: person.actionPreview ? `Will set ${person.actionPreview}` : [person.currentWork, person.lastUpdate].filter(Boolean).join(' · '),
    askedAt: person.askedAt,
    target: person.target,
    primary: person.primaryAction.kind === 'open' ? undefined : person.primaryAction,
    secondary: person.secondaryActions,
  };
}

export function pulsePersonFromFocus(person: TodayFocusPerson, pulse?: TodayTeamPulseItem): TodayPulsePerson {
  const base = pulse ? pulsePersonFromItem(pulse) : undefined;
  return {
    accountId: person.accountId,
    displayName: person.displayName,
    tone: base?.tone ?? 'neutral',
    status: base?.status,
    meta: base?.meta ?? 'No update since standup',
    askedAt: person.askedAt ?? base?.askedAt,
    target: person.target,
    primary: person.primaryAction ?? base?.primary,
    secondary: base?.secondary ?? [],
  };
}

interface TodayPeoplePulseProps {
  title: string;
  people: TodayPulsePerson[];
  /** docs/53 U1: people already in the queue, as an avatar strip. */
  queued: Array<Pick<TodayTeamPulseItem, 'accountId' | 'displayName' | 'tone' | 'target'>>;
  emptyLabel: string;
  onRunCommand: TodayRunCommand;
  onViewAll: () => void;
}

export function TodayPeoplePulse({ title, people, queued, emptyLabel, onRunCommand, onViewAll }: TodayPeoplePulseProps) {
  const visible = people.slice(0, 6);
  const hidden = people.length - visible.length;

  return (
    <section aria-labelledby="today-people-heading">
      <div className="today-section-head">
        <h2 id="today-people-heading" className="today-section-title">{title}</h2>
        {people.length > 0 ? <span className="today-section-count">{people.length}</span> : null}
        <span className="today-section-actions">
          <button type="button" className="today-link" onClick={onViewAll}>Team</button>
        </span>
      </div>
      <div className="today-list">
        {visible.map((person) => (
          <PulseRow key={person.accountId} person={person} onRunCommand={onRunCommand} />
        ))}
        {visible.length === 0 ? (
          <p className="px-3 py-3 text-[12.5px]" style={{ color: 'var(--text-muted)' }}>{emptyLabel}</p>
        ) : null}
        {hidden > 0 ? (
          <button type="button" className="today-more" onClick={onViewAll}>+{hidden} more</button>
        ) : null}
      </div>
      {queued.length > 0 ? (
        <div className="today-avatar-strip">
          <span className="today-avatar-stack">
            {queued.slice(0, 6).map((person) => (
              <button
                key={person.accountId}
                type="button"
                className={`today-avatar today-tone-${person.tone}`}
                title={person.displayName}
                aria-label={`Open ${person.displayName}`}
                onClick={() => onRunCommand({ kind: 'open', label: 'Open', target: person.target })}
              >
                {initials(person.displayName)}
              </button>
            ))}
          </span>
          <span>{queued.length} in the queue</span>
        </div>
      ) : null}
    </section>
  );
}

function PulseRow({ person, onRunCommand }: { person: TodayPulsePerson; onRunCommand: TodayRunCommand }) {
  const asked = formatClock(person.askedAt);
  const open: TodayActionCommand = { kind: 'open', label: 'Open', target: person.target };
  return (
    <div className={`today-row today-tone-${person.tone}`} data-testid="today-pulse-row">
      <span className="today-avatar" aria-hidden="true" style={{ width: 22, height: 22, fontSize: 9 }}>
        {initials(person.displayName)}
      </span>
      <button type="button" className="today-row-link" onClick={() => onRunCommand(open)}>
        <span className="today-row-title-line">
          <span className="today-row-title">{person.displayName}</span>
          {person.status ? <span className="today-chip">{person.status}</span> : null}
        </span>
        <span className="today-row-meta">
          {asked ? <span className="today-row-meta-muted">Asked {asked} · </span> : null}
          {person.meta}
        </span>
      </button>
      <span className="today-row-actions">
        {person.primary ? (
          <button type="button" className="today-primary" onClick={() => onRunCommand(person.primary!)}>
            {person.primary.label}
          </button>
        ) : null}
        <TodayActionMenu
          label={person.displayName}
          actions={person.secondary}
          primary={person.primary}
          open={open}
          onRunAction={onRunCommand}
        />
      </span>
    </div>
  );
}
