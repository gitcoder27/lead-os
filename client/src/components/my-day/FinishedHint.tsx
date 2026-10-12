import { useState } from 'react';
import { CircleCheck } from 'lucide-react';
import { FOCUS_RING } from '@/components/ui/focus';
import { useScopedStorageKey } from '@/lib/scoped-storage';
import { soundsFinished } from '@/lib/update-signals';
import type { TrackerWorkItem } from '@/types';

/**
 * docs/56 MDA-07: when your own latest update says the work is finished but the
 * task is still open, ask once. "Not yet" hides it for that update; a newer
 * update asks again only if it also sounds finished. Render with
 * `key={item.latestEvent?.id}` so a new update resets the answer.
 */
export function FinishedHint({ item, onMarkDone, className }: {
  item: TrackerWorkItem;
  onMarkDone?: (id: number) => void;
  className?: string;
}) {
  const event = item.latestEvent;
  const storageKey = useScopedStorageKey(`my-day:finished-hint:${event?.id ?? 'none'}`);
  const [dismissed, setDismissed] = useState(() => {
    try { return window.localStorage.getItem(storageKey) === '1'; } catch { return false; }
  });

  if (!onMarkDone || !event || dismissed) return null;
  if (event.type !== 'update' || event.authorType !== 'developer' || !soundsFinished(event.excerpt)) return null;

  const dismiss = () => {
    setDismissed(true);
    try { window.localStorage.setItem(storageKey, '1'); } catch { /* It asks again next visit. */ }
  };

  return (
    <div
      role="group"
      aria-label="Your last update sounds finished"
      className={`flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg px-2.5 py-1.5 text-ui ${className ?? ''}`}
      style={{
        background: 'color-mix(in srgb, var(--success) 7%, transparent)',
        border: '1px solid color-mix(in srgb, var(--success) 22%, transparent)',
      }}
    >
      <CircleCheck size={13} aria-hidden="true" style={{ color: 'var(--success-text)' }} />
      <span style={{ color: 'var(--text-secondary)' }}>
        <span className="sm:hidden">Sounds finished.</span>
        <span className="hidden sm:inline">Your last update says it’s finished.</span>
      </span>
      <span className="inline-flex items-center gap-1">
        <button
          type="button"
          onClick={() => onMarkDone(item.id)}
          className={`rounded-md px-1.5 font-semibold transition-colors hover:bg-[color-mix(in_srgb,var(--success)_12%,transparent)] ${FOCUS_RING}`}
          style={{ color: 'var(--success-text)' }}
        >
          Mark done
        </button>
        <button
          type="button"
          onClick={dismiss}
          className={`rounded-md px-1.5 font-medium transition-colors hover:bg-(--bg-tertiary) ${FOCUS_RING}`}
          style={{ color: 'var(--text-muted)' }}
        >
          Not yet
        </button>
      </span>
    </div>
  );
}
