import { useState, useMemo, useCallback } from 'react';
import { Plus, Check, Users, ChevronRight } from 'lucide-react';
import type { Developer } from '@/types';

interface TrackerIssueAssignment {
  itemId: number;
  date: string;
  jiraKey: string;
  title: string;
  state: 'planned' | 'in_progress' | 'done' | 'dropped';
  developer: { accountId: string; displayName: string; isActive: boolean };
}

interface TriageTrackerSectionProps {
  issueKey: string;
  issueAssigneeId?: string;
  developers: Developer[];
  assignments: TrackerIssueAssignment[];
  trackerDate: string;
  firstLinkedAccountId?: string;
  onAdd: (accountId: string, title: string) => void;
  isAdding: boolean;
}

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

function stateLabel(state: TrackerIssueAssignment['state']): string {
  switch (state) {
    case 'in_progress': return 'Active';
    case 'done': return 'Done';
    case 'dropped': return 'Dropped';
    default: return 'Planned';
  }
}

export function TriageTrackerSection({
  issueKey,
  issueAssigneeId,
  developers,
  assignments,
  trackerDate,
  firstLinkedAccountId,
  onAdd,
  isAdding,
}: TriageTrackerSectionProps) {
  const [expanded, setExpanded] = useState(true);
  const [taskTitle, setTaskTitle] = useState('');

  const selectedAccountId = useMemo(() => {
    if (issueAssigneeId) {
      const issueAssignee = developers.find((d) => d.accountId === issueAssigneeId || d.jiraAccountId === issueAssigneeId);
      if (issueAssignee) return issueAssignee.accountId;
    }
    if (firstLinkedAccountId && developers.some((d) => d.accountId === firstLinkedAccountId)) return firstLinkedAccountId;
    return developers[0]?.accountId;
  }, [developers, issueAssigneeId, firstLinkedAccountId]);

  const [accountId, setAccountId] = useState<string | undefined>(selectedAccountId);
  const currentAccountId = accountId ?? selectedAccountId;
  const selectedDev = developers.find((d) => d.accountId === currentAccountId);

  const handleAdd = useCallback(() => {
    if (!currentAccountId || !taskTitle.trim()) return;
    onAdd(currentAccountId, taskTitle.trim());
    setTaskTitle('');
  }, [currentAccountId, taskTitle, onAdd]);

  if (!developers.length) return null;

  return (
    <div className="triage-section">
      <button
        type="button"
        onClick={() => setExpanded((p) => !p)}
        aria-expanded={expanded}
        className="w-full flex items-center gap-2 group"
      >
        <ChevronRight
          size={12}
          className="shrink-0 transition-transform duration-150"
          style={{ color: 'var(--text-muted)', transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)' }}
        />
        <span className="triage-section-label"><Users size={11} /> Team board</span>
        {assignments.length > 0 && (
          <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded-full ml-1"
            style={{ background: 'var(--accent-glow)', color: 'var(--accent)' }}>
            {assignments.length} linked
          </span>
        )}
      </button>

      {expanded && (
        <div className="mt-2.5 space-y-2">
          <div className="flex gap-1.5">
            <input
              type="text"
              value={taskTitle}
              onChange={(e) => setTaskTitle(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); }}
              placeholder="Task description…"
              aria-label="Task"
              className="flex-1 rounded-md px-2.5 py-1.5 text-[12.5px] outline-none transition-colors"
              style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
            />
            <button
              type="button"
              onClick={handleAdd}
              disabled={!selectedDev || isAdding || !taskTitle.trim()}
              className="shrink-0 rounded-md px-2.5 py-1.5 text-[12px] font-semibold disabled:opacity-30 transition-colors"
              style={{ background: 'var(--accent-glow)', color: 'var(--accent)', border: '1px solid color-mix(in srgb, var(--accent) 20%, transparent)' }}
            >
              {isAdding ? '…' : selectedDev ? `Add to ${firstName(selectedDev.displayName)}` : 'Add'}
            </button>
          </div>

          <div className="flex flex-wrap gap-1">
            {developers.map((dev) => {
              const isSelected = currentAccountId === dev.accountId;
              return (
                <button
                  key={dev.accountId}
                  type="button"
                  onClick={() => setAccountId(dev.accountId)}
                  aria-pressed={isSelected}
                  className="rounded-full px-2 py-0.5 text-[12px] font-medium transition-colors"
                  style={{
                    background: isSelected ? 'var(--accent-glow)' : 'transparent',
                    color: isSelected ? 'var(--accent)' : 'var(--text-secondary)',
                    border: `1px solid ${isSelected ? 'var(--border-active)' : 'var(--border)'}`,
                  }}
                >
                  {dev.displayName}
                  {(issueAssigneeId === dev.accountId || issueAssigneeId === dev.jiraAccountId) && <span className="text-[11px] opacity-60 ml-0.5">●</span>}
                </button>
              );
            })}
          </div>

          {assignments.length > 0 && (
            <div className="rounded-md px-2.5 py-2 space-y-0.5" style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border)' }}>
              <div className="text-[11px] font-bold uppercase tracking-[0.08em]" style={{ color: 'var(--text-muted)' }}>
                Linked Today
              </div>
              {assignments.map((a) => (
                <div key={a.itemId} className="text-[12px]" style={{ color: 'var(--text-secondary)' }}>
                  {a.developer.displayName} · {stateLabel(a.state)} · {a.title}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
