import { describe, expect, it } from 'vitest';
import { describeSyncError } from '@/lib/sync-error';

describe('describeSyncError', () => {
  it.each([
    ['Jira authentication failed (401)', 'Jira rejected the saved credentials.'],
    ['Jira access denied (403)', 'Jira denied access to the configured project or query.'],
    ['Jira resource not found (404)', 'Jira could not find the configured site or query.'],
    ['Jira request timed out after 30000ms', 'Jira did not respond.'],
    ['TimeoutError', 'Jira did not respond.'],
    ['Jira request was aborted', 'Jira did not respond.'],
    ['fetch failed', 'Jira did not respond.'],
    ['Failed to fetch', 'Jira did not respond.'],
    ['Network error', 'Jira did not respond.'],
    ['connect ECONNREFUSED 127.0.0.1:9', 'Jira did not respond.'],
    ['Jira RATE LIMIT exceeded', 'Jira rate limit hit. Auto-retrying shortly.'],
    ['Jira API error (429): {"errorMessages":["slow down"]}', 'Jira rate limit hit. Auto-retrying shortly.'],
    ['Jira API error (500): {"errorMessages":["credentials 401 timeout"]}', 'Jira returned an error (500).'],
    ['Jira API error (502): <html>Bad gateway</html>', 'Jira returned an error (502).'],
    ['Unexpected failure: {"diagnostic":"secret"}', 'Jira sync failed.'],
    [undefined, 'Jira sync failed.'],
    ['', 'Jira sync failed.'],
  ])('describes %s without exposing the diagnostic body', (message, expected) => {
    expect(describeSyncError(message)).toBe(expected);
    expect(describeSyncError(message)).not.toContain('{');
  });
});
