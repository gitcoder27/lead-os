import { useEffect, type RefObject } from 'react';
import { defaultRangeExtractor, observeElementRect, useVirtualizer } from '@tanstack/react-virtual';

/** Shared measured viewport window; retain active editors and keyboard focus. */
export function useVirtualRows<T extends HTMLElement>(
  scrollRef: RefObject<HTMLElement | null>,
  keys: readonly string[],
  estimate: number,
  retainedIndexes: number[] = [],
  paddingStart = 0,
) {
  const virtualizer = useVirtualizer<HTMLElement, T>({
    useFlushSync: false,
    count: keys.length,
    getScrollElement: () => scrollRef.current,
    getItemKey: (index) => keys[index]!,
    estimateSize: () => estimate,
    overscan: 6,
    paddingStart,
    scrollPaddingStart: paddingStart,
    initialRect: { width: 1000, height: 600 },
    // A hidden/detached pane has no layout yet; keep a small initial window
    // until ResizeObserver reports the real viewport (also useful in jsdom).
    observeElementRect: (instance, callback) => observeElementRect(instance, (rect) => callback({ ...rect, height: rect.height || 600 })),
    measureElement: (element) => element.getBoundingClientRect().height || estimate,
    rangeExtractor: (range) => {
      const active = document.activeElement;
      const activeIndex = active && scrollRef.current?.contains(active)
        ? Number(active.closest('[data-index]')?.getAttribute('data-index') ?? -1) : -1;
      return [...new Set([...defaultRangeExtractor(range), ...retainedIndexes, activeIndex])]
        .filter((index) => index >= 0 && index < keys.length).sort((a, b) => a - b);
    },
  });
  useEffect(() => { virtualizer.measure(); }, [estimate, paddingStart, virtualizer]);
  return virtualizer;
}
