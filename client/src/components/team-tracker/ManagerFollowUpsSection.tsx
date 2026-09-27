import { Briefcase, Check, Plus } from 'lucide-react';
import type { TrackerDeveloperDay } from '@/types';
import type { ManagerDeskItem } from '@/types/manager-desk';
import { JiraIssueLink } from '@/components/JiraIssueLink';
import { FOCUS_RING } from '@/components/tasks/TaskDetailPrimitives';
import { DrawerSection, EmptyLine } from './DeveloperDrawerSections';

interface ManagerFollowUpRowProps {
  day: TrackerDeveloperDay;
  items: ManagerDeskItem[];
  isLoading?: boolean;
  onComplete: (itemId: number) => void;
  onCapture: () => void;
}

const managerDeskStatusLabels: Record<ManagerDeskItem['status'], string> = {
  inbox: 'Inbox',
  planned: 'Planned',
  in_progress: 'In progress',
  waiting: 'Waiting',
  backlog: 'Later',
  done: 'Done',
  cancelled: 'Cancelled',
};

const managerDeskStatusColors: Record<ManagerDeskItem['status'], string> = {
  inbox: 'var(--text-muted)',
  planned: 'var(--md-accent)',
  in_progress: 'var(--accent)',
  waiting: 'var(--info)',
  backlog: 'var(--text-muted)',
  done: 'var(--success)',
  cancelled: 'var(--text-muted)',
};

function getManagerFollowUpMeta(item: ManagerDeskItem) {
  const issueLink = item.links.find((link) => link.linkType === 'issue' && link.issueKey);
  return {
    issueKey: issueLink?.issueKey,
    subtitle: item.nextAction || item.contextNote,
  };
}

function ManagerFollowUpItem({ item, onComplete }: { item: ManagerDeskItem; onComplete: (itemId: number) => void }) {
  const meta = getManagerFollowUpMeta(item);
  const isDone = item.status === 'done';

  return (
    <li className="group flex items-start gap-2.5 rounded-lg px-2 py-2 transition-colors hover:bg-[color-mix(in_srgb,var(--bg-tertiary)_55%,transparent)]">
      {isDone ? (
        <span className="flex h-5 w-5 shrink-0 items-center justify-center" aria-hidden="true">
          <span className="flex h-4 w-4 items-center justify-center rounded-full" style={{ background: 'var(--success)', color: 'var(--bg-primary)' }}>
            <Check size={11} strokeWidth={3} />
          </span>
        </span>
      ) : (
        <button
          type="button"
          onClick={() => onComplete(item.id)}
          className={`group/check flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${FOCUS_RING}`}
          aria-label={`Mark ${item.title} complete`}
          title="Mark complete"
        >
          <span
            className="flex h-4 w-4 items-center justify-center rounded-full transition-colors group-hover/check:border-[var(--success)] group-hover/check:text-[var(--success)]"
            style={{ border: '1.5px solid var(--border-strong)', color: 'transparent' }}
          >
            <Check size={10} strokeWidth={3} />
          </span>
        </button>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-baseline gap-2">
          <span
            className="truncate text-[13.5px] font-medium leading-5"
            style={{
              color: isDone ? 'var(--text-muted)' : 'var(--text-primary)',
              textDecoration: isDone ? 'line-through' : undefined,
            }}
            title={item.title}
          >
            {item.title}
          </span>
          <span className="shrink-0 text-[11.5px] font-medium" style={{ color: managerDeskStatusColors[item.status] }}>
            {managerDeskStatusLabels[item.status]}
          </span>
        </div>
        {(meta.issueKey || meta.subtitle) && (
          <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[12px] leading-[18px]" style={{ color: 'var(--text-muted)' }}>
            {meta.issueKey && (
              <JiraIssueLink issueKey={meta.issueKey} className="shrink-0 font-mono text-[11.5px] font-semibold hover:underline" style={{ color: 'var(--accent)' }}>
                {meta.issueKey}
              </JiraIssueLink>
            )}
            {meta.issueKey && meta.subtitle && <span aria-hidden="true" className="opacity-60">·</span>}
            {meta.subtitle && <span className="truncate" title={meta.subtitle}>{meta.subtitle}</span>}
          </div>
        )}
      </div>
    </li>
  );
}

export function ManagerFollowUpRow({ day, items, isLoading, onComplete, onCapture }: ManagerFollowUpRowProps) {
  const openCount = items.filter((item) => item.status !== 'done').length;
  const firstName = day.developer.displayName.split(' ')[0] ?? day.developer.displayName;

  return (
    <DrawerSection
      icon={<Briefcase size={14} style={{ color: 'var(--md-accent)' }} />}
      title="Follow-ups"
      count={items.length > 0 ? openCount : undefined}
      hint="Private"
      action={
        <button
          type="button"
          onClick={onCapture}
          className={`inline-flex h-7 items-center gap-1 rounded-lg px-2 text-[12px] font-medium transition-colors hover:bg-[var(--md-accent-glow)] ${FOCUS_RING}`}
          style={{ color: 'var(--md-accent)' }}
          title={`Capture a private follow-up linked to ${day.developer.displayName}`}
        >
          <Plus size={13} />
          Capture
        </button>
      }
    >
      {isLoading ? (
        <div className="space-y-2 px-2 py-1.5" aria-busy="true">
          {[0, 1].map((index) => (
            <div key={index} className="flex items-center gap-2.5">
              <span className="h-4 w-4 animate-pulse rounded-full" style={{ background: 'var(--bg-tertiary)' }} />
              <span className="h-2.5 animate-pulse rounded" style={{ width: `${55 - index * 15}%`, background: 'var(--bg-tertiary)' }} />
            </div>
          ))}
          <span className="sr-only">Loading follow-ups</span>
        </div>
      ) : items.length === 0 ? (
        <EmptyLine>
          Nothing open for {firstName}. Captures here stay linked to them on your Desk
          {day.currentItem?.jiraKey && (
            <>
              {' '}with{' '}
              <JiraIssueLink issueKey={day.currentItem.jiraKey} className="font-mono hover:underline" style={{ color: 'var(--text-secondary)' }}>
                {day.currentItem.jiraKey}
              </JiraIssueLink>
            </>
          )}
          .
        </EmptyLine>
      ) : (
        <ul className="space-y-0.5">
          {items.map((item) => (
            <ManagerFollowUpItem key={item.id} item={item} onComplete={onComplete} />
          ))}
        </ul>
      )}
    </DrawerSection>
  );
}
