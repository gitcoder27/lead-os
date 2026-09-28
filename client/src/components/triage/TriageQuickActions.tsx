import { priorityColor, formatDate } from '@/lib/utils';
import { PRIORITY_OPTIONS } from '@/lib/constants';
import type { Issue, Developer } from '@/types';

interface TriageQuickActionsProps {
  issue: Issue;
  developers: Developer[] | undefined;
  editingField: string | null;
  onEditField: (field: string | null) => void;
  onUpdate: (key: string, update: Record<string, unknown>) => void;
}

export function TriageQuickActions({ issue, developers, editingField, onEditField, onUpdate }: TriageQuickActionsProps) {
  const dueValue = issue.developmentDueDate ?? issue.dueDate;
  const assigneeOptions = (developers ?? [])
    .filter((developer) => Boolean(developer.jiraAccountId) || developer.source !== 'manual')
    .map((developer) => ({
      developer,
      value: developer.jiraAccountId ?? developer.accountId,
    }))
    .filter(({ developer, value }) =>
      developer.availability?.state !== 'inactive' ||
      value === issue.assigneeId ||
      developer.accountId === issue.assigneeId
    );

  return (
    <div className="flex flex-wrap items-center gap-1.5 px-5 pb-3">
      <Chip
        hint="P"
        active={editingField === 'priority'}
        onClick={() => onEditField(editingField === 'priority' ? null : 'priority')}
        accentColor={priorityColor(issue.priorityName)}
      >
        {editingField === 'priority' ? (
          <select
            autoFocus
            value={issue.priorityName}
            onChange={(e) => { onUpdate(issue.jiraKey, { priorityName: e.target.value }); onEditField(null); }}
            onBlur={() => onEditField(null)}
            className="text-[12px] bg-transparent outline-none cursor-pointer font-semibold"
            style={{ color: priorityColor(issue.priorityName) }}
          >
            {PRIORITY_OPTIONS.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        ) : (
          <span className="text-[12px] font-semibold" style={{ color: priorityColor(issue.priorityName) }}>
            {issue.priorityName}
          </span>
        )}
      </Chip>

      <Chip
        hint="A"
        active={editingField === 'assignee'}
        onClick={() => onEditField(editingField === 'assignee' ? null : 'assignee')}
      >
        {editingField === 'assignee' ? (
          <select
            autoFocus
            value={issue.assigneeId ?? ''}
            onChange={(e) => { onUpdate(issue.jiraKey, { assigneeId: e.target.value || undefined }); onEditField(null); }}
            onBlur={() => onEditField(null)}
            className="text-[12px] bg-transparent outline-none cursor-pointer font-medium"
            style={{ color: 'var(--text-primary)' }}
          >
            <option value="">Unassigned</option>
            {assigneeOptions.map(({ developer, value }) => (
              <option
                key={developer.accountId}
                value={value}
                disabled={developer.availability?.state === 'inactive'}
              >
                {developer.availability?.state === 'inactive'
                  ? `${developer.displayName} (inactive)`
                  : developer.displayName}
              </option>
            ))}
          </select>
        ) : (
          <span
            className="text-[12px] font-medium"
            style={{ color: issue.assigneeName ? 'var(--text-primary)' : 'var(--text-muted)' }}
          >
            {issue.assigneeName ?? 'Unassigned'}
          </span>
        )}
      </Chip>

      <Chip
        hint="D"
        active={editingField === 'dueDate'}
        onClick={() => onEditField(editingField === 'dueDate' ? null : 'dueDate')}
      >
        {editingField === 'dueDate' ? (
          <input
            type="date"
            autoFocus
            value={dueValue ?? ''}
            onChange={(e) => { onUpdate(issue.jiraKey, { developmentDueDate: e.target.value }); onEditField(null); }}
            onBlur={() => onEditField(null)}
            className="text-[12px] bg-transparent outline-none cursor-pointer font-medium"
            style={{ color: 'var(--text-primary)' }}
          />
        ) : (
          <span
            className="text-[12px] font-medium"
            style={{ color: dueValue ? 'var(--text-primary)' : 'var(--text-muted)' }}
          >
            {formatDate(dueValue ?? undefined)}
          </span>
        )}
      </Chip>

      <button
        onClick={() => onUpdate(issue.jiraKey, { flagged: !issue.flagged })}
        className="triage-chip"
        style={{
          background: issue.flagged ? 'rgba(239,68,68,0.1)' : 'transparent',
          color: issue.flagged ? 'var(--danger)' : 'var(--text-muted)',
          borderColor: issue.flagged ? 'rgba(239,68,68,0.2)' : 'var(--border)',
        }}
        title={issue.flagged ? 'Clear blocked flag' : 'Mark as blocked'}
      >
        <span className="text-[12px] font-semibold">{issue.flagged ? '⚑ Blocked' : '⚑'}</span>
      </button>
    </div>
  );
}

function Chip({
  hint,
  active,
  onClick,
  accentColor,
  children,
}: {
  hint: string;
  active: boolean;
  onClick: () => void;
  accentColor?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onClick(); }}
      className="triage-chip"
      style={{
        background: active
          ? 'var(--bg-tertiary)'
          : accentColor
            ? `color-mix(in srgb, ${accentColor} 6%, transparent)`
            : 'transparent',
        borderColor: active ? 'var(--border-active)' : 'var(--border)',
      }}
    >
      <kbd
        className="text-[11px] font-mono font-bold rounded px-1 py-px leading-none"
        style={{
          background: 'color-mix(in srgb, var(--text-muted) 12%, transparent)',
          color: 'var(--text-muted)',
        }}
      >
        {hint}
      </kbd>
      {children}
    </div>
  );
}
