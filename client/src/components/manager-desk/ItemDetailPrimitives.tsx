import { useEffect, useId, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown } from 'lucide-react';

export const sectionSurfaceStyle = {
  background:
    'linear-gradient(180deg, color-mix(in srgb, var(--bg-elevated) 72%, transparent) 0%, color-mix(in srgb, var(--bg-secondary) 88%, transparent) 100%)',
  border: '1px solid var(--border)',
  boxShadow: 'var(--soft-shadow)',
} as const;

export function MetaChip({
  label,
  tone,
}: {
  label: string;
  tone: 'accent' | 'neutral' | 'success' | 'danger';
}) {
  const toneStyles = {
    accent: {
      background: 'var(--md-accent-dim)',
      color: 'var(--md-accent)',
      border: '1px solid color-mix(in srgb, var(--md-accent) 24%, transparent)',
    },
    neutral: {
      background: 'color-mix(in srgb, var(--bg-secondary) 92%, transparent)',
      color: 'var(--text-secondary)',
      border: '1px solid var(--border)',
    },
    success: {
      background: 'rgba(16,185,129,0.10)',
      color: 'var(--success)',
      border: '1px solid rgba(16,185,129,0.18)',
    },
    danger: {
      background: 'rgba(239,68,68,0.10)',
      color: 'var(--danger)',
      border: '1px solid rgba(239,68,68,0.18)',
    },
  } as const;

  return (
    <span
      className="rounded-md px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.08em]"
      style={toneStyles[tone]}
    >
      {label}
    </span>
  );
}

export function SectionCard({
  eyebrow,
  title,
  description,
  children,
  collapsed = false,
  onToggleCollapse,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children: ReactNode;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}) {
  return (
    <section className="rounded-xl p-3" style={sectionSurfaceStyle}>
      <button
        type="button"
        onClick={onToggleCollapse}
        className="flex w-full items-start justify-between gap-2 text-left"
        aria-expanded={!collapsed}
        aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${title}`}
      >
        <div className="min-w-0">
          <div className="text-[11px] font-bold uppercase tracking-[0.16em]" style={{ color: 'var(--text-muted)' }}>
            {eyebrow}
          </div>
          <div className="mt-0.5 text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>
            {title}
          </div>
          <p className="mt-0.5 text-[12px] leading-4" style={{ color: 'var(--text-secondary)' }}>
            {collapsed ? 'Tap to expand.' : description}
          </p>
        </div>
        <span
          className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg transition-all"
          style={{
            background: 'var(--bg-tertiary)',
            color: collapsed ? 'var(--md-accent)' : 'var(--text-secondary)',
            border: '1px solid var(--border)',
            transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
          }}
        >
          <ChevronDown size={13} />
        </span>
      </button>
      <AnimatePresence initial={false}>
        {!collapsed && (
          <motion.div
            key="section-body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="overflow-hidden"
          >
            <div className="mt-3">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

export function LinkActionButton({
  label,
  icon,
  onClick,
}: {
  label: string;
  icon: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] transition-all"
      style={{
        background: 'var(--bg-tertiary)',
        color: 'var(--text-secondary)',
        border: '1px solid var(--border)',
      }}
    >
      {icon}
      {label}
    </button>
  );
}

export function FieldSelect<T extends string>({
  label,
  value,
  options,
  onChange,
  emptyLabel,
}: {
  label: string;
  value: T | '';
  options: Array<{ value: T; label: string }>;
  onChange: (value: string) => void;
  emptyLabel?: string;
}) {
  const fieldId = useId();

  return (
    <div>
      <label
        htmlFor={fieldId}
        className="mb-0.5 block text-[11px] font-bold uppercase tracking-[0.14em]"
        style={{ color: 'var(--text-muted)' }}
      >
        {label}
      </label>
      <select
        id={fieldId}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full cursor-pointer rounded-lg px-2 py-1.5 text-[12px] font-medium outline-none"
        style={{
          background: 'var(--bg-tertiary)',
          color: 'var(--text-primary)',
          border: '1px solid var(--border)',
        }}
      >
        {emptyLabel ? <option value="">{emptyLabel}</option> : null}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function FieldText({
  label,
  value,
  placeholder,
  onChange,
  className,
}: {
  label: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  const fieldId = useId();
  const [local, setLocal] = useState(value);

  useEffect(() => {
    setLocal(value);
  }, [value]);

  return (
    <div className={className}>
      <label
        htmlFor={fieldId}
        className="mb-0.5 block text-[11px] font-bold uppercase tracking-[0.14em]"
        style={{ color: 'var(--text-muted)' }}
      >
        {label}
      </label>
      <input
        id={fieldId}
        type="text"
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={() => {
          if (local !== value) onChange(local);
        }}
        placeholder={placeholder}
        className="w-full rounded-lg px-2 py-1.5 text-[12px] outline-none"
        style={{
          background: 'var(--bg-tertiary)',
          color: 'var(--text-primary)',
          border: '1px solid var(--border)',
        }}
      />
    </div>
  );
}

export function FieldDatetime({
  label,
  value,
  onChange,
  className,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  const fieldId = useId();
  const localValue = value ? value.slice(0, 16) : '';

  return (
    <div className={className}>
      <label
        htmlFor={fieldId}
        className="mb-0.5 block text-[11px] font-bold uppercase tracking-[0.14em]"
        style={{ color: 'var(--text-muted)' }}
      >
        {label}
      </label>
      <input
        id={fieldId}
        type="datetime-local"
        value={localValue}
        onChange={(e) => {
          const nextValue = e.target.value;
          onChange(nextValue ? new Date(nextValue).toISOString() : '');
        }}
        className="w-full rounded-lg px-2 py-1.5 text-[12px] outline-none"
        style={{
          background: 'var(--bg-tertiary)',
          color: 'var(--text-primary)',
          border: '1px solid var(--border)',
        }}
      />
    </div>
  );
}
