import { Circle, CircleCheck, X } from 'lucide-react';
import type { TodayActionTarget, TodayGettingStarted as GettingStartedFlags } from '@/types';

interface TodayGettingStartedProps {
  steps: GettingStartedFlags;
  onCapture: () => void;
  onOpenTarget: (target: TodayActionTarget) => void;
  onDismiss: () => void;
}

interface Step {
  id: keyof GettingStartedFlags;
  title: string;
  detail: string;
  action: string;
}

const STEPS: Step[] = [
  { id: 'tasks', title: 'Capture a task', detail: 'Write down one thing you owe someone. Ctrl/Cmd+I works from anywhere.', action: 'Capture' },
  { id: 'people', title: 'Add people', detail: 'Your team members show up on Team, in 1:1s and in follow-ups.', action: 'Add' },
  { id: 'jira', title: 'Connect Jira', detail: 'Optional. Brings defects into Work and Today.', action: 'Connect' },
  { id: 'rhythm', title: 'Set your day rhythm', detail: 'Pick when standup, midday and wrap-up start.', action: 'Set times' },
];

/**
 * docs/56 P2-02: the first-run state. Four steps, done ones tick off, and the
 * whole card can be dismissed for good (a per-viewer choice). It disappears on
 * its own once every step is done.
 */
export function TodayGettingStarted({ steps, onCapture, onOpenTarget, onDismiss }: TodayGettingStartedProps) {
  const done = STEPS.filter((step) => steps[step.id]).length;

  const run = (id: Step['id']) => {
    if (id === 'tasks') onCapture();
    else if (id === 'people') onOpenTarget({ type: 'view', view: 'settings', section: 'team' });
    else if (id === 'jira') onOpenTarget({ type: 'view', view: 'settings', section: 'connection' });
    else onOpenTarget({ type: 'view', view: 'settings', section: 'rhythm' });
  };

  return (
    <section className="today-getting-started" aria-labelledby="today-getting-started-heading" data-testid="today-getting-started">
      <div className="today-panel-head">
        <h2 id="today-getting-started-heading" className="today-section-title">Get started</h2>
        <span className="today-section-count">{done} of {STEPS.length}</span>
        <span className="today-section-actions">
          <button type="button" className="ui-btn-ghost" onClick={onDismiss} aria-label="Dismiss getting started">
            <X size={13} aria-hidden="true" />
            Dismiss
          </button>
        </span>
      </div>
      <ul className="today-getting-started-list">
        {STEPS.map((step) => {
          const isDone = steps[step.id];
          return (
            <li key={step.id} className="today-getting-started-step" data-done={isDone ? 'true' : 'false'}>
              {isDone
                ? <CircleCheck size={16} style={{ color: 'var(--success)' }} aria-hidden="true" />
                : <Circle size={16} style={{ color: 'var(--text-muted)' }} aria-hidden="true" />}
              <span className="min-w-0 flex-1">
                <span className="today-getting-started-title">
                  {step.title}
                  {isDone ? <span className="sr-only"> (done)</span> : null}
                </span>
                <span className="today-getting-started-detail">{step.detail}</span>
              </span>
              {isDone ? null : (
                <button type="button" className="ui-btn ui-btn-sm" onClick={() => run(step.id)}>{step.action}</button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
