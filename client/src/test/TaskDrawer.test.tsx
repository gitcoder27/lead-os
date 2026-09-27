import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { TaskDetailResponse } from '@/types';

const mockUseTaskDetail = vi.fn();
const mockMutate = vi.fn();
const mockDelete = vi.fn();
const mockUser = vi.fn();

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: mockUser() }),
  useAuthScopeKey: () => 'ws:manager:manager',
}));

vi.mock('@/context/ToastContext', () => ({
  useToast: () => ({ addToast: vi.fn() }),
}));

vi.mock('@/hooks/useTaskDetail', () => ({
  useTaskDetail: (...args: unknown[]) => mockUseTaskDetail(...args),
  useUpdateTaskDetail: () => ({ mutate: mockMutate, isPending: false }),
  useDeleteTaskDetail: () => ({ mutate: mockDelete, isPending: false }),
  useAddTaskDetailLink: () => ({ mutate: vi.fn(), isPending: false }),
  useRemoveTaskDetailLink: () => ({ mutate: vi.fn(), isPending: false }),
  useCreateChildTask: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock('@/hooks/useTaskLabels', () => ({
  useTaskLabels: () => ({
    data: { labels: [{ name: 'category:follow_up', color: 'teal', system: true, createdAt: '' }] },
  }),
}));

vi.mock('@/hooks/useDevelopers', () => ({
  useDevelopers: () => ({ data: [{ accountId: 'dev-1', displayName: 'Dev One' }] }),
}));

vi.mock('@/components/tasks/TaskTimeline', () => ({
  TaskTimeline: () => <div data-testid="timeline" />,
  TaskTimelineDisclosure: () => <div data-testid="timeline" />,
}));

vi.mock('@/components/tasks/TaskUpdateComposer', () => ({
  TaskUpdateComposer: () => <div data-testid="composer" />,
}));

vi.mock('@/components/JiraIssueLink', () => ({
  JiraIssueLink: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

import { TaskDetailBody, TaskDrawer } from '@/components/tasks/TaskDrawer';
import { getLocalIsoDate, shiftLocalIsoDate } from '@/lib/utils';

function managerTask(overrides: Partial<TaskDetailResponse> = {}): TaskDetailResponse {
  return {
    id: 1,
    taskKey: 'T-7',
    title: 'Manager task',
    kind: 'task',
    status: 'active',
    ownerType: 'manager',
    ownerId: 'manager-a',
    priority: 'normal',
    scheduledOn: '2026-09-24',
    dueAt: null,
    startsAt: null,
    endsAt: null,
    participants: null,
    outcome: null,
    createdByType: 'manager',
    createdById: 'manager-a',
    createdAt: '2026-09-20T10:00:00Z',
    updatedAt: '2026-09-24T10:00:00Z',
    closedAt: null,
    deletedAt: null,
    links: [],
    legacyDeskItemId: 1,
    later: false,
    parentId: null,
    trackedByManagerId: 'manager-a',
    labels: ['category:follow_up'],
    nextAction: null,
    followUpAt: null,
    children: [],
    parent: null,
    ...overrides,
  } as TaskDetailResponse;
}

function queryFor(task: TaskDetailResponse) {
  return { data: task, isLoading: false, isError: false, error: null };
}

beforeEach(() => {
  mockMutate.mockReset();
  mockDelete.mockReset();
  mockUser.mockReturnValue({ accountId: 'manager-a', role: 'manager', developerAccountId: undefined });
});

describe('TaskDrawer body (P3-D2)', () => {
  it('renders all sections for a manager task', () => {
    mockUseTaskDetail.mockReturnValue(queryFor(managerTask()));
    const { container } = render(<TaskDetailBody taskKey="T-7" onNavigateTask={() => {}} />);
    expect(screen.getByDisplayValue('Manager task')).toBeTruthy();
    const terms = within(container.querySelector('dl')!).getAllByRole('term').map((term) => term.textContent);
    expect(terms).toEqual(['Owner', 'Tracked by', 'Scheduled', 'Follow-up', 'Priority', 'Labels']);
    expect(screen.getByRole('heading', { name: 'Links' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Activity' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Owner: You' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Task status: Active' })).toBeTruthy();
    expect(screen.getByText('follow up')).toBeTruthy(); // prefix stripped
    expect(screen.getByTestId('timeline')).toBeTruthy();
    expect(screen.getByTestId('composer')).toBeTruthy();
  });

  it('hides tracking, labels and private controls for developer principals', () => {
    mockUser.mockReturnValue({ accountId: 'u-dev', role: 'developer', developerAccountId: 'dev-1' });
    const task = {
      ...managerTask(),
      ownerType: 'developer' as const,
      ownerId: 'dev-1',
    } as TaskDetailResponse;
    // Developer DTO omits private fields entirely.
    delete (task as Record<string, unknown>).trackedByManagerId;
    delete (task as Record<string, unknown>).labels;
    delete (task as Record<string, unknown>).nextAction;
    delete (task as Record<string, unknown>).followUpAt;
    delete (task as Record<string, unknown>).later;
    mockUseTaskDetail.mockReturnValue(queryFor(task));
    const { container } = render(<TaskDetailBody taskKey="T-7" onNavigateTask={() => {}} />);
    expect(within(container.querySelector('dl')!).getAllByRole('term').map((term) => term.textContent)).toEqual(['Scheduled']);
    expect(screen.queryByText('Priority')).toBeNull();
    expect(screen.queryByLabelText('Delete task')).toBeNull();
    expect(screen.getByTestId('timeline')).toBeTruthy();
    expect(screen.getByTestId('composer')).toBeTruthy();
  });

  it('renders meeting fields and the action-item composer for meetings', () => {
    mockUseTaskDetail.mockReturnValue(queryFor(managerTask({ kind: 'meeting', startsAt: '2026-09-24T14:00:00Z', endsAt: '2026-09-24T15:00:00Z' })));
    render(<TaskDetailBody taskKey="T-7" onNavigateTask={() => {}} />);
    expect(screen.getByText('Meeting')).toBeTruthy();
    expect(screen.getByText('Starts')).toBeTruthy();
    expect(screen.getByText('Ends')).toBeTruthy();
    expect(screen.getByText('Participants')).toBeTruthy();
    expect(screen.getByText('Outcome')).toBeTruthy();
    expect(screen.getByText('Action items')).toBeTruthy();
    expect(screen.getByLabelText('New action item')).toBeTruthy();
    // Meetings hide follow-up + later.
    expect(screen.queryByText('Follow-up')).toBeNull();
    expect(screen.queryByText(/parked/)).toBeNull();
  });

  it('renders a read-only tombstone for deleted tasks', () => {
    mockUseTaskDetail.mockReturnValue(queryFor(managerTask({ deletedAt: '2026-09-23T18:00:00Z' })));
    render(<TaskDetailBody taskKey="T-7" onNavigateTask={() => {}} />);
    expect(screen.getByText(/was deleted/)).toBeTruthy();
    expect(screen.queryByTestId('composer')).toBeNull();
    // G7: the status control is a read-only pill on tombstones — no live control.
    expect(screen.queryByRole('button', { name: /task status/i })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Mark done' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    expect(screen.queryByRole('menuitem', { name: /delete task/i })).toBeNull();
  });

  it('renders the restricted former-owner view (P3-D15)', () => {
    mockUser.mockReturnValue({ accountId: 'u-dev', role: 'developer', developerAccountId: 'dev-1' });
    mockUseTaskDetail.mockReturnValue(queryFor({
      taskKey: 'T-9',
      title: 'No longer mine',
      status: 'blocked',
      access: 'former-owner',
    } as unknown as TaskDetailResponse));
    render(<TaskDetailBody taskKey="T-9" onNavigateTask={() => {}} />);
    expect(screen.getByText('No longer mine')).toBeTruthy();
    expect(screen.getByText('Blocked')).toBeTruthy();
    expect(screen.getByText(/no longer own this task/i)).toBeTruthy();
    // Restricted projection: own timeline only — no editing or other sections.
    expect(screen.getByTestId('timeline')).toBeTruthy();
    expect(screen.queryByTestId('composer')).toBeNull();
    expect(screen.queryByText('Owner')).toBeNull();
    expect(screen.queryByText('Links')).toBeNull();
    expect(screen.queryByText('Action items')).toBeNull();
    expect(screen.queryByText('Labels')).toBeNull();
    expect(screen.queryByLabelText('Delete task')).toBeNull();
  });
});

describe('TaskDrawer interactions', () => {
  it('marks done in one click and reopens closed work', () => {
    mockUseTaskDetail.mockReturnValue(queryFor(managerTask()));
    const { unmount } = render(<TaskDetailBody taskKey="T-7" onNavigateTask={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Mark done' }));
    expect(mockMutate).toHaveBeenCalledWith({ status: 'done' }, expect.anything());
    unmount();

    mockUseTaskDetail.mockReturnValue(queryFor(managerTask({ status: 'done', closedAt: '2026-09-25T10:00:00Z' })));
    render(<TaskDetailBody taskKey="T-7" onNavigateTask={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Reopen' }));
    expect(mockMutate).toHaveBeenCalledWith({ status: 'open' }, expect.anything());
  });

  it('sets any status from the status menu', () => {
    mockUseTaskDetail.mockReturnValue(queryFor(managerTask()));
    render(<TaskDetailBody taskKey="T-7" onNavigateTask={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Task status: Active' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: /blocked/i }));
    expect(mockMutate).toHaveBeenCalledWith({ status: 'blocked' }, expect.anything());
  });

  it('schedules from presets, parks in Later, and clears the date', () => {
    mockUseTaskDetail.mockReturnValue(queryFor(managerTask()));
    render(<TaskDetailBody taskKey="T-7" onNavigateTask={() => {}} />);
    const scheduleButton = () => screen.getByRole('button', { name: /^Scheduled:/ });

    fireEvent.click(scheduleButton());
    fireEvent.click(screen.getByRole('menuitem', { name: /tomorrow/i }));
    expect(mockMutate).toHaveBeenLastCalledWith({ scheduledOn: shiftLocalIsoDate(getLocalIsoDate(), 1), later: false }, expect.anything());

    fireEvent.click(scheduleButton());
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: /later/i }));
    expect(mockMutate).toHaveBeenLastCalledWith({ later: true }, expect.anything());

    fireEvent.click(scheduleButton());
    fireEvent.click(screen.getByRole('menuitem', { name: /clear date/i }));
    expect(mockMutate).toHaveBeenLastCalledWith({ scheduledOn: null }, expect.anything());
  });

  it('commits an exact date only on Set, never mid-typing', () => {
    mockUseTaskDetail.mockReturnValue(queryFor(managerTask()));
    render(<TaskDetailBody taskKey="T-7" onNavigateTask={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /^Scheduled:/ }));
    fireEvent.change(screen.getByLabelText('Pick a date'), { target: { value: '2026-10-02' } });
    expect(mockMutate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Apply schedule' }));
    expect(mockMutate).toHaveBeenCalledWith({ scheduledOn: '2026-10-02', later: false }, expect.anything());
  });

  it('shows Later as the schedule value and unparks from the picker', () => {
    mockUseTaskDetail.mockReturnValue(queryFor(managerTask({ later: true, scheduledOn: null } as Partial<TaskDetailResponse>)));
    render(<TaskDetailBody taskKey="T-7" onNavigateTask={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Scheduled: Later' }));
    const later = screen.getByRole('menuitemcheckbox', { name: /later/i });
    expect(later.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(later);
    expect(mockMutate).toHaveBeenCalledWith({ later: false }, expect.anything());
  });

  it('reassigns from the owner picker', () => {
    mockUseTaskDetail.mockReturnValue(queryFor(managerTask()));
    render(<TaskDetailBody taskKey="T-7" onNavigateTask={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Owner: You' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Dev One' }));
    expect(mockMutate).toHaveBeenCalledWith({ ownerType: 'developer', ownerId: 'dev-1' }, expect.anything());
  });

  it('confirms before deleting', () => {
    mockUseTaskDetail.mockReturnValue(queryFor(managerTask()));
    render(<TaskDetailBody taskKey="T-7" onNavigateTask={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /delete task/i }));
    expect(mockDelete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete task' }));
    expect(mockDelete).toHaveBeenCalled();
  });

  it('commits title edits on Enter and reverts on Escape', () => {
    mockUseTaskDetail.mockReturnValue(queryFor(managerTask()));
    render(<TaskDetailBody taskKey="T-7" onNavigateTask={() => {}} />);
    const title = screen.getByLabelText('Task title');
    title.focus();
    fireEvent.change(title, { target: { value: 'Discarded title' } });
    fireEvent.keyDown(title, { key: 'Escape' });
    expect(mockMutate).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue('Manager task')).toBeTruthy();

    title.focus();
    fireEvent.change(title, { target: { value: 'Renamed task' } });
    fireEvent.keyDown(title, { key: 'Enter' });
    expect(mockMutate).toHaveBeenCalledWith({ title: 'Renamed task' }, expect.anything());
  });

  it('runs single-key shortcuts outside of text fields only', () => {
    mockUseTaskDetail.mockReturnValue(queryFor(managerTask()));
    render(<TaskDetailBody taskKey="T-7" onNavigateTask={() => {}} />);
    const title = screen.getByLabelText('Task title');
    title.focus();
    fireEvent.keyDown(title, { key: 'e' });
    expect(mockMutate).not.toHaveBeenCalled();
    title.blur();
    fireEvent.keyDown(document.body, { key: 'e' });
    expect(mockMutate).toHaveBeenCalledWith({ status: 'done' }, expect.anything());
    fireEvent.keyDown(document.body, { key: 's' });
    expect(screen.getByRole('dialog', { name: 'Schedule' })).toBeTruthy();
  });

  it('renders the two-column page layout with a back affordance', () => {
    mockUseTaskDetail.mockReturnValue(queryFor(managerTask()));
    const onBack = vi.fn();
    render(<TaskDetailBody taskKey="T-7" fullPage onBack={onBack} onNavigateTask={() => {}} />);
    expect(screen.getByRole('complementary', { name: 'Task details' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Open full page' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(onBack).toHaveBeenCalled();
  });

  it('shows the parent crumb and navigates to it', () => {
    const onNavigate = vi.fn();
    mockUseTaskDetail.mockReturnValue(queryFor(managerTask({
      parent: { id: 2, taskKey: 'T-2', title: 'Parent meeting', kind: 'meeting', status: 'open', ownerType: null, ownerId: null },
    })));
    render(<TaskDetailBody taskKey="T-7" onNavigateTask={onNavigate} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open parent task T-2' }));
    expect(onNavigate).toHaveBeenCalledWith('T-2');
  });
});

describe('TaskDrawer modal focus (D4/D5)', () => {
  it('traps Tab inside the drawer and restores focus to the opener on close', () => {
    mockUseTaskDetail.mockReturnValue(queryFor(managerTask()));
    const onClose = vi.fn();
    // jsdom has no layout: offsetParent is always null, so pretend every
    // element is laid out for the focusables scan.
    const layout = vi.spyOn(HTMLElement.prototype, 'offsetParent', 'get').mockReturnValue(document.body);
    const { rerender } = render(
      <div>
        <button data-testid="opener">Open</button>
      </div>,
    );
    const opener = screen.getByTestId('opener');
    opener.focus();

    rerender(
      <div>
        <button data-testid="opener">Open</button>
        <TaskDrawer taskKey="T-7" onClose={onClose} />
      </div>,
    );
    const dialog = screen.getByRole('dialog', { name: /task t-7/i });

    // Tab with focus outside cycles into the panel…
    fireEvent.keyDown(opener, { key: 'Tab' });
    expect(dialog.contains(document.activeElement)).toBe(true);
    // …and Shift+Tab at the first focusable wraps to the last.
    const inside = document.activeElement as HTMLElement;
    fireEvent.keyDown(inside, { key: 'Tab', shiftKey: true });
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).not.toBe(inside);

    // Escape closes; unmounting restores focus to the originating element.
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
    rerender(
      <div>
        <button data-testid="opener">Open</button>
      </div>,
    );
    expect(document.activeElement).toBe(opener);
    layout.mockRestore();
  });
});
