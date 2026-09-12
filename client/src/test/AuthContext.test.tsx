import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider, getAuthScopeKey, useAuth } from '@/context/AuthContext';
import { readDailyNoteDraft, writeDailyNoteDraft } from '@/lib/daily-note-drafts';
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
  const { user, login, logout } = useAuth();

  return (
    <div>
      <span data-testid="user">{user?.username ?? 'anonymous'}</span>
      <button type="button" onClick={() => void login('manager-a', 'secret123')}>
        Login
      </button>
      <button type="button" onClick={() => void logout()}>
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
});
