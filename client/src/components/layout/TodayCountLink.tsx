import { House } from 'lucide-react';
import { useManagerActions } from '@/hooks/useManagerActions';

/**
 * docs/56 UX-30: on pages other than Today the header carries one quiet pointer to it — "Today N",
 * the size of Today's queue — instead of re-listing the queue in a popover.
 */
export function TodayCountLink({ onOpenToday }: { onOpenToday: () => void }) {
  const actions = useManagerActions({ surface: 'header', limit: 1 });
  const count = actions.data?.totalCount;
  if (!count) return null;
  return (
    <a
      href="/"
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
        event.preventDefault();
        onOpenToday();
      }}
      className="header-today-count inline-flex h-8 items-center gap-1.5 rounded-xl px-2.5 text-[12px] font-medium"
      style={{ background: 'var(--bg-tertiary)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}
      title={`${count} on Today`}
      aria-label={`Today: ${count} to look at`}
    >
      <House size={13} aria-hidden="true" />
      Today
      <span className="tabular-nums font-semibold" style={{ color: 'var(--accent-text)' }}>{count}</span>
    </a>
  );
}
