import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AuthProvider, useAuth } from '@/context/AuthContext';
import { useDesktopAlerts } from '@/hooks/useDesktopAlerts';
import { showDesktopAlert } from '@/lib/desktop-alerts';
const transport = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('@/lib/api', () => ({ api: transport }));
const user = (name: string) => ({ username: name, accountId: name, workspaceId: name, role: 'manager', displayName: name });
class FakeNotification {
  static permission: NotificationPermission = 'granted';
  static requestPermission = vi.fn(async () => FakeNotification.permission);
  static instances: FakeNotification[] = [];
  onclick: (() => void) | null = null;
  onclose: (() => void) | null = null;
  close = vi.fn();
  constructor(public title: string) { FakeNotification.instances.push(this); }
}
function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}><AuthProvider>{children}</AuthProvider></QueryClientProvider>;
  return renderHook(() => ({ auth: useAuth(), alerts: useDesktopAlerts() }), { wrapper });
}
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear(); sessionStorage.clear(); FakeNotification.instances = [];
  FakeNotification.permission = 'granted'; vi.stubGlobal('Notification', FakeNotification);
  transport.get.mockResolvedValue({ user: user('A') });
  transport.post.mockImplementation((path, body) => path === '/auth/login' ? Promise.resolve({ user: user(body.username) }) : Promise.reject(new Error('Offline logout')));
});
afterEach(() => vi.unstubAllGlobals());
it.each(['on', 'off'])('keeps the same user’s %s choice across failed logout while isolating B and removing drafts (R8)', async (choice) => {
  const hook = setup();
  await waitFor(() => expect(hook.result.current.auth.user?.username).toBe('A'));
  await act(async () => { await hook.result.current.alerts.enable(); if (choice === 'off') hook.result.current.alerts.disable(); });
  localStorage.setItem('lead-os:A:A:global-capture', 'Private draft');
  sessionStorage.setItem('lead-os:A:A:standup-session:today', 'Private standup');
  const onClick = vi.fn();
  showDesktopAlert({ title: 'Private task', body: 'Private update', tag: 'fixture', onClick });
  const notification = FakeNotification.instances.at(-1)!;
  const staleClick = notification.onclick!;
  await act(async () => { await hook.result.current.auth.logout().catch(() => {}); await hook.result.current.auth.login('B', 'fixture'); });
  expect(notification.close).toHaveBeenCalled(); expect(notification.onclick).toBeNull();
  staleClick(); expect(onClick).not.toHaveBeenCalled();
  expect(hook.result.current.alerts.enabled).toBe(false);
  expect(localStorage.getItem('lead-os:A:A:global-capture')).toBeNull();
  expect(sessionStorage.getItem('lead-os:A:A:standup-session:today')).toBeNull();
  expect(localStorage.getItem('lead-os:A:A:desktop-alerts')).toBe(choice);
  expect(localStorage.getItem('lead-os:A:A:desktop-alerts-prompt')).toBe('seen');
  await act(async () => { await hook.result.current.auth.login('A', 'fixture'); });
  expect(hook.result.current.alerts.enabled).toBe(choice === 'on');
  expect(hook.result.current.alerts.canOffer).toBe(false);
});
it('revokes an outstanding permission decision even after switching back to A (R8)', async () => {
  FakeNotification.permission = 'default';
  let release!: (permission: NotificationPermission) => void;
  FakeNotification.requestPermission.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
  const hook = setup();
  await waitFor(() => expect(hook.result.current.auth.user?.username).toBe('A'));
  let pending!: Promise<unknown>;
  act(() => { pending = hook.result.current.alerts.enable(); });
  await act(async () => { await hook.result.current.auth.logout().catch(() => {}); await hook.result.current.auth.login('B', 'fixture'); await hook.result.current.auth.login('A', 'fixture'); });
  await act(async () => { FakeNotification.permission = 'granted'; release('granted'); expect(await pending).toBe('unsupported'); });
  expect(localStorage.getItem('lead-os:A:A:desktop-alerts')).toBeNull();
  expect(localStorage.getItem('lead-os:B:B:desktop-alerts')).toBeNull();
  expect(FakeNotification.instances).toHaveLength(0);
});
