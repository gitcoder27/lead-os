import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUp, Square } from 'lucide-react';
import { SuggestionChips } from '@/components/assistant/SuggestionChips';

interface AssistantComposerProps {
  disabled?: boolean;
  streaming: boolean;
  currentView: string;
  expanded?: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
}

const MAX_TEXTAREA_ROWS = 6;

/** Skip autofocus on touch-first devices so the virtual keyboard doesn't pop uninvited. */
const canAutofocus = () =>
  typeof window === 'undefined' || window.matchMedia?.('(pointer: coarse)')?.matches !== true;

export function AssistantComposer({ disabled, streaming, currentView, expanded, onSend, onStop }: AssistantComposerProps) {
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!disabled && canAutofocus()) {
      textareaRef.current?.focus();
    }
  }, [disabled, expanded]);

  const resize = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }
    textarea.style.height = 'auto';
    const lineHeight = parseFloat(window.getComputedStyle(textarea).lineHeight) || 20;
    const maxHeight = lineHeight * MAX_TEXTAREA_ROWS + 16;
    textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`;
    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? 'auto' : 'hidden';
  }, []);

  const send = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed || disabled || streaming) {
      return;
    }
    setValue('');
    requestAnimationFrame(resize);
    onSend(trimmed);
  }, [disabled, onSend, resize, streaming, value]);

  const showSuggestions = value === '/';

  return (
    <div className="shrink-0 border-t px-3 pb-2.5 pt-2" style={{ borderColor: 'var(--border)' }}>
      <div className={expanded ? 'mx-auto w-full max-w-[880px]' : undefined}>
      {showSuggestions ? (
        <div className="mb-2">
          <SuggestionChips
            currentView={currentView}
            onPick={(text) => {
              setValue('');
              requestAnimationFrame(resize);
              onSend(text);
            }}
          />
        </div>
      ) : null}
      <div
        className="flex items-end gap-1.5 rounded-xl px-2 py-1.5"
        style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border)' }}
      >
        <textarea
          ref={textareaRef}
          value={value}
          rows={1}
          disabled={disabled}
          placeholder="Ask about your team, work, or desk…"
          aria-label="Message Copilot"
          onChange={(event) => {
            setValue(event.target.value);
            resize();
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              send();
            }
          }}
          className="max-h-32 min-w-0 flex-1 resize-none bg-transparent px-1 py-1 text-[13px] leading-5 outline-none disabled:opacity-50"
          style={{ color: 'var(--text-primary)' }}
        />
        {streaming ? (
          <button
            type="button"
            onClick={onStop}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-colors"
            style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', color: 'var(--danger)' }}
            title="Stop generating"
            aria-label="Stop generating"
          >
            <Square size={12} />
          </button>
        ) : (
          <button
            type="button"
            onClick={send}
            disabled={disabled || !value.trim()}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-opacity disabled:opacity-40"
            style={{ background: 'var(--accent)', color: 'var(--bg-primary)' }}
            title="Send message"
            aria-label="Send message"
          >
            <ArrowUp size={14} />
          </button>
        )}
      </div>
      <p className="mt-1.5 text-[10.5px] leading-4" style={{ color: 'var(--text-muted)' }}>
        Copilot can make mistakes — review proposed actions before confirming.
      </p>
      </div>
    </div>
  );
}
