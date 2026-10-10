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
  { id: 'tasks', title: 'Capture your first task', detail: 'A promise, a follow-up, or one thing to do today.', action: 'Capture' },
  { id: 'people', title: 'Add people', detail: 'Optional. Add your team when you’re ready for shared work and 1:1s.', action: 'Add' },
  { id: 'jira', title: 'Connect Jira', detail: 'Optional. Brings defects into Work and Today.', action: 'Connect' },
  { id: 'rhythm', title: 'Set your day rhythm', detail: 'Optional. Pick the times that fit your working day.', action: 'Set times' },
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
      <p className="today-getting-started-intro">Start with one task. Everything else can wait.</p>
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
                <button type="button" className={step.id === 'tasks' ? 'ui-btn-solid' : 'ui-btn'} onClick={() => run(step.id)}>{step.action}</button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
