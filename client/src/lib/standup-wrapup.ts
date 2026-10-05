import { describeLogEntry, openTasksFor, type StandupLogEntry, type StandupSession } from '@/lib/standup';
import { getLocalIsoDate } from '@/lib/utils';
import type { StandupFollowUpPlan, TrackerDeveloperDay } from '@/types';

export function followUpPlan(day: TrackerDeveloperDay, session: StandupSession): StandupFollowUpPlan {
  return session.followUpPlans?.[day.developer.accountId] ?? { title: `Follow up with ${day.developer.displayName}` };
}

export function wrapUpConcern(day: TrackerDeveloperDay, session: StandupSession): string | undefined {
  const reason = session.flagReasons?.[day.developer.accountId];
  if (reason) return reason;
  const blocked = openTasksFor(day).find((task) => task.status === 'blocked');
  if (blocked) return `Blocked: ${blocked.title}`;
  if (day.status === 'blocked') return 'Blocked — agree on an unblock action.';
  if (day.status === 'at_risk') return 'At risk — check what needs support.';
  if (day.status === 'waiting') return 'Waiting — confirm who can move this forward.';
  return undefined;
}

/** Public work only: the self row can also contain the manager's private plan. */
export function publicDay(day: TrackerDeveloperDay): TrackerDeveloperDay {
  if (day.tasks) return { ...day, tasks: day.tasks.filter((task) => task.ownerType === 'developer'), currentItem: undefined, plannedItems: [], completedItems: [], droppedItems: [] };
  if (day.developer.isSelf) return { ...day, currentItem: undefined, plannedItems: [], completedItems: [], droppedItems: [] };
  return day;
}

export function recapChanges(day: TrackerDeveloperDay, session: StandupSession): StandupLogEntry[] {
  const privateKeys = new Set(day.tasks?.filter((task) => task.ownerType !== 'developer').map((task) => task.taskKey));
  return session.log.filter((entry) => entry.accountId === day.developer.accountId && !entry.private && !privateKeys.has(entry.taskKey ?? '') && entry.kind !== 'checkin');
}

export function recapChangeText(entry: StandupLogEntry): string {
  return `${describeLogEntry(entry, false)}${entry.taskTitle ? ` · ${entry.taskTitle}` : ''}`;
}

export const RECAP_STATUS: Record<TrackerDeveloperDay['status'], string> = {
  on_track: 'On track', at_risk: 'At risk', blocked: 'Blocked', waiting: 'Waiting', done_for_today: 'Done for today',
};

export function buildTeamRecap(date: string, days: TrackerDeveloperDay[], session: StandupSession): string {
  const lines = [`Team standup · ${date}`, `${days.filter((day) => session.reviewed.includes(day.developer.accountId)).length}/${days.length} people visited`];
  for (const day of days) {
    const tasks = openTasksFor(publicDay(day));
    const current = tasks.find((task) => task.status === 'active');
    const next = tasks.find((task) => task.taskKey !== current?.taskKey && task.status !== 'blocked');
    const work = (task: typeof current) => task ? `${task.taskKey} · ${task.title}` : 'None set';
    lines.push('', `${day.developer.displayName} · ${RECAP_STATUS[day.status]}${session.reviewed.includes(day.developer.accountId) ? '' : ' · Not visited'}`, `Current: ${work(current)}`, `Next: ${work(next)}`);
    for (const task of tasks.filter((task) => task.status === 'blocked')) lines.push(`Blocked: ${work(task)}`);
    for (const entry of recapChanges(day, session)) lines.push(`- ${recapChangeText(entry)}`);
  }
  return lines.join('\n');
}

export function buildFollowThrough(days: TrackerDeveloperDay[], session: StandupSession): string {
  const lines = ['Your follow-through'];
  for (const day of days.filter((entry) => session.flagged.includes(entry.developer.accountId))) {
    const plan = followUpPlan(day, session);
    lines.push(`- ${plan.title} · Owner: You · Check by: ${plan.followUpAt ? getLocalIsoDate(new Date(plan.followUpAt)) : 'Now'}`);
    const concern = wrapUpConcern(day, session);
    if (concern) lines.push(`  ${concern}`);
  }
  return lines.join('\n');
}
