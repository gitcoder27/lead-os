import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SettingsPage } from '@/components/settings/SettingsPanel';
import { DEVELOPER_LOGIN_URL } from '@/lib/constants';
import { TestWrapper } from '@/test/wrapper';
import type { TagUsageResponse } from '@/types';

const mockGet = vi.fn();
const mockPut = vi.fn();
const mockPatch = vi.fn();
const mockPost = vi.fn();
const mockDelete = vi.fn();
const mockMutateAsync = vi.fn();
const mockDeleteTagMutate = vi.fn();
const mockRefetchTagUsage = vi.fn(async () => ({ data: undefined }));
const mockRefetch = vi.fn(async () => ({ data: {} }));
const mockAddToast = vi.fn();
const mockConfig = {
  jiraBaseUrl: 'https://acme.atlassian.net',
  jiraEmail: 'manager@example.com',
  jiraApiToken: '****',
  jiraProjectKey: 'AM',
  jiraSyncScopeMode: 'team_assignees',
  jiraSyncJql: 'project = AM AND issuetype = Bug',
  jiraDevDueDateField: 'customfield_10128',
  jiraAspenSeverityField: 'customfield_10129',
  managerJiraAccountId: 'manager-1',
  backupBeforeReset: true,
};
const mockTagUsageById: Record<number, TagUsageResponse> = {
  1: {
    tag: { id: 1, name: 'Legacy', color: '#ef4444' },
    issueCount: 2,
    issues: [
      {
        jiraKey: 'AM-1',
        summary: 'Checkout button fails',
        assigneeName: 'Taylor Dev',
        statusName: 'To Do',
        updatedAt: '2026-03-10T09:00:00Z',
      },
      {
        jiraKey: 'AM-2',
        summary: 'Profile image upload times out',
        assigneeName: 'Jordan Dev',
        statusName: 'In Progress',
        updatedAt: '2026-03-09T09:00:00Z',
      },
    ],
  },
  2: {
    tag: { id: 2, name: 'Unused', color: '#22c55e' },
    issueCount: 0,
    issues: [],
  },
};

vi.mock('@/hooks/useConfig', () => ({
  useConfig: () => ({
    data: mockConfig,
    refetch: mockRefetch,
  }),
}));

vi.mock('@/hooks/useDevelopers', () => ({
  useDevelopers: () => ({
    data: [
      {
        accountId: 'dev-1',
        displayName: 'Taylor Dev',
        email: 'taylor@example.com',
        avatarUrl: '',
        isActive: true,
      },
    ],
    isLoading: false,
  }),
}));

vi.mock('@/hooks/useTriggerSync', () => ({
  useTriggerSync: () => ({ isPending: false, mutateAsync: mockMutateAsync }),
}));

vi.mock('@/hooks/useTagCounts', () => ({
  useTagCounts: () => ({
    data: {
      counts: [
        { tagId: 1, count: 2 },
        { tagId: 2, count: 0 },
      ],
      untaggedCount: 0,
    },
  }),
}));

vi.mock('@/hooks/useTags', () => ({
  useTags: () => ({
    data: [
      { id: 1, name: 'Legacy', color: '#ef4444' },
      { id: 2, name: 'Unused', color: '#22c55e' },
    ],
  }),
  useTagUsage: (tagId?: number) => ({
    data: tagId ? mockTagUsageById[tagId] : undefined,
    isLoading: false,
    refetch: mockRefetchTagUsage,
  }),
  useDeleteTag: () => ({
    mutate: mockDeleteTagMutate,
    isPending: false,
  }),
}));

vi.mock('@/context/ToastContext', () => ({
  useToast: () => ({
    addToast: mockAddToast,
  }),
}));

vi.mock('@/lib/api', () => ({
  api: {
    get: (...args: unknown[]) => mockGet(...args),
    put: (...args: unknown[]) => mockPut(...args),
    patch: (...args: unknown[]) => mockPatch(...args),
    post: (...args: unknown[]) => mockPost(...args),
    delete: (...args: unknown[]) => mockDelete(...args),
  },
}));

describe('SettingsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRefetch.mockClear();
    mockRefetchTagUsage.mockClear();
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });

    mockGet.mockImplementation(async (path: string) => {
      if (path === '/auth/users') {
        return {
          users: [
            {
              username: 'manager',
              accountId: 'manager-app',
              displayName: 'Morgan Manager',
              role: 'manager',
            },
            {
              username: 'taylor.dev',
              accountId: 'dev-1',
              developerAccountId: 'dev-1',
              displayName: 'Taylor Dev',
              role: 'developer',
            },
          ],
        };
      }

      if (path === '/config/fields') {
        return { fields: [] };
      }

      if (path === '/config/maintenance/reset-preview') {
        return {
          backupBeforeReset: true,
          managerDesk: {
            dayCount: 3,
            itemCount: 128,
            linkCount: 44,
            historyCount: 260,
            linkedTrackerItemCount: 18,
          },
          teamTracker: {
            dayCount: 14,
            itemCount: 72,
            checkInCount: 21,
            availabilityPeriodCount: 2,
            savedViewCount: 1,
            linkedManagerDeskItemCount: 18,
          },
        };
      }

      return {};
    });

    mockPost.mockImplementation(async (path: string) => {
      if (path === '/team/discover') {
        return {
          users: [
            {
              accountId: 'manager-1',
              displayName: 'Morgan Manager',
              email: 'manager@example.com',
            },
            {
              accountId: 'manager-2',
              displayName: 'Casey Lead',
              email: 'casey@example.com',
            },
          ],
          startAt: 0,
          maxResults: 50,
          count: 2,
          hasMore: false,
        };
      }

      if (path === '/config/test') {
        return {
          success: true,
          checkedAt: '2026-03-10T09:00:00Z',
          user: {
            displayName: 'Edited Manager',
          },
        };
      }

      return {};
    });

    mockPatch.mockResolvedValue({});
    mockDelete.mockResolvedValue({ ok: true });
    mockDeleteTagMutate.mockImplementation(
      (_variables: { id: number; force?: boolean }, options?: { onSuccess?: (result: { success: true; removedIssueCount: number }) => void }) => {
        options?.onSuccess?.({ success: true, removedIssueCount: 0 });
      }
    );
  });

  it('does not trigger sync when saving settings fails', async () => {
    mockPut.mockRejectedValueOnce(new Error('Invalid query'));

    render(
      <TestWrapper>
        <SettingsPage />
      </TestWrapper>
    );

    fireEvent.click(screen.getByRole('button', { name: /Save & Sync/i }));

    await waitFor(() => {
      expect(mockPut).toHaveBeenCalledTimes(1);
      expect(mockMutateAsync).not.toHaveBeenCalled();
    });
  });

  it('keeps the user on the page when sync fails after save succeeds', async () => {
    mockPut.mockResolvedValue({ success: true });
    mockMutateAsync.mockRejectedValueOnce(new Error('Sync unavailable'));

    render(
      <TestWrapper>
        <SettingsPage />
      </TestWrapper>
    );

    fireEvent.click(screen.getByRole('button', { name: /Save & Sync/i }));

    await waitFor(() => {
      expect(mockPut).toHaveBeenCalledTimes(1);
      expect(mockMutateAsync).toHaveBeenCalledTimes(1);
      expect(screen.getByText('Settings')).toBeInTheDocument();
    });
  });

  it('saves and syncs without navigating away', async () => {
    mockPut.mockResolvedValue({ success: true });
    mockMutateAsync.mockResolvedValue({ status: 'success', issuesSynced: 4, startedAt: '', completedAt: '' });

    render(
      <TestWrapper>
        <SettingsPage />
      </TestWrapper>
    );

    fireEvent.click(screen.getByRole('button', { name: /Save & Sync/i }));

    await waitFor(() => {
      expect(mockPut).toHaveBeenCalledTimes(1);
      expect(mockPut).toHaveBeenCalledWith('/config/settings', expect.objectContaining({
        jiraBaseUrl: 'https://acme.atlassian.net',
        jiraEmail: 'manager@example.com',
        jiraProjectKey: 'AM',
        jiraSyncScopeMode: 'team_assignees',
        jiraAspenSeverityField: 'customfield_10129',
        managerJiraAccountId: 'manager-1',
      }));
      expect(mockMutateAsync).toHaveBeenCalledTimes(1);
      expect(screen.getByText('Settings')).toBeInTheDocument();
    });
  });

  it('saves an updated manager Jira identity', async () => {
    mockPut.mockResolvedValue({ success: true });

    render(
      <TestWrapper>
        <SettingsPage />
      </TestWrapper>
    );

    fireEvent.change(screen.getByPlaceholderText(/paste or edit the jira account id/i), {
      target: { value: 'manager-2' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^Save$/i }));

    await waitFor(() => {
      expect(mockPut).toHaveBeenCalledWith('/config/settings', expect.objectContaining({
        managerJiraAccountId: 'manager-2',
      }));
      expect(mockRefetch).toHaveBeenCalledTimes(1);
    });
  });

  it('saves edited Jira connection fields from Settings', async () => {
    mockPut.mockResolvedValue({ success: true });

    render(
      <TestWrapper>
        <SettingsPage />
      </TestWrapper>
    );

    fireEvent.change(screen.getByLabelText(/jira base url/i), {
      target: { value: 'https://isolated.atlassian.net' },
    });
    fireEvent.change(screen.getByLabelText(/jira email/i), {
      target: { value: 'isolated.manager@example.com' },
    });
    fireEvent.change(screen.getByLabelText(/project key/i), {
      target: { value: 'ISO' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^Save$/i }));

    await waitFor(() => {
      expect(mockPut).toHaveBeenCalledWith('/config/settings', expect.objectContaining({
        jiraBaseUrl: 'https://isolated.atlassian.net',
        jiraEmail: 'isolated.manager@example.com',
        jiraProjectKey: 'ISO',
      }));
    });
  });

  it('tests a new token against edited Jira connection fields', async () => {
    render(
      <TestWrapper>
        <SettingsPage />
      </TestWrapper>
    );

    fireEvent.change(screen.getByLabelText(/jira base url/i), {
      target: { value: 'https://isolated.atlassian.net' },
    });
    fireEvent.change(screen.getByLabelText(/jira email/i), {
      target: { value: 'isolated.manager@example.com' },
    });
    fireEvent.change(screen.getByLabelText(/project key/i), {
      target: { value: 'ISO' },
    });
    fireEvent.change(screen.getByPlaceholderText(/new api token/i), {
      target: { value: 'fresh-token' },
    });
    fireEvent.click(screen.getByRole('button', { name: /test new token/i }));

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith('/config/test', {
        jiraBaseUrl: 'https://isolated.atlassian.net',
        jiraEmail: 'isolated.manager@example.com',
        jiraProjectKey: 'ISO',
        jiraApiToken: 'fresh-token',
      });
    });
  });

  it('saves base-query sync scope mode from the Sync Scope screen', async () => {
    mockPut.mockResolvedValue({ success: true });

    render(
      <TestWrapper>
        <SettingsPage />
      </TestWrapper>
    );

    fireEvent.click(screen.getByRole('button', { name: /sync scope/i }));
    fireEvent.click(await screen.findByRole('button', { name: /base query exact jql/i }));
    fireEvent.click(screen.getByRole('button', { name: /^Save$/i }));

    await waitFor(() => {
      expect(mockPut).toHaveBeenCalledWith('/config/settings', expect.objectContaining({
        jiraSyncScopeMode: 'base_query',
        jiraSyncJql: 'project = AM AND issuetype = Bug',
      }));
    });
  });

  it('toggles Jira auto-sync off immediately from the Sync Scope screen', async () => {
    mockPut.mockResolvedValue({ success: true });

    render(
      <TestWrapper>
        <SettingsPage />
      </TestWrapper>
    );

    fireEvent.click(screen.getByRole('button', { name: /sync scope/i }));
    const toggle = await screen.findByRole('switch', { name: /toggle jira auto-sync/i });
    expect(toggle).toHaveAttribute('aria-checked', 'true');

    fireEvent.click(toggle);

    await waitFor(() => {
      expect(mockPut).toHaveBeenCalledWith('/config/settings', { jiraAutoSyncEnabled: false });
    });
    await waitFor(() => {
      expect(toggle).toHaveAttribute('aria-checked', 'false');
    });
    expect(mockAddToast).toHaveBeenCalledWith(expect.objectContaining({
      type: 'success',
      title: 'Auto-sync disabled',
    }));
  });

  it('adds selected team members and triggers an immediate sync', async () => {
    mockMutateAsync.mockResolvedValue({ status: 'success', issuesSynced: 4, startedAt: '', completedAt: '' });

    render(
      <TestWrapper>
        <SettingsPage />
      </TestWrapper>
    );

    fireEvent.click(screen.getByRole('button', { name: /team members/i }));
    fireEvent.click(await screen.findByRole('button', { name: /casey lead/i }));
    fireEvent.click(screen.getByRole('button', { name: /add 1 selected/i }));

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith('/team/developers', {
        developers: [
          {
            accountId: 'manager-2',
            displayName: 'Casey Lead',
            email: 'casey@example.com',
          },
        ],
      });
      expect(mockMutateAsync).toHaveBeenCalledTimes(1);
      expect(mockAddToast).toHaveBeenCalledWith(expect.objectContaining({
        type: 'success',
        title: 'Team updated and synced',
        message: 'Added 1 team member and synced issues.',
      }));
    });
  });

  it('adds a manual team member without triggering Jira sync', async () => {
    render(
      <TestWrapper>
        <SettingsPage />
      </TestWrapper>
    );

    fireEvent.click(screen.getByRole('button', { name: /team members/i }));
    await screen.findByText('Add Manually');
    fireEvent.change(screen.getByRole('textbox', { name: /manual team member name/i }), {
      target: { value: 'Priya Manual' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: /manual team member email/i }), {
      target: { value: 'priya@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: /add manual member/i }));

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith('/team/developers/manual', {
        displayName: 'Priya Manual',
        email: 'priya@example.com',
      });
      expect(mockMutateAsync).not.toHaveBeenCalled();
      expect(mockAddToast).toHaveBeenCalledWith(expect.objectContaining({
        type: 'success',
        title: 'Team member added',
      }));
    });
  });

  it('updates team member details and optional Jira link inline', async () => {
    render(
      <TestWrapper>
        <SettingsPage />
      </TestWrapper>
    );

    fireEvent.click(screen.getByRole('button', { name: /team members/i }));
    await screen.findByText('Tracked Team');
    fireEvent.click(screen.getByRole('button', { name: /edit taylor dev/i }));
    fireEvent.change(screen.getByRole('textbox', { name: /edit team member name/i }), {
      target: { value: 'Taylor Updated' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: /edit team member email/i }), {
      target: { value: 'taylor.updated@example.com' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: /edit team member jira account id/i }), {
      target: { value: 'jira-dev-1' },
    });
    fireEvent.click(screen.getByRole('button', { name: /save team member changes/i }));

    await waitFor(() => {
      expect(mockPatch).toHaveBeenCalledWith('/team/developers/dev-1', {
        displayName: 'Taylor Updated',
        email: 'taylor.updated@example.com',
        jiraAccountId: 'jira-dev-1',
      });
      expect(mockAddToast).toHaveBeenCalledWith(expect.objectContaining({
        type: 'success',
        title: 'Team member updated',
      }));
    });
  });

  it('keeps the add action busy until the immediate sync finishes', async () => {
    let resolveSync: ((value: { status: 'success'; issuesSynced: number; startedAt: string; completedAt: string }) => void) | undefined;
    const syncPromise = new Promise<{ status: 'success'; issuesSynced: number; startedAt: string; completedAt: string }>((resolve) => {
      resolveSync = resolve;
    });
    mockMutateAsync.mockReturnValue(syncPromise);

    render(
      <TestWrapper>
        <SettingsPage />
      </TestWrapper>
    );

    fireEvent.click(screen.getByRole('button', { name: /team members/i }));
    fireEvent.click(await screen.findByRole('button', { name: /casey lead/i }));
    fireEvent.click(screen.getByRole('button', { name: /add 1 selected/i }));

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalledTimes(1);
      expect(screen.getByRole('button', { name: /adding/i })).toBeDisabled();
    });

    resolveSync?.({ status: 'success', issuesSynced: 4, startedAt: '', completedAt: '' });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /add selected/i })).toBeDisabled();
      expect(screen.queryByRole('button', { name: /adding/i })).not.toBeInTheDocument();
    });
  });

  it('reports when add succeeds but the immediate sync fails', async () => {
    mockMutateAsync.mockRejectedValueOnce(new Error('Sync unavailable'));

    render(
      <TestWrapper>
        <SettingsPage />
      </TestWrapper>
    );

    fireEvent.click(screen.getByRole('button', { name: /team members/i }));
    fireEvent.click(await screen.findByRole('button', { name: /casey lead/i }));
    fireEvent.click(screen.getByRole('button', { name: /add 1 selected/i }));

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith('/team/developers', {
        developers: [
          {
            accountId: 'manager-2',
            displayName: 'Casey Lead',
            email: 'casey@example.com',
          },
        ],
      });
      expect(mockMutateAsync).toHaveBeenCalledTimes(1);
      expect(mockAddToast).toHaveBeenCalledWith(expect.objectContaining({
        type: 'error',
        title: 'Team updated but sync failed',
        message: 'The membership change was saved, but the immediate sync failed: Sync unavailable',
      }));
    });
  });

  it('removes a team member only after inline confirmation and triggers an immediate sync', async () => {
    mockMutateAsync.mockResolvedValue({ status: 'success', issuesSynced: 2, startedAt: '', completedAt: '' });

    render(
      <TestWrapper>
        <SettingsPage />
      </TestWrapper>
    );

    fireEvent.click(screen.getByRole('button', { name: /team members/i }));
    fireEvent.click(await screen.findByRole('button', { name: /remove taylor dev from team/i }));

    expect(mockDelete).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /confirm removing taylor dev from team/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /confirm removing taylor dev from team/i }));

    await waitFor(() => {
      expect(mockDelete).toHaveBeenCalledWith('/team/developers/dev-1');
      expect(mockMutateAsync).toHaveBeenCalledTimes(1);
      expect(mockAddToast).toHaveBeenCalledWith(expect.objectContaining({
        type: 'success',
        title: 'Team updated and synced',
        message: 'Developer removed from tracked team and synced issues.',
      }));
    });
  });

  it('dismisses the inline team-member removal confirmation when clicking outside', async () => {
    render(
      <TestWrapper>
        <SettingsPage />
      </TestWrapper>
    );

    fireEvent.click(screen.getByRole('button', { name: /team members/i }));
    fireEvent.click(await screen.findByRole('button', { name: /remove taylor dev from team/i }));

    expect(screen.getByRole('button', { name: /confirm removing taylor dev from team/i })).toBeInTheDocument();

    fireEvent.mouseDown(document.body);

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /confirm removing taylor dev from team/i })).not.toBeInTheDocument();
    });

    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('does not trigger an immediate sync when adding team members fails', async () => {
    mockPost.mockImplementation(async (path: string) => {
      if (path === '/team/discover') {
        return {
          users: [
            {
              accountId: 'manager-1',
              displayName: 'Morgan Manager',
              email: 'manager@example.com',
            },
            {
              accountId: 'manager-2',
              displayName: 'Casey Lead',
              email: 'casey@example.com',
            },
          ],
          startAt: 0,
          maxResults: 50,
          count: 2,
          hasMore: false,
        };
      }

      if (path === '/team/developers') {
        throw new Error('Save failed');
      }

      return {};
    });

    render(
      <TestWrapper>
        <SettingsPage />
      </TestWrapper>
    );

    fireEvent.click(screen.getByRole('button', { name: /team members/i }));
    fireEvent.click(await screen.findByRole('button', { name: /casey lead/i }));
    fireEvent.click(screen.getByRole('button', { name: /add 1 selected/i }));

    await waitFor(() => {
      expect(mockMutateAsync).not.toHaveBeenCalled();
      expect(mockAddToast).toHaveBeenCalledWith(expect.objectContaining({
        type: 'error',
        title: 'Failed to add team members',
        message: 'Save failed',
      }));
    });
  });

  it('deletes a developer account after confirmation', async () => {
    render(
      <TestWrapper>
        <SettingsPage />
      </TestWrapper>
    );

    fireEvent.click(screen.getByRole('button', { name: /developer access/i }));
    await screen.findByRole('button', { name: /delete account for taylor dev/i });

    fireEvent.click(screen.getByRole('button', { name: /delete account for taylor dev/i }));
    expect(screen.getByText('Delete access?')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /confirm delete account for taylor dev/i }));

    await waitFor(() => {
      expect(mockDelete).toHaveBeenCalledWith('/auth/users/taylor.dev');
      expect(screen.queryByRole('button', { name: /delete account for taylor dev/i })).not.toBeInTheDocument();
    });
  });

  it('shows and copies the hosted developer login link', async () => {
    render(
      <TestWrapper>
        <SettingsPage />
      </TestWrapper>
    );

    fireEvent.click(screen.getByRole('button', { name: /developer access/i }));

    expect(await screen.findByText(DEVELOPER_LOGIN_URL)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^Copy$/i }));

    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(DEVELOPER_LOGIN_URL);
    });
  });

  it('renders the defect tag library in settings', async () => {
    render(
      <TestWrapper>
        <SettingsPage />
      </TestWrapper>
    );

    fireEvent.click(screen.getByRole('button', { name: /defect tags/i }));
    await screen.findByLabelText(/search tags/i);

    expect(screen.getByText('Review the shared tag library and safely remove labels.')).toBeInTheDocument();
    expect(screen.getByText('Legacy')).toBeInTheDocument();
    expect(screen.getAllByText('Unused').length).toBeGreaterThan(0);
  });

  it('deletes an unused tag after simple confirmation', async () => {
    render(
      <TestWrapper>
        <SettingsPage />
      </TestWrapper>
    );

    fireEvent.click(screen.getByRole('button', { name: /defect tags/i }));
    await screen.findByLabelText(/search tags/i);
    fireEvent.click(screen.getByRole('button', { name: /delete tag unused/i }));

    expect(screen.getByText('No defects currently use this tag. Delete it if you no longer want it available in the tag library.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^delete tag$/i }));

    await waitFor(() => {
      expect(mockDeleteTagMutate).toHaveBeenCalledWith(
        { id: 2, force: false },
        expect.objectContaining({
          onSuccess: expect.any(Function),
          onError: expect.any(Function),
        })
      );
    });
  });

  it('shows linked defects before deleting an in-use tag', async () => {
    mockDeleteTagMutate.mockImplementation(
      (_variables: { id: number; force?: boolean }, options?: { onSuccess?: (result: { success: true; removedIssueCount: number }) => void }) => {
        options?.onSuccess?.({ success: true, removedIssueCount: 2 });
      }
    );

    render(
      <TestWrapper>
        <SettingsPage />
      </TestWrapper>
    );

    fireEvent.click(screen.getByRole('button', { name: /defect tags/i }));
    await screen.findByLabelText(/search tags/i);
    fireEvent.click(screen.getByRole('button', { name: /delete tag legacy/i }));

    expect(screen.getByText('Linked defects')).toBeInTheDocument();
    expect(screen.getByText('AM-1')).toBeInTheDocument();
    expect(screen.getByText('Checkout button fails')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /delete from 2 defects/i }));

    await waitFor(() => {
      expect(mockDeleteTagMutate).toHaveBeenCalledWith(
        { id: 1, force: true },
        expect.objectContaining({
          onSuccess: expect.any(Function),
          onError: expect.any(Function),
        })
      );
    });
  });

  it('renders the maintenance section with reset previews', async () => {
    render(
      <TestWrapper>
        <SettingsPage />
      </TestWrapper>
    );

    fireEvent.click(screen.getByRole('button', { name: /data maintenance/i }));

    expect(await screen.findByText(/automatic pre-reset backup is enabled/i)).toBeInTheDocument();
    expect(screen.getByText('128 tasks')).toBeInTheDocument();
    expect(screen.getAllByText('72 tracker items').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Reset Both Workspaces')).toBeInTheDocument();
  });

  it('runs the full maintenance reset after typed confirmation', async () => {
    mockPost.mockImplementation(async (path: string, body?: unknown) => {
      if (path === '/team/discover') {
        return {
          users: [
            {
              accountId: 'manager-1',
              displayName: 'Morgan Manager',
              email: 'manager@example.com',
            },
            {
              accountId: 'manager-2',
              displayName: 'Casey Lead',
              email: 'casey@example.com',
            },
          ],
          startAt: 0,
          maxResults: 50,
          count: 2,
          hasMore: false,
        };
      }

      if (path === '/config/maintenance/reset') {
        expect(body).toEqual({
          target: 'workspace',
          confirmationText: 'CLEAR EVERYTHING',
        });
        return {
          success: true,
          target: 'workspace',
          backup: {
            name: 'dashboard.backup-20260420-010101-pre-reset.db',
            createdAt: '2026-04-20T01:01:01.000Z',
            reason: 'pre-reset',
          },
        };
      }

      return {};
    });

    render(
      <TestWrapper>
        <SettingsPage />
      </TestWrapper>
    );

    fireEvent.click(screen.getByRole('button', { name: /data maintenance/i }));
    fireEvent.click(await screen.findByRole('button', { name: /arm reset both workspaces/i }));
    fireEvent.change(screen.getByLabelText(/confirmation text for reset both workspaces/i), {
      target: { value: 'CLEAR EVERYTHING' },
    });
    fireEvent.click(screen.getByRole('button', { name: /run reset both workspaces/i }));

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith('/config/maintenance/reset', {
        target: 'workspace',
        confirmationText: 'CLEAR EVERYTHING',
      });
      expect(mockAddToast).toHaveBeenCalledWith(expect.objectContaining({
        type: 'success',
        title: 'Maintenance reset complete',
      }));
    });
  });
});
