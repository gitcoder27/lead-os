import { Check, ClipboardCopy, Flag } from 'lucide-react';
import type { StandupFollowUpPlan, TrackerDeveloperDay } from '@/types';
import type { StandupSession } from '@/lib/standup';
import { followUpPlan, wrapUpConcern } from '@/lib/standup-wrapup';
import { getLocalIsoDate } from '@/lib/utils';

export function StandupFollowThrough({ days, session, disabled, onToggle, onPlan, onJump, onCopy }: {
  days: TrackerDeveloperDay[];
  session: StandupSession;
  disabled: boolean;
  onToggle?: (id: string) => void;
  onPlan?: (id: string, plan: StandupFollowUpPlan) => void;
  onJump: (id: string) => void;
  onCopy?: () => void;
}) {
  const flags = days.filter((day) => session.flagged.includes(day.developer.accountId));
  const suggestions = days.filter((day) => !session.flagged.includes(day.developer.accountId) && wrapUpConcern(day, session) && !day.developer.isSelf && day.availability.state === 'active');
  return <section aria-labelledby="standup-actions-title" className="standup-actions">
    <div className="standup-section-heading"><div><span className="standup-eyebrow">For you</span><h3 id="standup-actions-title">Your follow-through</h3></div>
      {flags.length > 0 && <button type="button" className="ui-btn-icon" aria-label="Copy your actions" title="Copy your actions" onClick={onCopy}><ClipboardCopy size={16} /></button>}
    </div>
    <p className="standup-section-description">Turn concerns into actions you own. Finish saves them to your tasks.</p>
    <h4 className="standup-subheading">{session.receipt ? 'Follow-ups saved' : 'Follow-ups to save'} <span>{flags.length}</span></h4>
    {flags.length === 0 && <div className="standup-empty"><Check size={18} /><div><p>No follow-ups selected</p><span>Flag a person during the round or choose a concern below.</span></div></div>}
    {flags.map((day) => {
      const id = day.developer.accountId;
      const plan = followUpPlan(day, session);
      const concern = wrapUpConcern(day, session);
      return <div key={id} className="standup-action-row">
        <div className="flex items-center gap-2"><Flag size={14} className="shrink-0 text-[var(--accent)]" /><button type="button" disabled={disabled} className="standup-person-link" onClick={() => onJump(id)} aria-label={`Go to ${day.developer.displayName}`}>{day.developer.displayName}</button>
          {!disabled && <button type="button" className="standup-text-button ml-auto" onClick={() => onToggle?.(id)} aria-label={`Remove follow-up for ${day.developer.displayName}`}>Remove</button>}
        </div>
        {concern && <p className="standup-concern">{concern}</p>}
        <label className="standup-field"><span>Next action</span><input type="text" value={plan.title} maxLength={500} required disabled={disabled} aria-label={`Next action for ${day.developer.displayName}`} onChange={(event) => onPlan?.(id, { ...plan, title: event.target.value })} /></label>
        <div className="standup-action-meta"><span>Owner <strong>You</strong></span><label><span>Check by</span><input type="date" aria-label={`Check by for ${day.developer.displayName}`} value={plan.followUpAt ? getLocalIsoDate(new Date(plan.followUpAt)) : ''} disabled={disabled} onChange={(event) => {
          const value = event.target.value;
          const parsed = value ? new Date(`${value}T09:00:00`) : undefined;
          onPlan?.(id, { title: plan.title, ...(parsed && Number.isFinite(parsed.getTime()) && { followUpAt: parsed.toISOString() }) });
        }} /></label></div>
        {!plan.followUpAt && <p className="standup-field-hint">Check by now, unless you choose a date.</p>}
      </div>;
    })}
    {suggestions.length > 0 && <div className="standup-suggestions"><h4 className="standup-subheading">Worth a follow-up <span>{suggestions.length}</span></h4><p className="standup-field-hint">Choose which concerns need your action.</p>
      {suggestions.map((day) => <label key={day.developer.accountId} className="standup-suggestion"><input type="checkbox" disabled={disabled} checked={false} onChange={() => onToggle?.(day.developer.accountId)} /><span><strong>{day.developer.displayName}</strong><span>{wrapUpConcern(day, session)}</span></span></label>)}
    </div>}
  </section>;
}
