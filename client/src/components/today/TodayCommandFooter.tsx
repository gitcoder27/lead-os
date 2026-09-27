import { NotebookPen, Plus } from 'lucide-react';
import { useQuickActions } from '@/context/QuickActionsContext';
import type { GlobalCaptureContext } from '@/components/capture/GlobalCaptureDialog';

interface TodayCommandFooterProps {
  date: string;
  /** Prefills capture from the keyboard-active row (developer / issue). */
  captureContext?: GlobalCaptureContext;
  onOpenShortcuts: () => void;
}

/**
 * docs/53 F17/R2/§7: the footer keeps one capture affordance (the global
 * capture dialog, not a jump to Desk) and today's note. Nav duplicates are
 * gone, and the whole bar is hidden below `md`.
 */
export function TodayCommandFooter({ date, captureContext, onOpenShortcuts }: TodayCommandFooterProps) {
  const { openCapture, openNotes } = useQuickActions();
  return (
    <footer className="today-footer">
      <button type="button" className="today-ghost" onClick={() => openCapture(captureContext)}>
        <Plus size={14} aria-hidden="true" />
        Capture
        <kbd className="today-kbd">⌘I</kbd>
      </button>
      {openNotes ? (
        <button type="button" className="today-ghost" onClick={() => openNotes(date)}>
          <NotebookPen size={13} aria-hidden="true" />
          Today&apos;s note
        </button>
      ) : null}
      <button type="button" className="today-ghost ml-auto" onClick={onOpenShortcuts}>
        Shortcuts <kbd className="today-kbd">?</kbd>
      </button>
    </footer>
  );
}
