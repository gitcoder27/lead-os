import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorBanner } from '@/components/alerts/ErrorBanner';
import type { SyncStatus } from '@/types';

let syncStatus: SyncStatus | undefined;
let overviewError: Error | null = null;

vi.mock('@/hooks/useSyncStatus', () => ({ useSyncStatus: () => ({ data: syncStatus }) }));
vi.mock('@/hooks/useOverview', () => ({ useOverview: () => ({ error: overviewError }) }));

describe('ErrorBanner (docs/56 P2-03)', () => {
  beforeEach(() => {
    syncStatus = undefined;
    overviewError = null;
  });

  it('shows a sync error when Jira is connected', () => {
    syncStatus = { status: 'error', errorMessage: 'Token expired', jiraConfigured: true };
    render(<ErrorBanner />);
    expect(screen.getByText('Sync error: Token expired')).toBeInTheDocument();
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
    expect(screen.getByText('Sync error: Boom')).toBeInTheDocument();
  });
});
