import type { ReactNode } from 'react';
import { formatShortcutKeys } from '@/lib/keyboard-shortcuts';

/**
 * docs/54 V9: the one key cap. `default` for sheets and legends, `subtle` for
 * hints next to other text, `bare` inside buttons and menu rows where a box
 * would compete with the control's own border.
 */
export function Kbd({ children, variant = 'default', className = '' }: {
  children: ReactNode;
  variant?: 'default' | 'subtle' | 'bare';
  className?: string;
}) {
  if (variant === 'bare') {
    return (
      <kbd className={`font-mono text-[11px] font-medium ${className}`} style={{ color: 'var(--text-muted)' }}>
        {typeof children === 'string' ? formatShortcutKeys(children) : children}
      </kbd>
    );
  }
  return (
    <kbd
      className={`inline-flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-[5px] px-1 font-mono text-[11px] font-medium leading-none ${className}`}
      style={{
        color: variant === 'subtle' ? 'var(--text-muted)' : 'var(--text-secondary)',
        background: 'var(--bg-tertiary)',
        border: '1px solid var(--border)',
      }}
    >
      {typeof children === 'string' ? formatShortcutKeys(children) : children}
    </kbd>
  );
}

/**
 * Renders a key spec: "j / k" → two caps with a slash, "⌘ ↵" → a chord,
 * "s → t m w" → a sequence. Separators stay plain text.
 */
export function KeySpec({ keys, variant = 'default' }: { keys: string; variant?: 'default' | 'subtle' }) {
  const tokens = keys.split(/(\s\/\s|\s→\s|\s\+\s|\s·\s|\s)/).filter((token) => token !== '' && token !== ' ');
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {tokens.map((token, index) =>
        /^\s*(\/|→|\+|·)\s*$/.test(token) ? (
          <span key={index} className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{token.trim()}</span>
        ) : (
          <Kbd key={index} variant={variant}>{token}</Kbd>
        ),
      )}
    </span>
  );
}
