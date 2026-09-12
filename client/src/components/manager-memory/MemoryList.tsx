import { ArrowRight, CheckCircle2, Clock3, MessageSquare, UserRound } from 'lucide-react';
import {
  formatMemoryDateTime,
  getMemoryLane,
  isClosedMemoryItem,
  type ManagerMemoryLane,
  type ManagerMemoryMode,
} from '@/lib/manager-memory';
import { NotesSourceLink } from '@/components/notes/NotesSourceLink';
import type { DailyNoteSource } from '@/types';
import type { ManagerDeskItem, ManagerDeskStatus } from '@/types/manager-desk';

interface MemoryListProps {
  mode: ManagerMemoryMode;
  items: ManagerDeskItem[];
  onStatusChange: (itemId: number, status: ManagerDeskStatus) => void;
  onOpenDesk: (item: ManagerDeskItem) => void;
  noteSources?: Map<number, DailyNoteSource>;
}

const followUpLanes: Array<{ id: ManagerMemoryLane; label: string }> = [
  { id: 'overdue', label: 'Overdue' },
  { id: 'today', label: 'Today' },
  { id: 'upcoming', label: 'Upcoming' },
  { id: 'unscheduled', label: 'Unscheduled' },
  { id: 'closed', label: 'Closed' },
];

const meetingLanes: Array<{ id: ManagerMemoryLane; label: string }> = [
  { id: 'today', label: 'Today' },
  { id: 'needs-actions', label: 'Needs action' },
  { id: 'upcoming', label: 'Upcoming' },
  { id: 'closed', label: 'Closed' },
];

export function MemoryList({ mode, items, onStatusChange, onOpenDesk, noteSources }: MemoryListProps) {
  const lanes = mode === 'follow-ups' ? followUpLanes : meetingLanes;

  if (items.length === 0) {
    return (
      <div className="flex min-h-[320px] items-center justify-center border-y" style={{ borderColor: 'var(--memory-line)' }}>
        <div className="max-w-sm text-center">
          <CheckCircle2 size={22} className="mx-auto" style={{ color: 'var(--success)' }} />
          <h2 className="mt-3 text-[15px] font-semibold" style={{ color: 'var(--text-primary)' }}>
            {mode === 'follow-ups' ? 'No follow-ups waiting' : 'No meetings captured'}
          </h2>
          <p className="mt-1 text-[13px] leading-5" style={{ color: 'var(--text-secondary)' }}>
            {mode === 'follow-ups'
              ? 'Add the next promise you need to close, then it will appear here and on Today.'
              : 'Capture a meeting when notes, decisions, or action items need to be remembered.'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-7">
      {lanes.map((lane) => {
        const laneItems = items.filter((item) => getMemoryLane(mode, item) === lane.id);
        if (laneItems.length === 0) return null;

        return (
          <section key={lane.id}>
            <div className="mb-2 flex items-center gap-2">
              <h2 className="text-[13px] font-semibold uppercase" style={{ color: lane.id === 'overdue' ? 'var(--danger)' : 'var(--text-secondary)' }}>
                {lane.label}
              </h2>
              <span className="rounded-md px-1.5 py-0.5 text-[11px] tabular-nums" style={{ background: 'var(--bg-tertiary)', color: 'var(--text-muted)' }}>
                {laneItems.length}
              </span>
            </div>
            <div style={{ borderTop: '1px solid var(--memory-line)', borderBottom: '1px solid var(--memory-line)' }}>
              {laneItems.map((item, index) => (
                <MemoryRow
                  key={item.id}
                  mode={mode}
                  item={item}
                  hasTopBorder={index > 0}
                  onStatusChange={onStatusChange}
                  onOpenDesk={onOpenDesk}
                  noteSource={noteSources?.get(item.id)}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function MemoryRow({
  mode,
  item,
  hasTopBorder,
  onStatusChange,
  onOpenDesk,
  noteSource,
}: {
  mode: ManagerMemoryMode;
  item: ManagerDeskItem;
  hasTopBorder: boolean;
  onStatusChange: (itemId: number, status: ManagerDeskStatus) => void;
  onOpenDesk: (item: ManagerDeskItem) => void;
  noteSource?: DailyNoteSource;
}) {
  const isClosed = isClosedMemoryItem(item);
  const primaryTime = mode === 'follow-ups' ? item.followUpAt : item.plannedStartAt;
  const personLabel = item.assignee?.displayName ?? item.participants ?? 'No person set';

  return (
    <article
      className="grid gap-3 px-1 py-3 md:grid-cols-[minmax(0,1fr)_150px_120px_148px] md:items-center"
      style={{ borderTop: hasTopBorder ? '1px solid var(--memory-line)' : 'none' }}
    >
      <div className="min-w-0">
        <h3 className="truncate text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>{item.title}</h3>
        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 text-[12px]" style={{ color: 'var(--text-muted)' }}>
          <span className="inline-flex min-w-0 items-center gap-1">
            <UserRound size={11} />
            <span className="truncate">{personLabel}</span>
          </span>
          {item.nextAction ? (
            <span className="inline-flex min-w-0 items-center gap-1">
              <MessageSquare size={11} />
              <span className="truncate">{item.nextAction}</span>
            </span>
          ) : null}
          {noteSource ? <NotesSourceLink source={noteSource} /> : null}
        </div>
      </div>

      <div className="flex items-center gap-1.5 text-[12px]" style={{ color: 'var(--text-secondary)' }}>
        <Clock3 size={12} style={{ color: 'var(--memory-accent)' }} />
        {formatMemoryDateTime(primaryTime)}
      </div>

      <div>
        <span className="rounded-md px-2 py-1 text-[11px] font-semibold" style={{ background: statusBackground(item.status), color: statusColor(item.status) }}>
          {statusLabel(item.status)}
        </span>
      </div>

      <div className="flex items-center gap-2 md:justify-end">
        {!isClosed ? (
          <button
            type="button"
            onClick={() => onStatusChange(item.id, 'done')}
            className="rounded-md px-2 py-1 text-[12px] font-semibold transition-colors hover:bg-[var(--memory-hover)]"
            style={{ color: 'var(--success)' }}
          >
            Done
          </button>
        ) : null}
        {mode === 'follow-ups' && !isClosed ? (
          <button
            type="button"
            onClick={() => onStatusChange(item.id, item.status === 'waiting' ? 'planned' : 'waiting')}
            className="rounded-md px-2 py-1 text-[12px] font-semibold transition-colors hover:bg-[var(--memory-hover)]"
            style={{ color: 'var(--warning)' }}
          >
            {item.status === 'waiting' ? 'Resume' : 'Waiting'}
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => onOpenDesk(item)}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[12px] font-semibold transition-colors hover:bg-[var(--memory-hover)]"
          style={{ color: 'var(--memory-accent)' }}
        >
          Desk
          <ArrowRight size={12} />
        </button>
      </div>
    </article>
  );
}

function statusLabel(status: ManagerDeskStatus): string {
  if (status === 'in_progress') return 'In progress';
  if (status === 'done') return 'Done';
  if (status === 'cancelled') return 'Dropped';
  if (status === 'inbox') return 'Inbox';
  if (status === 'planned') return 'Planned';
  if (status === 'waiting') return 'Waiting';
  if (status === 'backlog') return 'Later';
  return status;
}

function statusColor(status: ManagerDeskStatus): string {
  if (status === 'done') return 'var(--success)';
  if (status === 'waiting') return 'var(--warning)';
  if (status === 'cancelled') return 'var(--text-muted)';
  return 'var(--text-secondary)';
}

function statusBackground(status: ManagerDeskStatus): string {
  if (status === 'done') return 'color-mix(in srgb, var(--success) 13%, transparent)';
  if (status === 'waiting') return 'color-mix(in srgb, var(--warning) 14%, transparent)';
  return 'color-mix(in srgb, var(--bg-tertiary) 70%, transparent)';
}
