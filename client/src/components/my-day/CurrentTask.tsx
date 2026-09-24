import { motion } from 'framer-motion';
import { Play, Zap } from 'lucide-react';
import type { TrackerWorkItem } from '@/types';
import { TrackerItemRow } from '@/components/team-tracker/TrackerItemRow';
import { TaskUpdateComposer } from '@/components/tasks/TaskUpdateComposer';

interface CurrentTaskProps {
  viewDate?: string;
  item?: TrackerWorkItem;
  onMarkDone?: (id: number) => void;
  onDrop?: (id: number) => void;
  onUpdateTitle?: (id: number, title: string) => void;
  hasPlannedItems?: boolean;
  readOnly?: boolean;
}

export function CurrentTask({
  viewDate,
  item,
  onMarkDone,
  onDrop,
  onUpdateTitle,
  hasPlannedItems,
  readOnly,
}: CurrentTaskProps) {
  if (!item) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="rounded-2xl p-5 text-center"
        style={{
          background: 'var(--bg-tertiary)',
          border: '1px dashed var(--border-strong)',
        }}
      >
        <div
          className="h-10 w-10 rounded-xl flex items-center justify-center mx-auto mb-3"
          style={{ background: 'var(--bg-elevated)', color: 'var(--text-muted)' }}
        >
          <Play size={18} />
        </div>
        <p className="text-[13px] font-medium" style={{ color: 'var(--text-secondary)' }}>
          No active task
        </p>
        <p className="text-[12px] mt-1" style={{ color: 'var(--text-muted)' }}>
          {hasPlannedItems
            ? 'Select a planned item below to start working'
            : 'Add a task to get started'}
        </p>
      </motion.div>
    );
  }

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="rounded-2xl p-4 relative overflow-hidden"
      style={{
        background: 'linear-gradient(135deg, rgba(6, 182, 212, 0.08) 0%, rgba(6, 182, 212, 0.02) 100%)',
        border: '1px solid color-mix(in srgb, var(--accent) 25%, transparent)',
        boxShadow: '0 0 30px rgba(6, 182, 212, 0.06)',
      }}
    >
      {/* Accent glow line at top */}
      <div
        className="absolute top-0 left-4 right-4 h-[2px] rounded-full"
        style={{
          background: 'linear-gradient(90deg, transparent, var(--accent), transparent)',
          opacity: 0.5,
        }}
      />

      <div className="flex items-start gap-3">
        <div
          className="h-9 w-9 rounded-xl flex items-center justify-center shrink-0 mt-0.5"
          style={{ background: 'var(--accent-glow)', color: 'var(--accent)' }}
        >
          <Zap size={16} />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span
              className="text-[11px] font-bold uppercase"
              style={{ color: 'var(--accent)', letterSpacing: '0.1em' }}
            >
              Working On
            </span>
          </div>
          <div className="mt-1 -ml-2">
            <TrackerItemRow
              item={item}
              viewDate={viewDate}
              onUpdateTitle={onUpdateTitle}
              onMarkDone={onMarkDone}
              onDrop={onDrop}
              readOnly={readOnly}
              composer={
                !readOnly && item.taskKey && viewDate ? (
                  <TaskUpdateComposer taskKey={item.taskKey} mode="developer" date={viewDate} collapsed />
                ) : undefined
              }
            />
          </div>
        </div>
      </div>
    </motion.div>
  );
}
