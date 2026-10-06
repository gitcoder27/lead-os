import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import App, { legacyTaskViewRedirect } from '@/App';
import { api, ApiRequestError } from '@/lib/api';
import type { TaskResolution, TeamTrackerBoardQuery } from '@/types';

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

const weeklyReviewPropsSpy = vi.fn();

vi.mock('@/components/review/WeeklyReviewMode', () => ({
  WeeklyReviewMode: (props: { week?: string; onExit: () => void; onWeekChange: (week?: string) => void }) => {
    weeklyReviewPropsSpy(props);
    return (
      <div>
        <div>Review loaded {props.week ?? 'auto'}</div>
        <button onClick={props.onExit}>Exit review</button>
        <button onClick={() => props.onWeekChange('2026-10-05')}>Switch week</button>
      </div>
    );
  },
}));

vi.mock('@/components/team-tracker/TeamTrackerPage', () => ({
  TeamTrackerPage: (props: { initialDeveloperAccountId?: string; initialTaskKey?: string; standupMode?: boolean }) => {
    teamTrackerPropsSpy(props);
    return <div data-testid={props.standupMode ? 'standup-mode' : undefined}>Team loaded</div>;
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
  TaskDrawer: (props: { taskKey: string | null; onClose: () => void }) => {
    taskDrawerPropsSpy(props);
    return props.taskKey ? <div role="dialog" aria-label={`Task ${props.taskKey}`}>drawer<button onClick={props.onClose}>Close task drawer</button></div> : null;
  },
  navigateToTaskPage: vi.fn(),
}));

vi.mock('@/components/settings/SettingsPanel', () => ({
  SettingsPage: () => <div>Settings loaded</div>,
}));

describe('App', () => {
  beforeAll(async () => {
    // Keep the real developer page, but load its dependencies before UI assertions.
    // A cold import under parallel load can exceed findBy's one-second wait.
    await import('@/components/my-day/MyDayPage');
  });

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

  it('offers retry after an initial bootstrap failure instead of loading forever', () => {
    const refetch = vi.fn();
    useBootstrapStateMock.mockReturnValue({ data: undefined, isLoading: false, isError: true, refetch });
    render(<App />);
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load setup');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalledOnce();
    expect(screen.queryByText('Setup wizard')).not.toBeInTheDocument();
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

  it.each(['pending', 'error', 'absent'])('opens an authenticated developer day with %s bootstrap data', async (state) => {
    window.history.replaceState(null, '', '/my-day');
    useAuthMock.mockReturnValue({ user: { role: 'developer', accountId: 'dev-1', developerAccountId: 'dev-1' }, isLoading: false, isAuthenticated: true });
    useBootstrapStateMock.mockReturnValue({ data: undefined, isLoading: state === 'pending', isError: state === 'error', refetch: vi.fn() });
    const dayRead = vi.spyOn(api, 'get').mockResolvedValue({
      date: '2026-10-03', viewMode: 'live', developer: { accountId: 'dev-1', displayName: 'Developer', isActive: true },
      status: 'on_track', availability: { state: 'available', writeAllowed: true }, isReadOnly: false,
      plannedItems: [], completedItems: [], droppedItems: [], checkIns: [], isStale: false,
    });
    const view = render(<App />);
    try {
      expect(await screen.findByText('Nothing planned yet')).toBeInTheDocument();
      expect(screen.queryByText('Could not load setup. Check your connection and retry.')).not.toBeInTheDocument();
      expect(screen.queryByRole('status', { name: 'Loading workspace' })).not.toBeInTheDocument();
    } finally { view.unmount(); dayRead.mockRestore(); }
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

  describe('WQ-04 Team URL sorting', () => {
    beforeEach(() => {
      useAuthMock.mockReturnValue({ user: { role: 'manager' }, isLoading: false, isAuthenticated: true });
    });

    const teamProps = () => teamTrackerPropsSpy.mock.calls.at(-1)![0] as {
      initialBoardQuery: TeamTrackerBoardQuery;
      urlBoardQuery: TeamTrackerBoardQuery;
      urlBoardQueryNonce: number;
      onBoardQueryChange: (query: TeamTrackerBoardQuery) => void;
      oneOnOnePanel?: string;
      oneOnOneDeveloperId?: string;
      initialDeveloperAccountId?: string;
      initialTaskKey?: string;
    };

    it.each([
      ['', undefined, undefined],
      ['?sort=attention', 'attention', undefined],
      ['?view=12&sort=name&group=none&filter=all', 'name', 12],
      ['?view=13&sort=attention', 'attention', 13],
      ['?view=12', undefined, 12],
    ])('keeps the Team sort and saved-view inheritance on reload of /team%s', async (search, sortBy, viewId) => {
      window.history.pushState(null, '', `/team${search}`);
      const first = render(<App />);
      await screen.findByText('Team loaded');
      expect(teamProps().initialBoardQuery).toEqual(expect.objectContaining({ sortBy, viewId }));
      const initial = teamProps().initialBoardQuery;
      act(() => teamProps().onBoardQueryChange(initial));
      await new Promise((resolve) => window.setTimeout(resolve, 250));
      expect(new URLSearchParams(window.location.search).get('sort')).toBe(sortBy ?? null);
      first.unmount();
      render(<App />);
      await screen.findByText('Team loaded');
      expect(teamProps().initialBoardQuery).toEqual(initial);
    });

    it('debounces query updates and restores Back/Forward with panel and drawer parameters', async () => {
      window.history.pushState(null, '', '/team?q=release&filter=blocked&sort=name&group=status&view=12&panel=one-on-one&dev=dev-7&task=T-5');
      render(<App />);
      await screen.findByText('Team loaded');
      const initial = teamProps().initialBoardQuery;
      const length = window.history.length;
      act(() => teamProps().onBoardQueryChange({ ...initial, sortBy: 'attention', groupBy: 'none', summaryFilter: 'all' }));
      expect(new URLSearchParams(window.location.search).get('sort')).toBe('name');
      await waitFor(() => expect(new URLSearchParams(window.location.search).get('sort')).toBe('attention'));
      expect(window.history.length).toBe(length);
      const updatedUrl = window.location.pathname + window.location.search;
      expect(Object.fromEntries(new URLSearchParams(window.location.search))).toEqual({
        q: 'release', filter: 'all', sort: 'attention', group: 'none', view: '12',
        panel: 'one-on-one', dev: 'dev-7', task: 'T-5',
      });

      act(() => {
        window.history.pushState(null, '', '/team?sort=blocked_first&dev=dev-2');
        window.dispatchEvent(new PopStateEvent('popstate'));
      });
      await waitFor(() => expect(teamProps().urlBoardQuery.sortBy).toBe('blocked_first'));
      expect(teamProps().initialDeveloperAccountId).toBe('dev-2');
      act(() => window.history.back());
      await waitFor(() => expect(teamProps().urlBoardQuery.sortBy).toBe('attention'));
      expect(window.location.pathname + window.location.search).toBe(updatedUrl);
      expect(teamProps()).toEqual(expect.objectContaining({ oneOnOnePanel: 'one-on-one', oneOnOneDeveloperId: 'dev-7', initialTaskKey: 'T-5' }));
      act(() => window.history.forward());
      await waitFor(() => expect(teamProps().urlBoardQuery.sortBy).toBe('blocked_first'));
      expect(new URLSearchParams(window.location.search).get('dev')).toBe('dev-2');
      expect(teamProps().urlBoardQueryNonce).toBeGreaterThan(1);
    });
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

  describe('weekly review (docs/59 §5.1)', () => {
    const manager = (tasksPhase3 = true) => useAuthMock.mockReturnValue({
      user: { role: 'manager' },
      features: { tasksPhase3 },
      isLoading: false,
      isAuthenticated: true,
      login: vi.fn(),
      logout: vi.fn(),
      refreshSession: vi.fn(),
    });

    it('opens the review from /?mode=review in place of Today, and leaves it for /', async () => {
      window.history.pushState(null, '', '/?mode=review');
      manager();
      render(<App />);
      expect(await screen.findByText('Review loaded auto')).toBeInTheDocument();
      expect(screen.queryByText('Today loaded')).not.toBeInTheDocument();

      fireEvent.click(screen.getByText('Exit review'));
      expect(await screen.findByText('Today loaded')).toBeInTheDocument();
      expect(window.location.pathname).toBe('/');
      expect(window.location.search).toBe('');
    });

    it('keeps the week in the URL and switches it in place', async () => {
      window.history.pushState(null, '', '/?mode=review&week=2026-09-28');
      manager();
      render(<App />);
      expect(await screen.findByText('Review loaded 2026-09-28')).toBeInTheDocument();
      const historyLength = window.history.length;

      fireEvent.click(screen.getByText('Switch week'));
      expect(await screen.findByText('Review loaded 2026-10-05')).toBeInTheDocument();
      expect(window.location.search).toContain('week=2026-10-05');
      expect(window.history.length).toBe(historyLength);
    });

    it('ignores an invalid week and stays on Today without the Tasks workspace', async () => {
      window.history.pushState(null, '', '/?mode=review&week=soon');
      manager();
      const { unmount } = render(<App />);
      expect(await screen.findByText('Review loaded auto')).toBeInTheDocument();
      unmount();

      window.history.pushState(null, '', '/?mode=review');
      manager(false);
      render(<App />);
      expect(await screen.findByText('Today loaded')).toBeInTheDocument();
    });
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
    expect(taskDrawerPropsSpy).not.toHaveBeenCalled();
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

  it.each([{ ctrlKey: true }, { metaKey: true }])('opens quick capture over standup with %j+I', async (modifier) => {
    window.history.pushState(null, '', '/team?mode=standup');
    useAuthMock.mockReturnValue({
      user: { username: 'manager', displayName: 'Manager', role: 'manager', workspaceId: 'default' },
      isLoading: false,
      isAuthenticated: true,
    });
    render(<App />);
    await screen.findByTestId('standup-mode');

    const event = new KeyboardEvent('keydown', { key: 'i', ...modifier, bubbles: true, cancelable: true });
    fireEvent(window, event);
    expect(event.defaultPrevented).toBe(true);
    expect(await screen.findByRole('dialog', { name: 'Quick capture' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close capture' }));
    expect(screen.queryByRole('dialog', { name: 'Quick capture' })).not.toBeInTheDocument();
    expect(screen.getByTestId('standup-mode')).toBeInTheDocument();
    expect(window.location.pathname + window.location.search).toBe('/team?mode=standup');
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
    fireEvent.click(screen.getByRole('button', { name: 'Close task drawer' }));
    expect(screen.queryByRole('dialog', { name: 'Task T-5' })).not.toBeInTheDocument();
    expect(taskDrawerPropsSpy).toHaveBeenLastCalledWith(expect.objectContaining({ taskKey: null }));
    act(() => onOpenTodayTarget({ type: 'tracker_item', view: 'team', taskKey: 'T-6', trackerItemId: 11 }));
    expect(await screen.findByRole('dialog', { name: 'Task T-6' })).toBeInTheDocument();
  });
});
