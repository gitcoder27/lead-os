import type { ReactNode } from 'react';

/**
 * docs/54 V12: the one empty state — an icon, a sentence-case title, one
 * line of body and an optional tinted action. No dashed card: the empty
 * state sits where the content would, at the content's width.
 */
export function EmptyState({ icon, title, body, action, tone = 'default', compact = false }: {
  icon?: ReactNode;
  title: ReactNode;
  body?: ReactNode;
  action?: ReactNode;
  /** `success` for "all clear" states (Inbox zero, everyone reviewed). */
  tone?: 'default' | 'success';
  /** Less vertical room — inside a panel or a column rather than a page. */
  compact?: boolean;
}) {
  const color = tone === 'success' ? 'var(--success)' : 'var(--text-muted)';
  return (
    <div className={`flex flex-col items-center gap-2 text-center ${compact ? 'px-4 py-7' : 'px-4 py-14'}`}>
      {icon ? <span className="flex items-center justify-center" style={{ color }} aria-hidden="true">{icon}</span> : null}
      <p className="text-[13.5px] font-semibold" style={{ color: tone === 'success' ? 'var(--success)' : 'var(--text-secondary)' }}>{title}</p>
      {body ? <p className="max-w-[420px] text-[12px]" style={{ color: 'var(--text-muted)' }}>{body}</p> : null}
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}
