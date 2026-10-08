import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AuthUser, TaskEvent } from '@/types';
import { TaskTimeline } from '@/components/tasks/TaskTimeline';
import { createTestQueryClient } from './wrapper';

let user: AuthUser;
const get = vi.fn();
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user, features: { tasksPhase3: true, teamMode: 'collab' } }), useAuthScopeKey: () => `${user.workspaceId}:${user.accountId}:${user.role}` }));
vi.mock('@/context/ToastContext', () => ({ useToast: () => ({ addToast: vi.fn() }) }));
vi.mock('@/lib/api', () => ({ api: { get: (...args: unknown[]) => get(...args) } }));
const clients: ReturnType<typeof createTestQueryClient>[] = [];
beforeEach(() => {
  vi.clearAllMocks(); window.history.replaceState(null, '', '/tasks');
  user = { accountId: 'lead', username: 'lead', displayName: 'Lead', role: 'manager', workspaceId: 'default' };
});
afterEach(() => { clients.splice(0).forEach((client) => client.clear()); });
const event = (id: number, body: string, taskKey = 'T-2'): TaskEvent => ({ id, taskKey, type: 'update', body, author: { type: 'manager', id: 'lead' }, visibility: 'shared', occurredAt: new Date().toISOString(), approximateTime: false });
function mount(mode: 'manager' | 'developer') {
  user = { ...user, role: mode };
  const client = createTestQueryClient(); clients.push(client);
  const content = (taskKey = 'T-2') => <QueryClientProvider client={client}><TaskTimeline taskKey={taskKey} mode={mode} /></QueryClientProvider>;
  return { client, content, ...render(content()) };
}
const cursorFor = (url: string) => new URL(url, 'https://fixture.invalid').searchParams.get('cursor');

it.each(['manager', 'developer'] as const)('TR-04 %s retains pages and retries the first and later failed older cursor exactly once', async (mode) => {
  let fail = '1';
  get.mockImplementation(async (url: string) => {
    const cursor = cursorFor(url);
    if (cursor === fail) throw new Error('Offline');
    const n = Number(cursor ?? 0);
    return { events: [event(n + 1, `Activity ${n}`), ...(n ? [event(n, `Activity ${n - 1}`)] : [])], nextCursor: String(n + 1) };
  });
  mount(mode);
  await screen.findByText('Activity 0');
  fireEvent.click(screen.getByRole('button', { name: 'Load older activity' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('older activity');
  expect(screen.getByText('Activity 0')).toBeVisible();
  fail = ''; get.mockClear();
  fireEvent.click(screen.getByRole('button', { name: 'Retry older activity' }));
  await screen.findByText('Activity 1');
  expect(get).toHaveBeenCalledOnce(); expect(cursorFor(get.mock.calls[0]![0])).toBe('1');
  expect(get.mock.calls[0]![0]).toMatch(mode === 'developer' ? /^\/my-day\/tasks/ : /^\/tasks/);
  fail = '2';
  fireEvent.click(screen.getByRole('button', { name: 'Load older activity' }));
  await screen.findByRole('alert');
  expect(screen.getByText('Activity 0')).toBeVisible(); expect(screen.getByText('Activity 1')).toBeVisible();
  fail = ''; get.mockClear();
  fireEvent.click(screen.getByRole('button', { name: 'Retry older activity' }));
  await screen.findByText('Activity 2');
  expect(get).toHaveBeenCalledOnce(); expect(cursorFor(get.mock.calls[0]![0])).toBe('2');
  expect(screen.getAllByRole('listitem')).toHaveLength(3);
});

it.each(['manager', 'developer'] as const)('TR-04 %s retains loaded timeline on refresh failure and retries it', async (mode) => {
  get.mockResolvedValue({ events: [event(1, 'Kept activity')], nextCursor: null });
  const view = mount(mode); await screen.findByText('Kept activity');
  get.mockRejectedValue(new Error('Offline'));
  await act(async () => { await view.client.refetchQueries({ queryKey: ['task-events'] }); });
  expect(await screen.findByRole('alert')).toHaveTextContent('refresh');
  expect(screen.getByText('Kept activity')).toBeVisible();
  get.mockResolvedValue({ events: [event(1, 'Fresh activity')], nextCursor: null });
  fireEvent.click(screen.getByRole('button', { name: 'Retry', exact: true }));
  await screen.findByText('Fresh activity');
  expect(screen.queryByRole('alert')).toBeNull();
});

it.each(['manager', 'developer'] as const)('TR-04 %s reports initial failure and prevents repeated older retries while pending', async (mode) => {
  get.mockRejectedValueOnce(new Error('Offline')).mockResolvedValue({ events: [event(1, 'Latest activity')], nextCursor: 'older' });
  mount(mode);
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not load the timeline');
  expect(screen.queryByText('No activity yet.')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Retry', exact: true }));
  await screen.findByText('Latest activity');
  get.mockRejectedValueOnce(new Error('Offline older'));
  fireEvent.click(screen.getByRole('button', { name: 'Load older activity' }));
  const retry = await screen.findByRole('button', { name: 'Retry older activity' });
  let resolve!: (value: unknown) => void;
  get.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  get.mockClear(); fireEvent.click(retry);
  await waitFor(() => expect(retry).toBeDisabled());
  fireEvent.click(retry); expect(get).toHaveBeenCalledOnce();
  expect(screen.getByRole('status')).toHaveTextContent('Loading older');
  expect(screen.getByText('Latest activity')).toBeVisible();
  await act(async () => { resolve({ events: [event(2, 'Older activity')], nextCursor: null }); });
  await screen.findByText('Older activity');
});

it.each(['manager', 'developer'] as const)('TR-04 %s never retains another task/account after a failed history request', async (mode) => {
  get.mockResolvedValueOnce({ events: [event(1, 'Protected activity')], nextCursor: 'older' }).mockRejectedValue(new Error('Offline'));
  const view = mount(mode); await screen.findByText('Protected activity');
  fireEvent.click(screen.getByRole('button', { name: 'Load older activity' })); await screen.findByRole('alert');
  view.rerender(view.content('T-3'));
  expect(screen.queryByText('Protected activity')).toBeNull();
  await screen.findByRole('alert');
  user = { ...user, accountId: 'next', workspaceId: 'next' };
  view.rerender(view.content());
  expect(screen.queryByText('Protected activity')).toBeNull();
  await screen.findByRole('alert');
});

it.each([['manager', 401], ['manager', 403], ['manager', 404], ['manager', 410], ['developer', 401], ['developer', 403], ['developer', 404], ['developer', 410]] as const)('TR-04 %s hides protected timeline on authoritative status %s', async (mode, status) => {
  get.mockResolvedValueOnce({ events: [event(1, 'Protected activity')], nextCursor: 'older' });
  mount(mode); await screen.findByText('Protected activity');
  get.mockRejectedValue(Object.assign(new Error('Unavailable'), { status }));
  fireEvent.click(screen.getByRole('button', { name: 'Load older activity' }));
  await screen.findByRole('alert');
  expect(screen.queryByText('Protected activity')).toBeNull();
});
