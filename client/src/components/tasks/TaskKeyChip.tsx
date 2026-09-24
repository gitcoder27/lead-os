import { useState } from 'react';
import { Check, Copy } from 'lucide-react';

interface TaskKeyChipProps {
  taskKey: string;
  className?: string;
}

export function TaskKeyChip({ taskKey, className }: TaskKeyChipProps) {
  const [copied, setCopied] = useState(false);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/t/${taskKey}`);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard can fail without a secure context or permission; the chip still shows the key.
    }
  };

  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        void copyLink();
      }}
      onKeyDown={(event) => event.stopPropagation()}
      className={`inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-[11px] font-bold tracking-wide transition-colors ${className ?? ''}`}
      style={{
        background: 'var(--bg-tertiary)',
        color: copied ? 'var(--success)' : 'var(--text-secondary)',
        border: '1px solid var(--border)',
      }}
      title={`Copy link to ${taskKey}`}
      aria-label={`Task ${taskKey} — copy link`}
    >
      {copied ? <Check size={10} /> : <Copy size={9} className="opacity-0 transition-opacity group-hover:opacity-60" />}
      {taskKey}
    </button>
  );
}
