import { useLayoutEffect, useMemo, useRef } from 'react';
import type { StandupTask } from '@/lib/standup';

interface TaskSelectionSnapshot {
  scope: string;
  keys: string[];
  selectedKey?: string;
}

/** Keep the task identity through refreshes; when it leaves, continue with its next surviving neighbor. */
export function useStandupTaskSelection(
  scope: string,
  tasks: StandupTask[],
  selectedKey: string | undefined,
  onSelect: (key: string | undefined) => void,
) {
  const previous = useRef<TaskSelectionSnapshot>();
  const keys = useMemo(() => tasks.map((task) => task.taskKey), [tasks]);
  let resolvedKey = keys.includes(selectedKey ?? '') ? selectedKey : keys[0];
  const snapshot = previous.current;
  if (selectedKey && !keys.includes(selectedKey) && snapshot?.scope === scope && snapshot.selectedKey === selectedKey) {
    const index = snapshot.keys.indexOf(selectedKey);
    const neighbors = [...snapshot.keys.slice(index + 1), ...snapshot.keys.slice(0, index).reverse()];
    resolvedKey = neighbors.find((key) => keys.includes(key)) ?? keys[Math.min(index, keys.length - 1)];
  }

  useLayoutEffect(() => {
    previous.current = { scope, keys, selectedKey: resolvedKey };
    if (resolvedKey !== selectedKey) onSelect(resolvedKey);
  }, [scope, keys, resolvedKey, selectedKey, onSelect]);

  return Math.max(0, keys.indexOf(resolvedKey ?? ''));
}
