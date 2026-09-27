import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  AlignLeft,
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
  Pencil,
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
  SectionHeader,
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
      // docs/51 F3: my linked developer account is me — the "Me" option
      // already covers it, so the assign menu doesn't list self twice.
      developers: (list ?? []).filter((dev) => dev.accountId !== userId).map((dev) => ({ accountId: dev.accountId, displayName: dev.displayName })),
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
      {!isMeeting && task.dueAt && (
        <MomentRow label="Due" icon={<CalendarClock size={14} />} value={task.dueAt} status={task.status} editable={false} onCommit={() => undefined} />
      )}
      {/* Priority is shared data; only managers change it. */}
      {(manager || task.priority === 'high') && <PriorityRow task={task} editable={editable} onPatch={onPatch} />}
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

// ── Details (shared description) ────────────────────────────────────

/** Long enough that the read view folds behind "Show more". */
const DETAILS_FOLD_CHARS = 640;
const DETAILS_FOLD_LINES = 10;
export const TASK_DETAILS_MAX = 20000;

const URL_PATTERN = /(https?:\/\/[^\s<>]+[^\s<>().,;:!?'")\]])/g;

/** Plain text with bare URLs made clickable — details is not markdown. */
function LinkifiedText({ text }: { text: string }) {
  const parts = text.split(URL_PATTERN);
  return (
    <>
      {parts.map((part, index) =>
        index % 2 === 1 ? (
          <a
            key={index}
            href={part}
            target="_blank"
            rel="noreferrer noopener"
            onClick={(event) => event.stopPropagation()}
            className="break-all underline decoration-[color-mix(in_srgb,var(--accent)_45%,transparent)] underline-offset-2 hover:decoration-[var(--accent)]"
            style={{ color: 'var(--accent)' }}
          >
            {part}
          </a>
        ) : (
          <Fragment key={index}>{part}</Fragment>
        ),
      )}
    </>
  );
}

/**
 * The task's static description — what it is, why it matters, what done
 * looks like. Shared by design: the manager and the owning developer both
 * read and edit it. The running thread stays in Activity.
 */
export function TaskDetailsSection({ task, mode, editable, onPatch, people }: {
  task: TaskDetailResponse;
  mode: TaskDetailMode;
  editable: boolean;
  onPatch: Patch;
  people: TaskPeople;
}) {
  const value = task.details ?? '';
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [expanded, setExpanded] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const skipBlurCommit = useRef(false);

  // Never clobber a draft in progress with a background refetch.
  useEffect(() => { if (!editing) setDraft(value); }, [value, editing]);
  useEffect(() => { setEditing(false); setExpanded(false); }, [task.taskKey]);

  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    if (el.scrollHeight) el.style.height = `${el.scrollHeight}px`;
  }, [draft, editing]);

  useEffect(() => {
    if (!editing) return;
    const el = inputRef.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    el.setSelectionRange(el.value.length, el.value.length);
  }, [editing]);

  if (!editable && !value) return null;

  const startEditing = () => {
    if (!editable) return;
    skipBlurCommit.current = false;
    setDraft(value);
    setEditing(true);
  };
  const commit = () => {
    const next = draft.trim();
    if (next !== value.trim()) onPatch({ details: next || null });
    setEditing(false);
  };
  const discard = () => {
    setDraft(value);
    setEditing(false);
  };

  const ownerName = task.ownerType === 'developer' && task.ownerId ? people.nameFor(task.ownerId) : undefined;
  const hint = mode === 'developer' ? 'Shared with your lead' : ownerName && ownerName !== 'You' ? `Shared with ${ownerName}` : undefined;
  const long = value.length > DETAILS_FOLD_CHARS || value.split('\n').length > DETAILS_FOLD_LINES;
  const folded = long && !expanded;

  let body: ReactNode;
  if (editing) {
    body = (
      <div
        className="rounded-xl px-1 pb-1.5 pt-1"
        style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-active)' }}
      >
        <textarea
          ref={inputRef}
          value={draft}
          maxLength={TASK_DETAILS_MAX}
          rows={4}
          aria-label="Task details"
          placeholder="Context, links, acceptance criteria — anything the next person needs."
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => {
            if (skipBlurCommit.current) {
              skipBlurCommit.current = false;
              return;
            }
            commit();
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              skipBlurCommit.current = true;
              commit();
            }
            if (event.key === 'Escape') {
              // Keep the drawer open: Esc leaves the editor, the next one closes.
              event.stopPropagation();
              skipBlurCommit.current = true;
              discard();
            }
          }}
          className="block max-h-[60vh] min-h-[96px] w-full resize-none overflow-y-auto bg-transparent px-2 py-1.5 text-[13.5px] leading-[21px] outline-none placeholder:text-[var(--text-placeholder)]"
          style={{ color: 'var(--text-primary)' }}
        />
        <div className="flex items-center gap-2 px-2 pt-1">
          <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
            {draft.length > TASK_DETAILS_MAX * 0.9 ? `${draft.length.toLocaleString()} / ${TASK_DETAILS_MAX.toLocaleString()}` : '⌘/Ctrl ↵ to save · Esc to discard'}
          </span>
          <div className="ml-auto flex items-center gap-1">
            <button
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={discard}
              className={`h-7 rounded-lg px-2.5 text-[12px] font-medium transition-colors hover:bg-[var(--bg-tertiary)] ${FOCUS_RING}`}
              style={{ color: 'var(--text-secondary)' }}
            >
              Cancel
            </button>
            <button
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={commit}
              className={`h-7 rounded-lg px-2.5 text-[12px] font-semibold transition-[filter] hover:brightness-110 ${FOCUS_RING}`}
              style={{ background: 'var(--accent-glow)', color: 'var(--accent)' }}
            >
              Save
            </button>
          </div>
        </div>
      </div>
    );
  } else if (value) {
    body = (
      <div className="relative">
        <div
          onClick={(event) => {
            // Selecting text to copy shouldn't flip into the editor.
            if (window.getSelection()?.toString()) return;
            if ((event.target as HTMLElement).closest('a')) return;
            startEditing();
          }}
          className={`-mx-2 whitespace-pre-wrap break-words rounded-lg px-2 py-1.5 text-[13.5px] leading-[21px] transition-colors ${editable ? 'cursor-text hover:bg-[var(--bg-secondary)]' : ''} ${folded ? 'max-h-[210px] overflow-hidden' : ''}`}
          style={{
            color: 'var(--text-primary)',
            ...(folded ? { maskImage: 'linear-gradient(180deg, #000 70%, transparent)', WebkitMaskImage: 'linear-gradient(180deg, #000 70%, transparent)' } : {}),
          }}
        >
          <LinkifiedText text={value} />
        </div>
        {long && (
          <button
            type="button"
            onClick={() => setExpanded((open) => !open)}
            aria-expanded={expanded}
            className={`-ml-1 mt-0.5 inline-flex h-6 items-center rounded-md px-1 text-[12px] font-medium transition-colors hover:text-[var(--text-primary)] ${FOCUS_RING}`}
            style={{ color: 'var(--text-secondary)' }}
          >
            {expanded ? 'Show less' : 'Show more'}
          </button>
        )}
      </div>
    );
  } else {
    body = (
      <button
        type="button"
        onClick={startEditing}
        data-task-shortcut="d"
        className={`flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-[12.5px] transition-colors hover:bg-[var(--bg-tertiary)] ${FOCUS_RING}`}
        style={{ color: 'var(--text-muted)', border: '1px dashed var(--border)' }}
      >
        <AlignLeft size={13} />
        Add details — context, links, what done looks like
      </button>
    );
  }

  return (
    <section aria-labelledby={`details-${task.taskKey}`} className="space-y-2">
      <SectionHeader
        id={`details-${task.taskKey}`}
        icon={<AlignLeft size={14} />}
        title="Details"
        hint={hint}
        action={editable && value && !editing && (
          <button
            type="button"
            onClick={startEditing}
            data-task-shortcut="d"
            title="Edit details (D)"
            className={`flex h-7 items-center gap-1 rounded-lg px-2 text-[12px] font-medium transition-colors hover:bg-[var(--bg-tertiary)] ${FOCUS_RING}`}
            style={{ color: 'var(--text-secondary)' }}
          >
            <Pencil size={12} />
            Edit
          </button>
        )}
      />
      {body}
    </section>
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
