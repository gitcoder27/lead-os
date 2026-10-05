import { useEffect, useRef } from 'react';
import { subscribeTaskChanges } from '@/lib/task-change-notifications';
import type { StandupLogEntry, StandupSession, StandupSessionAction } from '@/lib/standup';
import type { TrackerDeveloperDay } from '@/types';

/** Include drawer writes in the active round without confusing background refetches with standup actions. */
export function useStandupTaskJournal(
  scope: string,
  session: StandupSession,
  days: TrackerDeveloperDay[],
  ownsRound: boolean,
  dispatch: (action: StandupSessionAction) => void,
) {
  const seen = useRef(new Set<string>());
  useEffect(() => {
    seen.current.clear();
  }, [session.roundId]);
  useEffect(() => subscribeTaskChanges((change) => {
    if (!ownsRound || session.request || change.scope !== scope || seen.current.has(change.id)
      || Date.parse(change.startedAt) < Date.parse(session.startedAt ?? change.startedAt)) return;
    if (change.before?.ownerType !== 'developer' && change.task.ownerType !== 'developer') return;
    const beforeId = change.before?.ownerType === 'developer' ? change.before.ownerId : undefined;
    const afterId = change.task.ownerType === 'developer' ? change.task.ownerId : undefined;
    const person = days.find((day) => day.developer.accountId === beforeId)
      ?? days.find((day) => day.tasks?.some((task) => task.taskKey === change.task.taskKey))
      ?? days.find((day) => day.developer.accountId === afterId);
    if (!person) return;
    seen.current.add(change.id);
    const base = {
      accountId: person.developer.accountId, taskKey: change.task.taskKey,
      taskTitle: change.task.ownerType === 'manager' ? change.before?.title ?? change.task.title : change.task.title,
      at: change.at,
    };
    const entries: StandupLogEntry[] = [];
    if (change.eventType) entries.push({ ...base, kind: 'update', ...(change.private && { private: true }) });
    else {
      const fields = new Set(change.fields);
      if ((fields.has('ownerId') || fields.has('ownerType')) && (change.before?.ownerId !== change.task.ownerId || change.before?.ownerType !== change.task.ownerType)) {
        const name = days.find((day) => day.developer.accountId === afterId)?.developer.displayName ?? 'manager-owned work';
        entries.push({ ...base, kind: 'reassign', detail: name });
      }
      if (fields.has('status') && change.before?.status !== change.task.status) {
        const kind = change.task.status === 'done' ? 'done' : change.task.status === 'active' ? 'current' : change.task.status === 'blocked' ? 'blocked' : 'update';
        entries.push({ ...base, kind });
      }
      if ([...fields].some((field) => !['status', 'ownerType', 'ownerId'].includes(field))) entries.push({ ...base, kind: 'update' });
    }
    for (const entry of entries) dispatch({ type: 'log', entry });
  }), [scope, session.roundId, session.startedAt, session.request, days, ownsRound, dispatch]);
}
