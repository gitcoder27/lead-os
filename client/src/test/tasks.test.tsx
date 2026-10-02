import { clearTaskUpdateDraftsForScope } from '@/lib/task-update-drafts';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { TaskEvent } from '@/types';
import { TaskKeyChip } from '@/components/tasks/TaskKeyChip';
import { TaskPicker, parseTaskKeys, taskKeysForSubmit, tasksFromItems } from '@/components/tasks/TaskPicker';
import { TaskTimeline, TaskTimelineDisclosure } from '@/components/tasks/TaskTimeline';
import { TaskUpdateComposer } from '@/components/tasks/TaskUpdateComposer';
import type { TrackerWorkItem } from '@/types';

const mockAddTaskEventMutate = vi.fn();
const mockAddMyDayTaskEventMutate = vi.fn();
const mockUpdateVisibilityMutate = vi.fn();
const mockRedactMutate = vi.fn();
const mockAddToast = vi.fn();

let mockManagerEvents: { pages: Array<{ events: TaskEvent[]; nextCursor: string | null }> } | undefined;
let mockMyDayEvents: { pages: Array<{ events: TaskEvent[]; nextCursor: string | null }> } | undefined;

vi.mock('@/hooks/useTasks', () => ({
  useTaskResolution: () => ({ data: undefined, isError: false, isLoading: false }),
  useTaskEvents: () => ({
    data: mockManagerEvents,
    isLoading: false,
    isError: false,
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
    refetch: vi.fn(),
  }),
  useMyDayTaskEvents: () => ({
    data: mockMyDayEvents,
    isLoading: false,
    isError: false,
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
    refetch: vi.fn(),
  }),
  useAddTaskEvent: () => ({ mutateAsync: mockAddTaskEventMutate, isPending: false }),
  useAddMyDayTaskEvent: () => ({ mutateAsync: mockAddMyDayTaskEventMutate, isPending: false }),
  useUpdateTaskEventVisibility: () => ({ mutate: mockUpdateVisibilityMutate, isPending: false }),
  useRedactTaskEvent: () => ({ mutate: mockRedactMutate, isPending: false }),
}));

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { accountId: 'mgr-1', role: 'manager', displayName: 'Manager One' } }),
  useAuthScopeKey: () => 'mgr-1',
}));

vi.mock('@/context/ToastContext', () => ({
  useToast: () => ({ addToast: mockAddToast }),
}));

function makeEvent(overrides: Partial<TaskEvent>): TaskEvent {
  return {
    id: 1,
    taskKey: 'T-5',
    type: 'update',
    body: 'Progress update',
    visibility: 'shared',
    author: { type: 'manager', id: 'mgr-1', displayName: 'Manager One' },
    occurredAt: new Date().toISOString(),
    approximateTime: false,
    ...overrides,
  };
}

function makeItem(overrides: Partial<TrackerWorkItem>): TrackerWorkItem {
  return {
    id: 1,
    dayId: 10,
    originDate: '2026-03-10',
    taskKey: null,
    lifecycle: 'tracker_only',
    itemType: 'custom',
    title: 'Task',
    state: 'planned',
    position: 0,
    createdAt: '2026-03-10T09:00:00.000Z',
    updatedAt: '2026-03-10T09:00:00.000Z',
    ...overrides,
  };
}

function Wrapper({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

describe('TaskKeyChip', () => {
  it('renders the key and copies the /t/ link on click', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    render(<TaskKeyChip taskKey="T-5" />, { wrapper: Wrapper });

    fireEvent.click(screen.getByRole('button', { name: /task t-5/i }));
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/t/T-5`);
    expect(await screen.findByText('T-5')).toBeInTheDocument();
  });
});

describe('parseTaskKeys / taskKeysForSubmit', () => {
  it('extracts canonical keys from free text', () => {
    expect(parseTaskKeys('pinged about T-3 and t-12, plus T-3 again')).toEqual(['T-3', 'T-12']);
    expect(parseTaskKeys('no keys here')).toEqual([]);
    expect(parseTaskKeys('T-1234567890 too long')).toEqual([]);
  });

  it('merges selected keys with known typed tokens', () => {
    const tasks = [
      { taskKey: 'T-3', title: 'A' },
      { taskKey: 'T-12', title: 'B' },
    ];
    expect(taskKeysForSubmit(['T-3'], 'checking T-12 and T-77', tasks).sort()).toEqual(['T-12', 'T-3']);
    expect(taskKeysForSubmit([], 'no keys', tasks)).toEqual([]);
  });

  it('flattens item groups into unique picker candidates', () => {
    const tasks = tasksFromItems(
      [makeItem({ taskKey: 'T-1', title: 'One' })],
      [makeItem({ id: 2, taskKey: 'T-2', title: 'Two' }), makeItem({ id: 3, taskKey: 'T-1', title: 'One dup' }), makeItem({ id: 4 })],
    );
    expect(tasks).toEqual([
      { taskKey: 'T-1', title: 'One' },
      { taskKey: 'T-2', title: 'Two' },
    ]);
  });
});

describe('TaskPicker', () => {
  it('toggles selection and marks typed tokens as active', () => {
    const onChange = vi.fn();
    render(
      <TaskPicker
        tasks={[{ taskKey: 'T-3', title: 'A' }, { taskKey: 'T-12', title: 'B' }]}
        text="following up on T-12 and T-99"
        selected={['T-3']}
        onChange={onChange}
      />,
      { wrapper: Wrapper },
    );

    expect(screen.getByRole('button', { name: 'T-3' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'T-12' })).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(screen.getByRole('button', { name: 'T-3' }));
    expect(onChange).toHaveBeenCalledWith([]);

    // Unknown typed token renders as a dashed hint, not a toggle button.
    expect(screen.queryByRole('button', { name: 'T-99' })).toBeNull();
    expect(screen.getByText('T-99')).toBeInTheDocument();
  });
});

describe('TaskUpdateComposer', () => {
  beforeEach(() => {
    clearTaskUpdateDraftsForScope('mgr-1');
    mockAddTaskEventMutate.mockReset();
    mockAddMyDayTaskEventMutate.mockReset();
  });

  it('keeps drafts and delayed success bound to the submitted task', async () => {
    let success!: () => void;
    mockAddTaskEventMutate.mockImplementation(() => new Promise<void>((resolve) => { success = resolve; }));
    const { rerender } = render(<TaskUpdateComposer taskKey="T-5" mode="manager" via="standup" />, { wrapper: Wrapper });
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'First task draft' } });
    fireEvent.click(screen.getByRole('button', { name: /private/i }));
    fireEvent.click(screen.getByRole('button', { name: /post/i }));
    rerender(<TaskUpdateComposer taskKey="T-6" mode="manager" via="standup" />);
    expect(screen.getByRole('textbox')).toHaveValue('');
    expect(screen.getByRole('button', { name: /private/i })).toHaveAttribute('aria-pressed', 'false');
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Second task draft' } });
    await act(async () => success());
    expect(screen.getByRole('textbox')).toHaveValue('Second task draft');
    rerender(<TaskUpdateComposer taskKey="T-5" mode="manager" via="standup" />);
    expect(screen.getByRole('textbox')).toHaveValue('');
  });

  it('recovers a failed draft and its request identity after remount', async () => {
    mockAddTaskEventMutate.mockRejectedValue(new Error('Offline'));
    const first = render(<TaskUpdateComposer taskKey="T-5" mode="manager" via="standup" />, { wrapper: Wrapper });
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Recover me' } });
    await act(async () => fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' }));
    const [request] = mockAddTaskEventMutate.mock.calls[0]!;
    first.unmount();
    render(<TaskUpdateComposer taskKey="T-5" mode="manager" via="standup" />, { wrapper: Wrapper });
    expect(screen.getByRole('textbox')).toHaveValue('Recover me');
    await act(async () => fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' }));
    expect(mockAddTaskEventMutate.mock.calls[1]![0]).toEqual(request);
  });

  it('lets a failed draft be edited and assigns a new request ID to the changed payload', async () => {
    mockAddTaskEventMutate.mockRejectedValue(new Error('Offline'));
    render(<TaskUpdateComposer taskKey="T-5" mode="manager" via="task_drawer" />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Original' } });
    await act(async () => fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' }));
    const original = mockAddTaskEventMutate.mock.calls[0]![0];
    expect(screen.getByRole('textbox')).not.toHaveAttribute('readonly');
    expect(screen.getByRole('button', { name: 'Decision' })).toBeEnabled();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Corrected' } });
    fireEvent.click(screen.getByRole('button', { name: 'Decision' }));
    await act(async () => fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' }));
    expect(mockAddTaskEventMutate.mock.calls[1]![0]).toMatchObject({ body: 'Corrected', type: 'decision' });
    expect(mockAddTaskEventMutate.mock.calls[1]![0].requestId).not.toBe(original.requestId);
  });

  it('preserves a newer revision typed while an older revision is saving', async () => {
    let success!: () => void;
    mockAddTaskEventMutate.mockReturnValue(new Promise<void>((resolve) => { success = resolve; }));
    const first = render(<TaskUpdateComposer taskKey="T-5" mode="manager" via="task_drawer" />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Submitted' } });
    fireEvent.click(screen.getByRole('button', { name: 'Post' }));
    expect(screen.getByRole('textbox')).not.toHaveAttribute('readonly');
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Next update' } });
    first.unmount();
    await act(async () => success());
    render(<TaskUpdateComposer taskKey="T-5" mode="manager" via="task_drawer" />);
    expect(screen.getByRole('textbox')).toHaveValue('Next update');
  });

  it('restores metadata across remount, isolates composer contexts, and resets emptied drafts', () => {
    const first = render(<TaskUpdateComposer taskKey="T-5" mode="manager" via="standup" />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Private blocker' } });
    fireEvent.click(screen.getByRole('button', { name: 'Blocker' }));
    fireEvent.click(screen.getByRole('button', { name: 'cleared' }));
    fireEvent.click(screen.getByRole('button', { name: 'Private' }));
    first.rerender(<TaskUpdateComposer taskKey="T-5" mode="manager" via="task_drawer" />);
    expect(screen.getByRole('textbox')).toHaveValue('');
    first.rerender(<TaskUpdateComposer taskKey="T-5" mode="manager" via="standup" />);
    expect(screen.getByRole('textbox')).toHaveValue('Private blocker');
    expect(screen.getByRole('button', { name: 'Blocker' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'cleared' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Private' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '' } });
    first.rerender(<TaskUpdateComposer taskKey="T-6" mode="manager" via="standup" />);
    first.rerender(<TaskUpdateComposer taskKey="T-5" mode="manager" via="standup" />);
    expect(screen.getByRole('button', { name: 'Update' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Private' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('expands from the collapsed affordance and submits on Enter', () => {
    render(<TaskUpdateComposer taskKey="T-5" mode="manager" via="standup" collapsed />, { wrapper: Wrapper });

    fireEvent.click(screen.getByText('Add an update…'));
    const box = screen.getByRole('textbox');
    fireEvent.change(box, { target: { value: 'Made progress' } });
    fireEvent.keyDown(box, { key: 'Enter' });

    expect(mockAddTaskEventMutate).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'update', body: 'Made progress', via: 'standup', requestId: expect.any(String) }),
    );
    expect(mockAddMyDayTaskEventMutate).not.toHaveBeenCalled();
  });

  it('sends private visibility when the Private toggle is on', () => {
    render(<TaskUpdateComposer taskKey="T-5" mode="manager" via="task_drawer" />, { wrapper: Wrapper });

    fireEvent.click(screen.getByRole('button', { name: /private/i }));
    const box = screen.getByRole('textbox');
    fireEvent.change(box, { target: { value: 'Sensitive note' } });
    fireEvent.click(screen.getByRole('button', { name: /post/i }));

    expect(mockAddTaskEventMutate).toHaveBeenCalledWith(
      expect.objectContaining({ visibility: 'private', via: 'task_drawer' }),
    );
  });

  it('developer mode posts through the My Day endpoint with the date', () => {
    render(<TaskUpdateComposer taskKey="T-5" mode="developer" date="2026-03-10" />, { wrapper: Wrapper });

    const box = screen.getByRole('textbox');
    fireEvent.change(box, { target: { value: 'Dev update' } });
    fireEvent.keyDown(box, { key: 'Enter' });

    expect(mockAddMyDayTaskEventMutate).toHaveBeenCalledWith(
      expect.objectContaining({ date: '2026-03-10', type: 'update', body: 'Dev update' }),
    );
    expect(mockAddTaskEventMutate).not.toHaveBeenCalled();
  });

  it('isolates developer days while retaining the prior day retry', async () => {
    mockAddMyDayTaskEventMutate.mockRejectedValue(new Error('Offline'));
    const first = render(<TaskUpdateComposer taskKey="T-5" mode="developer" date="2026-03-10" />, { wrapper: Wrapper });
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Late update' } });
    await act(async () => fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' }));
    const request = mockAddMyDayTaskEventMutate.mock.calls[0]![0];
    first.unmount();
    const nextDay = render(<TaskUpdateComposer taskKey="T-5" mode="developer" date="2026-03-11" />, { wrapper: Wrapper });
    expect(screen.getByRole('textbox')).toHaveValue('');
    nextDay.unmount();
    render(<TaskUpdateComposer taskKey="T-5" mode="developer" date="2026-03-10" />, { wrapper: Wrapper });
    await act(async () => fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' }));
    expect(mockAddMyDayTaskEventMutate.mock.calls[1]![0]).toEqual(request);
  });

  it('moves between stacked composers on arrow keys at the boundaries', () => {
    const onArrowNav = vi.fn();
    render(
      <TaskUpdateComposer taskKey="T-5" mode="manager" onArrowNav={onArrowNav} />,
      { wrapper: Wrapper },
    );

    const box = screen.getByRole('textbox');
    fireEvent.keyDown(box, { key: 'ArrowUp' });
    expect(onArrowNav).toHaveBeenCalledWith('up');

    fireEvent.change(box, { target: { value: 'abc' } });
    box.setSelectionRange(3, 3);
    fireEvent.keyDown(box, { key: 'ArrowDown' });
    expect(onArrowNav).toHaveBeenCalledWith('down');

    // Mid-text arrow presses stay inside the textarea.
    onArrowNav.mockClear();
    box.setSelectionRange(1, 1);
    fireEvent.keyDown(box, { key: 'ArrowDown' });
    expect(onArrowNav).not.toHaveBeenCalled();
  });
});

describe('TaskTimeline', () => {
  beforeEach(() => {
    mockManagerEvents = undefined;
    mockMyDayEvents = undefined;
    mockUpdateVisibilityMutate.mockReset();
    mockRedactMutate.mockReset();
  });

  it('renders system changes and references without exposing redacted metadata', () => {
    const changes: Partial<TaskEvent>[] = [
      { type: 'created', meta: { title: 'Investigate API', ownerId: 'dev-1' } },
      { type: 'status', meta: { from: 'planned', to: 'in_progress', reason: 'user' } },
      { type: 'assign', meta: { fromId: 'dev-1', toId: 'dev-2', stateReset: { from: 'in_progress', to: 'planned' } } },
      { type: 'focus', meta: { action: 'set_current', date: '2026-09-24' } },
      { type: 'title', meta: { from: 'Old title', to: 'New title' } },
      { type: 'schedule', meta: { field: 'follow_up_at', from: null, to: '2026-09-25' } },
      { type: 'link', meta: { action: 'added', kind: 'jira', ref: 'APP-1', role: 'primary' } },
      { type: 'checkin_ref', meta: { date: '2026-09-24', developerAccountId: 'dev-1', excerpt: 'Ready for review' } },
      { type: 'note_ref', meta: { noteDate: '2026-09-23', relation: 'created_from', excerpt: 'Private context' }, visibility: 'private' },
      { type: 'merged', meta: { mergedKey: 'T-9', survivorKey: 'T-5', decisionRef: 'M-1' } },
      { type: 'title', redacted: true, meta: { from: 'Hidden old title', to: 'Hidden new title' } },
    ];
    mockManagerEvents = { pages: [{ events: changes.map((event, index) => makeEvent({ id: index + 1, body: null, author: { type: 'system', id: 'mgr-1' }, ...event })), nextCursor: null }] };
    render(<TaskTimeline taskKey="T-5" mode="manager" />, { wrapper: Wrapper });
    for (const description of [
      'Created Investigate API for dev-1', 'planned → in progress (user)',
      'dev-1 → dev-2 (in progress → planned)', 'Set as current work on 2026-09-24',
      'Old title → New title', 'follow up at: Not set → 2026-09-25',
      'Added jira: APP-1 (primary)', 'Check-in on 2026-09-24 for dev-1: Ready for review',
      'Created from note on 2026-09-23: Private context', 'T-9 → T-5 (M-1)',
    ]) expect(screen.getByText(description)).toBeInTheDocument();
    expect(screen.queryByText(/Hidden old title/)).not.toBeInTheDocument();
    expect(screen.getAllByText(/System \(mgr-1\)/).length).toBeGreaterThan(0);
  });

  it('offers redaction for own Copilot and system events within the correction window', () => {
    mockManagerEvents = { pages: [{ events: [
      makeEvent({ id: 1, author: { type: 'copilot', id: 'mgr-1' } }),
      makeEvent({ id: 2, type: 'note_ref', author: { type: 'system', id: 'mgr-1' } }),
      makeEvent({ id: 3, author: { type: 'copilot', id: 'mgr-1' }, occurredAt: new Date(Date.now() - 31 * 86400000).toISOString() }),
    ], nextCursor: null }] };
    render(<TaskTimeline taskKey="T-5" mode="manager" />, { wrapper: Wrapper });
    expect(screen.getAllByRole('button', { name: 'Redact event' })).toHaveLength(2);
  });

  it('renders events with type labels, privacy badge, and redacted placeholder', () => {
    mockManagerEvents = {
      pages: [
        {
          events: [
            makeEvent({ id: 1, body: 'Shared update', visibility: 'shared' }),
            makeEvent({ id: 2, body: 'Private note', visibility: 'private' }),
            makeEvent({ id: 3, type: 'blocker', body: 'API keys', meta: { action: 'raised' } }),
            makeEvent({ id: 4, body: null, redacted: true }),
          ],
          nextCursor: null,
        },
      ],
    };

    render(<TaskTimeline taskKey="T-5" mode="manager" />, { wrapper: Wrapper });

    expect(screen.getByText('Shared update')).toBeInTheDocument();
    expect(screen.getByText('Private note')).toBeInTheDocument();
    expect(screen.getByText('Private')).toBeInTheDocument();
    expect(screen.getByText('Blocker')).toBeInTheDocument();
    expect(screen.getByText('Raised')).toBeInTheDocument();
    expect(screen.getByText('This entry was removed.')).toBeInTheDocument();
  });

  it('shows visibility and redact controls only on the manager own authored events', () => {
    mockManagerEvents = {
      pages: [
        {
          events: [
            makeEvent({ id: 1 }),
            makeEvent({ id: 2, author: { type: 'manager', id: 'mgr-2', displayName: 'Other' } }),
            makeEvent({ id: 3, author: { type: 'developer', id: 'dev-1', displayName: 'Alice' } }),
          ],
          nextCursor: null,
        },
      ],
    };

    render(<TaskTimeline taskKey="T-5" mode="manager" />, { wrapper: Wrapper });

    // Own manager event: both controls present.
    expect(screen.getAllByRole('button', { name: /make event private/i })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Redact event' })).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: /make event private/i }));
    expect(mockUpdateVisibilityMutate).toHaveBeenCalledWith(
      { eventId: 1, visibility: 'private' },
      expect.objectContaining({ onError: expect.any(Function) }),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Redact event' }));
    expect(mockRedactMutate).toHaveBeenCalledWith(1, expect.objectContaining({ onError: expect.any(Function) }));
  });

  it('developer mode renders the My Day event feed without manager controls', () => {
    mockMyDayEvents = {
      pages: [
        { events: [makeEvent({ id: 7, body: 'Dev-visible update' })], nextCursor: null },
      ],
    };

    render(<TaskTimeline taskKey="T-5" mode="developer" />, { wrapper: Wrapper });

    expect(screen.getByText('Dev-visible update')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /make event private/i })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Redact event' })).toBeNull();
  });

  it('loads developer activity on expansion and uses only the developer feed', () => {
    mockManagerEvents = { pages: [{ events: [makeEvent({ body: 'Manager-only content' })], nextCursor: null }] };
    mockMyDayEvents = { pages: [{ events: [makeEvent({ body: 'Earlier shared update' })], nextCursor: null }] };
    render(<TaskTimelineDisclosure taskKey="T-5" mode="developer" />, { wrapper: Wrapper });
    expect(screen.queryByText('Earlier shared update')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Activity for T-5' }));
    expect(screen.getByText('Earlier shared update')).toBeInTheDocument();
    expect(screen.queryByText('Manager-only content')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Redact event' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Activity for T-5' }));
    expect(screen.queryByText('Earlier shared update')).not.toBeInTheDocument();
  });

  it('resolves account ids to names and labels own manager events as You', () => {
    mockManagerEvents = { pages: [{ events: [
      makeEvent({ id: 1, type: 'created', body: null, meta: { title: 'Ship it', ownerId: 'dev-1' }, author: { type: 'system', id: 'mgr-1' } }),
      makeEvent({ id: 2, type: 'assign', body: null, meta: { fromId: 'dev-1', toId: 'dev-2' }, author: { type: 'manager', id: 'mgr-1' } }),
    ], nextCursor: null }] };
    const names: Record<string, string> = { 'dev-1': 'Alice', 'dev-2': 'Bob' };
    render(<TaskTimeline taskKey="T-5" mode="manager" resolveName={(id) => names[id]} />, { wrapper: Wrapper });
    expect(screen.getByText('Created Ship it for Alice')).toBeInTheDocument();
    expect(screen.getByText('Alice → Bob')).toBeInTheDocument();
    expect(screen.getByText('You')).toBeInTheDocument();
  });

  it('shows the empty label when there are no events', () => {
    mockManagerEvents = { pages: [{ events: [], nextCursor: null }] };

    render(<TaskTimeline taskKey="T-5" mode="manager" emptyLabel="No task timeline yet." />, { wrapper: Wrapper });

    expect(screen.getByText('No task timeline yet.')).toBeInTheDocument();
  });
});
