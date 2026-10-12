import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DesktopAlertsPrompt, DesktopAlertsSwitch } from '@/components/actions/DesktopAlertsControls';

const user = { username: 'dev', workspaceId: 'default', role: 'developer' };
const addToast = vi.fn();
let inboxEnabled = true;
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user }) }));
vi.mock('@/context/ToastContext', () => ({ useToast: () => ({ addToast }) }));
vi.mock('@/hooks/useTaskInbox', () => ({ useTaskInboxLatest: () => ({ enabled: inboxEnabled }) }));

class FakeNotification {
  static permission: NotificationPermission = 'default';
  static instances: FakeNotification[] = [];
  static answer: NotificationPermission = 'granted';
  static requestPermission = vi.fn(async () => {
    FakeNotification.permission = FakeNotification.answer;
    return FakeNotification.answer;
  });
  onclick: (() => void) | null = null;
  close = vi.fn();
  constructor(public title: string, public options: NotificationOptions) {
    FakeNotification.instances.push(this);
  }
}
const CHOICE = 'lead-os:default:dev:desktop-alerts';
const PROMPT = 'lead-os:default:dev:desktop-alerts-prompt';

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  inboxEnabled = true;
  FakeNotification.permission = 'default';
  FakeNotification.answer = 'granted';
  FakeNotification.instances = [];
  vi.stubGlobal('Notification', FakeNotification);
});
afterEach(() => vi.unstubAllGlobals());

describe('DesktopAlertsPrompt', () => {
  it('offers alerts once and, when allowed, turns them on and proves it with a notification', async () => {
    render(<DesktopAlertsPrompt />);
    expect(screen.getByRole('region', { name: 'Desktop alerts' })).toHaveTextContent('Know the moment your work changes');
    fireEvent.click(screen.getByRole('button', { name: 'Turn on alerts' }));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Desktop alerts' })).not.toBeInTheDocument());
    expect(FakeNotification.requestPermission).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem(CHOICE)).toBe('on');
    expect(FakeNotification.instances[0]).toMatchObject({ title: 'Desktop alerts are on' });
    expect(addToast).toHaveBeenCalledWith(expect.objectContaining({ type: 'success', title: 'Desktop alerts are on' }));
  });

  it('explains a refusal once and never asks again', async () => {
    FakeNotification.answer = 'denied';
    const view = render(<DesktopAlertsPrompt />);
    fireEvent.click(screen.getByRole('button', { name: 'Turn on alerts' }));
    await waitFor(() => expect(addToast).toHaveBeenCalledWith(expect.objectContaining({ type: 'warning', title: 'Notifications are blocked' })));
    expect(window.localStorage.getItem(CHOICE)).toBe('off');
    expect(view.container).toBeEmptyDOMElement();
  });

  it('goes away for good on "Not now", without asking the browser', () => {
    const view = render(<DesktopAlertsPrompt />);
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(view.container).toBeEmptyDOMElement();
    expect(window.localStorage.getItem(PROMPT)).toBe('seen');
    expect(FakeNotification.requestPermission).not.toHaveBeenCalled();
    view.unmount();
    expect(render(<DesktopAlertsPrompt />).container).toBeEmptyDOMElement();
  });

  it('stays hidden where there is nothing to be alerted about or nowhere to alert', () => {
    inboxEnabled = false;
    expect(render(<DesktopAlertsPrompt />).container).toBeEmptyDOMElement();
    inboxEnabled = true;
    FakeNotification.permission = 'denied';
    expect(render(<DesktopAlertsPrompt />).container).toBeEmptyDOMElement();
    vi.stubGlobal('Notification', undefined);
    delete (window as { Notification?: unknown }).Notification;
    expect(render(<DesktopAlertsPrompt />).container).toBeEmptyDOMElement();
  });
});

describe('DesktopAlertsSwitch', () => {
  it('turns on through the browser prompt and off with one click, remembering the choice', async () => {
    render(<DesktopAlertsSwitch />);
    const toggle = screen.getByRole('switch', { name: 'Desktop alerts' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(toggle).toHaveAccessibleDescription(/Get notified when this tab is in the background/);
    fireEvent.click(toggle);
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Desktop alerts' })).toHaveAttribute('aria-checked', 'true'));
    expect(screen.getByRole('switch')).toHaveAccessibleDescription(/On\./);
    fireEvent.click(screen.getByRole('switch'));
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
    expect(window.localStorage.getItem(CHOICE)).toBe('off');
    // Permission is still granted, so turning it back on needs no second browser prompt.
    fireEvent.click(screen.getByRole('switch'));
    await waitFor(() => expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true'));
    expect(FakeNotification.requestPermission).toHaveBeenCalledTimes(1);
  });

  it('shows the way out when the browser blocks notifications, with no switch to fight', () => {
    FakeNotification.permission = 'denied';
    render(<DesktopAlertsSwitch />);
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    expect(screen.getByText(/Blocked in this browser/)).toBeInTheDocument();
  });

  it('renders nothing in a browser without notifications', () => {
    vi.stubGlobal('Notification', undefined);
    delete (window as { Notification?: unknown }).Notification;
    expect(render(<DesktopAlertsSwitch />).container).toBeEmptyDOMElement();
  });
});
