import { useEffect, useRef, useState } from 'react';
import { History, Maximize2, Minimize2, Plus, Trash2, X } from 'lucide-react';
import { CopilotMark } from '@/components/brand/CopilotMark';
import { viewingLabel } from '@/components/assistant/viewing-label';
import { formatRelativeTime } from '@/lib/utils';
import type { AssistantConversation } from '@/types';

interface AssistantHeaderProps {
  conversations: AssistantConversation[];
  currentConversationId: number | null;
  currentView: string;
  expanded: boolean;
  onToggleExpand: () => void;
  onSelectConversation: (id: number) => void;
  onDeleteConversation: (id: number) => void;
  onNewChat: () => void;
  onClose: () => void;
}

export function AssistantHeader({
  conversations,
  currentConversationId,
  currentView,
  expanded,
  onToggleExpand,
  onSelectConversation,
  onDeleteConversation,
  onNewChat,
  onClose,
}: AssistantHeaderProps) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const historyRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!historyOpen) {
      return undefined;
    }
    const onPointerDown = (event: MouseEvent) => {
      if (!historyRef.current?.contains(event.target as Node)) {
        setHistoryOpen(false);
      }
    };
    window.addEventListener('mousedown', onPointerDown);
    return () => window.removeEventListener('mousedown', onPointerDown);
  }, [historyOpen]);

  const iconButtonClass =
    'flex h-7 w-7 items-center justify-center rounded-lg transition-colors';
  const iconButtonStyle = {
    background: 'var(--bg-tertiary)',
    border: '1px solid var(--border)',
    color: 'var(--text-secondary)',
  } as const;

  return (
    <div
      className="flex shrink-0 items-center justify-between gap-2 border-b px-3 py-2"
      style={{ borderColor: 'var(--border)' }}
    >
      <div className="flex min-w-0 items-center gap-2">
        <span
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
          style={{ background: 'var(--accent-glow)', color: 'var(--accent)' }}
        >
          <CopilotMark size={18} />
        </span>
        <div className="min-w-0">
          <p className="text-[13px] font-semibold leading-tight" style={{ color: 'var(--text-primary)' }}>
            Copilot
          </p>
          <p
            className="truncate text-[10.5px] leading-tight"
            style={{ color: 'var(--text-muted)' }}
            title="What Copilot sees — this screen and its active filters go with each message"
          >
            viewing: {viewingLabel(currentView, window.location.search)}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <div className="relative" ref={historyRef}>
          <button
            type="button"
            onClick={() => setHistoryOpen((open) => !open)}
            className={iconButtonClass}
            style={iconButtonStyle}
            title="Conversation history"
            aria-label="Conversation history"
            aria-expanded={historyOpen}
          >
            <History size={13} />
          </button>
          {historyOpen ? (
            <div
              className="absolute right-0 top-8 z-10 w-64 overflow-hidden rounded-xl"
              style={{
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border-strong)',
                boxShadow: 'var(--soft-shadow)',
              }}
            >
              <div className="max-h-64 overflow-y-auto">
                {conversations.length === 0 ? (
                  <p className="px-3 py-2.5 text-[11.5px]" style={{ color: 'var(--text-muted)' }}>
                    No conversations yet
                  </p>
                ) : (
                  conversations.map((conversation) => (
                    <div
                      key={conversation.id}
                      className="group flex items-center gap-1 px-2 py-1.5"
                      style={{
                        background:
                          conversation.id === currentConversationId
                            ? 'color-mix(in srgb, var(--accent) 10%, transparent)'
                            : 'transparent',
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          onSelectConversation(conversation.id);
                          setHistoryOpen(false);
                        }}
                        className="min-w-0 flex-1 text-left"
                      >
                        <p className="truncate text-[12px] font-medium" style={{ color: 'var(--text-primary)' }}>
                          {conversation.title}
                        </p>
                        <p className="text-[10.5px]" style={{ color: 'var(--text-muted)' }}>
                          {formatRelativeTime(conversation.updatedAt)}
                        </p>
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeleteConversation(conversation.id)}
                        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md opacity-0 transition-opacity group-hover:opacity-100"
                        style={{ color: 'var(--text-muted)' }}
                        title="Delete conversation"
                        aria-label={`Delete conversation ${conversation.title}`}
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onNewChat}
          className={iconButtonClass}
          style={iconButtonStyle}
          title="New chat"
          aria-label="New chat"
        >
          <Plus size={13} />
        </button>
        <button
          type="button"
          onClick={onToggleExpand}
          className={iconButtonClass}
          style={iconButtonStyle}
          title={expanded ? 'Restore dock size' : 'Expand Copilot'}
          aria-label={expanded ? 'Restore dock size' : 'Expand Copilot'}
          aria-pressed={expanded}
        >
          {expanded ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
        </button>
        <button
          type="button"
          onClick={onClose}
          className={iconButtonClass}
          style={iconButtonStyle}
          title="Close Copilot"
          aria-label="Close Copilot"
        >
          <X size={13} />
        </button>
      </div>
    </div>
  );
}
