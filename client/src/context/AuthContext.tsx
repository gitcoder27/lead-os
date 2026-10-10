import { clearTaskUpdateDraftsForScope } from '@/lib/task-update-drafts';
import { clearScopedStorageForUser } from '@/lib/scoped-storage';
import { advanceAuthEpoch } from '@/lib/auth-epoch';
import { useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useState, useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { api } from '@/lib/api';
import { clearDailyNoteDraftsForScope } from '@/lib/daily-note-drafts';
import { clearNavPreferencesCacheForScope } from '@/lib/nav-preferences-cache';
import { clearTodaySnapshotsForScope } from '@/lib/today-snapshot-cache';
import { setSessionHint } from '@/lib/session-hint';
import { DEFAULT_TEAM_MODE, type AuthUser, type AuthSessionResponse, type SessionFeatures, type SignUpRequest } from '@/types';

const DEFAULT_FEATURES: SessionFeatures = { tasksPhase3: false, teamMode: DEFAULT_TEAM_MODE };

interface AuthContextValue {
  user: AuthUser | null;
  features: SessionFeatures;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  signUp: (input: SignUpRequest) => Promise<void>;
  refreshSession: () => Promise<AuthUser | null>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  features: DEFAULT_FEATURES,
  isLoading: true,
  isAuthenticated: false,
  login: async () => {},
  logout: async () => {},
  signUp: async () => {},
  refreshSession: async () => null,
});

export function getAuthScopeKey(user: AuthUser | null | undefined): string {
  if (!user) {
    return 'anonymous';
  }

  return `${user.workspaceId}:${user.username}:${user.role}:${user.developerAccountId ?? ''}`;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [features, setFeatures] = useState<SessionFeatures>(DEFAULT_FEATURES);
  const [isLoading, setIsLoading] = useState(true);
  const userRef = useRef<AuthUser | null>(null);
  const sessionGeneration = useRef(0);
  const resetCurrentScope = useCallback(() => {
    const scope = getAuthScopeKey(userRef.current);
    advanceAuthEpoch(queryClient);
    void queryClient.cancelQueries();
    queryClient.clear();
    clearTaskUpdateDraftsForScope(scope); clearTodaySnapshotsForScope(scope);
    clearDailyNoteDraftsForScope(scope); clearNavPreferencesCacheForScope(scope);
    clearScopedStorageForUser(userRef.current);
  }, [queryClient]);

  const refreshSession = useCallback(async () => {
    const generation = ++sessionGeneration.current;
    try {
      const res = await api.get<AuthSessionResponse>('/auth/me');
      if (generation !== sessionGeneration.current) return userRef.current;
      if (getAuthScopeKey(userRef.current) !== getAuthScopeKey(res.user)) resetCurrentScope();
      userRef.current = res.user;
      setUser(res.user);
      setFeatures(res.features ?? DEFAULT_FEATURES);
      setSessionHint(res.user !== null);
      return res.user;
    } catch {
      if (generation !== sessionGeneration.current) return userRef.current;
      setSessionHint(false);
      if (userRef.current) resetCurrentScope();
      userRef.current = null;
      setUser(null);
      setFeatures(DEFAULT_FEATURES);
      return null;
    }
  }, [resetCurrentScope]);

  useEffect(() => {
    refreshSession().finally(() => setIsLoading(false));
  }, [refreshSession]);

  const acceptSession = useCallback((res: AuthSessionResponse) => {
    sessionGeneration.current++;
    resetCurrentScope(); userRef.current = res.user;
    setSessionHint(true); setUser(res.user); setFeatures(res.features ?? DEFAULT_FEATURES);
  }, [resetCurrentScope]);
  const login = useCallback(async (username: string, password: string) => {
    acceptSession(await api.post<AuthSessionResponse>('/auth/login', { username, password }));
  }, [acceptSession]);
  const signUp = useCallback(async (input: SignUpRequest) => {
    acceptSession(await api.post<AuthSessionResponse>('/auth/signup', input));
  }, [acceptSession]);
  const logout = useCallback(async () => {
    sessionGeneration.current++;
    resetCurrentScope(); userRef.current = null;
    setSessionHint(false); setUser(null); setFeatures(DEFAULT_FEATURES);
    await api.post('/auth/logout');
  }, [resetCurrentScope]);

  return (
    <AuthContext.Provider
      value={{
        user,
        features,
        isLoading,
        isAuthenticated: user !== null,
        login,
        logout,
        signUp,
        refreshSession,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}

export function useAuthScopeKey(): string {
  const { user } = useAuth();
  return useMemo(() => getAuthScopeKey(user), [user]);
}
