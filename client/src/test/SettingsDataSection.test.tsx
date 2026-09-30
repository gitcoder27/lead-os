import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { SettingsDataSection } from '@/components/settings/SettingsDataSection';
import { TestWrapper } from '@/test/wrapper';
import type { BackupListResponse } from '@/types';

const mockGet = vi.fn();
const mockPost = vi.fn();
const mockPut = vi.fn();
const mockAddToast = vi.fn();

vi.mock('@/lib/api', () => ({
  api: {
    get: (...args: unknown[]) => mockGet(...args),
    post: (...args: unknown[]) => mockPost(...args),
    put: (...args: unknown[]) => mockPut(...args),
  },
}));

vi.mock('@/context/ToastContext', () => ({
  useToast: () => ({ addToast: mockAddToast }),
}));

let mockConfig: Record<string, unknown> | undefined;
vi.mock('@/hooks/useConfig', () => ({
  useConfig: () => ({ data: mockConfig }),
}));

const listing: BackupListResponse = {
  backups: [
    { name: 'dashboard.backup-20260930-030000000-scheduled.db', path: '/data/backups/a.db', sizeBytes: 2_621_440, createdAt: '2026-09-30T03:00:00.000Z', reason: 'scheduled' },
    { name: 'dashboard.backup-20260929-030000000-pre-reset.db', path: '/data/backups/b.db', sizeBytes: 900, createdAt: '2026-09-29T03:00:00.000Z', reason: 'pre reset' },
  ],
  runtime: { enabled: true, running: false, directory: '/data/backups', nextRunAt: '2099-01-01T00:00:00.000Z' },
};

function renderSection() {
  return render(
    <TestWrapper>
      <SettingsDataSection active />
    </TestWrapper>
  );
}

beforeEach(() => {
  mockGet.mockReset();
  mockPost.mockReset();
  mockPut.mockReset();
  mockAddToast.mockReset();
  mockConfig = { backupEnabled: true, backupIntervalMinutes: 30, backupRetentionDays: 14, backupDirectory: '/data/backups' };
  mockGet.mockImplementation((url: string) => (url === '/backups' ? Promise.resolve(listing) : Promise.reject(new Error(`Unexpected ${url}`))));
});

describe('SettingsDataSection (docs/56 P6-01)', () => {
  it('lists snapshots with reason, size and a download link that hits the manager-only endpoint', async () => {
    renderSection();

    const rows = await screen.findAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByText('scheduled', { selector: 'span' })).toBeInTheDocument();
    expect(within(rows[0]!).getByText(/2\.5 MB/)).toBeInTheDocument();
    expect(within(rows[1]!).getByText(/900 B/)).toBeInTheDocument();

    const link = screen.getByRole('link', { name: 'Download dashboard.backup-20260930-030000000-scheduled.db' });
    expect(link).toHaveAttribute('href', '/api/backups/dashboard.backup-20260930-030000000-scheduled.db/download');
    expect(link).toHaveAttribute('download', 'dashboard.backup-20260930-030000000-scheduled.db');
    expect(screen.getByText('/data/backups', { selector: 'code' })).toBeInTheDocument();
  });

  it('shows the schedule, next run and an empty state', async () => {
    mockGet.mockResolvedValue({ backups: [], runtime: { ...listing.runtime } });
    renderSection();

    expect(await screen.findByText(/No snapshots yet/)).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Scheduled backups' })).toBeChecked();
    expect(screen.getByLabelText('Backup frequency')).toHaveValue('30');
    expect(screen.getByLabelText('Backup retention days')).toHaveValue(14);
    expect(screen.getByText(/On\. Next backup/)).toBeInTheDocument();
  });

  it('Back up now posts once, confirms with a toast and refreshes the list', async () => {
    mockPost.mockResolvedValue({ success: true, backup: { ...listing.backups[0], name: 'dashboard.backup-x-manual.db' } });
    renderSection();
    await screen.findAllByRole('listitem');

    fireEvent.click(screen.getByRole('button', { name: 'Back up now' }));

    await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/backups/run', { reason: 'manual' }));
    await waitFor(() => expect(mockAddToast).toHaveBeenCalledWith(expect.objectContaining({ type: 'success', title: 'Backup created' })));
    await waitFor(() => expect(mockGet.mock.calls.filter(([url]) => url === '/backups').length).toBeGreaterThan(1));
  });

  it('surfaces a failed backup instead of pretending it worked', async () => {
    mockPost.mockRejectedValue(new Error('Cannot create backup while another backup is in progress'));
    renderSection();
    await screen.findAllByRole('listitem');

    fireEvent.click(screen.getByRole('button', { name: 'Back up now' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Cannot create backup while another backup is in progress');
    expect(mockAddToast).not.toHaveBeenCalled();
  });

  it('saves schedule changes through the settings endpoint', async () => {
    mockPut.mockResolvedValue({ success: true });
    renderSection();
    await screen.findAllByRole('listitem');

    fireEvent.click(screen.getByRole('switch', { name: 'Scheduled backups' }));
    await waitFor(() => expect(mockPut).toHaveBeenCalledWith('/config/settings', { backupEnabled: false }));

    fireEvent.change(screen.getByLabelText('Backup frequency'), { target: { value: '360' } });
    await waitFor(() => expect(mockPut).toHaveBeenCalledWith('/config/settings', { backupIntervalMinutes: 360 }));

    const retention = screen.getByLabelText('Backup retention days');
    fireEvent.change(retention, { target: { value: '30' } });
    fireEvent.blur(retention);
    await waitFor(() => expect(mockPut).toHaveBeenCalledWith('/config/settings', { backupRetentionDays: 30 }));
  });

  it('does not save an unchanged or invalid retention value', async () => {
    renderSection();
    await screen.findAllByRole('listitem');
    const retention = screen.getByLabelText('Backup retention days');

    fireEvent.blur(retention);
    fireEvent.change(retention, { target: { value: '0' } });
    fireEvent.blur(retention);

    expect(mockPut).not.toHaveBeenCalled();
  });

  it('keeps restore CLI-only and says how', async () => {
    renderSection();
    await screen.findAllByRole('listitem');

    expect(screen.getByText(/Restore is not available in the app/)).toBeInTheDocument();
    expect(screen.getByText('npm run backup:restore -- <path-to-backup-db>')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /restore/i })).not.toBeInTheDocument();
  });

  it('surfaces a failed schedule save', async () => {
    mockPut.mockRejectedValue(new Error('Backup directory is not writable'));
    renderSection();
    await screen.findAllByRole('listitem');

    fireEvent.click(screen.getByRole('switch', { name: 'Scheduled backups' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Backup directory is not writable');
  });
});
