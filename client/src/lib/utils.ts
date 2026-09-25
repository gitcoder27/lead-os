import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { addDays, format, formatDistanceToNowStrict, isToday, isBefore, parseISO, startOfDay } from 'date-fns';
import type { DeveloperWorkload } from '@/types';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatRelativeTime(dateStr: string): string {
  try {
    return formatDistanceToNowStrict(new Date(dateStr), { addSuffix: true });
  } catch {
    return dateStr;
  }
}

export function formatAbsoluteDateTime(dateStr?: string): string {
  if (!dateStr) return '—';
  try {
    const date = new Date(dateStr);
    if (Number.isNaN(date.getTime())) {
      return '—';
    }
    return format(date, 'MMM d, yyyy, h:mm a');
  } catch {
    return '—';
  }
}

export function getLocalIsoDate(date: Date = new Date()): string {
  return format(date, 'yyyy-MM-dd');
}

export function shiftLocalIsoDate(dateStr: string, days: number): string {
  return format(addDays(parseISO(dateStr), days), 'yyyy-MM-dd');
}

export function isDueToday(dateStr?: string): boolean {
  if (!dateStr) return false;
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) {
    return false;
  }
  return isToday(date);
}

export function isOverdue(dateStr?: string): boolean {
  if (!dateStr) return false;
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) {
    return false;
  }
  return isBefore(date, startOfDay(new Date()));
}

export function isStale(updatedAt: string, thresholdHours = 48): boolean {
  const dt = new Date(updatedAt);
  return dt.getTime() < Date.now() - thresholdHours * 60 * 60 * 1000;
}

export function formatDate(dateStr?: string): string {
  if (!dateStr) return '—';
  try {
    const d = new Date(dateStr);
    if (Number.isNaN(d.getTime())) {
      return '—';
    }
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch {
    return dateStr;
  }
}

export function priorityColor(priority: string): string {
  switch (priority) {
    case 'Highest': return 'var(--danger)';
    case 'High': return '#F97316';
    case 'Medium': return 'var(--warning)';
    case 'Low': return 'var(--accent)';
    case 'Lowest': return 'var(--text-muted)';
    default: return 'var(--text-secondary)';
  }
}

export function workloadColor(level: string): string {
  switch (level) {
    case 'light': return 'var(--success)';
    case 'medium': return 'var(--warning)';
    case 'heavy': return 'var(--danger)';
    default: return 'var(--text-muted)';
  }
}

export function workloadAssignedLabel(workload: Pick<DeveloperWorkload, 'assignedTodayCount' | 'activeDefects'>): string {
  return `${workload.assignedTodayCount ?? workload.activeDefects}`;
}

export function workloadAccent(workload: Pick<DeveloperWorkload, 'activeDefects' | 'blocked' | 'level' | 'trackerStatus' | 'isTrackerStale' | 'signals' | 'assignedTodayCount'>): string {
  if (workload.trackerStatus === 'blocked' || workload.blocked > 0) {
    return 'var(--danger)';
  }

  if (workload.signals?.backlogTrackerMismatch || workload.signals?.noCurrentItem || workload.isTrackerStale) {
    return 'var(--warning)';
  }

  if (workload.signals?.idle) {
    return 'var(--text-muted)';
  }

  return workloadColor(workload.level);
}
