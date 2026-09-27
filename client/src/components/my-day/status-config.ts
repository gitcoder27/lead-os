import { AlertTriangle, CheckCircle2, Pause, ShieldAlert, Zap } from 'lucide-react';
import type { TrackerDeveloperStatus } from '@/types';

export interface StatusInfo {
  label: string;
  /** Fits a fifth of a phone-width segmented control. */
  shortLabel: string;
  color: string;
  bg: string;
  icon: typeof Zap;
  /** Composer placeholder while this status is set — asks the question a lead would ask. */
  prompt: string;
}

export const STATUS_ORDER: TrackerDeveloperStatus[] = ['on_track', 'at_risk', 'blocked', 'waiting', 'done_for_today'];

const statusConfig: Record<TrackerDeveloperStatus, StatusInfo> = {
  on_track: {
    label: 'On track',
    shortLabel: 'On track',
    color: 'var(--success)',
    bg: 'rgba(16, 185, 129, 0.12)',
    icon: Zap,
    prompt: 'Quick update — what’s happening?',
  },
  at_risk: {
    label: 'At risk',
    shortLabel: 'At risk',
    color: 'var(--warning)',
    bg: 'rgba(245, 158, 11, 0.12)',
    icon: AlertTriangle,
    prompt: 'What’s putting it at risk?',
  },
  blocked: {
    label: 'Blocked',
    shortLabel: 'Blocked',
    color: 'var(--danger)',
    bg: 'rgba(239, 68, 68, 0.12)',
    icon: ShieldAlert,
    prompt: 'What’s blocking you — and who can unblock it?',
  },
  waiting: {
    label: 'Waiting',
    shortLabel: 'Waiting',
    color: 'var(--info)',
    bg: 'rgba(139, 92, 246, 0.12)',
    icon: Pause,
    prompt: 'What are you waiting on?',
  },
  done_for_today: {
    label: 'Done for today',
    shortLabel: 'Done',
    color: 'var(--accent)',
    bg: 'rgba(6, 182, 212, 0.12)',
    icon: CheckCircle2,
    prompt: 'Wrap up — what got done, what’s next tomorrow?',
  },
};

export function getStatusInfo(status: TrackerDeveloperStatus): StatusInfo {
  return statusConfig[status] ?? statusConfig.on_track;
}
