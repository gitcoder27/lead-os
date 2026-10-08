import type { QueryClient } from '@tanstack/react-query';
import type { TaskDetailResponse } from '@/types';
import { invalidateTaskViewCounts } from './task-count-invalidation';

/** These daily keys put scope after their date/context; Tasks keys put it second. */
const trailingScope = new Set(['today', 'manager-desk', 'team-tracker', 'my-day', 'workload']);
export const taskQueryInScope = (key: readonly unknown[], scope: string) =>
  trailingScope.has(String(key[0])) ? key.at(-1) === scope : key[1] === scope;

export function invalidateTaskQueries(client: QueryClient, scope: string, surfaces: string[]) {
  for (const surface of surfaces) void client.invalidateQueries({
    queryKey: [surface], predicate: (query) => taskQueryInScope(query.queryKey, scope),
  });
}

/** Refresh only the changed tasks and cached related parent/child details. */
export function invalidateTaskDetails(client: QueryClient, scope: string, keys?: readonly string[]) {
  const affected = keys && new Set(keys);
  for (const surface of ['task-detail', 'task-events', 'task-resolution', 'task-inbox-event']) {
    void client.invalidateQueries({ queryKey: [surface, scope], predicate: (query) => {
      if (!affected) return true;
      if (affected.has(String(query.queryKey[surface === 'task-inbox-event' ? 2 : 3]))) return true;
      if (surface !== 'task-detail') return false;
      const detail = query.state.data as TaskDetailResponse | undefined;
      return Boolean(detail?.parent && affected.has(detail.parent.taskKey))
        || Boolean(detail?.children?.some((child) => affected.has(child.taskKey)));
    } });
  }
}

/** Task domain writes refresh scoped facts now and coalesce manager rail counts. */
export function invalidateTaskSurfaces(client: QueryClient, scope: string, keys?: readonly string[], extra: string[] = [], recount = true) {
  invalidateTaskDetails(client, scope, keys);
  invalidateTaskQueries(client, scope, ['tasks', 'task-inbox', 'today', 'manager-desk', 'team-tracker', 'my-day', 'workload', ...extra]);
  if (!scope.includes(':developer:') && scope !== 'anonymous') invalidateTaskQueries(client, scope, ['projects', 'project']);
  if (recount) invalidateTaskViewCounts(client, scope);
}
