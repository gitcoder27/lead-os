import type { CSSProperties } from 'react';
import type { TrackerDeveloperDay } from '@/types';

type SignalTone = 'danger' | 'warning' | 'info' | 'accent';

interface SignalBadge {
  key: string;
  label: string;
  tone: SignalTone;
}

const toneStyles: Record<SignalTone, CSSProperties> = {
  danger: {
    color: 'var(--danger)',
    background: 'rgba(239, 68, 68, 0.12)',
    borderColor: 'rgba(239, 68, 68, 0.18)',
  },
  warning: {
    color: 'var(--warning)',
    background: 'rgba(245, 158, 11, 0.14)',
    borderColor: 'rgba(245, 158, 11, 0.2)',
  },
  info: {
    color: 'var(--info)',
    background: 'rgba(59, 130, 246, 0.12)',
    borderColor: 'rgba(59, 130, 246, 0.18)',
  },
  accent: {
    color: 'var(--accent)',
    background: 'var(--accent-glow)',
    borderColor: 'color-mix(in srgb, var(--accent) 18%, transparent)',
  },
};

function getSignalBadges(day: TrackerDeveloperDay): SignalBadge[] {
  const badges: SignalBadge[] = [];

  if (day.signals.freshness.staleWithOpenRisk) {
    badges.push({ key: 'stale-risk', label: 'Stale risk', tone: 'warning' });
  } else if (day.signals.freshness.staleWithoutCurrentWork) {
    badges.push({ key: 'stale-no-current', label: 'No current follow-up', tone: 'warning' });
  } else if (day.signals.freshness.staleByTime) {
    badges.push({ key: 'stale', label: 'Stale', tone: 'warning' });
  }

  if (day.signals.risk.overdueLinkedWork) {
    badges.push({
      key: 'overdue-linked',
      label:
        day.signals.risk.overdueLinkedCount === 1
          ? '1 overdue Jira'
          : `${day.signals.risk.overdueLinkedCount} overdue Jira`,
      tone: 'danger',
    });
  }

  if (day.signals.freshness.statusChangeWithoutFollowUp) {
    badges.push({ key: 'needs-follow-up', label: 'Needs follow-up', tone: 'info' });
  }

  if (!day.currentItem && day.status !== 'done_for_today' && !day.signals.freshness.staleWithoutCurrentWork) {
    badges.push({ key: 'no-current', label: 'No current', tone: 'accent' });
  }

  return badges;
}

interface TrackerSignalBadgesProps {
  day: TrackerDeveloperDay;
  compact?: boolean;
  maxItems?: number;
}

export function TrackerSignalBadges({
  day,
  compact = false,
  maxItems = Number.POSITIVE_INFINITY,
}: TrackerSignalBadgesProps) {
  const badges = getSignalBadges(day).slice(0, maxItems);

  if (badges.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {badges.map((badge) => (
        <span
          key={badge.key}
          className={`rounded-lg font-medium ${compact ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-[12px]'}`}
          style={toneStyles[badge.tone]}
        >
          {badge.label}
        </span>
      ))}
    </div>
  );
}
