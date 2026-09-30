import { ArrowLeft, Check, ClipboardCopy } from 'lucide-react';
import type { TrackerDeveloperDay } from '@/types';
import type { StandupSession } from '@/lib/standup';

/** docs/50 §5: end-of-session review — coverage, follow-ups, and what was logged. */
export function StandupWrapUp({
  days,
  session,
  taskDrafts,
  onRecoverTask,
  onRecoverNote,
  sealing = false,
  saveToNote = true,
  onSaveToNoteChange,
  onJump,
  onBack,
  onEnd,
  onCopy,
}: {
  days: TrackerDeveloperDay[];
  session: StandupSession;
  taskDrafts: Array<{ taskKey: string; person?: { name: string } }>;
  onRecoverTask: (key: string) => void;
  onRecoverNote: (id: string) => void;
  /** True while the End request is in flight. */
  sealing?: boolean;
  /** Whether Finish also files the summary under Notes → Standups. */
  saveToNote?: boolean;
  onSaveToNoteChange?: (save: boolean) => void;
  onJump: (accountId: string) => void;
  onBack: () => void;
  onEnd: () => void;
  onCopy: () => void;
}) {
  const visited = days.filter((day) => session.reviewed.includes(day.developer.accountId));
  const unvisited = days.filter((day) => !session.reviewed.includes(day.developer.accountId));
  const flags = days.filter((day) => session.flagged.includes(day.developer.accountId));
  const drafts = days.filter((day) => session.noteDrafts?.[day.developer.accountId]?.text.trim());
  const savingVisits = session.reviewed.some((id) => !session.acknowledged?.includes(id));
  const blockedReason = savingVisits
    ? 'Visits are still being saved. If this does not clear, use Retry in the banner above.'
    : drafts.length > 0 || taskDrafts.length > 0
      ? 'Send or discard the drafts above to finish.'
      : '';
  const outcome = `Finish saves this round${flags.length ? ` and creates ${flags.length} follow-up task${flags.length === 1 ? '' : 's'}` : ''}${saveToNote ? ', and adds a summary to Notes → Standups' : ''}.`;

  return (
    <section
      className="mx-auto w-full max-w-[760px] px-5 py-7 sm:px-8"
      data-testid="standup-wrapup"
    >
      <h2 data-standup-person tabIndex={-1} className="text-xl font-semibold outline-none">{session.receipt ? 'Round saved' : 'Finish standup'}</h2>
      <p className="mt-2 text-sm" style={{ color: 'var(--text-secondary)' }}>{visited.length} of {days.length} people visited</p>
      {unvisited.length > 0 && <section className="mt-6 border-t pt-4" style={{ borderColor: 'var(--border)' }}>
        <h3 className="text-xs font-semibold">Not visited</h3>
        <div className="mt-2 flex flex-wrap gap-2">
          {unvisited.map((day) => <button key={day.developer.accountId} type="button" disabled={!!session.request} className="ui-btn-quiet" onClick={() => onJump(day.developer.accountId)} aria-label={`Go to ${day.developer.displayName}`}>{day.developer.displayName}</button>)}
        </div>
      </section>}
      {flags.length > 0 && <section className="mt-6 border-t pt-4" style={{ borderColor: 'var(--border)' }}>
        <h3 className="text-sm font-semibold">{session.receipt ? 'Follow-ups saved' : 'Follow-ups to save'}</h3>
        <ul className="mt-2 divide-y divide-[var(--border)]">
          {flags.map((day) => <li key={day.developer.accountId} className="py-3">
            <button type="button" disabled={!!session.request} onClick={() => onJump(day.developer.accountId)} aria-label={`Go to ${day.developer.displayName}`} className="text-left text-sm font-medium hover:underline">{day.developer.displayName}</button>
            {session.flagReasons?.[day.developer.accountId] && <p className="mt-1 break-words text-sm" style={{ color: 'var(--text-secondary)' }}>{session.flagReasons[day.developer.accountId]}</p>}
          </li>)}
        </ul>
      </section>}
      {drafts.length > 0 && <section className="mt-5" aria-label="Unsent person notes">
        <h3 className="text-sm font-semibold">Notes still in draft</h3>
        {drafts.map((day) => <button key={day.developer.accountId} type="button" onClick={() => onRecoverNote(day.developer.accountId)} className="ui-btn-quiet">{day.developer.displayName}</button>)}
      </section>}
      {taskDrafts.length > 0 && <section className="mt-5" aria-label="Unsent task updates">
        <h3 className="text-sm font-semibold">Task updates still in draft</h3>
        {taskDrafts.map((draft) => <button key={draft.taskKey} type="button" onClick={() => onRecoverTask(draft.taskKey)} className="ui-btn-quiet">{draft.taskKey}{draft.person ? ` · ${draft.person.name}` : ''}</button>)}
      </section>}
      {!session.receipt && <p className="mt-6 text-sm" style={{ color: 'var(--text-muted)' }}>{outcome}</p>}
      <label className="mt-2 flex w-fit cursor-pointer items-center gap-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
        <input type="checkbox" checked={saveToNote} onChange={(event) => onSaveToNoteChange?.(event.target.checked)} disabled={sealing} className="h-3.5 w-3.5 accent-[var(--accent)]" />
        Add summary to Notes <span style={{ color: 'var(--text-muted)' }}>— standup archive, not your scratchpad</span>
      </label>
      {blockedReason && <p id="standup-finish-blocked" role="status" className="mt-3 text-sm" style={{ color: 'var(--warning, var(--text-secondary))' }}>{blockedReason}</p>}
      <div className="mt-4 flex flex-wrap items-center gap-2 border-t pt-4" style={{ borderColor: 'var(--border)' }}>
        <button type="button" className="ui-btn-quiet" onClick={onBack} disabled={!!session.request}><ArrowLeft size={15} />Back</button>
        <button type="button" className="ui-btn-quiet" onClick={onCopy} aria-label="Copy summary"><ClipboardCopy size={15} />Copy summary</button>
        <button type="button" className="ui-btn-solid ml-auto" onClick={onEnd} disabled={sealing || !!blockedReason} aria-describedby={blockedReason ? 'standup-finish-blocked' : undefined}><Check size={15} />{sealing ? 'Saving…' : session.receipt ? 'Retry Notes archive' : session.request ? 'Retry finish' : 'Finish standup'}</button>
      </div>
    </section>
  );
}
