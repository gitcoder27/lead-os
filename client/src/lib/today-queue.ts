import type { TodayActionCommand, TodayResponse } from '@/types';
import { buildTodayQueueView, type TodayQueueView } from '@/lib/today-triage';
import { groupQueueItems, splitPanelRows, withoutWrapUpItems, type TodayPanelRows, type TodayQueueGroup } from '@/lib/today-layout';

export interface DerivedTodayQueue {
  panelRows: TodayPanelRows;
  queueGroups: Map<string, TodayQueueGroup>;
  groupByCommand: Map<TodayActionCommand, TodayQueueGroup>;
  queueView: TodayQueueView;
}

/**
 * The queue Today renders: the panel owns standup, 1:1s and carry-forward (and wrap-up's
 * promises); what's left is grouped one-row-per-fact, and the total shrinks by exactly what
 * moved or folded. docs/73 UXD-06: the nav's Today badge reads the same total, so it always
 * equals the "Queue N" header.
 */
export function deriveTodayQueue(snapshot: TodayResponse | undefined, options: { expanded: boolean; visibleLimit: number }): DerivedTodayQueue {
  const focus = snapshot?.focus;
  const visible = withoutWrapUpItems(snapshot?.actionItems ?? [], focus);
  const overflow = withoutWrapUpItems(snapshot?.overflowActionItems ?? [], focus);
  const onPlan = new Set((focus?.plan?.items ?? []).map((item) => item.taskKey));
  const split = splitPanelRows([...visible, ...overflow], onPlan);
  const grouped = groupQueueItems(split.queue);
  const shipped = (snapshot?.actionItems.length ?? 0) + (snapshot?.overflowActionItems?.length ?? 0);
  const removed = shipped - grouped.items.length;
  // Group rows are synthetic: their primary command is recognised by identity.
  const byCommand = new Map<TodayActionCommand, TodayQueueGroup>();
  for (const item of grouped.items) {
    const group = grouped.groups.get(item.id);
    if (group) byCommand.set(item.primaryAction, group);
  }
  return {
    panelRows: split,
    queueGroups: grouped.groups,
    groupByCommand: byCommand,
    queueView: buildTodayQueueView({
      items: grouped.items,
      totalCount: snapshot?.totalCount === undefined ? undefined : Math.max(snapshot.totalCount - removed, 0),
      expanded: options.expanded,
      visibleLimit: options.visibleLimit,
    }),
  };
}
