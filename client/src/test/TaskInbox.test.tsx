import { act, fireEvent, renderHook, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { useTaskInbox, useTaskInboxLatest } from '@/hooks/useTaskInbox';
import { QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskInboxContent } from '@/components/actions/TaskInboxContent';
import { TaskInboxPopover } from '@/components/actions/TaskInboxPopover';
import { TaskTimeline } from '@/components/tasks/TaskTimeline';
import { api } from '@/lib/api';
import { advanceAuthEpoch } from '@/lib/auth-epoch';
import { createTestQueryClient } from './wrapper';
import type { AuthUser, TaskEvent, TaskInboxItem } from '@/types';

let user: AuthUser = {
  username: 'lead',
  accountId: 'lead',
  displayName: 'Lead',
  role: 'manager',
  workspaceId: 'default',
};
let teamMode: 'solo' | 'collab' = 'collab';
const addToast = vi.fn();
const onOpen = vi.fn();
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user, features: { tasksPhase3: true, teamMode } }),
  useAuthScopeKey: () => `${user.workspaceId}:${user.username}:${user.role}`,
}));
vi.mock('@/context/ToastContext', () => ({ useToast: () => ({ addToast }) }));
vi.mock('@/hooks/useTasks', () => ({
  useTaskEvents: () => ({ data: { pages: [{ events: [], nextCursor: null }] }, isLoading: false, isError: false }),
  useMyDayTaskEvents: () => ({ data: { pages: [{ events: [], nextCursor: null }] }, isLoading: false, isError: false }),
  useUpdateTaskEventVisibility: () => ({ mutate: vi.fn() }),
  useRedactTaskEvent: () => ({ mutate: vi.fn() }),
}));
const item: TaskInboxItem = {
  id: 7,
  eventId: 45,
  taskKey: 'T-2',
  title: 'Release checklist',
  kind: 'instruction',
  actorName: 'Priya Rao',
  excerpt: 'Check the release key',
  occurredAt: '2026-10-03T09:00:00Z',
  readAt: null,
  href: '/t/T-2?event=45',
};
let rows: TaskInboxItem[];
const get = vi.spyOn(api, 'get');
const post = vi.spyOn(api, 'post');
function mount(content = <TaskInboxContent onOpen={onOpen} />, qc = createTestQueryClient()) {
  return { ...render(<QueryClientProvider client={qc}>{content}</QueryClientProvider>), qc };
}
beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState(null, '', '/');
  Element.prototype.scrollIntoView = vi.fn();
  user = { username: 'lead', accountId: 'lead', displayName: 'Lead', role: 'manager', workspaceId: 'default' };
  teamMode = 'collab';
  rows = [{ ...item }];
  get.mockImplementation(async (url) => {
    const unread = url.includes('unread=true');
    return {
      enabled: true,
      unreadCount: rows.filter((row) => !row.readAt).length,
      events: rows.filter((row) => !unread || !row.readAt),
      nextCursor: null,
    };
  });
  post.mockImplementation(async (_url, input) => {
    const request = input as { ids: number[]; read: boolean };
    rows = rows.map((row) =>
      request.ids.includes(row.id) ? { ...row, readAt: request.read ? '2026-10-03T10:00:00Z' : null } : row,
    );
    return { success: true };
  });
});

describe('task inbox', () => {
  it('acknowledges read/unread and shows the persisted result in a fresh query client', async () => {
    const view = mount();
    expect(await screen.findByRole('link', { name: /Release checklist/ })).toHaveAttribute('href', item.href);
    fireEvent.click(screen.getByRole('button', { name: 'Mark T-2 update read' }));
    await screen.findByText('No unread updates.');
    expect(post).toHaveBeenCalledWith('/task-inbox/read', { ids: [7], read: true });
    view.unmount();
    mount();
    expect(await screen.findByText('No unread updates.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Mark T-2 update unread' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Updates · 1 unread' })).toBeInTheDocument());
    expect(post).toHaveBeenLastCalledWith('/task-inbox/read', { ids: [7], read: false });
  });
  it('keeps failed read state visible and offers retry for exactly the shown ids', async () => {
    post.mockRejectedValueOnce(new Error('Offline'));
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Mark shown as read' }));
    await waitFor(() =>
      expect(addToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Could not update read state',
          message: 'Offline',
          action: expect.any(Object),
        }),
      ),
    );
    expect(screen.getByRole('heading', { name: 'Updates · 1 unread' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mark T-2 update read' })).toBeEnabled();
    act(() => addToast.mock.calls[0]![0].action.onClick());
    await screen.findByText('No unread updates.');
    expect(post.mock.calls[1]?.[1]).toEqual({ ids: [7], read: true });
  });
  it('opens the exact event on ordinary activation while preserving native modified links', async () => {
    mount();
    const link = await screen.findByRole('link', { name: /Release checklist/ });
    fireEvent.click(link, { ctrlKey: true });
    expect(onOpen).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe('/');
    fireEvent.click(link);
    expect(onOpen).toHaveBeenCalledOnce();
    expect(window.location.pathname + window.location.search).toBe(item.href);
    await waitFor(() => expect(post).toHaveBeenCalledWith('/task-inbox/read', { ids: [7], read: true }));
  });
  it('offers the same read retry after navigating away unmounts the inbox', async () => {
    let reject!: (error: Error) => void;
    post.mockImplementationOnce(
      () =>
        new Promise((_resolve, fail) => {
          reject = fail;
        }),
    );
    const view = mount();
    fireEvent.click(await screen.findByRole('link', { name: /Release checklist/ }));
    await waitFor(() => expect(post).toHaveBeenCalledOnce());
    view.unmount();
    await act(async () => reject(new Error('Offline after navigation')));
    await waitFor(() => expect(addToast).toHaveBeenCalledOnce());
    act(() => addToast.mock.calls[0]![0].action.onClick());
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    expect(post.mock.calls[1]?.[1]).toEqual({ ids: [7], read: true });
    await waitFor(() => expect(rows[0]?.readAt).not.toBeNull());
  });
  it.each(['pending failure', 'visible retry'])('revokes an unmounted inbox callback on logout: %s', async (stage) => {
    let reject!: (error: Error) => void;
    post.mockImplementationOnce(
      () =>
        new Promise((_resolve, fail) => {
          reject = fail;
        }),
    );
    const view = mount();
    fireEvent.click(await screen.findByRole('link', { name: /Release checklist/ }));
    await waitFor(() => expect(post).toHaveBeenCalledOnce());
    view.unmount();
    if (stage === 'pending failure') advanceAuthEpoch(view.qc);
    await act(async () => reject(new Error('Offline')));
    if (stage === 'pending failure') expect(addToast).not.toHaveBeenCalled();
    else {
      await waitFor(() => expect(addToast).toHaveBeenCalledOnce());
      advanceAuthEpoch(view.qc);
      act(() => addToast.mock.calls[0]![0].action.onClick());
    }
    expect(post).toHaveBeenCalledOnce();
    expect(rows[0]?.readAt).toBeNull();
  });
  it('does not claim an empty inbox on failed reads and retries in place', async () => {
    get.mockRejectedValueOnce(new Error('Offline'));
    mount();
    expect(await screen.findByRole('alert')).toHaveTextContent('Updates unavailable.');
    expect(screen.queryByText('No unread updates.')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('link', { name: /Release checklist/ })).toBeInTheDocument();
  });
  it('keeps solo quiet and lets developers read only their personal endpoint', async () => {
    teamMode = 'solo';
    const solo = mount(<TaskInboxPopover />);
    expect(screen.queryByRole('button', { name: /Updates/ })).not.toBeInTheDocument();
    expect(get).not.toHaveBeenCalled();
    solo.unmount();
    teamMode = 'collab';
    user = { ...user, username: 'dev', role: 'developer', accountId: 'dev-1', developerAccountId: 'dev-1' };
    mount(<TaskInboxPopover />);
    fireEvent.click(await screen.findByRole('button', { name: 'Updates, 1 unread' }));
    expect(await screen.findByRole('link', { name: /Release checklist/ })).toBeInTheDocument();
    expect(get.mock.calls.every(([url]) => url.startsWith('/task-inbox?'))).toBe(true);
  });
  it('isolates cached inboxes and a delayed read acknowledgement across account switches', async () => {
    let acknowledge!: (value: unknown) => void;
    post.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          acknowledge = resolve;
        }),
    );
    const qc = createTestQueryClient();
    const view = mount(undefined, qc);
    fireEvent.click(await screen.findByRole('button', { name: 'Mark shown as read' }));
    await waitFor(() => expect(post).toHaveBeenCalled());
    const oldKey = ['task-inbox', 'default:lead:manager', true];
    user = { ...user, workspaceId: 'another', username: 'new-lead' };
    rows = [];
    view.rerender(
      <QueryClientProvider client={qc}>
        <TaskInboxContent onOpen={onOpen} />
      </QueryClientProvider>,
    );
    expect(await screen.findByText('No unread updates.')).toBeInTheDocument();
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    await act(async () => acknowledge({ success: true }));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: oldKey.slice(0, 2) });
    expect(screen.queryByRole('link', { name: /Release checklist/ })).not.toBeInTheDocument();
  });
  it('opens an older exact event without walking timeline pages and focuses it', async () => {
    window.history.replaceState(null, '', item.href);
    const event: TaskEvent = {
      id: 45,
      taskKey: 'T-2',
      type: 'instruction',
      body: 'Older exact instruction',
      visibility: 'shared',
      author: { type: 'manager', id: 'other-lead' },
      occurredAt: item.occurredAt,
      approximateTime: false,
      redacted: false,
    };
    get.mockResolvedValueOnce({ event });
    mount(<TaskTimeline taskKey="T-2" mode="manager" />);
    const opened = await screen.findByRole('region', { name: 'Opened task update' });
    expect(opened).toHaveTextContent('Older exact instruction');
    expect(opened).toHaveFocus();
    expect(get).toHaveBeenCalledWith('/task-inbox/events/45?taskKey=T-2', expect.any(Object));
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });
  it('hides the inbox when the server disables collaboration before the session refreshes', async () => {
    get.mockResolvedValueOnce({ enabled: false, events: [], unreadCount: 0, nextCursor: null });
    mount(<TaskInboxPopover />);
    await waitFor(() => expect(get).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByRole('button', { name: /Updates/ })).not.toBeInTheDocument());
  });

  it('retries an unavailable exact event and hides its cached card when collaboration ends', async () => {
    window.history.replaceState(null, '', item.href);
    get.mockRejectedValueOnce(new Error('Unavailable'));
    const view = mount(<TaskTimeline taskKey="T-2" mode="manager" />);
    expect(await screen.findByRole('alert')).toHaveTextContent('This update is unavailable.');
    expect(screen.queryByRole('region', { name: 'Opened task update' })).not.toBeInTheDocument();
    get.mockResolvedValueOnce({
      event: {
        id: 45,
        taskKey: 'T-2',
        type: 'instruction',
        body: 'Exact instruction',
        visibility: 'shared',
        author: { type: 'manager', displayName: 'Priya Rao' },
        occurredAt: item.occurredAt,
        approximateTime: false,
      },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('region', { name: 'Opened task update' })).toHaveTextContent('Priya Rao');
    teamMode = 'solo';
    view.rerender(
      <QueryClientProvider client={view.qc}>
        <TaskTimeline taskKey="T-2" mode="manager" />
      </QueryClientProvider>,
    );
    expect(screen.queryByRole('region', { name: 'Opened task update' })).not.toBeInTheDocument();
  });
});

it('P08 polls one latest page after three history pages and releases bounded history on close', async () => {
  vi.useFakeTimers();
  get.mockImplementation(async (url) => {
    const cursor = Number(new URL(url, 'https://fixture.invalid').searchParams.get('cursor') ?? 0);
    return { enabled: true, unreadCount: 200, events: [{ ...item, id: cursor + 1 }], nextCursor: String(cursor + 1) };
  });
  const qc = createTestQueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  const badge = renderHook(() => useTaskInboxLatest(), { wrapper });
  const content = renderHook(() => useTaskInbox(), { wrapper });
  const settle = async () => { await act(async () => { await vi.advanceTimersByTimeAsync(0); }); };
  await settle(); await settle();
  expect(get).toHaveBeenCalledOnce();
  for (let i = 0; i < 3; i++) {
    await act(async () => { await content.result.current.fetchNextPage(); });
    await settle(); await settle();
  }
  expect(content.result.current.data?.pages).toHaveLength(4);
  get.mockClear();
  await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
  expect(get).toHaveBeenCalledOnce();
  expect(get.mock.calls[0]![0]).not.toContain('cursor');
  for (let i = 0; i < 5; i++) {
    await act(async () => { await content.result.current.fetchNextPage(); });
    await settle();
  }
  expect(content.result.current.data?.pages).toHaveLength(6); // latest + at most five older pages
  content.unmount(); await settle();
  expect(qc.getQueryCache().findAll({ predicate: (query) => query.queryKey[2] === 'history' })).toHaveLength(0);
  get.mockClear();
  await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
  expect(get).toHaveBeenCalledOnce();
  badge.unmount(); qc.clear(); vi.useRealTimers();
});
