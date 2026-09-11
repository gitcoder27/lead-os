import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthScopeKey } from '@/context/AuthContext';
import { api } from '@/lib/api';
import type { AuthUser, Developer, JiraSyncScopeMode } from '@/types';

export interface JiraField {
  id: string;
  name: string;
  custom: boolean;
}

export interface DiscoveredUser {
  accountId: string;
  displayName: string;
  email?: string;
  avatarUrl?: string;
}

export interface DiscoverUsersResponse {
  users: DiscoveredUser[];
  startAt: number;
  maxResults: number;
  count: number;
  hasMore: boolean;
}

export interface JiraConnectionCheckResult {
  success: true;
  checkedAt: string;
  user?: {
    accountId?: string;
    displayName?: string;
  };
}

interface CreateAppUserPayload {
  username: string;
  password: string;
  displayName: string;
  role: Extract<AuthUser['role'], 'manager' | 'developer'>;
  developerAccountId?: string;
}

interface DiscoverTeamMembersPayload {
  query: string;
  startAt: number;
  maxResults: number;
}

interface ManualDeveloperPayload {
  displayName: string;
  email: string;
  jiraAccountId?: string;
}

interface UpdateDeveloperPayload {
  accountId: string;
  displayName: string;
  email: string;
  jiraAccountId: string;
}

export function useAppUsers() {
  const authScopeKey = useAuthScopeKey();

  return useQuery({
    queryKey: ['auth-users', authScopeKey],
    queryFn: async () => {
      const res = await api.get<{ users: AuthUser[] }>('/auth/users');
      return res.users ?? [];
    },
  });
}

export function useCreateAppUser() {
  const queryClient = useQueryClient();
  const authScopeKey = useAuthScopeKey();

  return useMutation({
    mutationFn: (payload: CreateAppUserPayload) => api.post<{ user: AuthUser }>('/auth/register', payload),
    onSuccess: (res) => {
      queryClient.setQueryData<AuthUser[]>(['auth-users', authScopeKey], (previous = []) => [...previous, res.user]);
    },
  });
}

export function useDeleteAppUser() {
  const queryClient = useQueryClient();
  const authScopeKey = useAuthScopeKey();

  return useMutation({
    mutationFn: (username: string) => api.delete<{ ok: true }>(`/auth/users/${encodeURIComponent(username)}`),
    onSuccess: (_res, username) => {
      queryClient.setQueryData<AuthUser[]>(['auth-users', authScopeKey], (previous = []) =>
        previous.filter((user) => user.username !== username)
      );
    },
  });
}

export function useDiscoverJiraFields() {
  return useMutation({
    mutationFn: async () => {
      const res = await api.get<{ fields: JiraField[] }>('/config/fields');
      return res.fields;
    },
  });
}

export function useCheckCurrentJiraConnection() {
  return useMutation({
    mutationFn: () => api.get<JiraConnectionCheckResult>('/config/connection-health'),
  });
}

export function useTestJiraConnection() {
  return useMutation({
    mutationFn: (payload: { jiraBaseUrl: string; jiraEmail: string; jiraApiToken?: string; jiraProjectKey?: string }) =>
      api.post<JiraConnectionCheckResult>('/config/test', payload),
  });
}

export function useSaveSettingsConfig() {
  return useMutation({
    mutationFn: (payload: {
      jiraBaseUrl?: string;
      jiraEmail?: string;
      jiraProjectKey?: string;
      jiraSyncScopeMode?: JiraSyncScopeMode;
      jiraSyncJql?: string;
      jiraDevDueDateField?: string;
      jiraAspenSeverityField?: string;
      managerJiraAccountId?: string;
      jiraApiToken?: string;
      jiraAutoSyncEnabled?: boolean;
    }) => api.put('/config/settings', payload),
  });
}

export function useResetSettingsConfig() {
  return useMutation({
    mutationFn: () => api.post('/config/reset'),
  });
}

export function useDiscoverTeamMembers() {
  return useMutation({
    mutationFn: (payload: DiscoverTeamMembersPayload) =>
      api.post<DiscoverUsersResponse>('/team/discover', payload),
  });
}

export function useAddTeamDevelopers() {
  return useMutation({
    mutationFn: (developers: DiscoveredUser[]) => api.post('/team/developers', { developers }),
  });
}

export function useAddManualDeveloper() {
  return useMutation({
    mutationFn: (payload: ManualDeveloperPayload) => api.post('/team/developers/manual', payload),
  });
}

export function useUpdateTeamDeveloper() {
  return useMutation({
    mutationFn: ({ accountId, ...payload }: UpdateDeveloperPayload) =>
      api.patch('/team/developers/' + encodeURIComponent(accountId), payload),
  });
}

export function useRemoveTeamDeveloper() {
  return useMutation({
    mutationFn: (accountId: Developer['accountId']) =>
      api.delete(`/team/developers/${encodeURIComponent(accountId)}`),
  });
}
