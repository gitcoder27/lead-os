import { StickyNote, Users } from 'lucide-react';

/**
 * docs/56 UX-31: one "Linked" column for a defect's analysis notes and the Team board tasks linked to
 * it. It shows only what exists, so an unlinked defect's cell is empty instead of two hollow circles.
 */
export function LinkedCell({ hasNotes, trackerCount, developerNames }: { hasNotes: boolean; trackerCount: number; developerNames: string[] }) {
  if (!hasNotes && trackerCount === 0) return null;
  const trackerLabel = `${trackerCount} Team board ${trackerCount === 1 ? 'task' : 'tasks'}${developerNames.length ? `: ${developerNames.join(', ')}` : ''}`;
  return (
    <span className="inline-flex items-center gap-1.5">
      {hasNotes ? (
        <span role="img" aria-label="Analysis notes" title="Analysis notes" className="inline-flex" style={{ color: 'var(--success-text)' }}>
          <StickyNote size={14} aria-hidden="true" />
        </span>
      ) : null}
      {trackerCount > 0 ? (
        <span
          role="img"
          aria-label={trackerLabel}
          title={trackerLabel}
          className="inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[12px] font-semibold"
          style={{ background: 'var(--accent-glow)', color: 'var(--accent-text)' }}
        >
          <Users size={12} aria-hidden="true" />
          {trackerCount}
        </span>
      ) : null}
    </span>
  );
}
