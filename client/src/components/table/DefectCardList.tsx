import { Fragment } from 'react';
import type { Virtualizer } from '@tanstack/react-virtual';
import { format, parseISO } from 'date-fns';
import type { Issue } from '@/types';
import { isDueToday, isOverdue } from '@/lib/utils';

/**
 * docs/56 UX-25: Work on a phone — one card per defect (title, assignee, due date, status) instead
 * of a table that needs sideways scrolling. Same rows, order and selection as the table.
 */
export function DefectCardList({ issues, selectedKey, onSelectIssue, virtualRows }: {
  issues: Issue[];
  selectedKey?: string | null;
  onSelectIssue: (jiraKey: string) => void;
  virtualRows: Virtualizer<HTMLElement, HTMLElement>;
}) {
  const items = virtualRows.getVirtualItems();
  return (
    <ul className="p-1" aria-label="Defects">
      {items.map((item, index) => {
        const issue = issues[item.index]!;
        const gap = item.start - (items[index - 1]?.end ?? 0);
        const due = issue.developmentDueDate ?? issue.dueDate;
        const overdue = isOverdue(due);
        const today = isDueToday(due);
        const dueLabel = due ? `${overdue ? 'Overdue · ' : today ? 'Due today · ' : 'Due '}${format(parseISO(due), 'EEE d MMM')}` : 'No due date';
        return (
          <Fragment key={issue.jiraKey}>
          {gap > 0 && <li aria-hidden="true" style={{ height: gap }} />}
          <li ref={virtualRows.measureElement} data-index={item.index} className="pb-1.5" aria-posinset={item.index + 1} aria-setsize={issues.length}>
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
          </Fragment>
        );
      })}
      <li aria-hidden="true" style={{ height: Math.max(0, virtualRows.getTotalSize() - (items.at(-1)?.end ?? 0)) }} />
    </ul>
  );
}
