import { useState } from 'react';
import { format } from 'date-fns';
import { CalendarClock, ChevronDown, CornerDownLeft, MessagesSquare, Users } from 'lucide-react';
import { useDailyNoteContext } from '@/hooks/useDailyNotes';
import type { DailyNoteDayContext, TodayActionTarget } from '@/types';

const EXPANDED_KEY = 'lead-os:notes-context-expanded';

function readExpanded(): boolean {
  try {
    return window.localStorage.getItem(EXPANDED_KEY) === 'true';
  } catch {
    return false;
  }
}

function writeExpanded(value: boolean) {
  try {
    window.localStorage.setItem(EXPANDED_KEY, String(value));
  } catch {
    // Per-viewer convenience only.
  }
}

interface ContextChip {
  key: string;
  icon: typeof Users;
  /** Full wording for the expanded chip. */
  label: string;
  /** Short wording for the collapsed line — must make sense on its own. */
  summary: string;
  tone?: 'accent' | 'warning';
  onOpen: () => void;
  openLabel: string;
}

function plural(count: number, one: string, many = `${one}s`) {
  return `${count} ${count === 1 ? one : many}`;
}

function firstName(name: string) {
  return name.trim().split(/\s+/)[0] ?? name;
}

export function buildContextChips(
  context: DailyNoteDayContext,
  { isToday, onOpenTarget, onRevealCarried }: { isToday: boolean; onOpenTarget: (target: TodayActionTarget) => void; onRevealCarried: () => void },
): ContextChip[] {
  const chips: ContextChip[] = [];
  if (context.standup) {
    const endedAt = new Date(context.standup.endedAt);
    const time = Number.isNaN(endedAt.getTime()) ? '' : ` at ${format(endedAt, 'h:mm a')}`;
    const flagged = context.standup.flagged;
    chips.push({
      key: 'standup',
      icon: MessagesSquare,
      label: `Standup done${time} · ${context.standup.reviewed} reviewed${flagged ? ` · ${flagged} flagged` : ''}`,
      summary: flagged ? `Standup done, ${flagged} flagged` : 'Standup done',
      tone: flagged > 0 ? 'warning' : undefined,
      onOpen: () => onOpenTarget({ type: 'view', view: 'team' }),
      openLabel: 'Open Team',
    });
  } else if (isToday) {
    chips.push({
      key: 'standup',
      icon: MessagesSquare,
      label: 'No standup yet',
      summary: 'No standup yet',
      onOpen: () => onOpenTarget({ type: 'view', view: 'team' }),
      openLabel: 'Open Team',
    });
  }
  if (context.carriedFrom > 0) {
    chips.push({
      key: 'carried',
      icon: CornerDownLeft,
      label: `${plural(context.carriedFrom, 'item')} carried in`,
      summary: `${context.carriedFrom} carried in`,
      onOpen: onRevealCarried,
      openLabel: 'Jump to the first carried line',
    });
  }
  if (context.followUpsDue > 0) {
    const text = `${plural(context.followUpsDue, 'follow-up')} due`;
    chips.push({
      key: 'follow-ups',
      icon: CalendarClock,
      label: text,
      summary: text,
      tone: 'accent',
      onOpen: () => onOpenTarget({ type: 'view', view: 'tasks', taskView: 'waiting' }),
      openLabel: 'Open Follow-ups',
    });
  }
  const people = context.oneOnOneWith ?? [];
  if (people.length > 0) {
    // One chip per person in the expanded view, each opening that 1:1.
    const summary =
      people.length <= 2
        ? `1:1${people.length > 1 ? 's' : ''} with ${people.map((person) => firstName(person.name)).join(' & ')}`
        : `${people.length} one-on-ones`;
    people.forEach((person, index) => {
      chips.push({
        key: `one-on-one:${person.accountId}`,
        icon: Users,
        label: `1:1 with ${person.name}`,
        // Only the first chip carries the collapsed summary for the group.
        summary: index === 0 ? summary : '',
        onOpen: () =>
          onOpenTarget({ type: 'developer', view: 'team', developerAccountId: person.accountId, panel: 'one-on-one' }),
        openLabel: `Open the 1:1 with ${person.name}`,
      });
    });
  } else if (context.oneOnOnes > 0) {
    const text = plural(context.oneOnOnes, 'one-on-one');
    chips.push({
      key: 'one-on-ones',
      icon: Users,
      label: text,
      summary: text,
      onOpen: () => onOpenTarget({ type: 'view', view: 'team' }),
      openLabel: 'Open Team',
    });
  }
  return chips;
}

/**
 * docs/52 §5: one quiet line under the heading — standup, carried items,
 * follow-ups due, 1:1s. It links out; it never writes into the note body.
 */
export function NotesDayContext({
  date,
  isToday,
  onOpenTarget,
  onRevealCarried,
}: {
  date: string;
  isToday: boolean;
  onOpenTarget: (target: TodayActionTarget) => void;
  onRevealCarried: () => void;
}) {
  const contextQuery = useDailyNoteContext(date);
  const [expanded, setExpanded] = useState(readExpanded);

  if (!contextQuery.data) return null;
  const chips = buildContextChips(contextQuery.data, { isToday, onOpenTarget, onRevealCarried });
  if (chips.length === 0) return null;

  const toggle = () => {
    setExpanded((value) => {
      writeExpanded(!value);
      return !value;
    });
  };

  return (
    <div className="notes-context">
      <button
        type="button"
        className="notes-context-toggle"
        onClick={toggle}
        aria-expanded={expanded}
        aria-controls="notes-context-chips"
      >
        {expanded ? (
          <span>Day context</span>
        ) : (
          <span className="notes-context-summary">
            {chips
              .filter((chip) => chip.summary)
              .map(({ key, icon: Icon, summary, tone }) => (
                <span key={key} className={`notes-context-bit${tone ? ` ${tone}` : ''}`}>
                  <Icon size={12} aria-hidden="true" />
                  {summary}
                </span>
              ))}
          </span>
        )}
        <ChevronDown size={12} aria-hidden="true" style={{ transform: expanded ? 'rotate(180deg)' : undefined }} />
      </button>
      {expanded ? (
        <ul id="notes-context-chips" className="notes-context-chips">
          {chips.map(({ key, icon: Icon, label, tone, onOpen, openLabel }) => (
            <li key={key}>
              <button
                type="button"
                className={`notes-context-chip${tone ? ` ${tone}` : ''}`}
                onClick={onOpen}
                title={openLabel}
              >
                <Icon size={12} aria-hidden="true" />
                {label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
