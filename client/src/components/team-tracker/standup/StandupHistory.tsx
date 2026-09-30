import { Bell, RefreshCw } from 'lucide-react';
import type { StandupSessionDetail } from '@/types';
import { describeLogEntry } from '@/lib/standup';
import { formatRelativeTime } from '@/lib/utils';
import { SectionLabel, ToneChip } from './StandupPrimitives';

/**
 * docs/50 v2: read-only recall of the last sealed standup — what was covered,
 * flagged and logged — so a second round can pick up where the previous one
 * ended. Rendered inside the standup layer shell.
 */
export function StandupHistory({
  session,
  isLoading,
  isError,
  onRetry,
  nameFor,
}: {
  session: StandupSessionDetail | null | undefined;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  nameFor: (accountId: string) => string;
}) {
  if (isLoading) {
    return <p className="px-4 py-8 text-center text-[12.5px]" style={{ color: 'var(--text-muted)' }}>Loading…</p>;
  }
  if (isError) {
    return (
      <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
        <p className="text-[12.5px]" style={{ color: 'var(--text-muted)' }}>Couldn’t load the previous standup.</p>
        <button type="button" onClick={onRetry} className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] font-semibold" style={{ color: 'var(--accent)', background: 'var(--accent-glow)' }}>
          <RefreshCw size={12} /> Retry
        </button>
      </div>
    );
  }
  if (!session) {
    return (
      <p className="px-4 py-8 text-center text-[12.5px]" style={{ color: 'var(--text-muted)' }}>
        No sealed standup yet — this view fills in once you end a round.
      </p>
    );
  }

  const flagged = session.flagged;
  const logged = session.log.filter((entry) => entry.accountId);
  const byPerson = new Map<string, typeof logged>();
  for (const entry of logged) {
    const list = byPerson.get(entry.accountId) ?? [];
    list.push(entry);
    byPerson.set(entry.accountId, list);
  }

  return (
    <div className="max-h-[60vh] overflow-y-auto px-4 py-3.5" data-testid="standup-history">
      <p className="text-[12px] tabular-nums" style={{ color: 'var(--text-muted)' }}>
        Ended {formatRelativeTime(session.endedAt)} · {session.reviewed.length} visited
        {flagged.length > 0 ? ` · ${flagged.length} flagged` : ''}
      </p>

      {flagged.length > 0 && (
        <section className="mt-3.5">
          <SectionLabel>Flagged in this round</SectionLabel>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {flagged.map((id) => (
              <ToneChip key={id} tone="warning">
                <Bell size={10} /> {nameFor(id)}{session.flagReasons?.[id] ? `: ${session.flagReasons[id]}` : ''}
              </ToneChip>
            ))}
          </div>
        </section>
      )}

      {byPerson.size > 0 && (
        <section className="mt-4">
          <SectionLabel>What you logged</SectionLabel>
          <ul className="mt-1.5 space-y-2.5">
            {[...byPerson.entries()].map(([accountId, entries]) => (
              <li key={accountId}>
                <span className="text-[12px] font-semibold" style={{ color: 'var(--text-primary)' }}>{nameFor(accountId)}</span>
                <ul className="mt-0.5 space-y-0.5">
                  {entries.map((entry, index) => (
                    <li key={index} className="flex items-baseline gap-2 text-[12px]" style={{ color: 'var(--text-secondary)' }}>
                      <span className="min-w-0 flex-1">{entry.kind === 'checkin' ? 'Added a person note' : describeLogEntry(entry)}</span>
                      <span className="shrink-0 text-[11px] tabular-nums" style={{ color: 'var(--text-muted)' }}>{formatRelativeTime(entry.at)}</span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </section>
      )}

      {session.summary && (
        <section className="mt-4">
          <SectionLabel>Summary</SectionLabel>
          <pre
            className="mt-1.5 whitespace-pre-wrap rounded-lg px-3 py-2.5 font-sans text-[12px] leading-5"
            style={{ color: 'var(--text-secondary)', background: 'var(--bg-tertiary)' }}
          >
            {session.summary}
          </pre>
        </section>
      )}
    </div>
  );
}
