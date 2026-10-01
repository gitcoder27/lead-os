import { forwardRef } from 'react';
import { CircleCheck } from 'lucide-react';
import { TodayActionRow, TodayGroupRow, type TodayRunCommand } from './TodayActionRow';
import type { TodayQueueGroup } from '@/lib/today-layout';
import type { TodayQueueView } from '@/lib/today-triage';
import type { TodayActionGroup, TodayActionItem, TodayActionTarget } from '@/types';

interface TodayActionQueueProps {
  view: TodayQueueView;
  expanded: boolean;
  onToggleExpanded: () => void;
  activeItemId?: string;
  pendingTargetKey?: string;
  /** docs/53 U2 / docs/57 §6: tasks finished today (from real completions). */
  cleared: number;
  /** What comes next once the queue is empty (e.g. "Wrap-up at 16:00"). */
  nextUp?: string;
  /** Same-reason people rows collapsed into one row (see groupQueueItems). */
  groups?: Map<string, TodayQueueGroup>;
  expandedGroups?: Set<string>;
  onToggleGroup?: (id: string) => void;
  today?: string;
  /** docs/63 #6: a source failed, so an empty queue is not evidence that nothing needs attention. */
  incomplete?: boolean;
  /** Where the rows past the shipped cap live (existing workspaces). */
  handoff?: Array<{ label: string; target: TodayActionTarget }>;
  onOpenTarget?: (target: TodayActionTarget) => void;
  onRunCommand: TodayRunCommand;
}

const groupLabels: Record<TodayActionGroup, string> = {
  now: 'Now',
  next: 'Next',
  later: 'Later',
};

/**
 * docs/53 U1/F13/U2: the queue owns actions. Its first row is the priority
 * ("Start here"); "+N more" expands in place by Now / Next / Later; the
 * header shows what's been cleared, and an empty queue says so plainly.
 */
export const TodayActionQueue = forwardRef<HTMLHeadingElement, TodayActionQueueProps>(function TodayActionQueue(
  { view, expanded, onToggleExpanded, activeItemId, pendingTargetKey, cleared, nextUp, groups, expandedGroups, onToggleGroup, today, incomplete = false, handoff = [], onOpenTarget, onRunCommand },
  headingRef,
) {
  const actionable = view.head.filter((item) => item.type !== 'calm');
  const isDone = actionable.length === 0;
  const remaining = view.totalCount;
  const renderRow = (item: TodayActionItem, featured: boolean) => {
    const group = groups?.get(item.id);
    if (group) {
      return (
        <TodayGroupRow
          key={item.id}
          item={item}
          group={group}
          featured={featured}
          today={today}
          expanded={Boolean(expandedGroups?.has(item.id))}
          isActive={activeItemId === item.id}
          pendingKey={(member) => pendingTargetKey === targetKey(member)}
          onToggle={() => onToggleGroup?.(item.id)}
          onRunCommand={onRunCommand}
        />
      );
    }
    return (
      <TodayActionRow
        key={item.id}
        item={item}
        featured={featured}
        today={today}
        isActive={activeItemId === item.id}
        isPending={pendingTargetKey === targetKey(item)}
        onRunCommand={onRunCommand}
      />
    );
  };
  const canExpand = expanded || view.hiddenCount > 0;

  return (
    <section aria-labelledby="today-queue-heading" data-today-queue="">
      <div className="today-section-head">
        <h2 id="today-queue-heading" ref={headingRef} tabIndex={-1} className="today-section-title">Queue</h2>
        {!isDone ? <span className="today-section-count">{remaining}</span> : null}
        {/* What I actually finished today — a plain fact, not a ratio against a queue that changes under it. */}
        {cleared > 0 ? <span className="today-section-actions today-freshness">{cleared} done today</span> : null}
      </div>

      {isDone ? (
        incomplete ? (
          <div className="today-done" role="status">
            <div className="min-w-0">
              <p className="today-done-title">Nothing to show, but not everything loaded</p>
              <p className="today-done-next">Retry above before treating the queue as clear.</p>
            </div>
          </div>
        ) : (
          <div className="today-done" role="status">
            <CircleCheck size={18} style={{ color: 'var(--success)' }} aria-hidden="true" />
            <div className="min-w-0">
              <p className="today-done-title">{cleared > 0 ? `No urgent exceptions · ${cleared} done today` : 'No urgent exceptions'}</p>
              {nextUp ? <p className="today-done-next">Next: {nextUp}</p> : null}
            </div>
          </div>
        )
      ) : (
        <div className="today-list">
          {view.head.map((item, index) => renderRow(item, index === 0))}
          {/* docs/53 F13: overflow expands in place, grouped Now / Next / Later. */}
          {view.groups.map((entry) => (
            <div key={entry.group} role="group" aria-label={`${groupLabels[entry.group]} (${entry.items.length})`}>
              <h3 className="today-subhead">
                {groupLabels[entry.group]} · {entry.items.length}
              </h3>
              {entry.items.map((item) => renderRow(item, false))}
            </div>
          ))}
          {canExpand ? (
            <button type="button" onClick={onToggleExpanded} aria-expanded={expanded} className="today-more">
              {expanded
                ? view.hiddenCount > 0
                  ? `Show less · ${view.hiddenCount} more`
                  : 'Show less'
                : `+${view.hiddenCount} more`}
            </button>
          ) : null}
          {view.unreachableCount > 0 ? (
            <p className="today-truncated" data-testid="today-truncated">
              {view.unreachableCount} lower-priority {view.unreachableCount === 1 ? 'item isn’t' : 'items aren’t'} loaded on Today.
              {handoff.length > 0 ? ' See the full list in ' : ''}
              {handoff.map((link, index) => (
                <span key={link.label}>
                  {index > 0 ? (index === handoff.length - 1 ? ' or ' : ', ') : ''}
                  <button type="button" className="ui-link" onClick={() => onOpenTarget?.(link.target)}>{link.label}</button>
                </span>
              ))}
              {handoff.length > 0 ? '.' : ''}
            </p>
          ) : null}
        </div>
      )}
    </section>
  );
});

export function targetKey(item: Pick<TodayActionItem, 'target'>): string {
  return [
    item.target.type,
    item.target.issueKey,
    item.target.developerAccountId,
    item.target.managerDeskItemId,
    item.target.trackerItemId,
  ].filter(Boolean).join(':');
}
