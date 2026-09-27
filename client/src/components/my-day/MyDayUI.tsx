import type { CSSProperties, ReactNode } from 'react';
import { motion } from 'framer-motion';
import { FOCUS_RING, SectionHeader } from '@/components/tasks/TaskDetailPrimitives';

/**
 * My Day building blocks. The page follows the task-detail language —
 * sentence-case headers, quiet surfaces, ghost controls that surface on
 * intent — tuned for a developer who visits for ten seconds at a time.
 */

export const EASE_OUT = [0.16, 1, 0.3, 1] as const;

export const pageVariants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.05, delayChildren: 0.02 } },
};

export const sectionVariants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: EASE_OUT } },
};

/** The one card surface on the page: a hair lighter than the canvas, never boxed-in heavy. */
export const surfaceStyle: CSSProperties = {
  background: 'color-mix(in srgb, var(--bg-secondary) 78%, transparent)',
  border: '1px solid color-mix(in srgb, var(--border) 72%, transparent)',
};

export const HAIRLINE = 'color-mix(in srgb, var(--border) 60%, transparent)';

export function MyDaySection({
  id,
  icon,
  title,
  count,
  hint,
  action,
  children,
  className,
  readOnly,
}: {
  id: string;
  icon?: ReactNode;
  title: string;
  count?: ReactNode;
  hint?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  readOnly?: boolean;
}) {
  const headingId = `my-day-${id}-heading`;
  return (
    <motion.section
      id={`my-day-${id}`}
      variants={sectionVariants}
      aria-labelledby={headingId}
      aria-disabled={readOnly || undefined}
      className={`flex min-w-0 flex-col gap-2.5 ${className ?? ''}`}
    >
      <div className="px-1">
        <SectionHeader as="h2" id={headingId} icon={icon} title={title} count={count} hint={hint} action={action} />
      </div>
      {children}
    </motion.section>
  );
}

export function IconAction({
  label,
  title,
  onClick,
  children,
  tone,
  size = 'md',
  disabled,
  pressed,
  className,
}: {
  label: string;
  title?: string;
  onClick: () => void;
  children: ReactNode;
  tone?: string;
  size?: 'sm' | 'md';
  disabled?: boolean;
  pressed?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      disabled={disabled}
      aria-label={label}
      aria-pressed={pressed}
      title={title ?? label}
      className={`flex shrink-0 items-center justify-center rounded-lg transition-colors hover:bg-[var(--bg-tertiary)] disabled:opacity-40 ${
        size === 'sm' ? 'h-7 w-7' : 'h-8 w-8'
      } ${FOCUS_RING} ${className ?? ''}`}
      style={{ color: tone ?? 'var(--text-secondary)' }}
    >
      {children}
    </button>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd
      className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[5px] px-1 font-sans text-[10.5px] font-medium leading-none"
      style={{
        color: 'var(--text-muted)',
        background: 'color-mix(in srgb, var(--bg-tertiary) 70%, transparent)',
        border: `1px solid ${HAIRLINE}`,
      }}
    >
      {children}
    </kbd>
  );
}
