import { useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { AnimatePresence } from 'framer-motion';
import { ChevronDown, ChevronRight, UserMinus, X } from 'lucide-react';
import type { TrackerDeveloperDay, TrackerDeveloperStatus } from '@/types';
import type { TrackerWorkItem } from '@/types';
import { formatAbsoluteDateTime, formatRelativeTime } from '@/lib/utils';
import { useToast } from '@/context/ToastContext';
import { useStatusUpdate } from '@/hooks/useTeamTrackerMutations';
import type { TaskPickerTask } from '@/components/tasks/TaskPicker';
import { TrackerItemRow } from './TrackerItemRow';
import { TrackerSignalBadges } from './TrackerSignalBadges';
import { TrackerStatusPill } from './TrackerStatusPill';
import { StatusRationaleDialog } from './StatusRationaleDialog';

const statusOptions: TrackerDeveloperStatus[] = ['on_track', 'at_risk', 'blocked', 'waiting', 'done_for_today'];
const statusLabels: Record<TrackerDeveloperStatus, string> = {
  on_track: 'On track',
  at_risk: 'At risk',
  blocked: 'Blocked',
  waiting: 'Waiting',
  done_for_today: 'Done',
};

const statusStyles: Record<TrackerDeveloperStatus, { color: string; background: string }> = {
  on_track: { color: 'var(--success)', background: 'rgba(16, 185, 129, 0.15)' },
  at_risk: { color: 'var(--warning)', background: 'rgba(245, 158, 11, 0.15)' },
  blocked: { color: 'var(--danger)', background: 'rgba(239, 68, 68, 0.15)' },
  waiting: { color: 'var(--info)', background: 'rgba(139, 92, 246, 0.15)' },
  done_for_today: { color: 'var(--accent)', background: 'rgba(6, 182, 212, 0.15)' },
};

type UpdateDayHandler = (params: {
  accountId: string;
  status?: TrackerDeveloperStatus;
  capacityUnits?: number | null;
  managerNotes?: string;
}) => void;

interface DrawerHeaderProps {
  day: TrackerDeveloperDay;
  date: string;
  tasks?: TaskPickerTask[];
  loadLabel: string;
  isOverCapacity: boolean;
  readOnly: boolean;
  onClose: () => void;
  onMarkInactive?: (day: TrackerDeveloperDay) => void;
}

export function DrawerHeader({
  day,
  date,
  tasks = [],
  loadLabel,
  isOverCapacity,
  readOnly,
  onClose,
  onMarkInactive,
}: DrawerHeaderProps) {
  const initials = day.developer.displayName
    .split(' ')
    .map((name) => name[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <div
      className="shrink-0 px-6 py-5"
      style={{ borderBottom: '1px solid color-mix(in srgb, var(--border) 58%, transparent)' }}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-4">
          <div
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-[13px] font-semibold"
            style={{
              background: 'linear-gradient(135deg, color-mix(in srgb, var(--accent) 16%, var(--bg-tertiary)), color-mix(in srgb, var(--bg-elevated) 45%, var(--bg-secondary)))',
              color: 'var(--accent)',
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.08)',
            }}
          >
            {initials}
          </div>
          <div className="min-w-0">
            <div className="truncate text-[18px] font-semibold leading-6" style={{ color: 'var(--text-primary)' }}>
              {day.developer.displayName}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-[12px]" style={{ color: 'var(--text-muted)' }}>
              <StatusPillSelect day={day} date={date} tasks={tasks} readOnly={readOnly} />
              <span className="inline-flex items-center gap-1">
                <span>Load</span>
                <span className="font-mono font-semibold tabular-nums" style={{ color: isOverCapacity ? 'var(--danger)' : 'var(--text-primary)' }}>
                  {loadLabel}
                </span>
              </span>
              <span className="inline-flex items-center gap-1">
                <span>Done</span>
                <span className="font-mono font-semibold tabular-nums" style={{ color: 'var(--text-primary)' }}>
                  {day.completedItems.length}
                </span>
              </span>
              {day.lastCheckInAt ? (
                <span
                  style={{ color: day.signals.freshness.staleByTime ? 'var(--warning)' : 'var(--text-muted)' }}
                  title={formatAbsoluteDateTime(day.lastCheckInAt)}
                >
                  Check-in {formatRelativeTime(day.lastCheckInAt)}
                </span>
              ) : (
                <span>No check-in</span>
              )}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {!readOnly && onMarkInactive && (
            <button
              type="button"
              onClick={() => onMarkInactive(day)}
              className="flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:brightness-125 focus:outline-none focus:ring-2 focus:ring-[var(--border-active)]"
              style={{
                background: 'color-mix(in srgb, var(--warning) 9%, transparent)',
                color: 'var(--warning)',
              }}
              aria-label={`Mark ${day.developer.displayName} inactive`}
              title={`Mark ${day.developer.displayName} inactive`}
            >
              <UserMinus size={15} />
            </button>
          )}
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--border-active)]"
            style={{ background: 'color-mix(in srgb, var(--bg-tertiary) 72%, transparent)' }}
            aria-label="Close developer details"
            title="Close"
          >
            <X size={16} style={{ color: 'var(--text-secondary)' }} />
          </button>
        </div>
      </div>
    </div>
  );
}

interface StatusPillSelectProps {
  day: TrackerDeveloperDay;
  date: string;
  tasks: TaskPickerTask[];
  readOnly: boolean;
}

const DIALOG_STATUSES: TrackerDeveloperStatus[] = ['at_risk', 'blocked', 'waiting'];

function StatusPillSelect({ day, date, tasks, readOnly }: StatusPillSelectProps) {
  const { addToast } = useToast();
  const statusUpdate = useStatusUpdate(date);
  const [pendingStatus, setPendingStatus] = useState<TrackerDeveloperStatus | null>(null);

  if (readOnly) {
    return <TrackerStatusPill status={day.status} size="sm" />;
  }

  const style = statusStyles[day.status];

  const handleChange = (status: TrackerDeveloperStatus) => {
    if (status === day.status) {
      return;
    }
    if (DIALOG_STATUSES.includes(status)) {
      setPendingStatus(status);
      return;
    }
    statusUpdate.mutate(
      { accountId: day.developer.accountId, status },
      { onError: (error) => addToast(error.message, 'error') },
    );
  };

  return (
    <span className="relative inline-flex shrink-0">
      <select
        value={day.status}
        onChange={(event) => handleChange(event.target.value as TrackerDeveloperStatus)}
        className="h-7 appearance-none rounded-lg py-0 pl-2.5 pr-6 text-[12px] font-semibold outline-none transition-colors focus:ring-2 focus:ring-[var(--border-active)]"
        style={{
          color: style.color,
          background: style.background,
          border: '1px solid transparent',
        }}
        aria-label="Change developer status"
        title="Change developer status"
      >
        {statusOptions.map((status) => (
          <option key={status} value={status}>
            {statusLabels[status]}
          </option>
        ))}
      </select>
      <ChevronDown
        size={11}
        className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2"
        style={{ color: style.color }}
      />
      <AnimatePresence>
        {pendingStatus && (
          <StatusRationaleDialog
            status={pendingStatus}
            developerName={day.developer.displayName}
            tasks={tasks}
            initialSelectedKeys={
              day.statusSuggestion?.status === pendingStatus
                ? [day.statusSuggestion.reasonTaskKey]
                : undefined
            }
            isPending={statusUpdate.isPending}
            error={statusUpdate.error?.message}
            onClose={() => {
              if (!statusUpdate.isPending) {
                statusUpdate.reset();
                setPendingStatus(null);
              }
            }}
            onSubmit={({ rationale, taskKey, nextFollowUpAt }) =>
              statusUpdate.mutate(
                {
                  accountId: day.developer.accountId,
                  status: pendingStatus,
                  rationale,
                  taskKey,
                  nextFollowUpAt,
                },
                {
                  onSuccess: () => setPendingStatus(null),
                },
              )
            }
          />
        )}
      </AnimatePresence>
    </span>
  );
}

interface StatusSummaryProps {
  day: TrackerDeveloperDay;
  readOnly: boolean;
  capacityText: string;
  setCapacityText: Dispatch<SetStateAction<string>>;
  onUpdateDay: UpdateDayHandler;
  onSaveCapacity: () => void;
}

export function StatusSummary({
  day,
  readOnly,
  capacityText,
  setCapacityText,
  onUpdateDay,
  onSaveCapacity,
}: StatusSummaryProps) {
  return (
    <div className="shrink-0 px-6 pb-4">
      <div
        className="flex flex-wrap items-center justify-between gap-3 rounded-2xl px-4 py-3"
        style={{
          background: 'color-mix(in srgb, var(--bg-tertiary) 48%, transparent)',
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04)',
        }}
      >
        <div className="min-w-0 flex-1 space-y-1">
          <div className="text-[11px] font-medium" style={{ color: 'var(--text-muted)' }}>
            Attention signals
          </div>
          <TrackerSignalBadges day={day} compact maxItems={3} />
        </div>
        <div className="flex shrink-0 items-center gap-1.5 rounded-xl px-2 py-1" style={{ background: 'color-mix(in srgb, var(--bg-primary) 42%, transparent)' }}>
          <span className="text-[12px]" style={{ color: 'var(--text-muted)' }}>Capacity</span>
          <input
            type="number"
            min={1}
            inputMode="numeric"
            value={capacityText}
            onChange={(event) => setCapacityText(event.target.value)}
            disabled={readOnly}
            placeholder="-"
            className="w-11 rounded-lg px-1.5 py-1 text-center text-[13px] font-mono outline-none"
            style={{
              background: 'color-mix(in srgb, var(--bg-elevated) 52%, var(--bg-tertiary))',
              color: 'var(--text-primary)',
              border: '1px solid color-mix(in srgb, var(--border) 55%, transparent)',
            }}
          />
          <button
            type="button"
            onClick={onSaveCapacity}
            disabled={readOnly}
            className="rounded-lg px-2 py-1 text-[12px] font-medium transition-colors disabled:opacity-40"
            style={{ background: 'color-mix(in srgb, var(--accent) 12%, transparent)', color: 'var(--accent)' }}
          >
            Save
          </button>
          {!readOnly && day.capacityUnits !== undefined && day.capacityUnits !== null && (
            <button
              type="button"
              onClick={() => {
                setCapacityText('');
                onUpdateDay({ accountId: day.developer.accountId, capacityUnits: null });
              }}
              className="px-1 text-[12px]"
              style={{ color: 'var(--text-muted)' }}
            >
              Clear
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

interface DrawerSectionProps {
  title: string;
  count?: number;
  action?: ReactNode;
  children: ReactNode;
}

export function DrawerSection({ title, count, action, children }: DrawerSectionProps) {
  return (
    <section className="mb-5">
      <div className="mb-2.5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-[13px] font-semibold" style={{ color: 'var(--text-secondary)' }}>
          <span>{title}</span>
          {typeof count === 'number' && (
            <span
              className="rounded-md px-1.5 py-0.5 font-mono text-[11px] tabular-nums"
              style={{
                color: 'var(--text-muted)',
                background: 'color-mix(in srgb, var(--bg-tertiary) 54%, transparent)',
              }}
            >
              {count}
            </span>
          )}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

interface HistorySectionProps {
  title: string;
  items: TrackerWorkItem[];
  open: boolean;
  onToggle: () => void;
}

export function HistorySection({ title, items, open, onToggle }: HistorySectionProps) {
  const hasItems = items.length > 0;

  return (
    <section className="mb-2.5">
      <button
        type="button"
        onClick={hasItems ? onToggle : undefined}
        disabled={!hasItems}
        className="flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left transition-colors disabled:cursor-default"
        style={{
          background: hasItems ? 'color-mix(in srgb, var(--bg-tertiary) 46%, transparent)' : 'transparent',
          color: hasItems ? 'var(--text-secondary)' : 'var(--text-muted)',
        }}
        aria-expanded={hasItems ? open : undefined}
      >
        <span className="text-[13px] font-semibold">
          {title} <span className="font-mono text-[12px] tabular-nums" style={{ color: 'var(--text-muted)' }}>{items.length}</span>
        </span>
        {hasItems && (
          open ? <ChevronDown size={14} /> : <ChevronRight size={14} />
        )}
      </button>
      {hasItems && open && (
        <div
          className="mt-2 overflow-hidden rounded-xl"
          style={{ background: 'color-mix(in srgb, var(--bg-tertiary) 28%, transparent)' }}
        >
          {items.map((item) => (
            <TrackerItemRow key={item.id} item={item} compact hideActions onOpen={undefined} />
          ))}
        </div>
      )}
    </section>
  );
}
