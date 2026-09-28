import { useCallback, useEffect, useRef, useState } from 'react';

interface TriageNotesTodayProps {
  value: string;
  dateLabel: string;
  onChange: (value: string) => void;
  onBlur: () => void;
  readOnly?: boolean;
}

export function TriageNotesToday({ value, dateLabel, onChange, onBlur, readOnly = false }: TriageNotesTodayProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [isFocused, setIsFocused] = useState(false);
  // Local draft prevents the serialize→trim→re-render cycle from stripping
  // trailing newlines while the user is actively typing (e.g. after pressing Enter).
  const [localValue, setLocalValue] = useState(value);
  const isFocusedRef = useRef(false);

  // Sync from parent only when unfocused so we never overwrite in-progress edits.
  useEffect(() => {
    if (!isFocusedRef.current) {
      setLocalValue(value);
    }
  }, [value]);

  const autoResize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(Math.max(el.scrollHeight, 56), 200)}px`;
  }, []);

  useEffect(() => { autoResize(); }, [autoResize, localValue]);

  return (
    <div
      className="rounded-[10px] border px-3 py-2.5 transition-colors"
      style={{
        borderColor: isFocused
          ? 'var(--border-active)'
          : 'color-mix(in srgb, var(--border-active) 50%, var(--border) 50%)',
        background: 'linear-gradient(180deg, color-mix(in srgb, var(--bg-tertiary) 92%, rgba(8, 145, 178, 0.08) 8%), color-mix(in srgb, var(--bg-secondary) 90%, transparent))',
        boxShadow: 'inset 0 1px 0 rgba(14, 165, 233, 0.06)',
      }}
    >
      <div className="mb-1.5 flex items-center gap-2">
        <span
          className="inline-block shrink-0 rounded-full"
          style={{ width: 6, height: 6, background: 'var(--accent)', boxShadow: '0 0 6px var(--accent-glow)' }}
        />
        <span className="text-[12px] font-medium" style={{ color: 'var(--text-secondary)' }}>
          {dateLabel}
        </span>
        <span
          className="rounded-full px-1.5 py-px text-[11px] font-semibold uppercase tracking-[0.1em]"
          style={{ color: 'var(--accent)', background: 'var(--accent-glow)' }}
        >
          Today
        </span>
      </div>
      <textarea
        ref={textareaRef}
        value={localValue}
        aria-label="Notes for today"
        onChange={(e) => {
          if (readOnly) return;
          setLocalValue(e.target.value);
          onChange(e.target.value);
        }}
        onFocus={() => { isFocusedRef.current = true; setIsFocused(true); }}
        onBlur={() => { isFocusedRef.current = false; setIsFocused(false); onBlur(); }}
        readOnly={readOnly}
        placeholder="Add today's analysis, findings, or handoff…"
        className="w-full resize-none bg-transparent px-0 py-0 text-[12.5px] leading-[1.7] focus:outline-none read-only:cursor-default"
        style={{ color: 'var(--text-primary)', minHeight: 56, maxHeight: 200, fontFamily: "'Geist Variable', sans-serif" }}
      />
    </div>
  );
}
