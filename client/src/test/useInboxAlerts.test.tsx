import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useInboxAlerts } from '@/hooks/useInboxAlerts';
import { api } from '@/lib/api';
import { createTestQueryClient } from './wrapper';
import type { AuthUser, TaskInboxItem } from '@/types';

let user: AuthUser = { username: 'dev', accountId: 'dev-1', developerAccountId: 'dev-1', displayName: 'Dev', role: 'developer', workspaceId: 'default' };
const addToast = vi.fn();
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user, features: { tasksPhase3: true, teamMode: 'solo' } }),
  useAuthScopeKey: () => `${user.workspaceId}:${user.username}:${user.role}`,
}));
vi.mock('@/context/ToastContext', () => ({ useToast: () => ({ addToast }) }));

class FakeNotification {
  static permission: NotificationPermission = 'granted';
  static instances: FakeNotification[] = [];
  static requestPermission = vi.fn(async () => FakeNotification.permission);
  onclick: (() => void) | null = null;
  close = vi.fn();
  constructor(public title: string, public options: NotificationOptions) {
    FakeNotification.instances.push(this);
  }
}

let rows: TaskInboxItem[];
let visibility: DocumentVisibilityState;
let focused: boolean;
const get = vi.spyOn(api, 'get');
const post = vi.spyOn(api, 'post');
const item = (id: number, patch: Partial<TaskInboxItem> = {}): TaskInboxItem => ({
  id, eventId: id + 40, taskKey: `T-${id}`, title: `Task ${id}`, kind: 'instruction', actorName: 'Priya Rao',
  excerpt: 'Please look', occurredAt: '2026-10-12T09:00:00Z', readAt: null, href: `/t/T-${id}?event=${id + 40}`, ...patch,
});

function mount() {
  const qc = createTestQueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  const view = renderHook(() => useInboxAlerts(), { wrapper });
  const poll = async () => {
    await act(async () => { await qc.invalidateQueries({ queryKey: ['task-inbox'] }); });
  };
  // The first page has been rendered and taken as the baseline once its count is in the tab title.
  const settle = () => waitFor(() => expect(document.title).toBe('(1) LeadOS'));
  return { ...view, qc, poll, settle };
}
const away = (hidden = true) => {
  visibility = hidden ? 'hidden' : 'visible';
  focused = !hidden;
};
const comeBack = () => {
  visibility = 'visible';
  focused = true;
  act(() => { document.dispatchEvent(new Event('visibilitychange')); });
};
const turnOnDesktopAlerts = () => window.localStorage.setItem('lead-os:default:dev:desktop-alerts', 'on');

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  window.history.replaceState(null, '', '/my-day');
  document.title = 'LeadOS';
  FakeNotification.permission = 'granted';
  FakeNotification.instances = [];
  vi.stubGlobal('Notification', FakeNotification);
  visibility = 'visible';
  focused = true;
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
  vi.spyOn(document, 'hasFocus').mockImplementation(() => focused);
  window.focus = vi.fn();
  rows = [item(1)];
  get.mockImplementation(async () => ({ enabled: true, unreadCount: rows.length, events: [...rows].sort((a, b) => b.id - a.id), nextCursor: null }));
  post.mockResolvedValue({ success: true });
});
afterEach(() => vi.unstubAllGlobals());

describe('useInboxAlerts', () => {
  it('does not alert for updates that were already waiting, but shows the count in the tab title', async () => {
    const view = mount();
    await view.settle();
    expect(addToast).not.toHaveBeenCalled();
    expect(FakeNotification.instances).toHaveLength(0);
    rows = [];
    await view.poll();
    await waitFor(() => expect(document.title).toBe('LeadOS'));
    view.unmount();
  });

  it('shows a toast when an update lands while the tab is in use, and Open acknowledges and navigates', async () => {
    const view = mount();
    await view.settle();
    rows = [item(2, { kind: 'schedule', change: { field: 'due_at', from: null, to: '2026-10-16' } }), item(1)];
    await view.poll();
    await waitFor(() => expect(addToast).toHaveBeenCalledTimes(1));
    const toast = addToast.mock.calls[0]![0];
    expect(toast).toMatchObject({ type: 'info', title: 'Priya changed the due date on T-2', message: 'Task 2' });
    expect(FakeNotification.instances).toHaveLength(0);
    act(() => toast.action.onClick());
    await waitFor(() => expect(post).toHaveBeenCalledWith('/task-inbox/read', { ids: [2], read: true }));
    expect(window.location.pathname + window.location.search).toBe('/t/T-2?event=42');
    view.unmount();
  });

  it('collapses several updates into one toast', async () => {
    const view = mount();
    await view.settle();
    rows = [item(4), item(3), item(2), item(1)];
    await view.poll();
    await waitFor(() => expect(addToast).toHaveBeenCalledTimes(1));
    expect(addToast.mock.calls[0]![0]).toMatchObject({ title: '3 new updates', action: { label: 'View' } });
    view.unmount();
  });

  it('sends a desktop notification when the tab is in the background and alerts are on', async () => {
    turnOnDesktopAlerts();
    const view = mount();
    await view.settle();
    away();
    rows = [item(2, { kind: 'priority', change: { field: 'priority', from: 'normal', to: 'high' } }), item(1)];
    await view.poll();
    await waitFor(() => expect(FakeNotification.instances).toHaveLength(1));
    const [shown] = FakeNotification.instances;
    expect(shown).toMatchObject({ title: 'Priya marked T-2 high priority' });
    expect(shown!.options).toMatchObject({ body: 'Task 2', tag: 'leados-T-2', icon: '/favicon.svg' });
    expect(addToast).not.toHaveBeenCalled();
    // Clicking it focuses the window, opens the exact update and marks it read.
    act(() => shown!.onclick!());
    expect(shown!.close).toHaveBeenCalled();
    expect(window.focus).toHaveBeenCalled();
    await waitFor(() => expect(post).toHaveBeenCalledWith('/task-inbox/read', { ids: [2], read: true }));
    expect(window.location.pathname).toBe('/t/T-2');
    // …and nothing is repeated when the person arrives.
    rows = [item(1)];
    comeBack();
    expect(addToast).not.toHaveBeenCalled();
    view.unmount();
  });

  it('sends one notification for a burst of updates', async () => {
    turnOnDesktopAlerts();
    const view = mount();
    await view.settle();
    away();
    rows = [item(3), item(2), item(1)];
    await view.poll();
    await waitFor(() => expect(FakeNotification.instances).toHaveLength(1));
    expect(FakeNotification.instances[0]).toMatchObject({ title: '2 new updates' });
    expect(FakeNotification.instances[0]!.options.tag).toBe('leados-updates');
    view.unmount();
  });

  it('stays out of the way when desktop alerts are off or blocked, then says what was missed on return', async () => {
    const view = mount();
    await view.settle();
    away();
    rows = [item(3), item(2), item(1)];
    await view.poll();
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    expect(FakeNotification.instances).toHaveLength(0);
    expect(addToast).not.toHaveBeenCalled();
    comeBack();
    await waitFor(() => expect(addToast).toHaveBeenCalledTimes(1));
    expect(addToast.mock.calls[0]![0]).toMatchObject({ title: '2 updates while you were away', action: { label: 'View' } });
    comeBack();
    expect(addToast).toHaveBeenCalledTimes(1);
    view.unmount();
  });

  it('never notifies without the browser permission, even when the choice is on', async () => {
    turnOnDesktopAlerts();
    FakeNotification.permission = 'denied';
    const view = mount();
    await view.settle();
    away();
    rows = [item(2), item(1)];
    await view.poll();
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    expect(FakeNotification.instances).toHaveLength(0);
    view.unmount();
  });

  it('restores the title when it unmounts', async () => {
    const view = mount();
    await waitFor(() => expect(document.title).toBe('(1) LeadOS'));
    view.unmount();
    expect(document.title).toBe('LeadOS');
  });
});
