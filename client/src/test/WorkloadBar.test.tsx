import { beforeEach, describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { WorkloadBar } from '@/components/workload/WorkloadBar';
import { TestWrapper } from '@/test/wrapper';
import type { DeveloperWorkload } from '@/types';

const mockWorkload: DeveloperWorkload[] = [
  {
    developer: { accountId: 'alice-1', displayName: 'Alice', isActive: true },
    activeDefects: 4,
    dueToday: 1,
    blocked: 0,
    score: 9,
    level: 'medium',
    assignedTodayCount: 2,
    completedTodayCount: 1,
    signals: { idle: false, noCurrentItem: false, backlogTrackerMismatch: false },
  },
  {
    developer: { accountId: 'eve-5', displayName: 'Eve', isActive: true },
    activeDefects: 0,
    dueToday: 0,
    blocked: 0,
    score: 0,
    level: 'light',
    assignedTodayCount: 0,
    signals: { idle: true, noCurrentItem: false, backlogTrackerMismatch: false },
  },
];

vi.mock('@/hooks/useWorkload', () => ({
  useWorkload: () => ({ data: mockWorkload, isLoading: false }),
}));

describe('WorkloadBar', () => {
  const onDeveloperClick = vi.fn();

  beforeEach(() => {
    onDeveloperClick.mockClear();
  });

  it('renders developer cards', () => {
    render(
      <TestWrapper>
        <WorkloadBar onDeveloperClick={onDeveloperClick} />
      </TestWrapper>
    );

    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Eve')).toBeInTheDocument();
  });

  it('shows idle badge for signals.idle', async () => {
    render(
      <TestWrapper>
        <WorkloadBar onDeveloperClick={onDeveloperClick} />
      </TestWrapper>
    );

    fireEvent.click(screen.getAllByLabelText('Expand workload panel')[0]!);

    const idleBadges = screen.getAllByText('idle');
    expect(idleBadges.length).toBeGreaterThanOrEqual(1);
  });

  it('displays load and score labels', () => {
    render(
      <TestWrapper>
        <WorkloadBar onDeveloperClick={onDeveloperClick} />
      </TestWrapper>
    );

    expect(screen.getAllByText('2').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('S9')).toBeInTheDocument();
  });

  it('applies a developer filter when a collapsed pill is clicked', () => {
    render(
      <TestWrapper>
        <WorkloadBar onDeveloperClick={onDeveloperClick} />
      </TestWrapper>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Filter by Alice' }));

    expect(onDeveloperClick).toHaveBeenCalledWith('alice-1');
  });

  it('expands when the collapsed header empty space is clicked', () => {
    render(
      <TestWrapper>
        <WorkloadBar onDeveloperClick={onDeveloperClick} />
      </TestWrapper>
    );

    const header = screen.getByTestId('workload-bar-header');
    expect(header).toHaveClass('cursor-pointer');

    fireEvent.click(header);

    expect(screen.getByText('Team capacity radar')).toBeInTheDocument();
    expect(header).not.toHaveClass('cursor-pointer');
    expect(onDeveloperClick).not.toHaveBeenCalled();
  });

  it('clears the developer filter when the active pill is clicked again', () => {
    render(
      <TestWrapper>
        <WorkloadBar activeDeveloper="alice-1" onDeveloperClick={onDeveloperClick} />
      </TestWrapper>
    );

    const aliceFilter = screen.getByRole('button', { name: 'Filter by Alice' });
    expect(aliceFilter).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(aliceFilter);

    expect(onDeveloperClick).toHaveBeenCalledWith(undefined);
  });
});
