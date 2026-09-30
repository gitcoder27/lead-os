import type { AssignmentSuggestion, DueDateSuggestion, Issue, IssueUpdate, PrioritySuggestion } from '@/types';

export type SuggestionField = 'priority' | 'dueDate' | 'assignee';

/** One line of the suggestions diff: what is set now, what is suggested, and the write that applies it. */
export interface SuggestionRow {
  field: SuggestionField;
  label: string;
  current: string;
  suggested: string;
  reason?: string;
  /** Extra caution shown next to the row (for example a due date that is already past). */
  warning?: string;
  update: IssueUpdate;
}

interface SuggestionInputs {
  priority?: PrioritySuggestion | null;
  dueDate?: DueDateSuggestion | null;
  assignee?: AssignmentSuggestion | null;
  /** YYYY-MM-DD, injected for tests. */
  today?: string;
}

const day = (value?: string | null) => (value ? value.slice(0, 10) : '');

/**
 * docs/56 P5-02: only suggestions that would change something. A default-only priority
 * (nothing about the issue supported it) and any value the issue already has are dropped,
 * so "Apply All" can never overwrite real data with a fallback or rewrite what is already set.
 */
export function buildSuggestionRows(issue: Issue, inputs: SuggestionInputs): SuggestionRow[] {
  const rows: SuggestionRow[] = [];
  const today = inputs.today ?? new Date().toISOString().slice(0, 10);

  const priority = inputs.priority;
  if (priority?.suggested && !priority.isDefault && priority.suggested !== issue.priorityName) {
    rows.push({
      field: 'priority',
      label: 'Priority',
      current: issue.priorityName || 'None',
      suggested: priority.suggested,
      reason: priority.reason,
      update: { priorityName: priority.suggested },
    });
  }

  const dueDate = inputs.dueDate;
  if (dueDate?.suggested && day(dueDate.suggested) !== day(issue.dueDate)) {
    rows.push({
      field: 'dueDate',
      label: 'Due date',
      current: day(issue.dueDate) || 'None',
      suggested: dueDate.suggested,
      reason: dueDate.reason,
      warning: dueDate.suggested < today ? 'Already in the past: applying it makes this issue overdue.' : undefined,
      update: { dueDate: dueDate.suggested },
    });
  }

  const assignee = inputs.assignee;
  const assigneeId = assignee?.developer.jiraAccountId ?? assignee?.developer.accountId;
  const alreadyAssigned = Boolean(
    issue.assigneeId &&
      (issue.assigneeId === assignee?.developer.jiraAccountId || issue.assigneeId === assignee?.developer.accountId)
  );
  if (assignee && assigneeId && !alreadyAssigned) {
    rows.push({
      field: 'assignee',
      label: 'Assignee',
      current: issue.assigneeName || 'Unassigned',
      suggested: assignee.developer.displayName,
      reason: assignee.reason,
      update: { assigneeId },
    });
  }

  return rows;
}

/** Merge the updates of several rows into one write. */
export function mergeRowUpdates(rows: SuggestionRow[]): IssueUpdate {
  return rows.reduce<IssueUpdate>((acc, row) => ({ ...acc, ...row.update }), {});
}
