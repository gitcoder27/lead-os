import { motion } from 'framer-motion';
import { workloadAccent, workloadAssignedLabel } from '@/lib/utils';
import type { DeveloperWorkload } from '@/types';

interface DeveloperCardProps {
  dev: DeveloperWorkload;
  expanded: boolean;
  active?: boolean;
  onClick: () => void;
}

export function DeveloperCard({ dev, expanded, active = false, onClick }: DeveloperCardProps) {
  const maxScore = 20;
  const fillPercent = Math.min((dev.score / maxScore) * 100, 100);
  const assignedLabel = workloadAssignedLabel(dev);
  const color = workloadAccent(dev);
  const isIdle = dev.signals?.idle ?? false;
  const hasMismatch = dev.signals?.backlogTrackerMismatch ?? false;
  const noCurrentItem = dev.signals?.noCurrentItem ?? false;
  const statItems = [
    { label: 'Today', value: dev.assignedTodayCount ?? 0 },
    { label: 'Active Jira', value: dev.activeDefects },
    { label: 'Done', value: dev.completedTodayCount ?? 0 },
    { label: 'Blocked', value: dev.blocked },
  ];

  return (
    <button
      onClick={onClick}
      className="flex flex-col gap-2 cursor-pointer transition-all duration-200 rounded-[16px] border p-2.5 text-left"
      aria-pressed={active}
      style={{
        minWidth: expanded ? 160 : 0,
        borderColor: active ? 'var(--accent)' : 'var(--border)',
        background: active
          ? 'linear-gradient(180deg, color-mix(in srgb, var(--accent-glow) 72%, var(--bg-secondary) 28%) 0%, color-mix(in srgb, var(--accent-glow) 42%, var(--bg-primary) 58%) 100%)'
          : 'linear-gradient(180deg, color-mix(in srgb, var(--bg-secondary) 92%, white 8%) 0%, color-mix(in srgb, var(--bg-primary) 90%, var(--bg-secondary) 10%) 100%)',
        boxShadow: active ? '0 0 0 1px color-mix(in srgb, var(--accent) 28%, transparent), var(--soft-shadow)' : 'var(--soft-shadow)',
      }}
    >
      <div className="flex items-start gap-2">
        <span className="h-8 w-8 rounded-xl flex items-center justify-center shrink-0 text-[12px] font-semibold" style={{ background: isIdle ? 'var(--bg-tertiary)' : `${color}18`, color }}>
          {dev.developer.displayName
            .split(' ')
            .filter(Boolean)
            .slice(0, 2)
            .map((part) => part[0]?.toUpperCase() ?? '')
            .join('')}
        </span>
        <div className="min-w-0 flex-1">
          <span className="text-[13px] font-medium truncate block" style={{ color: 'var(--text-primary)' }}>
            {dev.developer.displayName}
          </span>
          <div className="mt-1 flex items-center gap-1.5 text-[11px] flex-wrap">
            <span
              className="rounded-full px-1.5 py-0.5 font-mono"
              style={{ color, background: `${color}14` }}
            >
              {assignedLabel} today
            </span>
            <span className="font-mono" style={{ color: 'var(--text-muted)' }}>
              S{dev.score}
            </span>
            {dev.trackerStatus && (
              <span className="uppercase" style={{ color: 'var(--text-muted)', letterSpacing: '0.08em' }}>
                {dev.trackerStatus.replace(/_/g, ' ')}
              </span>
            )}
          </div>
        </div>
        <div className="flex flex-col items-end gap-0.5 shrink-0">
          {isIdle && (
            <span
              className="text-[10px] uppercase font-semibold rounded-full px-1.5 py-0.5"
              style={{ color: 'var(--text-muted)', background: 'var(--bg-tertiary)', letterSpacing: '0.06em' }}
            >
              idle
            </span>
          )}
          {hasMismatch && (
            <span
              className="text-[10px] uppercase font-semibold rounded-full px-1.5 py-0.5"
              style={{ color: 'var(--warning)', background: 'rgba(245,158,11,0.10)', letterSpacing: '0.06em' }}
            >
              mismatch
            </span>
          )}
          {noCurrentItem && !isIdle && (
            <span
              className="text-[10px] uppercase font-semibold rounded-full px-1.5 py-0.5"
              style={{ color: 'var(--warning)', background: 'rgba(245,158,11,0.10)', letterSpacing: '0.06em' }}
            >
              no current
            </span>
          )}
        </div>
      </div>

      <div className="w-full h-2.5 rounded-full overflow-hidden" style={{ background: 'var(--bg-tertiary)' }}>
        <motion.div
          className="h-full rounded-full"
          initial={{ width: 0 }}
          animate={{ width: `${fillPercent}%` }}
          transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1], delay: 0.2 }}
          style={{ background: color }}
        />
      </div>

      <div className="flex items-end justify-between gap-3">
        <div>
          <span className="font-mono text-[20px] font-semibold tabular-nums" style={{ color }}>
            {assignedLabel}
          </span>
          <span className="ml-2 font-mono text-[12px]" style={{ color: 'var(--text-muted)' }}>
            S{dev.score}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[12px] uppercase rounded-full px-2 py-1" style={{ color, background: `${color}14`, letterSpacing: '0.08em' }}>
            {dev.level}
          </span>
        </div>
      </div>

      {expanded && (
        <div className="grid grid-cols-2 gap-2 text-[12px] mt-1">
          {statItems.map((stat) => (
            <span
              key={stat.label}
              className="rounded-xl px-2 py-2"
              style={{ color: 'var(--text-secondary)', background: 'var(--bg-tertiary)' }}
            >
              {stat.label}: <span className="font-mono">{stat.value}</span>
            </span>
          ))}
          <span className="rounded-xl px-2 py-2" style={{ color: 'var(--text-secondary)', background: 'var(--bg-tertiary)' }}>
            Due: <span className="font-mono">{dev.dueToday}</span>
          </span>
        </div>
      )}
    </button>
  );
}
