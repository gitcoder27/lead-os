import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { SuggestionBar } from '@/components/triage/SuggestionBar';
import { buildSuggestionRows, buildUndoUpdate } from '@/lib/suggestion-diff';
import { TestWrapper } from '@/test/wrapper';
import type { AssignmentSuggestion, Developer, DeveloperWorkload, Issue } from '@/types';

const mockMutate = vi.fn();
let mockPending = false;

interface MockSuggestions {
  prioritySuggestion: { data: { suggested: string; reason: string; isDefault?: boolean } | null };
  dueDateSuggestion: { data: { suggested: string; reason: string } | null };
  assigneeSuggestion: { data: AssignmentSuggestion[] | null };
  dueDatePriority?: string;
}
let mockSuggestions: MockSuggestions;

vi.mock('@/hooks/useSuggestions', () => ({ useSuggestions: () => mockSuggestions }));
vi.mock('@/hooks/useUpdateIssue', () => ({ useUpdateIssue: () => ({ mutate: mockMutate, isPending: mockPending }) }));
const mockAddToast = vi.fn();
vi.mock('@/context/ToastContext', () => ({ useToast: () => ({ addToast: mockAddToast }) }));

const bob: Developer = { accountId: 'bob-2', jiraAccountId: 'jira-bob', displayName: 'Bob', isActive: true, participates: false };

function suggestionFor(developer: Developer): AssignmentSuggestion {
  return {
    developer,
    score: 1,
    reason: 'Lightest load',
    workload: { developer, activeDefects: 1, dueToday: 0, blocked: 0, score: 2, level: 'light' } as DeveloperWorkload,
  };
}

function issue(overrides: Partial<Issue> = {}): Issue {
  return {
    jiraKey: 'PROJ-101',
    summary: 'Crash',
    description: '',
    priorityName: 'High',
    priorityId: '2',
    statusName: 'To Do',
    statusCategory: 'new',
    assigneeName: 'Alice',
    assigneeId: 'alice-1',
    reporterName: 'John',
    labels: [],
    dueDate: '2026-03-10',
    flagged: false,
    createdAt: '2026-03-01T09:00:00Z',
    updatedAt: '2026-03-05T09:00:00Z',
    localTags: [],
    ...overrides,
  } as Issue;
}

function renderBar(i: Issue = issue()) {
  return render(
    <TestWrapper>
      <SuggestionBar issue={i} />
    </TestWrapper>
  );
}

/** Nothing set by hand yet, so every suggestion fills a blank and Apply all covers them all. */
const blankIssue = () => issue({ dueDate: undefined, assigneeId: undefined, assigneeName: undefined });

beforeEach(() => {
  mockMutate.mockReset();
  mockAddToast.mockReset();
  mockPending = false;
  mockSuggestions = {
    prioritySuggestion: { data: { suggested: 'Highest', reason: 'Production-impacting label detected.' } },
    dueDateSuggestion: { data: { suggested: '2026-03-02', reason: 'Highest priority target is 24 hours from creation.' } },
    assigneeSuggestion: { data: [suggestionFor(bob)] },
  };
});

describe('SuggestionBar (docs/56 P5-02)', () => {
  it('shows current versus suggested for every field that would change', () => {
    renderBar();

    expect(screen.getByTestId('suggestion-priority-current')).toHaveTextContent('High');
    expect(screen.getByTestId('suggestion-priority-suggested')).toHaveTextContent('Highest');
    expect(screen.getByTestId('suggestion-dueDate-current')).toHaveTextContent('2026-03-10');
    expect(screen.getByTestId('suggestion-dueDate-suggested')).toHaveTextContent('2026-03-02');
    expect(screen.getByTestId('suggestion-assignee-current')).toHaveTextContent('Alice');
    expect(screen.getByTestId('suggestion-assignee-suggested')).toHaveTextContent('Bob');
    expect(screen.getByText('Production-impacting label detected.')).toBeInTheDocument();
  });

  it('applies one field at a time and leaves the others alone', () => {
    renderBar();

    fireEvent.click(screen.getByRole('button', { name: 'Apply due date' }));

    expect(mockMutate).toHaveBeenCalledTimes(1);
    expect(mockMutate.mock.calls[0]?.[0]).toEqual({ key: 'PROJ-101', update: { dueDate: '2026-03-02' } });
  });

  it('Apply all writes every shown field in one update, using the Jira account id for the assignee', () => {
    renderBar(blankIssue());

    fireEvent.click(screen.getByRole('button', { name: 'Apply all 3 suggestions' }));

    expect(mockMutate).toHaveBeenCalledTimes(1);
    expect(mockMutate.mock.calls[0]?.[0]).toEqual({
      key: 'PROJ-101',
      update: { priorityName: 'Highest', dueDate: '2026-03-02', assigneeId: 'jira-bob' },
    });
  });

  it('never offers the default-only priority, so Apply all cannot overwrite a real priority with the fallback', () => {
    mockSuggestions.prioritySuggestion = { data: { suggested: 'Medium', reason: 'Default suggestion for general defects.', isDefault: true } };
    renderBar(blankIssue());

    expect(screen.queryByTestId('suggestion-priority')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Apply all 2 suggestions' }));
    expect(mockMutate.mock.calls[0]?.[0].update).not.toHaveProperty('priorityName');
  });

  it('hides suggestions that match what the issue already has, and the whole card when nothing would change', () => {
    mockSuggestions.prioritySuggestion = { data: { suggested: 'High', reason: 'Customer-impacting label detected.' } };
    mockSuggestions.dueDateSuggestion = { data: { suggested: '2026-03-10', reason: 'x' } };
    mockSuggestions.assigneeSuggestion = { data: [suggestionFor({ ...bob, accountId: 'alice-1', jiraAccountId: 'alice-1', displayName: 'Alice' })] };
    const { container } = renderBar();

    expect(container).toBeEmptyDOMElement();
  });

  it('with a single change there is no Apply all, only that row’s Apply', () => {
    mockSuggestions.dueDateSuggestion = { data: null };
    mockSuggestions.assigneeSuggestion = { data: null };
    renderBar();

    expect(screen.queryByRole('button', { name: /apply all/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Apply priority' })).toBeInTheDocument();
  });

  it('surfaces a failed update inline instead of swallowing it', () => {
    renderBar();
    mockMutate.mockImplementation((_vars: unknown, options?: { onError?: (e: Error) => void }) => {
      options?.onError?.(new Error('Jira rejected the priority change'));
    });

    fireEvent.click(screen.getByRole('button', { name: 'Apply priority' }));

    const alert = screen.getByRole('alert');
    expect(within(alert).getByText(/Jira rejected the priority change/)).toBeInTheDocument();
  });

  it('clears an earlier error when the next attempt starts', () => {
    renderBar();
    mockMutate.mockImplementationOnce((_vars: unknown, options?: { onError?: (e: Error) => void }) => {
      options?.onError?.(new Error('boom'));
    });
    fireEvent.click(screen.getByRole('button', { name: 'Apply priority' }));
    expect(screen.getByRole('alert')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Apply priority' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('disables the buttons while an update is in flight', () => {
    mockPending = true;
    renderBar(blankIssue());

    expect(screen.getByRole('button', { name: 'Apply priority' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Apply all 3 suggestions' })).toBeDisabled();
  });

  it('leaves changes that replace a value set by hand out of Apply all (P5-02 review)', () => {
    mockSuggestions.dueDateSuggestion = { data: { suggested: '2026-03-02', reason: 'SLA' } };
    // The due date is already set by hand; priority and the (blank) assignee go in Apply all.
    renderBar(issue({ assigneeId: undefined, assigneeName: undefined }));

    expect(screen.getByRole('button', { name: 'Apply all 2 suggestions' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Apply all 2 suggestions' }));
    expect(mockMutate.mock.calls[0]?.[0].update).toEqual({ priorityName: 'Highest', assigneeId: 'jira-bob' });
    expect(within(screen.getByTestId('suggestion-dueDate')).getByText(/not part of Apply all/)).toBeInTheDocument();
  });

  it('a due date counted for the suggested priority also sets that priority when applied alone', () => {
    mockSuggestions.dueDatePriority = 'Highest';
    renderBar(blankIssue());

    fireEvent.click(screen.getByRole('button', { name: 'Apply due date' }));

    expect(mockMutate.mock.calls[0]?.[0].update).toEqual({ dueDate: '2026-03-02', priorityName: 'Highest' });
    expect(screen.getByText(/Counted for Highest priority/)).toBeInTheDocument();
  });

  it('offers Undo after a Jira write, restoring the previous values', () => {
    mockMutate.mockImplementation((_vars: unknown, options?: { onSuccess?: () => void }) => options?.onSuccess?.());
    renderBar();

    fireEvent.click(screen.getByRole('button', { name: 'Apply assignee' }));
    const toast = mockAddToast.mock.calls[0]?.[0];
    expect(toast).toMatchObject({ type: 'success', title: 'Updated PROJ-101 in Jira', action: { label: 'Undo' } });
    expect(toast.message).toBeUndefined();

    toast.action.onClick();
    expect(mockMutate.mock.calls[1]?.[0]).toEqual({ key: 'PROJ-101', update: { assigneeId: 'alice-1' } });
    expect(mockAddToast.mock.calls[1]?.[0]).toMatchObject({ type: 'success', title: 'Restored PROJ-101 in Jira' });
  });

  it('undoes assignment back to unassigned', () => {
    mockMutate.mockImplementation((_vars: unknown, options?: { onSuccess?: () => void }) => options?.onSuccess?.());
    renderBar(blankIssue());

    fireEvent.click(screen.getByRole('button', { name: 'Apply assignee' }));

    const toast = mockAddToast.mock.calls[0]?.[0];
    expect(toast.action.label).toBe('Undo');
    toast.action.onClick();
    expect(mockMutate.mock.calls[1]?.[0]).toEqual({ key: 'PROJ-101', update: { assigneeId: null } });
  });

  it('warns when the suggested due date is already past', () => {
    mockSuggestions.prioritySuggestion = { data: null };
    mockSuggestions.assigneeSuggestion = { data: null };
    renderBar();

    expect(screen.getByText(/already in the past/i)).toBeInTheDocument();
  });
});

describe('buildUndoUpdate', () => {
  it('restores standard priorities, dates and assignees, and flags fields it cannot clear', () => {
    expect(buildUndoUpdate(issue(), { priorityName: 'Highest', dueDate: '2026-03-02', assigneeId: 'jira-bob' })).toEqual({
      update: { priorityName: 'High', dueDate: '2026-03-10', assigneeId: 'alice-1' },
      complete: true,
    });
    expect(buildUndoUpdate(issue({ priorityName: 'P1', dueDate: undefined }), { priorityName: 'High', dueDate: '2026-03-02' })).toEqual({
      update: {dueDate: null},
      complete: false,
    });
  });
});

describe('buildSuggestionRows', () => {
  it('compares due dates by day and tolerates a missing current due date', () => {
    const rows = buildSuggestionRows(issue({ dueDate: undefined }), {
      dueDate: { suggested: '2026-03-20', reason: 'r' },
      today: '2026-03-01',
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ field: 'dueDate', current: 'None', warning: undefined });

    expect(
      buildSuggestionRows(issue({ dueDate: '2026-03-20T00:00:00.000Z' }), { dueDate: { suggested: '2026-03-20', reason: 'r' } })
    ).toEqual([]);
  });

  it('suggests an assignee for an unassigned issue', () => {
    const rows = buildSuggestionRows(issue({ assigneeId: undefined, assigneeName: undefined }), { assignee: suggestionFor(bob) });
    expect(rows[0]).toMatchObject({ field: 'assignee', current: 'Unassigned', suggested: 'Bob', update: { assigneeId: 'jira-bob' } });
  });
});
