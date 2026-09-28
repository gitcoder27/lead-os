import { TriangleAlert, ArrowUpRight, Loader2, UserRound } from 'lucide-react';
import { useTrackerIssueAssignments } from '@/hooks/useTeamTracker';

interface TrackerIssueAssignmentConflictPanelProps {
  jiraKey: string;
  date: string;
  targetAccountId: string;
  onOpenAssignment: (itemId: number) => void;
}

function stateLabel(state: 'planned' | 'in_progress' | 'done' | 'dropped'): string {
  switch (state) {
    case 'in_progress':
      return 'Active';
    case 'done':
      return 'Done';
    case 'dropped':
      return 'Dropped';
    default:
      return 'Planned';
  }
}

export function TrackerIssueAssignmentConflictPanel({
  jiraKey,
  date,
  targetAccountId,
  onOpenAssignment,
}: TrackerIssueAssignmentConflictPanelProps) {
  const assignmentQuery = useTrackerIssueAssignments(jiraKey, date);
  const assignments = assignmentQuery.data ?? [];

  if (assignmentQuery.isLoading) {
    return (
      <div
        className="flex items-center gap-2 rounded-xl px-3 py-2 text-[12px]"
        style={{
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border)',
          color: 'var(--text-secondary)',
        }}
      >
        <Loader2 size={12} className="animate-spin" />
        Checking existing Team Tracker assignments…
      </div>
    );
  }

  if (assignmentQuery.isError || assignments.length === 0) {
    return null;
  }

  const sameDeveloperAssignments = assignments.filter(
    (assignment) => assignment.developer.accountId === targetAccountId
  );
  const sameDeveloperName =
    sameDeveloperAssignments[0]?.developer.displayName ?? 'This developer';
  const heading =
    sameDeveloperAssignments.length > 0
      ? `${jiraKey} is already on ${sameDeveloperName}'s board today.`
      : `${jiraKey} is already assigned in Team Tracker today.`;
  const tone = sameDeveloperAssignments.length > 0 ? 'var(--warning)' : 'var(--accent)';

  return (
    <div
      className="rounded-xl px-3 py-3"
      style={{
        background: 'color-mix(in srgb, var(--warning) 10%, var(--bg-elevated) 90%)',
        border: '1px solid color-mix(in srgb, var(--warning) 24%, var(--border) 76%)',
      }}
    >
      <div className="flex items-start gap-2">
        <TriangleAlert size={14} className="mt-0.5 shrink-0" style={{ color: tone }} />
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>
            {heading}
          </div>
          <div className="mt-1 text-[12px]" style={{ color: 'var(--text-secondary)' }}>
            Duplicates are still allowed in this flow. Open an existing assignment or add another task anyway.
          </div>
        </div>
      </div>

      <div className="mt-3 space-y-1.5">
        {assignments.map((assignment) => (
          <div
            key={assignment.itemId}
            className="flex items-center justify-between gap-2 rounded-lg px-2.5 py-2"
            style={{
              background: 'var(--bg-primary)',
              border: '1px solid var(--border)',
            }}
          >
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-[12px]" style={{ color: 'var(--text-muted)' }}>
                <UserRound size={10} />
                <span>{assignment.developer.displayName}</span>
                <span style={{ color: 'var(--border-strong)' }}>·</span>
                <span>{stateLabel(assignment.state)}</span>
              </div>
              <div className="mt-0.5 truncate text-[12px]" style={{ color: 'var(--text-primary)' }}>
                {assignment.title}
              </div>
            </div>
            <button
              type="button"
              onClick={() => onOpenAssignment(assignment.itemId)}
              className="flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-[12px] font-semibold"
              style={{
                background: 'var(--accent-glow)',
                color: 'var(--accent)',
                border: '1px solid color-mix(in srgb, var(--accent) 20%, transparent)',
              }}
            >
              <ArrowUpRight size={11} />
              Open
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
