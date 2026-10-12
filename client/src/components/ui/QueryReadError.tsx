import { Disclosure } from './Disclosure';

/**
 * A failed read has its own retry affordance, including when cached content remains.
 * docs/73 UXD-27: `detail` (the server's words, from `describeLoadError`) sits behind "Details",
 * never in the headline.
 */
export function QueryReadError({ message, onRetry, retrying = false, detail }: {
  message: string;
  onRetry: () => unknown;
  retrying?: boolean;
  detail?: string;
}) {
  return (
    <div role="alert" className="flex flex-col items-center gap-1 px-4 py-4 text-body" style={{ color: 'var(--text-secondary)' }}>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <span>{message}</span>
        <button type="button" className="ui-btn-ghost" disabled={retrying} onClick={() => void onRetry()}>
          {retrying ? 'Retrying…' : 'Retry'}
        </button>
      </div>
      {detail ? <ErrorDetails detail={detail} /> : null}
    </div>
  );
}

export function ErrorDetails({ detail }: { detail: string }) {
  return (
    <Disclosure summary="Details" className="text-ui" panelClassName="mt-1 max-w-[60ch] wrap-break-word text-ui">
      <p style={{ color: 'var(--text-muted)' }}>{detail}</p>
    </Disclosure>
  );
}
