import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { TodayActionTarget } from '@/types';

export interface AssistantContextValue {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
  /** Current SPA path — stays fresh on route changes, unlike window.location reads at render time. */
  currentView?: string;
  onOpenTarget?: (target: TodayActionTarget) => void;
}

const AssistantContext = createContext<AssistantContextValue>({
  isOpen: false,
  open: () => {},
  close: () => {},
  toggle: () => {},
});

interface AssistantProviderProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  currentView?: string;
  onOpenTarget?: (target: TodayActionTarget) => void;
  children: ReactNode;
}

export function AssistantProvider({ isOpen, onOpenChange, currentView, onOpenTarget, children }: AssistantProviderProps) {
  const value = useMemo<AssistantContextValue>(
    () => ({
      isOpen,
      open: () => onOpenChange(true),
      close: () => onOpenChange(false),
      toggle: () => onOpenChange(!isOpen),
      currentView,
      onOpenTarget,
    }),
    [isOpen, onOpenChange, currentView, onOpenTarget],
  );

  return <AssistantContext.Provider value={value}>{children}</AssistantContext.Provider>;
}

export function useAssistant(): AssistantContextValue {
  return useContext(AssistantContext);
}
