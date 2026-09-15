import { motion } from 'framer-motion';
import { RotateCcw } from 'lucide-react';
import type { AssistantMessage, AssistantToolCallRecord, TodayActionTarget } from '@/types';
import { renderMarkdownLite } from '@/components/assistant/markdown-lite';
import { ToolCallChip, type ToolCallChipStatus } from '@/components/assistant/ToolCallChip';

interface ChatMessageProps {
  message: AssistantMessage;
  canRegenerate?: boolean;
  onRegenerate?: () => void;
  onOpenTarget?: (target: TodayActionTarget) => void;
}

function recordToChip(record: AssistantToolCallRecord): {
  label: string;
  status: ToolCallChipStatus;
  summary?: string;
} {
  if (record.status === 'pending') {
    return { label: `${record.name} · awaiting confirmation`, status: 'muted', summary: record.summary };
  }
  if (record.status === 'cancelled') {
    return { label: `${record.name} · cancelled`, status: 'muted', summary: record.summary };
  }
  return {
    label: record.name,
    status: record.status === 'failed' ? 'failed' : 'ok',
    summary: record.resultSummary ?? record.summary,
  };
}

export function ChatMessage({ message, canRegenerate, onRegenerate, onOpenTarget }: ChatMessageProps) {
  if (message.role === 'user') {
    return (
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.18 }}
        className="flex justify-end"
      >
        <div
          className="max-w-[88%] rounded-2xl rounded-br-md px-3 py-2 text-[13px] leading-5 whitespace-pre-wrap"
          style={{
            background: 'var(--accent-glow)',
            border: '1px solid color-mix(in srgb, var(--accent) 35%, transparent)',
            color: 'var(--text-primary)',
          }}
        >
          {message.content}
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18 }}
      className="pr-4"
    >
      {message.toolCalls && message.toolCalls.length > 0 ? (
        <div className="mb-1.5 flex flex-wrap gap-1.5">
          {message.toolCalls.map((record) => {
            const chip = recordToChip(record);
            return (
              <ToolCallChip
                key={record.id}
                name={record.name}
                label={chip.label}
                status={chip.status}
                summary={chip.summary}
              />
            );
          })}
        </div>
      ) : null}
      <div style={{ color: 'var(--text-primary)' }}>
        {renderMarkdownLite(message.content, {
          onOpenIssue: (issueKey) => onOpenTarget?.({ type: 'issue', view: 'work', issueKey }),
        })}
      </div>
      {canRegenerate ? (
        <button
          type="button"
          onClick={onRegenerate}
          className="mt-1 flex items-center gap-1 rounded-md px-1 py-0.5 text-[11px] transition-colors hover:bg-[var(--bg-tertiary)]"
          style={{ color: 'var(--text-muted)' }}
          title="Regenerate response"
          aria-label="Regenerate response"
        >
          <RotateCcw size={11} />
          Regenerate
        </button>
      ) : null}
    </motion.div>
  );
}
