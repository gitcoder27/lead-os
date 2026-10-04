import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkSyncControls } from '@/components/work/WorkSyncControls';

const useSyncStatusMock = vi.fn();
vi.mock('@/hooks/useSyncStatus', () => ({ useSyncStatus: () => useSyncStatusMock() }));
vi.mock('@/hooks/useTriggerSync', () => ({ useTriggerSync: () => ({ mutate: vi.fn(), isPending: false }) }));

/** docs/56 UX-18: the Jira sync chip and manual sync moved from the global header into the Work toolbar. */
describe('WorkSyncControls', () => {
  beforeEach(() => {
    useSyncStatusMock.mockReturnValue({ data: { status: 'idle', lastSyncedAt: null } });
  });

  it('shows the last sync time while Jira auto-sync is enabled', () => {
    useSyncStatusMock.mockReturnValue({
      data: { status: 'idle', lastSyncedAt: '2026-09-08T09:00:00.000Z', autoSyncEnabled: true },
    });
    render(<WorkSyncControls />);

    expect(screen.getByText(/Synced/)).toBeInTheDocument();
  });

  it('shows the sync-off state instead of the last sync time when auto-sync is disabled', () => {
    useSyncStatusMock.mockReturnValue({
      data: { status: 'idle', lastSyncedAt: '2026-09-08T09:00:00.000Z', autoSyncEnabled: false },
    });
    render(<WorkSyncControls />);

    expect(screen.getByText('Sync off')).toBeInTheDocument();
    expect(screen.queryByText(/Synced/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /manual sync/i })).toBeEnabled();
  });

  it('still surfaces a sync error when auto-sync is disabled', () => {
    useSyncStatusMock.mockReturnValue({
      data: { status: 'error', errorMessage: 'Jira authentication failed (401)', autoSyncEnabled: false },
    });
    render(<WorkSyncControls />);

    expect(screen.getByText('Sync issue')).toBeInTheDocument();
    expect(screen.queryByText('Sync off')).not.toBeInTheDocument();
    expect(screen.getByTitle(/Jira authentication failed \(401\)/)).toBeInTheDocument();
  });

  it('hides the sync chip and manual sync when Jira is not connected (docs/56 P2-03)', () => {
    useSyncStatusMock.mockReturnValue({
      data: { status: 'error', errorMessage: 'Missing jira_project_key in config', autoSyncEnabled: true, jiraConfigured: false },
    });
    render(<WorkSyncControls />);

    expect(screen.queryByText('Sync issue')).not.toBeInTheDocument();
    expect(screen.queryByText(/Synced|Sync off|Not synced/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /manual sync/i })).not.toBeInTheDocument();
  });

  it('keeps sync controls when Jira is connected, and while the status is still unknown', () => {
    useSyncStatusMock.mockReturnValue({ data: { status: 'idle', autoSyncEnabled: true, jiraConfigured: true } });
    const { unmount } = render(<WorkSyncControls />);
    expect(screen.getByRole('button', { name: /manual sync/i })).toBeInTheDocument();
    unmount();

    useSyncStatusMock.mockReturnValue({ data: undefined });
    render(<WorkSyncControls />);
    expect(screen.getByRole('button', { name: /manual sync/i })).toBeInTheDocument();
  });

  it('advances the relative sync label over time without new sync data', () => {
    vi.useFakeTimers();
    try {
      const syncedAt = new Date(Date.now() - 60_000).toISOString();
      useSyncStatusMock.mockReturnValue({
        data: { status: 'idle', lastSyncedAt: syncedAt, autoSyncEnabled: true },
      });

      render(<WorkSyncControls />);
      expect(screen.getByText('Synced 1 minute ago')).toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(61_000);
      });

      expect(screen.getByText('Synced 2 minutes ago')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});
