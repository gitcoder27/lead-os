import type { ReactNode } from 'react';

/**
 * Building blocks for the landing page's product replicas: small, static
 * renderings of real LeadOS screens, drawn with the app's own tokens so they
 * follow the visitor's theme. Nothing inside a replica is interactive.
 */

export function ReplicaFrame({ label, children, className = '' }: { label: string; children: ReactNode; className?: string }) {
  return (
    <figure className={`lp-replica ${className}`} aria-label={label}>
      {children}
    </figure>
  );
}

/** A section label as the app draws it ("MY PLAN · 3"). */
export function ReplicaLabel({ children, count }: { children: ReactNode; count?: number }) {
  return (
    <p className="lp-r-label">
      {children}
      {count !== undefined ? <span className="lp-r-count">{count}</span> : null}
    </p>
  );
}

export function TaskKey({ children }: { children: ReactNode }) {
  return <span className="lp-r-key">{children}</span>;
}

/** Looks like the app's row action; it is text, so it is never a dead control. */
export function FakeAction({ children, tone = 'accent' }: { children: ReactNode; tone?: 'accent' | 'quiet' }) {
  return <span className="lp-r-action" data-tone={tone}>{children}</span>;
}

export function StatusDot({ tone }: { tone: 'danger' | 'warning' | 'success' | 'accent' | 'muted' }) {
  return <span className="lp-r-dot" data-tone={tone} aria-hidden="true" />;
}
