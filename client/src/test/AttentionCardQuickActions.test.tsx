import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TestWrapper } from '@/test/wrapper';
import type { TrackerAttentionItem, TrackerDeveloperSignals } from '@/types';
import { AttentionCard } from '@/components/team-tracker/AttentionCard';

function buildSignals(overrides?: {
  freshness?: Partial<TrackerDeveloperSignals['freshness']>;
  risk?: Partial<TrackerDeveloperSignals['risk']>;
}): TrackerDeveloperSignals {
  return {
    freshness: {
      staleThresholdHours: 4,
      noCurrentThresholdHours: 2,
      statusFollowUpThresholdHours: 2,
      staleByTime: false,
      staleWithOpenRisk: false,
      staleWithoutCurrentWork: false,
      statusChangeWithoutFollowUp: false,
      ...overrides?.freshness,
    },
    risk: {
      openRisk: false,
      overdueLinkedWork: false,
      overdueLinkedCount: 0,
      ...overrides?.risk,
    },
  };
}

function buildAttentionItem(overrides: Partial<TrackerAttentionItem> = {}): TrackerAttentionItem {
  return {
    developer: { accountId: 'dev-1', displayName: 'Alice Smith', isActive: true },
    status: 'on_track',
    reasons: [{ code: 'no_current', label: 'No current item', priority: 4 }],
    lastCheckInAt: '2026-03-07T10:30:00Z',
    isStale: false,
    signals: buildSignals(),
    hasCurrentItem: false,
    plannedCount: 2,
    availableQuickActions: ['set_current', 'capture_follow_up'],
    setCurrentCandidates: [
      { id: 101, title: 'Fix regression bug', jiraKey: 'AM-456', lifecycle: 'tracker_only' },
    ],
    ...overrides,
  };
}

function renderCard(
  item: TrackerAttentionItem,
  props: Partial<{
    onOpen: () => void;
    onCaptureFollowUp: () => void;
    onSetCurrent: (itemId: number) => void;
  }> = {},
) {
  return render(
    <TestWrapper>
      <AttentionCard
        item={item}
        index={0}
        date="2026-03-07"
        onOpen={props.onOpen ?? vi.fn()}
        onMarkInactive={vi.fn()}
        onCaptureFollowUp={props.onCaptureFollowUp ?? vi.fn()}
        onSetCurrent={props.onSetCurrent}
      />
    </TestWrapper>,
  );
}

describe('AttentionCard compact action row', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-07T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders a compact reason line instead of a quick-action strip', () => {
    const item = buildAttentionItem({
      reasons: [
        { code: 'blocked', label: 'Blocked', priority: 1 },
        { code: 'stale_with_open_risk', label: 'Stale with risk', priority: 2 },
        { code: 'overdue_linked_work', label: 'Overdue linked work', priority: 3 },
      ],
      signals: buildSignals({ risk: { overdueLinkedWork: true, overdueLinkedCount: 1 } }),
      hasCurrentItem: true,
      isStale: true,
    });

    renderCard(item);

    expect(screen.getByText('Blocked · Stale with risk · +1 more')).toBeInTheDocument();
    expect(screen.queryByTestId('quick-action-update_status')).not.toBeInTheDocument();
  });

  it('clicking the attention row opens developer details', () => {
    const onOpen = vi.fn();

    renderCard(buildAttentionItem(), { onOpen });
    fireEvent.click(screen.getByRole('button', { name: /alice smith/i }));

    expect(onOpen).toHaveBeenCalled();
  });

  it('uses Set current as the one visible action when there is one candidate', () => {
    const onOpen = vi.fn();
    const onSetCurrent = vi.fn();

    renderCard(buildAttentionItem(), { onOpen, onSetCurrent });
    const setCurrentButton = screen
      .getAllByRole('button', { name: /set current/i })
      .find((element) => element.tagName === 'BUTTON');
    expect(setCurrentButton).toBeDefined();
    fireEvent.click(setCurrentButton!);

    expect(onSetCurrent).toHaveBeenCalledWith(101);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('uses Follow up as the one visible action for stale attention', () => {
    const onOpen = vi.fn();
    const onCaptureFollowUp = vi.fn();
    const item = buildAttentionItem({
      isStale: true,
      hasCurrentItem: true,
      currentItem: { id: 202, title: 'Validate checkout flow', jiraKey: 'AM-789', lifecycle: 'tracker_only' },
      setCurrentCandidates: [],
      signals: buildSignals({ freshness: { staleByTime: true } }),
    });

    renderCard(item, { onOpen, onCaptureFollowUp });
    expect(screen.getByText('Validate checkout flow')).toBeInTheDocument();
    expect(screen.queryByText('Active work is set')).not.toBeInTheDocument();

    const followUpButton = screen
      .getAllByRole('button', { name: /follow up/i })
      .find((element) => element.tagName === 'BUTTON');
    expect(followUpButton).toBeDefined();
    fireEvent.click(followUpButton!);

    expect(onCaptureFollowUp).toHaveBeenCalled();
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('falls back to Open when no direct single action is safe', () => {
    const item = buildAttentionItem({
      setCurrentCandidates: [
        { id: 101, title: 'Fix regression bug', lifecycle: 'tracker_only' },
        { id: 102, title: 'Review PR', lifecycle: 'manager_desk_linked' },
      ],
    });

    renderCard(item);

    expect(screen.getByText('Open')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /set current/i })).not.toBeInTheDocument();
  });
});
