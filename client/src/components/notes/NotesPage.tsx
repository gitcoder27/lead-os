import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuthScopeKey } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { getLocalIsoDate } from '@/lib/utils';
import type { TodayActionTarget } from '@/types';
import { NoteDocument } from './NoteDocument';
import { NotesSidebar } from './NotesSidebar';
import './notes.css';

export interface NotesPageProps {
  date: string;
  onDateChange: (date: string) => void;
  onOpenTarget: (target: TodayActionTarget) => void;
}

export function NotesPage({ date, onDateChange, onOpenTarget }: NotesPageProps) {
  const scope = useAuthScopeKey();
  const { addToast } = useToast();
  const isNarrow = useMediaQuery('(max-width: 767px)');
  const [historyOpen, setHistoryOpen] = useState(false);
  const flushRef = useRef<(() => Promise<boolean>) | null>(null);

  const [today, setToday] = useState(() => getLocalIsoDate());
  useEffect(() => {
    const timer = window.setInterval(() => setToday(getLocalIsoDate()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const registerFlush = useCallback((flush: (() => Promise<boolean>) | null) => {
    flushRef.current = flush;
  }, []);

  const requestDateChange = useCallback(
    async (next: string) => {
      if (next === date) {
        setHistoryOpen(false);
        return;
      }
      const ok = flushRef.current ? await flushRef.current() : true;
      if (!ok) {
        addToast('Could not save this note. Your draft is still here — fix the issue before switching days.', 'error');
        setHistoryOpen(false);
        return;
      }
      setHistoryOpen(false);
      onDateChange(next);
    },
    [addToast, date, onDateChange],
  );

  const showSidebar = !isNarrow || historyOpen;

  return (
    <main className="notes-page" aria-label="Notes workspace">
      {showSidebar ? (
        <NotesSidebar
          selectedDate={date}
          today={today}
          onSelectDate={(next) => void requestDateChange(next)}
          mobile={isNarrow}
          onBack={isNarrow ? () => setHistoryOpen(false) : undefined}
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
      />
    </main>
  );
}
