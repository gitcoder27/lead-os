import type { ReactNode } from 'react';
import type { FeedTone, ReasonTone } from '@/lib/standup';

export const getInitials = (name: string) => {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1]![0] : '')).toUpperCase() || '?';
};

export const TONE_COLORS: Record<FeedTone | ReasonTone, string> = {
  danger: 'var(--danger)',
  warning: 'var(--warning)',
  success: 'var(--success)',
  accent: 'var(--accent)',
  info: 'var(--info)',
  muted: 'var(--text-muted)',
};

export function Avatar({ name, size = 28, ring }: { name: string; size?: number; ring?: 'accent' | 'none' }) {
  return (
    <span
      aria-hidden="true"
      className="flex shrink-0 items-center justify-center rounded-lg font-bold"
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.36),
        background: 'var(--bg-tertiary)',
        color: 'var(--accent)',
        border: '1px solid var(--border)',
        boxShadow: ring === 'accent' ? '0 0 0 2px var(--bg-secondary), 0 0 0 3.5px var(--accent)' : undefined,
      }}
    >
      {getInitials(name)}
    </span>
  );
}

export function Kbd({ children, subtle = false }: { children: ReactNode; subtle?: boolean }) {
  return (
    <kbd
      className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded px-1 font-mono text-[10.5px] font-semibold leading-none"
      style={{
        color: subtle ? 'var(--text-muted)' : 'var(--text-secondary)',
        background: 'var(--bg-tertiary)',
        border: '1px solid var(--border)',
        boxShadow: subtle ? undefined : 'inset 0 -1px 0 var(--border)',
      }}
    >
      {children}
    </kbd>
  );
}

export function ToneChip({ tone, children, title }: { tone: FeedTone | ReasonTone; children: ReactNode; title?: string }) {
  const color = TONE_COLORS[tone];
  return (
    <span
      title={title}
      className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-px text-[10.5px] font-semibold"
      style={{
        color,
        background: `color-mix(in srgb, ${color} 12%, transparent)`,
        border: `1px solid color-mix(in srgb, ${color} 24%, transparent)`,
      }}
    >
      {children}
    </span>
  );
}

export function SectionLabel({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-2 flex items-center justify-between gap-2">
      <span className="text-[10.5px] font-semibold uppercase tracking-[0.09em]" style={{ color: 'var(--text-muted)' }}>
        {children}
      </span>
      {right}
    </div>
  );
}
