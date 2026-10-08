import { useRef } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useAuthScopeKey } from '@/context/AuthContext';

const recounts = new WeakMap<QueryClient, Map<string, ReturnType<typeof setTimeout>>>();

/** One trailing recount per authenticated manager and client; never wakes a developer query. */
export function invalidateTaskViewCounts(client: QueryClient, scope: string) {
  if (scope === 'anonymous' || scope.includes(':developer:')) return;
  let timers = recounts.get(client);
  if (!timers) { timers = new Map(); recounts.set(client, timers); }
  const prior = timers.get(scope);
  if (prior) clearTimeout(prior);
  timers.set(scope, setTimeout(() => {
    timers.delete(scope);
    void client.invalidateQueries({ queryKey: ['task-view-counts', scope] });
  }, 500));
}

/** Capture scope before the request: a late settlement must not recount the next login. */
export function useTaskCountInvalidation() {
  const client = useQueryClient();
  const scope = useAuthScopeKey();
  const current = useRef(scope);
  current.current = scope;
  return {
    submittedScope: () => scope,
    isCurrent: (submittedScope: string | undefined): submittedScope is string => submittedScope !== undefined && submittedScope === current.current,
    recount: (submittedScope: string | undefined) => {
      if (submittedScope === current.current) invalidateTaskViewCounts(client, submittedScope);
    },
  };
}
