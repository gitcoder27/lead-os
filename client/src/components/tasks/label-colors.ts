import type { CSSProperties } from 'react';
import { TASK_LABEL_COLORS, type TaskLabelColor } from '@/types';

/** Chip styling per label color (P3-D13). `slate` is the default neutral. */
export const TASK_LABEL_CHIP_STYLES: Record<TaskLabelColor, CSSProperties> = {
  slate: { background: 'var(--bg-tertiary)', color: 'var(--text-secondary)', border: '1px solid var(--border)' },
  red: { background: 'rgba(239,68,68,0.12)', color: 'var(--danger)', border: '1px solid rgba(239,68,68,0.22)' },
  amber: { background: 'rgba(245,158,11,0.12)', color: 'var(--warning)', border: '1px solid rgba(245,158,11,0.22)' },
  green: { background: 'rgba(16,185,129,0.12)', color: 'var(--success)', border: '1px solid rgba(16,185,129,0.22)' },
  teal: { background: 'rgba(6,182,212,0.12)', color: 'var(--accent)', border: '1px solid rgba(6,182,212,0.22)' },
  blue: { background: 'rgba(59,130,246,0.14)', color: 'var(--info)', border: '1px solid rgba(59,130,246,0.24)' },
  violet: { background: 'rgba(139,92,246,0.12)', color: '#a78bfa', border: '1px solid rgba(139,92,246,0.24)' },
  pink: { background: 'rgba(236,72,153,0.12)', color: '#f472b6', border: '1px solid rgba(236,72,153,0.24)' },
};

export function labelChipStyle(color: string | undefined): CSSProperties {
  return TASK_LABEL_CHIP_STYLES[(color ?? 'slate') as TaskLabelColor] ?? TASK_LABEL_CHIP_STYLES.slate;
}

export const TASK_LABEL_COLOR_NAMES = TASK_LABEL_COLORS;
