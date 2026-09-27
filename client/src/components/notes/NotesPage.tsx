import { useCallback, useEffect, useRef, useState } from 'react';
import { addDays, format, parseISO } from 'date-fns';
import { useAuthScopeKey } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { getLocalIsoDate } from '@/lib/utils';
import { searchTerms } from '@/lib/note-markdown';
import { isValidIsoDate } from '@/lib/view-params';
import type { TodayActionTarget } from '@/types';
import { NoteDocument } from './NoteDocument';
import { NotesSidebar } from './NotesSidebar';
import './notes.css';

export interface NotesPageProps {
  date: string;
  onDateChange: (date: string) => void;
  onOpenTarget: (target: TodayActionTarget) => void;
}

/** True while a modal layer (palette, capture, drawer, dialog, popover) owns the keyboard. */
function modalLayerOpen(): boolean {
  return Boolean(document.querySelector('[aria-modal="true"], [role="dialog"][data-state="open"], [data-popover-layer]'));
}

export function NotesPage({ date, onDateChange, onOpenTarget }: NotesPageProps) {
  const scope = useAuthScopeKey();
  const { addToast } = useToast();
  const isNarrow = useMediaQuery('(max-width: 767px)');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [focusSearchPending, setFocusSearchPending] = useState(false);
  const [jump, setJump] = useState<{ date: string; terms: string[] } | null>(null);
  const flushRef = useRef<(() => Promise<boolean>) | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const [today, setToday] = useState(() => getLocalIsoDate());
  useEffect(() => {
    const timer = window.setInterval(() => setToday(getLocalIsoDate()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const registerFlush = useCallback((flush: (() => Promise<boolean>) | null) => {
    flushRef.current = flush;
  }, []);

  const requestDateChange = useCallback(
    async (next: string, query?: string) => {
      const terms = query ? searchTerms(query) : [];
      if (next === date) {
        // Re-opening the current day from a search still lands on the match.
        if (terms.length > 0) setJump({ date: next, terms });
        setHistoryOpen(false);
        return;
      }
      const ok = flushRef.current ? await flushRef.current() : true;
      if (!ok) {
        addToast('Could not save this note. Your draft is still here — fix the issue before switching days.', 'error');
        setHistoryOpen(false);
        return;
      }
      setJump(terms.length > 0 ? { date: next, terms } : null);
      setHistoryOpen(false);
      onDateChange(next);
    },
    [addToast, date, onDateChange],
  );

  // F14: page keys. ⌥↑/⌥↓ step days, ⌥T jumps to today, ⌘⇧F searches notes.
  // Matched on `event.code` so macOS Option characters (†, etc.) don't leak
  // into the editor; ignored under any modal layer so global ⌘K/⌘J/⌘I and
  // dialogs keep their own keyboard.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || modalLayerOpen()) return;
      const mod = event.metaKey || event.ctrlKey;
      if (event.altKey && !mod && !event.shiftKey) {
        if (event.code === 'ArrowUp' || event.code === 'ArrowDown') {
          if (!isValidIsoDate(date)) return;
          event.preventDefault();
          const next = format(addDays(parseISO(date), event.code === 'ArrowUp' ? -1 : 1), 'yyyy-MM-dd');
          void requestDateChange(next);
          return;
        }
        if (event.code === 'KeyT') {
          event.preventDefault();
          void requestDateChange(today);
          return;
        }
      }
      if (mod && event.shiftKey && !event.altKey && event.code === 'KeyF') {
        event.preventDefault();
        if (isNarrow) setHistoryOpen(true);
        setFocusSearchPending(true);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [date, isNarrow, requestDateChange, today]);

  useEffect(() => {
    if (!focusSearchPending) return;
    const input = searchInputRef.current;
    if (!input) return;
    input.focus();
    input.select();
    setFocusSearchPending(false);
  }, [focusSearchPending, historyOpen]);

  const showSidebar = !isNarrow || historyOpen;

  return (
    <main className="notes-page" aria-label="Notes workspace">
      {showSidebar ? (
        <NotesSidebar
          selectedDate={date}
          today={today}
          onSelectDate={(next, query) => void requestDateChange(next, query)}
          mobile={isNarrow}
          onBack={isNarrow ? () => setHistoryOpen(false) : undefined}
          searchInputRef={searchInputRef}
        />
      ) : null}
      <NoteDocument
        key={`${scope}:${date}`}
        date={date}
        today={today}
        hidden={isNarrow && historyOpen}
        mobile={isNarrow}
        onNavigateDate={(next) => void requestDateChange(next)}
        onOpenTarget={onOpenTarget}
        registerFlush={registerFlush}
        onOpenHistory={isNarrow ? () => setHistoryOpen(true) : undefined}
        jumpTerms={jump?.date === date ? jump.terms : undefined}
      />
    </main>
  );
}
