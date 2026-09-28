import type { ReactNode } from 'react';
import { FOCUS_RING } from './focus';

/** Square ghost icon control for drawer toolbars. */
export function IconButton({ label, hint, onClick, children, expanded, tone, popup }: {
  label: string;
  hint?: string;
  onClick: (anchor: HTMLButtonElement) => void;
  children: ReactNode;
  expanded?: boolean;
  tone?: 'danger';
  popup?: 'menu' | 'dialog';
}) {
  return (
    <button
      type="button"
      onClick={(event) => onClick(event.currentTarget)}
      className={`flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-[var(--bg-tertiary)] ${FOCUS_RING}`}
      style={{ color: tone === 'danger' ? 'var(--danger)' : 'var(--text-secondary)', background: expanded ? 'var(--bg-tertiary)' : undefined }}
      title={hint ? `${label} (${hint})` : label}
      aria-label={label}
      aria-haspopup={popup}
      aria-expanded={expanded}
    >
      {children}
    </button>
  );
}
