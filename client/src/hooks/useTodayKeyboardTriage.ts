import { useEffect, useMemo, useRef, useState } from 'react';
import { resolveTriageKey, shouldIgnoreTriageEvent } from '@/lib/today-triage';
import type { TodayActionCommand, TodayActionItem } from '@/types';

interface UseTodayKeyboardTriageOptions {
  /** Rows in display order. */
  items: TodayActionItem[];
  /** Off while a dialog/menu owns the keyboard. */
  enabled: boolean;
  onOpen: (item: TodayActionItem) => void;
  onRunCommand: (command: TodayActionCommand, preset?: 'tomorrow') => void;
  /** Returns false when there was nothing to undo. */
  onUndo: () => boolean;
}

/**
 * docs/53 U4: j/k/Enter/e/s/f/c/z on Today. The active row is tracked by id
 * so optimistic removals keep the cursor on the next row, not a stale index.
 */
export function useTodayKeyboardTriage({ items, enabled, onOpen, onRunCommand, onUndo }: UseTodayKeyboardTriageOptions) {
  const [activeId, setActiveId] = useState<string | undefined>();
  const lastIndex = useRef(0);

  const activeIndex = useMemo(() => {
    if (!activeId) return -1;
    return items.findIndex((item) => item.id === activeId);
  }, [activeId, items]);

  // When the active row disappears (done/snoozed), move to the row that took its place.
  useEffect(() => {
    if (activeIndex >= 0) {
      lastIndex.current = activeIndex;
      return;
    }
    if (activeId && items.length > 0) {
      setActiveId(items[Math.min(lastIndex.current, items.length - 1)]?.id);
    }
  }, [activeId, activeIndex, items]);

  const handlers = useRef({ items, onOpen, onRunCommand, onUndo, activeIndex });
  handlers.current = { items, onOpen, onRunCommand, onUndo, activeIndex };

  useEffect(() => {
    if (!enabled) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (shouldIgnoreTriageEvent(event)) return;
      const current = handlers.current;
      const item = current.activeIndex >= 0 ? current.items[current.activeIndex] : undefined;
      const intent = resolveTriageKey(event.key, item);
      if (!intent) return;
      if (intent.type === 'move') {
        if (current.items.length === 0) return;
        event.preventDefault();
        const from = current.activeIndex < 0 ? (intent.delta > 0 ? -1 : current.items.length) : current.activeIndex;
        const next = Math.min(Math.max(from + intent.delta, 0), current.items.length - 1);
        setActiveId(current.items[next]?.id);
        return;
      }
      if (intent.type === 'undo') {
        if (current.onUndo()) event.preventDefault();
        return;
      }
      if (!item) return;
      event.preventDefault();
      if (intent.type === 'open') {
        current.onOpen(item);
        return;
      }
      current.onRunCommand(intent.command, intent.preset);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enabled]);

  return { activeId: activeIndex >= 0 ? activeId : undefined, setActiveId };
}
