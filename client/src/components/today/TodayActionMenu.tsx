import { useState } from 'react';
import { AlarmClock, ArrowUpRight, CalendarClock, Check, Ellipsis, MessageSquare, MessageSquarePlus, Rows3, Send, UserRoundCheck, type LucideIcon } from 'lucide-react';
import { MenuDivider, MenuHeading, MenuItem, TaskPopover } from '@/components/ui/Popover';
import { isLaterTodayAvailable } from '@/lib/utils';
import type { TodayActionCommand } from '@/types';

type SnoozePreset = 'later_today' | 'tomorrow' | 'next_week';

interface TodayActionMenuProps {
  /** Accessible name of the row this menu belongs to. */
  label: string;
  actions: TodayActionCommand[];
  /** docs/53 R1: the row's primary action, repeated as the first item. */
  primary?: TodayActionCommand;
  /** The row's open command (Enter). */
  open?: TodayActionCommand;
  onRunAction: (command: TodayActionCommand, preset?: SnoozePreset) => void;
}

const iconByKind: Partial<Record<TodayActionCommand['kind'], LucideIcon>> = {
  mark_done: Check,
  add_check_in: MessageSquare,
  ask_check_in: Send,
  capture_follow_up: MessageSquarePlus,
  carry_forward: Rows3,
  capture_meeting_outcome: CalendarClock,
  set_current_work: UserRoundCheck,
  open: ArrowUpRight,
  assign_owner: ArrowUpRight,
  snooze: AlarmClock,
};

/** docs/53 U4: menu items show the triage key that runs them. */
const hintByKind: Partial<Record<TodayActionCommand['kind'], string>> = {
  capture_follow_up: 'f',
  add_check_in: 'c',
};

/**
 * docs/53 A1: a real menu (role="menu", arrow-key focus, Esc/outside-click
 * close, focus restored) instead of a `<details>` element.
 */
export function TodayActionMenu({ label, actions, primary, open, onRunAction }: TodayActionMenuProps) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const snooze = actions.find((action) => action.kind === 'snooze');
  const rest = actions.filter((action) =>
    action.kind !== 'snooze' &&
    !(action.kind === 'open' && open) &&
    !(primary && action.kind === primary.kind),
  );
  if (!primary && !open && actions.length === 0) {
    return null;
  }

  const run = (command: TodayActionCommand, preset?: SnoozePreset) => {
    setAnchor(null);
    onRunAction(command, preset);
  };

  return (
    <>
      <button
        type="button"
        className="ui-icon-btn"
        aria-label={`More actions for ${label}`}
        aria-haspopup="menu"
        aria-expanded={Boolean(anchor)}
        onClick={(event) => setAnchor(anchor ? null : event.currentTarget)}
      >
        <Ellipsis size={15} />
      </button>
      {anchor ? (
        <TaskPopover anchor={anchor} label={`Actions for ${label}`} onClose={() => setAnchor(null)} width={208}>
          {primary ? <CommandItem command={primary} hint="e" onSelect={() => run(primary)} /> : null}
          {open && open.kind !== primary?.kind ? <CommandItem command={open} hint="↵" onSelect={() => run(open)} /> : null}
          {rest.length > 0 && (primary || open) ? <MenuDivider /> : null}
          {rest.map((action) => (
            <CommandItem key={`${action.kind}-${action.label}`} command={action} onSelect={() => run(action)} />
          ))}
          {snooze ? (
            <>
              <MenuDivider />
              <MenuHeading>Snooze</MenuHeading>
              {snoozePresets().map(([preset, presetLabel]) => (
                <MenuItem
                  key={preset}
                  icon={<AlarmClock size={13} />}
                  label={presetLabel}
                  hint={preset === 'tomorrow' ? 's' : undefined}
                  onSelect={() => run(snooze, preset)}
                />
              ))}
            </>
          ) : null}
        </TaskPopover>
      ) : null}
    </>
  );
}

function CommandItem({ command, hint, onSelect }: { command: TodayActionCommand; hint?: string; onSelect: () => void }) {
  const Icon = iconByKind[command.kind] ?? ArrowUpRight;
  return <MenuItem icon={<Icon size={13} />} label={command.label} hint={hint ?? hintByKind[command.kind]} onSelect={onSelect} />;
}

/**
 * docs/53 F1: "Later today" is hidden past ~18:00 — snoozing to now+3h would
 * silently roll into the evening.
 */
export function snoozePresets(): Array<readonly [SnoozePreset, string]> {
  const presets: Array<readonly [SnoozePreset, string]> = [
    ['tomorrow', 'Tomorrow'],
    ['next_week', 'Next week'],
  ];
  if (isLaterTodayAvailable()) {
    presets.unshift(['later_today', 'Later today']);
  }
  return presets;
}
