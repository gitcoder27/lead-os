import { useEffect, useRef } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import type {
  AssistantActionDecision,
  AssistantActionProposal,
  AssistantMessage,
  TodayActionTarget,
} from '@/types';
import type { AssistantStreamingTurn } from '@/hooks/useAssistant';
import { ChatMessage } from '@/components/assistant/ChatMessage';
import { renderMarkdownLite } from '@/components/assistant/markdown-lite';
import { ToolCallChip } from '@/components/assistant/ToolCallChip';
import { ActionConfirmCard } from '@/components/assistant/ActionConfirmCard';
import { SuggestionChips } from '@/components/assistant/SuggestionChips';

interface MessageListProps {
  messages: AssistantMessage[];
  streaming: AssistantStreamingTurn | null;
  proposals: AssistantActionProposal[];
  followups: string[];
  confirmingId: string | null;
  currentView: string;
  expanded?: boolean;
  onDecision: (toolCallId: string, decision: AssistantActionDecision) => void;
  onPickSuggestion: (text: string) => void;
  onRegenerate?: () => void;
  onOpenTarget?: (target: TodayActionTarget) => void;
}

export function MessageList({
  messages,
  streaming,
  proposals,
  followups,
  confirmingId,
  currentView,
  expanded,
  onDecision,
  onPickSuggestion,
  onRegenerate,
  onOpenTarget,
}: MessageListProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const reduceMotion = useReducedMotion();
  const isEmpty = messages.length === 0 && !streaming;
  const lastAssistantId = [...messages].reverse().find((m) => m.role === 'assistant')?.id;

  useEffect(() => {
    const container = scrollRef.current;
    if (container) {
      container.scrollTop = container.scrollHeight;
    }
  }, [messages.length, streaming?.content, streaming?.reasoning, streaming?.tools.length, proposals.length]);

  return (
    <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
      <div className={expanded ? 'mx-auto w-full max-w-[880px] space-y-3' : 'space-y-3'}>
      {isEmpty ? (
        <div className="space-y-3 pt-6">
          <p className="text-[13px] leading-5" style={{ color: 'var(--text-secondary)' }}>
            Ask about your team, work, or desk — or let Copilot propose an action for you to confirm.
          </p>
          <SuggestionChips currentView={currentView} onPick={onPickSuggestion} />
        </div>
      ) : null}

      {messages.map((message) => (
        <ChatMessage
          key={message.id}
          message={message}
          canRegenerate={!streaming && message.id === lastAssistantId && Boolean(onRegenerate)}
          onRegenerate={onRegenerate}
          onOpenTarget={onOpenTarget}
        />
      ))}

      {streaming ? (
        <div className="pr-4">
          {streaming.reasoning && !streaming.content ? (
            <motion.p
              aria-live="polite"
              animate={reduceMotion ? undefined : { opacity: [0.45, 1, 0.45] }}
              transition={reduceMotion ? undefined : { duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
              className="mb-1.5 flex items-center gap-1.5 text-[12px] italic"
              style={{ color: 'var(--text-muted)' }}
            >
              Thinking…
            </motion.p>
          ) : null}
          {streaming.tools.length > 0 ? (
            <div className="mb-1.5 flex flex-wrap gap-1.5">
              {streaming.tools.map((tool) => (
                <ToolCallChip
                  key={tool.toolCallId}
                  name={tool.name}
                  label={tool.label}
                  status={tool.status}
                  summary={tool.summary}
                />
              ))}
            </div>
          ) : null}
          {streaming.content ? (
            <div style={{ color: 'var(--text-primary)' }}>
              {renderMarkdownLite(streaming.content)}
              <motion.span
                aria-hidden="true"
                animate={reduceMotion ? undefined : { opacity: [1, 0.15, 1] }}
                transition={reduceMotion ? undefined : { duration: 0.9, repeat: Infinity, ease: 'easeInOut' }}
                style={{ color: 'var(--accent)' }}
              >
                ▍
              </motion.span>
            </div>
          ) : streaming.tools.length === 0 ? (
            <motion.span
              aria-hidden="true"
              animate={reduceMotion ? undefined : { opacity: [1, 0.15, 1] }}
              transition={reduceMotion ? undefined : { duration: 0.9, repeat: Infinity, ease: 'easeInOut' }}
              style={{ color: 'var(--accent)' }}
            >
              ▍
            </motion.span>
          ) : null}
        </div>
      ) : null}

      {proposals.map((proposal) => (
        <ActionConfirmCard
          key={proposal.toolCallId}
          proposal={proposal}
          busy={confirmingId === proposal.toolCallId}
          onDecision={(decision) => onDecision(proposal.toolCallId, decision)}
        />
      ))}

      {!streaming && followups.length > 0 ? (
        <SuggestionChips currentView={currentView} items={followups} onPick={onPickSuggestion} />
      ) : null}
      </div>
    </div>
  );
}
