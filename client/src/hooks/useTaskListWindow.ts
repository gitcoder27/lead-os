import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { defaultRangeExtractor, observeElementRect, useVirtualizer } from '@tanstack/react-virtual';
import type { RenderGroup } from '@/lib/task-list';

/** One measured window across groups, labels and inline capture forms. */
export function useTaskListWindow(groups: RenderGroup[], scrollRef: RefObject<HTMLElement | null>, focusedKey: string | undefined, addingGroup: string | null, allowAdd: boolean) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const [scrollMargin, setScrollMargin] = useState(0);
  const model = useMemo(() => {
    const entries: { key: string; groupIndex: number; kind: 'header' | 'task' | 'add'; taskKey?: string; taskIndex?: number; size: number }[] = [];
    const starts: number[] = [];
    groups.forEach((group, groupIndex) => {
      starts.push(entries.length);
      entries.push({ key: `header:${group.key}`, groupIndex, kind: 'header', size: group.label ? (groupIndex ? 56 : 36) : 1 });
      if (group.collapsed) return;
      group.tasks.forEach((task, taskIndex) => entries.push({ key: `${group.key}:${task.taskKey}`, taskKey: task.taskKey, groupIndex, kind: 'task', taskIndex, size: 37 }));
      if (allowAdd && !group.collapsible && (addingGroup === group.key || !group.label)) {
        entries.push({ key: `add:${group.key}`, groupIndex, kind: 'add', size: 38 });
      }
    });
    return { entries, starts };
  }, [groups, addingGroup, allowAdd]);
  const focusedIndex = model.entries.findIndex((entry) => entry.kind === 'task' && entry.taskKey === focusedKey);
  const addIndex = addingGroup ? model.entries.findIndex((entry) => entry.key === `add:${addingGroup}`) : -1;
  const virtualizer = useVirtualizer<HTMLElement, HTMLElement>({
    useFlushSync: false,
    count: model.entries.length,
    getScrollElement: () => scrollRef.current,
    getItemKey: (index) => model.entries[index]!.key,
    estimateSize: (index) => model.entries[index]!.size,
    overscan: 6,
    scrollMargin,
    initialRect: { width: 1000, height: 600 },
    observeElementRect: (instance, callback) => observeElementRect(instance, (rect) => callback({ ...rect, height: rect.height || 600 })),
    measureElement: (element) => {
      const entry = model.entries[Number(element.dataset.index)]!;
      const height = element.getBoundingClientRect().height;
      const inset = entry.kind === 'header' && entry.groupIndex > 0 && groups[entry.groupIndex]!.label ? 20 : 0;
      return height ? height + inset : entry.size;
    },
    rangeExtractor: (range) => {
      const active = document.activeElement;
      const activeIndex = active && anchorRef.current?.contains(active) ? Number(active.closest('[data-index]')?.getAttribute('data-index') ?? -1) : -1;
      const visible = [...new Set([...defaultRangeExtractor(range), focusedIndex, addIndex, activeIndex])].filter((index) => index >= 0 && index < model.entries.length);
      const indexes = new Set(visible);
      for (const index of visible) {
        const groupIndex = model.entries[index]!.groupIndex;
        indexes.add(model.starts[groupIndex]!);
        // A following boundary gives the native sticky section its full height.
        const next = model.starts[groupIndex + 1];
        if (next !== undefined) indexes.add(next);
      }
      return [...indexes].sort((a, b) => a - b);
    },
  });
  useLayoutEffect(() => {
    const scroll = scrollRef.current;
    const anchor = anchorRef.current;
    if (!scroll || !anchor) return;
    const measureMargin = () => setScrollMargin(anchor.getBoundingClientRect().top - scroll.getBoundingClientRect().top + scroll.scrollTop);
    measureMargin();
    // Project details/toolbars above the list can expand without changing the
    // scroll viewport. Observe their sizes as well as the viewport itself.
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measureMargin);
    observer.observe(scroll);
    for (const sibling of scroll.children) observer.observe(sibling);
    return () => observer.disconnect();
  }, [scrollRef, model]);
  useEffect(() => {
    if (focusedIndex >= 0) virtualizer.scrollToIndex(focusedIndex, { align: 'auto' });
  }, [focusedIndex, virtualizer]);
  useEffect(() => {
    if (addIndex >= 0) virtualizer.scrollToIndex(addIndex, { align: 'auto' });
  }, [addIndex, virtualizer]);

  const items = virtualizer.getVirtualItems();
  const byIndex = new Map(items.map((item) => [item.index, item]));
  const itemsByGroup = new Map<number, typeof items>();
  for (const item of items) {
    const groupIndex = model.entries[item.index]!.groupIndex;
    const groupItems = itemsByGroup.get(groupIndex) ?? [];
    groupItems.push(item);
    itemsByGroup.set(groupIndex, groupItems);
  }
  const sections = [...itemsByGroup].map(([groupIndex, groupItems]) => {
    const group = groups[groupIndex]!;
    const last = groupItems.at(-1)!;
    const hasBody = groupItems.some((item) => model.entries[item.index]!.kind !== 'header');
    const nextStart = model.starts[groupIndex + 1];
    const end = hasBody
      ? nextStart === undefined ? virtualizer.getTotalSize() + scrollMargin : byIndex.get(nextStart)?.start ?? last.end
      : last.end;
    return { group, groupIndex, items: groupItems, start: groupItems[0]!.start - scrollMargin, end: end - scrollMargin };
  });
  return { anchorRef, model, virtualizer, sections, scrollMargin };
}
