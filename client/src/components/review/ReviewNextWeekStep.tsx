import { useEffect, useMemo, useRef, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { CalendarPlus, Flag, Moon, Pin, PinOff } from 'lucide-react';
import { EmptyState } from '@/components/ui/EmptyState';
import { shouldIgnoreTriageEvent } from '@/lib/today-triage';
import { buildNextWeekPlan, comesBackLabel, type PlannedRow } from '@/lib/weekly-review-plan';
import { type ReviewStepContext } from '@/lib/weekly-review';
import { TODAY_TOP_LIMIT } from '@/types';

const CANDIDATES_SHOWN = 8;

/**
 * docs/59 §5.3 step 5: Monday's top 3. Three slots fill from the candidates (what the manager just
 * moved to Monday, then high priority, then the rest of next week); below, how next week looks per
 * day and what comes back from Later. Pinning writes at once and can be undone by removing the pin.
 */
export function ReviewNextWeekStep({ ctx }: { ctx: ReviewStepContext }) {
  const plan = useMemo(() => buildNextWeekPlan(ctx.review, ctx.decisions), [ctx.review, ctx.decisions]);
  const pinnedKeys = useMemo(() => new Set(ctx.pins.map((pin) => pin.taskKey)), [ctx.pins]);
  const candidates = plan.candidates.filter((item) => !pinnedKeys.has(item.row.taskKey));
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? candidates : candidates.slice(0, CANDIDATES_SHOWN);
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const day = format(parseISO(ctx.review.nextWorkday), 'EEEE');
  const full = ctx.pins.length >= TODAY_TOP_LIMIT;

  // Keyboard order: the pinned slots, then the candidates.
  const rowKeys = [...ctx.pins.map((pin) => pin.taskKey), ...shown.map((item) => item.row.taskKey)];
  const rowElement = (key: string) => listRef.current?.querySelector<HTMLElement>(`[data-review-row="${key}"]`) ?? null;
  const focusRow = (key: string) => {
    setFocusedKey(key);
    rowElement(key)?.focus();
  };

  const toggle = (taskKey: string) => {
    if (pinnedKeys.has(taskKey)) {
      ctx.unpin(taskKey);
      return;
    }
    const item = plan.candidates.find((candidate) => candidate.row.taskKey === taskKey);
    if (item) ctx.pin(taskKey, item.row.title);
  };

  const keyHandler = useRef<(event: KeyboardEvent) => void>(() => {});
  keyHandler.current = (event) => {
    if (shouldIgnoreTriageEvent(event) || rowKeys.length === 0) return;
    const index = rowKeys.indexOf(focusedKey ?? '');
    switch (event.key) {
      case 'j': case 'ArrowDown': focusRow(rowKeys[Math.min(rowKeys.length - 1, index + 1)]!); break;
      case 'k': case 'ArrowUp': focusRow(rowKeys[Math.max(0, index < 0 ? 0 : index - 1)]!); break;
      case 'p': if (index >= 0) toggle(rowKeys[index]!); else return; break;
      case 'o': case 'Enter':
        if (index < 0 || (event.key === 'Enter' && (event.target as HTMLElement).tagName !== 'DIV')) return;
        ctx.openTask(rowKeys[index]!);
        break;
      default: return;
    }
    event.preventDefault();
  };
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => keyHandler.current(event);
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  const nothing = plan.total === 0 && ctx.pins.length === 0 && plan.backFromLater.length === 0;
  if (nothing) {
    return (
      <EmptyState
        compact
        icon={<CalendarPlus size={20} />}
        title="Nothing planned next week"
        action={<button type="button" className="ui-btn" onClick={ctx.capture}>Capture a task</button>}
      />
    );
  }

  const rowProps = (key: string, first: boolean) => ({
    role: 'listitem' as const,
    'data-review-row': key,
    tabIndex: key === focusedKey || (!focusedKey && first) ? 0 : -1,
    onFocus: (event: React.FocusEvent<HTMLElement>) => { if (event.target === event.currentTarget) setFocusedKey(key); },
  });

  return (
    <div ref={listRef} className="review-groups">
      <section role="group" aria-labelledby="review-group-top3" className="review-group">
        <h3 id="review-group-top3" className="sr-only">Top {TODAY_TOP_LIMIT} for {day}</h3>
        <div role="list">
          {Array.from({ length: TODAY_TOP_LIMIT }, (_, slot) => {
            const pin = ctx.pins[slot];
            if (!pin) {
              return (
                <div key={`slot-${slot}`} role="listitem" className="review-row review-slot" data-empty="true" aria-label={`Top ${TODAY_TOP_LIMIT}, slot ${slot + 1}, empty`}>
                  <span className="review-slot-mark" aria-hidden="true">{slot + 1}</span>
                  <span className="review-slot-empty" aria-hidden="true" />
                  <span />
                </div>
              );
            }
            return (
              <div key={pin.taskKey} className="review-row review-slot" data-filled="true" {...rowProps(pin.taskKey, slot === 0)}>
                <span className="review-slot-mark" aria-hidden="true"><Pin size={11} fill="currentColor" /></span>
                <span className="review-row-body">
                  <button type="button" className="review-row-title-btn" tabIndex={-1} onClick={() => ctx.openTask(pin.taskKey)}>
                    <span className="review-row-title">{pin.title}</span>
                  </button>
                  {pin.oneOnOne ? <span className="review-row-meta"><span className="ui-chip" data-quiet="true">1:1 · not in your update</span></span> : null}
                </span>
                <span className="review-row-actions">
                  <button type="button" className="ui-btn-ghost" tabIndex={-1} aria-label={`Remove ${pin.title} from ${day}'s top ${TODAY_TOP_LIMIT}`} onClick={() => ctx.unpin(pin.taskKey)}>
                    <PinOff size={13} aria-hidden="true" />
                    Remove
                  </button>
                </span>
              </div>
            );
          })}
        </div>
      </section>

      {shown.length > 0 ? (
        <section role="group" aria-labelledby="review-group-candidates" className="review-group">
          <div className="review-group-head">
            <h3 id="review-group-candidates" className="today-subhead review-subhead">Candidates · {candidates.length}</h3>
          </div>
          <div role="list">
            {shown.map((item, index) => (
              <CandidateRow
                key={item.row.taskKey}
                item={item}
                nextWorkday={ctx.review.nextWorkday}
                full={full}
                rowProps={rowProps(item.row.taskKey, ctx.pins.length === 0 && index === 0)}
                onOpen={() => ctx.openTask(item.row.taskKey)}
                onPick={() => ctx.pin(item.row.taskKey, item.row.title)}
              />
            ))}
          </div>
          {candidates.length > CANDIDATES_SHOWN ? (
            <button type="button" className="today-panel-more" aria-expanded={showAll} onClick={() => setShowAll((value) => !value)}>
              {showAll ? 'Show fewer' : `+${candidates.length - CANDIDATES_SHOWN} more`}
            </button>
          ) : null}
        </section>
      ) : null}

      <section role="group" aria-labelledby="review-group-week" className="review-group">
        <div className="review-group-head">
          <h3 id="review-group-week" className="today-subhead review-subhead">{ctx.review.nextWorkday === ctx.review.range.nextStart ? 'Planned next week' : 'Planned ahead'} · {plan.total}</h3>
        </div>
        <ul className="review-days" aria-label="Planned tasks per day">
          {plan.days.map((entry) => (
            <li key={entry.date} className="review-day" data-empty={entry.count === 0 || undefined}>
              <span className="review-day-name">{entry.label}</span>
              <span className="review-day-count">{entry.count === 0 ? '–' : entry.count}</span>
              <span className="sr-only">{entry.count === 0 ? 'nothing planned' : `${entry.count} planned`}</span>
            </li>
          ))}
        </ul>
      </section>

      {plan.backFromLater.length > 0 ? (
        <section role="group" aria-labelledby="review-group-later" className="review-group">
          <div className="review-group-head">
            <h3 id="review-group-later" className="today-subhead review-subhead">Back from Later next week · {plan.backFromLater.length}</h3>
          </div>
          <div role="list">
            {plan.backFromLater.map((row) => (
              <div key={row.taskKey} role="listitem" className="review-row review-later-row">
                <span className="review-row-glyph"><Moon size={14} aria-hidden="true" /></span>
                <span className="review-row-body">
                  <button type="button" className="review-row-title-btn" tabIndex={-1} onClick={() => ctx.openTask(row.taskKey)}>
                    <span className="review-row-title">{row.title}</span>
                  </button>
                </span>
                <span className="review-row-end">{comesBackLabel(row)}</span>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function CandidateRow({
  item,
  nextWorkday,
  full,
  rowProps,
  onOpen,
  onPick,
}: {
  item: PlannedRow;
  nextWorkday: string;
  full: boolean;
  rowProps: Record<string, unknown>;
  onOpen: () => void;
  onPick: () => void;
}) {
  const plannedDay = item.planDate === nextWorkday ? format(parseISO(nextWorkday), 'EEE') : format(parseISO(item.planDate), 'EEE d MMM');
  return (
    <div className="review-row review-candidate-row" {...rowProps}>
      <span className="review-row-glyph"><Pin size={14} aria-hidden="true" /></span>
      <span className="review-row-body">
        <span className="review-row-title-line">
          <button type="button" className="review-row-title-btn" tabIndex={-1} onClick={onOpen}>
            <span className="review-row-title">{item.row.title}</span>
          </button>
          {item.row.priority === 'high' ? <span className="review-row-flag" title="High priority"><Flag size={12} fill="currentColor" aria-label="High priority" /></span> : null}
        </span>
        <span className="review-row-meta">
          {item.movedToMonday ? <span className="ui-chip tone-accent">Moved to {format(parseISO(nextWorkday), 'EEE')}</span> : null}
          <span>{plannedDay}</span>
        </span>
      </span>
      <span className="review-row-actions">
        <button type="button" className="ui-btn" tabIndex={-1} disabled={full} title={full ? 'Your top 3 is full. Remove one first.' : undefined} onClick={onPick}>Pick</button>
      </span>
    </div>
  );
}
