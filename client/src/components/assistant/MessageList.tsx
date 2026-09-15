import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Brain, ChevronDown } from 'lucide-react';
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

/**
 * Expandable live reasoning trace. Open while the model thinks; auto-collapses
 * once the answer starts unless the user toggled it manually. Trace is
 * stream-only — nothing is persisted.
 */
function ThinkingBlock({
  reasoning,
  active,
  initialOpen = true,
}: {
  reasoning: string;
  active: boolean;
  initialOpen?: boolean;
}) {
  const [open, setOpen] = useState(initialOpen);
  const userToggled = useRef(false);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    if (!active && !userToggled.current) {
      setOpen(false);
    }
  }, [active]);

  // Pin the inner scroll to the newest reasoning while it streams.
  useEffect(() => {
    const el = bodyRef.current;
    if (el && open) {
      el.scrollTop = el.scrollHeight;
    }
  }, [reasoning, open]);

  return (
    <div
      className="mb-1.5 overflow-hidden rounded-lg"
      style={{
        border: '1px solid var(--border)',
        background: 'color-mix(in srgb, var(--bg-tertiary) 55%, transparent)',
      }}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-label={open ? 'Hide thinking trace' : 'Show thinking trace'}
        onClick={() => {
          userToggled.current = true;
          setOpen((prev) => !prev);
        }}
        className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left"
      >
        <Brain size={12} style={{ color: active ? 'var(--accent)' : 'var(--text-muted)' }} />
        <span className="text-[11.5px] font-medium" style={{ color: 'var(--text-muted)' }}>
          {active ? 'Thinking…' : 'Thought process'}
        </span>
        {active ? (
          <motion.span
            aria-hidden="true"
            animate={reduceMotion ? undefined : { opacity: [0.3, 1, 0.3] }}
            transition={reduceMotion ? undefined : { duration: 1.2, repeat: Infinity, ease: 'easeInOut' }}
            className="block h-1 w-1 rounded-full"
            style={{ background: 'var(--accent)' }}
          />
        ) : null}
        <motion.span
          aria-hidden="true"
          animate={{ rotate: open ? 180 : 0 }}
          transition={{ duration: 0.18 }}
          className="ml-auto flex items-center"
          style={{ color: 'var(--text-muted)' }}
        >
          <ChevronDown size={12} />
        </motion.span>
      </button>
      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            key="thinking-body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={reduceMotion ? { duration: 0 } : { duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden"
          >
            <div
              ref={bodyRef}
              className="max-h-44 overflow-y-auto whitespace-pre-wrap px-2.5 pb-2.5 text-[12px] leading-5"
              style={{ color: 'var(--text-muted)' }}
            >
              {reasoning}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

interface MessageListProps {
  messages: AssistantMessage[];
  /** Live-session reasoning traces keyed by message id — rendered collapsed. */
  reasoningTraces?: Record<number, string>;
  streaming: AssistantStreamingTurn | null;
  proposals: AssistantActionProposal[];
  followups: string[];
  confirmingId: string | null;
  currentView: string;
  /** Context-aware starter chips for the empty state; falls back to per-view defaults. */
  emptySuggestions?: string[];
  expanded?: boolean;
  onDecision: (toolCallId: string, decision: AssistantActionDecision) => void;
  onPickSuggestion: (text: string) => void;
  onRegenerate?: () => void;
  onOpenTarget?: (target: TodayActionTarget) => void;
}

export function MessageList({
  messages,
  reasoningTraces,
  streaming,
  proposals,
  followups,
  confirmingId,
  currentView,
  emptySuggestions,
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
          <SuggestionChips currentView={currentView} items={emptySuggestions} onPick={onPickSuggestion} />
        </div>
      ) : null}

      {messages.map((message) => (
        <div key={message.id}>
          {reasoningTraces?.[message.id] ? (
            <ThinkingBlock reasoning={reasoningTraces[message.id]!} active={false} initialOpen={false} />
          ) : null}
          <ChatMessage
            message={message}
            canRegenerate={!streaming && message.id === lastAssistantId && Boolean(onRegenerate)}
            onRegenerate={onRegenerate}
            onOpenTarget={onOpenTarget}
          />
        </div>
      ))}

      {streaming ? (
        <div className="pr-4">
          {streaming.reasoning ? (
            <ThinkingBlock reasoning={streaming.reasoning} active={!streaming.content} />
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
