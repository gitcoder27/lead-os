import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ThemeProvider } from '@/context/ThemeContext';
import { ToastProvider, useToast } from '@/context/ToastContext';
import { AuthProvider, useAuth, useAuthScopeKey } from '@/context/AuthContext';
import { QuickActionsProvider, type QuickActionsValue } from '@/context/QuickActionsContext';
import { AssistantProvider } from '@/context/AssistantContext';
import { useBootstrapState } from '@/hooks/useBootstrapState';
import { useSyncRefreshCoordinator } from '@/hooks/useSyncRefreshCoordinator';
import { TodayPage } from '@/components/today/TodayPage';
import { GlobalCaptureDialog, type GlobalCaptureContext } from '@/components/capture/GlobalCaptureDialog';
import { CommandPalette } from '@/components/palette/CommandPalette';
import { DEFAULT_DASHBOARD_FILTER_STATE, type DashboardFilterState } from '@/components/layout/dashboard-state';
import {
  dashboardFilterStateFromParams,
  dashboardFilterStateToParams,
  deskDateFromParams,
  isValidIsoDate,
  notesDateFromParams,
  taskKeyFromParams,
  teamBoardQueryFromParams,
  teamBoardQueryToParams,
  teamModeFromParams,
} from '@/lib/view-params';
import {
  taskViewParamsFromState,
  taskViewStateFromParams,
  type TaskViewUrlState,
} from '@/lib/task-views';
import { navigateToTaskPage } from '@/lib/task-nav';
import { getLocalIsoDate } from '@/lib/utils';
import { Header } from '@/components/layout/Header';
import { TaskLinkResolver } from '@/components/tasks/TaskLinkResolver';
import type { TaskResolution, TeamTrackerBoardQuery, TodayActionTarget } from '@/types';

export type CanonicalAppView = 'today' | 'work' | 'team' | 'desk' | 'follow-ups' | 'meetings' | 'notes' | 'my-day' | 'settings';
export type LegacyAppView = 'dashboard' | 'team-tracker' | 'manager-desk';
export type AppView = CanonicalAppView | LegacyAppView;
export type ActiveAppView = AppView | 'not-found' | 'task';
type ResolvedAppView = CanonicalAppView | 'not-found' | 'task';

const TASK_LINK_PATH_PATTERN = /^\/t\/([Tt]-\d{1,9})\/?$/;

const loadTeamTrackerPage = () => import('@/components/team-tracker/TeamTrackerPage');
const loadDashboardLayout = () => import('@/components/layout/DashboardLayout');
const loadSetupWizard = () => import('@/components/setup/SetupWizard');
const loadMyDayPage = () => import('@/components/my-day/MyDayPage');
const loadLoginPage = () => import('@/components/my-day/LoginPage');
const loadManagerDeskPage = () => import('@/components/manager-desk');
const loadTasksPage = () => import('@/components/tasks/TasksPage');
const loadTaskPage = () => import('@/components/tasks/TaskPage');
const loadManagerMemoryPage = () => import('@/components/manager-memory');
const loadNotesPage = () => import('@/components/notes/NotesPage');
const loadSettingsPage = () => import('@/components/settings/SettingsPanel');
const loadAssistantDock = () => import('@/components/assistant/AssistantDock');

const TeamTrackerPage = lazy(async () => {
  const module = await loadTeamTrackerPage();
  return { default: module.TeamTrackerPage };
});

const DashboardLayout = lazy(async () => {
  const module = await loadDashboardLayout();
  return { default: module.DashboardLayout };
});

const SetupWizard = lazy(async () => {
  const module = await loadSetupWizard();
  return { default: module.SetupWizard };
});

const MyDayPage = lazy(async () => {
  const module = await loadMyDayPage();
  return { default: module.MyDayPage };
});

const LoginPage = lazy(async () => {
  const module = await loadLoginPage();
  return { default: module.LoginPage };
});

const ManagerDeskPage = lazy(async () => {
  const module = await loadManagerDeskPage();
  return { default: module.ManagerDeskPage };
});

const TasksPage = lazy(async () => {
  const module = await loadTasksPage();
  return { default: module.TasksPage };
});

const TaskPage = lazy(async () => {
  const module = await loadTaskPage();
  return { default: module.TaskPage };
});

const ManagerMemoryPage = lazy(async () => {
  const module = await loadManagerMemoryPage();
  return { default: module.ManagerMemoryPage };
});

const NotesPage = lazy(async () => {
  const module = await loadNotesPage();
  return { default: module.NotesPage };
});

const SettingsPage = lazy(async () => {
  const module = await loadSettingsPage();
  return { default: module.SettingsPage };
});

const AssistantDock = lazy(async () => {
  const module = await loadAssistantDock();
  return { default: module.AssistantDock };
});

function canonicalizeView(view: AppView): CanonicalAppView {
  if (view === 'dashboard') return 'work';
  if (view === 'team-tracker') return 'team';
  if (view === 'manager-desk') return 'desk';
  return view;
}

function pathToView(pathname: string): ResolvedAppView {
  if (TASK_LINK_PATH_PATTERN.test(pathname)) return 'task';
  if (pathname === '/my-day' || pathname === '/my-day/') return 'my-day';
  if (pathname === '/team' || pathname === '/team/' || pathname === '/team-tracker' || pathname === '/team-tracker/') return 'team';
  // P3-D1: `/tasks` is the Phase 3 name; `/desk`/`/manager-desk` normalize to
  // whichever path the workspace flag names canonical.
  if (pathname === '/tasks' || pathname === '/tasks/' || pathname === '/desk' || pathname === '/desk/' || pathname === '/manager-desk' || pathname === '/manager-desk/') return 'desk';
  if (pathname === '/follow-ups' || pathname === '/follow-ups/' || pathname === '/followups' || pathname === '/followups/') return 'follow-ups';
  if (pathname === '/meetings' || pathname === '/meetings/' || pathname === '/meeting' || pathname === '/meeting/') return 'meetings';
  if (pathname === '/notes' || pathname === '/notes/') return 'notes';
  if (pathname === '/work' || pathname === '/work/' || pathname === '/dashboard' || pathname === '/dashboard/') return 'work';
  if (pathname === '/today' || pathname === '/today/' || pathname === '/' || pathname === '') return 'today';
  if (pathname === '/settings' || pathname === '/settings/') return 'settings';
  return 'not-found';
}

// P3-D1: the canonical desk path is flag-scoped — `/tasks` when Phase 3 is
// on, `/desk` otherwise. `AppShell` syncs this once per render, before any
// event handler can navigate.
let tasksNavEnabled = false;
function setTasksNavEnabled(enabled: boolean) {
  tasksNavEnabled = enabled;
}

function viewToPath(view: AppView): string {
  const canonicalView = canonicalizeView(view);

  if (canonicalView === 'my-day') return '/my-day';
  if (canonicalView === 'team') return '/team';
  if (canonicalView === 'desk') return tasksNavEnabled ? '/tasks' : '/desk';
  if (canonicalView === 'follow-ups') return '/follow-ups';
  if (canonicalView === 'meetings') return '/meetings';
  if (canonicalView === 'notes') return '/notes';
  if (canonicalView === 'work') return '/work';
  if (canonicalView === 'settings') return '/settings';
  return '/';
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 10_000,
    },
  },
});

function preloadView(view: AppView) {
  switch (canonicalizeView(view)) {
    case 'team':
      void loadTeamTrackerPage();
      break;
    case 'my-day':
      void loadMyDayPage();
      break;
    case 'desk':
      void loadManagerDeskPage();
      void loadTasksPage();
      break;
    case 'follow-ups':
    case 'meetings':
      void loadManagerMemoryPage();
      break;
    case 'notes':
      void loadNotesPage();
      break;
    case 'settings':
      void loadSettingsPage();
      break;
    case 'work':
      void loadDashboardLayout();
      break;
    default:
      break;
  }
}

function AuthSessionBoundary({ children }: { children: ReactNode }) {
  const authScopeKey = useAuthScopeKey();
  const { clearToasts } = useToast();
  const previousAuthScopeKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (previousAuthScopeKeyRef.current === null) {
      previousAuthScopeKeyRef.current = authScopeKey;
      return;
    }

    if (previousAuthScopeKeyRef.current !== authScopeKey) {
      clearToasts();
      previousAuthScopeKeyRef.current = authScopeKey;
    }
  }, [authScopeKey, clearToasts]);

  return <>{children}</>;
}

type ViewParams = Record<string, string | undefined>;

interface NavigateOptions {
  replace?: boolean;
  params?: ViewParams;
}

function buildSearchFromParams(params?: ViewParams): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value !== undefined && value !== '') {
      search.set(key, value);
    }
  }
  const queryString = search.toString();
  return queryString ? `?${queryString}` : '';
}

function buildViewTarget(view: AppView, params?: ViewParams): string {
  return `${viewToPath(view)}${buildSearchFromParams(params)}`;
}

function sameLocation(target: string): boolean {
  const [targetPath, targetSearch = ''] = target.split('?');
  return window.location.pathname === targetPath && window.location.search === (targetSearch ? `?${targetSearch}` : '');
}

function navigateToView(view: AppView, options: NavigateOptions = {}) {
  const target = buildViewTarget(view, options.params);
  if (sameLocation(target)) {
    return;
  }

  if (options.replace) {
    window.history.replaceState(null, '', target);
  } else {
    window.history.pushState(null, '', target);
  }
}

function replaceLegacyPathIfNeeded() {
  const currentView = pathToView(window.location.pathname);
  if (currentView === 'not-found' || currentView === 'task') {
    return;
  }
  const canonicalPath = viewToPath(currentView);
  if (window.location.pathname !== canonicalPath) {
    window.history.replaceState(null, '', `${canonicalPath}${window.location.search}`);
  }
}

function FullPageLoading() {
  return (
    <div className="h-full flex items-center justify-center" style={{ background: 'var(--bg-primary)' }}>
      <div className="flex flex-col items-center gap-3">
        <div
          className="w-8 h-8 border-2 border-t-transparent rounded-full animate-spin"
          style={{ borderColor: 'var(--accent)', borderTopColor: 'transparent' }}
        />
        <span className="text-[13px]" style={{ color: 'var(--text-secondary)' }}>Loading…</span>
      </div>
    </div>
  );
}

function TodayBootLoading() {
  return (
    <div className="flex h-full flex-col overflow-hidden px-1 pb-0.5 pt-0.5 md:px-1.5 md:pb-1" role="status" aria-label="Loading workspace">
      <span className="sr-only">Loading workspace</span>
      <div
        aria-hidden="true"
        className="mb-1.5 flex min-h-[64px] shrink-0 items-center justify-between rounded-[14px] border px-3"
        style={{ borderColor: 'var(--border-strong)', background: 'var(--bg-primary)' }}
      >
        <div className="flex items-center gap-3">
          <div className="h-11 w-11 animate-pulse rounded-[14px] motion-reduce:animate-none" style={{ background: 'var(--accent-glow)' }} />
          <div>
            <div className="h-4 w-20 animate-pulse rounded-sm motion-reduce:animate-none" style={{ background: 'var(--bg-tertiary)' }} />
            <div className="mt-2 h-3 w-40 animate-pulse rounded-sm motion-reduce:animate-none" style={{ background: 'var(--bg-tertiary)' }} />
          </div>
        </div>
        <div className="hidden items-center gap-2 md:flex">
          {[0, 1, 2, 3].map((item) => (
            <div key={item} className="h-8 w-20 animate-pulse rounded-lg motion-reduce:animate-none" style={{ background: 'var(--bg-tertiary)' }} />
          ))}
        </div>
      </div>
      <div
        aria-hidden="true"
        className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[16px] border"
        style={{ borderColor: 'var(--border-strong)', background: 'var(--bg-primary)' }}
      >
        <div className="grid shrink-0 gap-2 border-b px-3 py-3 md:grid-cols-[190px_repeat(4,minmax(0,1fr))]" style={{ borderColor: 'var(--border)' }}>
          {[0, 1, 2, 3, 4].map((item) => (
            <div key={item} className="min-h-[56px] rounded-lg px-3 py-2" style={{ background: 'var(--bg-secondary)' }}>
              <div className="h-4 w-20 animate-pulse rounded-sm motion-reduce:animate-none" style={{ background: 'var(--bg-tertiary)' }} />
              <div className="mt-2 h-3 w-28 animate-pulse rounded-sm motion-reduce:animate-none" style={{ background: 'var(--bg-tertiary)' }} />
            </div>
          ))}
        </div>
        <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1.08fr)_minmax(360px,0.92fr)]">
          <div className="border-b px-6 py-6 lg:border-b-0 lg:border-r" style={{ borderColor: 'var(--border)' }}>
            <div className="h-5 w-32 animate-pulse rounded-sm motion-reduce:animate-none" style={{ background: 'var(--bg-tertiary)' }} />
            <div className="mt-5 space-y-3">
              {[0, 1, 2, 3, 4].map((item) => (
                <div key={item} className="h-12 animate-pulse rounded-md motion-reduce:animate-none" style={{ background: 'var(--bg-secondary)' }} />
              ))}
            </div>
          </div>
          <div className="px-6 py-6">
            <div className="h-5 w-28 animate-pulse rounded-sm motion-reduce:animate-none" style={{ background: 'var(--bg-tertiary)' }} />
            <div className="mt-5 space-y-3">
              {[0, 1, 2, 3].map((item) => (
                <div key={item} className="h-10 animate-pulse rounded-md motion-reduce:animate-none" style={{ background: 'var(--bg-secondary)' }} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function PanelLoading() {
  return (
    <div className="h-full flex items-center justify-center" style={{ background: 'transparent' }}>
      <div className="flex flex-col items-center gap-3">
        <div
          className="w-8 h-8 border-2 border-t-transparent rounded-full animate-spin"
          style={{ borderColor: 'var(--accent)', borderTopColor: 'transparent' }}
        />
        <span className="text-[13px]" style={{ color: 'var(--text-secondary)' }}>Loading…</span>
      </div>
    </div>
  );
}

function NotFoundState({ onGoToday }: { onGoToday: () => void }) {
  return (
    <main className="flex min-h-0 flex-1 items-center justify-center px-4" style={{ background: 'var(--bg-canvas)' }}>
      <section
        className="w-full max-w-xl rounded-[18px] border px-6 py-8 text-center"
        style={{
          borderColor: 'var(--border-strong)',
          background: 'color-mix(in srgb, var(--bg-primary) 94%, transparent)',
        }}
      >
        <p className="text-[12px] font-semibold uppercase" style={{ color: 'var(--text-muted)' }}>
          404
        </p>
        <h1 className="mt-2 text-[24px] font-semibold" style={{ color: 'var(--text-primary)' }}>
          Workspace not found
        </h1>
        <p className="mt-3 text-[14px] leading-6" style={{ color: 'var(--text-secondary)' }}>
          This LeadOS route does not match a known workspace.
        </p>
        <button
          type="button"
          onClick={onGoToday}
          className="mt-6 rounded-lg px-4 py-2.5 text-[13px] font-semibold"
          style={{ background: 'var(--accent)', color: '#fff' }}
        >
          Go to Today
        </button>
      </section>
    </main>
  );
}

interface WorkspaceShellProps {
  activeView: ActiveAppView;
  onViewChange: (view: AppView) => void;
  onOpenActionTarget?: (target: TodayActionTarget) => void;
  children: ReactNode;
}

function WorkspaceShell({ activeView, onViewChange, onOpenActionTarget, children }: WorkspaceShellProps) {
  return (
    <div className="h-full flex flex-col overflow-hidden" style={{ background: 'transparent' }}>
      <Header activeView={activeView} onViewChange={onViewChange} onOpenActionTarget={onOpenActionTarget} />
      <div className="flex-1 min-h-0 px-1 pb-0.5 md:px-1.5 md:pb-1">
        <div
          className="h-full min-h-0 rounded-[16px] border overflow-hidden flex flex-col"
          style={{
            borderColor: 'var(--border-strong)',
            background: 'color-mix(in srgb, var(--bg-primary) 84%, transparent)',
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.03)',
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

function AppContent() {
  const { user, features, isLoading: authLoading, isAuthenticated } = useAuth();
  const bootstrapQuery = useBootstrapState();
  const bootstrapState = bootstrapQuery.data;
  const isAuthenticatedManager = isAuthenticated && user?.role === 'manager';
  const isBootstrapPending = !isAuthenticatedManager && (bootstrapQuery.isLoading || !bootstrapState);

  // P3-D1: sync the flag-scoped canonical desk path before any navigation runs.
  setTasksNavEnabled(Boolean(features?.tasksPhase3));

  const [activeView, setActiveView] = useState<ResolvedAppView>(() => pathToView(window.location.pathname));
  const [dashboardFilterState, setDashboardFilterState] = useState<DashboardFilterState>(() =>
    pathToView(window.location.pathname) === 'work'
      ? dashboardFilterStateFromParams(new URLSearchParams(window.location.search))
      : DEFAULT_DASHBOARD_FILTER_STATE,
  );
  const [teamBoardQuery, setTeamBoardQuery] = useState<TeamTrackerBoardQuery | undefined>(() =>
    pathToView(window.location.pathname) === 'team'
      ? teamBoardQueryFromParams(new URLSearchParams(window.location.search))
      : undefined,
  );
  const [teamBoardQueryNonce, setTeamBoardQueryNonce] = useState(0);
  // Phase 3 (P3-D5): `/team?mode=standup`.
  const [teamMode, setTeamMode] = useState<'standup' | undefined>(() =>
    pathToView(window.location.pathname) === 'team'
      ? teamModeFromParams(new URLSearchParams(window.location.search))
      : undefined,
  );
  // Phase 3 (P3-D1): `/tasks` URL state — selected view + overrides.
  const [tasksUrlState, setTasksUrlState] = useState<TaskViewUrlState | undefined>(() =>
    pathToView(window.location.pathname) === 'desk'
      ? taskViewStateFromParams(new URLSearchParams(window.location.search))
      : undefined,
  );
  const [tasksUrlNonce, setTasksUrlNonce] = useState(0);
  const [deskDateParam, setDeskDateParam] = useState<string | undefined>(() =>
    pathToView(window.location.pathname) === 'desk'
      ? deskDateFromParams(new URLSearchParams(window.location.search))
      : undefined,
  );
  const [notesDate, setNotesDate] = useState<string>(() =>
    pathToView(window.location.pathname) === 'notes'
      ? notesDateFromParams(new URLSearchParams(window.location.search)) ?? getLocalIsoDate()
      : getLocalIsoDate(),
  );
  const [todayWorkTarget, setTodayWorkTarget] = useState<{ issueKey?: string; nonce: number }>({ nonce: 0 });
  const [todayTeamTarget, setTodayTeamTarget] = useState<{ developerAccountId?: string; trackerItemId?: number; managerDeskItemId?: number; taskKey?: string; nonce: number }>(() => ({
    taskKey:
      pathToView(window.location.pathname) === 'team'
        ? taskKeyFromParams(new URLSearchParams(window.location.search))
        : undefined,
    nonce: 0,
  }));
  const [settingsSectionTarget, setSettingsSectionTarget] = useState<{ section?: string; nonce: number }>({ nonce: 0 });
  const [todayDeskTarget, setTodayDeskTarget] = useState<{ itemId?: number; date?: string; taskKey?: string; nonce: number }>(() => ({
    itemId: undefined,
    date:
      pathToView(window.location.pathname) === 'desk'
        ? deskDateFromParams(new URLSearchParams(window.location.search))
        : undefined,
    taskKey:
      pathToView(window.location.pathname) === 'desk'
        ? taskKeyFromParams(new URLSearchParams(window.location.search))
        : undefined,
    nonce: 0,
  }));
  const [captureOpen, setCaptureOpen] = useState(false);
  const [captureContext, setCaptureContext] = useState<GlobalCaptureContext>({});
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);

  useSyncRefreshCoordinator({ enabled: isAuthenticatedManager && activeView !== 'today' });

  const clearTodayTargets = useCallback(() => {
    setTodayWorkTarget((prev) => ({ nonce: prev.nonce + 1 }));
    setTodayTeamTarget((prev) => ({ nonce: prev.nonce + 1 }));
    setTodayDeskTarget((prev) => ({ nonce: prev.nonce + 1 }));
  }, []);

  const handleViewChange = useCallback((view: AppView) => {
    const nextView = canonicalizeView(view);
    clearTodayTargets();
    setDeskDateParam(undefined);
    // Standup mode only survives navigation when it's still in the URL.
    if (nextView === 'team') setTeamMode(undefined);
    if (nextView === 'notes') {
      setNotesDate(getLocalIsoDate());
    }
    preloadView(nextView);
    setActiveView(nextView);
    navigateToView(nextView, {
      params:
        nextView === 'work'
          ? dashboardFilterStateToParams(dashboardFilterState)
          : nextView === 'team'
          ? teamBoardQuery
            ? teamBoardQueryToParams(teamBoardQuery)
            : undefined
          : nextView === 'notes'
          ? { date: getLocalIsoDate() }
          : undefined,
    });
  }, [clearTodayTargets, dashboardFilterState, teamBoardQuery]);

  const handleTodayWorkFilter = useCallback((filter: DashboardFilterState['activeFilter']) => {
    clearTodayTargets();
    const nextFilterState: DashboardFilterState = {
      ...DEFAULT_DASHBOARD_FILTER_STATE,
      activeFilter: filter,
    };
    setDashboardFilterState(nextFilterState);
    preloadView('work');
    setActiveView('work');
    navigateToView('work', { params: dashboardFilterStateToParams(nextFilterState) });
  }, [clearTodayTargets]);

  const handleOpenNotes = useCallback((date?: string) => {
    const next = date && isValidIsoDate(date) ? date : getLocalIsoDate();
    clearTodayTargets();
    setNotesDate(next);
    preloadView('notes');
    setActiveView('notes');
    navigateToView('notes', { params: { date: next } });
  }, [clearTodayTargets]);

  const handleNotesDateChange = useCallback((date: string) => {
    if (!isValidIsoDate(date)) {
      return;
    }
    setNotesDate(date);
    navigateToView('notes', { params: { date } });
  }, []);

  const handleOpenTodayTarget = useCallback((target: TodayActionTarget) => {
    if (target.view === 'work') {
      const nextFilterState: DashboardFilterState = {
        ...dashboardFilterState,
        activeFilter: target.filter ?? dashboardFilterState.activeFilter,
        activeDeveloper: undefined,
        selectedTagId: undefined,
        noTagsFilter: false,
      };
      setDashboardFilterState(nextFilterState);
      setTodayWorkTarget((prev) => ({ issueKey: target.issueKey, nonce: prev.nonce + 1 }));
      preloadView('work');
      setActiveView('work');
      navigateToView('work', { params: dashboardFilterStateToParams(nextFilterState) });
      return;
    }

    if (target.view === 'notes') {
      handleOpenNotes(target.date);
      return;
    }

    if (target.view === 'tasks') {
      // Phase 3 (P3-D14): Jira drift items deep-link to the canonical task page;
      // without a key, open the Tasks surface on the Jira drift built-in view.
      if (target.taskKey) {
        navigateToTaskPage(target.taskKey);
        return;
      }
      setTasksUrlState({ view: 'jira-drift', overrides: {} });
      setTasksUrlNonce((nonce) => nonce + 1);
      preloadView('desk');
      setActiveView('desk');
      navigateToView('desk', { params: { view: 'jira-drift' } });
      return;
    }

    if (target.view === 'team') {
      setTodayTeamTarget((prev) => ({
        developerAccountId: target.developerAccountId,
        trackerItemId: target.trackerItemId,
        managerDeskItemId: target.managerDeskItemId,
        taskKey: target.taskKey,
        nonce: prev.nonce + 1,
      }));
      preloadView('team');
      setActiveView('team');
      navigateToView('team', { params: target.taskKey ? { task: target.taskKey } : undefined });
      return;
    }

    if (target.managerDeskItemId) {
      setTodayDeskTarget((prev) => ({
        itemId: target.managerDeskItemId,
        date: target.date,
        taskKey: target.taskKey,
        nonce: prev.nonce + 1,
      }));
      setDeskDateParam(target.date);
      preloadView('desk');
      setActiveView('desk');
      navigateToView('desk', {
        params: {
          ...(target.date ? { date: target.date } : {}),
          ...(target.taskKey ? { task: target.taskKey } : {}),
        },
      });
      return;
    }

    if (target.view === 'desk' && target.taskKey) {
      setTodayDeskTarget((prev) => ({
        itemId: target.managerDeskItemId,
        date: target.date,
        taskKey: target.taskKey,
        nonce: prev.nonce + 1,
      }));
      if (target.date) {
        setDeskDateParam(target.date);
      }
      preloadView('desk');
      setActiveView('desk');
      navigateToView('desk', {
        params: {
          ...(target.date ? { date: target.date } : {}),
          task: target.taskKey,
        },
      });
      return;
    }

    if (target.view === 'desk' || target.view === 'follow-ups' || target.view === 'meetings') {
      preloadView(target.view === 'desk' ? 'desk' : target.view);
      setActiveView(target.view);
      navigateToView(target.view);
      return;
    }

    if (target.view === 'settings') {
      setSettingsSectionTarget((prev) => ({ section: target.section, nonce: prev.nonce + 1 }));
      preloadView('settings');
      setActiveView('settings');
      navigateToView('settings', { params: target.section ? { section: target.section } : undefined });
      return;
    }

    const nextView = canonicalizeView(target.view as AppView);
    setActiveView(nextView);
    navigateToView(nextView);
  }, [dashboardFilterState, handleOpenNotes]);

  const handleTaskResolved = useCallback((task: TaskResolution) => {
    if (user?.role === 'developer') {
      preloadView('my-day');
      setActiveView('my-day');
      navigateToView('my-day', { replace: true, params: { task: task.taskKey } });
      return;
    }
    if (task.kind === 'desk_only') {
      setTodayDeskTarget((prev) => ({ itemId: task.managerDeskItemId, date: task.date, taskKey: task.taskKey, nonce: prev.nonce + 1 }));
      setDeskDateParam(task.date);
      preloadView('desk');
      setActiveView('desk');
      navigateToView('desk', { replace: true, params: { date: task.date, task: task.taskKey } });
      return;
    }
    setTodayTeamTarget((prev) => ({
      developerAccountId: task.developer?.accountId,
      trackerItemId: task.trackerItemId,
      managerDeskItemId: task.managerDeskItemId,
      taskKey: task.taskKey,
      nonce: prev.nonce + 1,
    }));
    setTeamBoardQuery(undefined);
    preloadView('team');
    setActiveView('team');
    navigateToView('team', { replace: true, params: { task: task.taskKey } });
  }, [user?.role]);

  const replaceView = useCallback((view: AppView) => {
    const nextView = canonicalizeView(view);
    preloadView(nextView);
    setActiveView(nextView);
    navigateToView(nextView, { replace: true });
  }, []);

  useEffect(() => {
    replaceLegacyPathIfNeeded();

    const onPopState = () => {
      const nextView = pathToView(window.location.pathname);
      const params = new URLSearchParams(window.location.search);
      setActiveView(nextView);
      if (nextView === 'work') {
        setDashboardFilterState(dashboardFilterStateFromParams(params));
      }
      if (nextView === 'team') {
        setTeamBoardQuery(teamBoardQueryFromParams(params));
        setTeamBoardQueryNonce((nonce) => nonce + 1);
        setTeamMode(teamModeFromParams(params));
        const taskKey = taskKeyFromParams(params);
        if (taskKey) {
          setTodayTeamTarget((prev) => ({ taskKey, nonce: prev.nonce + 1 }));
        }
      }
      if (nextView === 'desk') {
        const taskKey = taskKeyFromParams(params);
        const date = deskDateFromParams(params);
        // Phase 3: TasksPage owns view state; the date param only feeds the
        // legacy desk. Push both and let the active page pick what it needs.
        setTasksUrlState(taskViewStateFromParams(params));
        setTasksUrlNonce((nonce) => nonce + 1);
        if (taskKey) {
          setTodayDeskTarget((prev) => ({ taskKey, date, nonce: prev.nonce + 1 }));
        }
      }
      if (nextView === 'notes') {
        setNotesDate(notesDateFromParams(params) ?? getLocalIsoDate());
      }
      replaceLegacyPathIfNeeded();
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const handleTeamBoardQueryChange = useCallback((query: TeamTrackerBoardQuery) => {
    setTeamBoardQuery(query);
  }, []);

  // Phase 3 (P3-D5): standup is URL state so Esc/back both leave it cleanly.
  const handleStandupModeChange = useCallback((open: boolean) => {
    setTeamMode(open ? 'standup' : undefined);
    const params = new URLSearchParams(window.location.search);
    if (open) params.set('mode', 'standup');
    else params.delete('mode');
    const search = params.toString();
    const target = `${window.location.pathname}${search ? `?${search}` : ''}`;
    if (!sameLocation(target)) {
      if (open) window.history.pushState(null, '', target);
      else window.history.replaceState(null, '', target);
    }
  }, []);

  const handleDeskDateChange = useCallback((date: string) => {
    setDeskDateParam(date);
  }, []);

  // Keep the URL in sync with the active view's filter state (replace, not
  // push, so filter tweaks never pollute browser history).
  useEffect(() => {
    if (activeView !== 'work') {
      return;
    }
    const target = `${window.location.pathname}${buildSearchFromParams(dashboardFilterStateToParams(dashboardFilterState))}`;
    if (sameLocation(target)) {
      return;
    }
    const timer = window.setTimeout(() => {
      window.history.replaceState(null, '', target);
    }, 200);
    return () => window.clearTimeout(timer);
  }, [activeView, dashboardFilterState]);

  useEffect(() => {
    if (activeView !== 'team' || !teamBoardQuery) {
      return;
    }
    // Keep the deep-linked task param in sync so task drawers stay shareable.
    const taskKey = taskKeyFromParams(new URLSearchParams(window.location.search));
    const target = `${window.location.pathname}${buildSearchFromParams({
      ...teamBoardQueryToParams(teamBoardQuery),
      task: taskKey,
      mode: teamMode,
    })}`;
    if (sameLocation(target)) {
      return;
    }
    const timer = window.setTimeout(() => {
      window.history.replaceState(null, '', target);
    }, 200);
    return () => window.clearTimeout(timer);
  }, [activeView, teamBoardQuery, teamMode]);

  // Phase 3: `/tasks` keeps its view+override params shareable (§5.2).
  useEffect(() => {
    if (activeView !== 'desk' || !features?.tasksPhase3 || !tasksUrlState) {
      return;
    }
    const taskKey = taskKeyFromParams(new URLSearchParams(window.location.search));
    const params = taskViewParamsFromState(tasksUrlState);
    if (taskKey) params.set('task', taskKey);
    const target = `${window.location.pathname}${params.size ? `?${params.toString()}` : ''}`;
    if (sameLocation(target)) {
      return;
    }
    const timer = window.setTimeout(() => {
      window.history.replaceState(null, '', target);
    }, 200);
    return () => window.clearTimeout(timer);
  }, [activeView, features?.tasksPhase3, tasksUrlState]);

  useEffect(() => {
    if (authLoading || isBootstrapPending) {
      return;
    }

    if (bootstrapState?.bootstrapOpen) {
      if (activeView !== 'work') {
        replaceView('work');
      }
      return;
    }

    if (activeView === 'my-day') {
      if (isAuthenticated && user?.role === 'manager') {
        replaceView('today');
      }
      return;
    }

    if (isAuthenticated && user?.role === 'developer' && activeView !== 'task') {
      replaceView('my-day');
    }
  }, [
    activeView,
    authLoading,
    bootstrapState,
    isAuthenticated,
    isBootstrapPending,
    replaceView,
    user,
  ]);

  const openCapture = useCallback((context?: GlobalCaptureContext) => {
    setCaptureContext(context ?? {});
    setCaptureOpen(true);
  }, []);

  const quickActions = useMemo<QuickActionsValue>(
    () => ({
      openCapture,
      openCommandPalette: () => setPaletteOpen(true),
      openNotes: handleOpenNotes,
    }),
    [openCapture, handleOpenNotes],
  );

  useEffect(() => {
    if (!isAuthenticatedManager) {
      return;
    }
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'j') {
        event.preventDefault();
        setAssistantOpen((open) => !open);
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'i') {
        event.preventDefault();
        if (!captureOpen) {
          openCapture();
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isAuthenticatedManager, captureOpen, openCapture]);

  const renderActiveView = () => {
    if (authLoading || isBootstrapPending) {
      return activeView === 'today' ? <TodayBootLoading /> : <FullPageLoading />;
    }

  if (bootstrapState?.bootstrapOpen) {
    return (
      <Suspense fallback={<FullPageLoading />}>
        <SetupWizard
          onComplete={async () => {
            await bootstrapQuery.refetch();
          }}
        />
      </Suspense>
    );
  }  if (activeView === 'my-day') {
    if (!isAuthenticated) {
      return (
        <Suspense fallback={<FullPageLoading />}>
          <LoginPage role="developer" />
        </Suspense>
      );
    }

    if (user?.role !== 'developer') {
      return <FullPageLoading />;
    }

    return (
      <Suspense fallback={<FullPageLoading />}>
        <MyDayPage />
      </Suspense>
    );
  }

  if (!isAuthenticated) {
    return (
      <Suspense fallback={<FullPageLoading />}>
        <LoginPage role="manager" />
      </Suspense>
    );
  }

  if (activeView === 'task') {
    const taskKey = TASK_LINK_PATH_PATTERN.exec(window.location.pathname)?.[1];
    // Phase 3 (P3-D2): `/t/:key` renders the shared task detail as a full page.
    // Flag off keeps the Phase 2 deep-link resolver behaviour.
    if (features?.tasksPhase3) {
      if (!taskKey || !user?.role) return <FullPageLoading />;
      const goBack = () => {
        if (document.referrer.startsWith(window.location.origin)) {
          window.history.back();
        } else {
          handleViewChange(user.role === 'developer' ? 'my-day' : 'today');
        }
      };
      const page = (
        <Suspense fallback={<FullPageLoading />}>
          <TaskPage taskKey={taskKey} onBack={goBack} />
        </Suspense>
      );
      if (user.role !== 'manager') {
        return page;
      }
      return (
        <WorkspaceShell activeView={activeView} onViewChange={handleViewChange} onOpenActionTarget={handleOpenTodayTarget}>
          {page}
        </WorkspaceShell>
      );
    }
    const resolver = taskKey && user?.role ? (
      <TaskLinkResolver
        taskKey={taskKey}
        role={user.role}
        onResolved={handleTaskResolved}
        onGoToday={() => handleViewChange(user.role === 'developer' ? 'my-day' : 'today')}
        notFound={<NotFoundState onGoToday={() => handleViewChange(user.role === 'developer' ? 'my-day' : 'today')} />}
      />
    ) : <FullPageLoading />;
    if (user?.role !== 'manager') {
      return resolver;
    }
    return (
      <WorkspaceShell activeView={activeView} onViewChange={handleViewChange} onOpenActionTarget={handleOpenTodayTarget}>
        {resolver}
      </WorkspaceShell>
    );
  }

  if (user?.role !== 'manager') {
    return <FullPageLoading />;
  }

  if (activeView === 'not-found') {
    return (
      <WorkspaceShell activeView={activeView} onViewChange={handleViewChange} onOpenActionTarget={handleOpenTodayTarget}>
        <NotFoundState onGoToday={() => handleViewChange('today')} />
      </WorkspaceShell>
    );
  }

  if (activeView === 'desk') {
    return (
      <WorkspaceShell activeView={activeView} onViewChange={handleViewChange} onOpenActionTarget={handleOpenTodayTarget}>
        <Suspense fallback={<PanelLoading />}>
          {features?.tasksPhase3 ? (
            <TasksPage
              urlState={tasksUrlState}
              urlStateNonce={tasksUrlNonce}
              onUrlStateChange={setTasksUrlState}
              openTaskKey={todayDeskTarget.taskKey}
              openTaskNonce={todayDeskTarget.nonce}
            />
          ) : (
            <ManagerDeskPage
              initialItemId={todayDeskTarget.itemId}
              initialDate={todayDeskTarget.date}
              initialTaskKey={todayDeskTarget.taskKey}
              initialItemNonce={todayDeskTarget.nonce}
              onInitialItemHandled={() => setTodayDeskTarget((prev) => ({ nonce: prev.nonce + 1 }))}
              onDateChange={handleDeskDateChange}
            />
          )}
        </Suspense>
      </WorkspaceShell>
    );
  }

  if (activeView === 'team') {
    return (
      <WorkspaceShell activeView={activeView} onViewChange={handleViewChange} onOpenActionTarget={handleOpenTodayTarget}>
        <Suspense fallback={<PanelLoading />}>
          <TeamTrackerPage
            onViewChange={handleViewChange}
            initialDeveloperAccountId={todayTeamTarget.developerAccountId}
            initialTrackerItemId={todayTeamTarget.trackerItemId}
            initialManagerDeskItemId={todayTeamTarget.managerDeskItemId}
            initialTaskKey={todayTeamTarget.taskKey}
            initialDeveloperNonce={todayTeamTarget.nonce}
            onInitialDeveloperHandled={() => setTodayTeamTarget((prev) => ({ nonce: prev.nonce + 1 }))}
            initialBoardQuery={teamBoardQuery}
            urlBoardQuery={teamBoardQuery}
            urlBoardQueryNonce={teamBoardQueryNonce}
            onBoardQueryChange={handleTeamBoardQueryChange}
            standupMode={teamMode === 'standup'}
            onStandupModeChange={handleStandupModeChange}
          />
        </Suspense>
      </WorkspaceShell>
    );
  }

  if (activeView === 'follow-ups' || activeView === 'meetings') {
    return (
      <WorkspaceShell activeView={activeView} onViewChange={handleViewChange} onOpenActionTarget={handleOpenTodayTarget}>
        <Suspense fallback={<PanelLoading />}>
          <ManagerMemoryPage mode={activeView} onViewChange={handleViewChange} onOpenTarget={handleOpenTodayTarget} />
        </Suspense>
      </WorkspaceShell>
    );
  }

  if (activeView === 'notes') {
    return (
      <WorkspaceShell activeView={activeView} onViewChange={handleViewChange} onOpenActionTarget={handleOpenTodayTarget}>
        <Suspense fallback={<PanelLoading />}>
          <NotesPage
            date={notesDate}
            onDateChange={handleNotesDateChange}
            onOpenTarget={handleOpenTodayTarget}
          />
        </Suspense>
      </WorkspaceShell>
    );
  }

  if (activeView === 'settings') {
    return (
      <WorkspaceShell activeView={activeView} onViewChange={handleViewChange} onOpenActionTarget={handleOpenTodayTarget}>
        <Suspense fallback={<PanelLoading />}>
          <SettingsPage requestedSection={settingsSectionTarget} />
        </Suspense>
      </WorkspaceShell>
    );
  }

  if (activeView === 'today') {
    return (
      <WorkspaceShell activeView={activeView} onViewChange={handleViewChange} onOpenActionTarget={handleOpenTodayTarget}>
        <TodayPage
          onViewChange={handleViewChange}
          onSelectWorkFilter={handleTodayWorkFilter}
          onOpenTodayTarget={handleOpenTodayTarget}
        />
      </WorkspaceShell>
    );
  }

  return (
    <Suspense fallback={<FullPageLoading />}>
      <DashboardLayout
        activeView={activeView}
        onViewChange={handleViewChange}
        filterState={dashboardFilterState}
        onFilterStateChange={setDashboardFilterState}
        initialIssueKey={todayWorkTarget.issueKey}
        initialIssueNonce={todayWorkTarget.nonce}
        onInitialIssueHandled={() => setTodayWorkTarget((prev) => ({ nonce: prev.nonce + 1 }))}
        onOpenActionTarget={handleOpenTodayTarget}
      />
    </Suspense>
  );
  };

  const defaultCaptureTarget = activeView === 'team' ? 'team-tracker' : activeView === 'notes' ? 'notes' : 'manager-desk';

  return (
    <QuickActionsProvider value={quickActions}>
      <AssistantProvider
        isOpen={assistantOpen}
        onOpenChange={setAssistantOpen}
        currentView={activeView === 'not-found' || activeView === 'task' ? window.location.pathname : viewToPath(activeView)}
        onOpenTarget={handleOpenTodayTarget}
      >
        {renderActiveView()}
        {isAuthenticatedManager && captureOpen && (
          <GlobalCaptureDialog
            onClose={() => setCaptureOpen(false)}
            onOpenManagerDesk={() => handleViewChange('desk')}
            onOpenTeamTracker={() => handleViewChange('team')}
            onOpenNotes={(targetDate) => handleOpenNotes(targetDate)}
            context={{ ...captureContext, defaultTarget: captureContext.defaultTarget ?? defaultCaptureTarget }}
          />
        )}
        {isAuthenticatedManager && paletteOpen && (
          <CommandPalette
            onClose={() => setPaletteOpen(false)}
            onOpenTarget={handleOpenTodayTarget}
            onViewChange={handleViewChange}
          />
        )}
        {isAuthenticatedManager && (
          <Suspense fallback={null}>
            <AssistantDock />
          </Suspense>
        )}
      </AssistantProvider>
    </QuickActionsProvider>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <AuthProvider>
          <ToastProvider>
            <AuthSessionBoundary>
              <AppContent />
            </AuthSessionBoundary>
          </ToastProvider>
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
