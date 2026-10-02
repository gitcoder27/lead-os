import { useEffect, useRef, useState, type CSSProperties } from 'react';

/** A date is a draft until Enter or blur; Escape cancels, and Enter followed by blur writes once. */
export function IssueDateEditor({
  currentValue,
  onSave,
  onClose,
  className,
  style,
  label = 'Due date',
}: {
  currentValue?: string;
  onSave: (value: string | null) => void;
  onClose: () => void;
  className?: string;
  style?: CSSProperties;
  label?: string;
}) {
  const [draft, setDraft] = useState(currentValue ?? '');
  const input = useRef<HTMLInputElement>(null);
  const finished = useRef(false);
  useEffect(() => {
    input.current?.focus();
  }, []);
  const commit = () => {
    if (finished.current || !input.current?.validity.valid) return;
    finished.current = true;
    if (draft !== (currentValue ?? '')) onSave(draft || null);
    onClose();
  };
  return (
    <input
      ref={input}
      type="date"
      aria-label={label}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          finished.current = true;
          onClose();
        } else if (event.key === 'Enter') {
          event.preventDefault();
          event.stopPropagation();
          commit();
        }
      }}
      className={className}
      style={style}
    />
  );
}
