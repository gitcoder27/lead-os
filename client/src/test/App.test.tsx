import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import App, { legacyTaskViewRedirect } from '@/App';
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

const todayPagePropsSpy = vi.fn();
const teamTrackerPropsSpy = vi.fn();

vi.mock('@/components/today/TodayPage', () => ({
  TodayPage: (props: {
    onViewChange: (view: 'work') => void;
    onOpenTodayTarget?: (target: import('@/types').TodayActionTarget) => void;
  }) => {
    todayPagePropsSpy(props);
    return (
      <div>
        <div>Today loaded</div>
        <button onClick={() => props.onViewChange('work')}>Open Work from Today</button>
      </div>
    );
  },
}));

vi.mock('@/components/team-tracker/TeamTrackerPage', () => ({
  TeamTrackerPage: (props: { initialDeveloperAccountId?: string; initialTaskKey?: string }) => {
    teamTrackerPropsSpy(props);
    return <div>Team loaded</div>;
  },
}));

vi.mock('@/components/setup/SetupWizard', () => ({
  SetupWizard: ({ onComplete }: { onComplete: () => Promise<void> | void }) => (
    <div>
      Setup wizard
      <button type="button" onClick={() => void onComplete()}>Finish setup</button>
    </div>
  ),
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

vi.mock('@/components/notes/NotesPage', () => ({
  NotesPage: ({ date }: { date: string }) => <div>Notes loaded {date}</div>,
}));

vi.mock('@/components/tasks/TasksPage', () => ({
  TasksPage: () => <div>Tasks loaded</div>,
}));

vi.mock('@/components/tasks/TaskPage', () => ({
  TaskPage: () => <div>Task page loaded</div>,
}));

const taskDrawerPropsSpy = vi.fn();
vi.mock('@/components/tasks/TaskDrawer', () => ({
  TaskDrawer: (props: { taskKey: string | null }) => {
    taskDrawerPropsSpy(props);
    return props.taskKey ? <div role="dialog" aria-label={`Task ${props.taskKey}`}>drawer</div> : null;
  },
  navigateToTaskPage: vi.fn(),
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

  it('finishing setup lands on Today, not Work (docs/56 P2-02)', async () => {
    const closed = { data: { bootstrapOpen: false, userCount: 1 }, isLoading: false };
    const refetch = vi.fn(async () => {
      useBootstrapStateMock.mockReturnValue({ ...closed, refetch });
    });
    useBootstrapStateMock.mockReturnValue({ data: { bootstrapOpen: true, userCount: 0 }, isLoading: false, refetch });
    useAuthMock.mockReturnValue({
      user: { username: 'manager', displayName: 'Manager', role: 'manager', workspaceId: 'default' },
      isLoading: false,
      isAuthenticated: true,
      login: vi.fn(),
      logout: vi.fn(),
      refreshSession: vi.fn(),
    });

    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Finish setup' }));

    expect(await screen.findByText('Today loaded')).toBeInTheDocument();
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(window.location.pathname).toBe('/');
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

  describe('retired Follow-ups and Meetings routes (docs/57 P3-06)', () => {
    const asManager = (features: { tasksPhase3?: boolean } = { tasksPhase3: true }) =>
      useAuthMock.mockReturnValue({
        user: { role: 'manager' },
        features,
        isLoading: false,
        isAuthenticated: true,
        login: vi.fn(),
        logout: vi.fn(),
        refreshSession: vi.fn(),
      });

    it.each([
      ['/follow-ups', 'waiting'],
      ['/follow-ups/', 'waiting'],
      ['/followups', 'waiting'],
      ['/followups/', 'waiting'],
      ['/meetings', 'meetings'],
      ['/meetings/', 'meetings'],
      ['/meeting', 'meetings'],
      ['/meeting/', 'meetings'],
    ])('%s redirects to the %s view of Tasks', async (path, view) => {
      asManager();
      window.history.pushState(null, '', path);
      render(<App />);
      expect(await screen.findByText('Tasks loaded')).toBeInTheDocument();
      expect(window.location.pathname).toBe('/tasks');
      expect(new URLSearchParams(window.location.search).get('view')).toBe(view);
    });

    it.each([
      ['/follow-ups', '/tasks?view=waiting'],
      ['/meetings', '/tasks?view=meetings'],
      ['/tasks?view=waiting', '/tasks?view=waiting'],
    ])('a cold load of %s lands on %s once the session (and its Phase 3 flag) arrives', async (path, expected) => {
      const booting = { user: null, features: { tasksPhase3: false }, isLoading: true, isAuthenticated: false, login: vi.fn(), logout: vi.fn(), refreshSession: vi.fn() };
      useAuthMock.mockReturnValue(booting);
      window.history.pushState(null, '', path);
      const { rerender } = render(<App />);
      asManager();
      rerender(<App />);
      expect(await screen.findByText('Tasks loaded')).toBeInTheDocument();
      await waitFor(() => expect(window.location.pathname + window.location.search).toBe(expected));
    });

    it('keeps the rest of the query string and replaces history instead of adding to it', async () => {
      asManager();
      window.history.pushState(null, '', '/follow-ups?q=vendor&view=stale');
      const lengthBefore = window.history.length;
      render(<App />);
      expect(await screen.findByText('Tasks loaded')).toBeInTheDocument();
      expect(window.location.search).toBe('?q=vendor&view=waiting');
      expect(window.history.length).toBe(lengthBefore);
    });

    it('a workspace without Phase 3 lands on the desk instead of a missing page', async () => {
      asManager({ tasksPhase3: false });
      window.history.pushState(null, '', '/meetings');
      render(<App />);
      expect(await screen.findByText('Desk loaded')).toBeInTheDocument();
      expect(window.location.pathname).toBe('/desk');
    });

    it('redirects on back/forward navigation too', async () => {
      asManager();
      render(<App />);
      expect(await screen.findByText('Today loaded')).toBeInTheDocument();
      act(() => {
        window.history.pushState(null, '', '/follow-ups');
        window.dispatchEvent(new PopStateEvent('popstate'));
      });
      expect(await screen.findByText('Tasks loaded')).toBeInTheDocument();
      expect(window.location.pathname + window.location.search).toBe('/tasks?view=waiting');
    });

    it('opens the matching Tasks view for a stale follow-ups or meetings target', async () => {
      asManager();
      render(<App />);
      expect(await screen.findByText('Today loaded')).toBeInTheDocument();
      const open = todayPagePropsSpy.mock.calls.at(-1)?.[0]?.onOpenTodayTarget as (target: import('@/types').TodayActionTarget) => void;

      act(() => open({ type: 'view', view: 'follow-ups' }));
      expect(await screen.findByText('Tasks loaded')).toBeInTheDocument();
      expect(window.location.pathname + window.location.search).toBe('/tasks?view=waiting');

      act(() => open({ type: 'view', view: 'meetings' }));
      await waitFor(() => expect(window.location.search).toBe('?view=meetings'));
    });

    it('opens the Tasks view a Today row names, and the drawer when it also names a task', async () => {
      asManager();
      render(<App />);
      expect(await screen.findByText('Today loaded')).toBeInTheDocument();
      const open = todayPagePropsSpy.mock.calls.at(-1)?.[0]?.onOpenTodayTarget as (target: import('@/types').TodayActionTarget) => void;

      act(() => open({ type: 'view', view: 'tasks', taskView: 'inbox' }));
      await waitFor(() => expect(window.location.pathname + window.location.search).toBe('/tasks?view=inbox'));

      act(() => open({ type: 'follow_up', view: 'tasks', taskView: 'waiting', taskKey: 'T-9' }));
      expect(await screen.findByRole('dialog', { name: 'Task T-9' })).toBeInTheDocument();
      expect(window.location.search).toBe('?view=inbox');
    });
  });

  describe('legacyTaskViewRedirect', () => {
    it.each([
      ['/follow-ups', '', '/tasks?view=waiting'],
      ['/followups/', '', '/tasks?view=waiting'],
      ['/meetings', '?date=2026-09-30', '/tasks?date=2026-09-30&view=meetings'],
      ['/meeting/', '', '/tasks?view=meetings'],
      ['/follow-ups', '?view=meetings', '/tasks?view=waiting'],
    ])('%s%s → %s', (path, search, expected) => {
      expect(legacyTaskViewRedirect(path, search)).toBe(expected);
    });

    it.each(['/', '/tasks', '/desk', '/notes', '/follow-ups-archive', '/meetings/2026', '/t/T-5'])('leaves %s alone', (path) => {
      expect(legacyTaskViewRedirect(path, '?view=waiting')).toBeNull();
    });
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

  it('opens developer targets with ?dev= (not ?task=) while task context stays off the URL (docs/53 F2)', async () => {
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

    const onOpenTodayTarget = todayPagePropsSpy.mock.calls.at(-1)?.[0]?.onOpenTodayTarget as
      | ((target: import('@/types').TodayActionTarget) => void)
      | undefined;
    expect(onOpenTodayTarget).toBeDefined();

    act(() => {
      onOpenTodayTarget!({
        type: 'developer',
        view: 'team',
        developerAccountId: 'dev-1',
        context: { taskKey: 'T-5', trackerItemId: 10, issueKey: 'AM-1' },
      });
    });

    await waitFor(() => {
      expect(window.location.pathname).toBe('/team');
      expect(window.location.search).toContain('dev=dev-1');
    });
    expect(window.location.search).not.toContain('task=');
    expect(await screen.findByText('Team loaded')).toBeInTheDocument();
    expect(teamTrackerPropsSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({ initialDeveloperAccountId: 'dev-1', initialTaskKey: undefined }),
    );
  });

  it('opens Standup Mode from a Start standup target (docs/53 F7)', async () => {
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
    const onOpenTodayTarget = todayPagePropsSpy.mock.calls.at(-1)?.[0]?.onOpenTodayTarget as
      | ((target: import('@/types').TodayActionTarget) => void)
      | undefined;

    act(() => {
      onOpenTodayTarget!({ type: 'view', view: 'team', mode: 'standup', date: '2026-03-08' });
    });

    await waitFor(() => {
      expect(window.location.pathname).toBe('/team');
      expect(window.location.search).toContain('mode=standup');
    });
    expect(teamTrackerPropsSpy).toHaveBeenLastCalledWith(expect.objectContaining({ standupMode: true }));
  });

  it('restores the developer drawer target from /team?dev= on cold load (docs/53 F2)', async () => {
    window.history.pushState(null, '', '/team?dev=dev-7');
    useAuthMock.mockReturnValue({
      user: { role: 'manager' },
      isLoading: false,
      isAuthenticated: true,
      login: vi.fn(),
      logout: vi.fn(),
      refreshSession: vi.fn(),
    });

    render(<App />);

    expect(await screen.findByText('Team loaded')).toBeInTheDocument();
    expect(teamTrackerPropsSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({ initialDeveloperAccountId: 'dev-7' }),
    );
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

  it('opens task targets in the shared drawer over the current view (docs/54 J1)', async () => {
    useAuthMock.mockReturnValue({
      user: { role: 'manager' },
      features: { tasksPhase3: true },
      isLoading: false,
      isAuthenticated: true,
      login: vi.fn(),
      logout: vi.fn(),
      refreshSession: vi.fn(),
    });

    render(<App />);
    expect(await screen.findByText('Today loaded')).toBeInTheDocument();
    const onOpenTodayTarget = todayPagePropsSpy.mock.calls.at(-1)?.[0]?.onOpenTodayTarget as
      (target: import('@/types').TodayActionTarget) => void;

    act(() => {
      onOpenTodayTarget({ type: 'tracker_item', view: 'team', taskKey: 'T-5', trackerItemId: 10 });
    });

    expect(await screen.findByRole('dialog', { name: 'Task T-5' })).toBeInTheDocument();
    // Today keeps its place — no navigation to the owner's surface.
    expect(window.location.pathname).toBe('/');
    expect(screen.getByText('Today loaded')).toBeInTheDocument();
  });
});
