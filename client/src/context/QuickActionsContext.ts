import { createContext, useContext } from 'react';
import type { GlobalCaptureContext } from '@/components/capture/GlobalCaptureDialog';
import type { DailyNoteKind } from '@/types';

export interface QuickActionsValue {
  openCapture: (context?: GlobalCaptureContext) => void;
  openCommandPalette: () => void;
  openNotes?: (date?: string, kind?: DailyNoteKind) => void;
}

const QuickActionsContext = createContext<QuickActionsValue>({
  openCapture: () => {},
  openCommandPalette: () => {},
});

export function useQuickActions(): QuickActionsValue {
  return useContext(QuickActionsContext);
}

export const QuickActionsProvider = QuickActionsContext.Provider;
