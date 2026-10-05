import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import {
  Ban,
  CalendarArrowUp,
  CalendarClock,
  CalendarDays,
  CalendarX,
  Check,
  CircleCheck,
  CircleDashed,
  CircleDot,
  CircleSlash,
  CircleX,
  Circle,
  Flag,
  Folder,
  Hourglass,
  Link2,
  Moon,
  Tag,
  UserRound,
  UserX,
} from 'lucide-react';
import { taskLabelDisplayName, type TaskLabel, type TaskStatus, type TaskWaitingOnInput } from '@/types';
import { nextMonday, nextWeekday, type SchedulePreset } from '@/lib/task-list';
import { shiftLocalIsoDate } from '@/lib/utils';
import { labelChipStyle } from './label-colors';
import { DatePickerPopover, type DatePreset } from './TaskDetailPrimitives';
import { MenuDivider, MenuHeading, MenuItem, TaskPopover } from '@/components/ui/Popover';

/** docs/49 §5: status glyphs — never a done-checkbox. */
export const TASK_STATUS_META: Record<TaskStatus, { label: string; color: string; Icon: typeof Circle }> = {
  open: { label: 'Open', color: 'var(--text-muted)', Icon: Circle },
  active: { label: 'Active', color: 'var(--accent)', Icon: CircleDot },
  blocked: { label: 'Blocked', color: 'var(--danger)', Icon: CircleSlash },
  done: { label: 'Done', color: 'var(--success)', Icon: CircleCheck },
  dropped: { label: 'Dropped', color: 'var(--text-disabled)', Icon: CircleX },
};

const STATUS_ORDER: TaskStatus[] = ['open', 'active', 'blocked', 'done', 'dropped'];

export function TaskStatusGlyph({ status, size = 15 }: { status: TaskStatus; size?: number }) {
  const reduceMotion = useReducedMotion();
  // docs/51 P3: animate only on a real status change — a fresh mount or a
  // view switch with the same status must not flash a scale-in.
  const previous = useRef<TaskStatus | null>(null);
  const changed = previous.current !== null && previous.current !== status;
  useEffect(() => { previous.current = status; }, [status]);
  const { Icon, color } = TASK_STATUS_META[status];
  return (
    <motion.span
      key={status}
      initial={reduceMotion || !changed ? false : { scale: 0.6, opacity: 0.4 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ type: 'spring', stiffness: 500, damping: 28 }}
      className="flex items-center justify-center"
      style={{ color }}
    >
      <Icon size={size} strokeWidth={2} />
    </motion.span>
  );
}

export type TaskMenuKind = 'status' | 'schedule' | 'assign' | 'label' | 'priority' | 'waiting' | 'checkBy' | 'project' | 'more';

export function StatusMenu({ anchor, current, onClose, onSelect }: {
  anchor: HTMLElement;
  current?: TaskStatus;
  onClose: () => void;
  onSelect: (status: TaskStatus) => void;
}) {
  return (
    <TaskPopover anchor={anchor} onClose={onClose} label="Set status" width={180}>
      {STATUS_ORDER.map((status) => {
        const { Icon, color, label } = TASK_STATUS_META[status];
        return (
          <MenuItem
            key={status}
            role="menuitemradio"
            checked={status === current}
            icon={<Icon size={13} style={{ color }} />}
            label={label}
            onSelect={() => onSelect(status)}
          />
        );
      })}
    </TaskPopover>
  );
}

/**
 * docs/51 F8: the list's schedule menu is the same picker the drawer uses —
 * presets with their single-key accelerators plus an exact date that only
 * commits on Set/Enter. Digit accelerators jump to the next weekday (1=Mon …
 * 7=Sun, strictly after today).
 */
export function ScheduleMenu({ anchor, today, current, laterActive, onClose, onSelect, onPickDate, allowLater = true }: {
  anchor: HTMLElement;
  today: string;
  /** Single-target scheduledOn for the date field ('' when mixed or unset). */
  current?: string | null;
  /** Single/multi-target Later state for the Later checkbox. */
  laterActive?: boolean;
  onClose: () => void;
  onSelect: (preset: SchedulePreset) => void;
  onPickDate: (date: string) => void;
  allowLater?: boolean;
}) {
  const presets: DatePreset[] = [
    { key: 't', label: 'Today', hint: 't', icon: <CalendarClock size={13} />, onSelect: () => onSelect('today') },
    { key: 'm', label: 'Tomorrow', hint: 'm', icon: <CalendarArrowUp size={13} />, onSelect: () => onSelect('tomorrow') },
    { key: 'w', label: 'Next week (Mon)', hint: 'w', icon: <CalendarDays size={13} />, onSelect: () => onSelect('next-week') },
    ...(allowLater
      ? [{ key: 'l', label: 'Later', hint: 'l', icon: <Moon size={13} />, checked: laterActive === true, onSelect: () => onSelect('later' as const) }]
      : []),
    { key: 'c', label: 'Clear date', hint: 'c', icon: <CalendarX size={13} />, onSelect: () => onSelect('clear') },
  ];
  return (
    <DatePickerPopover
      anchor={anchor}
      label="Schedule"
      kind="date"
      value={current ?? ''}
      presets={presets}
      clearLabel={null}
      onCommit={(date) => { if (date) onPickDate(date); }}
      onClose={onClose}
      onAccelerator={(key) => {
        const preset = presets.find((candidate) => candidate.key === key.toLowerCase());
        if (preset) {
          preset.onSelect();
          return true;
        }
        const weekday = Number(key);
        if (Number.isInteger(weekday) && weekday >= 1 && weekday <= 7) {
          onPickDate(nextWeekday(today, weekday));
          return true;
        }
        return false;
      }}
    />
  );
}

export type TaskPriority = 'normal' | 'high';

export function PriorityMenu({ anchor, current, onClose, onSelect }: {
  anchor: HTMLElement;
  current?: TaskPriority;
  onClose: () => void;
  onSelect: (priority: TaskPriority) => void;
}) {
  return (
    <TaskPopover anchor={anchor} onClose={onClose} label="Set priority" width={170}>
      {(['normal', 'high'] as const).map((priority) => (
        <MenuItem
          key={priority}
          role="menuitemradio"
          checked={priority === current}
          icon={<Flag size={13} style={{ color: priority === 'high' ? 'var(--danger)' : 'var(--text-muted)' }} />}
          label={priority === 'high' ? 'High' : 'Normal'}
          onSelect={() => onSelect(priority)}
        />
      ))}
    </TaskPopover>
  );
}

export interface AssignTarget {
  ownerType: 'manager' | 'developer' | null;
  ownerId: string | null;
}

export function AssignMenu({ anchor, developers, onClose, onSelect }: {
  anchor: HTMLElement;
  developers: { accountId: string; displayName: string }[];
  onClose: () => void;
  onSelect: (target: AssignTarget) => void;
}) {
  const [query, setQuery] = useState('');
  const options = useMemo(() => {
    const all: { key: string; label: string; target: AssignTarget }[] = [
      // docs/56 UX-09: the manager is "You" everywhere.
      { key: 'me', label: 'You', target: { ownerType: 'manager', ownerId: null } },
      ...developers.map((dev) => ({ key: dev.accountId, label: dev.displayName, target: { ownerType: 'developer' as const, ownerId: dev.accountId } })),
      { key: 'inbox', label: 'Unassigned (Inbox)', target: { ownerType: null, ownerId: null } },
    ];
    const needle = query.trim().toLowerCase();
    return needle ? all.filter((option) => option.label.toLowerCase().includes(needle)) : all;
  }, [developers, query]);

  return (
    <TaskPopover anchor={anchor} onClose={onClose} label="Assign" width={220}>
      <input
        data-autofocus
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && options[0]) {
            event.preventDefault();
            onSelect(options[0].target);
          }
        }}
        placeholder="Assign to…"
        aria-label="Filter people"
        className="mb-1 w-full rounded-lg px-2 py-1.5 text-[12.5px] outline-none"
        style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
      />
      {options.map((option) => (
        <MenuItem key={option.key} icon={<UserRound size={13} />} label={option.label} onSelect={() => onSelect(option.target)} />
      ))}
      {options.length === 0 && <p className="px-2 py-1.5 text-[12px]" style={{ color: 'var(--text-muted)' }}>No match</p>}
    </TaskPopover>
  );
}

/**
 * docs/57 §4 (P3-03): `w` — who the task waits on: a developer, one of my
 * contacts, or free text typed in the filter. Clearing ends the wait.
 */
export function WaitingMenu({ anchor, developers, contacts, current, onClose, onSelect }: {
  anchor: HTMLElement;
  developers: { accountId: string; displayName: string }[];
  contacts: { id: number; displayName: string }[];
  /** Whether any target currently waits on someone (offers "Stop waiting"). */
  current: boolean;
  onClose: () => void;
  onSelect: (waitingOn: TaskWaitingOnInput | null) => void;
}) {
  const [query, setQuery] = useState('');
  const text = query.trim();
  const options = useMemo(() => {
    const all: { key: string; label: string; value: TaskWaitingOnInput }[] = [
      ...developers.map((dev) => ({ key: `d:${dev.accountId}`, label: dev.displayName, value: { type: 'developer' as const, ref: dev.accountId, label: dev.displayName } })),
      ...contacts.map((contact) => ({ key: `c:${contact.id}`, label: `${contact.displayName} · contact`, value: { type: 'contact' as const, ref: String(contact.id), label: contact.displayName } })),
    ];
    const needle = text.toLowerCase();
    const matches = needle ? all.filter((option) => option.label.toLowerCase().includes(needle)) : all;
    const exact = matches.some((option) => option.label.toLowerCase().split(' · ')[0] === needle);
    return text && !exact ? [...matches, { key: 'text', label: `Someone else: “${text}”`, value: { type: 'text' as const, label: text } }] : matches;
  }, [contacts, developers, text]);

  return (
    <TaskPopover anchor={anchor} onClose={onClose} label="Waiting on" width={240}>
      <input
        data-autofocus
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && options[0]) {
            event.preventDefault();
            onSelect(options[0].value);
          }
        }}
        placeholder="Waiting on…"
        aria-label="Waiting on"
        className="mb-1 w-full rounded-lg px-2 py-1.5 text-[12.5px] outline-none"
        style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
      />
      {options.map((option) => (
        <MenuItem key={option.key} icon={<Hourglass size={13} />} label={option.label} onSelect={() => onSelect(option.value)} />
      ))}
      {options.length === 0 && <p className="px-2 py-1.5 text-[12px]" style={{ color: 'var(--text-muted)' }}>Type a name</p>}
      {current && (
        <>
          <MenuDivider />
          <MenuItem icon={<UserX size={13} />} label="Stop waiting" onSelect={() => onSelect(null)} />
        </>
      )}
    </TaskPopover>
  );
}

/** Check-by is stored as `followUpAt`: a local 09:00 on the chosen day (capture's convention). */
export function checkByTimestamp(date: string): string {
  return new Date(`${date}T09:00:00`).toISOString();
}

/** docs/57 §4 (P3-03): `c` — when to chase (stored in `followUpAt`). */
export function CheckByMenu({ anchor, today, current, onClose, onPick }: {
  anchor: HTMLElement;
  today: string;
  /** Single-target check-by as a local date ('' when mixed or unset). */
  current?: string | null;
  onClose: () => void;
  onPick: (date: string | null) => void;
}) {
  const presets: DatePreset[] = [
    { key: 't', label: 'Today', hint: 't', icon: <CalendarClock size={13} />, onSelect: () => onPick(today) },
    { key: 'm', label: 'Tomorrow', hint: 'm', icon: <CalendarArrowUp size={13} />, onSelect: () => onPick(shiftLocalIsoDate(today, 1)) },
    { key: 'w', label: 'Next week (Mon)', hint: 'w', icon: <CalendarDays size={13} />, onSelect: () => onPick(nextMonday(today)) },
    { key: 'c', label: 'No check date', hint: 'c', icon: <CalendarX size={13} />, onSelect: () => onPick(null) },
  ];
  return (
    <DatePickerPopover
      anchor={anchor}
      label="Check by"
      kind="date"
      value={current ?? ''}
      presets={presets}
      clearLabel={null}
      onCommit={(date) => { if (date) onPick(date); }}
      onClose={onClose}
      onAccelerator={(key) => {
        const preset = presets.find((candidate) => candidate.key === key.toLowerCase());
        if (preset) {
          preset.onSelect();
          return true;
        }
        const weekday = Number(key);
        if (Number.isInteger(weekday) && weekday >= 1 && weekday <= 7) {
          onPick(nextWeekday(today, weekday));
          return true;
        }
        return false;
      }}
    />
  );
}

export function LabelMenu({ anchor, labels, stateFor, onClose, onToggle }: {
  anchor: HTMLElement;
  labels: TaskLabel[];
  stateFor: (name: string) => boolean | 'mixed';
  onClose: () => void;
  onToggle: (name: string, next: boolean) => void;
}) {
  const [query, setQuery] = useState('');
  const needle = query.trim().toLowerCase();
  const visible = labels.filter((label) => !needle || taskLabelDisplayName(label.name).toLowerCase().includes(needle));
  return (
    <TaskPopover anchor={anchor} onClose={onClose} label="Labels" width={220}>
      <input
        data-autofocus
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Filter labels…"
        aria-label="Filter labels"
        className="mb-1 w-full rounded-lg px-2 py-1.5 text-[12.5px] outline-none"
        style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
      />
      {visible.map((label) => {
        const state = stateFor(label.name);
        return (
          <MenuItem
            key={label.name}
            role="menuitemcheckbox"
            checked={state}
            icon={<span className="h-2 w-2 rounded-full" style={{ background: labelChipStyle(label.color).color as string }} />}
            label={taskLabelDisplayName(label.name)}
            onSelect={() => onToggle(label.name, state !== true)}
          />
        );
      })}
      {visible.length === 0 && <p className="px-2 py-1.5 text-[12px]" style={{ color: 'var(--text-muted)' }}>No labels</p>}
    </TaskPopover>
  );
}

export function MoreMenu({ anchor, onClose, onSchedule, onStatus, onAssign, onLabels, onPriority, onWaiting, onCheckBy, onLater, onDrop, onCopyLink, canLater, onProject }: {
  anchor: HTMLElement;
  onClose: () => void;
  onSchedule: () => void;
  onStatus: () => void;
  onAssign: () => void;
  onLabels: () => void;
  onPriority: () => void;
  onWaiting: () => void;
  onCheckBy: () => void;
  onLater: () => void;
  onDrop: () => void;
  onCopyLink: () => void;
  canLater: boolean;
  onProject?: () => void;
}) {
  return (
    <TaskPopover anchor={anchor} onClose={onClose} label="More actions" width={210}>
      <MenuItem icon={<CalendarClock size={13} />} label="Schedule…" hint="s" onSelect={onSchedule} />
      <MenuItem icon={<CircleDashed size={13} />} label="Status…" onSelect={onStatus} />
      <MenuItem icon={<UserRound size={13} />} label="Assign…" hint="a" onSelect={onAssign} />
      <MenuItem icon={<Flag size={13} />} label="Priority…" hint="p" onSelect={onPriority} />
      {onProject && <MenuItem icon={<Folder size={13} />} label="Move to project…" onSelect={onProject} />}
      <MenuItem icon={<Tag size={13} />} label="Labels…" hint="l" onSelect={onLabels} />
      <MenuItem icon={<Hourglass size={13} />} label="Waiting on…" hint="w" onSelect={onWaiting} />
      <MenuItem icon={<CalendarClock size={13} />} label="Check by…" hint="c" onSelect={onCheckBy} />
      {canLater && <MenuItem icon={<Moon size={13} />} label="Move to Later" hint="s l" onSelect={onLater} />}
      <MenuItem icon={<Link2 size={13} />} label="Copy link" onSelect={onCopyLink} />
      <MenuDivider />
      <MenuItem icon={<Ban size={13} />} label="Drop" hint="#" tone="danger" onSelect={onDrop} />
    </TaskPopover>
  );
}

/** Checkable popover used by the toolbar filters. */
export function FilterMenu<T extends string>({ anchor, label, options, selected, onClose, onToggle, onClear, heading }: {
  anchor: HTMLElement;
  label: string;
  options: { value: T; label: string; dot?: string }[];
  selected: T[];
  onClose: () => void;
  onToggle: (value: T) => void;
  onClear: () => void;
  heading?: string;
}) {
  return (
    <TaskPopover anchor={anchor} onClose={onClose} label={label} width={220}>
      {heading && <MenuHeading>{heading}</MenuHeading>}
      {options.map((option) => (
        <MenuItem
          key={option.value}
          role="menuitemcheckbox"
          checked={selected.includes(option.value)}
          icon={option.dot ? <span className="h-2 w-2 rounded-full" style={{ background: option.dot }} /> : undefined}
          label={option.label}
          onSelect={() => onToggle(option.value)}
        />
      ))}
      {selected.length > 0 && (
        <>
          <MenuDivider />
          <MenuItem icon={<Check size={13} />} label="Clear" onSelect={onClear} />
        </>
      )}
    </TaskPopover>
  );
}
