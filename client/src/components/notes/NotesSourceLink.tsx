import { format, parseISO } from 'date-fns';
import { Lock } from 'lucide-react';
import { useQuickActions } from '@/context/QuickActionsContext';
import { isValidIsoDate } from '@/lib/view-params';
import type { DailyNoteSource } from '@/types';

interface NotesSourceLinkProps {
  source: DailyNoteSource;
}

export function NotesSourceLink({ source }: NotesSourceLinkProps) {
  const { openNotes } = useQuickActions();
  const href = `/notes?date=${encodeURIComponent(source.date)}`;

  const handleClick = (event: React.MouseEvent<HTMLAnchorElement>) => {
    if (!openNotes || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) {
      return;
    }
    event.preventDefault();
    openNotes(source.date);
  };

  const label = `Source: ${isValidIsoDate(source.date) ? format(parseISO(source.date), 'MMM d') : source.date} notes`;

  return (
    <a
      href={href}
      onClick={handleClick}
      className="inline-flex items-center gap-1 text-[11.5px]"
      style={{ color: 'var(--text-muted)' }}
      aria-label={`Open source note from ${source.date}`}
    >
      <Lock size={10} aria-hidden="true" />
      {label}
    </a>
  );
}
