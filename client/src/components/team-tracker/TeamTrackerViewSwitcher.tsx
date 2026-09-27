import { Users, UserMinus } from 'lucide-react';
import { FOCUS_RING } from '@/components/tasks/TaskDetailPrimitives';

export type TeamTrackerLens = 'team' | 'inactive';

interface TeamTrackerViewSwitcherProps {
  activeLens: TeamTrackerLens;
  onLensChange: (lens: TeamTrackerLens) => void;
  teamCount: number;
  inactiveCount: number;
}

const lensConfig: Array<{
  key: TeamTrackerLens;
  label: string;
  icon: typeof Users;
}> = [
  { key: 'team', label: 'Team', icon: Users },
  { key: 'inactive', label: 'Inactive', icon: UserMinus },
];

export function TeamTrackerViewSwitcher({
  activeLens,
  onLensChange,
  teamCount,
  inactiveCount,
}: TeamTrackerViewSwitcherProps) {
  const counts: Record<TeamTrackerLens, number> = {
    team: teamCount,
    inactive: inactiveCount,
  };

  return (
    <div
      className="inline-flex min-w-0 items-center gap-0.5 rounded-lg p-0.5"
      style={{ background: 'color-mix(in srgb, var(--bg-tertiary) 70%, transparent)' }}
      aria-label="Team tracker view"
      role="tablist"
    >
      {lensConfig.map((lens) => {
        const isActive = activeLens === lens.key;
        const Icon = lens.icon;

        return (
          <button
            key={lens.key}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onLensChange(lens.key)}
            className={`inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[12.5px] font-medium transition-colors ${isActive ? '' : 'hover:text-[var(--text-primary)]'} ${FOCUS_RING}`}
            style={{
              color: isActive ? 'var(--text-primary)' : 'var(--text-muted)',
              background: isActive ? 'var(--bg-elevated)' : 'transparent',
              boxShadow: isActive ? '0 1px 2px rgba(0, 0, 0, 0.16), inset 0 0 0 1px var(--border)' : 'none',
            }}
          >
            <Icon size={13} aria-hidden="true" />
            <span>{lens.label}</span>
            <span className="tabular-nums text-[11.5px]" style={{ color: 'var(--text-muted)' }}>
              {counts[lens.key]}
            </span>
          </button>
        );
      })}
    </div>
  );
}
