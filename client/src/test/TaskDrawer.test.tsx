import { clearTaskUpdateDraftsForScope, readTaskUpdateDraft, taskUpdateDraftPrefix } from '@/lib/task-update-drafts';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { dueAtForDate } from '@/types';
import type { TaskDetailResponse } from '@/types';

const mockUseTaskDetail = vi.fn();
const mockMutate = vi.fn();
const mockDelete = vi.fn();
const mockUser = vi.fn();
const mockToast = vi.fn();

const mockFeatures = vi.hoisted(() => vi.fn((): Record<string, unknown> | undefined => undefined));
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: mockUser(), features: mockFeatures() }),
  useAuthScopeKey: () => 'ws:manager:manager',
}));

vi.mock('@/context/ToastContext', () => ({
  useToast: () => ({ addToast: (...args: unknown[]) => mockToast(...args) }),
}));

vi.mock('@/hooks/useTaskDetail', () => ({
  useTaskDetail: (...args: unknown[]) => mockUseTaskDetail(...args),
  useUpdateTaskDetail: () => ({ mutate: mockMutate, isPending: false }),
  useDeleteTaskDetail: () => ({ mutate: mockDelete, isPending: false }),
  useAddTaskDetailLink: () => ({ mutate: vi.fn(), isPending: false }),
  useRemoveTaskDetailLink: () => ({ mutate: vi.fn(), isPending: false }),
}));

const mockCaptureCreate = vi.fn();
vi.mock('@/hooks/useCapture', () => ({
  useCaptureTask: () => ({ create: mockCaptureCreate, isPending: false }),
}));

vi.mock('@/hooks/useTaskLabels', () => ({
  useTaskLabels: () => ({
    data: { labels: [{ name: 'category:follow_up', color: 'teal', system: true, createdAt: '' }] },
  }),
}));

vi.mock('@/hooks/useContacts', () => ({
  useContacts: () => ({ data: [] }),
}));

vi.mock('@/hooks/useGlobalSearch', () => ({
  GLOBAL_SEARCH_MIN_LENGTH: 2,
  useGlobalSearch: () => ({ data: undefined }),
}));

vi.mock('@/hooks/useDevelopers', () => ({
  useDevelopers: () => ({ data: [{ accountId: 'dev-1', displayName: 'Dev One' }] }),
}));

vi.mock('@/components/tasks/TaskTimeline', () => ({
  TaskTimeline: () => <div data-testid="timeline" />,
  TaskTimelineDisclosure: () => <div data-testid="timeline" />,
}));

vi.mock('@/hooks/useTasks', () => ({
  useAddTaskEvent: () => ({ mutateAsync: vi.fn().mockResolvedValue({}), isPending: false }),
  useAddMyDayTaskEvent: () => ({ mutateAsync: vi.fn().mockResolvedValue({}), isPending: false }),
}));

vi.mock('@/components/JiraIssueLink', () => ({
  JiraIssueLink: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

import { TaskDetailBody, TaskDrawer } from '@/components/tasks/TaskDrawer';
import { TestWrapper } from './wrapper';
import { getLocalIsoDate, shiftLocalIsoDate } from '@/lib/utils';

function managerTask(overrides: Partial<TaskDetailResponse> = {}): TaskDetailResponse {
  return {
    id: 1,
    taskKey: 'T-7',
    title: 'Manager task',
    details: null,
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
  clearTaskUpdateDraftsForScope('ws:manager:manager');
  mockMutate.mockReset();
  mockDelete.mockReset();
  mockToast.mockReset();
  mockCaptureCreate.mockReset();
  mockCaptureCreate.mockResolvedValue({ task: { taskKey: 'T-20' }, warnings: [] });
  mockUser.mockReturnValue({ accountId: 'manager-a', role: 'manager', developerAccountId: undefined });
});

describe('TaskDrawer body (P3-D2)', () => {
  it('j/k step through the ordered list keys, dead inside inputs (docs/51 F19)', () => {
    mockUseTaskDetail.mockReturnValue(queryFor(managerTask()));
    const onStepTask = vi.fn();
    render(<TaskDetailBody taskKey="T-7" onNavigateTask={() => {}} orderedKeys={['T-4', 'T-7', 'T-9']} onStepTask={onStepTask} />);
    fireEvent.keyDown(document.body, { key: 'j' });
    expect(onStepTask).toHaveBeenCalledWith('T-9');
    fireEvent.keyDown(document.body, { key: 'k' });
    expect(onStepTask).toHaveBeenCalledWith('T-4');
    // Dead inside editable fields.
    const title = screen.getByDisplayValue('Manager task');
    title.focus();
    fireEvent.keyDown(title, { key: 'j' });
    expect(onStepTask).toHaveBeenCalledTimes(2);
  });

  it('shows who a task waits on, since when and the check day, and edits it with the w menu (UX-07)', () => {
    const since = new Date(Date.now() - 8 * 86_400_000).toISOString();
    const check = new Date(`${shiftLocalIsoDate(getLocalIsoDate(), 2)}T09:00:00`);
    mockUseTaskDetail.mockReturnValue(queryFor(managerTask({
      waitingOn: { type: 'developer', ref: 'dev-1', label: 'Dev One', since },
      followUpAt: check.toISOString(),
    } as Partial<TaskDetailResponse>)));
    render(<TaskDetailBody taskKey="T-7" onNavigateTask={() => {}} />);

    const button = screen.getByRole('button', { name: 'Waiting on: Dev One' });
    expect(button.textContent).toContain('since 8d');
    expect(button.textContent).toContain(`check ${check.toLocaleDateString('en-US', { weekday: 'short' })}`);
    expect(screen.queryByText('Tracked by')).toBeNull();

    // `w` opens the same menu as a click.
    fireEvent.keyDown(document.body, { key: 'w' });
    const field = screen.getByRole('textbox', { name: 'Waiting on' });
    fireEvent.change(field, { target: { value: 'Legal' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(mockMutate).toHaveBeenCalledWith({ waitingOn: { type: 'text', label: 'Legal' } }, expect.anything());
  });

  it('keeps Tracked by when someone else owns the task, and offers to start waiting (UX-07)', () => {
    mockUseTaskDetail.mockReturnValue(queryFor(managerTask({ ownerType: 'developer', ownerId: 'dev-1' })));
    render(<TaskDetailBody taskKey="T-7" onNavigateTask={() => {}} />);
    expect(screen.getByText('Tracked by')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Waiting on: no one' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Dev One/ }));
    expect(mockMutate).toHaveBeenCalledWith({ waitingOn: { type: 'developer', ref: 'dev-1', label: 'Dev One' } }, expect.anything());
  });

  it('a 1:1 meeting task links to that person\'s 1:1 workspace when 1:1s are on (UX-35)', () => {
    mockUseTaskDetail.mockReturnValue(queryFor(managerTask({ kind: 'meeting', title: '1:1 with Dev', ownerType: 'manager' })));
    mockFeatures.mockReturnValue({ oneOnOne: true });
    try {
      // 1:1s on also turns on the drawer's agenda reads, which need a query client.
      const { unmount } = render(<TestWrapper><TaskDetailBody taskKey="T-7" onNavigateTask={() => {}} /></TestWrapper>);
      expect(screen.getByRole('link', { name: 'Open the 1:1 workspace with Dev One' })).toHaveAttribute('href', '/team?dev=dev-1&panel=one-on-one');
      unmount();
    } finally {
      mockFeatures.mockReturnValue(undefined);
    }
    render(<TaskDetailBody taskKey="T-7" onNavigateTask={() => {}} />);
    expect(screen.queryByRole('link', { name: /1:1 workspace/ })).toBeNull();
  });

  it('j/k are inert without the list order', () => {
    mockUseTaskDetail.mockReturnValue(queryFor(managerTask()));
    const onStepTask = vi.fn();
    render(<TaskDetailBody taskKey="T-7" onNavigateTask={() => {}} onStepTask={onStepTask} />);
    fireEvent.keyDown(document.body, { key: 'j' });
    expect(onStepTask).not.toHaveBeenCalled();
  });

  it('renders all sections for a manager task', () => {
    mockUseTaskDetail.mockReturnValue(queryFor(managerTask()));
    const { container } = render(<TaskDetailBody taskKey="T-7" onNavigateTask={() => {}} />);
    expect(screen.getByDisplayValue('Manager task')).toBeTruthy();
    const terms = within(container.querySelector('dl')!).getAllByRole('term').map((term) => term.textContent);
    // UX-07: Tracked by is hidden when it is the owner; Waiting on is always there for a manager.
    expect(terms).toEqual(['Owner', 'Waiting on', 'Scheduled', 'Follow-up', 'Due', 'Priority', 'Labels']);
    expect(screen.getByRole('heading', { name: 'Links' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Activity' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Owner: You' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Task status: Active' })).toBeTruthy();
    expect(screen.getByText('follow up')).toBeTruthy(); // prefix stripped
    expect(screen.getByTestId('timeline')).toBeTruthy();
    expect(screen.getByRole('textbox', { name: /Add an update to/ })).toBeTruthy();
  });

  it.each(['45', '-1'])('keeps only a valid exact-event target when normalizing an alias (%s)', (eventId) => {
    window.history.replaceState(null, '', `/t/T-6?event=${eventId}`);
    mockUseTaskDetail.mockReturnValue(queryFor(managerTask()));
    render(<TaskDetailBody taskKey="T-6" fullPage onBack={vi.fn()} onNavigateTask={vi.fn()} />);
    expect(window.location.pathname).toBe('/t/T-7');
    expect(window.location.search).toBe(eventId === '45' ? '?event=45' : '');
    window.history.replaceState(null, '', '/');
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
    expect(screen.getByRole('textbox', { name: /Add an update to/ })).toBeTruthy();
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

  describe('action items go through capture (docs/57 P3-05)', () => {
    const meeting = () => managerTask({ kind: 'meeting' });
    const type = (value: string) => {
      const input = screen.getByLabelText('New action item') as HTMLInputElement;
      fireEvent.change(input, { target: { value } });
      return input;
    };

    it('posts the text with this task as the parent, and clears the input', async () => {
      mockUseTaskDetail.mockReturnValue(queryFor(meeting()));
      render(<TaskDetailBody taskKey="T-7" onNavigateTask={() => {}} />);
      const input = type('Send summary @dev-1 !fri');
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Add' })); });
      expect(mockCaptureCreate).toHaveBeenCalledWith({ text: 'Send summary @dev-1 !fri', defaults: { parentKey: 'T-7' } });
      expect(input.value).toBe('');
    });

    it('suggests people for @ and inserts on Tab, without adding the item', () => {
      mockUseTaskDetail.mockReturnValue(queryFor(meeting()));
      render(<TaskDetailBody taskKey="T-7" onNavigateTask={() => {}} />);
      const input = type('Send summary @de');
      expect(screen.getByRole('listbox', { name: 'Person suggestions' })).toBeTruthy();
      fireEvent.keyDown(input, { key: 'Tab' });
      // UX-05: the input shows the name; the capture still gets the id.
      expect(input.value).toBe('Send summary @Dev ');
      expect(mockCaptureCreate).not.toHaveBeenCalled();
    });

    it('sends the picked person as an id while the input shows the name (UX-05)', async () => {
      mockUseTaskDetail.mockReturnValue(queryFor(meeting()));
      render(<TaskDetailBody taskKey="T-7" onNavigateTask={() => {}} />);
      const input = type('Send summary @de');
      fireEvent.keyDown(input, { key: 'Tab' });
      await act(async () => { fireEvent.submit(input.closest('form')!); });
      expect(mockCaptureCreate).toHaveBeenCalledWith({ text: 'Send summary @dev-1', defaults: { parentKey: 'T-7' } });
    });

    it('Enter submits the form', async () => {
      mockUseTaskDetail.mockReturnValue(queryFor(meeting()));
      render(<TaskDetailBody taskKey="T-7" onNavigateTask={() => {}} />);
      const input = type('Book the room');
      await act(async () => { fireEvent.submit(input.closest('form')!); });
      expect(mockCaptureCreate).toHaveBeenCalledWith({ text: 'Book the room', defaults: { parentKey: 'T-7' } });
    });

    it('keeps the text and toasts the server\'s reason when the capture is rejected', async () => {
      const { CaptureRejectedError } = await vi.importActual<typeof import('@/hooks/useCapture')>('@/hooks/useCapture');
      mockCaptureCreate.mockRejectedValueOnce(new CaptureRejectedError([{ severity: 'error', code: 'unknown-person', message: 'Nobody matches @ghost' }]));
      mockUseTaskDetail.mockReturnValue(queryFor(meeting()));
      render(<TaskDetailBody taskKey="T-7" onNavigateTask={() => {}} />);
      const input = type('Call @ghost');
      await act(async () => { fireEvent.submit(input.closest('form')!); });
      expect(mockToast).toHaveBeenCalledWith('Nobody matches @ghost', 'error');
      expect(input.value).toBe('Call @ghost');
    });

    it('toasts warnings from a successful add', async () => {
      mockCaptureCreate.mockResolvedValueOnce({ task: { taskKey: 'T-21' }, warnings: [{ severity: 'warning', code: 'unparsed-date', message: '"!soon" isn\u2019t a date' }] });
      mockUseTaskDetail.mockReturnValue(queryFor(meeting()));
      render(<TaskDetailBody taskKey="T-7" onNavigateTask={() => {}} />);
      const input = type('Follow up !soon');
      await act(async () => { fireEvent.submit(input.closest('form')!); });
      expect(mockToast).toHaveBeenCalledWith(expect.stringContaining('isn\u2019t a date'), 'warning');
      expect(input.value).toBe('');
    });

    it('ignores blank input', async () => {
      mockUseTaskDetail.mockReturnValue(queryFor(meeting()));
      render(<TaskDetailBody taskKey="T-7" onNavigateTask={() => {}} />);
      const input = type('   ');
      await act(async () => { fireEvent.submit(input.closest('form')!); });
      expect(mockCaptureCreate).not.toHaveBeenCalled();
    });
  });

  it('renders a read-only tombstone for deleted tasks', () => {
    mockUseTaskDetail.mockReturnValue(queryFor(managerTask({ deletedAt: '2026-09-23T18:00:00Z' })));
    render(<TaskDetailBody taskKey="T-7" onNavigateTask={() => {}} />);
    expect(screen.getByText(/was deleted/)).toBeTruthy();
    expect(screen.queryByRole('textbox', { name: /Add an update to/ })).toBeNull();
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
    expect(screen.queryByRole('textbox', { name: /Add an update to/ })).toBeNull();
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

  describe('Due (docs/57 P3-04)', () => {
    const dueButton = () => screen.getByRole('button', { name: /^Due:/ });
    const endOfDay = (date: string) => dueAtForDate(date);

    it('is an editable field separate from Scheduled, empty by default', () => {
      mockUseTaskDetail.mockReturnValue(queryFor(managerTask()));
      render(<TaskDetailBody taskKey="T-7" onNavigateTask={() => {}} />);
      expect(dueButton()).toHaveAccessibleName('Due: Not set');
      expect(dueButton()).not.toBeDisabled();
      expect(screen.getByRole('button', { name: /^Scheduled:/ })).toBeInTheDocument();
    });

    it('sets the deadline from a preset without touching the plan date', () => {
      mockUseTaskDetail.mockReturnValue(queryFor(managerTask()));
      render(<TaskDetailBody taskKey="T-7" onNavigateTask={() => {}} />);
      fireEvent.click(dueButton());
      fireEvent.click(screen.getByRole('menuitem', { name: /tomorrow/i }));
      expect(mockMutate).toHaveBeenLastCalledWith({ dueAt: endOfDay(shiftLocalIsoDate(getLocalIsoDate(), 1)) }, expect.anything());
      expect(mockMutate.mock.calls[0]![0]).not.toHaveProperty('scheduledOn');
    });

    it('commits an exact date only on Set, as the end of that local day', () => {
      mockUseTaskDetail.mockReturnValue(queryFor(managerTask()));
      render(<TaskDetailBody taskKey="T-7" onNavigateTask={() => {}} />);
      fireEvent.click(dueButton());
      fireEvent.change(screen.getByLabelText('Pick a date'), { target: { value: '2026-10-09' } });
      expect(mockMutate).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button', { name: 'Apply due' }));
      expect(mockMutate).toHaveBeenCalledWith({ dueAt: endOfDay('2026-10-09') }, expect.anything());
      // The stored moment reads back as the same local day.
      expect(getLocalIsoDate(new Date(endOfDay('2026-10-09')))).toBe('2026-10-09');
    });

    it('shows the stored day and clears it', () => {
      mockUseTaskDetail.mockReturnValue(queryFor(managerTask({ dueAt: endOfDay(shiftLocalIsoDate(getLocalIsoDate(), 3)) })));
      render(<TaskDetailBody taskKey="T-7" onNavigateTask={() => {}} />);
      expect(dueButton().getAttribute('aria-label')).not.toBe('Due: Not set');
      fireEvent.click(dueButton());
      fireEvent.click(screen.getByRole('menuitem', { name: /clear deadline/i }));
      expect(mockMutate).toHaveBeenLastCalledWith({ dueAt: null }, expect.anything());
    });

    it('does nothing when the same day is picked again', () => {
      const day = shiftLocalIsoDate(getLocalIsoDate(), 2);
      mockUseTaskDetail.mockReturnValue(queryFor(managerTask({ dueAt: endOfDay(day) })));
      render(<TaskDetailBody taskKey="T-7" onNavigateTask={() => {}} />);
      fireEvent.click(dueButton());
      fireEvent.change(screen.getByLabelText('Pick a date'), { target: { value: shiftLocalIsoDate(day, 1) } });
      fireEvent.change(screen.getByLabelText('Pick a date'), { target: { value: day } });
      expect(screen.getByRole('button', { name: 'Apply due' })).toBeDisabled();
      expect(mockMutate).not.toHaveBeenCalled();
    });

    it('a missed deadline on open work reads as overdue, in red', () => {
      mockUseTaskDetail.mockReturnValue(queryFor(managerTask({ dueAt: endOfDay(shiftLocalIsoDate(getLocalIsoDate(), -2)) })));
      render(<TaskDetailBody taskKey="T-7" onNavigateTask={() => {}} />);
      expect(dueButton()).toHaveTextContent('2d overdue');
      expect(within(dueButton()).getByText('2d overdue')).toHaveStyle({ color: 'var(--danger)' });
    });

    it('a developer sees a deadline read-only, and no Due row without one', () => {
      mockUser.mockReturnValue({ accountId: 'u-dev', role: 'developer', developerAccountId: 'dev-1' });
      const withDue = { ...managerTask({ dueAt: endOfDay(shiftLocalIsoDate(getLocalIsoDate(), 4)) }), ownerType: 'developer' as const, ownerId: 'dev-1' } as TaskDetailResponse;
      mockUseTaskDetail.mockReturnValue(queryFor(withDue));
      const { container, unmount } = render(<TaskDetailBody taskKey="T-7" onNavigateTask={() => {}} />);
      const terms = () => within(container.querySelector('dl')!).getAllByRole('term').map((term) => term.textContent);
      // Shown, but as plain text: nothing to press.
      expect(terms()).toContain('Due');
      expect(screen.queryByRole('button', { name: /^Due:/ })).toBeNull();
      unmount();

      mockUseTaskDetail.mockReturnValue(queryFor({ ...withDue, dueAt: null } as TaskDetailResponse));
      const second = render(<TaskDetailBody taskKey="T-7" onNavigateTask={() => {}} />);
      expect(within(second.container.querySelector('dl')!).getAllByRole('term').map((term) => term.textContent)).not.toContain('Due');
    });
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

describe('TaskDrawer details (shared description)', () => {
  it('adds details from the empty state and saves with Cmd/Ctrl+Enter', () => {
    mockUseTaskDetail.mockReturnValue(queryFor(managerTask()));
    render(<TaskDetailBody taskKey="T-7" onNavigateTask={() => {}} />);
    expect(screen.getByRole('heading', { name: 'Details' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Add details/ }));
    const editor = screen.getByLabelText('Task details');
    fireEvent.change(editor, { target: { value: '  Why: finance close.\nDone: CSV opens.  ' } });
    fireEvent.keyDown(editor, { key: 'Enter', metaKey: true });
    expect(mockMutate).toHaveBeenCalledWith({ details: 'Why: finance close.\nDone: CSV opens.' }, expect.anything());
    expect(screen.queryByLabelText('Task details')).toBeNull();
  });

  it('discards on Escape without closing anything, and commits on blur', () => {
    mockUseTaskDetail.mockReturnValue(queryFor(managerTask({ details: 'Original context' })));
    render(<TaskDetailBody taskKey="T-7" onNavigateTask={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /Edit/ }));
    let editor = screen.getByLabelText('Task details');
    fireEvent.change(editor, { target: { value: 'Throwaway' } });
    fireEvent.keyDown(editor, { key: 'Escape' });
    expect(mockMutate).not.toHaveBeenCalled();
    expect(screen.getByText('Original context')).toBeTruthy();

    fireEvent.click(screen.getByText('Original context'));
    editor = screen.getByLabelText('Task details');
    fireEvent.change(editor, { target: { value: '' } });
    fireEvent.blur(editor);
    // Clearing the text clears the field.
    expect(mockMutate).toHaveBeenCalledWith({ details: null }, expect.anything());
  });

  it('folds long details, links URLs, and names who it is shared with', () => {
    const long = `${'Context line\n'.repeat(14)}See https://example.com/spec for the spec.`;
    mockUseTaskDetail.mockReturnValue(queryFor(managerTask({ details: long, ownerType: 'developer', ownerId: 'dev-1' })));
    render(<TaskDetailBody taskKey="T-7" onNavigateTask={() => {}} />);
    expect(screen.getByText('Shared with Dev One')).toBeTruthy();
    const more = screen.getByRole('button', { name: 'Show more' });
    fireEvent.click(more);
    expect(screen.getByRole('button', { name: 'Show less' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'https://example.com/spec' }).getAttribute('href')).toBe('https://example.com/spec');
  });

  it('opens the editor with the D shortcut', () => {
    mockUseTaskDetail.mockReturnValue(queryFor(managerTask()));
    render(<TaskDetailBody taskKey="T-7" onNavigateTask={() => {}} />);
    fireEvent.keyDown(document.body, { key: 'd' });
    expect(screen.getByLabelText('Task details')).toBeTruthy();
  });

  it('lets the owning developer edit details and status, with nothing manager-private', () => {
    mockUser.mockReturnValue({ accountId: 'u-dev', role: 'developer', developerAccountId: 'dev-1' });
    const task = { ...managerTask({ details: 'Lead wrote this' }), ownerType: 'developer' as const, ownerId: 'dev-1' } as TaskDetailResponse;
    for (const field of ['trackedByManagerId', 'labels', 'nextAction', 'followUpAt', 'later']) delete (task as Record<string, unknown>)[field];
    mockUseTaskDetail.mockReturnValue(queryFor(task));
    render(<TaskDetailBody taskKey="T-7" onNavigateTask={() => {}} />);
    expect(screen.getByText('Shared with your lead')).toBeTruthy();
    // Manager-created: the title is locked, status and details are not.
    expect(screen.queryByLabelText('Task title')).toBeNull();
    expect(screen.getByRole('button', { name: 'Task status: Active' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Edit/ }));
    const editor = screen.getByLabelText('Task details');
    fireEvent.change(editor, { target: { value: 'Lead wrote this. Dev added repro steps.' } });
    fireEvent.keyDown(editor, { key: 'Enter', ctrlKey: true });
    expect(mockMutate).toHaveBeenCalledWith({ details: 'Lead wrote this. Dev added repro steps.' }, expect.anything());
    expect(screen.queryByText('Tracked by')).toBeNull();
    expect(screen.queryByText('Follow-up')).toBeNull();
    expect(screen.queryByText('Labels')).toBeNull();
  });

  it('is read-only on deleted tasks and hidden when empty', () => {
    mockUseTaskDetail.mockReturnValue(queryFor(managerTask({ deletedAt: '2026-09-25T10:00:00Z', details: 'Kept for the record' })));
    const { unmount } = render(<TaskDetailBody taskKey="T-7" onNavigateTask={() => {}} />);
    expect(screen.getByText('Kept for the record')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Edit/ })).toBeNull();
    unmount();
    mockUseTaskDetail.mockReturnValue(queryFor(managerTask({ deletedAt: '2026-09-25T10:00:00Z' })));
    render(<TaskDetailBody taskKey="T-7" onNavigateTask={() => {}} />);
    expect(screen.queryByRole('heading', { name: 'Details' })).toBeNull();
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


describe('R3 real drawer composer lifecycle', () => {
  beforeEach(() => mockUseTaskDetail.mockReturnValue(queryFor(managerTask())));
  it('restores a private draft after close and task switching', () => {
    const view = render(<TaskDrawer taskKey="T-7" open onClose={vi.fn()} />);
    const box = screen.getByRole('textbox', { name: 'Add an update to T-7' });
    fireEvent.change(box, { target: { value: 'Private draft' } });
    fireEvent.click(screen.getByRole('button', { name: 'Private' }));
    view.rerender(<TaskDrawer taskKey="T-7" open={false} onClose={vi.fn()} />);
    mockUseTaskDetail.mockReturnValue(queryFor(managerTask({ taskKey: 'T-8' })));
    view.rerender(<TaskDrawer taskKey="T-8" open onClose={vi.fn()} />);
    expect(screen.getByRole('textbox', { name: 'Add an update to T-8' })).toHaveValue('');
    mockUseTaskDetail.mockReturnValue(queryFor(managerTask()));
    view.rerender(<TaskDrawer taskKey="T-7" open onClose={vi.fn()} />);
    expect(screen.getByRole('textbox', { name: 'Add an update to T-7' })).toHaveValue('Private draft');
    expect(screen.getByRole('button', { name: 'Private' })).toHaveAttribute('aria-pressed', 'true');
  });

  it.each([403, 404])('clears a draft only after confirmed access loss (%s)', (status) => {
    const view = render(<TaskDrawer taskKey="T-7" open onClose={vi.fn()} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Add an update to T-7' }), { target: { value: 'Draft' } });
    const key = `${taskUpdateDraftPrefix('ws:manager:manager', 'manager', 'task_drawer')}T-7`;
    mockUseTaskDetail.mockReturnValue({ data: undefined, isLoading: false, isError: true, error: Object.assign(new Error('Denied'), { status }) });
    view.rerender(<TaskDrawer taskKey="T-7" open onClose={vi.fn()} />);
    expect(readTaskUpdateDraft(key).body).toBe('');
  });
  it('preserves drafts on a transport failure and clears them for a deleted task', () => {
    const view = render(<TaskDrawer taskKey="T-7" open onClose={vi.fn()} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Add an update to T-7' }), { target: { value: 'Keep draft' } });
    const key = `${taskUpdateDraftPrefix('ws:manager:manager', 'manager', 'task_drawer')}T-7`;
    mockUseTaskDetail.mockReturnValue({ data: undefined, isLoading: false, isError: true, error: new Error('Offline') });
    view.rerender(<TaskDrawer taskKey="T-7" open onClose={vi.fn()} />);
    expect(readTaskUpdateDraft(key).body).toBe('Keep draft');
    mockUseTaskDetail.mockReturnValue(queryFor(managerTask({ deletedAt: '2026-10-02T10:00:00Z' })));
    view.rerender(<TaskDrawer taskKey="T-7" open onClose={vi.fn()} />);
    expect(readTaskUpdateDraft(key).body).toBe('');
    expect(screen.queryByRole('textbox', { name: 'Add an update to T-7' })).not.toBeInTheDocument();
  });

});
