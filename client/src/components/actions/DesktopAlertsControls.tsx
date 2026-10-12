import { BellOff, BellRing, X } from 'lucide-react';
import { useToast } from '@/context/ToastContext';
import { useDesktopAlerts } from '@/hooks/useDesktopAlerts';
import { useTaskInboxLatest } from '@/hooks/useTaskInbox';
import { showDesktopAlert } from '@/lib/desktop-alerts';
import './desktop-alerts.css';

/** Asks the browser, then proves it works with one notification so the person knows what to expect. */
function useTurnOnAlerts() {
  const alerts = useDesktopAlerts();
  const { addToast } = useToast();
  return async () => {
    const result = await alerts.enable();
    if (result === 'granted') {
      const shown = showDesktopAlert({
        title: 'Desktop alerts are on',
        body: 'You’ll see updates to your work here, even when LeadOS is in the background.',
        tag: 'leados-alerts-on',
        onClick: () => undefined,
      });
      addToast({ type: 'success', title: 'Desktop alerts are on', message: shown ? undefined : 'Your browser did not show the test notification; check your system notification settings.' });
    } else if (result === 'denied') {
      addToast({ type: 'warning', title: 'Notifications are blocked', message: 'Allow notifications for this site in your browser’s address bar, then turn alerts on again.' });
    }
  };
}

/** The standing control, in the updates inbox: one switch, and the one thing to do when the browser says no. */
export function DesktopAlertsSwitch() {
  const alerts = useDesktopAlerts();
  const turnOn = useTurnOnAlerts();
  if (!alerts.supported) return null;
  const blocked = alerts.permission === 'denied';
  return (
    <div className="desktop-alerts-row" data-state={blocked ? 'blocked' : alerts.enabled ? 'on' : 'off'}>
      <span className="desktop-alerts-icon" aria-hidden="true">{blocked || !alerts.enabled ? <BellOff size={15} /> : <BellRing size={15} />}</span>
      <div className="desktop-alerts-copy">
        <span id="desktop-alerts-label">Desktop alerts</span>
        <span id="desktop-alerts-hint">
          {blocked
            ? 'Blocked in this browser. Allow notifications for this site.'
            : alerts.enabled
              ? 'On. You’ll hear about changes when this tab is in the background.'
              : 'Get notified when this tab is in the background.'}
        </span>
      </div>
      {!blocked && (
        <button
          type="button"
          role="switch"
          aria-checked={alerts.enabled}
          aria-labelledby="desktop-alerts-label"
          aria-describedby="desktop-alerts-hint"
          className="desktop-alerts-switch"
          onClick={() => (alerts.enabled ? alerts.disable() : void turnOn())}
        >
          <span aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

/** A single, dismissible offer on first visit; never repeats once answered or dismissed. */
export function DesktopAlertsPrompt() {
  const alerts = useDesktopAlerts();
  const turnOn = useTurnOnAlerts();
  const inbox = useTaskInboxLatest();
  // Nothing to be alerted about where the workspace has no updates.
  if (!alerts.canOffer || !inbox.enabled) return null;
  return (
    <section className="desktop-alerts-prompt" aria-label="Desktop alerts">
      <span className="desktop-alerts-prompt-icon" aria-hidden="true"><BellRing size={16} /></span>
      <div className="desktop-alerts-prompt-body">
        <p className="desktop-alerts-prompt-title">Know the moment your work changes</p>
        <p className="desktop-alerts-prompt-text">
          Get a desktop notification when a task is assigned, rescheduled, re-prioritised or commented on, even while this tab is in the background.
        </p>
        <div className="desktop-alerts-prompt-actions">
          <button type="button" className="ui-btn" onClick={() => void turnOn()}>Turn on alerts</button>
          <button type="button" className="ui-btn-ghost" onClick={alerts.dismissPrompt}>Not now</button>
        </div>
      </div>
      <button type="button" className="desktop-alerts-prompt-close" aria-label="Dismiss" title="Dismiss" onClick={alerts.dismissPrompt}>
        <X size={15} />
      </button>
    </section>
  );
}
