import { CheckCircle2, History, Play, RotateCcw, UserCircle, XCircle } from 'lucide-react';
import type { Developer, TrackerWorkItem } from '@/types';
import { TaskTimeline } from '@/components/tasks/TaskTimeline';
import { TaskUpdateComposer } from '@/components/tasks/TaskUpdateComposer';
import { RelatedIssueChips } from './RelatedIssueChips';

interface TrackerTaskExecutionPanelProps {
  developer: Developer;
  item: TrackerWorkItem;
  onSetCurrent: (itemId: number) => void;
  onUpdateState: (itemId: number, state: TrackerWorkItem['state']) => void;
  isPending?: boolean;
}

const STATE_LABELS: Record<TrackerWorkItem['state'], string> = {
  planned: 'Planned',
  in_progress: 'In Progress',
  done: 'Done',
  dropped: 'Dropped',
};

export function TrackerTaskExecutionPanel({
  developer,
  item,
  onSetCurrent,
  onUpdateState,
  isPending = false,
}: TrackerTaskExecutionPanelProps) {
  const isClosed = item.state === 'done' || item.state === 'dropped';
  // Delegated tasks are closed/reopened from the Manager Desk workflow below so
  // this panel stays the single source for execution state, not a second Done.
  const isDelegated = Boolean(item.managerDeskItemId);

  return (
    <section
      className="rounded-[24px] border p-4"
      style={{
        borderColor: 'color-mix(in srgb, var(--accent) 22%, var(--border) 78%)',
        background:
          'linear-gradient(180deg, color-mix(in srgb, var(--accent-glow) 28%, transparent) 0%, color-mix(in srgb, var(--bg-secondary) 92%, transparent) 100%)',
      }}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-[0.2em]" style={{ color: 'var(--accent)' }}>
            Team Tracker Execution
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[13px]">
            <span
              className="rounded-full px-2.5 py-1 font-semibold"
              style={{ background: 'var(--bg-elevated)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
            >
              {STATE_LABELS[item.state]}
            </span>
            <span className="flex items-center gap-1" style={{ color: 'var(--text-secondary)' }}>
              <UserCircle size={12} />
              {developer.displayName}
            </span>
            <RelatedIssueChips issueKeys={item.relatedIssueKeys} compact />
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {!isClosed && item.state !== 'in_progress' && (
            <button
              type="button"
              onClick={() => onSetCurrent(item.id)}
              disabled={isPending}
              className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[12px] font-semibold disabled:opacity-40"
              style={{ background: 'var(--accent-glow)', color: 'var(--accent)' }}
            >
              <Play size={12} />
              Set Current
            </button>
          )}
          {!isClosed && !isDelegated && (
            <button
              type="button"
              onClick={() => onUpdateState(item.id, 'done')}
              disabled={isPending}
              className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[12px] font-semibold disabled:opacity-40"
              style={{
                background: 'rgba(16,185,129,0.12)',
                color: 'var(--success)',
                border: '1px solid rgba(16,185,129,0.24)',
              }}
            >
              <CheckCircle2 size={12} />
              Mark Done
            </button>
          )}
          {!isClosed && (
            <button
              type="button"
              onClick={() => onUpdateState(item.id, 'dropped')}
              disabled={isPending}
              className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[12px] font-semibold disabled:opacity-40"
              style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}
            >
              <XCircle size={12} />
              Drop
            </button>
          )}
          {isClosed && !isDelegated && (
            <button
              type="button"
              onClick={() => onUpdateState(item.id, 'planned')}
              disabled={isPending}
              className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[12px] font-semibold disabled:opacity-40"
              style={{ background: 'var(--bg-elevated)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
            >
              <RotateCcw size={12} />
              Reopen
            </button>
          )}
          {isDelegated && !isClosed && (
            <span className="self-center text-[11px]" style={{ color: 'var(--text-muted)' }}>
              Close via My follow-through
            </span>
          )}
        </div>
      </div>

      <div className="mt-4">
        <div
          className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.18em]"
          style={{ color: 'var(--text-muted)' }}
        >
          <History size={11} />
          Timeline
        </div>
        {item.taskKey ? (
          <>
            <TaskTimeline taskKey={item.taskKey} mode="manager" />
            {!isClosed && (
              <TaskUpdateComposer taskKey={item.taskKey} mode="manager" via="task_drawer" collapsed />
            )}
          </>
        ) : (
          <div className="mt-2 text-[13px]" style={{ color: 'var(--text-muted)' }}>
            No task timeline yet.
          </div>
        )}
      </div>
    </section>
  );
}
