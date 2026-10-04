import type { ReactNode } from 'react';
import { motion } from 'framer-motion';
import { CircleDashed, Lock, MessageSquarePlus, TriangleAlert, Users } from 'lucide-react';
import type { Issue, TrackerAttentionItem, TrackerDeveloperDay, TrackerDeveloperGroup, TrackerWorkItem } from '@/types';
import { formatAbsoluteDateTime } from '@/lib/utils';
import { usesCheckIns } from '@/lib/participation';
import { useTeamMode } from '@/hooks/useTeamMode';
import { Avatar } from '@/components/ui/Avatar';
import { FOCUS_RING } from '@/components/ui/focus';
import { TrackerStatusMark } from './TrackerStatusPill';
import { RelatedIssueChips } from './RelatedIssueChips';
import { describeLatestEvent, formatCompactRelative } from './trackerItemFormat';
import {
  ROSTER_TONE_COLOR,
  getRosterAttention,
  getRosterCheckIn,
  getRosterLoad,
  getRosterTouch,
  type RosterAttention,
} from './rosterSignals';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { EmptyState } from '@/components/ui/EmptyState';
import { YouTag } from '@/components/team-tracker/YouTag';
import { TeamRosterEmpty } from './TeamRosterEmpty';

interface TrackerRosterBoardProps {
  date: string;
  developers: TrackerDeveloperDay[];
  groups: TrackerDeveloperGroup[];
  isGrouped: boolean;
  searchActive: boolean;
  onOpenDrawer: (accountId: string) => void;
  onOpenTaskDetail?: (itemId: number, managerDeskItemId?: number) => void;
  onCaptureFollowUp: (day: TrackerDeveloperDay) => void;
  /** Phase 3 (P3-D11): accept the hybrid person-day status suggestion. */
  onAcceptSuggestion?: (day: TrackerDeveloperDay) => void;
  issues?: Issue[];
  attentionItems?: TrackerAttentionItem[];
  attentionSorted?: boolean;
  readOnly?: boolean;
  /** docs/56 UX-13: nobody is on the roster at all (not a filter that matched no one). */
  rosterEmpty?: boolean;
}

/**
 * One template for the header, rows and loading skeleton. Below md a row is a
 * compact card: person + action on top, then work, then load/check-in.
 */
export const ROSTER_GRID =
  'grid-cols-[minmax(0,1fr)_auto] md:grid-cols-[minmax(180px,1fr)_minmax(220px,1.6fr)_minmax(150px,1fr)_64px_minmax(92px,0.55fr)_minmax(150px,0.9fr)_32px]';

/** Cells that span the full card width below md. */
const MOBILE_SPAN = 'max-md:col-span-2';

const statusGroupColors: Record<string, string> = {
  blocked: 'var(--danger)',
  at_risk: 'var(--warning)',
  waiting: 'var(--info)',
  on_track: 'var(--success)',
  done_for_today: 'var(--accent)',
  needs_attention: 'var(--warning)',
  stable: 'var(--text-muted)',
  all: 'var(--text-muted)',
};

const sortByAttention = (developers: TrackerDeveloperDay[], ranks: Map<string, number>) =>
  [...developers].sort((left, right) => {
    const leftRank = ranks.get(left.developer.accountId) ?? Number.MAX_SAFE_INTEGER;
    const rightRank = ranks.get(right.developer.accountId) ?? Number.MAX_SAFE_INTEGER;
    if (leftRank !== rightRank) return leftRank - rightRank;
    return left.developer.displayName.localeCompare(right.developer.displayName);
  });

function MobileLabel({ children }: { children: ReactNode }) {
  return (
    <span className="mr-1.5 text-[12px] md:hidden" style={{ color: 'var(--text-muted)' }}>
      {children}
    </span>
  );
}

function MetaSeparator() {
  return <span aria-hidden="true" className="opacity-50">·</span>;
}

// ── Cells ───────────────────────────────────────────────────────────

function CurrentWork({
  item,
  done,
  onOpenTaskDetail,
}: {
  item?: TrackerWorkItem;
  done: boolean;
  onOpenTaskDetail?: (itemId: number, managerDeskItemId?: number) => void;
}) {
  if (!item) {
    return (
      <span className="flex min-w-0 items-center gap-1.5 text-[13px]" style={{ color: 'var(--text-muted)' }}>
        <CircleDashed size={13} className="shrink-0 opacity-70" aria-hidden="true" />
        <span className="truncate">{done ? 'Done for the day' : 'No current item'}</span>
      </span>
    );
  }

  const latest = item.latestEvent ? describeLatestEvent(item.latestEvent) : null;
  const meta: ReactNode[] = [];
  if (item.taskKey) {
    meta.push(
      <span key="task" className="shrink-0 font-mono text-[12px] font-semibold tabular-nums" style={{ color: 'var(--text-disabled)' }}>
        {item.taskKey}
      </span>,
    );
  }
  if (item.jiraKey) {
    meta.push(
      <span key="jira" className="shrink-0 font-mono text-[12px] font-semibold" style={{ color: 'var(--accent)' }}>
        {item.jiraKey}
      </span>,
    );
  }
  if (item.relatedIssueKeys?.length) {
    meta.push(<RelatedIssueChips key="related" issueKeys={item.relatedIssueKeys} compact link={false} />);
  }
  if (latest && item.latestEvent) {
    meta.push(
      <span key="latest" className="flex min-w-0 items-center gap-1">
        {item.latestEvent.visibility === 'private' && <Lock size={10} className="shrink-0" aria-label="Private" />}
        <span className="truncate" style={{ color: latest.tone === 'danger' ? 'var(--danger)' : undefined }}>
          {latest.text}
        </span>
        <span className="shrink-0 tabular-nums" title={formatAbsoluteDateTime(item.latestEvent.occurredAt)}>
          {formatCompactRelative(item.latestEvent.occurredAt)}
        </span>
      </span>,
    );
  }

  const content = (
    <>
      <span className="block truncate text-[13px] font-medium leading-5" style={{ color: 'var(--text-primary)' }}>
        {item.title}
      </span>
      {meta.length > 0 && (
        <span className="mt-0.5 flex min-w-0 items-center gap-1.5 overflow-hidden text-[12px] leading-4" style={{ color: 'var(--text-muted)' }}>
          {meta.flatMap((node, index) => (index === 0 ? [node] : [<MetaSeparator key={`sep-${index}`} />, node]))}
        </span>
      )}
    </>
  );

  if (!onOpenTaskDetail) {
    return <div className="min-w-0">{content}</div>;
  }

  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onOpenTaskDetail(item.id, item.managerDeskItemId);
      }}
      onKeyDown={(event) => event.stopPropagation()}
      className={`-mx-1.5 block min-w-0 max-w-full rounded-md px-1.5 py-0.5 text-left transition-colors hover:bg-[var(--bg-tertiary)] ${FOCUS_RING}`}
      title={`Open ${item.title}`}
    >
      {content}
    </button>
  );
}

function UpNext({ items }: { items: TrackerWorkItem[] }) {
  const [first, ...rest] = items;
  if (!first) {
    return (
      <span className="truncate text-[13px]" style={{ color: 'var(--text-placeholder)' }}>
        <MobileLabel>Next</MobileLabel>
        Nothing planned
      </span>
    );
  }
  return (
    <div className="min-w-0" title={items.map((item) => item.title).join('\n')}>
      <div className="truncate text-[13px] leading-5" style={{ color: 'var(--text-secondary)' }}>
        <MobileLabel>Next</MobileLabel>
        {first.title}
      </div>
      {rest.length > 0 && (
        <div className="mt-0.5 text-[12px] leading-4 tabular-nums" style={{ color: 'var(--text-muted)' }}>
          +{rest.length} more planned
        </div>
      )}
    </div>
  );
}

const LOAD_PIPS = 5;

function Load({ day }: { day: TrackerDeveloperDay }) {
  const load = getRosterLoad(day);
  const detail = `${day.currentItem ? '1 current' : 'No current'} · ${day.plannedItems.length} planned`;
  return (
    <div className="flex items-center gap-2" title={`${load} open items — ${detail}; count, not effort or capacity`}>
      <MobileLabel>Open items</MobileLabel>
      <span className="w-4 text-[13px] font-semibold tabular-nums" style={{ color: load > 0 ? 'var(--text-primary)' : 'var(--text-muted)' }}>
        {load}
      </span>
      <span aria-hidden="true" className="flex items-center gap-[2px]">
        {Array.from({ length: LOAD_PIPS }, (_, index) => (
          <span
            key={index}
            className="h-2.5 w-[3px] rounded-full"
            style={{
              background: index < load
                ? 'color-mix(in srgb, var(--text-secondary) 72%, transparent)'
                : 'color-mix(in srgb, var(--border) 80%, transparent)',
            }}
          />
        ))}
      </span>
    </div>
  );
}

/**
 * Freshness cell. People who check in show their last check-in; everyone else
 * (solo, or a developer without a login) shows a quiet "last touched" and only
 * warms up after the server's untouched window. `mixed` boards prefix the
 * touch so one column never blurs two meanings.
 */
function Freshness({ day, touch, mixed }: { day: TrackerDeveloperDay; touch: boolean; mixed: boolean }) {
  if (touch) {
    const touched = getRosterTouch(day);
    return (
      <div className="flex min-w-0 items-center gap-1.5 text-[12.5px]">
        <MobileLabel>Last touched</MobileLabel>
        <span
          className="truncate tabular-nums"
          style={{ color: touched.untouched ? 'var(--warning)' : 'var(--text-muted)' }}
          title={day.signals.freshness.lastManagerTouchAt ? `${touched.title} · ${formatAbsoluteDateTime(day.signals.freshness.lastManagerTouchAt)}` : touched.title}
        >
          {mixed ? `Touched ${touched.label}` : touched.label}
        </span>
        {touched.untouched && <span className="sr-only">{touched.title}</span>}
      </div>
    );
  }
  const checkIn = getRosterCheckIn(day);
  return (
    <div className="flex min-w-0 items-center gap-1.5 text-[12.5px]">
      <MobileLabel>Check-in</MobileLabel>
      {checkIn.stale && (
        <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: 'var(--warning)' }} title={checkIn.title} aria-hidden="true" />
      )}
      <span
        className="truncate tabular-nums"
        style={{ color: checkIn.stale ? 'var(--warning)' : 'var(--text-secondary)' }}
        title={day.lastCheckInAt ? formatAbsoluteDateTime(day.lastCheckInAt) : checkIn.title}
      >
        {checkIn.label}
      </span>
      {checkIn.stale && <span className="sr-only">{checkIn.title}</span>}
    </div>
  );
}

function AttentionFlags({ attention }: { attention: RosterAttention }) {
  const [lead, ...rest] = attention.flags;
  if (!lead) {
    return (
      <span className="text-[12.5px] max-md:hidden" style={{ color: 'var(--text-disabled)' }} title={attention.summary || 'Nothing needs you here'}>
        <span aria-hidden="true">—</span>
        <span className="sr-only">No attention flags</span>
      </span>
    );
  }
  const leadColor = ROSTER_TONE_COLOR[lead.tone];
  return (
    <div className="min-w-0" title={attention.summary}>
      <div className="flex min-w-0 items-center gap-1.5 text-[12.5px] font-medium leading-5">
        <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: leadColor }} />
        <span className="truncate" style={{ color: lead.tone === 'danger' ? leadColor : 'var(--text-primary)' }}>
          {lead.label}
        </span>
      </div>
      {rest.length > 0 && (
        <div className="truncate pl-3 text-[12px] leading-4" style={{ color: 'var(--text-muted)' }}>
          {rest.map((flag) => flag.label).join(' · ')}
        </div>
      )}
    </div>
  );
}

// ── Row ─────────────────────────────────────────────────────────────

function RosterRow({
  day,
  index,
  attentionItem,
  onOpenDrawer,
  onOpenTaskDetail,
  onCaptureFollowUp,
  onAcceptSuggestion,
  readOnly,
  mixed,
}: {
  day: TrackerDeveloperDay;
  index: number;
  attentionItem?: TrackerAttentionItem;
  onOpenDrawer: (accountId: string) => void;
  onOpenTaskDetail?: (itemId: number, managerDeskItemId?: number) => void;
  onCaptureFollowUp: (day: TrackerDeveloperDay) => void;
  onAcceptSuggestion?: (day: TrackerDeveloperDay) => void;
  readOnly?: boolean;
  /** The board mixes check-in and last-touched rows. */
  mixed: boolean;
}) {
  const mode = useTeamMode();
  const attention = getRosterAttention(day, attentionItem);
  const done = day.status === 'done_for_today';
  const name = day.developer.displayName;
  const railColor = attention.rail ? ROSTER_TONE_COLOR[attention.rail] : null;

  return (
    <motion.div
      // docs/54 M3: no mount stagger — rows appear with the data.
      initial={false}
      animate={{ opacity: 1 }}
      // docs/56 UX-23: the row is not itself a button (it holds buttons). The name is the link that
      // opens the person; a click anywhere else on the row does the same for pointer users.
      data-attention={attention.rail ?? undefined}
      onClick={() => onOpenDrawer(day.developer.accountId)}
      className={`group relative grid cursor-pointer items-center gap-3 gap-y-2 border-t px-4 py-2.5 text-left outline-none transition-colors hover:bg-[color-mix(in_srgb,var(--bg-tertiary)_55%,transparent)] ui-row-focus md:min-h-[60px] ${attention.rail === 'danger' ? 'bg-[color-mix(in_srgb,var(--danger)_4%,transparent)]' : ''} ${ROSTER_GRID}`}
      style={{ borderColor: 'color-mix(in srgb, var(--border) 70%, transparent)' }}
    >
      {railColor && (
        <span
          aria-hidden="true"
          className="absolute bottom-2.5 left-0 top-2.5 w-[2px] rounded-r-full"
          style={{ background: railColor }}
        />
      )}

      <div className={`flex min-w-0 items-center gap-3 max-md:col-start-1 max-md:row-start-1 ${done ? 'opacity-70' : ''}`}>
        <Avatar name={name} seed={day.developer.accountId} size={30} muted={done} />
        <div className="min-w-0">
          <div className="truncate text-[13.5px] font-semibold leading-5 tracking-[-0.005em]" style={{ color: 'var(--text-primary)' }} title={name}>
            <a
              href={`/team?dev=${encodeURIComponent(day.developer.accountId)}`}
              data-roster-row=""
              className="roster-row-link outline-none hover:underline"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onOpenDrawer(day.developer.accountId);
              }}
            >
              {name}
            </a>
            <YouTag show={day.developer.isSelf} />
          </div>
          <div className="mt-0.5 flex min-w-0 items-center gap-1.5">
            <TrackerStatusMark status={day.status} />
            {day.statusSuggestion && onAcceptSuggestion && (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onAcceptSuggestion(day);
                }}
                onKeyDown={(event) => event.stopPropagation()}
                className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-1.5 text-[12px] font-medium leading-[18px] transition-colors hover:bg-[color-mix(in_srgb,var(--warning)_14%,transparent)] ${FOCUS_RING}`}
                style={{ color: 'var(--warning)', boxShadow: 'inset 0 0 0 1px color-mix(in srgb, var(--warning) 30%, transparent)' }}
                title={`${day.statusSuggestion.reasonTaskKey} is blocked — set status to blocked`}
                aria-label={`Accept suggested blocked status for ${name}`}
                data-testid={`suggestion-${day.developer.accountId}`}
              >
                <TriangleAlert size={10} aria-hidden="true" />
                Set blocked?
              </button>
            )}
          </div>
        </div>
      </div>

      <div className={`min-w-0 ${MOBILE_SPAN}`}>
        <CurrentWork item={day.currentItem} done={done} onOpenTaskDetail={onOpenTaskDetail} />
      </div>

      <div className={`min-w-0 ${MOBILE_SPAN}`}>
        <UpNext items={day.plannedItems} />
      </div>

      <Load day={day} />

      <Freshness day={day} touch={!usesCheckIns(mode, day.participates)} mixed={mixed} />

      <div className={`min-w-0 ${MOBILE_SPAN}`}>
        <AttentionFlags attention={attention} />
      </div>

      <div className="flex justify-end max-md:col-start-2 max-md:row-start-1">
        {!readOnly && (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onCaptureFollowUp(day);
            }}
            onKeyDown={(event) => event.stopPropagation()}
            className={`flex h-7 w-7 items-center justify-center rounded-lg transition-[opacity,background-color] hover:bg-[var(--bg-elevated)] md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 md:focus-visible:opacity-100 [@media(hover:none)]:opacity-100 ${FOCUS_RING}`}
            style={{ color: 'var(--text-secondary)' }}
            aria-label={`Capture follow-up for ${name}`}
            title={`Capture follow-up for ${name}`}
          >
            <MessageSquarePlus size={14} />
          </button>
        )}
      </div>
    </motion.div>
  );
}

// ── Board ───────────────────────────────────────────────────────────

function ColumnHeader({ freshnessLabel }: { freshnessLabel: string }) {
  return (
    <div
      className={`hidden gap-3 px-4 py-2 text-[12px] font-medium md:grid ${ROSTER_GRID}`}
      style={{ color: 'var(--text-muted)', background: 'color-mix(in srgb, var(--bg-tertiary) 40%, transparent)' }}
    >
      <span>Developer</span>
      <span>Current work</span>
      <span>Up next</span>
      <span>Open items</span>
      <span>{freshnessLabel}</span>
      <span>Attention</span>
      <span className="sr-only">Actions</span>
    </div>
  );
}

function GroupHeader({ group }: { group: TrackerDeveloperGroup }) {
  const color = statusGroupColors[group.key] ?? 'var(--text-muted)';
  return (
    <div
      className="flex items-center gap-2 border-t px-4 pb-2 pt-3.5"
      style={{ borderColor: 'color-mix(in srgb, var(--border) 70%, transparent)' }}
    >
      <SectionHeader
        icon={<span aria-hidden="true" className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />}
        title={group.label}
        count={group.count}
      />
    </div>
  );
}

export function RosterSurface({ children }: { children: ReactNode }) {
  return (
    <div
      className="overflow-hidden rounded-xl border"
      style={{ borderColor: 'var(--border)', background: 'color-mix(in srgb, var(--bg-secondary) 64%, transparent)' }}
    >
      {children}
    </div>
  );
}

export function TrackerRosterBoard({
  developers,
  groups,
  isGrouped,
  searchActive,
  onOpenDrawer,
  onOpenTaskDetail,
  onCaptureFollowUp,
  onAcceptSuggestion,
  attentionItems = [],
  attentionSorted = false,
  readOnly = false,
  rosterEmpty = false,
}: TrackerRosterBoardProps) {
  const attentionByDeveloper = new Map(attentionItems.map((item) => [item.developer.accountId, item]));
  const ranks = new Map(attentionItems.map((item, index) => [item.developer.accountId, index]));
  const sections: Array<{ group?: TrackerDeveloperGroup; developers: TrackerDeveloperDay[] }> = isGrouped
    ? groups.filter((group) => group.developers.length > 0).map((group) => ({ group, developers: group.developers }))
    : [{ developers }];
  const visibleCount = sections.reduce((sum, section) => sum + section.developers.length, 0);
  const mode = useTeamMode();
  const visible = sections.flatMap((section) => section.developers);
  const touchRows = visible.filter((day) => !usesCheckIns(mode, day.participates)).length;
  const mixed = touchRows > 0 && touchRows < visible.length;

  if (visibleCount === 0 && rosterEmpty && !searchActive) {
    return <TeamRosterEmpty readOnly={readOnly} />;
  }

  if (visibleCount === 0) {
    return (
      <EmptyState
        icon={<Users size={22} />}
        title={searchActive ? 'No developers match this search.' : 'No developers match this view.'}
        body={searchActive ? 'Try a different name, task, or Jira key.' : 'Change the filters or add team members from settings.'}
      />
    );
  }

  let offset = 0;

  return (
    <RosterSurface>
      <ColumnHeader freshnessLabel={touchRows === visible.length ? 'Last touched' : 'Check-in'} />
      {sections.map((section) => {
        const rows = attentionSorted ? sortByAttention(section.developers, ranks) : section.developers;
        const startIndex = offset;
        offset += rows.length;
        return (
          <section key={section.group?.key ?? 'all'} aria-label={section.group?.label}>
            {section.group && <GroupHeader group={section.group} />}
            {rows.map((day, index) => (
              <RosterRow
                key={day.developer.accountId}
                day={day}
                index={startIndex + index}
                attentionItem={attentionByDeveloper.get(day.developer.accountId)}
                onOpenDrawer={onOpenDrawer}
                onOpenTaskDetail={onOpenTaskDetail}
                onCaptureFollowUp={onCaptureFollowUp}
                onAcceptSuggestion={onAcceptSuggestion}
                readOnly={readOnly}
                mixed={mixed}
              />
            ))}
          </section>
        );
      })}
    </RosterSurface>
  );
}
