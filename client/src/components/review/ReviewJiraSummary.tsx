import { buildWeeklyReport } from '@/lib/weekly-report';
import type { ReviewStepContext } from '@/lib/weekly-review';
import { ReviewSourceNote } from './ReviewSourceNote';

/** The same report lines and persisted selection as Send update. */
export function ReviewJiraSummary({ ctx }: { ctx: ReviewStepContext }) {
  if (!ctx.review.jira) return null;
  if (ctx.review.jira.status === 'unavailable') return <ReviewSourceNote what="Jira totals" onRetry={ctx.retry} />;
  const lines = buildWeeklyReport(ctx.review, { excluded: ctx.saved.excluded }).sections[0]!.lines.filter((line) =>
    line.id.startsWith('jira:'),
  );
  return (
    <section className="review-group" aria-label="Jira">
      <h3 className="today-subhead review-subhead">Jira</h3>
      <ul className="review-jira-lines">
        {lines.map((line) => (
          <li key={line.id}>
            <label>
              <input
                className="review-check"
                type="checkbox"
                checked={line.included}
                onChange={() => ctx.setIncluded(line.id, line.defaultIncluded, !line.included)}
                onKeyDown={(event) => {
                  if (event.key === 'x' && !event.metaKey && !event.ctrlKey && !event.altKey) {
                    event.preventDefault();
                    ctx.setIncluded(line.id, line.defaultIncluded, !line.included);
                  }
                }}
              />
              <span>{line.text}</span>
            </label>
          </li>
        ))}
      </ul>
    </section>
  );
}
