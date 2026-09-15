import { useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Activity, AlertCircle, Check } from 'lucide-react';

export type ToolCallChipStatus = 'running' | 'ok' | 'failed' | 'muted';

interface ToolCallChipProps {
  name: string;
  label: string;
  status: ToolCallChipStatus;
  summary?: string;
}

export function ToolCallChip({ label, status, summary }: ToolCallChipProps) {
  const [expanded, setExpanded] = useState(false);
  const reduceMotion = useReducedMotion();

  const StatusIcon = status === 'ok' ? Check : status === 'failed' ? AlertCircle : Activity;
  const color =
    status === 'ok'
      ? 'var(--success)'
      : status === 'failed'
        ? 'var(--danger)'
        : status === 'muted'
          ? 'var(--text-muted)'
          : 'var(--accent)';

  return (
    <div>
      <button
        type="button"
        onClick={() => setExpanded((open) => !open)}
        title={summary}
        className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] transition-colors"
        style={{
          background: 'var(--bg-tertiary)',
          border: '1px solid var(--border)',
          color: 'var(--text-secondary)',
        }}
      >
        {status === 'running' && !reduceMotion ? (
          <motion.span
            animate={{ opacity: [0.55, 1, 0.55] }}
            transition={{ duration: 1.1, repeat: Infinity, ease: 'easeInOut' }}
            className="flex items-center"
            style={{ color }}
          >
            <StatusIcon size={11} />
          </motion.span>
        ) : (
          <span className="flex items-center" style={{ color }}>
            <StatusIcon size={11} />
          </span>
        )}
        <span>{label}</span>
      </button>
      {expanded && summary ? (
        <p className="mt-1 pl-1 text-[11px] leading-4" style={{ color: 'var(--text-muted)' }}>
          {summary}
        </p>
      ) : null}
    </div>
  );
}
