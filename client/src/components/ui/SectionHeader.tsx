import type { ReactNode } from 'react';

/**
 * docs/54 V10: the one section header — sentence case, 13px semibold, quiet
 * count pill. Uppercase eyebrows are reserved for menu and palette groups.
 */
export function SectionHeader({ icon, title, count, hint, action, id, as: Heading = 'h3' }: {
  icon?: ReactNode;
  title: string;
  count?: ReactNode;
  /** Quiet qualifier after the count, e.g. "Private". */
  hint?: ReactNode;
  action?: ReactNode;
  id?: string;
  /** Heading level — pages that own their outline use h2. */
  as?: 'h2' | 'h3';
}) {
  return (
    <div className="flex min-h-[28px] items-center gap-2">
      {icon && <span className="flex items-center" style={{ color: 'var(--text-muted)' }}>{icon}</span>}
      <Heading id={id} className="text-[13px] font-semibold tracking-[-0.005em]" style={{ color: 'var(--text-primary)' }}>
        {title}
      </Heading>
      {count !== undefined && count !== null && (
        <span
          className="rounded-full px-1.5 text-[12px] font-semibold tabular-nums leading-[18px]"
          style={{ background: 'var(--bg-tertiary)', color: 'var(--text-muted)' }}
        >
          {count}
        </span>
      )}
      {hint && <span className="text-[12px]" style={{ color: 'var(--text-muted)' }}>{hint}</span>}
      {action && <div className="ml-auto flex items-center gap-1">{action}</div>}
    </div>
  );
}
