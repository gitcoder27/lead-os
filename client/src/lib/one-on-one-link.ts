import type { TaskDetailResponse } from '@/types';

const ONE_ON_ONE = /(^|[^\d])1\s*[:-]\s*1([^\d]|$)|\bone[\s-]on[\s-]one\b/i;

/**
 * docs/56 UX-35 (decision 2, bridge only): the roster person a 1:1 meeting task is with, so the task can
 * open that person's 1:1 workspace. A meeting whose title says 1:1 (or one-on-one) and that names exactly
 * one roster person — by a person link, else by a unique name in the title. Nothing else qualifies.
 */
export function oneOnOnePerson(
  task: Pick<TaskDetailResponse, 'kind' | 'title' | 'links'>,
  developers: readonly { accountId: string; displayName: string }[],
): { accountId: string; displayName: string } | null {
  if (task.kind !== 'meeting' || !ONE_ON_ONE.test(task.title)) return null;
  const linked = task.links
    .filter((link) => link.kind === 'person')
    .map((link) => developers.find((dev) => dev.accountId === link.ref))
    .filter((dev): dev is { accountId: string; displayName: string } => Boolean(dev));
  if (linked.length === 1) return linked[0]!;
  if (linked.length > 1) return null;
  const title = task.title.toLowerCase();
  const named = developers.filter((dev) => {
    const full = dev.displayName.trim().toLowerCase();
    const first = full.split(/\s+/)[0] ?? '';
    return title.includes(full) || (first.length > 1 && new RegExp(`\\b${first.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(title));
  });
  return named.length === 1 ? named[0]! : null;
}

export function oneOnOneHref(accountId: string): string {
  return `/team?dev=${encodeURIComponent(accountId)}&panel=one-on-one`;
}
