import { useEffect, useMemo, useRef, useState } from 'react';
import { Briefcase, NotebookPen, Users, Zap } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { getLocalIsoDate } from '@/lib/utils';
import { useScopedStorageKey } from '@/lib/scoped-storage';
import { useTasksPhase3 } from '@/hooks/useTasksPhase3';
import { DeskCaptureForm } from './DeskCaptureForm';
import { NoteCaptureForm } from './NoteCaptureForm';
import { TrackerCaptureForm } from './TrackerCaptureForm';
import { CaptureBox } from './CaptureBox';
import { Dialog } from '@/components/ui/Dialog';

export type CaptureTarget = 'manager-desk' | 'team-tracker' | 'notes';

const STORAGE_KEY = 'dcc-capture-target';

export interface GlobalCaptureContext {
  defaultTarget?: CaptureTarget;
  issue?: {
    jiraKey: string;
    summary?: string;
  };
  developer?: {
    accountId: string;
    displayName?: string;
  };
}

const TARGETS: { id: CaptureTarget; label: string; Icon: typeof Briefcase }[] = [
  { id: 'manager-desk', label: 'Desk', Icon: Briefcase },
  { id: 'team-tracker', label: 'Team', Icon: Users },
  { id: 'notes', label: 'Notes', Icon: NotebookPen },
];

function loadTarget(storageKey: string): CaptureTarget {
  try {
    const v = localStorage.getItem(storageKey);
    if (v === 'team-tracker' || v === 'notes') return v;
  } catch {
    /* ignore */
  }
  return 'manager-desk';
}

interface GlobalCaptureDialogProps {
  onClose: () => void;
  onOpenManagerDesk?: () => void;
  onOpenTeamTracker?: () => void;
  onOpenNotes?: (date?: string) => void;
  context?: GlobalCaptureContext;
}

export function GlobalCaptureDialog({
  onClose,
  onOpenManagerDesk,
  onOpenTeamTracker,
  onOpenNotes,
  context,
}: GlobalCaptureDialogProps) {
  const storageKey = useScopedStorageKey(STORAGE_KEY);
  const [target, setTarget] = useState<CaptureTarget>(() => context?.defaultTarget ?? loadTarget(storageKey));
  const storageKeyRef = useRef(storageKey);
  const date = useMemo(() => getLocalIsoDate(), []);
  const formattedDate = useMemo(() => format(parseISO(date), 'EEEE, MMM d'), [date]);
  // Phase 3 (P3-D8, §4.3): one CaptureBox replaces the per-target forms.
  const phase3 = useTasksPhase3();
  const phase3Prefill = useMemo(() => {
    if (!phase3) return '';
    if (context?.defaultTarget === 'notes') return '/note ';
    const parts: string[] = [];
    if (context?.developer?.accountId) parts.push(`@${context.developer.accountId}`);
    if (context?.issue?.jiraKey) parts.push(`#${context.issue.jiraKey}`);
    return parts.length ? `${parts.join(' ')} ` : '';
  }, [phase3, context]);

  // docs/54 §1.7: Phase 3 capture lands in Tasks (cyan); amber is legacy Desk only.
  const isDesk = !phase3 && target === 'manager-desk';
  const isTracker = phase3 || target === 'team-tracker';

  useEffect(() => {
    if (storageKeyRef.current !== storageKey) {
      storageKeyRef.current = storageKey;
      setTarget(context?.defaultTarget ?? loadTarget(storageKey));
      return;
    }

    try {
      localStorage.setItem(storageKey, target);
    } catch {
      /* ignore */
    }
  }, [context?.defaultTarget, storageKey, target]);

  useEffect(() => {
    if (context?.defaultTarget) {
      setTarget(context.defaultTarget);
    }
  }, [context?.defaultTarget]);


  // docs/54 V1/§1.7: Capture uses the app's one dialog shell. Under Phase 3
  // it is one box that lands in Tasks (cyan); the legacy target switcher is
  // the shared segmented control.
  return (
    <Dialog
      title="Capture"
      subtitle={formattedDate}
      icon={<Zap size={14} strokeWidth={2.2} />}
      ariaLabel="Quick capture"
      closeLabel="Close capture"
      flush
      onClose={onClose}
      headerExtra={
        phase3 ? undefined : (
          <div className="ui-segment ui-segment-fill" role="group" aria-label="Capture to">
            {TARGETS.map((t) => (
              <button key={t.id} type="button" aria-pressed={target === t.id} onClick={() => setTarget(t.id)}>
                <t.Icon size={13} aria-hidden="true" />
                <span>{t.label}</span>
              </button>
            ))}
          </div>
        )
      }
    >
      {phase3 ? (
        <CaptureBox prefill={phase3Prefill} onClose={onClose} />
      ) : isDesk ? (
        <DeskCaptureForm
          key="desk"
          date={date}
          formattedDate={formattedDate}
          onClose={onClose}
          onOpenManagerDesk={onOpenManagerDesk}
          context={context}
        />
      ) : isTracker ? (
        <TrackerCaptureForm
          key="tracker"
          date={date}
          formattedDate={formattedDate}
          onClose={onClose}
          onOpenTeamTracker={onOpenTeamTracker}
          context={context}
        />
      ) : (
        <NoteCaptureForm
          key={`${storageKey}:notes`}
          date={date}
          formattedDate={formattedDate}
          onClose={onClose}
          onOpenNotes={onOpenNotes}
        />
      )}
    </Dialog>
  );
}
