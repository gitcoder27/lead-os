import { useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  BellRing,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  Clock3,
  Ellipsis,
  History,
  MessageSquare,
  MessageSquareText,
  TriangleAlert,
  X,
} from 'lucide-react';
import type { TrackerCheckIn, TrackerDeveloperDay, TrackerDeveloperStatus, TrackerWorkItem } from '@/types';
import { formatAbsoluteDateTime, formatDate, getLocalIsoDate } from '@/lib/utils';
import { useToast } from '@/context/ToastContext';
import { usesCheckIns } from '@/lib/participation';
import { useTeamMode } from '@/hooks/useTeamMode';
import { useStatusUpdate } from '@/hooks/useTeamTrackerMutations';
import type { TaskPickerTask } from '@/components/tasks/TaskPicker';
import { TaskKeyChip } from '@/components/tasks/TaskKeyChip';
import { MenuDivider, MenuHeading, MenuItem, TaskPopover } from '@/components/ui/Popover';
import { Avatar } from '@/components/ui/Avatar';
import { IconButton } from '@/components/ui/IconButton';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { FOCUS_RING } from '@/components/ui/focus';
import { describeMoment, describePlanDate, toneColor } from '@/components/tasks/task-detail-format';
import { TrackerItemRow } from './TrackerItemRow';
import { getSignalBadges, type SignalTone } from './TrackerSignalBadges';
import { StatusRationaleDialog } from './StatusRationaleDialog';
import { STATUS_META, StatusDot } from './TrackerStatusPill';
import { formatCompactRelative } from './trackerItemFormat';
import { YouTag } from '@/components/team-tracker/YouTag';

/**
 * Developer drawer building blocks. Same visual language as the task detail
 * surface (tasks/TaskDetail*): sentence-case section headers, ghost controls
 * that reveal affordance on hover/focus, one accent, tone reserved for state.
 */

// ── Status vocabulary ───────────────────────────────────────────────

const STATUS_ORDER: TrackerDeveloperStatus[] = ['on_track', 'at_risk', 'blocked', 'waiting', 'done_for_today'];

/** Statuses that must explain themselves — they open the rationale dialog. */
const RATIONALE_STATUSES: TrackerDeveloperStatus[] = ['at_risk', 'blocked', 'waiting'];

function statusTint(status: TrackerDeveloperStatus) {
  const { color } = STATUS_META[status];
  return {
    color,
    background: `color-mix(in srgb, ${color} 12%, transparent)`,
    border: `1px solid color-mix(in srgb, ${color} 28%, transparent)`,
  };
}

// ── Layout primitives ───────────────────────────────────────────────

interface DrawerSectionProps {
  title: string;
  icon?: ReactNode;
  count?: number;
  hint?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}

export function DrawerSection({ title, icon, count, hint, action, children }: DrawerSectionProps) {
  const id = `developer-drawer-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  return (
    <section aria-labelledby={id} className="space-y-2">
      <SectionHeader id={id} icon={icon} title={title} count={count} hint={hint} action={action} />
      {children}
    </section>
  );
}

export function EmptyLine({ children }: { children: ReactNode }) {
  return (
    <p className="px-2 py-1 text-[12.5px] leading-5" style={{ color: 'var(--text-muted)' }}>
      {children}
    </p>
  );
}

export function Divider() {
  return <div className="h-px" style={{ background: 'color-mix(in srgb, var(--border) 70%, transparent)' }} />;
}

// ── Toolbar ─────────────────────────────────────────────────────────

export interface DrawerMenuAction {
  key: string;
  label: string;
  icon: ReactNode;
  onSelect: () => void;
  /** Rendered after a divider, for consequential actions. */
  separated?: boolean;
}

export function DrawerToolbar({
  day,
  date,
  readOnly,
  condensed,
  actions,
  onClose,
}: {
  day: TrackerDeveloperDay;
  date: string;
  readOnly: boolean;
  condensed: boolean;
  actions: DrawerMenuAction[];
  onClose: () => void;
}) {
  const dateLabel = describePlanDate(date, 'open', getLocalIsoDate())?.label ?? formatDate(date);

  return (
    <div
      className="flex h-[52px] shrink-0 items-center gap-2 border-b pl-5 pr-3"
      style={{ borderColor: 'var(--border)', background: 'color-mix(in srgb, var(--bg-primary) 92%, transparent)' }}
    >
      <div className="relative flex min-w-0 flex-1 items-center">
        <span
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 text-[12px] font-semibold leading-[22px] transition-all duration-200"
          style={{
            color: readOnly ? 'var(--warning)' : 'var(--text-secondary)',
            background: readOnly ? 'color-mix(in srgb, var(--warning) 10%, transparent)' : 'var(--bg-tertiary)',
            opacity: condensed ? 0 : 1,
            transform: condensed ? 'translateY(-4px)' : 'none',
          }}
          aria-hidden={condensed}
          title={readOnly ? 'Historical snapshot — read-only' : undefined}
        >
          {readOnly ? <History size={12} /> : <Clock3 size={12} />}
          {readOnly ? `Snapshot · ${dateLabel}` : dateLabel}
        </span>
        <span
          className="absolute inset-y-0 left-0 flex min-w-0 max-w-full items-center gap-2 transition-all duration-200"
          style={{ opacity: condensed ? 1 : 0, transform: condensed ? 'none' : 'translateY(4px)', pointerEvents: 'none' }}
          aria-hidden={!condensed}
        >
          <Avatar name={day.developer.displayName} seed={day.developer.accountId} size={20} />
          <span className="truncate text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>
            {day.developer.displayName}
          </span>
          <StatusDot status={day.status} />
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        {actions.length > 0 && <MoreActions actions={actions} />}
        <IconButton label="Close developer details" hint="Esc" onClick={onClose}>
          <X size={16} />
        </IconButton>
      </div>
    </div>
  );
}

function MoreActions({ actions }: { actions: DrawerMenuAction[] }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const close = () => setAnchor(null);
  return (
    <>
      <IconButton label="More actions" popup="menu" expanded={Boolean(anchor)} onClick={(el) => setAnchor(anchor ? null : el)}>
        <Ellipsis size={16} />
      </IconButton>
      {anchor && (
        <TaskPopover anchor={anchor} onClose={close} label="Developer actions" width={228}>
          {actions.map((action, index) => (
            <div key={action.key}>
              {action.separated && index > 0 && <MenuDivider />}
              <MenuItem
                icon={action.icon}
                label={action.label}
                onSelect={() => {
                  close();
                  action.onSelect();
                }}
              />
            </div>
          ))}
        </TaskPopover>
      )}
    </>
  );
}

// ── Hero: identity, status, counters, attention ─────────────────────

interface DeveloperHeroProps {
  day: TrackerDeveloperDay;
  date: string;
  tasks: TaskPickerTask[];
  load: number;
  readOnly: boolean;
  titleId: string;
}

/** Check-in freshness, or a quiet "last touched" for people who do not check in. */
function FreshnessLine({ day }: { day: TrackerDeveloperDay }) {
  const mode = useTeamMode();
  const { lastManagerTouchAt, untouched } = day.signals.freshness;

  if (!usesCheckIns(mode, day.participates)) {
    return (
      <span
        className="inline-flex items-center gap-1.5 text-[12.5px]"
        style={{ color: untouched ? 'var(--warning)' : 'var(--text-muted)' }}
        title={lastManagerTouchAt ? formatAbsoluteDateTime(lastManagerTouchAt) : undefined}
      >
        <MessageSquare size={12} />
        {lastManagerTouchAt ? `Last touched ${formatCompactRelative(lastManagerTouchAt)}` : 'Not touched yet'}
      </span>
    );
  }

  const stale = day.signals.freshness.staleByTime;
  return (
    <span
      className="inline-flex items-center gap-1.5 text-[12.5px]"
      style={{ color: stale ? 'var(--warning)' : 'var(--text-muted)' }}
      title={day.lastCheckInAt ? formatAbsoluteDateTime(day.lastCheckInAt) : undefined}
    >
      <MessageSquare size={12} />
      {day.lastCheckInAt ? `Checked in ${formatCompactRelative(day.lastCheckInAt)}` : 'No check-in'}
    </span>
  );
}

export function DeveloperHero({ day, date, tasks, load, readOnly, titleId }: DeveloperHeroProps) {
  return (
    <header className="space-y-4">
      <div className="flex items-start gap-3.5">
        <Avatar name={day.developer.displayName} seed={day.developer.accountId} size={44} />
        <div className="min-w-0 flex-1">
          <h2
            id={titleId}
            className="truncate text-[20px] font-semibold leading-7 tracking-[-0.012em]"
            style={{ color: 'var(--text-primary)' }}
            title={day.developer.displayName}
          >
            {day.developer.displayName}
            <YouTag show={day.developer.isSelf} />
          </h2>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
            <StatusControl day={day} date={date} tasks={tasks} readOnly={readOnly} />
            <dl className="flex items-center gap-4 text-[12.5px]">
              <Counter label="Load" value={load} title="Current work plus planned tasks" />
              <Counter label="Done" value={day.completedItems.length} title="Completed on this day" />
            </dl>
            <FreshnessLine day={day} />
          </div>
        </div>
      </div>
      <AttentionNote day={day} />
    </header>
  );
}

function Counter({ label, value, title }: { label: string; value: number; title: string }) {
  return (
    <div className="inline-flex items-baseline gap-1.5" title={title}>
      <dt style={{ color: 'var(--text-muted)' }}>{label}</dt>
      <dd className="font-semibold tabular-nums" style={{ color: value > 0 ? 'var(--text-primary)' : 'var(--text-muted)' }}>
        {value}
      </dd>
    </div>
  );
}

const SIGNAL_TONE_COLOR: Record<SignalTone, string> = {
  danger: 'var(--danger)',
  warning: 'var(--warning)',
  info: 'var(--info)',
  accent: 'var(--accent)',
};

const TONE_RANK: SignalTone[] = ['danger', 'warning', 'info', 'accent'];

/** Latest check-in that explains the current status, if any. */
function latestStatusRationale(day: TrackerDeveloperDay): TrackerCheckIn | undefined {
  if (!RATIONALE_STATUSES.includes(day.status)) return undefined;
  const newestFirst = [...[...day.checkIns].reverse(), ...day.recentCheckIns];
  return newestFirst.find((checkIn) => checkIn.status === day.status && (checkIn.rationale || checkIn.summary));
}

/**
 * One calm note for everything that wants the manager's attention: signals,
 * why the status is what it is, and when to look again. Absent when all is well.
 */
function AttentionNote({ day }: { day: TrackerDeveloperDay }) {
  const badges = getSignalBadges(day);
  const rationale = latestStatusRationale(day);
  const followUp = day.nextFollowUpAt ? describeMoment(day.nextFollowUpAt, 'open') : null;
  if (badges.length === 0 && !rationale && !followUp) return null;

  const statusTone = RATIONALE_STATUSES.includes(day.status) ? STATUS_META[day.status].color : null;
  const leadTone = TONE_RANK.find((tone) => badges.some((badge) => badge.tone === tone));
  const accent = day.status === 'blocked' ? STATUS_META.blocked.color : leadTone ? SIGNAL_TONE_COLOR[leadTone] : statusTone ?? 'var(--text-muted)';
  const rationaleText = rationale ? rationale.rationale || rationale.summary : null;

  return (
    <div
      role="note"
      aria-label="Attention"
      className="relative space-y-1.5 overflow-hidden rounded-xl py-2.5 pl-4 pr-3.5"
      style={{
        background: `color-mix(in srgb, ${accent} 5%, var(--bg-primary))`,
        border: `1px solid color-mix(in srgb, ${accent} 16%, var(--border))`,
      }}
    >
      <span aria-hidden="true" className="absolute inset-y-0 left-0 w-[3px]" style={{ background: accent }} />
      {badges.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] font-medium" style={{ color: 'var(--text-primary)' }}>
          <TriangleAlert size={13} className="shrink-0" style={{ color: accent }} aria-hidden="true" />
          {badges.map((badge) => (
            <span key={badge.key} className="inline-flex items-center gap-1.5">
              <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full" style={{ background: SIGNAL_TONE_COLOR[badge.tone] }} />
              {badge.label}
            </span>
          ))}
        </div>
      )}
      {rationaleText && rationale && (
        <p className="text-[12.5px] leading-5" style={{ color: 'var(--text-secondary)' }}>
          <span className="font-medium" style={{ color: STATUS_META[day.status].color }}>
            {STATUS_META[day.status].label}:
          </span>{' '}
          {rationaleText}
          <span style={{ color: 'var(--text-muted)' }}>
            {' · '}
            <time dateTime={rationale.createdAt} title={formatAbsoluteDateTime(rationale.createdAt)}>
              {formatCompactRelative(rationale.createdAt)}
            </time>
          </span>
        </p>
      )}
      {followUp && (
        <p className="flex items-center gap-1.5 text-[12.5px]" style={{ color: 'var(--text-secondary)' }}>
          <BellRing size={12} style={{ color: toneColor(followUp.tone === 'default' ? 'muted' : followUp.tone) }} aria-hidden="true" />
          Follow up {followUp.label}
          {followUp.hint && <span style={{ color: toneColor(followUp.tone) }}>· {followUp.hint}</span>}
        </p>
      )}
    </div>
  );
}

// ── Status control ──────────────────────────────────────────────────

function StatusControl({ day, date, tasks, readOnly }: { day: TrackerDeveloperDay; date: string; tasks: TaskPickerTask[]; readOnly: boolean }) {
  const { addToast } = useToast();
  const statusUpdate = useStatusUpdate(date);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [pendingStatus, setPendingStatus] = useState<TrackerDeveloperStatus | null>(null);
  const meta = STATUS_META[day.status];
  const since = day.statusUpdatedAt ? ` · set ${formatCompactRelative(day.statusUpdatedAt)}` : '';

  if (readOnly) {
    return (
      <span className="inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[12px] font-semibold" style={statusTint(day.status)}>
        <StatusDot status={day.status} />
        {meta.label}
      </span>
    );
  }

  const choose = (status: TrackerDeveloperStatus) => {
    setAnchor(null);
    if (status === day.status) return;
    if (RATIONALE_STATUSES.includes(status)) {
      setPendingStatus(status);
      return;
    }
    statusUpdate.mutate(
      { accountId: day.developer.accountId, status },
      { onError: (error) => addToast(error.message, 'error') },
    );
  };

  return (
    <>
      <button
        type="button"
        onClick={(event) => setAnchor(anchor ? null : event.currentTarget)}
        aria-label={`Change developer status (currently ${meta.label})`}
        aria-haspopup="menu"
        aria-expanded={Boolean(anchor)}
        data-task-shortcut="shift+s"
        title={`Change status (S)${since}`}
        className={`group inline-flex h-7 items-center gap-1.5 rounded-full pl-2.5 pr-2 text-[12px] font-semibold transition-[filter] hover:brightness-125 ${FOCUS_RING}`}
        style={statusTint(day.status)}
      >
        <StatusDot status={day.status} />
        {meta.label}
        <ChevronDown size={12} className="opacity-60 transition-transform group-aria-expanded:rotate-180" />
      </button>
      {anchor && (
        <TaskPopover
          anchor={anchor}
          onClose={() => setAnchor(null)}
          label="Developer status"
          width={232}
          onAccelerator={(key) => {
            const status = STATUS_ORDER.find((candidate) => STATUS_META[candidate].key === key.toLowerCase());
            if (!status) return false;
            choose(status);
            return true;
          }}
        >
          <MenuHeading>Set status</MenuHeading>
          {STATUS_ORDER.map((status) => (
            <MenuItem
              key={status}
              role="menuitemradio"
              checked={status === day.status}
              icon={<StatusDot status={status} size={8} />}
              label={
                day.statusSuggestion?.status === status && status !== day.status ? (
                  <span className="flex items-center gap-1.5">
                    {STATUS_META[status].label}
                    <span className="text-[12px]" style={{ color: 'var(--text-muted)' }}>suggested</span>
                  </span>
                ) : (
                  STATUS_META[status].label
                )
              }
              hint={STATUS_META[status].key}
              onSelect={() => choose(status)}
            />
          ))}
          <p className="px-2 pb-1 pt-1.5 text-[12px] leading-4" style={{ color: 'var(--text-muted)' }}>
            At risk, blocked and waiting ask for a short rationale.
          </p>
        </TaskPopover>
      )}
      {/* Portaled so the dialog is its own layer above the drawer (the drawer's
          focus trap and single-key shortcuts stand down while it is open). */}
      {typeof document !== 'undefined' && createPortal(
      <AnimatePresence>
        {pendingStatus && (
          <StatusRationaleDialog
            status={pendingStatus}
            developerName={day.developer.displayName}
            developerParticipates={day.participates}
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
            onSubmit={({ rationale, taskKey, nextFollowUpAt, visibility }) =>
              statusUpdate.mutate(
                {
                  accountId: day.developer.accountId,
                  status: pendingStatus,
                  rationale,
                  taskKey,
                  nextFollowUpAt,
                  visibility,
                },
                {
                  onSuccess: () => setPendingStatus(null),
                },
              )
            }
          />
        )}
      </AnimatePresence>,
      document.body,
      )}
    </>
  );
}

// ── History disclosure ──────────────────────────────────────────────

interface HistorySectionProps {
  title: string;
  items: TrackerWorkItem[];
  open: boolean;
  onToggle: () => void;
}

export function HistorySection({ title, items, open, onToggle }: HistorySectionProps) {
  const reduceMotion = useReducedMotion();
  const hasItems = items.length > 0;
  const regionId = `developer-drawer-history-${title.toLowerCase()}`;

  return (
    <section>
      <button
        type="button"
        onClick={hasItems ? onToggle : undefined}
        disabled={!hasItems}
        className={`group flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors enabled:hover:bg-[var(--bg-tertiary)] disabled:cursor-default ${FOCUS_RING}`}
        aria-expanded={hasItems ? open : undefined}
        aria-controls={hasItems ? regionId : undefined}
      >
        <ChevronRight
          size={14}
          className={`shrink-0 transition-transform duration-150 ${open && hasItems ? 'rotate-90' : ''}`}
          style={{ color: 'var(--text-muted)', opacity: hasItems ? 1 : 0.4 }}
        />
        <span className="text-[13px] font-semibold" style={{ color: hasItems ? 'var(--text-primary)' : 'var(--text-muted)' }}>
          {title}
        </span>
        <span
          className="rounded-full px-1.5 text-[12px] font-semibold tabular-nums leading-[18px]"
          style={{ background: 'var(--bg-tertiary)', color: 'var(--text-muted)' }}
        >
          {items.length}
        </span>
      </button>
      <AnimatePresence initial={false}>
        {hasItems && open && (
          <motion.div
            id={regionId}
            key="history"
            initial={reduceMotion ? { opacity: 0 } : { height: 0, opacity: 0 }}
            animate={reduceMotion ? { opacity: 1 } : { height: 'auto', opacity: 1 }}
            exit={reduceMotion ? { opacity: 0 } : { height: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: [0.4, 0, 0.2, 1] }}
            className="overflow-hidden"
          >
            <div className="space-y-0.5 pt-1">
              {items.map((item) => (
                <TrackerItemRow key={item.id} item={item} variant="drawer-history" hideActions onOpen={undefined} />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

// ── Check-in timeline ───────────────────────────────────────────────

function checkInAuthor(authorType?: TrackerCheckIn['authorType']) {
  if (authorType === 'developer') return { label: 'Developer', color: 'var(--accent)', Icon: MessageSquareText };
  if (authorType === 'manager') return { label: 'Manager', color: 'var(--warning)', Icon: ClipboardCheck };
  return { label: 'Update', color: 'var(--text-muted)', Icon: MessageSquare };
}

export function CheckInTimeline({ checkIns, recentCheckIns, readOnly, noun = 'check-ins' }: { checkIns: TrackerCheckIn[]; recentCheckIns: TrackerCheckIn[]; readOnly: boolean; noun?: 'check-ins' | 'notes' }) {
  const today = [...checkIns].reverse();

  if (today.length === 0 && recentCheckIns.length === 0) {
    return <EmptyLine>{readOnly ? `No ${noun} recorded for this date.` : `No ${noun} today.`}</EmptyLine>;
  }

  return (
    <ol className="relative">
      {today.length === 0 && (
        <li className="pb-3">
          <EmptyLine>{readOnly ? `No ${noun} recorded for this date.` : `No ${noun} today.`}</EmptyLine>
        </li>
      )}
      {today.map((checkIn, index) => (
        <CheckInEntry
          key={checkIn.id}
          checkIn={checkIn}
          last={index === today.length - 1 && recentCheckIns.length === 0}
        />
      ))}
      {recentCheckIns.length > 0 && (
        <>
          <li className="flex items-center gap-3 pb-3 pt-1">
            <span className="text-[12px] font-semibold" style={{ color: 'var(--text-muted)' }}>
              Earlier this week
            </span>
            <span className="h-px flex-1" style={{ background: 'color-mix(in srgb, var(--border) 70%, transparent)' }} />
          </li>
          {recentCheckIns.map((checkIn, index) => (
            <CheckInEntry key={`recent-${checkIn.id}`} checkIn={checkIn} showDate last={index === recentCheckIns.length - 1} />
          ))}
        </>
      )}
    </ol>
  );
}

function CheckInEntry({ checkIn, showDate = false, last }: { checkIn: TrackerCheckIn; showDate?: boolean; last: boolean }) {
  const author = checkInAuthor(checkIn.authorType);
  const absolute = formatAbsoluteDateTime(checkIn.createdAt);
  const taskKeys = checkIn.taskKeys ?? [];
  const rationale = checkIn.rationale && checkIn.rationale.trim() !== checkIn.summary.trim() ? checkIn.rationale : null;
  const followUp = checkIn.nextFollowUpAt ? describeMoment(checkIn.nextFollowUpAt, 'open') : null;
  const { Icon } = author;

  return (
    <li className={`relative flex gap-3 ${last ? '' : 'pb-5'}`}>
      {!last && (
        <span
          aria-hidden="true"
          className="absolute bottom-0 left-[11.5px] top-[26px] w-px"
          style={{ background: 'color-mix(in srgb, var(--border) 75%, transparent)' }}
        />
      )}
      <span
        aria-hidden="true"
        className="relative z-[1] flex h-6 w-6 shrink-0 items-center justify-center rounded-full"
        style={{
          color: author.color,
          background: `color-mix(in srgb, ${author.color} 14%, var(--bg-primary))`,
          border: `1px solid color-mix(in srgb, ${author.color} 32%, transparent)`,
        }}
      >
        <Icon size={12} strokeWidth={2.1} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex min-h-[24px] flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-[12.5px] font-semibold" style={{ color: 'var(--text-primary)' }}>
            {author.label}
          </span>
          {checkIn.status && (
            <span
              className="inline-flex items-center gap-1 rounded-full px-1.5 text-[11px] font-semibold leading-[18px]"
              style={statusTint(checkIn.status)}
            >
              <StatusDot status={checkIn.status} size={5} />
              {STATUS_META[checkIn.status].label}
            </span>
          )}
          {showDate && checkIn.date && (
            <span
              className="rounded-full px-1.5 text-[11px] font-semibold leading-[18px]"
              style={{ color: 'var(--text-muted)', background: 'var(--bg-tertiary)' }}
            >
              {formatDate(checkIn.date)}
            </span>
          )}
          <time className="text-[12px] tabular-nums" style={{ color: 'var(--text-muted)' }} dateTime={checkIn.createdAt} title={absolute}>
            {formatCompactRelative(checkIn.createdAt)}
          </time>
          <span className="ml-auto text-[12px] tabular-nums" style={{ color: 'var(--text-muted)', opacity: 0.85 }}>
            {absolute}
          </span>
        </div>
        <div
          className="mt-1.5 rounded-xl px-3 py-2.5"
          style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)' }}
        >
          <p className="whitespace-pre-wrap break-words text-[13px] leading-5" style={{ color: 'var(--text-primary)' }}>
            {checkIn.summary}
          </p>
          {rationale && (
            <p className="mt-1 text-[12.5px] leading-5" style={{ color: 'var(--text-secondary)' }}>
              <span style={{ color: 'var(--text-muted)' }}>Why: </span>
              {rationale}
            </p>
          )}
          {(taskKeys.length > 0 || followUp) && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {taskKeys.map((key) => (
                <TaskKeyChip key={key} taskKey={key} />
              ))}
              {followUp && (
                <span className="inline-flex items-center gap-1 text-[12px]" style={{ color: 'var(--text-muted)' }}>
                  <BellRing size={11} aria-hidden="true" />
                  Follow up {followUp.label}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </li>
  );
}
