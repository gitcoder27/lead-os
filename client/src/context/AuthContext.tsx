import { useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useState, useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { api } from '@/lib/api';
import { clearDailyNoteDraftsForScope } from '@/lib/daily-note-drafts';
import { clearTodaySnapshotsForScope } from '@/lib/today-snapshot-cache';
import type { AuthUser, AuthSessionResponse } from '@/types';

interface AuthContextValue {
  user: AuthUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshSession: () => Promise<AuthUser | null>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  isLoading: true,
  isAuthenticated: false,
  login: async () => {},
  logout: async () => {},
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
  const [isLoading, setIsLoading] = useState(true);
  const authScopeKey = getAuthScopeKey(user);
  const previousAuthScopeKeyRef = useRef<string | null>(null);

  const refreshSession = useCallback(async () => {
    try {
      const res = await api.get<AuthSessionResponse>('/auth/me');
      setUser(res.user);
      return res.user;
    } catch {
      setUser(null);
      return null;
    }
  }, []);

  useEffect(() => {
    refreshSession().finally(() => setIsLoading(false));
  }, [refreshSession]);

  useEffect(() => {
    if (previousAuthScopeKeyRef.current === null) {
      previousAuthScopeKeyRef.current = authScopeKey;
      return;
    }

    if (previousAuthScopeKeyRef.current !== authScopeKey) {
      clearTodaySnapshotsForScope(previousAuthScopeKeyRef.current);
      clearDailyNoteDraftsForScope(previousAuthScopeKeyRef.current);
      queryClient.clear();
      previousAuthScopeKeyRef.current = authScopeKey;
    }
  }, [authScopeKey, queryClient]);

  const login = useCallback(async (username: string, password: string) => {
    const res = await api.post<AuthSessionResponse>('/auth/login', { username, password });
    setUser(res.user);
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } finally {
      setUser(null);
    }
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isAuthenticated: user !== null,
        login,
        logout,
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
