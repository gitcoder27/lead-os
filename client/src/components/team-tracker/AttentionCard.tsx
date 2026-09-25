import { ArrowRight, CalendarClock, Clock, CircleOff, MessageSquarePlus, Play, TriangleAlert } from 'lucide-react';
import type { TrackerAttentionItem, TrackerAttentionReasonCode } from '@/types';
import { formatAbsoluteDateTime, formatRelativeTime } from '@/lib/utils';
import { TrackerStatusPill } from './TrackerStatusPill';

interface AttentionCardProps {
  item: TrackerAttentionItem;
  index: number;
  date: string;
  onOpen: () => void;
  onMarkInactive: () => void;
  onCaptureFollowUp: () => void;
  onSetCurrent?: (itemId: number) => void;
}

type SeverityTone = 'danger' | 'warning' | 'neutral';

const reasonToTone: Record<TrackerAttentionReasonCode, SeverityTone> = {
  blocked: 'danger',
  overdue_linked_work: 'danger',
  at_risk: 'warning',
  stale_with_open_risk: 'warning',
  stale_without_current_work: 'warning',
  stale_by_time: 'warning',
  status_change_without_follow_up: 'warning',
  waiting: 'neutral',
  no_current: 'warning',
};

const toneColor: Record<SeverityTone, string> = {
  danger: 'var(--danger)',
  warning: 'var(--warning)',
  neutral: 'var(--text-muted)',
};

function leadTone(item: TrackerAttentionItem): SeverityTone {
  const first = item.reasons[0];
  return first ? reasonToTone[first.code] : 'neutral';
}

function reasonLine(item: TrackerAttentionItem) {
  const reasons = item.reasons.map((reason) => reason.label);
  if (reasons.length <= 2) return reasons.join(' · ');
  return `${reasons.slice(0, 2).join(' · ')} · +${reasons.length - 2} more`;
}

function getRecommendedAction(item: TrackerAttentionItem) {
  if (!item.hasCurrentItem && item.setCurrentCandidates.length === 1) return 'set_current';
  if (item.signals.freshness.statusChangeWithoutFollowUp || item.isStale || !item.lastCheckInAt) return 'follow_up';
  return 'open';
}

export function AttentionCard({ item, index, onOpen, onCaptureFollowUp, onSetCurrent }: AttentionCardProps) {
  const tone = leadTone(item);
  const accent = toneColor[tone];
  const checkIn = item.lastCheckInAt ? formatRelativeTime(item.lastCheckInAt) : 'No check-in';
  const absoluteCheckIn = item.lastCheckInAt ? formatAbsoluteDateTime(item.lastCheckInAt) : undefined;
  const action = getRecommendedAction(item);
  const setCurrentCandidate = item.setCurrentCandidates[0];
  const currentWork = item.currentItem;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } }}
      className="group relative grid w-full cursor-pointer gap-3 border-b px-3 py-3 text-left transition-colors hover:bg-[var(--bg-tertiary)] focus:outline-none focus:ring-2 focus:ring-inset focus:ring-[var(--border-active)] md:grid-cols-[minmax(220px,1.2fr)_minmax(260px,1.6fr)_minmax(220px,1fr)_128px] md:items-center"
      style={{
        borderColor: 'var(--border)',
      }}
    >
      <span className="absolute left-0 top-3 bottom-3 w-[3px] rounded-r-sm" style={{ background: accent }} />

      <div className="flex min-w-0 items-center gap-3 pl-2">
        <span className="tabular-nums text-[12px] font-semibold" style={{ color: 'var(--text-muted)' }}>
          {String(index + 1).padStart(2, '0')}
        </span>
        <div className="min-w-0">
          <div className="truncate text-[14px] font-semibold" style={{ color: 'var(--text-primary)' }}>
            {item.developer.displayName}
          </div>
          <div className="mt-1">
            <TrackerStatusPill status={item.status} />
          </div>
        </div>
      </div>

      <div className="min-w-0">
        <div className="flex items-center gap-1.5 text-[13px] font-semibold" style={{ color: accent }}>
          {tone === 'danger' ? <TriangleAlert size={14} /> : <CircleOff size={14} />}
          <span className="truncate">{reasonLine(item)}</span>
        </div>
        <div className="mt-1 flex min-w-0 items-center gap-3 text-[13px]" style={{ color: 'var(--text-muted)' }}>
          <span className="inline-flex items-center gap-1.5" title={absoluteCheckIn}>
            <Clock size={12} />
            {checkIn}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <CalendarClock size={12} />
            {item.plannedCount} planned
          </span>
        </div>
      </div>

      <div className="min-w-0 text-[13px]" style={{ color: 'var(--text-secondary)' }}>
        {currentWork ? (
          <div className="min-w-0">
            <div className="text-[12px] font-medium" style={{ color: 'var(--text-muted)' }}>
              Current
            </div>
            <div className="truncate text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }} title={currentWork.title}>
              {currentWork.title}
            </div>
            {currentWork.jiraKey && (
              <div className="truncate font-mono text-[12px]" style={{ color: 'var(--accent)' }}>
                {currentWork.jiraKey}
              </div>
            )}
          </div>
        ) : (
          <div className="font-medium" style={{ color: item.hasCurrentItem ? 'var(--text-secondary)' : 'var(--warning)' }}>
            {item.hasCurrentItem ? 'Current work set' : 'No current work'}
          </div>
        )}
        {item.signals.risk.overdueLinkedWork && (
          <div className="mt-0.5" style={{ color: 'var(--danger)' }}>
            {item.signals.risk.overdueLinkedCount} overdue Jira
          </div>
        )}
      </div>

      <div className="flex justify-start md:justify-end">
        {action === 'set_current' && setCurrentCandidate && onSetCurrent ? (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onSetCurrent(setCurrentCandidate.id);
            }}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[13px] font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--border-active)]"
            style={{ background: 'var(--accent)', color: 'var(--bg-primary)' }}
          >
            <Play size={13} />
            Set current
          </button>
        ) : action === 'follow_up' ? (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onCaptureFollowUp();
            }}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[13px] font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--border-active)]"
            style={{ background: 'var(--bg-elevated)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
          >
            <MessageSquarePlus size={13} />
            Follow up
          </button>
        ) : (
          <span className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-semibold" style={{ color: 'var(--text-secondary)', background: 'var(--bg-tertiary)' }}>
            Open
            <ArrowRight size={13} />
          </span>
        )}
      </div>
    </div>
  );
}
