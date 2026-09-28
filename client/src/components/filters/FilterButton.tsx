import type { ReactNode } from 'react';

interface FilterButtonProps {
  label: string;
  count: number;
  isActive: boolean;
  onClick: () => void;
  shortcut?: string;
  isIdle?: boolean;
  icon?: ReactNode;
}

export function FilterButton({ label, count, isActive, onClick, shortcut, isIdle, icon }: FilterButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={isActive}
      className="w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-[14px] text-[13px] font-medium transition-all duration-200 cursor-pointer group border"
      style={{
        background: isActive ? 'var(--bg-glow)' : 'transparent',
        color: isActive ? 'var(--accent)' : 'var(--text-secondary)',
        borderColor: isActive ? 'var(--border-active)' : 'transparent',
        boxShadow: isActive ? 'inset 0 0 0 1px var(--border-active)' : 'none',
      }}
    >
      <span className="flex items-center gap-2 min-w-0">
        {icon && (
          <span
            className="w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{
              background: isActive ? 'var(--accent-glow)' : 'var(--bg-tertiary)',
              color: isActive ? 'var(--accent)' : 'var(--text-muted)',
            }}
          >
            {icon}
          </span>
        )}
        <span className="truncate">
          {label}
        </span>
        {isIdle && (
          <span className="text-[12px] animate-glow-idle" style={{ color: 'var(--warning)' }}>
            ⚠
          </span>
        )}
      </span>
        <span className="flex items-center gap-1.5">
          <span
            className="text-[12px] font-mono tabular-nums min-w-[20px] text-center rounded-full px-1.5 py-0.5"
            style={{
              background: isActive ? 'var(--accent-glow)' : 'var(--bg-tertiary)',
              color: isActive ? 'var(--accent)' : 'var(--text-muted)',
            }}
        >
          {count}
        </span>
        {shortcut && (
          <span
            className="text-[12px] font-mono opacity-0 group-hover:opacity-100 transition-opacity"
            style={{ color: 'var(--text-muted)' }}
          >
            {shortcut}
          </span>
        )}
      </span>
    </button>
  );
}
