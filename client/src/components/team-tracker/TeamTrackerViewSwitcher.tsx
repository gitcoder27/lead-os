import { Users, UserMinus } from 'lucide-react';

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
      className="ui-tabs"
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

          >
            <Icon size={13} aria-hidden="true" />
            <span>{lens.label}</span>
            <span className="tabular-nums text-[12px]" style={{ color: 'var(--text-muted)' }}>
              {counts[lens.key]}
            </span>
          </button>
        );
      })}
    </div>
  );
}
