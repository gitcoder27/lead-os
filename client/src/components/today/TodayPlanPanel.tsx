import { useState } from 'react';
import { Circle, CircleCheck, Inbox, ListTodo, Pin, PinOff, Plus } from 'lucide-react';
import { relativeTaskDate } from '@/lib/task-list';
import { TODAY_TOP_LIMIT } from '@/types';
import type { TodayActionCommand, TodayActionTarget, TodayPlanFocus, TodayPlanItem } from '@/types';
import type { TodayRunCommand } from './TodayActionRow';

interface TodayPlanPanelProps {
  plan: TodayPlanFocus;
  today: string;
  /** A pin write is in flight — the buttons wait for it. */
  pinning: boolean;
  onTogglePin: (taskKey: string) => void;
  onRunCommand: TodayRunCommand;
  onOpenTarget: (target: TodayActionTarget) => void;
  onCapture: () => void;
}

const PREVIEW = 6;

/** The row's one-line context: its plan date, or what state it is in. */
export function planDetail(item: TodayPlanItem, today: string): { text: string; overdue: boolean } | undefined {
  const date = relativeTaskDate({ scheduledOn: item.scheduledOn, dueAt: item.dueAt, status: item.status, closedAt: null, kind: item.kind ?? 'task' }, today);
  if (date && (date.tone === 'danger' || date.tone === 'warning')) return { text: date.label, overdue: true };
  if (item.status === 'active') return { text: 'In progress', overdue: false };
  if (item.status === 'blocked') return { text: 'Blocked', overdue: false };
  return date && date.label !== 'Today' ? { text: date.label, overdue: false } : undefined;
}

/**
 * docs/57 §6 (P3-01): "my plan" — my own tasks for today. Pick up to three to
 * pin them to the top of the queue; an empty plan says "Plan your day".
 */
export function TodayPlanPanel({ plan, today, pinning, onTogglePin, onRunCommand, onOpenTarget, onCapture }: TodayPlanPanelProps) {
  const [showAll, setShowAll] = useState(false);
  const pinned = plan.top3.length;
  const visible = showAll ? plan.items : plan.items.slice(0, PREVIEW);

  return (
    <section className="today-panel" aria-labelledby="today-plan-heading">
      <div className="today-panel-head">
        <h2 id="today-plan-heading" tabIndex={-1} className="today-section-title today-jump-target">My plan</h2>
        {plan.items.length > 0 ? <span className="today-section-count">{plan.items.length}</span> : null}
        {plan.items.length > 0 ? (
          <span className="today-section-actions today-section-hint" data-testid="today-plan-pin-hint">
            {pinned === 0 ? `Pick up to ${TODAY_TOP_LIMIT}` : `Top ${TODAY_TOP_LIMIT} · ${pinned}/${TODAY_TOP_LIMIT}`}
          </span>
        ) : null}
      </div>

      {plan.items.length === 0 ? (
        <div className="today-row today-tone-info" data-testid="today-plan-empty">
          <span className="today-row-icon" aria-hidden="true"><ListTodo size={14} /></span>
          <span className="today-row-link" style={{ cursor: 'default' }}>
            <span className="today-row-title-line"><span className="today-row-title">Plan your day</span></span>
            <span className="today-row-meta today-row-meta-wrap">Nothing is planned yet. Add a task or triage your inbox.</span>
          </span>
          <span className="today-row-actions">
            {plan.inboxCount > 0 ? (
              <button
                type="button"
                className="ui-btn-ghost"
                onClick={() => onOpenTarget({ type: 'view', view: 'tasks', taskView: 'inbox' })}
              >
                <Inbox size={13} aria-hidden="true" />
                {plan.inboxCount} to triage
              </button>
            ) : null}
            <button type="button" className="ui-btn" onClick={onCapture}>
              <Plus size={13} aria-hidden="true" />
              Add task
            </button>
          </span>
        </div>
      ) : (
        <>
          {visible.map((item) => {
            const detail = planDetail(item, today);
            const atLimit = !item.pinned && pinned >= TODAY_TOP_LIMIT;
            const PinIcon = item.pinned ? PinOff : Pin;
            return (
              <div key={item.taskKey} className={`today-row today-tone-${item.priority === 'high' ? 'warning' : 'neutral'}`} data-testid="today-plan-row" data-pinned={item.pinned}>
                <span className="today-row-icon" aria-hidden="true">
                  {item.pinned ? <Pin size={14} /> : <ListTodo size={14} />}
                </span>
                <button type="button" className="today-row-link" onClick={() => onRunCommand(openCommand(item.target))}>
                  <span className="today-row-title-line"><span className="today-row-title">{item.title}</span></span>
                  {detail ? (
                    <span className="today-row-meta" style={detail.overdue ? { color: 'var(--warning-text)' } : undefined}>{detail.text}</span>
                  ) : null}
                </button>
                <span className="today-row-actions">
                  <button
                    type="button"
                    className="ui-btn-ghost"
                    aria-label={item.pinned ? `Unpin ${item.title} from top ${TODAY_TOP_LIMIT}` : `Pin ${item.title} to top ${TODAY_TOP_LIMIT}`}
                    title={atLimit ? `Top ${TODAY_TOP_LIMIT} is full — unpin one first` : undefined}
                    disabled={pinning || atLimit}
                    onClick={() => onTogglePin(item.taskKey)}
                  >
                    <PinIcon size={13} aria-hidden="true" />
                  </button>
                  {/* docs/56 UX-19: a quiet check, like Tasks rows — it comes up on hover or focus. */}
                  <button
                    type="button"
                    className="today-plan-done"
                    aria-label={item.primaryAction.label}
                    title={`${item.primaryAction.label}: ${item.title}`}
                    onClick={() => onRunCommand(item.primaryAction)}
                  >
                    <Circle size={16} className="today-plan-done-idle" aria-hidden="true" />
                    <CircleCheck size={16} className="today-plan-done-hover" aria-hidden="true" />
                  </button>
                </span>
              </div>
            );
          })}
          {plan.items.length > PREVIEW ? (
            <button type="button" className="today-panel-more" aria-expanded={showAll} onClick={() => setShowAll((value) => !value)}>
              {showAll ? 'Show fewer' : `+${plan.items.length - PREVIEW} more`}
            </button>
          ) : null}
          {plan.inboxCount > 0 ? (
            <button
              type="button"
              className="today-panel-more"
              onClick={() => onOpenTarget({ type: 'view', view: 'tasks', taskView: 'inbox' })}
            >
              {plan.inboxCount} to triage in Inbox
            </button>
          ) : null}
        </>
      )}
    </section>
  );
}

function openCommand(target: TodayActionTarget): TodayActionCommand {
  return { kind: 'open', label: 'Open', target };
}
