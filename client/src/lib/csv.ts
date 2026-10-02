import { taskLane, type Issue, type ManagerTask } from '@/types';
import { localDateOf } from './task-list';

/** Quote every cell and keep spreadsheet formula starters literal, even after whitespace. */
export function toCsv(headers: readonly string[], rows: readonly (readonly unknown[])[]): string {
  const cell = (value: unknown) => {
    let text = value == null ? '' : String(value);
    let first = 0;
    while (first < text.length && (text.charCodeAt(first) <= 31 || /\s/.test(text[first]!))) first++;
    if (['=', '+', '-', '@'].includes(text[first] ?? '')) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  };
  return `\uFEFF${[headers, ...rows].map((row) => row.map(cell).join(',')).join('\r\n')}\r\n`;
}
export function tasksCsv(
  rows: readonly (ManagerTask & { oneOnOne?: true })[],
  ownerName: (type: string | null, id: string | null) => string,
  today: string,
): string {
  return toCsv(
    [
      'Key',
      'Title',
      'Status',
      'Lane',
      'Owner',
      'Waiting on',
      'Plan date',
      'Deadline',
      'Check by',
      'Priority',
      'Labels',
      'Jira',
      'Created',
      'Closed',
    ],
    rows
      .filter((row) => !row.oneOnOne)
      .map((row) => [
        row.taskKey,
        row.title,
        row.status,
        taskLane(
          {
            status: row.status,
            later: row.later,
            hideUntil: row.hideUntil ?? null,
            scheduledOn: row.scheduledOn,
            dueDate: localDateOf(row.dueAt),
            ownerType: row.ownerType,
            needsTriage: row.needsTriage ?? false,
            waiting: Boolean(row.waitingOn),
          },
          today,
        ),
        ownerName(row.ownerType, row.ownerId),
        row.waitingOn?.label,
        row.scheduledOn,
        row.dueAt,
        row.followUpAt,
        row.priority,
        row.labels.join('; '),
        row.links
          .filter((link) => link.kind === 'jira')
          .map((link) => link.ref)
          .join('; '),
        row.createdAt,
        row.closedAt,
      ]),
  );
}
export function workCsv(rows: readonly Issue[]): string {
  return toCsv(
    ['Key', 'Summary', 'Status', 'Priority', 'Assignee', 'Due', 'Dev due', 'Tags', 'Updated'],
    rows.map((row) => [
      row.jiraKey,
      row.summary,
      row.statusName,
      row.priorityName,
      row.assigneeName,
      row.dueDate,
      row.developmentDueDate,
      row.localTags.map((tag) => tag.name).join('; '),
      row.updatedAt,
    ]),
  );
}
export function csvFileName(surface: 'tasks' | 'work', view: string, today: string): string {
  return `leados-${surface}-${view.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'view'}-${today}.csv`;
}
export function downloadCsv(csv: string, filename: string): void {
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}
