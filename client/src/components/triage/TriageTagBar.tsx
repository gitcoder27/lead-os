import { useState } from 'react';
import { Tag, Plus, Check, X } from 'lucide-react';

interface LocalTag {
  id: number;
  name: string;
  color: string;
}

interface TriageTagBarProps {
  tags: LocalTag[];
  allTags: LocalTag[];
  assignedTagIds: Set<number>;
  isPending: boolean;
  onToggle: (tagId: number) => void;
  onCreate: (name: string, opts: { onSuccess: () => void }) => void;
}

export function TriageTagBar({ tags, allTags, assignedTagIds, isPending, onToggle, onCreate }: TriageTagBarProps) {
  const [expanded, setExpanded] = useState(false);
  const [newTagName, setNewTagName] = useState('');

  return (
    <div className="triage-section">
      <div className="flex items-center gap-2">
        <span className="triage-section-label shrink-0">
          <Tag size={10} /> Tags
        </span>
        <div className="flex flex-wrap gap-1 flex-1 min-w-0">
          {tags.map((tag) => (
            <button
              key={tag.id}
              onClick={() => onToggle(tag.id)}
              disabled={isPending}
              className="text-[12px] px-1.5 py-[2px] rounded-full font-medium inline-flex items-center gap-0.5 hover:opacity-70 transition-opacity disabled:cursor-wait"
              style={{ background: `${tag.color}20`, color: tag.color, border: `1px solid ${tag.color}30` }}
              title={`Remove "${tag.name}"`}
            >
              {tag.name} <X size={8} />
            </button>
          ))}
          {tags.length === 0 && !expanded && (
            <button onClick={() => setExpanded(true)} className="text-[12px] font-medium" style={{ color: 'var(--accent)' }}>
              + Add tag
            </button>
          )}
        </div>
        <button
          onClick={() => setExpanded((p) => !p)}
          className="shrink-0 rounded-md p-0.5 transition-colors hover:bg-[var(--bg-tertiary)]"
          title={expanded ? 'Close' : 'Manage tags'}
        >
          {expanded ? <X size={12} style={{ color: 'var(--text-muted)' }} /> : <Plus size={12} style={{ color: 'var(--text-muted)' }} />}
        </button>
      </div>

      {expanded && (
        <div className="rounded-lg p-2 mt-2 flex flex-col gap-1.5" style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border)' }}>
          {allTags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {allTags.map((tag) => {
                const isAssigned = assignedTagIds.has(tag.id);
                return (
                  <button
                    key={tag.id}
                    onClick={() => onToggle(tag.id)}
                    disabled={isPending}
                    className="text-[12px] px-1.5 py-[2px] rounded-full font-medium inline-flex items-center gap-0.5 transition-opacity disabled:cursor-wait"
                    style={{
                      background: isAssigned ? `${tag.color}35` : `${tag.color}12`,
                      color: tag.color,
                      border: `1px solid ${tag.color}${isAssigned ? '60' : '25'}`,
                      opacity: isAssigned ? 1 : 0.7,
                    }}
                  >
                    {isAssigned && <Check size={8} />}
                    {tag.name}
                  </button>
                );
              })}
            </div>
          )}
          <div className="flex gap-1">
            <input
              type="text"
              value={newTagName}
              onChange={(e) => setNewTagName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  onCreate(newTagName, { onSuccess: () => setNewTagName('') });
                }
              }}
              placeholder="New tag…"
              className="flex-1 text-[12px] px-2 py-0.5 rounded focus:outline-none focus:ring-1"
              style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border)', outlineColor: 'var(--accent)' }}
            />
            <button
              onClick={() => onCreate(newTagName, { onSuccess: () => setNewTagName('') })}
              disabled={!newTagName.trim() || isPending}
              className="text-[12px] px-2 py-0.5 rounded font-medium disabled:opacity-30"
              style={{ background: 'var(--accent-solid)', color: 'var(--on-accent)' }}
            >
              Add
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
