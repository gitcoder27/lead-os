import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Settings } from 'lucide-react';
import { CopilotMark } from '@/components/brand/CopilotMark';
import { useAssistant } from '@/context/AssistantContext';
import { useAssistantThread } from '@/hooks/useAssistant';
import { useAssistantConfig } from '@/hooks/useAssistantConfig';
import { AssistantHeader } from '@/components/assistant/AssistantHeader';
import { MessageList } from '@/components/assistant/MessageList';
import { AssistantComposer } from '@/components/assistant/AssistantComposer';

export function AssistantDock() {
  const { isOpen, close, currentView: contextView, onOpenTarget } = useAssistant();
  const currentView = contextView ?? window.location.pathname;
  const thread = useAssistantThread({ enabled: isOpen, currentView });
  const configQuery = useAssistantConfig({ enabled: isOpen });
  const config = configQuery.data;
  const reduceMotion = useReducedMotion();
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        if (expanded) {
          setExpanded(false);
        } else {
          close();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, expanded, close]);

  const configured = Boolean(config?.enabled && config?.hasApiKey);

  const panel = (
    <motion.aside
      key="assistant-panel"
      role="dialog"
      aria-label="LeadOS Copilot"
      layout
      initial={reduceMotion ? { opacity: 0 } : { x: 24, opacity: 0 }}
      animate={reduceMotion ? { opacity: 1 } : { x: 0, opacity: 1 }}
      exit={reduceMotion ? { opacity: 0 } : { x: 24, opacity: 0 }}
      transition={{ type: 'spring', stiffness: 380, damping: 34 }}
      className={
        expanded
          ? 'fixed inset-2 z-[350] flex flex-col overflow-hidden rounded-2xl sm:inset-4'
          : 'fixed inset-2 z-[350] flex flex-col overflow-hidden rounded-2xl sm:inset-auto sm:bottom-3 sm:right-3 sm:top-[calc(var(--app-header-height,64px)+10px)] sm:w-[400px] sm:max-w-[calc(100vw-24px)]'
      }
      style={{
        background: 'color-mix(in srgb, var(--bg-primary) 84%, transparent)',
        backdropFilter: 'blur(18px)',
        WebkitBackdropFilter: 'blur(18px)',
        border: '1px solid var(--border-strong)',
        boxShadow: '0 24px 64px rgba(0,0,0,0.45), 0 0 0 1px var(--accent-glow)',
      }}
    >
      <AssistantHeader
        conversations={thread.conversationsQuery.data?.conversations ?? []}
        currentConversationId={thread.conversationId}
        currentView={currentView}
        expanded={expanded}
        onToggleExpand={() => setExpanded((value) => !value)}
        onSelectConversation={(id) => void thread.loadConversation(id)}
        onDeleteConversation={thread.deleteConversation}
        onNewChat={thread.newChat}
        onClose={close}
      />

      {configQuery.isPending ? (
        <div className="flex flex-1 items-center justify-center p-6">
          <span className="text-[12.5px]" style={{ color: 'var(--text-muted)' }}>
            Loading…
          </span>
        </div>
      ) : configured ? (
        <>
          {thread.error ? (
            <div
              className="shrink-0 border-b px-3 py-1.5 text-[11.5px]"
              style={{ borderColor: 'var(--border)', color: 'var(--danger)' }}
              role="alert"
            >
              {thread.error}
            </div>
          ) : null}
          <MessageList
            messages={thread.messages}
            streaming={thread.streaming}
            proposals={thread.proposals}
            followups={thread.followups}
            confirmingId={thread.confirmingId}
            currentView={currentView}
            expanded={expanded}
            onDecision={(toolCallId, decision) => void thread.confirm(toolCallId, decision)}
            onPickSuggestion={(text) => void thread.send(text)}
            onRegenerate={thread.status === 'idle' ? () => void thread.regenerate() : undefined}
            onOpenTarget={(target) => {
              setExpanded(false);
              onOpenTarget?.(target);
            }}
          />
          <AssistantComposer
            disabled={thread.status === 'streaming'}
            streaming={thread.status === 'streaming'}
            currentView={currentView}
            expanded={expanded}
            onSend={(text) => void thread.send(text)}
            onStop={thread.stop}
          />
        </>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
          <span
            className="flex h-11 w-11 items-center justify-center rounded-2xl"
            style={{ background: 'var(--accent-glow)', color: 'var(--accent)' }}
          >
            <CopilotMark size={20} monochrome />
          </span>
          <div>
            <p className="text-[13.5px] font-semibold" style={{ color: 'var(--text-primary)' }}>
              Copilot isn&apos;t set up yet
            </p>
            <p className="mt-1 text-[12px] leading-5" style={{ color: 'var(--text-secondary)' }}>
              Add an API key and enable the assistant in Settings to start asking about your workspace.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              onOpenTarget?.({ type: 'view', view: 'settings', section: 'assistant' });
              close();
            }}
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-semibold"
            style={{ background: 'var(--accent)', color: 'var(--bg-primary)' }}
          >
            <Settings size={13} />
            Open Settings
          </button>
        </div>
      )}
    </motion.aside>
  );

  return createPortal(
    <AnimatePresence>
      {isOpen && expanded ? (
        <motion.div
          key="assistant-backdrop"
          data-testid="assistant-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduceMotion ? 0 : 0.18 }}
          className="fixed inset-0 z-[340]"
          style={{ background: 'rgba(5, 8, 12, 0.55)' }}
          onClick={() => setExpanded(false)}
          aria-hidden="true"
        />
      ) : null}
      {isOpen ? panel : null}
    </AnimatePresence>,
    document.body,
  );
}
