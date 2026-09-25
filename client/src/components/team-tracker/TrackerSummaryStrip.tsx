import { motion } from 'framer-motion';
import { AlertTriangle, CalendarClock, CheckCircle2, CircleOff, Clock, MessageCircleWarning, Pause, ShieldAlert } from 'lucide-react';
import type { TrackerBoardSummary, TrackerBoardSummaryFilter } from '@/types';

interface TrackerSummaryStripProps {
  summary: TrackerBoardSummary;
  activeFilter: TrackerBoardSummaryFilter;
  onFilterChange: (filter: TrackerBoardSummaryFilter) => void;
}

const chips: Array<{
  key: TrackerBoardSummaryFilter;
  label: string;
  icon: typeof AlertTriangle;
  countKey: keyof TrackerBoardSummary;
  color: string;
}> = [
  { key: 'stale', label: 'Stale', icon: Clock, countKey: 'stale', color: 'var(--warning)' },
  { key: 'blocked', label: 'Blocked', icon: ShieldAlert, countKey: 'blocked', color: 'var(--danger)' },
  { key: 'at_risk', label: 'At Risk', icon: AlertTriangle, countKey: 'atRisk', color: 'var(--warning)' },
  { key: 'waiting', label: 'Waiting', icon: Pause, countKey: 'waiting', color: 'var(--info)' },
  { key: 'overdue_linked', label: 'Overdue Jira', icon: CalendarClock, countKey: 'overdueLinkedWork', color: 'var(--danger)' },
  { key: 'status_follow_up', label: 'Needs Follow-up', icon: MessageCircleWarning, countKey: 'statusFollowUp', color: 'var(--info)' },
  { key: 'no_current', label: 'No Current', icon: CircleOff, countKey: 'noCurrent', color: 'var(--text-muted)' },
  { key: 'done_for_today', label: 'Done', icon: CheckCircle2, countKey: 'doneForToday', color: 'var(--success)' },
];

export function TrackerSummaryStrip({ summary, activeFilter, onFilterChange }: TrackerSummaryStripProps) {
  const visibleChips = chips.filter((chip) => summary[chip.countKey] > 0 || activeFilter === chip.key);

  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="flex items-center gap-1.5 overflow-x-auto no-scrollbar"
    >
      <button
        type="button"
        onClick={() => onFilterChange('all')}
        className="h-8 shrink-0 rounded-lg px-2.5 text-[12px] font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--border-active)]"
        style={{
          background: activeFilter === 'all' ? 'var(--bg-elevated)' : 'transparent',
          border: `1px solid ${activeFilter === 'all' ? 'var(--border)' : 'transparent'}`,
          color: activeFilter === 'all' ? 'var(--text-primary)' : 'var(--text-muted)',
        }}
      >
        {summary.total} total
      </button>

      {visibleChips.length === 0 && (
        <span className="text-[13px]" style={{ color: 'var(--text-muted)' }}>
          No active risk signals
        </span>
      )}

      {visibleChips.map((chip) => {
        const count = summary[chip.countKey];
        const isActive = activeFilter === chip.key;
        const Icon = chip.icon;

        return (
          <button
            key={chip.key}
            onClick={() => onFilterChange(chip.key === activeFilter ? 'all' : chip.key)}
            className="flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-[12px] font-semibold transition-all focus:outline-none focus:ring-2 focus:ring-[var(--border-active)]"
            style={{
              background: isActive ? `color-mix(in srgb, ${chip.color} 12%, var(--bg-elevated))` : 'transparent',
              border: `1px solid ${isActive ? `color-mix(in srgb, ${chip.color} 34%, var(--border))` : 'var(--border)'}`,
              color: isActive ? chip.color : 'var(--text-secondary)',
            }}
            >
              <Icon size={12} />
              <span>{count} {chip.label.toLowerCase()}</span>
          </button>
        );
      })}
    </motion.div>
  );
}
