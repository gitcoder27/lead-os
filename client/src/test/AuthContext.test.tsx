import { clearTaskUpdateDraftsForScope, completeTaskUpdateDraft, newTaskUpdateDraft, readTaskUpdateDraft, taskDraftGeneration, taskUpdateDraftPrefix, writeTaskUpdateDraft } from '@/lib/task-update-drafts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider, getAuthScopeKey, useAuth } from '@/context/AuthContext';
import { readDailyNoteDraft, writeDailyNoteDraft } from '@/lib/daily-note-drafts';
import { authEpoch } from '@/lib/auth-epoch';
import type { AuthUser } from '@/types';

const apiMocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  api: apiMocks,
}));

const managerA: AuthUser = {
  username: 'manager-a',
  accountId: 'manager-a',
  workspaceId: 'workspace-a',
  displayName: 'Manager A',
  role: 'manager',
};

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false },
    },
  });
}

function AuthProbe() {
  const { user, login, logout, refreshSession, signUp } = useAuth();

  return (
    <div>
      <button onClick={() => void refreshSession()}>Refresh session</button>
      <span data-testid="user">{user?.username ?? 'anonymous'}</span>
      <button type="button" onClick={() => void login('manager-a', 'secret123')}>
        Login
      </button>
      <button type="button" onClick={() => void signUp({ inviteToken: 'fixture-invite', username: 'manager-b', displayName: 'Manager B', password: 'fixture-password' })}>Create account</button>
      <button type="button" onClick={() => void logout().catch(() => {})}>
        Logout
      </button>
    </div>
  );
}

function renderAuthProbe(queryClient: QueryClient) {
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>
    </QueryClientProvider>
  );
}

describe('AuthProvider cache isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMocks.get.mockRejectedValue(new Error('No session'));
    apiMocks.post.mockImplementation((url: string) => {
      if (url === '/auth/login') {
        return Promise.resolve({ user: managerA });
      }
      return Promise.resolve(undefined);
    });
  });

  it('clears React Query cache when login switches from anonymous to a workspace user', async () => {
    const queryClient = createQueryClient();
    queryClient.setQueryData(['issues', 'old-workspace'], [{ jiraKey: 'OLD-1' }]);

    renderAuthProbe(queryClient);

    await waitFor(() => expect(apiMocks.get).toHaveBeenCalledWith('/auth/me'));
    expect(queryClient.getQueryData(['issues', 'old-workspace'])).toBeDefined();

    fireEvent.click(screen.getByText('Login'));

    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('manager-a'));
    await waitFor(() => expect(queryClient.getQueryCache().getAll()).toHaveLength(0));
    expect(authEpoch(queryClient)).toBeGreaterThan(0);
  });

  it('clears React Query cache when logout returns to anonymous', async () => {
    const queryClient = createQueryClient();

    renderAuthProbe(queryClient);
    fireEvent.click(screen.getByText('Login'));

    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('manager-a'));
    await waitFor(() => expect(queryClient.getQueryCache().getAll()).toHaveLength(0));

    queryClient.setQueryData(['team-tracker', 'workspace-a'], { stale: true });
    expect(queryClient.getQueryData(['team-tracker', 'workspace-a'])).toBeDefined();

    fireEvent.click(screen.getByText('Logout'));

    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('anonymous'));
    await waitFor(() => expect(queryClient.getQueryCache().getAll()).toHaveLength(0));
  });

  it('clears daily note drafts for the previous auth scope on logout', async () => {
    const queryClient = createQueryClient();

    renderAuthProbe(queryClient);
    fireEvent.click(screen.getByText('Login'));
    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('manager-a'));

    const scope = getAuthScopeKey(managerA);
    writeDailyNoteDraft(scope, '2026-04-28', { body: 'unsynced', baseBody: '', revision: 0 });
    expect(readDailyNoteDraft(scope, '2026-04-28')).not.toBeNull();

    fireEvent.click(screen.getByText('Logout'));
    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('anonymous'));

    expect(readDailyNoteDraft(scope, '2026-04-28')).toBeNull();
  });
  it.each(['logout failure', 'session loss', 'scope change'])('clears task drafts on %s and refuses late completion', async (action) => {
    clearTaskUpdateDraftsForScope(getAuthScopeKey(managerA));
    const queryClient = createQueryClient();
    renderAuthProbe(queryClient);
    fireEvent.click(screen.getByText('Login'));
    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('manager-a'));
    const epoch = authEpoch(queryClient);
    const scope = getAuthScopeKey(managerA);
    const key = `${taskUpdateDraftPrefix(scope, 'manager', 'task_drawer')}T-1`;
    const generation = taskDraftGeneration(scope, key);
    const draft = { ...newTaskUpdateDraft(), body: 'Private draft', private: true };
    writeTaskUpdateDraft(scope, key, draft, generation);
    if (action === 'logout failure') {
      apiMocks.post.mockRejectedValueOnce(new Error('Offline'));
      fireEvent.click(screen.getByText('Logout'));
      // Cleanup begins even before the failed logout response.
      expect(readTaskUpdateDraft(key).body).toBe('');
      expect(authEpoch(queryClient)).toBeGreaterThan(epoch);
      await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('anonymous'));
    } else if (action === 'session loss') {
      fireEvent.click(screen.getByText('Refresh session'));
      await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('anonymous'));
    } else {
      apiMocks.post.mockResolvedValueOnce({ user: { ...managerA, username: 'manager-b', workspaceId: 'workspace-b' } });
      fireEvent.click(screen.getByText('Login'));
      await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('manager-b'));
    }
    expect(readTaskUpdateDraft(key).body).toBe('');
    expect(authEpoch(queryClient)).toBeGreaterThan(epoch);
    expect(completeTaskUpdateDraft(scope, key, draft, generation)).toBe(false);
    writeTaskUpdateDraft(scope, key, draft, generation);
    expect(readTaskUpdateDraft(key).body).toBe('');
  });

  it('keeps a session hint for the boot screen: set by a session or sign-in, cleared by sign-out or a lost session', async () => {
    window.localStorage.removeItem('lead-os:signed-in');
    renderAuthProbe(createQueryClient());
    await waitFor(() => expect(apiMocks.get).toHaveBeenCalledWith('/auth/me'));
    expect(window.localStorage.getItem('lead-os:signed-in')).toBeNull();

    fireEvent.click(screen.getByText('Login'));
    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('manager-a'));
    expect(window.localStorage.getItem('lead-os:signed-in')).toBe('1');

    fireEvent.click(screen.getByText('Logout'));
    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('anonymous'));
    expect(window.localStorage.getItem('lead-os:signed-in')).toBeNull();

    apiMocks.get.mockResolvedValueOnce({ user: managerA });
    fireEvent.click(screen.getByText('Refresh session'));
    await waitFor(() => expect(window.localStorage.getItem('lead-os:signed-in')).toBe('1'));
    fireEvent.click(screen.getByText('Refresh session'));
    await waitFor(() => expect(window.localStorage.getItem('lead-os:signed-in')).toBeNull());
  });
});

  it('clears queries and all user-keyed storage before A logs out and B signs up in the same browser', async () => {
    const client = createQueryClient();
    apiMocks.get.mockResolvedValue({ user: managerA });
    const managerB = { ...managerA, username: 'manager-b', workspaceId: 'workspace-b', displayName: 'Manager B', accountId: 'manager-b' };
    apiMocks.post.mockImplementation((url: string) => Promise.resolve(url === '/auth/signup' ? { user: managerB, features: { tasksPhase3: true, teamMode: 'solo', backups: false } } : undefined));
    renderAuthProbe(client); await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('manager-a'));
    client.setQueryData(['tasks'], [{ title: 'OWNERSECRET task' }]);
    localStorage.setItem('lead-os:workspace-a:manager-a:global-capture', 'OWNERSECRET capture');
    sessionStorage.setItem('lead-os:workspace-a:manager-a:standup-session:today', 'OWNERSECRET standup');
    localStorage.setItem('theme', 'dark');
    fireEvent.click(screen.getByRole('button', { name: 'Logout' }));
    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('anonymous'));
    expect(client.getQueryData(['tasks'])).toBeUndefined();
    expect(localStorage.getItem('lead-os:workspace-a:manager-a:global-capture')).toBeNull();
    expect(sessionStorage.getItem('lead-os:workspace-a:manager-a:standup-session:today')).toBeNull();
    expect(localStorage.getItem('theme')).toBe('dark');
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('manager-b'));
    expect(client.getQueryData(['tasks'])).toBeUndefined();
    expect(document.body).not.toHaveTextContent('OWNERSECRET');
  });

it.each(['response', 'failure'])('ignores an old session refresh after logout and B signs in: %s', async (result) => {
  const client = createQueryClient();
  apiMocks.get.mockResolvedValueOnce({ user: managerA });
  const managerB = { ...managerA, username: 'manager-b', accountId: 'manager-b', workspaceId: 'workspace-b' };
  apiMocks.post.mockImplementation((url: string) => Promise.resolve(url === '/auth/signup' ? { user: managerB } : undefined));
  renderAuthProbe(client);
  await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('manager-a'));
  let resolve!: (value: unknown) => void;
  let reject!: (error: Error) => void;
  apiMocks.get.mockReturnValueOnce(new Promise((ok, fail) => { resolve = ok; reject = fail; }));
  fireEvent.click(screen.getByText('Refresh session'));
  fireEvent.click(screen.getByText('Logout'));
  fireEvent.click(screen.getByText('Create account'));
  await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('manager-b'));
  client.setQueryData(['tasks', 'workspace-b'], [{ title: 'B task' }]);
  await act(async () => {
    if (result === 'response') resolve({ user: managerA }); else reject(new Error('Expired A session'));
  });
  expect(screen.getByTestId('user')).toHaveTextContent('manager-b');
  expect(client.getQueryData(['tasks', 'workspace-b'])).toEqual([{ title: 'B task' }]);
});
