import { useMemo } from 'react';
import { CircleCheck } from 'lucide-react';
import { EmptyState } from '@/components/ui/EmptyState';
import { groupTaskViewTasks } from '@/lib/task-views';
import { quietChips } from '@/lib/weekly-review-decisions';
import { findSection, type ReviewStepContext } from '@/lib/weekly-review';
import type { WeeklyReviewTaskRow } from '@/types';
import { ReviewChips } from './ReviewChips';
import { ReviewDecisionList, type DecisionGroup } from './ReviewDecisionList';
import { ReviewSourceNote } from './ReviewSourceNote';

/**
 * docs/59 §5.3 step 2: what is waiting or delegated and has gone quiet (check date passed, or nobody
 * touched it for the manager-touch days), grouped by the party waited on.
 */
export function ReviewWaitingStep({ ctx }: { ctx: ReviewStepContext }) {
  const section = findSection(ctx.review, 'quiet');
  const rows = section?.rows;
  const groups = useMemo<DecisionGroup[]>(() => {
    const ownerName = (ownerType: string | null, ownerId: string | null) => (ownerType === 'developer' && ownerId ? ctx.personName(ownerId) : 'Me');
    return groupTaskViewTasks(rows ?? [], 'party', ctx.review.today, ownerName, ctx.selfAccountId).map((bucket) => ({
      key: bucket.key.replace(/[^A-Za-z0-9_-]/g, '-'),
      label: bucket.label === 'Blocked' ? 'Blocked' : bucket.label,
      rows: bucket.tasks as WeeklyReviewTaskRow[],
    }));
  }, [rows, ctx]);

  if (section?.status === 'unavailable') return <ReviewSourceNote what="what is waiting" onRetry={ctx.retry} />;
  if (groups.length === 0) {
    return <EmptyState compact tone="success" icon={<CircleCheck size={20} />} title="Nothing has gone quiet" body="Everything you're waiting on has moved recently or isn't due yet." />;
  }
  return (
    <ReviewDecisionList
      ctx={ctx}
      mode="waiting"
      groups={groups}
      renderMeta={(row) => <ReviewChips chips={quietChips(row, ctx.review.today)} />}
    />
  );
}
