import { useState } from 'react';
import { motion } from 'framer-motion';
import { Send, MessageSquare } from 'lucide-react';
import type { TrackerDeveloperStatus } from '@/types';
import { TaskPicker, taskKeysForSubmit, type TaskPickerTask } from '@/components/tasks/TaskPicker';

interface QuickUpdatesProps {
  onAddCheckIn: (summary: string, status?: TrackerDeveloperStatus, taskKeys?: string[]) => void;
  /** Tasks that can be tagged on the check-in (current + planned work). */
  tasks?: TaskPickerTask[];
  isPending?: boolean;
  disabled?: boolean;
}

export function QuickUpdates({ onAddCheckIn, tasks = [], isPending, disabled }: QuickUpdatesProps) {
  const [draft, setDraft] = useState('');
  const [taskKeys, setTaskKeys] = useState<string[]>([]);

  const handleSubmit = () => {
    const text = draft.trim();
    if (!text || disabled) return;
    onAddCheckIn(text, undefined, taskKeysForSubmit(taskKeys, text, tasks));
    setDraft('');
    setTaskKeys([]);
  };

  return (
    <div
      className="flex items-start gap-3 rounded-2xl p-4 shadow-sm"
      style={{
        background: 'var(--bg-primary)',
        border: '1px solid var(--border)',
      }}
    >
      <MessageSquare
        size={16}
        className="mt-2 shrink-0"
        style={{ color: 'var(--text-muted)' }}
      />
      <div className="flex-1 min-w-0">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSubmit();
            }
          }}
          placeholder="Quick update... what's happening?"
          aria-label="Quick update"
          disabled={disabled}
          rows={2}
          className="w-full text-[14px] outline-none resize-none bg-transparent"
          style={{
            color: 'var(--text-primary)',
          }}
        />
        {!disabled && tasks.length > 0 && (
          <div className="mb-2">
            <TaskPicker tasks={tasks} text={draft} selected={taskKeys} onChange={setTaskKeys} />
          </div>
        )}
        <div className="flex items-center justify-between mt-2 pt-2 border-t border-[var(--border)]">
          <span className="text-[12px] font-medium tracking-wide text-transparent bg-clip-text" style={{ backgroundImage: 'linear-gradient(to right, var(--text-muted), transparent)' }}>
            Press Enter to send
          </span>
          <motion.button
            whileTap={{ scale: 0.95 }}
            type="button"
            onClick={handleSubmit}
            disabled={!draft.trim() || isPending || disabled}
            className="flex items-center gap-2 rounded-xl px-4 py-1.5 text-[13px] font-bold transition-all disabled:opacity-40 tracking-wide uppercase"
            style={{
              background: draft.trim() ? 'var(--accent-glow)' : 'var(--bg-tertiary)',
              color: draft.trim() ? 'var(--accent)' : 'var(--text-muted)',
              border: `1px solid ${draft.trim() ? 'color-mix(in srgb, var(--accent) 30%, transparent)' : 'var(--border)'}`,
            }}
          >
            <Send size={12} />
            Send
          </motion.button>
        </div>
      </div>
    </div>
  );
}
