import { useMemo } from 'react';
import { useAuth } from '@/context/AuthContext';
import type { AuthUser } from '@/types';

export function getScopedStorageKey(baseKey: string, user: AuthUser | null | undefined): string {
  if (!user) {
    return `lead-os:anonymous:${baseKey}`;
  }

  return `lead-os:${user.workspaceId}:${user.username}:${baseKey}`;
}

export function useScopedStorageKey(baseKey: string): string {
  const { user } = useAuth();

  return useMemo(
    () => getScopedStorageKey(baseKey, user),
    [baseKey, user?.workspaceId, user?.username]
  );
}

/** Remove user-keyed capture, standup and view state when a browser changes account. */
export function clearScopedStorageForUser(user: AuthUser | null): void {
  if (!user) return;
  const prefix = `lead-os:${user.workspaceId}:${user.username}:`;
  for (const name of ['localStorage', 'sessionStorage'] as const) {
    try { const storage = window[name]; for (const key of Object.keys(storage)) if (key.startsWith(prefix)) storage.removeItem(key); }
    catch { /* Session/cache reset still succeeds when storage is unavailable. */ }
  }
}
