import { useEffect, useMemo, useRef, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { CalendarCheck, Flag } from 'lucide-react';
import { EmptyState } from '@/components/ui/EmptyState';
import { ReviewJiraSummary } from './ReviewJiraSummary';
import { ReviewSourceNote } from './ReviewSourceNote';
import { shouldIgnoreTriageEvent } from '@/lib/today-triage';
import { defaultInUpdate, findSection, type ReviewStepContext } from '@/lib/weekly-review';
import type { WeeklyReviewTaskRow } from '@/types';

interface Group {
  id: 'mine' | 'delegated';
  label: string;
  rows: WeeklyReviewTaskRow[];
}

function closedLabel(row: WeeklyReviewTaskRow): string {
  if (!row.closedDay) return 'Closed';
  return `${row.status === 'dropped' ? 'Dropped' : 'Closed'} ${format(parseISO(row.closedDay), 'EEE')}`;
}

/**
 * docs/59 §5.3 step 1: what closed this week, grouped Mine / Delegated. Every row carries an
 * "In update" checkbox (on for done work, off for dropped work and meetings). Nothing here needs a
 * decision: an untouched row is simply kept, so the step is a quick read, not a chore.
 */
export function ReviewLookBackStep({ ctx }: { ctx: ReviewStepContext }) {
  const closed = findSection(ctx.review, 'closed');
  const groups = useMemo<Group[]>(() => {
    const rows = closed?.rows ?? [];
    return ([
      { id: 'mine', label: 'Mine', rows: rows.filter((row) => row.ownerType !== 'developer') },
      { id: 'delegated', label: 'Delegated', rows: rows.filter((row) => row.ownerType === 'developer') },
    ] as Group[]).filter((group) => group.rows.length > 0);
  }, [closed]);
  const flat = useMemo(() => groups.flatMap((group) => group.rows), [groups]);
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const included = (row: WeeklyReviewTaskRow) => ctx.isIncluded(row.taskKey, defaultInUpdate(row));
  const toggle = (row: WeeklyReviewTaskRow) => {
    const next = !included(row);
    ctx.setIncluded(row.taskKey, defaultInUpdate(row), next);
    ctx.announce(next ? 'Added to the update.' : 'Left out of the update.');
  };
  const setGroup = (group: Group, value: boolean) => {
    for (const row of group.rows) {
      if (included(row) !== value) ctx.setIncluded(row.taskKey, defaultInUpdate(row), value);
    }
    ctx.announce(value ? `Added ${group.rows.length} to the update.` : `Left ${group.rows.length} out of the update.`);
  };
  const focusRow = (key: string) => {
    setFocusedKey(key);
    listRef.current?.querySelector<HTMLElement>(`[data-review-row="${key}"]`)?.focus();
  };

  // j/k, x and o work from anywhere on the page except inside fields and dialogs.
  const keyHandler = useRef<(event: KeyboardEvent) => void>(() => {});
  keyHandler.current = (event) => {
    if (shouldIgnoreTriageEvent(event) || flat.length === 0) return;
    const index = flat.findIndex((row) => row.taskKey === focusedKey);
    const current = index >= 0 ? flat[index] : undefined;
    switch (event.key) {
      case 'j': case 'ArrowDown': focusRow(flat[Math.min(flat.length - 1, index + 1)]!.taskKey); break;
      case 'k': case 'ArrowUp': focusRow(flat[Math.max(0, index < 0 ? 0 : index - 1)]!.taskKey); break;
      case 'x': if (current) toggle(current); else return; break;
      case 'o': case 'Enter':
        // A focused control keeps Enter; only the row itself opens the task.
        if (!current || (event.key === 'Enter' && (event.target as HTMLElement).tagName !== 'DIV')) return;
        ctx.openTask(current.taskKey);
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

  if (closed?.status === 'unavailable') {
    return <ReviewSourceNote what="this week's closed tasks" onRetry={ctx.retry} />;
  }
  if (flat.length === 0 && !ctx.review.jira) {
    return (
      <EmptyState
        compact
        icon={<CalendarCheck size={20} />}
        title="Nothing closed this week"
        body="Tasks you finish or drop show up here, ready for your update."
      />
    );
  }

  return (
    <div ref={listRef} className="review-groups">
      {groups.map((group) => {
        const inUpdate = group.rows.filter(included).length;
        const allIn = inUpdate === group.rows.length;
        return (
          <section key={group.id} role="group" aria-labelledby={`review-group-${group.id}`} className="review-group">
            <div className="review-group-head">
              <h3 id={`review-group-${group.id}`} className="today-subhead review-subhead">
                {group.label} · {group.rows.length}
              </h3>
              <span className="review-group-tally" aria-live="off">
                {inUpdate} in update
              </span>
              <button type="button" className="ui-btn-ghost review-group-toggle" onClick={() => setGroup(group, !allIn)}>
                {allIn ? 'Leave all out' : 'Add all'}
              </button>
            </div>
            <div role="list">
              {group.rows.map((row) => {
                const isIn = included(row);
                const focused = row.taskKey === focusedKey;
                const dropped = row.status === 'dropped';
                const context = [
                  closedLabel(row),
                  row.ownerType === 'developer' ? ctx.personName(row.ownerId).split(' ')[0] : null,
                ].filter(Boolean).join(' · ');
                return (
                  <div
                    key={row.taskKey}
                    role="listitem"
                    className="review-row"
                    data-review-row={row.taskKey}
                    data-included={isIn}
                    data-focused={focused || undefined}
                    tabIndex={focused || (!focusedKey && row === flat[0]) ? 0 : -1}
                    onFocus={(event) => { if (event.target === event.currentTarget) setFocusedKey(row.taskKey); }}
                    onDoubleClick={() => ctx.openTask(row.taskKey)}
                  >
                    <input
                      type="checkbox"
                      className="review-check"
                      checked={isIn}
                      tabIndex={-1}
                      aria-label={row.title}
                      aria-describedby={`review-row-meta-${row.taskKey}`}
                      onChange={() => { setFocusedKey(row.taskKey); toggle(row); }}
                    />
                    <span className="review-row-body">
                      <span className="review-row-title-line">
                        <button type="button" className="review-row-title-btn" tabIndex={-1} onClick={() => ctx.openTask(row.taskKey)}>
                          <span className="review-row-title">{row.title}</span>
                        </button>
                        {row.priority === 'high' ? (
                          <span className="review-row-flag" title="High priority"><Flag size={12} fill="currentColor" aria-label="High priority" /></span>
                        ) : null}
                      </span>
                      <span id={`review-row-meta-${row.taskKey}`} className="review-row-meta">
                        {context}
                        {row.kind === 'meeting' ? ' · Meeting' : ''}
                      </span>
                    </span>
                    <span className="review-row-end">
                      {dropped ? <span className="ui-chip" data-quiet="true">Dropped</span> : null}
                      <span className="review-row-state" aria-hidden="true">{isIn ? '' : 'Left out'}</span>
                    </span>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
      <ReviewJiraSummary ctx={ctx} />
    </div>
  );
}
