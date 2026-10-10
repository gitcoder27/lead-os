import { useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';

/**
 * docs/73 UXD-06: the one sign-out — the header's account menu and Settings share it.
 * `logout()` resets the signed-in scope (queries, drafts, snapshots, scoped storage; SR-11);
 * then the cache is cleared and the app reloads at `/` so nothing from this account lingers.
 */
export function useSignOut() {
  const { logout } = useAuth();
  const queryClient = useQueryClient();
  const { addToast } = useToast();
  const [pending, setPending] = useState(false);
  const signOut = useCallback(async () => {
    setPending(true);
    try {
      await logout();
      queryClient.clear();
      window.history.replaceState(null, '', '/');
      window.location.reload();
    } catch (err) {
      setPending(false);
      addToast({
        type: 'error',
        title: 'Failed to log out',
        message: err instanceof Error ? err.message : 'Request failed',
      });
    }
  }, [addToast, logout, queryClient]);
  return { signOut, pending };
}
