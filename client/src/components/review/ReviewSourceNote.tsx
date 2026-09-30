import { CircleAlert } from 'lucide-react';

/** docs/59 §5.4: one source failed; the rest of the step still works. */
export function ReviewSourceNote({ what, onRetry }: { what: string; onRetry: () => void }) {
  return (
    <p className="review-source-note" role="status">
      <CircleAlert size={14} aria-hidden="true" />
      <span>Couldn&apos;t load {what}</span>
      <span aria-hidden="true">·</span>
      <button type="button" className="ui-link" onClick={onRetry}>Retry</button>
    </p>
  );
}
