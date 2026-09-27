import { useMemo, useState } from 'react';
import {
  BellRing,
  CalendarArrowUp,
  CalendarClock,
  CalendarDays,
  Check,
  ChevronDown,
  Clock3,
  Eye,
  Flag,
  Moon,
  RotateCcw,
  Tag,
  UserRound,
  Users,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useDevelopers } from '@/hooks/useDevelopers';
import { isOpenStatus, scheduleChanges, type SchedulePreset } from '@/lib/task-list';
import { getLocalIsoDate } from '@/lib/utils';
import type { TaskDetailResponse, TaskStatus, UpdateTaskRequest } from '@/types';
import { AssignMenu, StatusMenu, TASK_STATUS_META, TaskStatusGlyph, type AssignTarget } from './TaskMenus';
import { MenuItem, TaskPopover } from './TaskPopover';
import { TaskLabelChip, TaskLabelPicker } from './TaskLabelPicker';
import {
  Avatar,
  DatePickerPopover,
  DateValue,
  FOCUS_RING,
  InlineTextField,
  Placeholder,
  PropertyButton,
  PropertyRow,
  type DatePreset,
} from './TaskDetailPrimitives';
import {
  describeMoment,
  describePlanDate,
  followUpPresets,
  formatStamp,
  toLocalDateTimeInputValue,
} from './task-detail-format';

export type TaskDetailMode = 'manager' | 'developer';
type Patch = (updates: UpdateTaskRequest) => void;

// ── People ──────────────────────────────────────────────────────────

export interface TaskPeople {
  developers: { accountId: string; displayName: string }[];
  /** Display name for an account id: "You" for the signed-in user, the developer name, else undefined. */
  nameFor: (id: string | null | undefined) => string | undefined;
  userId: string | undefined;
  /** Name used for "You" avatars. */
  userName: string;
}

export function useTaskPeople(mode: TaskDetailMode): TaskPeople {
  const { user } = useAuth();
  // Manager-only endpoint (P3 §3.3): developers skip the request.
  const developers = useDevelopers(undefined, { enabled: mode === 'manager' });
  const list = developers.data;
  const userId = user?.accountId;
  const userName = user?.displayName || user?.username || 'You';
  return useMemo(() => {
    const byId = new Map<string, string>();
    for (const dev of list ?? []) byId.set(dev.accountId, dev.displayName);
    return {
      developers: (list ?? []).map((dev) => ({ accountId: dev.accountId, displayName: dev.displayName })),
      nameFor: (id) => (!id ? undefined : id === userId ? 'You' : byId.get(id)),
      userId,
      userName,
    };
  }, [list, userId, userName]);
}

// ── Status ──────────────────────────────────────────────────────────

function statusTint(status: TaskStatus) {
  const { color } = TASK_STATUS_META[status];
  return {
    color: status === 'open' ? 'var(--text-secondary)' : color,
    background: `color-mix(in srgb, ${color} ${status === 'open' || status === 'dropped' ? 9 : 13}%, transparent)`,
    border: `1px solid color-mix(in srgb, ${color} ${status === 'open' || status === 'dropped' ? 22 : 30}%, transparent)`,
  };
}

export function StatusPill({ status }: { status: TaskStatus }) {
  return (
    <span
      className="inline-flex h-7 items-center gap-1.5 rounded-full pl-2 pr-2.5 text-[12px] font-semibold"
      style={statusTint(status)}
    >
      <TaskStatusGlyph status={status} size={13} />
      {TASK_STATUS_META[status].label}
    </span>
  );
}

/**
 * Status pill (full menu) + the one transition a manager reaches for most:
 * close it, or bring it back.
 */
export function StatusControl({ task, editable, onPatch }: { task: TaskDetailResponse; editable: boolean; onPatch: Patch }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  if (!editable) return <StatusPill status={task.status} />;
  const open = isOpenStatus(task.status);
  const tint = statusTint(task.status);
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <button
        type="button"
        onClick={(event) => setAnchor(anchor ? null : event.currentTarget)}
        aria-label={`Task status: ${TASK_STATUS_META[task.status].label}`}
        aria-haspopup="menu"
        aria-expanded={Boolean(anchor)}
        className={`group inline-flex h-7 items-center gap-1.5 rounded-full pl-2 pr-2 text-[12px] font-semibold transition-[filter] hover:brightness-125 ${FOCUS_RING}`}
        style={tint}
      >
        <TaskStatusGlyph status={task.status} size={13} />
        {TASK_STATUS_META[task.status].label}
        <ChevronDown size={12} className="opacity-60 transition-transform group-aria-expanded:rotate-180" />
      </button>
      <button
        type="button"
        onClick={() => onPatch({ status: open ? 'done' : 'open' })}
        title={open ? 'Mark done (E)' : 'Reopen (E)'}
        data-task-shortcut="e"
        className={`inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[12px] font-semibold transition-colors hover:bg-[var(--bg-tertiary)] ${FOCUS_RING}`}
        style={{ color: open ? 'var(--text-secondary)' : 'var(--text-muted)', border: '1px solid var(--border)' }}
      >
        {open ? <Check size={12} style={{ color: 'var(--success)' }} /> : <RotateCcw size={12} />}
        {open ? 'Mark done' : 'Reopen'}
      </button>
      {anchor && (
        <StatusMenu
          anchor={anchor}
          current={task.status}
          onClose={() => setAnchor(null)}
          onSelect={(status) => {
            setAnchor(null);
            if (status !== task.status) onPatch({ status });
          }}
        />
      )}
    </div>
  );
}

// ── Property list ───────────────────────────────────────────────────

interface TaskPropertiesProps {
  task: TaskDetailResponse;
  mode: TaskDetailMode;
  readOnly: boolean;
  onPatch: Patch;
  people: TaskPeople;
}

/** Owner, tracking, schedule, follow-up, priority, labels and meeting fields as one scannable list. */
export function TaskProperties({ task, mode, readOnly, onPatch, people }: TaskPropertiesProps) {
  const manager = mode === 'manager';
  const editable = manager && !readOnly;
  const isMeeting = task.kind === 'meeting';
  return (
    <dl className="space-y-0.5">
      {manager && <OwnerRow task={task} editable={editable} onPatch={onPatch} people={people} />}
      {manager && <TrackedByRow task={task} people={people} />}
      {isMeeting && (
        <>
          <MomentRow label="Starts" icon={<Clock3 size={14} />} value={task.startsAt} status={task.status} editable={editable} onCommit={(v) => onPatch({ startsAt: v })} />
          <MomentRow label="Ends" icon={<Clock3 size={14} />} value={task.endsAt} status={task.status} editable={editable} onCommit={(v) => onPatch({ endsAt: v })} />
          <PropertyRow icon={<Users size={14} />} label="Participants">
            <InlineTextField
              value={task.participants ?? ''}
              placeholder="e.g. Design Team, Rahul"
              ariaLabel="Participants"
              disabled={!editable}
              onCommit={(v) => onPatch({ participants: v || null })}
            />
          </PropertyRow>
        </>
      )}
      <ScheduleRow task={task} editable={editable} canLater={manager && !isMeeting} onPatch={onPatch} />
      {manager && !isMeeting && (
        <MomentRow
          label="Follow-up"
          icon={<BellRing size={14} />}
          value={'followUpAt' in task ? task.followUpAt : null}
          status={task.status}
          editable={editable}
          presets
          onCommit={(v) => onPatch({ followUpAt: v })}
        />
      )}
      {manager && <PriorityRow task={task} editable={editable} onPatch={onPatch} />}
      {manager ? (
        <PropertyRow icon={<Tag size={14} />} label="Labels" align="start">
          <div data-task-shortcut="l" className="min-h-[32px] rounded-lg px-1.5 py-[5px] transition-colors hover:bg-[var(--bg-tertiary)] focus-within:bg-[var(--bg-tertiary)]">
            <TaskLabelPicker
              labels={'labels' in task ? task.labels : []}
              disabled={readOnly}
              onChange={(next) => onPatch({ labels: next })}
            />
            {readOnly && !('labels' in task && task.labels.length) && <Placeholder>None</Placeholder>}
          </div>
        </PropertyRow>
      ) : (
        <DeveloperLabels task={task} />
      )}
    </dl>
  );
}

function OwnerRow({ task, editable, onPatch, people }: { task: TaskDetailResponse; editable: boolean; onPatch: Patch; people: TaskPeople }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const name = !task.ownerType || !task.ownerId
    ? null
    : people.nameFor(task.ownerId) ?? (task.ownerType === 'manager' ? 'Another manager' : task.ownerId);

  const select = (target: AssignTarget) => {
    setAnchor(null);
    const ownerId = target.ownerType === 'manager' ? people.userId ?? null : target.ownerId;
    const ownerType = ownerId ? target.ownerType : null;
    if (ownerType === task.ownerType && ownerId === task.ownerId) return;
    onPatch({ ownerType, ownerId });
  };

  return (
    <PropertyRow icon={<UserRound size={14} />} label="Owner">
      <PropertyButton
        disabled={!editable}
        ariaLabel={`Owner: ${name ?? 'Unassigned'}`}
        title="Assign (A)"
        shortcut="a"
        popup="menu"
        expanded={Boolean(anchor)}
        onClick={(el) => setAnchor(anchor ? null : el)}
      >
        {name ? (
          <>
            <Avatar name={name === 'You' ? people.userName : name} seed={task.ownerId ?? undefined} />
            <span className="truncate font-medium">{name}</span>
          </>
        ) : (
          <>
            <Avatar name="?" muted />
            <Placeholder>Unassigned</Placeholder>
            <span className="text-[11.5px]" style={{ color: 'var(--text-muted)' }}>Inbox</span>
          </>
        )}
      </PropertyButton>
      {anchor && <AssignMenu anchor={anchor} developers={people.developers} onClose={() => setAnchor(null)} onSelect={select} />}
    </PropertyRow>
  );
}

function TrackedByRow({ task, people }: { task: TaskDetailResponse; people: TaskPeople }) {
  const trackedBy = 'trackedByManagerId' in task ? task.trackedByManagerId : null;
  const label = trackedBy ? people.nameFor(trackedBy) ?? 'Another manager' : null;
  return (
    <PropertyRow icon={<Eye size={14} />} label="Tracked by">
      <span className="flex min-h-[32px] items-center gap-2 px-2 text-[13px]" style={{ color: 'var(--text-secondary)' }} title={trackedBy ?? undefined}>
        {label ? (
          <>
            <Avatar name={label === 'You' ? people.userName : label} seed={trackedBy ?? undefined} size={18} />
            {label}
          </>
        ) : (
          <Placeholder>No one</Placeholder>
        )}
      </span>
    </PropertyRow>
  );
}

const SCHEDULE_PRESETS: { preset: Exclude<SchedulePreset, 'later' | 'clear'>; label: string; key: string; Icon: typeof CalendarDays }[] = [
  { preset: 'today', label: 'Today', key: 't', Icon: CalendarClock },
  { preset: 'tomorrow', label: 'Tomorrow', key: 'm', Icon: CalendarArrowUp },
  { preset: 'next-week', label: 'Next week', key: 'w', Icon: CalendarDays },
];

function ScheduleRow({ task, editable, canLater, onPatch }: { task: TaskDetailResponse; editable: boolean; canLater: boolean; onPatch: Patch }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const later = canLater && 'later' in task ? task.later : false;
  const today = getLocalIsoDate();

  const apply = (changes: UpdateTaskRequest) => {
    setAnchor(null);
    if (!canLater) {
      const { later: _later, ...rest } = changes;
      onPatch(rest);
      return;
    }
    onPatch(changes);
  };

  const presets: DatePreset[] = SCHEDULE_PRESETS.map(({ preset, label, key, Icon }) => ({
    key: preset,
    label,
    hint: key,
    icon: <Icon size={13} />,
    onSelect: () => apply(scheduleChanges(preset, today)),
  }));
  if (canLater) {
    presets.push({
      key: 'later',
      label: 'Later — park it',
      hint: 'l',
      icon: <Moon size={13} />,
      checked: later,
      onSelect: () => apply(later ? { later: false } : { later: true }),
    });
  }

  const display = later ? null : describePlanDate(task.scheduledOn, task.status, today);
  const text = later ? 'Later' : display?.label ?? 'Not scheduled';

  return (
    <PropertyRow icon={later ? <Moon size={14} /> : <CalendarDays size={14} />} label="Scheduled">
      <PropertyButton
        disabled={!editable}
        ariaLabel={`Scheduled: ${text}`}
        title="Schedule (S)"
        shortcut="s"
        expanded={Boolean(anchor)}
        onClick={(el) => setAnchor(anchor ? null : el)}
      >
        {later ? (
          <span className="flex min-w-0 items-baseline gap-1.5">
            <span className="font-medium" style={{ color: 'var(--info)' }}>Later</span>
            <span className="truncate text-[11.5px]" style={{ color: 'var(--text-muted)' }}>parked, off today&apos;s list</span>
          </span>
        ) : (
          <DateValue display={display} empty="Not scheduled" />
        )}
      </PropertyButton>
      {anchor && (
        <DatePickerPopover
          anchor={anchor}
          label="Schedule"
          kind="date"
          value={task.scheduledOn ?? ''}
          presets={presets}
          clearLabel="Clear date"
          onAccelerator={(key) => {
            const preset = presets.find((candidate) => candidate.hint === key.toLowerCase());
            preset?.onSelect();
            return Boolean(preset);
          }}
          onCommit={(value) => apply(value ? { scheduledOn: value, later: false } : { scheduledOn: null })}
          onClose={() => setAnchor(null)}
        />
      )}
    </PropertyRow>
  );
}

function MomentRow({ label, icon, value, status, editable, presets = false, onCommit }: {
  label: string;
  icon: React.ReactNode;
  value: string | null;
  status: TaskStatus;
  editable: boolean;
  presets?: boolean;
  onCommit: (value: string | null) => void;
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const display = describeMoment(value, status);
  const commit = (next: string | null) => {
    setAnchor(null);
    onCommit(next);
  };
  const options: DatePreset[] = presets
    ? followUpPresets().map((preset) => ({
      key: preset.key,
      label: preset.label,
      hint: preset.hint,
      icon: <BellRing size={13} />,
      onSelect: () => commit(preset.value),
    }))
    : [];
  return (
    <PropertyRow icon={icon} label={label}>
      <PropertyButton
        disabled={!editable}
        ariaLabel={`${label}: ${display?.label ?? 'Not set'}`}
        expanded={Boolean(anchor)}
        onClick={(el) => setAnchor(anchor ? null : el)}
      >
        <DateValue display={display} empty={editable ? 'Set a time' : 'Not set'} />
      </PropertyButton>
      {anchor && (
        <DatePickerPopover
          anchor={anchor}
          label={label}
          kind="datetime-local"
          value={toLocalDateTimeInputValue(value)}
          presets={options}
          onCommit={(next) => commit(next ? new Date(next).toISOString() : null)}
          onClose={() => setAnchor(null)}
        />
      )}
    </PropertyRow>
  );
}

function PriorityRow({ task, editable, onPatch }: { task: TaskDetailResponse; editable: boolean; onPatch: Patch }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const high = task.priority === 'high';
  const choose = (priority: 'normal' | 'high') => {
    setAnchor(null);
    if (priority !== task.priority) onPatch({ priority });
  };
  return (
    <PropertyRow icon={<Flag size={14} />} label="Priority">
      <PropertyButton
        disabled={!editable}
        ariaLabel={`Priority: ${high ? 'High' : 'Normal'}`}
        title="Priority (P)"
        shortcut="p"
        popup="menu"
        expanded={Boolean(anchor)}
        onClick={(el) => setAnchor(anchor ? null : el)}
      >
        {high ? (
          <span className="flex items-center gap-1.5 font-semibold" style={{ color: 'var(--danger)' }}>
            <Flag size={12} fill="currentColor" />
            High
          </span>
        ) : (
          <span style={{ color: 'var(--text-secondary)' }}>Normal</span>
        )}
      </PropertyButton>
      {anchor && (
        <TaskPopover
          anchor={anchor}
          onClose={() => setAnchor(null)}
          label="Priority"
          width={172}
          onAccelerator={(key) => {
            if (key === 'h') choose('high');
            else if (key === 'n') choose('normal');
            else return false;
            return true;
          }}
        >
          <MenuItem role="menuitemradio" checked={!high} icon={<Flag size={13} />} label="Normal" hint="n" onSelect={() => choose('normal')} />
          <MenuItem
            role="menuitemradio"
            checked={high}
            icon={<Flag size={13} fill="currentColor" style={{ color: 'var(--danger)' }} />}
            label="High"
            hint="h"
            onSelect={() => choose('high')}
          />
        </TaskPopover>
      )}
    </PropertyRow>
  );
}

function DeveloperLabels({ task }: { task: TaskDetailResponse }) {
  // The label registry is a manager endpoint — developers see chip names in
  // the default color instead of issuing a 403'd request.
  const labels = 'labels' in task ? task.labels : [];
  if (!labels.length) return null;
  return (
    <PropertyRow icon={<Tag size={14} />} label="Labels" align="start">
      <div className="flex flex-wrap gap-1 px-2 py-[7px]">
        {labels.map((name) => <TaskLabelChip key={name} name={name} />)}
      </div>
    </PropertyRow>
  );
}

// ── Meeting outcome ─────────────────────────────────────────────────

export function MeetingOutcome({ task, editable, onPatch }: { task: TaskDetailResponse; editable: boolean; onPatch: Patch }) {
  return (
    <div
      className="rounded-xl px-2 py-2"
      style={{ background: 'color-mix(in srgb, var(--bg-secondary) 70%, transparent)', border: '1px solid var(--border)' }}
    >
      <div className="px-2 pb-1 text-[12px] font-semibold" style={{ color: 'var(--text-secondary)' }}>Outcome</div>
      <InlineTextField
        value={task.outcome ?? ''}
        placeholder="What was decided?"
        ariaLabel="Outcome"
        multiline
        disabled={!editable}
        onCommit={(v) => onPatch({ outcome: v || null })}
      />
    </div>
  );
}

// ── Metadata ────────────────────────────────────────────────────────

export function taskMetaEntries(task: TaskDetailResponse, people: TaskPeople): [string, string][] {
  const creator = task.createdById ? people.nameFor(task.createdById) : undefined;
  const createdBy = creator ?? `${task.createdByType.charAt(0).toUpperCase()}${task.createdByType.slice(1)}${task.createdById && task.createdByType !== 'manager' ? ` (${task.createdById})` : ''}`;
  const entries: [string, string][] = [
    ['Created by', createdBy],
    ['Created', formatStamp(task.createdAt)],
    ['Updated', formatStamp(task.updatedAt)],
  ];
  if (task.kind === 'meeting' && task.dueAt) entries.push(['Due', formatStamp(task.dueAt)]);
  if (task.closedAt) entries.push(['Closed', formatStamp(task.closedAt)]);
  return entries;
}

export function TaskMetaList({ task, people }: { task: TaskDetailResponse; people: TaskPeople }) {
  return (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-[12px]">
      {taskMetaEntries(task, people).map(([label, value]) => (
        <div key={label} className="contents">
          <dt style={{ color: 'var(--text-muted)' }}>{label}</dt>
          <dd className="truncate tabular-nums" style={{ color: 'var(--text-secondary)' }} title={value}>{value}</dd>
        </div>
      ))}
    </dl>
  );
}
