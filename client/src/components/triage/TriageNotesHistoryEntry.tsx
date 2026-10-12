import { useCallback, useEffect, useRef } from 'react';
import { ChevronRight } from 'lucide-react';

interface TriageNotesHistoryEntryProps {
  value: string;
  dateLabel: string;
  ariaLabel: string;
  isExpanded: boolean;
  onToggle: () => void;
  onChange: (value: string) => void;
  onBlur: () => void;
  readOnly?: boolean;
}

export function TriageNotesHistoryEntry({
  value,
  dateLabel,
  ariaLabel,
  isExpanded,
  onToggle,
  onChange,
  onBlur,
  readOnly = false,
}: TriageNotesHistoryEntryProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Local draft so trailing newlines survive the serialize→trim cycle while editing.
  const localValueRef = useRef(value);
  const isFocusedRef = useRef(false);
  const preview = value.split('\n').filter((l) => l.trim()).slice(0, 1).join(' ') || 'Empty entry';

  // Keep local ref in sync when not focused (i.e. when a different issue loads).
  if (!isFocusedRef.current) {
    localValueRef.current = value;
  }

  const autoResize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(Math.max(el.scrollHeight, 48), 180)}px`;
  }, []);

  useEffect(() => {
    if (isExpanded) autoResize();
  }, [autoResize, isExpanded, value]);

  return (
    <div className="py-0.5">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-start gap-2 py-1 text-left cursor-pointer"
        aria-expanded={isExpanded}
      >
        <span
          className="mt-[5px] shrink-0 rounded-full transition-colors duration-150"
          style={{ width: 4, height: 4, background: isExpanded ? 'var(--accent)' : 'var(--text-muted)' }}
        />
        <span className="flex-1 min-w-0">
          <span className="text-ui font-medium" style={{ color: 'var(--text-secondary)' }}>
            {dateLabel}
          </span>
          {!isExpanded && (
            <span
              className="block text-ui leading-snug truncate mt-0.5"
              style={{ color: 'var(--text-muted)' }}
            >
              {preview}
            </span>
          )}
        </span>
        <ChevronRight
          size={11}
          className="mt-[3px] shrink-0 transition-transform duration-150"
          style={{ color: 'var(--text-muted)', transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)' }}
        />
      </button>
      {isExpanded && (
        <div
          className="ml-3 mb-1 rounded-lg border px-2.5 py-2"
          style={{
            background: 'color-mix(in srgb, var(--bg-tertiary) 50%, transparent)',
            borderColor: 'var(--border)',
          }}
        >
          <textarea
            ref={textareaRef}
            defaultValue={value}
            aria-label={ariaLabel}
            onChange={(e) => {
              if (readOnly) return;
              localValueRef.current = e.target.value;
              onChange(e.target.value);
              autoResize();
            }}
            onFocus={() => { isFocusedRef.current = true; }}
            onBlur={() => { isFocusedRef.current = false; onBlur(); }}
            readOnly={readOnly}
            placeholder="Notes for this day…"
            className="w-full resize-none bg-transparent px-0 py-0 text-body leading-[1.65] focus:outline-hidden read-only:cursor-default"
            style={{ color: 'var(--text-primary)', minHeight: 48, maxHeight: 180, fontFamily: "'Geist Variable', sans-serif" }}
          />
        </div>
      )}
    </div>
  );
}
