import * as React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SetupWizard } from '@/components/setup/SetupWizard';

const mockPost = vi.fn();
const mockPut = vi.fn();
const mockRefreshSession = vi.fn(async () => null);
const mockSync = vi.fn(async () => ({}));
const auth = vi.hoisted(() => ({ authenticated: true, teamMode: 'solo' as 'solo' | 'collab' }));

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({
    isAuthenticated: auth.authenticated,
    user: auth.authenticated ? { role: 'manager', username: 'manager', displayName: 'Manager' } : null,
    features: { tasksPhase3: false, teamMode: auth.teamMode },
    refreshSession: mockRefreshSession,
  }),
}));

vi.mock('@/context/ThemeContext', () => ({
  useTheme: () => ({
    theme: 'light',
    toggleTheme: vi.fn(),
  }),
}));

vi.mock('@/context/ToastContext', () => ({
  useToast: () => ({ addToast: vi.fn() }),
}));

const configMock = vi.hoisted(() => ({ jira: true }));
vi.mock('@/hooks/useConfig', () => ({
  useConfig: () => ({
    data: configMock.jira
      ? {
        jiraBaseUrl: 'https://tenant.atlassian.net',
        jiraEmail: 'ops@example.com',
        jiraProjectKey: 'AM',
        jiraApiToken: '****',
        managerJiraAccountId: '',
      }
      : { jiraBaseUrl: '', jiraEmail: '', jiraProjectKey: '', jiraApiToken: '', managerJiraAccountId: '' },
    refetch: vi.fn(),
  }),
}));

vi.mock('@/hooks/useTriggerSync', () => ({
  useTriggerSync: () => ({ mutate: vi.fn(), mutateAsync: mockSync, isPending: false }),
}));

vi.mock('@/lib/api', () => ({
  api: {
    post: (...args: unknown[]) => mockPost(...args),
    put: (...args: unknown[]) => mockPut(...args),
    get: vi.fn(async () => ({ users: [] })),
  },
}));

vi.mock('framer-motion', () => {
  const makeMotion = (tag: keyof JSX.IntrinsicElements) =>
    React.forwardRef<HTMLElement, React.HTMLAttributes<HTMLElement>>(({ children, ...props }, ref) =>
      React.createElement(tag, { ...props, ref }, children)
    );

  // One component per tag: a fresh type on every access would remount the tree on each render.
  const cache = new Map<string, ReturnType<typeof makeMotion>>();
  const motionFor = (tag: string) => {
    if (!cache.has(tag)) cache.set(tag, makeMotion(tag as keyof JSX.IntrinsicElements));
    return cache.get(tag)!;
  };

  return {
    motion: new Proxy({}, { get: (_target, tag: string) => motionFor(tag) }),
    AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  };
});

describe('SetupWizard', () => {
  beforeEach(() => {
    mockPost.mockReset();
    mockPut.mockReset();
    mockSync.mockClear();
    mockRefreshSession.mockClear();
    auth.authenticated = true;
    auth.teamMode = 'solo';
    mockPost.mockResolvedValue({ success: true, user: { displayName: 'Jira User' } });
    mockPut.mockResolvedValue({});
  });

  it('tests Jira connection with the saved token path when the token input is blank', async () => {
    render(<SetupWizard onComplete={vi.fn()} />);

    expect(await screen.findByDisplayValue('https://tenant.atlassian.net')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /test connection/i }));

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith('/config/test', {
        jiraBaseUrl: 'https://tenant.atlassian.net',
        jiraEmail: 'ops@example.com',
        jiraProjectKey: 'AM',
      });
    });
  });

  describe('solo-first setup (docs/56 P2-01)', () => {
    const alice = { accountId: 'jira-1', displayName: 'Alice Smith' };

    function mockJiraApi() {
      mockPost.mockImplementation(async (url: string) => {
        if (url === '/team/discover') return { users: [alice] };
        if (url === '/auth/register') return { user: { username: 'alice', displayName: 'Alice Smith', role: 'developer', developerAccountId: 'jira-1' } };
        return { success: true };
      });
    }

    /** From the (already signed-in) Jira step through saving the roster. */
    async function walkToRoster() {
      fireEvent.click(await screen.findByRole('button', { name: /save & continue/i }));
      await screen.findByText('Manager sync scope');
      fireEvent.click(screen.getByRole('button', { name: /^continue$/i }));
      await screen.findByPlaceholderText(/search jira users/i);
      fireEvent.click(await screen.findByText('Alice Smith'));
    }

    it('step 1 offers "Just me" (default) and "Me and a team"', () => {
      auth.authenticated = false;
      render(<SetupWizard onComplete={vi.fn()} />);

      expect(screen.getByRole('radio', { name: /just me/i })).toBeChecked();
      expect(screen.getByRole('radio', { name: /me and a team/i })).not.toBeChecked();
      expect(screen.getByText('Step 1 of 4')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('radio', { name: /me and a team/i }));
      expect(screen.getByText('Step 1 of 5')).toBeInTheDocument();
    });

    it('counts only the steps that apply until Jira is saved (UX-14)', () => {
      configMock.jira = false;
      try {
        auth.authenticated = false;
        render(<SetupWizard onComplete={vi.fn()} />);
        expect(screen.getByText('Step 1 of 2')).toBeInTheDocument();
        expect(screen.getAllByText('with Jira')).toHaveLength(2);
        fireEvent.click(screen.getByRole('radio', { name: /me and a team/i }));
        expect(screen.getByText('Step 1 of 3')).toBeInTheDocument();
      } finally {
        configMock.jira = true;
      }
    });

    it('needs an 8-character password and sends only the manager account', async () => {
      auth.authenticated = false;
      render(<SetupWizard onComplete={vi.fn()} />);

      fireEvent.change(screen.getByPlaceholderText('manager'), { target: { value: 'taylor' } });
      fireEvent.change(screen.getByPlaceholderText('Taylor Morgan'), { target: { value: 'Taylor Morgan' } });
      const create = screen.getByRole('button', { name: /create account/i });
      const password = screen.getByPlaceholderText('At least 8 characters');

      fireEvent.change(password, { target: { value: 'abcdefg' } });
      expect(create).toBeDisabled();
      fireEvent.change(password, { target: { value: 'abcdefgh' } });
      expect(create).toBeEnabled();

      fireEvent.click(create);
      await waitFor(() => {
        expect(mockPost).toHaveBeenCalledWith('/auth/register', {
          username: 'taylor',
          displayName: 'Taylor Morgan',
          password: 'abcdefgh',
          role: 'manager',
        });
      });
    });

    it('no stale copy: the Jira step no longer names Desk, Follow-ups or Meetings', () => {
      render(<SetupWizard onComplete={vi.fn()} />);
      expect(screen.queryByText(/Desk|Follow-ups|Meetings/)).not.toBeInTheDocument();
      expect(screen.getByText(/start with Today, your tasks and notes/i)).toBeInTheDocument();
    });

    it('"Skip for now" on the Jira step completes the wizard without a sync', async () => {
      const onComplete = vi.fn();
      render(<SetupWizard onComplete={onComplete} />);

      fireEvent.click(screen.getByRole('button', { name: /skip for now/i }));
      await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
      expect(mockSync).not.toHaveBeenCalled();
    });

    it('solo: saving the roster is the last step and syncs, with no developer-access step', async () => {
      mockJiraApi();
      const onComplete = vi.fn();
      render(<SetupWizard onComplete={onComplete} />);

      await walkToRoster();
      expect(screen.getByText('Step 4 of 4')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: /save & finish/i }));

      await waitFor(() => expect(mockSync).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
      expect(screen.queryByText('Developer access')).not.toBeInTheDocument();
    });

    async function startTeamSetup() {
      auth.authenticated = false;
      mockJiraApi();
      const onComplete = vi.fn();
      render(<SetupWizard onComplete={onComplete} />);
      fireEvent.click(screen.getByRole('radio', { name: /me and a team/i }));
      fireEvent.change(screen.getByPlaceholderText('manager'), { target: { value: 'taylor' } });
      fireEvent.change(screen.getByPlaceholderText('Taylor Morgan'), { target: { value: 'Taylor Morgan' } });
      fireEvent.change(screen.getByPlaceholderText('At least 8 characters'), { target: { value: 'abcdefgh' } });
      fireEvent.click(screen.getByRole('button', { name: /create account/i }));
      await walkToRoster();
      fireEvent.click(screen.getByRole('button', { name: /save team/i }));
      await screen.findByText('Developer login link');
      return onComplete;
    }

    it('team: creating a developer login switches the workspace to collab', async () => {
      await startTeamSetup();
      expect(screen.getByText('Step 5 of 5')).toBeInTheDocument();

      fireEvent.change(screen.getByPlaceholderText('jamie'), { target: { value: 'alice' } });
      fireEvent.change(screen.getByPlaceholderText('Jamie Chen'), { target: { value: 'Alice Smith' } });
      const password = screen.getByPlaceholderText(/temporary password/i);
      const create = screen.getByRole('button', { name: /create developer access/i });
      fireEvent.change(screen.getByRole('combobox'), { target: { value: 'jira-1' } });
      fireEvent.change(password, { target: { value: 'short' } });
      expect(create).toBeDisabled();
      fireEvent.change(password, { target: { value: 'long-enough-1' } });
      expect(create).toBeEnabled();
      expect(mockPut).not.toHaveBeenCalledWith('/config/team-mode', expect.anything());

      fireEvent.click(create);
      await waitFor(() => expect(mockPut).toHaveBeenCalledWith('/config/team-mode', { teamMode: 'collab' }));
      expect(mockPost).toHaveBeenCalledWith('/auth/register', expect.objectContaining({ role: 'developer', developerAccountId: 'jira-1', password: 'long-enough-1' }));
      expect(mockRefreshSession).toHaveBeenCalled();
    });

    it('team: skipping developer access stays solo and finishes without a sync', async () => {
      const onComplete = await startTeamSetup();

      fireEvent.click(screen.getByRole('button', { name: /skip for now/i }));
      await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
      expect(mockSync).not.toHaveBeenCalled();
      expect(mockPut).not.toHaveBeenCalledWith('/config/team-mode', expect.anything());
    });
  });
});
