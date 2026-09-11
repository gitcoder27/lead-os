import { motion } from 'framer-motion';
import { AlertTriangle, CheckCircle2, CircleOff, Clock, MessageSquarePlus, Zap } from 'lucide-react';
import type { Issue, TrackerAttentionItem, TrackerDeveloperDay, TrackerDeveloperGroup, TrackerWorkItem } from '@/types';
import { formatAbsoluteDateTime, formatRelativeTime } from '@/lib/utils';
import { TrackerStatusPill } from './TrackerStatusPill';
import { RelatedIssueChips } from './RelatedIssueChips';

interface TrackerRosterBoardProps {
  date: string;
  developers: TrackerDeveloperDay[];
  groups: TrackerDeveloperGroup[];
  isGrouped: boolean;
  searchActive: boolean;
  onOpenDrawer: (accountId: string) => void;
  onOpenTaskDetail?: (itemId: number, managerDeskItemId?: number) => void;
  onCaptureFollowUp: (day: TrackerDeveloperDay) => void;
  issues?: Issue[];
  attentionItems?: TrackerAttentionItem[];
  attentionSorted?: boolean;
  readOnly?: boolean;
}

export const ROSTER_GRID =
  'md:grid-cols-[minmax(160px,0.95fr)_minmax(300px,2fr)_minmax(130px,0.7fr)_52px_minmax(96px,0.55fr)_minmax(140px,0.75fr)_44px]';

const statusGroupColors: Record<string, string> = {
  blocked: 'var(--danger)',
  at_risk: 'var(--warning)',
  waiting: 'var(--info)',
  on_track: 'var(--success)',
  done_for_today: 'var(--success)',
  needs_attention: 'var(--warning)',
  stable: 'var(--accent)',
  all: 'var(--accent)',
};

const getInitials = (name: string) =>
  name
    .split(' ')
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

const getAssignedCount = (day: TrackerDeveloperDay) => (day.currentItem ? 1 : 0) + day.plannedItems.length;

const getLoadLabel = (day: TrackerDeveloperDay) => {
  const assigned = getAssignedCount(day);
  return day.capacityUnits ? `${assigned}/${day.capacityUnits}` : `${assigned}`;
};

const getFreshnessLabel = (day: TrackerDeveloperDay) => {
  if (day.lastCheckInAt) {
    return formatRelativeTime(day.lastCheckInAt);
  }

  return 'No check-in';
};

const getRiskLabel = (day: TrackerDeveloperDay) => {
  if (day.status === 'blocked') return 'Blocked';
  if (day.signals.risk.overdueLinkedWork) {
    return day.signals.risk.overdueLinkedCount === 1
      ? '1 overdue'
      : `${day.signals.risk.overdueLinkedCount} overdue`;
  }
  if (day.signals.risk.overCapacity) return `+${day.signals.risk.capacityDelta} over cap`;
  if (day.signals.freshness.staleWithOpenRisk) return 'Stale risk';
  if (day.signals.freshness.staleWithoutCurrentWork) return 'Needs current';
  if (day.signals.freshness.statusChangeWithoutFollowUp) return 'Needs follow-up';
  if (day.status === 'done_for_today') return 'Done';

  return 'Clear';
};

const getRiskTone = (day: TrackerDeveloperDay) => {
  if (day.status === 'blocked' || day.signals.risk.overdueLinkedWork || day.signals.risk.overCapacity) return 'var(--danger)';
  if (day.signals.freshness.staleByTime || day.signals.freshness.staleWithoutCurrentWork) return 'var(--warning)';
  if (day.status === 'done_for_today') return 'var(--success)';
  return 'var(--text-muted)';
};

type AttentionMeta = {
  rank: number;
  reason: string;
  tone: 'danger' | 'warning' | 'neutral';
};

const attentionReasonTone = (item: TrackerAttentionItem): AttentionMeta['tone'] => {
  const firstCode = item.reasons[0]?.code;
  if (firstCode === 'blocked' || firstCode === 'overdue_linked_work' || firstCode === 'over_capacity') {
    return 'danger';
  }
  if (firstCode) {
    return 'warning';
  }
  return 'neutral';
};

const attentionToneColor: Record<AttentionMeta['tone'], string> = {
  danger: 'var(--danger)',
  warning: 'var(--warning)',
  neutral: 'var(--text-muted)',
};

const getReasonLine = (item: TrackerAttentionItem) => {
  const reasons = item.reasons.map((reason) => reason.label);
  if (reasons.length <= 2) return reasons.join(' · ');
  return `${reasons.slice(0, 2).join(' · ')} · +${reasons.length - 2} more`;
};

const buildAttentionMeta = (items: TrackerAttentionItem[] = []) =>
  new Map(
    items.map((item, index) => [
      item.developer.accountId,
      {
        rank: index + 1,
        reason: getReasonLine(item),
        tone: attentionReasonTone(item),
      },
    ])
  );

const sortByAttention = (developers: TrackerDeveloperDay[], attentionMeta: Map<string, AttentionMeta>) =>
  [...developers].sort((left, right) => {
    const leftRank = attentionMeta.get(left.developer.accountId)?.rank ?? Number.MAX_SAFE_INTEGER;
    const rightRank = attentionMeta.get(right.developer.accountId)?.rank ?? Number.MAX_SAFE_INTEGER;
    if (leftRank !== rightRank) return leftRank - rightRank;
    return left.developer.displayName.localeCompare(right.developer.displayName);
  });

function WorkSummary({
  item,
  fallback,
  onOpenTaskDetail,
}: {
  item?: TrackerWorkItem;
  fallback: string;
  onOpenTaskDetail?: (itemId: number, managerDeskItemId?: number) => void;
}) {
  if (!item) {
    return (
      <span className="truncate text-[13px] font-semibold" style={{ color: 'var(--warning)' }}>
        {fallback}
      </span>
    );
  }

  const content = (
    <>
      <span className="truncate text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>
        {item.title}
      </span>
      {item.jiraKey && (
        <span className="font-mono text-[12px]" style={{ color: 'var(--accent)' }}>
          {item.jiraKey}
        </span>
      )}
      <RelatedIssueChips issueKeys={item.relatedIssueKeys} compact link={false} />
    </>
  );

  if (!onOpenTaskDetail) {
    return <div className="flex min-w-0 flex-col gap-0.5">{content}</div>;
  }

  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onOpenTaskDetail(item.id, item.managerDeskItemId);
      }}
      className="flex min-w-0 flex-col gap-0.5 text-left focus:outline-none focus:ring-2 focus:ring-[var(--border-active)]"
      title={item.title}
    >
      {content}
    </button>
  );
}

function RosterRow({
  day,
  index,
  onOpenDrawer,
  onOpenTaskDetail,
  onCaptureFollowUp,
  readOnly,
  attentionMeta,
}: {
  day: TrackerDeveloperDay;
  index: number;
  onOpenDrawer: (accountId: string) => void;
  onOpenTaskDetail?: (itemId: number, managerDeskItemId?: number) => void;
  onCaptureFollowUp: (day: TrackerDeveloperDay) => void;
  readOnly?: boolean;
  attentionMeta?: AttentionMeta;
}) {
  const assignedCount = getAssignedCount(day);
  const loadIsHigh = Boolean(day.capacityUnits && assignedCount > day.capacityUnits);
  const firstPlanned = day.plannedItems[0];
  const freshnessTitle = day.lastCheckInAt ? formatAbsoluteDateTime(day.lastCheckInAt) : undefined;
  const freshnessIsStale = day.signals.freshness.staleByTime || !day.lastCheckInAt;
  const riskLabel = getRiskLabel(day);
  const riskTone = getRiskTone(day);
  const attentionColor = attentionMeta ? attentionToneColor[attentionMeta.tone] : 'transparent';

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, delay: Math.min(index * 0.025, 0.16) }}
      role="button"
      tabIndex={0}
      onClick={() => onOpenDrawer(day.developer.accountId)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpenDrawer(day.developer.accountId);
        }
      }}
      className={`relative grid cursor-pointer gap-3 border-b px-3 py-3 text-left transition-colors hover:bg-[var(--bg-tertiary)] focus:outline-none focus:ring-2 focus:ring-inset focus:ring-[var(--border-active)] ${ROSTER_GRID} md:items-center`}
      style={{ borderColor: 'var(--border)' }}
    >
      {attentionMeta && (
        <span
          className="absolute left-0 top-3 bottom-3 w-[3px] rounded-r-sm"
          style={{ background: attentionColor }}
          title={attentionMeta.reason}
        />
      )}
      <div className="flex min-w-0 items-center gap-3">
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[12px] font-bold"
          style={{ background: 'var(--bg-tertiary)', color: 'var(--accent)', border: '1px solid var(--border)' }}
        >
          {getInitials(day.developer.displayName)}
        </span>
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>
            {day.developer.displayName}
          </div>
          <div className="mt-1">
            <TrackerStatusPill status={day.status} />
          </div>
        </div>
      </div>

      <WorkSummary item={day.currentItem} fallback="No current work" onOpenTaskDetail={onOpenTaskDetail} />

      <div className="min-w-0">
        <div className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
          Next
        </div>
        <div className="truncate text-[13px] font-medium" style={{ color: 'var(--text-secondary)' }}>
          {day.plannedItems.length > 0
            ? `${day.plannedItems.length} planned${firstPlanned ? ` · ${firstPlanned.title}` : ''}`
            : 'Nothing planned'}
        </div>
      </div>

      <div className="flex items-center gap-1.5 text-[13px] font-semibold tabular-nums" style={{ color: loadIsHigh ? 'var(--danger)' : 'var(--text-secondary)' }}>
        <Zap size={13} />
        {getLoadLabel(day)}
      </div>

      <div className="flex items-center gap-1.5 text-[13px] font-medium" style={{ color: freshnessIsStale ? 'var(--warning)' : 'var(--text-secondary)' }} title={freshnessTitle}>
        <Clock size={13} />
        <span className="truncate">{getFreshnessLabel(day)}</span>
      </div>

      <div className="flex items-center gap-1.5 text-[13px] font-semibold" style={{ color: riskTone }}>
        {riskLabel === 'Clear' ? <CheckCircle2 size={13} /> : riskLabel === 'Needs current' ? <CircleOff size={13} /> : <AlertTriangle size={13} />}
        <span className="truncate" title={attentionMeta?.reason}>{attentionMeta?.reason ?? riskLabel}</span>
      </div>

      <div className="flex justify-start md:justify-end">
        {!readOnly ? (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onCaptureFollowUp(day);
            }}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:brightness-125 focus:outline-none focus:ring-2 focus:ring-[var(--border-active)]"
            style={{ background: 'var(--bg-elevated)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
            aria-label={`Capture follow-up for ${day.developer.displayName}`}
            title={`Capture follow-up for ${day.developer.displayName}`}
          >
            <MessageSquarePlus size={13} />
          </button>
        ) : (
          <span className="text-[13px]" style={{ color: 'var(--text-muted)' }}>
            -
          </span>
        )}
      </div>
    </motion.div>
  );
}

function RosterSection({
  developers,
  indexOffset,
  onOpenDrawer,
  onOpenTaskDetail,
  onCaptureFollowUp,
  readOnly,
  attentionMeta,
  attentionSorted,
}: {
  developers: TrackerDeveloperDay[];
  indexOffset: number;
  onOpenDrawer: (accountId: string) => void;
  onOpenTaskDetail?: (itemId: number, managerDeskItemId?: number) => void;
  onCaptureFollowUp: (day: TrackerDeveloperDay) => void;
  readOnly?: boolean;
  attentionMeta: Map<string, AttentionMeta>;
  attentionSorted: boolean;
}) {
  const visibleDevelopers = attentionSorted ? sortByAttention(developers, attentionMeta) : developers;

  return (
    <div className="overflow-hidden rounded-xl border" style={{ borderColor: 'var(--border)', background: 'color-mix(in srgb, var(--bg-secondary) 72%, transparent)' }}>
      <div className={`hidden gap-3 border-b px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.08em] md:grid ${ROSTER_GRID}`} style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}>
        <span>Developer</span>
        <span>Current work</span>
        <span>Next</span>
        <span>Load</span>
        <span>Check-in</span>
        <span>Risk</span>
        <span className="text-right">Action</span>
      </div>
      {visibleDevelopers.map((day, index) => (
        <RosterRow
          key={day.developer.accountId}
          day={day}
          index={indexOffset + index}
          onOpenDrawer={onOpenDrawer}
          onOpenTaskDetail={onOpenTaskDetail}
          onCaptureFollowUp={onCaptureFollowUp}
          readOnly={readOnly}
          attentionMeta={attentionMeta.get(day.developer.accountId)}
        />
      ))}
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
  attentionItems = [],
  attentionSorted = false,
  readOnly = false,
}: TrackerRosterBoardProps) {
  const attentionMeta = buildAttentionMeta(attentionItems);
  const visibleCount = isGrouped
    ? groups.reduce((sum, group) => sum + group.developers.length, 0)
    : developers.length;

  if (visibleCount === 0) {
    return (
      <div className="flex min-h-[220px] items-center justify-center rounded-xl border px-4 py-10 text-center" style={{ borderColor: 'var(--border)', background: 'color-mix(in srgb, var(--bg-secondary) 72%, transparent)' }}>
        <div>
          <div className="text-[14px] font-semibold" style={{ color: 'var(--text-primary)' }}>
            {searchActive ? 'No developers match this search.' : 'No developers match this view.'}
          </div>
          <div className="mt-1 text-[13px]" style={{ color: 'var(--text-muted)' }}>
            {searchActive ? 'Try a different name, task, or Jira key.' : 'Change the filters or add team members from settings.'}
          </div>
        </div>
      </div>
    );
  }

  if (!isGrouped) {
    return (
      <RosterSection
        developers={developers}
        indexOffset={0}
        onOpenDrawer={onOpenDrawer}
        onOpenTaskDetail={onOpenTaskDetail}
        onCaptureFollowUp={onCaptureFollowUp}
        readOnly={readOnly}
        attentionMeta={attentionMeta}
        attentionSorted={attentionSorted}
      />
    );
  }

  let offset = 0;

  return (
    <div className="space-y-4">
      {groups.map((group) => {
        const color = statusGroupColors[group.key] ?? 'var(--accent)';
        const currentOffset = offset;
        offset += group.developers.length;

        return (
          <section key={group.key}>
            <div className="mb-2 flex items-center gap-2 px-1">
              <span className="h-2 w-2 rounded-sm" style={{ background: color }} />
              <span className="text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>
                {group.label}
              </span>
              <span className="tabular-nums text-[12px]" style={{ color: 'var(--text-muted)' }}>
                {group.count}
              </span>
            </div>
            <RosterSection
              developers={group.developers}
              indexOffset={currentOffset}
              onOpenDrawer={onOpenDrawer}
              onOpenTaskDetail={onOpenTaskDetail}
              onCaptureFollowUp={onCaptureFollowUp}
              readOnly={readOnly}
              attentionMeta={attentionMeta}
              attentionSorted={attentionSorted}
            />
          </section>
        );
      })}
    </div>
  );
}
