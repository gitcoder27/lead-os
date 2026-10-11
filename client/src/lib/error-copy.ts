import { ApiRequestError } from './api';

/**
 * docs/73 UXD-27: what a failed read says. The headline is plain and comes from the status, never
 * from the server's message; the server's own words (and the status) go behind "Details".
 */
export interface ErrorCopy {
  headline: string;
  /** The headline without its "Couldn't load X." lead, for pages whose title already says so. */
  reason: string;
  detail?: string;
}

function statusOf(error: unknown): number | undefined {
  if (error instanceof ApiRequestError) return error.status;
  if (error && typeof error === 'object' && 'status' in error && typeof (error as { status: unknown }).status === 'number') {
    return (error as { status: number }).status;
  }
  return undefined;
}

/** `subject` names what failed, e.g. "Inbox" or "Today"; it starts the headline when there is one. */
export function describeLoadError(error: unknown, subject?: string): ErrorCopy {
  const status = statusOf(error);
  const what = subject ? `Couldn't load ${subject}.` : "Couldn't load this.";
  let headline: string;
  if (status === undefined || status === 0) headline = `${what} Check your connection, then retry.`;
  else if (status === 401) headline = 'Your session has ended. Sign in again to continue.';
  else if (status === 403) headline = `You don't have access to ${subject ?? 'this'}.`;
  else if (status === 404) headline = `${subject ? subject.charAt(0).toUpperCase() + subject.slice(1) : 'This'} isn't available any more.`;
  else if (status === 408 || status === 429) headline = `${what} The server is busy; wait a moment, then retry.`;
  else if (status >= 500) headline = `${what} Something went wrong on the server; retry in a moment.`;
  else headline = `${what} Retry, or reload the page.`;

  const message = error instanceof Error ? error.message.trim() : '';
  const parts = [message && message !== headline ? message : '', status ? `Status ${status}` : ''].filter(Boolean);
  const reason = headline.startsWith(`${what} `) ? headline.slice(what.length + 1) : headline;
  return { headline, reason, detail: parts.length ? parts.join(' · ') : undefined };
}
