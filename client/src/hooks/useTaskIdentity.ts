import { useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';
import { isTaskSelf } from '@/lib/task-identity';
import { useSelfLink } from './useSelfLink';

export function useTaskIdentity(mode: 'manager' | 'developer') {
  const { user } = useAuth();
  const manager = mode === 'manager' && user?.role === 'manager';
  const link = useSelfLink(manager);
  // The endpoint already ignores inactive roster records. Suggestions are never a link.
  const developerId = manager
    ? (!link.isError ? link.data?.developerAccountId ?? undefined : undefined)
    : user?.role === 'developer' ? user.developerAccountId ?? undefined : undefined;
  const loginId = user?.accountId;
  const isSelf = useCallback((id: string | null | undefined) => isTaskSelf(id, loginId, developerId), [loginId, developerId]);
  return { loginId, developerId, isSelf };
}
