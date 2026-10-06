import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorBanner } from '@/components/alerts/ErrorBanner';
import type { SyncStatus } from '@/types';

let syncStatus: SyncStatus | undefined;
let overviewError: Error | null = null;
const triggerSync = vi.fn();
let isPending = false;

vi.mock('@/hooks/useSyncStatus', () => ({ useSyncStatus: () => ({ data: syncStatus }) }));
vi.mock('@/hooks/useOverview', () => ({ useOverview: () => ({ error: overviewError }) }));
vi.mock('@/hooks/useTriggerSync', () => ({ useTriggerSync: () => ({ mutate: triggerSync, isPending }) }));

describe('ErrorBanner (docs/56 P2-03)', () => {
  beforeEach(() => {
    syncStatus = undefined;
    overviewError = null;
    isPending = false;
    triggerSync.mockReset();
    window.history.replaceState({}, '', '/work');
  });

  it('shows a sync error when Jira is connected', () => {
    syncStatus = { status: 'error', errorMessage: 'Token expired', jiraConfigured: true };
    render(<ErrorBanner />);
    expect(screen.getByText('Jira sync failed.')).toBeInTheDocument();
  });

  it('shows nothing red when Jira was never connected, however old the error is', () => {
    syncStatus = { status: 'error', errorMessage: 'Missing jira_project_key in config', jiraConfigured: false };
    const { container } = render(<ErrorBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it('ignores a rate-limit message without a connection, but still reports the server being down', () => {
    syncStatus = { status: 'error', errorMessage: 'Jira rate limit', jiraConfigured: false };
    overviewError = new Error('down');
    render(<ErrorBanner />);
    expect(screen.queryByText(/rate limit/i)).not.toBeInTheDocument();
    expect(screen.getByText('Cannot reach server. Showing last known data.')).toBeInTheDocument();
  });

  it('treats an unknown connection state as connected', () => {
    syncStatus = { status: 'error', errorMessage: 'Boom' };
    render(<ErrorBanner />);
    expect(screen.getByText('Jira sync failed.')).toBeInTheDocument();
  });

  it('shows plain feedback and the last good data time, retries, and navigates to Jira settings', () => {
    const diagnostic = 'Jira API error (500): {"errorMessages":["private response"]}';
    syncStatus = { status: 'error', errorMessage: diagnostic, lastSuccessAt: new Date(Date.now() - 120_000).toISOString() };
    const { container } = render(<ErrorBanner />);
    expect(screen.getByText('Jira returned an error (500).')).toBeInTheDocument();
    expect(screen.getByText('Data last updated 2 minutes ago')).toBeInTheDocument();
    expect(container.textContent).not.toContain('{');
    expect(container.textContent).not.toContain('private response');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(triggerSync).toHaveBeenCalledTimes(1);
    const settings = screen.getByRole('link', { name: 'Open Settings' });
    expect(settings).toHaveAttribute('href', '/settings?section=connection');
    const popstate = vi.fn();
    window.addEventListener('popstate', popstate);
    try {
      fireEvent.click(settings);
      expect(window.location.pathname + window.location.search).toBe('/settings?section=connection');
      expect(popstate).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener('popstate', popstate);
    }
  });

  it('disables Retry while the sync mutation is pending and omits an unknown last-good time', () => {
    syncStatus = { status: 'error', errorMessage: 'fetch failed' };
    isPending = true;
    render(<ErrorBanner />);
    expect(screen.getByRole('button', { name: 'Retry' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(triggerSync).not.toHaveBeenCalled();
    expect(screen.queryByText(/Data last updated/)).not.toBeInTheDocument();
  });

  it.each(['rate limit', 'server down'])('preserves the %s warning without sync recovery controls', (variant) => {
    syncStatus = { status: 'error', errorMessage: variant === 'rate limit' ? 'Jira rate limit' : 'Jira API error (500): {}', lastSuccessAt: new Date().toISOString() };
    if (variant === 'server down') overviewError = new Error('down');
    render(<ErrorBanner />);
    expect(screen.getByText(variant === 'rate limit' ? 'Jira rate limit hit. Auto-retrying shortly.' : 'Cannot reach server. Showing last known data.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Open Settings' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Data last updated/)).not.toBeInTheDocument();
  });
});
