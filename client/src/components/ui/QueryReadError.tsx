/** A failed read has its own retry affordance, including when cached content remains. */
export function QueryReadError({ message, onRetry, retrying = false }: {
  message: string;
  onRetry: () => unknown;
  retrying?: boolean;
}) {
  return (
    <div role="alert" className="flex flex-wrap items-center justify-center gap-3 px-4 py-4 text-[13px]" style={{ color: 'var(--text-secondary)' }}>
      <span>{message}</span>
      <button type="button" className="ui-btn-ghost" disabled={retrying} onClick={() => void onRetry()}>
        {retrying ? 'Retrying…' : 'Retry'}
      </button>
    </div>
  );
}
