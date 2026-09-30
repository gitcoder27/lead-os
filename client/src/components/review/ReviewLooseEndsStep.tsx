import { useMemo } from 'react';
import { CircleCheck } from 'lucide-react';
import { EmptyState } from '@/components/ui/EmptyState';
import { looseEndMeta } from '@/lib/weekly-review-decisions';
import { findSection, type ReviewStepContext } from '@/lib/weekly-review';
import { ReviewDecisionList, type DecisionGroup } from './ReviewDecisionList';

const GROUPS = [
  { id: 'slipped', label: 'Slipped' },
  { id: 'inbox', label: 'Inbox' },
  { id: 'undated', label: 'Undated for 2+ weeks' },
] as const;

/** docs/59 §5.3 step 3: my slipped plans, Inbox leftovers and old undated tasks; plan them, park them or drop them. */
export function ReviewLooseEndsStep({ ctx }: { ctx: ReviewStepContext }) {
  const groups = useMemo<DecisionGroup[]>(
    () => GROUPS.map((group) => ({ key: group.id, label: group.label, rows: findSection(ctx.review, group.id)?.rows ?? [] })).filter((group) => group.rows.length > 0),
    [ctx.review],
  );
  if (groups.length === 0) {
    return <EmptyState compact tone="success" icon={<CircleCheck size={20} />} title="No loose ends" body="Every plan is on track and the Inbox is empty." />;
  }
  return (
    <ReviewDecisionList
      ctx={ctx}
      mode="loose"
      groups={groups}
      renderMeta={(row, group) => looseEndMeta(row, ctx.review.today, group.key as 'slipped' | 'inbox' | 'undated')}
    />
  );
}
