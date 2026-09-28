import { useMemo } from 'react';
import { format } from 'date-fns';
import { ArrowUpRight, Link2 } from 'lucide-react';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { prettyNoteDate } from '@/lib/note-markdown';
import type { DailyNoteRef, DailyNoteRefRelation } from '@/types';
import { statusLabel } from './editor/note-editor-extensions';

const GROUPS: Array<{ relation: DailyNoteRefRelation; label: string }> = [
  { relation: 'created_from', label: 'Created' },
  { relation: 'update_from', label: 'Updated' },
  { relation: 'mentioned', label: 'Mentioned' },
];

const RANK: Record<DailyNoteRefRelation, number> = { created_from: 0, update_from: 1, mentioned: 2 };

/** `due` is a date or an instant (follow-up time) — show the local day either way. */
function formatDue(due: string): string {
  if (due.length <= 10) return prettyNoteDate(due);
  const at = new Date(due);
  return Number.isNaN(at.getTime()) ? due : format(at, 'MMM d');
}

function refId(ref: DailyNoteRef): string {
  return ref.taskKey ? `key:${ref.taskKey.toUpperCase()}` : `item:${ref.itemId ?? ref.title}`;
}

/**
 * One row per item, under its strongest relation: a task created from this
 * note also shows up as "mentioned" (its `→ T-n` marker), but belongs in Created.
 */
export function groupNoteRefs(refs: DailyNoteRef[]): Array<{ relation: DailyNoteRefRelation; label: string; refs: DailyNoteRef[] }> {
  const best = new Map<string, DailyNoteRef>();
  for (const ref of refs) {
    const id = refId(ref);
    const existing = best.get(id);
    if (!existing || RANK[ref.relation] < RANK[existing.relation]) best.set(id, ref);
  }
  const unique = [...best.values()];
  return GROUPS.map((group) => ({ ...group, refs: unique.filter((ref) => ref.relation === group.relation) })).filter(
    (group) => group.refs.length > 0,
  );
}

export function NotesFromThisNote({ refs, onOpen }: { refs: DailyNoteRef[]; onOpen: (ref: DailyNoteRef) => void }) {
  const groups = useMemo(() => groupNoteRefs(refs), [refs]);
  const total = groups.reduce((sum, group) => sum + group.refs.length, 0);
  if (total === 0) return null;

  return (
    <section className="notes-from" aria-labelledby="notes-from-heading">
      <SectionHeader id="notes-from-heading" icon={<Link2 size={13} />} title="From this note" count={total} />
      {groups.map((group) => (
        <div key={group.relation} className="notes-from-group">
          <h4 className="notes-from-group-label">{group.label}</h4>
          <ul>
            {group.refs.map((ref) => (
              <li key={refId(ref)}>
                <button type="button" className="notes-from-row" onClick={() => onOpen(ref)}>
                  <span className={`notes-status-dot status-${ref.status}`} aria-hidden="true" />
                  {ref.taskKey ? <span className="notes-from-key">{ref.taskKey}</span> : null}
                  <span className="notes-from-title">{ref.title}</span>
                  <span className="notes-from-meta">
                    {[statusLabel(ref.status), ref.owner, ref.due ? formatDue(ref.due) : null]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                  <ArrowUpRight size={12} className="notes-from-go" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
