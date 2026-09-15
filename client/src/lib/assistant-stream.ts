import { ApiRequestError } from '@/lib/api';
import type {
  ApiErrorResponse,
  AssistantActionConfirmRequest,
  AssistantChatRequest,
  AssistantStreamEvent,
} from '@/types';

export type AssistantStreamPath = '/assistant/chat' | '/assistant/actions/confirm';

/**
 * The only place NDJSON is parsed: POSTs the request body and invokes `onEvent`
 * for each newline-delimited `AssistantStreamEvent` the server writes.
 * Non-2xx responses are the standard `{ error, status }` JSON envelope.
 */
export async function streamAssistantEvents(
  path: AssistantStreamPath,
  body: AssistantChatRequest | AssistantActionConfirmRequest,
  onEvent: (event: AssistantStreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(`/api${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    const parsed = (await res
      .json()
      .catch(() => ({ error: res.statusText, status: res.status }))) as ApiErrorResponse;
    throw new ApiRequestError(parsed.error || `Request failed: ${res.status}`, parsed.status || res.status, parsed);
  }

  if (!res.body) {
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const flushLine = (line: string) => {
    const trimmed = line.trim();
    if (trimmed) {
      onEvent(JSON.parse(trimmed) as AssistantStreamEvent);
    }
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      let newline = buffer.indexOf('\n');
      while (newline !== -1) {
        flushLine(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf('\n');
      }
    }
    buffer += decoder.decode();
    flushLine(buffer);
  } finally {
    reader.releaseLock();
  }
}
