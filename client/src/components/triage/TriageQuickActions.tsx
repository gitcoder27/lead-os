import { CalendarDays, ChevronsUp, Flag, UserRound } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { IssueDateEditor } from '@/components/table/IssueDateEditor';
import { Avatar } from '@/components/ui/Avatar';
import { PRIORITY_OPTIONS } from '@/lib/constants';
import type { Issue, Developer } from '@/types';
import { Select } from '@/components/ui/Select';

interface TriageQuickActionsProps {
  issue: Issue;
  developers: Developer[] | undefined;
  editingField: string | null;
  onEditField: (field: string | null) => void;
  onUpdate: (key: string, update: Record<string, unknown>) => void;
}

export function TriageQuickActions({ issue, developers, editingField, onEditField, onUpdate }: TriageQuickActionsProps) {
  const dueValue = issue.developmentDueDate ?? issue.dueDate;
  // docs/73 UXD-21: only Highest carries a tone (danger); no orange or amber priority chips.
  const priorityTone = issue.priorityName === 'Highest' ? 'var(--danger)' : undefined;
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
        label="Priority"
        shortcut="P"
        icon={<ChevronsUp size={13} aria-hidden="true" style={{ color: priorityTone ?? 'var(--text-muted)' }} />}
        active={editingField === 'priority'}
        onClick={() => onEditField(editingField === 'priority' ? null : 'priority')}
        accentColor={priorityTone}
      >
        {editingField === 'priority' ? (
          <Select size="sm" variant="quiet" style={{ color: priorityTone ?? 'var(--text-primary)' }}
            autoFocus
            value={issue.priorityName}
            onChange={(e) => { onUpdate(issue.jiraKey, { priorityName: e.target.value }); onEditField(null); }}
            onBlur={() => onEditField(null)}
          >
            {PRIORITY_OPTIONS.map((p) => <option key={p} value={p}>{p}</option>)}
          </Select>
        ) : (
          <span className="text-ui font-semibold" style={{ color: priorityTone ?? 'var(--text-primary)' }}>
            {issue.priorityName}
          </span>
        )}
      </Chip>

      <Chip
        label="Assignee"
        shortcut="A"
        icon={issue.assigneeName
          ? <Avatar name={issue.assigneeName} seed={issue.assigneeId ?? undefined} size={18} />
          : <UserRound size={13} aria-hidden="true" style={{ color: 'var(--text-muted)' }} />}
        active={editingField === 'assignee'}
        onClick={() => onEditField(editingField === 'assignee' ? null : 'assignee')}
      >
        {editingField === 'assignee' ? (
          <Select size="sm" variant="quiet"
            autoFocus
            value={issue.assigneeId ?? ''}
            onChange={(e) => { onUpdate(issue.jiraKey, { assigneeId: e.target.value || null }); onEditField(null); }}
            onBlur={() => onEditField(null)}
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
          </Select>
        ) : (
          <span
            className="text-ui font-medium"
            style={{ color: issue.assigneeName ? 'var(--text-primary)' : 'var(--text-muted)' }}
          >
            {issue.assigneeName ?? 'Unassigned'}
          </span>
        )}
      </Chip>

      <Chip
        label="Due date"
        shortcut="D"
        icon={<CalendarDays size={13} aria-hidden="true" style={{ color: 'var(--text-muted)' }} />}
        active={editingField === 'dueDate'}
        onClick={() => onEditField(editingField === 'dueDate' ? null : 'dueDate')}
      >
        {editingField === 'dueDate' ? (
          <IssueDateEditor
            key={issue.jiraKey}
            currentValue={dueValue }
            onSave={(value) =>  onUpdate(issue.jiraKey, { developmentDueDate: value }) }onClose={() => onEditField(null)}
            className="text-ui bg-transparent cursor-pointer font-medium"
            style={{ color: 'var(--text-primary)' }}
          />
        ) : (
          <span
            className="text-ui font-medium"
            style={{ color: dueValue ? 'var(--text-primary)' : 'var(--text-muted)' }}
          >
            {dueValue ? format(parseISO(dueValue), 'EEE d MMM') : 'No due date'}
          </span>
        )}
      </Chip>

      <button
        type="button"
        onClick={() => onUpdate(issue.jiraKey, { flagged: !issue.flagged })}
        className="triage-chip"
        aria-pressed={Boolean(issue.flagged)}
        aria-label={issue.flagged ? 'Blocked — clear the flag' : 'Mark as blocked'}
        style={{
          background: issue.flagged ? 'color-mix(in srgb, var(--danger) 10%, transparent)' : 'transparent',
          color: issue.flagged ? 'var(--danger)' : 'var(--text-muted)',
          borderColor: issue.flagged ? 'color-mix(in srgb, var(--danger) 24%, transparent)' : 'var(--border)',
        }}
        title={issue.flagged ? 'Clear blocked flag' : 'Mark as blocked'}
      >
        <Flag size={12} aria-hidden="true" />
        {issue.flagged && <span className="text-ui font-semibold">Blocked</span>}
      </button>
    </div>
  );
}

/**
 * docs/73 UXD-21: an icon says what the chip is, not a "P"/"A"/"D" letter. The letter is still the
 * panel's shortcut, so it stays in the tooltip and `aria-keyshortcuts`. While editing, the chip
 * is a plain frame around its control, not a button wrapping a select.
 */
function Chip({
  label,
  shortcut,
  icon,
  active,
  onClick,
  accentColor,
  children,
}: {
  label: string;
  shortcut: string;
  icon: React.ReactNode;
  active: boolean;
  onClick: () => void;
  accentColor?: string;
  children: React.ReactNode;
}) {
  const style = {
    background: active
      ? 'var(--bg-tertiary)'
      : accentColor
        ? `color-mix(in srgb, ${accentColor} 6%, transparent)`
        : 'transparent',
    borderColor: active ? 'var(--border-active)' : 'var(--border)',
  };
  if (active) {
    return (
      <div className="triage-chip" style={style} aria-label={label} role="group">
        {icon}
        {children}
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className="triage-chip"
      style={style}
      title={`${label} (${shortcut})`}
      aria-keyshortcuts={shortcut.toLowerCase()}
    >
      {icon}
      <span className="sr-only">{label}: </span>
      {children}
    </button>
  );
}
