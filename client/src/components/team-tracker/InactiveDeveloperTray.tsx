import { useState } from 'react';
import { ChevronDown, ChevronRight, RotateCcw, UserMinus } from 'lucide-react';
import type { InactiveDeveloperListItem } from '@/types';

interface InactiveDeveloperTrayProps {
  items: InactiveDeveloperListItem[];
  onReactivate: (accountId: string) => void;
  pendingAccountId?: string;
  readOnly?: boolean;
  defaultExpanded?: boolean;
}

export function InactiveDeveloperTray({
  items,
  onReactivate,
  pendingAccountId,
  readOnly = false,
  defaultExpanded = false,
}: InactiveDeveloperTrayProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  if (items.length === 0) {
    return null;
  }

  return (
    <section
      className="rounded-xl border px-3 py-2.5"
      style={{
        borderColor: 'var(--border)',
        background: 'color-mix(in srgb, var(--bg-secondary) 94%, transparent)',
      }}
    >
      <button
        type="button"
        onClick={() => setExpanded((current) => !current)}
        className="flex w-full items-center justify-between gap-3 text-left"
        aria-expanded={expanded}
        aria-label={expanded ? 'Hide inactive developers' : 'Show inactive developers'}
      >
        <div className="flex min-w-0 items-center gap-2">
          <span
            className="flex h-7 w-7 items-center justify-center rounded-xl"
            style={{ background: 'var(--bg-tertiary)', color: 'var(--text-muted)' }}
          >
            <UserMinus size={13} />
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>
                Inactive
              </span>
              <span
                className="rounded-full px-1.5 py-0.5 text-[12px] font-semibold"
                style={{ color: 'var(--text-muted)', background: 'var(--bg-tertiary)' }}
              >
                {items.length}
              </span>
            </div>
            <div className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
              {readOnly
                ? 'Historical inactive state for the selected date.'
                : 'Hidden from the active board. Expand only when you need to restore someone.'}
            </div>
          </div>
        </div>
        <span
          className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-[12px] font-semibold"
          style={{ color: 'var(--text-secondary)', background: 'var(--bg-tertiary)' }}
        >
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          {expanded ? 'Hide' : 'View'}
        </span>
      </button>

      {expanded && (
        <div className="mt-3 flex flex-wrap gap-2 border-t pt-3" style={{ borderColor: 'var(--border)' }}>
          {items.map((item) => {
            const isPending = pendingAccountId === item.developer.accountId;

            return (
              <div
                key={item.developer.accountId}
                className="flex min-w-[220px] max-w-full items-center gap-2 rounded-2xl border px-3 py-2"
                style={{ borderColor: 'var(--border)', background: 'var(--bg-tertiary)' }}
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>
                    {item.developer.displayName}
                  </div>
                  <div className="truncate text-[12px]" style={{ color: 'var(--text-muted)' }}>
                    {item.availability.note || `Inactive since ${item.availability.startDate}`}
                  </div>
                </div>
                {!readOnly && (
                  <button
                    type="button"
                    onClick={() => onReactivate(item.developer.accountId)}
                    disabled={isPending}
                    className="inline-flex items-center gap-1 rounded-xl px-2 py-1 text-[12px] font-semibold transition-colors disabled:opacity-50"
                    style={{
                      color: 'var(--accent)',
                      background: 'var(--bg-secondary)',
                      border: '1px solid color-mix(in srgb, var(--accent) 24%, transparent)',
                    }}
                  >
                    <RotateCcw size={10} className={isPending ? 'animate-spin' : ''} />
                    Active
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
