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
  onRunCommand: TodayRunCommand;
  onViewAll: () => void;
}

/**
 * docs/53 U1: only people the queue doesn't already cover. Renders nothing
 * when that's nobody — the panel never holds an empty section.
 */
export function TodayPeoplePulse({ title, people, onRunCommand, onViewAll }: TodayPeoplePulseProps) {
  if (people.length === 0) return null;
  const visible = people.slice(0, 6);
  const hidden = people.length - visible.length;

  return (
    <section className="today-panel" aria-label={title}>
      <div className="today-panel-head">
        <h2 className="today-section-title">{title}</h2>
        <span className="today-section-count">{people.length}</span>
        <span className="today-section-actions">
          <button type="button" className="today-link" onClick={onViewAll}>Team</button>
        </span>
      </div>
      {visible.map((person) => (
        <PulseRow key={person.accountId} person={person} onRunCommand={onRunCommand} />
      ))}
      {hidden > 0 ? (
        <button type="button" className="today-panel-more" onClick={onViewAll}>+{hidden} more</button>
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
