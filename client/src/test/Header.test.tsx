import { render, screen, fireEvent, act } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Header } from '@/components/layout/Header';
import { QuickActionsProvider } from '@/context/QuickActionsContext';

const useThemeMock = vi.fn();
const useAuthMock = vi.fn();
const useSyncStatusMock = vi.fn();
const useTriggerSyncMock = vi.fn();
const useNavPreferencesMock = vi.fn();

vi.mock('@/context/ThemeContext', () => ({
  useTheme: () => useThemeMock(),
}));

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => useAuthMock(),
}));

vi.mock('@/hooks/useSyncStatus', () => ({
  useSyncStatus: () => useSyncStatusMock(),
}));

vi.mock('@/hooks/useTriggerSync', () => ({
  useTriggerSync: () => useTriggerSyncMock(),
}));

vi.mock('@/hooks/useNavPreferences', () => ({
  useNavPreferences: () => useNavPreferencesMock(),
  useSaveNavPreferences: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('@/components/capture/GlobalCaptureDialog', () => ({
  GlobalCaptureDialog: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="global-capture-dialog">
      <button onClick={onClose}>close-capture</button>
    </div>
  ),
}));

vi.mock('@/components/actions/ManagerActionInbox', () => ({
  ManagerActionInbox: () => <div data-testid="manager-action-inbox">Action Inbox</div>,
}));

describe('Header', () => {
  const resizeObserverDisconnect = vi.fn();
  const resizeObserverObserve = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    resizeObserverDisconnect.mockReset();
    resizeObserverObserve.mockReset();
    document.documentElement.style.removeProperty('--app-header-height');
    globalThis.ResizeObserver = class {
      observe = resizeObserverObserve;
      disconnect = resizeObserverDisconnect;
    } as unknown as typeof ResizeObserver;
    useThemeMock.mockReturnValue({
      theme: 'dark',
      toggleTheme: vi.fn(),
    });
    useAuthMock.mockReturnValue({
      user: { role: 'manager' },
    });
    useSyncStatusMock.mockReturnValue({
      data: { status: 'idle', lastSyncedAt: null },
    });
    useTriggerSyncMock.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
    });
    useNavPreferencesMock.mockReturnValue({
      preferences: { topNav: ['work', 'team', 'desk'], moreNav: ['follow-ups', 'notes', 'meetings'] },
    });
  });

  it('keeps settings out of the main navigation while exposing the top-right gear for managers', () => {
    render(<Header activeView="today" onViewChange={vi.fn()} />);

    expect(screen.getByText('Today')).toBeInTheDocument();
    expect(screen.getByText('Work')).toBeInTheDocument();
    expect(screen.getByText('Team')).toBeInTheDocument();
    expect(screen.getByText('Desk')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /open today in new tab/i })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /open work in new tab/i })).toHaveAttribute('href', '/work');
    expect(screen.getByRole('link', { name: /open work in new tab/i })).toHaveAttribute('target', '_blank');
    expect(screen.getByRole('link', { name: /open team in new tab/i })).toHaveAttribute('href', '/team');
    expect(screen.getByRole('link', { name: /open desk in new tab/i })).toHaveAttribute('href', '/desk');

    fireEvent.click(screen.getByRole('button', { name: /more/i }));

    expect(screen.getByText('Follow-ups')).toBeInTheDocument();
    expect(screen.getByText('Notes')).toBeInTheDocument();
    expect(screen.getByText('Meetings')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /open follow-ups in new tab/i })).toHaveAttribute('href', '/follow-ups');
    expect(screen.getByRole('link', { name: /open notes in new tab/i })).toHaveAttribute('href', '/notes');
    expect(screen.getByRole('link', { name: /open meetings in new tab/i })).toHaveAttribute('href', '/meetings');
    expect(screen.queryByText('My Day')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /open settings/i })).toBeInTheDocument();
    expect(screen.queryByText('Settings')).not.toBeInTheDocument();
  });

  it('shows the Today new-tab action only when Today is inactive', () => {
    render(<Header activeView="team" onViewChange={vi.fn()} />);

    expect(screen.getByRole('link', { name: /open today in new tab/i })).toHaveAttribute('href', '/');
    expect(screen.queryByRole('link', { name: /open team in new tab/i })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /open desk in new tab/i })).toHaveAttribute('href', '/desk');

    fireEvent.click(screen.getByRole('button', { name: /more/i }));
    expect(screen.getByRole('link', { name: /open meetings in new tab/i })).toHaveAttribute('href', '/meetings');
  });

  it('renders a customized layout with promoted pages and reordered chips', () => {
    useNavPreferencesMock.mockReturnValue({
      preferences: { topNav: ['notes', 'work', 'team', 'desk'], moreNav: ['follow-ups', 'meetings'] },
    });
    render(<Header activeView="notes" onViewChange={vi.fn()} />);

    const nav = screen.getByRole('navigation', { name: 'Workspace navigation' });
    expect(nav.textContent).toContain('Notes');
    const notesIndex = nav.textContent?.indexOf('Notes') ?? -1;
    const workIndex = nav.textContent?.indexOf('Work') ?? -1;
    expect(notesIndex).toBeGreaterThan(-1);
    expect(notesIndex).toBeLessThan(workIndex);

    fireEvent.click(screen.getByRole('button', { name: /more/i }));
    expect(screen.getByRole('menuitem', { name: 'Follow-ups' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Meetings' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Notes' })).not.toBeInTheDocument();
  });

  it('moves demoted pages into the More menu and hides More when empty', () => {
    useNavPreferencesMock.mockReturnValue({
      preferences: { topNav: ['notes'], moreNav: ['work', 'team', 'desk', 'follow-ups', 'meetings'] },
    });
    const { unmount } = render(<Header activeView="today" onViewChange={vi.fn()} />);

    const nav = screen.getByRole('navigation', { name: 'Workspace navigation' });
    expect(nav.textContent).not.toContain('Work');
    expect(nav.textContent).not.toContain('Desk');

    fireEvent.click(screen.getByRole('button', { name: /more/i }));
    expect(screen.getByRole('menuitem', { name: 'Work' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Desk' })).toBeInTheDocument();
    unmount();

    useNavPreferencesMock.mockReturnValue({
      preferences: { topNav: ['work', 'team', 'desk', 'follow-ups', 'notes', 'meetings'], moreNav: [] },
    });
    render(<Header activeView="today" onViewChange={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /more/i })).not.toBeInTheDocument();
    expect(screen.getByText('Meetings')).toBeInTheDocument();
  });

  it('keeps the fixed Work and Team layout for non-manager users', () => {
    useAuthMock.mockReturnValue({ user: { role: 'developer' } });
    useNavPreferencesMock.mockReturnValue({
      preferences: { topNav: ['notes', 'meetings'], moreNav: ['work', 'team', 'desk', 'follow-ups'] },
    });
    render(<Header activeView="today" onViewChange={vi.fn()} />);

    const nav = screen.getByRole('navigation', { name: 'Workspace navigation' });
    expect(nav.textContent).toContain('Work');
    expect(nav.textContent).toContain('Team');
    expect(nav.textContent).not.toContain('Notes');
    expect(screen.queryByRole('button', { name: /more/i })).not.toBeInTheDocument();
  });

  it('opens the secondary workspace menu on hover', () => {
    render(<Header activeView="work" onViewChange={vi.fn()} />);

    fireEvent.mouseEnter(screen.getByRole('button', { name: /more/i }).parentElement as HTMLElement);

    expect(screen.getByText('Follow-ups')).toBeInTheDocument();
    expect(screen.getByText('Meetings')).toBeInTheDocument();
  });

  it('shows the manager action inbox across manager views', () => {
    const { rerender } = render(
      <Header activeView="work" onViewChange={vi.fn()} />
    );

    expect(screen.getByTestId('manager-action-inbox')).toBeInTheDocument();

    rerender(<Header activeView="team" onViewChange={vi.fn()} />);

    expect(screen.getByTestId('manager-action-inbox')).toBeInTheDocument();
  });

  it('shows the capture button on all manager views including desk', () => {
    const views = ['today', 'work', 'team', 'desk', 'follow-ups', 'meetings'] as const;

    for (const view of views) {
      const { unmount } = render(<Header activeView={view} onViewChange={vi.fn()} />);
      expect(screen.getByText('Capture')).toBeInTheDocument();
      unmount();
    }
  });

  it('opens the global capture dialog when clicking capture', () => {
    const openCapture = vi.fn();
    render(
      <QuickActionsProvider value={{ openCapture, openCommandPalette: vi.fn() }}>
        <Header activeView="today" onViewChange={vi.fn()} />
      </QuickActionsProvider>,
    );

    expect(screen.queryByTestId('global-capture-dialog')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Capture'));
    expect(openCapture).toHaveBeenCalledWith(expect.objectContaining({ defaultTarget: 'manager-desk' }));
  });

  it('opens the command palette from the search button', () => {
    const openCommandPalette = vi.fn();
    render(
      <QuickActionsProvider value={{ openCapture: vi.fn(), openCommandPalette }}>
        <Header activeView="today" onViewChange={vi.fn()} />
      </QuickActionsProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Open command palette' }));
    expect(openCommandPalette).toHaveBeenCalledTimes(1);
  });

  it('hides the capture button for non-manager users', () => {
    useAuthMock.mockReturnValue({ user: { role: 'developer' } });
    render(<Header activeView="today" onViewChange={vi.fn()} />);

    expect(screen.queryByText('Capture')).not.toBeInTheDocument();
  });

  it('publishes the measured header height for shell-aligned drawers and clears it on unmount', () => {
    const { unmount } = render(<Header activeView="team" onViewChange={vi.fn()} />);

    expect(document.documentElement.style.getPropertyValue('--app-header-height')).toBe('0px');
    expect(resizeObserverObserve).toHaveBeenCalledTimes(1);

    unmount();

    expect(resizeObserverDisconnect).toHaveBeenCalledTimes(1);
    expect(document.documentElement.style.getPropertyValue('--app-header-height')).toBe('');
  });

  it('shows the last sync time while Jira auto-sync is enabled', () => {
    useSyncStatusMock.mockReturnValue({
      data: { status: 'idle', lastSyncedAt: '2026-09-08T09:00:00.000Z', autoSyncEnabled: true },
    });
    render(<Header activeView="work" onViewChange={vi.fn()} />);

    expect(screen.getByText(/Synced/)).toBeInTheDocument();
  });

  it('shows the sync-off state instead of the last sync time when auto-sync is disabled', () => {
    useSyncStatusMock.mockReturnValue({
      data: { status: 'idle', lastSyncedAt: '2026-09-08T09:00:00.000Z', autoSyncEnabled: false },
    });
    render(<Header activeView="work" onViewChange={vi.fn()} />);

    expect(screen.getByText('Sync off')).toBeInTheDocument();
    expect(screen.queryByText(/Synced/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /manual sync/i })).toBeEnabled();
  });

  it('still surfaces a sync error when auto-sync is disabled', () => {
    useSyncStatusMock.mockReturnValue({
      data: { status: 'error', errorMessage: 'Jira authentication failed (401)', autoSyncEnabled: false },
    });
    render(<Header activeView="work" onViewChange={vi.fn()} />);

    expect(screen.getByText('Sync issue')).toBeInTheDocument();
    expect(screen.queryByText('Sync off')).not.toBeInTheDocument();
    expect(screen.getByTitle(/Jira authentication failed \(401\)/)).toBeInTheDocument();
  });

  it('advances the relative sync label over time without new sync data', () => {
    vi.useFakeTimers();
    try {
      const syncedAt = new Date(Date.now() - 60_000).toISOString();
      useSyncStatusMock.mockReturnValue({
        data: { status: 'idle', lastSyncedAt: syncedAt, autoSyncEnabled: true },
      });

      render(<Header activeView="work" onViewChange={vi.fn()} />);
      expect(screen.getByText('Synced 1 minute ago')).toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(61_000);
      });

      expect(screen.getByText('Synced 2 minutes ago')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});
