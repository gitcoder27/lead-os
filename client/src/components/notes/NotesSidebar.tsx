import { useMemo, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { ArrowLeft, Lock, Search } from 'lucide-react';
import { useDailyNotes } from '@/hooks/useDailyNotes';
import type { DailyNoteSummary } from '@/types';

interface NotesSidebarProps {
  selectedDate: string;
  today: string;
  onSelectDate: (date: string) => void;
  mobile?: boolean;
  onBack?: () => void;
}

function rowLabel(date: string): string {
  try {
    const parsed = parseISO(date);
    const sameYear = parsed.getFullYear() === new Date().getFullYear();
    return format(parsed, sameYear ? 'EEE, MMM d' : 'EEE, MMM d, yyyy');
  } catch {
    return date;
  }
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

export function NotesSidebar({ selectedDate, today, onSelectDate, mobile = false, onBack }: NotesSidebarProps) {
  const [query, setQuery] = useState('');
  const listQuery = useDailyNotes(query);

  const notes = useMemo(
    () => listQuery.data?.pages.flatMap((page) => page.notes) ?? [],
    [listQuery.data],
  );

  const trimmedQuery = query.trim();
  const searching = trimmedQuery.length > 0;

  return (
    <aside className="notes-sidebar" aria-label="Note history">
      <div className="notes-sidebar-header">
        <div className="notes-sidebar-title-row">
          <div className="flex items-center gap-2">
            {mobile && onBack ? (
              <button
                type="button"
                onClick={onBack}
                className="notes-nav-button"
                aria-label="Back to note"
              >
                <ArrowLeft size={13} />
                Back
              </button>
            ) : null}
            <h1 className="notes-sidebar-title">Notes</h1>
          </div>
          <span className="notes-sidebar-private">
            <Lock size={10} aria-hidden="true" />
            Only you
          </span>
        </div>
        <p className="notes-sidebar-subtitle">A little space to clear your head.</p>
      </div>

      <div className="notes-sidebar-search">
        <label className="notes-search-wrap">
          <Search size={12} className="notes-search-icon" aria-hidden="true" />
          <span className="sr-only">Search all notes</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search all notes"
            aria-label="Search all notes"
            maxLength={200}
            className="notes-search-input"
          />
        </label>
      </div>

      <div className="px-3 pt-2 pb-1">
        <button
          type="button"
          onClick={() => onSelectDate(today)}
          className="notes-day-row"
          style={{ color: 'var(--accent)' }}
          aria-label="Go to today's note"
        >
          <span className="text-[12px] font-semibold">Today</span>
          <span className="ml-2 text-[11.5px]" style={{ color: 'var(--text-muted)' }}>
            {rowLabel(today)}
          </span>
        </button>
      </div>

      <div className="notes-sidebar-list" role="list" aria-label="Recent notes">
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
            <button
              type="button"
              onClick={() => void listQuery.refetch()}
              className="notes-button secondary mt-3"
            >
              Retry
            </button>
          </div>
        ) : notes.length === 0 ? (
          <div className="notes-sidebar-empty">
            {searching ? 'No notes match that search.' : 'Nothing here yet. Today is a good place to start.'}
          </div>
        ) : (
          <>
            {notes.map((note) => (
              <div key={note.id} role="listitem">
                <NoteRow
                  note={note}
                  selected={note.date === selectedDate}
                  onSelect={onSelectDate}
                />
              </div>
            ))}
            {listQuery.hasNextPage ? (
              <button
                type="button"
                onClick={() => void listQuery.fetchNextPage()}
                disabled={listQuery.isFetchingNextPage}
                className="notes-day-row mt-1"
                style={{ color: 'var(--text-muted)' }}
              >
                <span className="text-[12px]">
                  {listQuery.isFetchingNextPage ? 'Loading…' : 'Load earlier notes'}
                </span>
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
  selected,
  onSelect,
}: {
  note: DailyNoteSummary;
  selected: boolean;
  onSelect: (date: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(note.date)}
      aria-current={selected ? 'true' : undefined}
      className={`notes-day-row${selected ? ' selected' : ''}`}
    >
      <span className="notes-day-row-date">{rowLabel(note.date)}</span>
      <span className="notes-day-row-title block">{note.title || 'Daily note'}</span>
      {rowExcerpt(note) ? <span className="notes-day-row-excerpt block">{rowExcerpt(note)}</span> : null}
    </button>
  );
}
