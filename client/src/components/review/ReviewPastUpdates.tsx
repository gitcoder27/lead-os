import { useReviewPastWeeks } from '@/hooks/useWeeklyReview';
import { useToast } from '@/context/ToastContext';
import { copyReport } from '@/lib/report-clipboard';
import { formatWeekRange } from '@/lib/weekly-review';
import { ReviewSourceNote } from './ReviewSourceNote';

export function ReviewPastUpdates() {
  const query = useReviewPastWeeks();
  const { addToast } = useToast();
  const weeks = query.data?.weeks ?? [];
  const copy = async (text: string) => {
    try {
      await copyReport(text);
      addToast({ type: 'success', title: 'Copied as text' });
    } catch (error) {
      addToast({
        type: 'error',
        title: "Couldn't copy update",
        message: error instanceof Error ? error.message : 'Try again.',
      });
    }
  };
  return (
    <details className="review-past">
      <summary>Past updates</summary>
      {query.isError ? (
        <ReviewSourceNote what="past updates" onRetry={() => void query.refetch()} />
      ) : query.isPending ? (
        <p role="status">Loading past updates…</p>
      ) : weeks.length ? (
        <>
          <button
            type="button"
            className="ui-btn-ghost"
            disabled={!weeks.slice(0, 4).some((week) => week.reportMarkdown?.trim())}
            onClick={() =>
              void copy(
                weeks
                  .slice(0, 4)
                  .map((week) => week.reportMarkdown)
                  .filter(Boolean)
                  .join('\n\n'),
              )
            }
          >
            Copy last 4 weeks
          </button>
          <ul>
            {weeks.map((week) => (
              <li key={week.weekStart}>
                <span className="review-past-label">
                  <strong>{formatWeekRange(week.weekStart)}</strong>
                  <span>{week.reportMarkdown?.split('\n')[0]?.replace(/\*\*/g, '')}</span>
                </span>
                <button
                  type="button"
                  className="ui-btn-ghost"
                  aria-label={`Copy update for ${formatWeekRange(week.weekStart)}`}
                  disabled={!week.reportMarkdown?.trim()}
                  onClick={() => void copy(week.reportMarkdown!)}
                >
                  Copy
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p>No completed updates yet.</p>
      )}
    </details>
  );
}
