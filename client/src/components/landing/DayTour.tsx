import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { OneOnOneReplica, PlanReplica, StandupReplica, WeeklyReviewReplica, WrapUpReplica } from './day-replicas';

interface DayStop {
  id: string;
  time: string;
  name: string;
  title: string;
  body: string;
  points: string[];
  replica: () => ReactNode;
}

/** The rhythm a lead already keeps, in the order it happens. */
const DAY_STOPS: DayStop[] = [
  {
    id: 'plan',
    time: '08:45',
    name: 'Plan',
    title: 'Plan the day before it plans you',
    body: 'Today opens with your plan and only the exceptions that need you. Pick up to three things that matter, and see what’s due and what carried over.',
    points: [
      'Up to three pins lead your plan every day.',
      'The queue holds blocked people, check-bys that came due and unowned defects. When nothing needs you, it says so.',
      'Today knows whether it’s your morning, your standup window or your wrap-up.',
    ],
    replica: PlanReplica,
  },
  {
    id: 'standup',
    time: '09:30',
    name: 'Standup',
    title: 'Run standup one person at a time',
    body: 'Walk the team in order. Each person’s work sits next to what changed since the last round, so you hear the news instead of the recap.',
    points: [
      'One key logs a note, a flag, done or blocked while they talk.',
      'Your place survives an accidental Esc: 2 of 5 visited stays 2 of 5.',
      'Flagged people are waiting for you in the wrap-up.',
    ],
    replica: StandupReplica,
  },
  {
    id: 'one-on-one',
    time: '14:00',
    name: '1:1',
    title: 'Hold 1:1s that remember last time',
    body: 'The agenda carries forward. Topics you didn’t reach stay for next time, actions become real tasks, and your notes stay private.',
    points: [
      'Any task can go on the next 1:1’s agenda from the task itself.',
      'Actions are yours unless you choose to put them on their My Day.',
      'Cadence and the next session are scheduled for you.',
    ],
    replica: OneOnOneReplica,
  },
  {
    id: 'wrap-up',
    time: '17:30',
    name: 'Wrap-up',
    title: 'Close the day in a minute',
    body: 'See what’s still open, move the rest to tomorrow in one step, and write the end-of-day note while it’s fresh.',
    points: [
      'Done today is a list, not a feeling.',
      'Nothing is silently overdue tomorrow: you decided where it went.',
    ],
    replica: WrapUpReplica,
  },
  {
    id: 'weekly-review',
    time: 'Friday',
    name: 'Weekly review',
    title: 'Finish the week with the update written',
    body: 'A guided ten-minute review: what shipped, what went quiet, what slipped and what Monday needs. It ends with an update for your manager, ready to paste.',
    points: [
      'Waiting items that went quiet ask for a decision. Everything else is kept.',
      'Monday’s top three are picked before you log off.',
      'Copy for Teams, or download the detail as CSV.',
    ],
    replica: WeeklyReviewReplica,
  },
];

/** "A day in LeadOS": a timeline of tabs, each with a replica of the real screen. */
export function DayTour() {
  const [active, setActive] = useState(0);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const baseId = useId();
  const stop = DAY_STOPS[active]!;
  const Replica = stop.replica;

  const focusTab = (index: number) => {
    const next = (index + DAY_STOPS.length) % DAY_STOPS.length;
    setActive(next);
    tabRefs.current[next]?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key === 'ArrowRight') { event.preventDefault(); focusTab(index + 1); }
    if (event.key === 'ArrowLeft') { event.preventDefault(); focusTab(index - 1); }
    if (event.key === 'Home') { event.preventDefault(); focusTab(0); }
    if (event.key === 'End') { event.preventDefault(); focusTab(DAY_STOPS.length - 1); }
  };

  return (
    <div className="lp-tour">
      <div className="lp-tour-tabs" role="tablist" aria-label="A day in LeadOS">
        {DAY_STOPS.map((entry, index) => (
          <button
            key={entry.id}
            ref={(node) => { tabRefs.current[index] = node; }}
            id={`${baseId}-tab-${entry.id}`}
            type="button"
            role="tab"
            aria-selected={index === active}
            aria-controls={`${baseId}-panel`}
            tabIndex={index === active ? 0 : -1}
            className="lp-tour-tab"
            onClick={() => setActive(index)}
            onKeyDown={(event) => onKeyDown(event, index)}
          >
            <span className="lp-tour-time">{entry.time}</span>
            <span className="lp-tour-name">{entry.name}</span>
          </button>
        ))}
      </div>

      <div
        id={`${baseId}-panel`}
        role="tabpanel"
        aria-labelledby={`${baseId}-tab-${stop.id}`}
        className="lp-tour-panel"
        key={stop.id}
      >
        <div className="lp-tour-copy">
          <h3 className="lp-h3">{stop.title}</h3>
          <p className="lp-body">{stop.body}</p>
          <ul className="lp-tour-points">
            {stop.points.map((point) => <li key={point}>{point}</li>)}
          </ul>
        </div>
        <div className="lp-tour-visual">
          <Replica />
        </div>
      </div>
    </div>
  );
}
