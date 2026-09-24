import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from '@/App';
import { ApiRequestError } from '@/lib/api';
import type { TaskResolution } from '@/types';

const useBootstrapStateMock = vi.fn();
const useAuthMock = vi.fn();
const dashboardLayoutSpy = vi.fn();
const useTaskResolutionMock = vi.fn();

vi.mock('@/hooks/useBootstrapState', () => ({
  useBootstrapState: () => useBootstrapStateMock(),
}));

vi.mock('@/hooks/useTasks', () => ({
  useTaskResolution: (key: string | undefined) => useTaskResolutionMock(key),
}));

vi.mock('@/context/AuthContext', () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useAuth: () => useAuthMock(),
  useAuthScopeKey: () => 'test-workspace:test-user:manager:',
}));

vi.mock('@/components/layout/DashboardLayout', () => ({
  DashboardLayout: (props: {
    onViewChange?: (view: 'team') => void;
    filterState?: { activeFilter: string };
    onFilterStateChange?: (state: {
      activeFilter: string;
      activeDeveloper?: string;
      selectedTagId?: number;
      noTagsFilter: boolean;
    }) => void;
  }) => {
    dashboardLayoutSpy(props);

    return (
      <div>
        <div>Work loaded</div>
        <div>Work filter: {props.filterState?.activeFilter ?? 'missing'}</div>
        <button
          onClick={() => props.onFilterStateChange?.({
            activeFilter: 'blocked',
            activeDeveloper: 'dev-1',
            selectedTagId: 2,
            noTagsFilter: false,
          })}
        >
          Apply dashboard filter
        </button>
        <button onClick={() => props.onViewChange?.('team')}>Open Team</button>
      </div>
    );
  },
}));

vi.mock('@/components/layout/Header', () => ({
  Header: ({ onViewChange }: { onViewChange?: (view: 'work') => void }) => (
    <div>
      <div>Shared header</div>
      {onViewChange && <button onClick={() => onViewChange('work')}>Open Work</button>}
    </div>
  ),
}));

vi.mock('@/components/today/TodayPage', () => ({
  TodayPage: ({ onViewChange }: { onViewChange: (view: 'work') => void }) => (
    <div>
      <div>Today loaded</div>
      <button onClick={() => onViewChange('work')}>Open Work from Today</button>
    </div>
  ),
}));

vi.mock('@/components/team-tracker/TeamTrackerPage', () => ({
  TeamTrackerPage: () => <div>Team loaded</div>,
}));

vi.mock('@/components/setup/SetupWizard', () => ({
  SetupWizard: () => <div>Setup wizard</div>,
}));

vi.mock('@/components/my-day/MyDayPage', () => ({
  MyDayPage: () => <div>My day loaded</div>,
}));

vi.mock('@/components/my-day/LoginPage', () => ({
  LoginPage: ({ role }: { role?: 'manager' | 'developer' }) => <div>{role === 'manager' ? 'Manager login' : 'Developer login'}</div>,
}));

vi.mock('@/components/manager-desk', () => ({
  ManagerDeskPage: () => <div>Desk loaded</div>,
}));

vi.mock('@/components/manager-memory', () => ({
  ManagerMemoryPage: ({ mode }: { mode: 'follow-ups' | 'meetings' }) => <div>{mode === 'follow-ups' ? 'Follow-ups loaded' : 'Meetings loaded'}</div>,
}));

vi.mock('@/components/notes/NotesPage', () => ({
  NotesPage: ({ date }: { date: string }) => <div>Notes loaded {date}</div>,
}));

vi.mock('@/components/settings/SettingsPanel', () => ({
  SettingsPage: () => <div>Settings loaded</div>,
}));

describe('App', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.pushState(null, '', '/');

    useBootstrapStateMock.mockReturnValue({
      data: { bootstrapOpen: false, userCount: 1 },
      isLoading: false,
      refetch: vi.fn(),
    });

    useAuthMock.mockReturnValue({
      user: null,
      isLoading: false,
      isAuthenticated: false,
      login: vi.fn(),
      logout: vi.fn(),
      refreshSession: vi.fn(),
    });

    useTaskResolutionMock.mockReturnValue({ data: undefined, isLoading: true, isError: false, error: null });
  });

  it('shows loading while bootstrap state is loading', () => {
    useBootstrapStateMock.mockReturnValue({
      data: undefined,
      isLoading: true,
      refetch: vi.fn(),
    });

    render(<App />);
    expect(screen.getByRole('status', { name: 'Loading workspace' })).toBeInTheDocument();
    expect(screen.queryByText('Loading…')).not.toBeInTheDocument();
  });

  it('renders setup wizard when bootstrap registration is still open', async () => {
    useBootstrapStateMock.mockReturnValue({
      data: { bootstrapOpen: true, userCount: 0 },
      isLoading: false,
      refetch: vi.fn(),
    });

    render(<App />);
    expect(await screen.findByText('Setup wizard')).toBeInTheDocument();
  });

  it('renders manager login on / when bootstrap is closed and the user is unauthenticated', async () => {
    render(<App />);
    expect(await screen.findByText('Manager login')).toBeInTheDocument();
  });

  it('renders developer login on /my-day when bootstrap is closed and the user is unauthenticated', async () => {
    window.history.pushState(null, '', '/my-day');
    render(<App />);
    expect(await screen.findByText('Developer login')).toBeInTheDocument();
  });

  it('redirects authenticated developers from / to /my-day', async () => {
    useAuthMock.mockReturnValue({
      user: { role: 'developer', developerAccountId: 'dev-1' },
      isLoading: false,
      isAuthenticated: true,
      login: vi.fn(),
      logout: vi.fn(),
      refreshSession: vi.fn(),
    });

    render(<App />);

    await waitFor(() => {
      expect(window.location.pathname).toBe('/my-day');
    });
  });

  it('redirects authenticated managers from /my-day to /', async () => {
    window.history.pushState(null, '', '/my-day');
    useAuthMock.mockReturnValue({
      user: { role: 'manager' },
      isLoading: false,
      isAuthenticated: true,
      login: vi.fn(),
      logout: vi.fn(),
      refreshSession: vi.fn(),
    });

    render(<App />);

    expect(await screen.findByText('Today loaded')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/');
  });

  it('renders Today for an authenticated manager without waiting for bootstrap or config', async () => {
    useAuthMock.mockReturnValue({
      user: { role: 'manager' },
      isLoading: false,
      isAuthenticated: true,
      login: vi.fn(),
      logout: vi.fn(),
      refreshSession: vi.fn(),
    });
    useBootstrapStateMock.mockReturnValue({
      data: undefined,
      isLoading: true,
      refetch: vi.fn(),
    });

    render(<App />);
    expect(await screen.findByText('Today loaded')).toBeInTheDocument();
  });

  it('renders the dedicated settings page for authenticated managers on /settings', async () => {
    window.history.pushState(null, '', '/settings');
    useAuthMock.mockReturnValue({
      user: { role: 'manager' },
      isLoading: false,
      isAuthenticated: true,
      login: vi.fn(),
      logout: vi.fn(),
      refreshSession: vi.fn(),
    });

    render(<App />);

    expect(await screen.findByText('Shared header')).toBeInTheDocument();
    expect(screen.getByText('Settings loaded')).toBeInTheDocument();
  });

  it('renders the Work page for authenticated managers on /work', async () => {
    window.history.pushState(null, '', '/work');
    useAuthMock.mockReturnValue({
      user: { role: 'manager' },
      isLoading: false,
      isAuthenticated: true,
      login: vi.fn(),
      logout: vi.fn(),
      refreshSession: vi.fn(),
    });

    render(<App />);

    expect(await screen.findByText('Work loaded')).toBeInTheDocument();
  });

  it('keeps legacy team and desk URLs working for authenticated managers', async () => {
    useAuthMock.mockReturnValue({
      user: { role: 'manager' },
      isLoading: false,
      isAuthenticated: true,
      login: vi.fn(),
      logout: vi.fn(),
      refreshSession: vi.fn(),
    });

    window.history.pushState(null, '', '/team-tracker');
    const { unmount } = render(<App />);
    expect(await screen.findByText('Team loaded')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/team');
    unmount();

    window.history.pushState(null, '', '/manager-desk');
    render(<App />);
    expect(await screen.findByText('Desk loaded')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/desk');
  });

  it('renders follow-ups and meetings as manager memory routes', async () => {
    useAuthMock.mockReturnValue({
      user: { role: 'manager' },
      isLoading: false,
      isAuthenticated: true,
      login: vi.fn(),
      logout: vi.fn(),
      refreshSession: vi.fn(),
    });

    window.history.pushState(null, '', '/follow-ups');
    const { unmount } = render(<App />);
    expect(await screen.findByText('Follow-ups loaded')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/follow-ups');
    unmount();

    window.history.pushState(null, '', '/meeting');
    render(<App />);
    expect(await screen.findByText('Meetings loaded')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/meetings');
  });

  it('renders the Notes workspace for authenticated managers on /notes', async () => {
    window.history.pushState(null, '', '/notes?date=2026-09-12');
    useAuthMock.mockReturnValue({
      user: { role: 'manager' },
      isLoading: false,
      isAuthenticated: true,
      login: vi.fn(),
      logout: vi.fn(),
      refreshSession: vi.fn(),
    });

    render(<App />);

    expect(await screen.findByText(/Notes loaded 2026-09-12/)).toBeInTheDocument();
    expect(window.location.pathname).toBe('/notes');
  });

  it('falls back to today for an invalid notes date', async () => {
    window.history.pushState(null, '', '/notes?date=not-a-date');
    useAuthMock.mockReturnValue({
      user: { role: 'manager' },
      isLoading: false,
      isAuthenticated: true,
      login: vi.fn(),
      logout: vi.fn(),
      refreshSession: vi.fn(),
    });

    render(<App />);

    const today = new Date();
    const expected = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    expect(await screen.findByText(new RegExp(`Notes loaded ${expected}`))).toBeInTheDocument();
  });

  it('restores the notes date on browser back/forward', async () => {
    useAuthMock.mockReturnValue({
      user: { role: 'manager' },
      isLoading: false,
      isAuthenticated: true,
      login: vi.fn(),
      logout: vi.fn(),
      refreshSession: vi.fn(),
    });

    window.history.pushState(null, '', '/notes?date=2026-09-10');
    render(<App />);
    expect(await screen.findByText(/Notes loaded 2026-09-10/)).toBeInTheDocument();

    act(() => {
      window.history.pushState(null, '', '/notes?date=2026-09-11');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });

    expect(await screen.findByText(/Notes loaded 2026-09-11/)).toBeInTheDocument();
  });

  it('redirects developers away from /notes', async () => {
    window.history.pushState(null, '', '/notes');
    useAuthMock.mockReturnValue({
      user: { role: 'developer', developerAccountId: 'dev-1' },
      isLoading: false,
      isAuthenticated: true,
      login: vi.fn(),
      logout: vi.fn(),
      refreshSession: vi.fn(),
    });

    render(<App />);

    await waitFor(() => {
      expect(window.location.pathname).toBe('/my-day');
    });
    expect(screen.queryByText(/Notes loaded/)).not.toBeInTheDocument();
  });

  it('renders a not-found state for unknown manager routes without rewriting the URL', async () => {
    window.history.pushState(null, '', '/does-not-exist');
    useAuthMock.mockReturnValue({
      user: { role: 'manager' },
      isLoading: false,
      isAuthenticated: true,
      login: vi.fn(),
      logout: vi.fn(),
      refreshSession: vi.fn(),
    });

    render(<App />);

    expect(await screen.findByRole('heading', { name: /workspace not found/i })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/does-not-exist');
  });

  it('preserves work filters when switching away and back without refreshing', async () => {
    window.history.pushState(null, '', '/work');
    useAuthMock.mockReturnValue({
      user: { role: 'manager' },
      isLoading: false,
      isAuthenticated: true,
      login: vi.fn(),
      logout: vi.fn(),
      refreshSession: vi.fn(),
    });

    render(<App />);

    expect(await screen.findByText('Work filter: all')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Apply dashboard filter'));
    expect(screen.getByText('Work filter: blocked')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Open Team'));
    await waitFor(() => {
      expect(window.location.pathname).toBe('/team');
    });

    fireEvent.click(screen.getByText('Open Work'));
    expect(await screen.findByText('Work filter: blocked')).toBeInTheDocument();
  });

  it('redirects /t/:key to the team view with ?task= for delegated tasks', async () => {
    window.history.pushState(null, '', '/t/T-5');
    useAuthMock.mockReturnValue({
      user: { role: 'manager' },
      isLoading: false,
      isAuthenticated: true,
      login: vi.fn(),
      logout: vi.fn(),
      refreshSession: vi.fn(),
    });
    useTaskResolutionMock.mockReturnValue({
      data: {
        taskKey: 'T-5',
        requestedKey: 'T-5',
        title: 'Fix login bug',
        kind: 'delegated',
        trackerItemId: 10,
        managerDeskItemId: 110,
        developer: { accountId: 'dev-2', displayName: 'Bob Jones', isActive: true },
        date: '2026-03-07',
        deleted: false,
      } satisfies TaskResolution,
      isLoading: false,
      isError: false,
      error: null,
    });

    render(<App />);

    await waitFor(() => {
      expect(window.location.pathname).toBe('/team');
      expect(window.location.search).toContain('task=T-5');
    });
    expect(await screen.findByText('Team loaded')).toBeInTheDocument();
  });

  it('redirects /t/:key to the desk with date and task params for desk-only tasks', async () => {
    window.history.pushState(null, '', '/t/T-9');
    useAuthMock.mockReturnValue({
      user: { role: 'manager' },
      isLoading: false,
      isAuthenticated: true,
      login: vi.fn(),
      logout: vi.fn(),
      refreshSession: vi.fn(),
    });
    useTaskResolutionMock.mockReturnValue({
      data: {
        taskKey: 'T-9',
        requestedKey: 'T-9',
        title: 'Renew vendor contract',
        kind: 'desk_only',
        managerDeskItemId: 42,
        date: '2026-03-08',
        deleted: false,
      } satisfies TaskResolution,
      isLoading: false,
      isError: false,
      error: null,
    });

    render(<App />);

    await waitFor(() => {
      expect(window.location.pathname).toBe('/desk');
      expect(window.location.search).toContain('date=2026-03-08');
      expect(window.location.search).toContain('task=T-9');
    });
    expect(await screen.findByText('Desk loaded')).toBeInTheDocument();
  });

  it('redirects /t/:key to /my-day?task= for developers', async () => {
    window.history.pushState(null, '', '/t/T-5');
    useAuthMock.mockReturnValue({
      user: { role: 'developer', developerAccountId: 'dev-1' },
      isLoading: false,
      isAuthenticated: true,
      login: vi.fn(),
      logout: vi.fn(),
      refreshSession: vi.fn(),
    });
    useTaskResolutionMock.mockReturnValue({
      data: {
        taskKey: 'T-5',
        requestedKey: 'T-5',
        title: 'Fix login bug',
        kind: 'tracker_only',
        trackerItemId: 10,
        developer: { accountId: 'dev-1', displayName: 'Alice Smith', isActive: true },
        date: '2026-03-07',
        deleted: false,
      } satisfies TaskResolution,
      isLoading: false,
      isError: false,
      error: null,
    });

    render(<App />);

    await waitFor(() => {
      expect(window.location.pathname).toBe('/my-day');
      expect(window.location.search).toContain('task=T-5');
    });
  });

  it('renders the deleted-task state when /t/:key resolves to a tombstone', async () => {
    window.history.pushState(null, '', '/t/T-7');
    useAuthMock.mockReturnValue({
      user: { role: 'manager' },
      isLoading: false,
      isAuthenticated: true,
      login: vi.fn(),
      logout: vi.fn(),
      refreshSession: vi.fn(),
    });
    useTaskResolutionMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new ApiRequestError('Task deleted', 410, {
        taskKey: 'T-7',
        requestedKey: 'T-7',
        title: 'Old migration task',
        kind: 'tracker_only',
        date: '2026-03-01',
        deleted: true,
      }),
    });

    render(<App />);

    expect(await screen.findByRole('heading', { name: /t-7 was deleted/i })).toBeInTheDocument();
    expect(screen.getByText('Old migration task')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/t/T-7');
  });

  it('renders the not-found state for unknown task keys', async () => {
    window.history.pushState(null, '', '/t/T-77');
    useAuthMock.mockReturnValue({
      user: { role: 'manager' },
      isLoading: false,
      isAuthenticated: true,
      login: vi.fn(),
      logout: vi.fn(),
      refreshSession: vi.fn(),
    });
    useTaskResolutionMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new ApiRequestError('Not found', 404, { error: 'Unknown task' }),
    });

    render(<App />);

    expect(await screen.findByRole('heading', { name: /workspace not found/i })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/t/T-77');
  });
});
