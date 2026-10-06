/** Public sync feedback never includes Jira's diagnostic response body. */
export function describeSyncError(message?: string): string {
  // Jira appends response bodies after ":"; classify only the diagnostic prefix.
  const summary = (message ?? '').split(':', 1)[0] ?? '';
  const status = summary.match(/\b([45]\d{2})\b/)?.[1];
  if (status === '401') return 'Jira rejected the saved credentials.';
  if (status === '403') return 'Jira denied access to the configured project or query.';
  if (status === '404') return 'Jira could not find the configured site or query.';
  if (status === '429' || /rate[ -]?limit/i.test(summary)) {
    return 'Jira rate limit hit. Auto-retrying shortly.';
  }
  if (status) return `Jira returned an error (${status}).`;
  if (/timed?\s*out|timeout|network|fetch failed|failed to fetch|econn|enotfound|eai_again|aborted/i.test(summary)) {
    return 'Jira did not respond.';
  }
  return 'Jira sync failed.';
}
