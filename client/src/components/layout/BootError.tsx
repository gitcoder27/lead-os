import { RefreshCw } from 'lucide-react';
import { LeadOSMark } from '@/components/brand/LeadOSMark';
import { ErrorDetails } from '@/components/ui/QueryReadError';
import { describeLoadError } from '@/lib/error-copy';

/**
 * docs/73 UXD-27: when LeadOS can't reach its server before anyone is signed in, the page is
 * still recognisably LeadOS — the mark, one plain sentence, Retry, and the details on request —
 * not a bare line on an empty gradient.
 */
export function BootError({ error, onRetry, retrying = false }: { error: unknown; onRetry: () => unknown; retrying?: boolean }) {
  const copy = describeLoadError(error, 'LeadOS');
  return (
    <main className="flex h-full items-center justify-center px-4" style={{ background: 'var(--bg-primary)' }}>
      <div role="alert" className="flex w-full max-w-sm flex-col items-center text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-[14px]" style={{ background: 'color-mix(in srgb, var(--accent) 14%, transparent)' }}>
          <LeadOSMark size={28} />
        </span>
        <h1 className="ui-page-title mt-4">LeadOS didn&apos;t start</h1>
        <p className="mt-1.5 text-body" style={{ color: 'var(--text-secondary)' }}>{copy.reason}</p>
        <button type="button" className="ui-btn-solid mt-4 inline-flex items-center gap-1.5" disabled={retrying} onClick={() => void onRetry()}>
          <RefreshCw size={13} aria-hidden="true" className={retrying ? 'animate-spin' : undefined} />
          {retrying ? 'Retrying…' : 'Retry'}
        </button>
        {copy.detail ? <div className="mt-3"><ErrorDetails detail={copy.detail} /></div> : null}
      </div>
    </main>
  );
}
