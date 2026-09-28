import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, History } from 'lucide-react';
import type { OneOnOneAgendaItem, OneOnOneSeriesDetail, OneOnOneSession } from '@/types';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { EmptyState } from '@/components/ui/EmptyState';
import { FOCUS_RING } from '@/components/ui/focus';
import { TaskStatusGlyph } from '@/components/tasks/TaskMenus';
import { renderMarkdownLite } from '@/components/assistant/markdown-lite';
import { getLocalIsoDate } from '@/lib/utils';
import { closedSessions, formatDay, notesPreview, relativeDay, sessionSnapshot } from './oneOnOneFormat';

const STATUS_TONES: Record<OneOnOneSession['status'], { label: string; color: string }> = {
  scheduled: { label: 'Scheduled', color: 'var(--accent)' },
  done: { label: 'Done', color: 'var(--success)' },
  skipped: { label: 'Skipped', color: 'var(--text-muted)' },
};

/** Topics shown in a collapsed snapshot before "+N". */
const SNAPSHOT_PREVIEW = 4;

/**
 * docs/48 §4.2 column 3. "What did we cover last time?" is the question —
 * so the most recent session leads, open, with its notes and the topics that
 * were on the agenda; older sessions stay one glanceable line each.
 */
export function HistoryColumn({ detail, onOpenTask }: { detail: OneOnOneSeriesDetail; onOpenTask?: (taskKey: string) => void }) {
  const today = getLocalIsoDate();
  const entries = useMemo(
    () =>
      closedSessions(detail.sessions).map(({ session, previousClosedAt }) => ({
        session,
        topics: sessionSnapshot(detail.agenda, session, previousClosedAt),
      })),
    [detail.agenda, detail.sessions],
  );
  const [latest, ...older] = entries;

  return (
    <section className="one-on-one-column flex min-h-0 flex-col" aria-label="1:1 history">
      <SectionHeader as="h2" title="History" count={entries.length} />
      <div className="mt-2 min-h-0 flex-1 overflow-y-auto" data-testid="one-on-one-history">
        {!latest ? (
          <EmptyState
            compact
            icon={<History size={18} />}
            title="No past sessions yet"
            body="When you complete or skip a session, its notes and topics land here."
          />
        ) : (
          <>
            <LastTime session={latest.session} topics={latest.topics} today={today} onOpenTask={onOpenTask} />
            {older.length > 0 && (
              <>
                <div className="mb-1 mt-4 px-1.5 text-[12px] font-semibold" style={{ color: 'var(--text-muted)' }}>
                  Earlier
                </div>
                <ul>
                  {older.map(({ session, topics }) => (
                    <HistoryRow key={session.id} session={session} topics={topics} today={today} onOpenTask={onOpenTask} />
                  ))}
                </ul>
              </>
            )}
          </>
        )}
      </div>
    </section>
  );
}

function StatusChip({ status }: { status: OneOnOneSession['status'] }) {
  const tone = STATUS_TONES[status];
  return (
    <span className="ui-chip" style={{ ['--tone' as string]: tone.color }}>
      {tone.label}
    </span>
  );
}

function LastTime({
  session,
  topics,
  today,
  onOpenTask,
}: {
  session: OneOnOneSession;
  topics: OneOnOneAgendaItem[];
  today: string;
  onOpenTask?: (taskKey: string) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const notes = session.notes.trim();
  return (
    <article
      className="rounded-xl px-3 py-2.5"
      style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)' }}
      aria-label="Last session"
      data-testid="one-on-one-last-session"
    >
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="text-[11px] font-semibold uppercase tracking-[0.04em]" style={{ color: 'var(--text-muted)' }}>
          Last time
        </span>
        <span className="text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>
          {formatDay(session.scheduledFor, today)}
        </span>
        <span className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
          {relativeDay(session.completedAt ?? session.scheduledFor, today)}
        </span>
        <span className="ml-auto">
          <StatusChip status={session.status} />
        </span>
      </div>
      <div
        className={`mt-2 whitespace-pre-wrap text-[12.5px] leading-[19px] ${showAll ? '' : 'line-clamp-6'}`}
        style={{ color: notes ? 'var(--text-secondary)' : 'var(--text-muted)' }}
      >
        {notes ? renderMarkdownLite(notes) : session.status === 'skipped' ? 'Skipped — topics carried over.' : 'No notes taken.'}
      </div>
      {notes.split('\n').length > 6 && (
        <button
          type="button"
          onClick={() => setShowAll((value) => !value)}
          className={`mt-1 rounded text-[12px] font-medium ${FOCUS_RING}`}
          style={{ color: 'var(--accent)' }}
        >
          {showAll ? 'Show less' : 'Read all notes'}
        </button>
      )}
      {topics.length > 0 && (
        <div className="mt-2.5 border-t pt-2" style={{ borderColor: 'color-mix(in srgb, var(--border) 70%, transparent)' }}>
          <div className="mb-1 text-[11.5px] font-medium" style={{ color: 'var(--text-muted)' }}>
            On the agenda · {topics.length}
          </div>
          <TopicList topics={topics} onOpenTask={onOpenTask} />
        </div>
      )}
    </article>
  );
}

function TopicList({ topics, onOpenTask, limit }: { topics: OneOnOneAgendaItem[]; onOpenTask?: (taskKey: string) => void; limit?: number }) {
  const [expanded, setExpanded] = useState(false);
  const shown = limit && !expanded ? topics.slice(0, limit) : topics;
  return (
    <ul className="space-y-px">
      {shown.map((item) => (
        <li key={item.id}>
          <button
            type="button"
            onClick={() => onOpenTask?.(item.task.taskKey)}
            className={`flex w-full min-w-0 items-center gap-2 rounded-md px-1 py-0.5 text-left transition-colors hover:bg-[var(--bg-tertiary)] ${FOCUS_RING}`}
            title={`${item.task.taskKey} — ${item.task.title}`}
          >
            <TaskStatusGlyph status={item.task.status} size={12} />
            <span
              className="min-w-0 truncate text-[12.5px]"
              style={{
                color: item.task.status === 'done' || item.task.status === 'dropped' ? 'var(--text-muted)' : 'var(--text-secondary)',
              }}
            >
              {item.task.title}
            </span>
          </button>
        </li>
      ))}
      {limit && !expanded && topics.length > limit && (
        <li>
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className={`rounded px-1 text-[12px] font-medium ${FOCUS_RING}`}
            style={{ color: 'var(--accent)' }}
          >
            +{topics.length - limit} more
          </button>
        </li>
      )}
    </ul>
  );
}

function HistoryRow({
  session,
  topics,
  today,
  onOpenTask,
}: {
  session: OneOnOneSession;
  topics: OneOnOneAgendaItem[];
  today: string;
  onOpenTask?: (taskKey: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const preview = notesPreview(session.notes);
  return (
    <li className="border-b px-1.5 py-2" style={{ borderColor: 'color-mix(in srgb, var(--border) 70%, transparent)' }}>
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className={`flex w-full items-center gap-2 rounded text-left ${FOCUS_RING}`}
        aria-expanded={expanded}
      >
        {expanded ? <ChevronDown size={12} style={{ color: 'var(--text-muted)' }} /> : <ChevronRight size={12} style={{ color: 'var(--text-muted)' }} />}
        <span className="text-[13px]" style={{ color: 'var(--text-primary)' }}>
          {formatDay(session.scheduledFor, today)}
        </span>
        <StatusChip status={session.status} />
        <span className="ml-auto shrink-0 text-[11.5px] tabular-nums" style={{ color: 'var(--text-muted)' }}>
          {topics.length} topic{topics.length === 1 ? '' : 's'}
        </span>
      </button>
      {!expanded && preview && (
        <div className="mt-1 line-clamp-2 pl-5 text-[12px] leading-[17px]" style={{ color: 'var(--text-muted)' }}>
          {preview}
        </div>
      )}
      {expanded && (
        <div className="mt-1.5 space-y-2 pl-5">
          <div className="whitespace-pre-wrap text-[12px] leading-5" style={{ color: 'var(--text-secondary)' }}>
            {session.notes.trim() ? renderMarkdownLite(session.notes) : 'No notes.'}
          </div>
          {topics.length > 0 && <TopicList topics={topics} onOpenTask={onOpenTask} limit={SNAPSHOT_PREVIEW} />}
        </div>
      )}
    </li>
  );
}
