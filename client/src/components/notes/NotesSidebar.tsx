import { useMemo, useState, type RefObject } from 'react';
import { differenceInCalendarWeeks, format, parseISO } from 'date-fns';
import { ArrowLeft, Lock, PenLine, Search } from 'lucide-react';
import { useDailyNotes } from '@/hooks/useDailyNotes';
import { snippetSegments } from '@/lib/note-markdown';
import type { DailyNoteKind, DailyNoteSummary } from '@/types';

interface NotesSidebarProps {
  selectedDate: string;
  today: string;
  kind: DailyNoteKind;
  onKindChange: (kind: DailyNoteKind) => void;
  /** `query` is set when the row came from a search, so the note can land at the match (F12). */
  onSelectDate: (date: string, query?: string) => void;
  mobile?: boolean;
  onBack?: () => void;
  searchInputRef?: RefObject<HTMLInputElement>;
}

function rowLabel(date: string, today: string): string {
  try {
    const parsed = parseISO(date);
    const sameYear = parsed.getFullYear() === parseISO(today).getFullYear();
    const label = format(parsed, sameYear ? 'EEE, MMM d' : 'EEE, MMM d, yyyy');
    return date === today ? `Today · ${label}` : label;
  } catch {
    return date;
  }
}

/** Sidebar section for a note date: This week · Last week · month. */
export function historyGroup(date: string, today: string): string {
  try {
    const parsed = parseISO(date);
    const now = parseISO(today);
    const weeks = differenceInCalendarWeeks(now, parsed, { weekStartsOn: 1 });
    if (weeks <= 0) return 'This week';
    if (weeks === 1) return 'Last week';
    return format(parsed, parsed.getFullYear() === now.getFullYear() ? 'MMMM' : 'MMMM yyyy');
  } catch {
    return '';
  }
}

function producedLabel(note: DailyNoteSummary): string | null {
  const produced = note.produced;
  if (!produced) return null;
  const parts = [
    produced.tasks ? `${produced.tasks} ${produced.tasks === 1 ? 'task' : 'tasks'}` : null,
    produced.carried ? `${produced.carried} carried` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}

function rowExcerpt(note: DailyNoteSummary): string {
  const title = note.title?.trim();
  const excerpt = note.excerpt?.trim();
  if (!excerpt) {
    return '';
  }
  if (title && excerpt.startsWith(title)) {
    return excerpt.slice(title.length).trim();
  }
  return excerpt;
}

export function NotesSidebar({ selectedDate, today, kind, onKindChange, onSelectDate, mobile = false, onBack, searchInputRef }: NotesSidebarProps) {
  const [query, setQuery] = useState('');
  const listQuery = useDailyNotes(query, kind);

  const notes = useMemo(
    () => listQuery.data?.pages.flatMap((page) => page.notes) ?? [],
    [listQuery.data],
  );

  const trimmedQuery = query.trim();
  const searching = trimmedQuery.length > 0;
  const hasToday = notes.some((note) => note.date === today);

  return (
    <aside className="notes-sidebar" aria-label="Note history">
      <div className="notes-sidebar-header">
        <div className="notes-sidebar-title-row">
          {mobile && onBack ? (
            <button type="button" onClick={onBack} className="notes-nav-button" aria-label="Back to note">
              <ArrowLeft size={13} />
              Back
            </button>
          ) : null}
          <h1 className="notes-sidebar-title">Notes</h1>
          <span
            className="notes-sidebar-private"
            title="Private — only you can see your notes"
            aria-label="Private — only you can see your notes"
            role="img"
          >
            <Lock size={11} aria-hidden="true" />
          </span>
        </div>
        <div className="notes-kind-toggle" role="group" aria-label="Note kind">
          <button
            type="button"
            className={kind === 'scratchpad' ? 'active' : undefined}
            aria-pressed={kind === 'scratchpad'}
            onClick={() => onKindChange('scratchpad')}
          >
            Notes
          </button>
          <button
            type="button"
            className={kind === 'standup' ? 'active' : undefined}
            aria-pressed={kind === 'standup'}
            onClick={() => onKindChange('standup')}
          >
            Standups
          </button>
        </div>
        <label className="notes-search-wrap mt-2">
          <Search size={12} className="notes-search-icon" aria-hidden="true" />
          <span className="sr-only">{kind === 'standup' ? 'Search standup notes' : 'Search all notes'}</span>
          <input
            ref={searchInputRef}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && query) {
                event.stopPropagation();
                setQuery('');
              }
            }}
            placeholder={kind === 'standup' ? 'Search standups' : 'Search all notes'}
            aria-label={kind === 'standup' ? 'Search standup notes' : 'Search all notes'}
            aria-keyshortcuts="Meta+Shift+F Control+Shift+F"
            maxLength={200}
            className="notes-search-input"
          />
          <kbd className="notes-search-kbd" aria-hidden="true">
            ⌘⇧F
          </kbd>
        </label>
      </div>

      <div
        className="notes-sidebar-list"
        role="list"
        aria-label={searching ? 'Search results' : kind === 'standup' ? 'Recent standups' : 'Recent notes'}
      >
        {!searching && kind === 'scratchpad' && !hasToday && !listQuery.isLoading ? (
          <div role="listitem">
            <button
              type="button"
              onClick={() => onSelectDate(today)}
              aria-current={selectedDate === today ? 'date' : undefined}
              className={`notes-day-row ghost${selectedDate === today ? ' selected' : ''}`}
            >
              <span className="notes-day-row-date">{rowLabel(today, today)}</span>
              <span className="notes-day-row-title flex items-center gap-1.5">
                <PenLine size={11} aria-hidden="true" />
                Start writing
              </span>
            </button>
          </div>
        ) : null}
        {listQuery.isLoading ? (
          <div aria-hidden="true" className="space-y-1.5 px-1 pt-1">
            {[0, 1, 2, 3, 4].map((item) => (
              <div key={item} className="px-2 py-1">
                <div className="notes-skeleton" style={{ height: 11, width: '40%' }} />
                <div className="notes-skeleton mt-2" style={{ height: 13, width: '85%' }} />
                <div className="notes-skeleton mt-1.5" style={{ height: 11, width: '70%' }} />
              </div>
            ))}
          </div>
        ) : listQuery.isError ? (
          <div className="notes-sidebar-empty">
            <p>Could not load your notes.</p>
            <button type="button" onClick={() => void listQuery.refetch()} className="notes-button secondary mt-3">
              Retry
            </button>
          </div>
        ) : notes.length === 0 ? (
          searching ? (
            <div className="notes-sidebar-empty">No notes match that search.</div>
          ) : kind === 'standup' ? (
            <div className="notes-sidebar-empty">No standup summaries yet — ending a standup files one here.</div>
          ) : null
        ) : (
          <>
            {notes.map((note, index) => {
              // Search results are a flat list; history reads by week/month.
              const group = searching ? '' : historyGroup(note.date, today);
              const showGroup = group && (index === 0 || historyGroup(notes[index - 1]!.date, today) !== group);
              return (
                <div key={note.id} role="listitem">
                  {showGroup ? <p className="notes-history-group">{group}</p> : null}
                  <NoteRow
                    note={note}
                    today={today}
                    selected={note.date === selectedDate}
                    onSelect={(date) => onSelectDate(date, searching ? trimmedQuery : undefined)}
                  />
                </div>
              );
            })}
            {listQuery.hasNextPage ? (
              <button
                type="button"
                onClick={() => void listQuery.fetchNextPage()}
                disabled={listQuery.isFetchingNextPage}
                className="notes-day-row mt-1"
                style={{ color: 'var(--text-muted)' }}
              >
                <span className="text-[12px]">{listQuery.isFetchingNextPage ? 'Loading…' : 'Load earlier notes'}</span>
              </button>
            ) : null}
          </>
        )}
      </div>
    </aside>
  );
}

function NoteRow({
  note,
  today,
  selected,
  onSelect,
}: {
  note: DailyNoteSummary;
  today: string;
  selected: boolean;
  onSelect: (date: string) => void;
}) {
  const excerpt = rowExcerpt(note);
  const produced = producedLabel(note);
  return (
    <button
      type="button"
      onClick={() => onSelect(note.date)}
      aria-current={selected ? 'date' : undefined}
      className={`notes-day-row${selected ? ' selected' : ''}`}
    >
      <span className="notes-day-row-head">
        <span className="notes-day-row-date">{rowLabel(note.date, today)}</span>
        {produced ? <span className="notes-day-row-produced">{produced}</span> : null}
      </span>
      <span className="notes-day-row-title block">{note.title || 'Daily note'}</span>
      {note.snippet ? (
        <span className="notes-day-row-excerpt snippet block">
          {snippetSegments(note.snippet).map((segment, index) =>
            segment.match ? <mark key={index}>{segment.text}</mark> : <span key={index}>{segment.text}</span>,
          )}
        </span>
      ) : excerpt ? (
        <span className="notes-day-row-excerpt block">{excerpt}</span>
      ) : null}
    </button>
  );
}
