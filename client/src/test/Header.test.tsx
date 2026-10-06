import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Header } from '@/components/layout/Header';
import { QuickActionsProvider } from '@/context/QuickActionsContext';

const useThemeMock = vi.fn();
const useAuthMock = vi.fn();
const useSyncStatusMock = vi.fn();
const useTriggerSyncMock = vi.fn();
const useNavPreferencesMock = vi.fn();
const useNavAvailabilityMock = vi.fn();

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

vi.mock('@/hooks/useNavAvailability', () => ({
  useNavAvailability: () => useNavAvailabilityMock(),
}));

vi.mock('@/components/capture/GlobalCaptureDialog', () => ({
  GlobalCaptureDialog: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="global-capture-dialog">
      <button onClick={onClose}>close-capture</button>
    </div>
  ),
}));

vi.mock('@/components/actions/ManagerActionInbox', () => ({
  ManagerActionInbox: ({ updatesOnly }: { updatesOnly?: boolean }) => <div data-testid="manager-action-inbox" data-updates-only={String(Boolean(updatesOnly))}>Action Inbox</div>,
}));

vi.mock('@/components/layout/TodayCountLink', () => ({
  TodayCountBadge: ({ hidden }: { hidden?: boolean }) => <span data-testid="today-count-badge" style={{ opacity: hidden ? 0 : 1 }}>14</span>,
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
      preferences: { topNav: ['work', 'team', 'desk'], moreNav: ['notes'], hidden: [] },
    });
    useNavAvailabilityMock.mockReturnValue({ team: true, work: true });
  });

  it('keeps settings out of the main navigation while exposing the top-right gear for managers', () => {
    render(<Header activeView="today" onViewChange={vi.fn()} />);

    expect(screen.getByText('Today')).toBeInTheDocument();
    expect(screen.getByText('Work')).toBeInTheDocument();
    expect(screen.getByText('Team')).toBeInTheDocument();
    expect(screen.getByText('Desk')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /open today in new tab/i })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Work' })).toHaveAttribute('href', '/work');
    expect(screen.getByRole('link', { name: 'Work' })).not.toHaveAttribute('target');
    expect(screen.getByRole('link', { name: 'Team' })).toHaveAttribute('href', '/team');
    expect(screen.getByRole('link', { name: 'Desk' })).toHaveAttribute('href', '/desk');

    fireEvent.click(screen.getByRole('button', { name: /more/i }));

    expect(screen.getByText('Notes')).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Notes' })).toHaveAttribute('href', '/notes');
    // docs/57 P3-06: Follow-ups and Meetings are Tasks views, not pages.
    expect(screen.queryByText('Follow-ups')).not.toBeInTheDocument();
    expect(screen.queryByText('Meetings')).not.toBeInTheDocument();
    expect(screen.queryByText('My Day')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /open settings/i })).toBeInTheDocument();
    expect(screen.queryByText('Settings')).not.toBeInTheDocument();
  });

  it('uses native destination links on active and inactive workspaces', () => {
    render(<Header activeView="team" onViewChange={vi.fn()} />);

    expect(screen.getByRole('link', { name: /^Today/ })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: 'Team' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Desk' })).toHaveAttribute('href', '/desk');

    fireEvent.click(screen.getByRole('button', { name: /more/i }));
    expect(screen.getByRole('menuitem', { name: 'Notes' })).toHaveAttribute('href', '/notes');
  });

  it('navigates ordinary link clicks and leaves modified clicks to the browser', () => {
    const navigate = vi.fn();
    render(<Header activeView="today" onViewChange={navigate} />);
    const work = screen.getByRole('link', { name: 'Work' });
    fireEvent.click(work); expect(navigate).toHaveBeenCalledWith('work');
    navigate.mockClear();
    const modified = new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true, button: 0 });
    work.dispatchEvent(modified);
    expect(modified.defaultPrevented).toBe(false); expect(navigate).not.toHaveBeenCalled();
    expect(screen.queryByLabelText(/in new tab/)).not.toBeInTheDocument();
  });

  it('renders a customized layout with promoted pages and reordered chips', () => {
    useNavPreferencesMock.mockReturnValue({
      preferences: { topNav: ['notes', 'work', 'team'], moreNav: ['desk'] },
    });
    render(<Header activeView="notes" onViewChange={vi.fn()} />);

    const nav = screen.getByRole('navigation', { name: 'Workspace navigation' });
    expect(nav.textContent).toContain('Notes');
    const notesIndex = nav.textContent?.indexOf('Notes') ?? -1;
    const workIndex = nav.textContent?.indexOf('Work') ?? -1;
    expect(notesIndex).toBeGreaterThan(-1);
    expect(notesIndex).toBeLessThan(workIndex);

    fireEvent.click(screen.getByRole('button', { name: /more/i }));
    expect(screen.getByRole('menuitem', { name: 'Desk' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Notes' })).not.toBeInTheDocument();
  });

  it('moves demoted pages into the More menu and hides More when empty', () => {
    useNavPreferencesMock.mockReturnValue({
      preferences: { topNav: ['notes'], moreNav: ['work', 'team', 'desk'] },
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
      preferences: { topNav: ['work', 'team', 'desk', 'notes'], moreNav: [] },
    });
    render(<Header activeView="today" onViewChange={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /more/i })).not.toBeInTheDocument();
    expect(screen.getByText('Notes')).toBeInTheDocument();
  });

  describe('solo defaults and hidden pages (docs/56 P2-04)', () => {
    const navText = () => screen.getByRole('navigation', { name: 'Workspace navigation' }).textContent ?? '';

    it('a solo manager sees Today, Tasks and Notes: Team and Work are held back until they have something to show', () => {
      useNavPreferencesMock.mockReturnValue({
        preferences: { topNav: ['tasks', 'team', 'work', 'notes'], moreNav: [], hidden: [] },
      });
      useNavAvailabilityMock.mockReturnValue({ team: false, work: false });
      render(<Header activeView="today" onViewChange={vi.fn()} />);

      expect(navText()).toContain('Today');
      expect(navText()).toContain('Tasks');
      expect(navText()).toContain('Notes');
      expect(navText()).not.toContain('Team');
      expect(navText()).not.toContain('Work');
      expect(screen.queryByRole('button', { name: /more/i })).not.toBeInTheDocument();
    });

    it('keeps the final order Today | Tasks | Team | Work | Notes once both exist', () => {
      useNavPreferencesMock.mockReturnValue({
        preferences: { topNav: ['tasks', 'team', 'work', 'notes'], moreNav: [], hidden: [] },
      });
      render(<Header activeView="today" onViewChange={vi.fn()} />);
      const text = navText();
      const positions = ['Today', 'Tasks', 'Team', 'Work', 'Notes'].map((label) => text.indexOf(label));
      expect(positions.every((position) => position >= 0)).toBe(true);
      expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    });

    it('holds back Team alone when Jira is connected but nobody is on the roster, and Work alone the other way', () => {
      useNavPreferencesMock.mockReturnValue({
        preferences: { topNav: ['tasks', 'team', 'work', 'notes'], moreNav: [], hidden: [] },
      });
      useNavAvailabilityMock.mockReturnValue({ team: false, work: true });
      const { unmount } = render(<Header activeView="today" onViewChange={vi.fn()} />);
      expect(navText()).toContain('Work');
      expect(navText()).not.toContain('Team');
      unmount();

      useNavAvailabilityMock.mockReturnValue({ team: true, work: false });
      render(<Header activeView="today" onViewChange={vi.fn()} />);
      expect(navText()).toContain('Team');
      expect(navText()).not.toContain('Work');
    });

    it('a held-back page is also left out of the More menu, and More disappears when nothing is left', () => {
      useNavPreferencesMock.mockReturnValue({
        preferences: { topNav: ['tasks'], moreNav: ['team', 'work'], hidden: ['notes'] },
      });
      useNavAvailabilityMock.mockReturnValue({ team: false, work: false });
      render(<Header activeView="today" onViewChange={vi.fn()} />);
      expect(screen.queryByRole('button', { name: /more/i })).not.toBeInTheDocument();
    });

    it('leaves hidden pages out of the header entirely', () => {
      useNavPreferencesMock.mockReturnValue({
        preferences: { topNav: ['tasks', 'team'], moreNav: ['work'], hidden: ['notes'] },
      });
      render(<Header activeView="today" onViewChange={vi.fn()} />);
      expect(navText()).not.toContain('Notes');
      fireEvent.click(screen.getByRole('button', { name: /more/i }));
      expect(screen.getByRole('menuitem', { name: 'Work' })).toBeInTheDocument();
      expect(screen.queryByRole('menuitem', { name: 'Notes' })).not.toBeInTheDocument();
    });

    it('a saved layout that predates hidden pages still renders', () => {
      useNavPreferencesMock.mockReturnValue({ preferences: { topNav: ['work', 'desk'], moreNav: ['team', 'notes'] } });
      render(<Header activeView="today" onViewChange={vi.fn()} />);
      expect(navText()).toContain('Work');
    });

    it('does not affect what a developer sees', () => {
      useAuthMock.mockReturnValue({ user: { role: 'developer' } });
      useNavAvailabilityMock.mockReturnValue({ team: false, work: false });
      render(<Header activeView="today" onViewChange={vi.fn()} />);
      expect(navText()).toContain('Work');
      expect(navText()).toContain('Team');
      expect(screen.queryByRole('button', { name: 'Keyboard shortcuts' })).not.toBeInTheDocument();
    });
  });

  it('keeps the fixed Work and Team layout for non-manager users', () => {
    useAuthMock.mockReturnValue({ user: { role: 'developer' } });
    useNavPreferencesMock.mockReturnValue({
      preferences: { topNav: ['notes'], moreNav: ['work', 'team', 'desk'] },
    });
    render(<Header activeView="today" onViewChange={vi.fn()} />);

    const nav = screen.getByRole('navigation', { name: 'Workspace navigation' });
    expect(nav.textContent).toContain('Work');
    expect(nav.textContent).toContain('Team');
    expect(nav.textContent).not.toContain('Notes');
    expect(screen.queryByRole('button', { name: /more/i })).not.toBeInTheDocument();
  });

  it('opens the secondary workspace menu explicitly and supports Escape focus return', () => {
    render(<Header activeView="work" onViewChange={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /more/i }));

    expect(screen.getByText('Notes')).toBeInTheDocument();
  });

  it('the workspace menu supports arrow navigation and Escape restores its trigger', async () => {
    render(<Header activeView="work" onViewChange={vi.fn()} />);
    const more = screen.getByRole('button', { name: /more/i });
    more.focus(); fireEvent.click(more);
    const menu = screen.getByRole('menu', { name: 'More workspaces' });
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Notes' }));
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    fireEvent.keyDown(menu, { key: 'Escape' });
    await waitFor(() => expect(document.activeElement).toBe(more));
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('points to Today with a count off Today, and never re-lists the queue (UX-30)', () => {
    const { rerender } = render(
      <Header activeView="work" onViewChange={vi.fn()} />
    );
    expect(screen.getByTestId('today-count-badge')).toBeInTheDocument();
    // Solo: there are no task updates, so no inbox at all.
    expect(screen.queryByTestId('manager-action-inbox')).not.toBeInTheDocument();

    rerender(<Header activeView="team" onViewChange={vi.fn()} />);
    expect(screen.getByTestId('today-count-badge')).toBeInTheDocument();

    // On `/` Today is the page itself.
    rerender(<Header activeView="today" onViewChange={vi.fn()} />);
    expect(screen.getByTestId('today-count-badge')).toHaveStyle({ opacity: 0 });
  });

  it('shows the updates-only inbox on every page in collaborative mode (UX-30)', () => {
    useAuthMock.mockReturnValue({ user: { role: 'manager' }, features: { tasksPhase3: true, teamMode: 'collab' } });
    const { rerender } = render(<Header activeView="work" onViewChange={vi.fn()} />);
    expect(screen.getByTestId('manager-action-inbox')).toHaveAttribute('data-updates-only', 'true');
    rerender(<Header activeView="notes" onViewChange={vi.fn()} />);
    expect(screen.getByTestId('manager-action-inbox')).toHaveAttribute('data-updates-only', 'true');
  });

  it('shows only the durable inbox on Today in collaborative mode', () => {
    useAuthMock.mockReturnValue({ user: { role: 'manager' }, features: { tasksPhase3: true, teamMode: 'collab' } });
    render(<Header activeView="today" onViewChange={vi.fn()} />);
    expect(screen.getByTestId('manager-action-inbox')).toBeInTheDocument();
  });

  it('shows the capture button on all manager views including desk', () => {
    const views = ['today', 'work', 'team', 'desk', 'notes'] as const;

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

  it('keeps one shape on every page: no subtitle and no Jira sync controls, even on Work (UX-18)', () => {
    useSyncStatusMock.mockReturnValue({
      data: { status: 'idle', lastSyncedAt: '2026-09-08T09:00:00.000Z', autoSyncEnabled: false, jiraConfigured: true },
    });
    for (const view of ['today', 'work', 'team'] as const) {
      const { unmount } = render(<Header activeView={view} onViewChange={vi.fn()} />);
      expect(screen.queryByText('People, work, risks, and planning')).not.toBeInTheDocument();
      expect(screen.queryByText('Sync off')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /manual sync/i })).not.toBeInTheDocument();
      unmount();
    }
  });

  it('exposes manager help at phone widths and passes its opener to the app', () => {
    const openKeyboardShortcuts = vi.fn();
    render(<QuickActionsProvider value={{ openCapture: vi.fn(), openCommandPalette: vi.fn(), openKeyboardShortcuts, keyboardShortcutsOpen: true }}>
      <Header activeView="notes" onViewChange={vi.fn()} />
    </QuickActionsProvider>);
    const button = screen.getByRole('button', { name: 'Keyboard shortcuts' });
    expect(button.className).not.toMatch(/hidden|md:/);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(button);
    expect(openKeyboardShortcuts).toHaveBeenCalledWith(button);
  });

});
