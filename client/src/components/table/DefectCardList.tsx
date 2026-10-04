import { format, parseISO } from 'date-fns';
import type { Issue } from '@/types';
import { isDueToday, isOverdue } from '@/lib/utils';

/**
 * docs/56 UX-25: Work on a phone — one card per defect (title, assignee, due date, status) instead
 * of a table that needs sideways scrolling. Same rows, order and selection as the table.
 */
export function DefectCardList({ issues, selectedKey, onSelectIssue }: {
  issues: Issue[];
  selectedKey?: string | null;
  onSelectIssue: (jiraKey: string) => void;
}) {
  return (
    <ul className="space-y-1.5 p-1" aria-label="Defects">
      {issues.map((issue) => {
        const due = issue.developmentDueDate ?? issue.dueDate;
        const overdue = isOverdue(due);
        const today = isDueToday(due);
        const dueLabel = due ? `${overdue ? 'Overdue · ' : today ? 'Due today · ' : 'Due '}${format(parseISO(due), 'EEE d MMM')}` : 'No due date';
        return (
          <li key={issue.jiraKey}>
            <button
              type="button"
              onClick={() => onSelectIssue(issue.jiraKey)}
              aria-current={issue.jiraKey === selectedKey ? 'true' : undefined}
              className="ui-row-focus w-full rounded-xl border px-3 py-2.5 text-left"
              style={{
                borderColor: 'var(--border)',
                background: issue.jiraKey === selectedKey ? 'var(--accent-glow)' : 'var(--bg-primary)',
                boxShadow: overdue ? 'inset 3px 0 0 var(--danger)' : today ? 'inset 3px 0 0 var(--warning)' : undefined,
              }}
              data-testid="defect-card"
            >
              <span className="block text-[13.5px] font-medium leading-5" style={{ color: 'var(--text-primary)' }}>
                <span className="mr-1.5 font-mono text-[12px]" style={{ color: 'var(--accent-text)' }}>{issue.jiraKey}</span>
                {issue.summary}
              </span>
              <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px]" style={{ color: 'var(--text-secondary)' }}>
                <span>{issue.assigneeName ?? 'Unassigned'}</span>
                <span aria-hidden="true">·</span>
                <span style={{ color: overdue ? 'var(--task-danger-text)' : today ? 'var(--warning-text)' : undefined }}>{dueLabel}</span>
                <span aria-hidden="true">·</span>
                <span>{issue.statusName}</span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
