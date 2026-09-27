import { createContext, useContext } from 'react';

export interface MyDayTaskDetailActions {
  /** Open the shared task drawer on this key. */
  openTask: (taskKey: string) => void;
  /** Warm the drawer's data (row hover/focus) so opening feels instant. */
  prefetchTask: (taskKey: string) => void;
}

const noop = () => undefined;

export const MyDayTaskDetailContext = createContext<MyDayTaskDetailActions>({ openTask: noop, prefetchTask: noop });

/** Rows reach the page's task drawer without threading props through every list. */
export function useMyDayTaskDetail(): MyDayTaskDetailActions {
  return useContext(MyDayTaskDetailContext);
}
