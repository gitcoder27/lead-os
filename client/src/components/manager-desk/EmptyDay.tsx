import { motion } from 'framer-motion';
import { Inbox, Sparkles } from 'lucide-react';

import type { ManagerDeskViewMode } from '@/types/manager-desk';

interface Props {
  date: string;
  viewMode?: ManagerDeskViewMode;
}

export function EmptyDay({ date, viewMode = 'live' }: Props) {
  const title =
    viewMode === 'history' ? 'No historical items'
      : viewMode === 'planning' ? 'Nothing scheduled'
      : 'Clean slate';

  const body =
    viewMode === 'history'
      ? `No Manager Desk items were active by end of day on ${date}.`
      : viewMode === 'planning'
        ? `No Manager Desk work is scheduled for ${date}. Use a future date to plan follow-ups, meetings, or focused work.`
        : `No items for ${date}. Use quick capture to start, and open work will stay visible until you resolve it.`;

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.1 }}
      className="md-glass-panel rounded-xl px-4 py-6 flex flex-col items-center text-center"
    >
      <div
        className="w-10 h-10 rounded-xl flex items-center justify-center mb-3"
        style={{ background: 'var(--md-accent-glow)' }}
      >
        <Sparkles size={18} style={{ color: 'var(--md-accent)' }} />
      </div>

      <h3
        className="text-[13px] font-semibold mb-0.5"
        style={{ color: 'var(--text-primary)' }}
      >
        {title}
      </h3>
      <p className="text-[12px] max-w-xs" style={{ color: 'var(--text-secondary)' }}>
        {body}
      </p>

      <div className="flex items-center gap-1 mt-2 text-[11px] font-medium" style={{ color: 'var(--text-muted)' }}>
        <Inbox size={10} />
        Type in capture bar and press Enter
      </div>
    </motion.div>
  );
}
