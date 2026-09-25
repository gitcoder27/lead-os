import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { Developer, TrackerWorkItem } from '@/types';
import { TrackerTaskExecutionPanel } from '@/components/team-tracker/TrackerTaskExecutionPanel';

const mockTimeline = vi.fn();
const mockComposer = vi.fn();
const mockReassign = vi.fn();

vi.mock('@/components/tasks/TaskTimeline', () => ({
  TaskTimeline: ({ taskKey, mode }: { taskKey: string; mode: string }) => (
    <div data-testid="task-timeline">{`Timeline ${taskKey} ${mode}`}</div>
  ),
}));

vi.mock('@/components/tasks/TaskUpdateComposer', () => ({
  TaskUpdateComposer: ({ taskKey, mode, via }: { taskKey: string; mode: string; via: string }) => (
    <div data-testid="task-composer">{`Composer ${taskKey} ${mode} ${via}`}</div>
  ),
}));

vi.mock('@/hooks/useManagerDesk', async () => {
  const actual =
    await vi.importActual<typeof import('@/hooks/useManagerDesk')>('@/hooks/useManagerDesk');
  return {
    ...actual,
    useManagerDeskDeveloperLookup: () => ({
      data: [
        { accountId: 'dev-1', displayName: 'Alice Smith' },
        { accountId: 'dev-2', displayName: 'Bob Jones' },
      ],
      isLoading: false,
    }),
  };
});

const developer: Developer = {
  accountId: 'dev-1',
  displayName: 'Alice Smith',
  isActive: true,
};

function buildItem(overrides: Partial<TrackerWorkItem> = {}): TrackerWorkItem {
  return {
    id: 42,
    dayId: 7,
    originDate: '2026-03-07',
    taskKey: 'T-9',
    lifecycle: 'tracker_only',
    itemType: 'custom',
    title: 'Fix the flapping test',
    state: 'planned',
    position: 0,
    createdAt: '2026-03-07T08:00:00Z',
    updatedAt: '2026-03-07T08:00:00Z',
    ...overrides,
  };
}

function renderPanel(overrides: Partial<TrackerWorkItem> = {}, onReassign = mockReassign) {
  return render(
    <TrackerTaskExecutionPanel
      developer={developer}
      item={buildItem(overrides)}
      date="2026-03-07"
      onSetCurrent={vi.fn()}
      onUpdateState={vi.fn()}
      onReassign={onReassign}
    />,
  );
}

describe('TrackerTaskExecutionPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the manager timeline and composer for keyed tasks', () => {
    renderPanel();

    expect(screen.getByTestId('task-timeline')).toHaveTextContent('Timeline T-9 manager');
    expect(screen.getByTestId('task-composer')).toHaveTextContent(
      'Composer T-9 manager task_drawer',
    );
    expect(screen.queryByText('No task timeline yet.')).not.toBeInTheDocument();
  });

  it('shows a timeline placeholder instead of a composer for unkeyed tasks', () => {
    renderPanel({ taskKey: null });

    expect(screen.getByText('No task timeline yet.')).toBeInTheDocument();
    expect(screen.queryByTestId('task-timeline')).not.toBeInTheDocument();
    expect(screen.queryByTestId('task-composer')).not.toBeInTheDocument();
  });

  it('hides the composer for closed tasks but keeps the timeline', () => {
    renderPanel({ state: 'done' });

    expect(screen.getByTestId('task-timeline')).toBeInTheDocument();
    expect(screen.queryByTestId('task-composer')).not.toBeInTheDocument();
  });

  it('reassigns tracker-only items through the developer picker', () => {
    renderPanel();

    fireEvent.click(screen.getByRole('button', { name: 'Reassign' }));
    fireEvent.click(screen.getByRole('button', { name: /Bob Jones/ }));

    expect(mockReassign).toHaveBeenCalledWith(42, 'dev-2');
    expect(screen.queryByText('Reassign to')).not.toBeInTheDocument();
  });

  it('ignores picking the same developer the task already belongs to', () => {
    renderPanel();

    fireEvent.click(screen.getByRole('button', { name: 'Reassign' }));
    fireEvent.click(screen.getByRole('button', { name: /Alice Smith/ }));

    expect(mockReassign).not.toHaveBeenCalled();
  });

  it('hides the reassign control for delegated and closed items', () => {
    const { rerender } = renderPanel({ managerDeskItemId: 5 });
    expect(screen.queryByRole('button', { name: 'Reassign' })).not.toBeInTheDocument();

    rerender(
      <TrackerTaskExecutionPanel
        developer={developer}
        item={buildItem({ state: 'dropped' })}
        date="2026-03-07"
        onSetCurrent={vi.fn()}
        onUpdateState={vi.fn()}
        onReassign={mockReassign}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Reassign' })).not.toBeInTheDocument();
  });
});
