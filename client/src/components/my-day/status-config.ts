import { AlertTriangle, CheckCircle2, Pause, ShieldAlert, Zap } from 'lucide-react';
import type { TrackerDeveloperStatus } from '@/types';
import { DEV_STATUS_ORDER, STATUS_META } from '@/components/ui/DevStatus';

export interface StatusInfo {
  /** Shared sentence-case label (docs/54 V6) — the same word the manager sees. */
  label: string;
  /** Fits a fifth of a phone-width segmented control. */
  shortLabel: string;
  /** Longer hint for tooltips, e.g. "Done for today". */
  description: string;
  color: string;
  icon: typeof Zap;
  /** Composer placeholder while this status is set — asks the question a lead would ask. */
  prompt: string;
}

export const STATUS_ORDER: TrackerDeveloperStatus[] = DEV_STATUS_ORDER;

const MY_DAY_EXTRAS: Record<TrackerDeveloperStatus, Pick<StatusInfo, 'icon' | 'prompt' | 'description'>> = {
  on_track: { icon: Zap, description: 'On track', prompt: 'Quick update — what’s happening?' },
  at_risk: { icon: AlertTriangle, description: 'At risk', prompt: 'What’s putting it at risk?' },
  blocked: { icon: ShieldAlert, description: 'Blocked', prompt: 'What’s blocking you — and who can unblock it?' },
  waiting: { icon: Pause, description: 'Waiting', prompt: 'What are you waiting on?' },
  done_for_today: { icon: CheckCircle2, description: 'Done for today', prompt: 'Wrap up — what got done, what’s next tomorrow?' },
};

export function getStatusInfo(status: TrackerDeveloperStatus): StatusInfo {
  const key = STATUS_META[status] ? status : 'on_track';
  const meta = STATUS_META[key];
  return { label: meta.label, shortLabel: meta.label, color: meta.color, ...MY_DAY_EXTRAS[key] };
}
