import { useCallback, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthScopeKey } from '@/context/AuthContext';
import { api } from '@/lib/api';
import { streamAssistantEvents } from '@/lib/assistant-stream';
import { getLocalIsoDate } from '@/lib/utils';
import type {
  AssistantActionDecision,
  AssistantActionProposal,
  AssistantChatRequest,
  AssistantConversationDetail,
  AssistantConversationsResponse,
  AssistantMessage,
  AssistantPageContext,
  AssistantStreamEvent,
  AssistantToolCallStatus,
} from '@/types';

export interface LiveToolCall {
  toolCallId: string;
  name: string;
  label: string;
  status: 'running' | 'ok' | 'failed';
  summary?: string;
}

export interface AssistantStreamingTurn {
  content: string;
  /** Accumulated reasoning-model output, shown as a "Thinking…" state. */
  reasoning: string;
  tools: LiveToolCall[];
}

export type AssistantThreadStatus = 'idle' | 'streaming' | 'awaiting_confirmation';

export interface UseAssistantThreadOptions {
  /** Gates the conversations query — pass false while the dock is closed. */
  enabled?: boolean;
  /** Current SPA path for request context; falls back to window.location. */
  currentView?: string;
}

const JIRA_MUTATING_TOOLS = new Set(['add_issue_comment', 'update_issue_fields']);

/** URL params the app writes itself (view-params.ts) — safe to send as prompt context. */
const PAGE_PARAM_ALLOWLIST = new Set([
  'filter',
  'dev',
  'tag',
  'noTags',
  'q',
  'sort',
  'group',
  'view',
  'date',
]);

function collectPageContext(view: string): AssistantPageContext {
  const params: Record<string, string> = {};
  const search = new URLSearchParams(window.location.search);
  for (const key of PAGE_PARAM_ALLOWLIST) {
    const value = search.get(key);
    if (value) {
      params[key] = value;
    }
  }
  return { view, ...(Object.keys(params).length > 0 ? { params } : {}) };
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function patchToolCallStatus(
  messages: AssistantMessage[],
  toolCallId: string,
  status: AssistantToolCallStatus,
): AssistantMessage[] {
  return messages.map((message) => {
    if (!message.toolCalls?.some((record) => record.id === toolCallId)) {
      return message;
    }
    return {
      ...message,
      toolCalls: message.toolCalls.map((record) =>
        record.id === toolCallId ? { ...record, status } : record,
      ),
    };
  });
}

export function useAssistantThread(options?: UseAssistantThreadOptions) {
  const queryClient = useQueryClient();
  const authScopeKey = useAuthScopeKey();
  const [conversationId, setConversationId] = useState<number | null>(null);
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [streaming, setStreaming] = useState<AssistantStreamingTurn | null>(null);
  const [proposals, setProposals] = useState<AssistantActionProposal[]>([]);
  const [followups, setFollowups] = useState<string[]>([]);
  const [status, setStatus] = useState<AssistantThreadStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  // Live-session reasoning traces keyed by assistant message id — never persisted.
  const [reasoningTraces, setReasoningTraces] = useState<Record<number, string>>({});
  const abortRef = useRef<AbortController | null>(null);
  const tempIdRef = useRef(0);
  // Mirrors the turn's accumulated reasoning — `handle` can't read `streaming`
  // state (stable callback), so the trace is captured here for `message` events.
  const reasoningRef = useRef('');
  // Stream handlers are captured once per send() call; the ref keeps "proposals
  // remaining" checks current without re-subscribing mid-stream.
  const proposalsRef = useRef<AssistantActionProposal[]>([]);

  const applyProposals = useCallback(
    (updater: (prev: AssistantActionProposal[]) => AssistantActionProposal[]) => {
      setProposals((prev) => {
        const next = updater(prev);
        proposalsRef.current = next;
        return next;
      });
    },
    [],
  );

  const handle = useCallback(
    (event: AssistantStreamEvent) => {
      switch (event.type) {
        case 'delta':
          setStreaming((prev) => ({
            content: (prev?.content ?? '') + event.content,
            reasoning: prev?.reasoning ?? '',
            tools: prev?.tools ?? [],
          }));
          break;
        case 'reasoning_delta':
          reasoningRef.current += event.content;
          setStreaming((prev) => ({
            content: prev?.content ?? '',
            reasoning: (prev?.reasoning ?? '') + event.content,
            tools: prev?.tools ?? [],
          }));
          break;
        case 'tool_start':
          setStreaming((prev) => ({
            content: prev?.content ?? '',
            reasoning: prev?.reasoning ?? '',
            tools: [
              ...(prev?.tools ?? []),
              { toolCallId: event.toolCallId, name: event.name, label: event.label, status: 'running' as const },
            ],
          }));
          break;
        case 'tool_end':
          setStreaming((prev) =>
            prev
              ? {
                  ...prev,
                  tools: prev.tools.map((tool) =>
                    tool.toolCallId === event.toolCallId
                      ? { ...tool, status: event.ok ? ('ok' as const) : ('failed' as const), summary: event.summary }
                      : tool,
                  ),
                }
              : prev,
          );
          break;
        case 'action_proposal':
          setConversationId(event.proposal.conversationId);
          applyProposals((prev) =>
            prev.some((p) => p.toolCallId === event.proposal.toolCallId) ? prev : [...prev, event.proposal],
          );
          break;
        case 'message':
          setConversationId(event.message.conversationId);
          if (event.message.role === 'assistant') {
            setMessages((prev) =>
              prev.some((m) => m.id === event.message.id) ? prev : [...prev, event.message],
            );
            // Pin this turn's reasoning to the message so it stays re-readable
            // (collapsed) after streaming ends. In-memory only.
            if (reasoningRef.current) {
              setReasoningTraces((prev) => ({ ...prev, [event.message.id]: reasoningRef.current }));
            }
            // The persisted row carries the tool-call chips for this turn.
            setStreaming({ content: '', reasoning: '', tools: [] });
          }
          break;
        case 'action_executed':
          setConversationId(event.conversationId);
          for (const key of event.invalidate) {
            void queryClient.invalidateQueries({ queryKey: [key] });
          }
          applyProposals((prev) => prev.filter((p) => p.toolCallId !== event.toolCallId));
          setMessages((prev) =>
            patchToolCallStatus(prev, event.toolCallId, event.ok ? 'confirmed' : 'failed'),
          );
          break;
        case 'followups':
          setFollowups(event.items);
          break;
        case 'done':
          setConversationId(event.conversationId);
          setStreaming(null);
          setStatus(event.status === 'awaiting_confirmation' ? 'awaiting_confirmation' : 'idle');
          void queryClient.invalidateQueries({ queryKey: ['assistant', 'conversations'] });
          break;
        case 'error':
          setError(event.error);
          setStreaming(null);
          setStatus(proposalsRef.current.length > 0 ? 'awaiting_confirmation' : 'idle');
          break;
      }
    },
    [applyProposals, queryClient],
  );

  const failStream = useCallback((err: unknown) => {
    if (isAbortError(err)) {
      return;
    }
    setError(err instanceof Error ? err.message : 'Copilot request failed');
    setStreaming(null);
    setStatus(proposalsRef.current.length > 0 ? 'awaiting_confirmation' : 'idle');
  }, []);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) {
        return;
      }
      tempIdRef.current -= 1;
      const optimistic: AssistantMessage = {
        id: tempIdRef.current,
        conversationId: conversationId ?? 0,
        role: 'user',
        content: trimmed,
        createdAt: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, optimistic]);
      reasoningRef.current = '';
      setStreaming({ content: '', reasoning: '', tools: [] });
      setStatus('streaming');
      setError(null);
      setFollowups([]);
      const controller = new AbortController();
      abortRef.current = controller;
      const view = options?.currentView ?? window.location.pathname;
      const body: AssistantChatRequest = {
        ...(conversationId ? { conversationId } : {}),
        message: trimmed,
        currentView: view,
        pageContext: collectPageContext(view),
        date: getLocalIsoDate(),
      };
      try {
        await streamAssistantEvents('/assistant/chat', body, handle, controller.signal);
      } catch (err) {
        failStream(err);
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null;
        }
      }
    },
    [conversationId, failStream, handle, options?.currentView],
  );

  const confirm = useCallback(
    async (toolCallId: string, decision: AssistantActionDecision) => {
      if (!conversationId || confirmingId) {
        return;
      }
      setConfirmingId(toolCallId);
      setStatus('streaming');
      reasoningRef.current = '';
      setStreaming({ content: '', reasoning: '', tools: [] });
      setError(null);
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        await streamAssistantEvents(
          '/assistant/actions/confirm',
          { conversationId, toolCallId, decision, date: getLocalIsoDate() },
          handle,
          controller.signal,
        );
        applyProposals((prev) => prev.filter((p) => p.toolCallId !== toolCallId));
        if (decision === 'cancel') {
          setMessages((prev) => patchToolCallStatus(prev, toolCallId, 'cancelled'));
        }
      } catch (err) {
        failStream(err);
      } finally {
        setConfirmingId(null);
        if (abortRef.current === controller) {
          abortRef.current = null;
        }
      }
    },
    [applyProposals, confirmingId, conversationId, failStream, handle],
  );

  const regenerate = useCallback(async () => {
    if (!conversationId || status === 'streaming') {
      return;
    }
    const lastUserIndex = messages.map((m) => m.role).lastIndexOf('user');
    if (lastUserIndex === -1) {
      return;
    }
    // Drop the previous answer locally; the server discards it too.
    setMessages((prev) => {
      const dropped = prev.slice(lastUserIndex + 1);
      if (dropped.length > 0) {
        setReasoningTraces((traces) => {
          const next = { ...traces };
          for (const message of dropped) {
            delete next[message.id];
          }
          return next;
        });
      }
      return prev.slice(0, lastUserIndex + 1);
    });
    applyProposals(() => []);
    reasoningRef.current = '';
    setStreaming({ content: '', reasoning: '', tools: [] });
    setStatus('streaming');
    setError(null);
    setFollowups([]);
    const controller = new AbortController();
    abortRef.current = controller;
    const view = options?.currentView ?? window.location.pathname;
    const body: AssistantChatRequest = {
      conversationId,
      retry: true,
      currentView: view,
      pageContext: collectPageContext(view),
      date: getLocalIsoDate(),
    };
    try {
      await streamAssistantEvents('/assistant/chat', body, handle, controller.signal);
    } catch (err) {
      failStream(err);
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
    }
  }, [applyProposals, conversationId, failStream, handle, messages, options?.currentView, status]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setStreaming(null);
    setStatus(proposalsRef.current.length > 0 ? 'awaiting_confirmation' : 'idle');
  }, []);

  const newChat = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setConversationId(null);
    setMessages([]);
    reasoningRef.current = '';
    setReasoningTraces({});
    setStreaming(null);
    applyProposals(() => []);
    setFollowups([]);
    setStatus('idle');
    setError(null);
    setConfirmingId(null);
  }, [applyProposals]);

  const loadConversation = useCallback(
    async (id: number) => {
      const detail = await api.get<AssistantConversationDetail>(`/assistant/conversations/${id}`);
      abortRef.current?.abort();
      abortRef.current = null;
      const visible = detail.messages.filter((message) => message.role !== 'tool');
      setConversationId(detail.conversation.id);
      setMessages(visible);
      reasoningRef.current = '';
      setReasoningTraces({});
      setStreaming(null);
      setError(null);
      setFollowups([]);
      const lastAssistant = [...visible].reverse().find((message) => message.role === 'assistant');
      const pending = (lastAssistant?.toolCalls ?? []).filter((record) => record.status === 'pending');
      const derived: AssistantActionProposal[] = pending.map((record) => ({
        conversationId: detail.conversation.id,
        toolCallId: record.id,
        tool: record.name,
        summary: record.summary,
        preview: record.arguments,
        jiraMutating: JIRA_MUTATING_TOOLS.has(record.name),
        status: record.status,
      }));
      applyProposals(() => derived);
      setStatus(derived.length > 0 ? 'awaiting_confirmation' : 'idle');
    },
    [applyProposals],
  );

  const conversationsQuery = useQuery<AssistantConversationsResponse>({
    queryKey: ['assistant', 'conversations', authScopeKey],
    queryFn: () => api.get('/assistant/conversations'),
    enabled: options?.enabled ?? true,
  });

  const deleteConversationMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/assistant/conversations/${id}`),
    onSuccess: (_res, id) => {
      void queryClient.invalidateQueries({ queryKey: ['assistant', 'conversations'] });
      if (id === conversationId) {
        newChat();
      }
    },
  });

  const deleteConversation = useCallback(
    (id: number) => {
      deleteConversationMutation.mutate(id);
    },
    [deleteConversationMutation],
  );

  return {
    conversationId,
    messages,
    reasoningTraces,
    streaming,
    proposals,
    followups,
    status,
    error,
    confirmingId,
    send,
    confirm,
    regenerate,
    stop,
    newChat,
    loadConversation,
    conversationsQuery,
    deleteConversation,
  };
}
