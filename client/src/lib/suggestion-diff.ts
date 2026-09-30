import type { AssignmentSuggestion, DueDateSuggestion, Issue, IssueUpdate, PrioritySuggestion } from '@/types';
import { PRIORITY_OPTIONS } from '@/lib/constants';
import { getLocalIsoDate } from '@/lib/utils';

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
  /**
   * docs/56 P5-02 review: the row replaces a value someone already set (a due date or an assignee).
   * Such rows are left out of "Apply all" and only change on their own Apply.
   */
  overwrites: boolean;
  update: IssueUpdate;
}

interface SuggestionInputs {
  priority?: PrioritySuggestion | null;
  dueDate?: DueDateSuggestion | null;
  /** The priority the due-date suggestion was counted for (see `useSuggestions`). */
  dueDatePriority?: string;
  assignee?: AssignmentSuggestion | null;
  /** YYYY-MM-DD, injected for tests. Defaults to the local date. */
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
  const today = inputs.today ?? getLocalIsoDate();

  const priority = inputs.priority;
  const priorityRow = Boolean(priority?.suggested && !priority.isDefault && priority.suggested !== issue.priorityName);
  if (priority && priorityRow) {
    rows.push({
      field: 'priority',
      label: 'Priority',
      current: issue.priorityName || 'None',
      suggested: priority.suggested,
      reason: priority.reason,
      overwrites: false,
      update: { priorityName: priority.suggested },
    });
  }

  const dueDate = inputs.dueDate;
  if (dueDate?.suggested && day(dueDate.suggested) !== day(issue.dueDate)) {
    // The target was counted for a priority the issue does not have yet (the suggested one), so
    // applying the date alone would pair it with the wrong priority: the row sets both.
    const forPriority = inputs.dueDatePriority;
    const needsPriority = priorityRow && Boolean(forPriority) && forPriority !== issue.priorityName;
    rows.push({
      field: 'dueDate',
      label: 'Due date',
      current: day(issue.dueDate) || 'None',
      suggested: dueDate.suggested,
      reason: needsPriority
        ? `${dueDate.reason} Counted for ${forPriority} priority, so applying it also sets that priority.`
        : dueDate.reason,
      warning: dueDate.suggested < today ? 'Already in the past: applying it makes this issue overdue.' : undefined,
      overwrites: Boolean(day(issue.dueDate)),
      update: needsPriority ? { dueDate: dueDate.suggested, priorityName: forPriority } : { dueDate: dueDate.suggested },
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
      overwrites: Boolean(issue.assigneeId),
      update: { assigneeId },
    });
  }

  return rows;
}

/** docs/56 P5-02 review: "Apply all" never replaces a value someone set by hand. */
export function applyAllRows(rows: SuggestionRow[]): SuggestionRow[] {
  return rows.filter((row) => !row.overwrites);
}

/** Merge the updates of several rows into one write. */
export function mergeRowUpdates(rows: SuggestionRow[]): IssueUpdate {
  return rows.reduce<IssueUpdate>((acc, row) => ({ ...acc, ...row.update }), {});
}

export interface SuggestionUndo {
  /** The write that puts back what the issue had before; empty when nothing can be restored. */
  update: IssueUpdate;
  /** False when a field was empty (or not a standard priority) before: the API cannot clear it yet. */
  complete: boolean;
}

/** The previous values for the fields `applied` changes, to offer an Undo after a Jira write. */
export function buildUndoUpdate(issue: Issue, applied: IssueUpdate): SuggestionUndo {
  const update: IssueUpdate = {};
  let complete = true;
  if (applied.priorityName !== undefined) {
    if (PRIORITY_OPTIONS.includes(issue.priorityName)) update.priorityName = issue.priorityName;
    else complete = false;
  }
  if (applied.dueDate !== undefined) {
    if (day(issue.dueDate)) update.dueDate = day(issue.dueDate);
    else complete = false;
  }
  if (applied.assigneeId !== undefined) {
    if (issue.assigneeId) update.assigneeId = issue.assigneeId;
    else complete = false;
  }
  return { update, complete };
}
