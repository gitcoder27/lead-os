import type { ReactNode } from 'react';
import type { FeedTone, ReasonTone } from '@/lib/standup';
import { Kbd as SharedKbd } from '@/components/ui/Kbd';

export { initials as getInitials } from '@/components/ui/Avatar';

export const TONE_COLORS: Record<FeedTone | ReasonTone, string> = {
  danger: 'var(--danger)',
  warning: 'var(--warning)',
  success: 'var(--success)',
  accent: 'var(--accent)',
  info: 'var(--info)',
  muted: 'var(--text-muted)',
};

// docs/54 V8: Standup uses the app-wide avatar (seed by account id).
export { Avatar } from '@/components/ui/Avatar';

// docs/54 V9: the shared key cap; `subtle` keeps the old call sites working.
export function Kbd({ children, subtle = false }: { children: ReactNode; subtle?: boolean }) {
  return <SharedKbd variant={subtle ? 'subtle' : 'default'}>{children}</SharedKbd>;
}

/** docs/54 V6: the shared tone chip (`.ui-chip`), tinted by `--tone`. */
export function ToneChip({ tone, children, title }: { tone: FeedTone | ReasonTone; children: ReactNode; title?: string }) {
  return (
    <span title={title} className="ui-chip gap-1 whitespace-nowrap" style={{ ['--tone' as string]: TONE_COLORS[tone] }}>
      {children}
    </span>
  );
}

/** docs/54 V10: sentence-case section header, the same as `ui/SectionHeader`. */
export function SectionLabel({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-2 flex min-h-[28px] items-center justify-between gap-2">
      <h3 className="text-[13px] font-semibold tracking-[-0.005em]" style={{ color: 'var(--text-primary)' }}>
        {children}
      </h3>
      {right}
    </div>
  );
}
