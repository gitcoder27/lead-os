import { useId, useState, type ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';

/**
 * docs/73 UXD-05: the one show/hide control — a quiet chevron button with
 * `aria-expanded`, replacing native `<details>` (whose ▶ marker and summary
 * styling differ per browser). The panel stays mounted while closed, like
 * `<details>`, so a half-filled form inside keeps its values.
 */
export function Disclosure({
  summary,
  children,
  open,
  defaultOpen = false,
  onOpenChange,
  className,
  panelClassName,
}: {
  summary: ReactNode;
  children: ReactNode;
  /** Controlled open state; omit for an uncontrolled disclosure. */
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
  panelClassName?: string;
}) {
  const [internal, setInternal] = useState(defaultOpen);
  const isOpen = open ?? internal;
  const panelId = useId();
  const toggle = () => {
    const next = !isOpen;
    if (open === undefined) setInternal(next);
    onOpenChange?.(next);
  };
  return (
    <div className={`ui-disclosure${className ? ` ${className}` : ''}`}>
      <button type="button" className="ui-disclosure-trigger" aria-expanded={isOpen} aria-controls={panelId} onClick={toggle}>
        <ChevronRight size={13} className="ui-disclosure-chevron" aria-hidden="true" />
        <span className="min-w-0">{summary}</span>
      </button>
      <div id={panelId} className={panelClassName} hidden={!isOpen}>
        {children}
      </div>
    </div>
  );
}
