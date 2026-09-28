import { useState, type ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown } from 'lucide-react';

interface Props {
  title: string;
  subtitle: string;
  count: number;
  accentVar: string;
  emptyMessage: string;
  defaultCollapsed?: boolean;
  children: ReactNode;
}

export function DeskSection({
  title,
  subtitle,
  count,
  accentVar,
  emptyMessage,
  defaultCollapsed = false,
  children,
}: Props) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  return (
    <div className="md-glass-panel rounded-xl overflow-hidden">
      {/* Section header — clickable to collapse */}
      <button
        onClick={() => setCollapsed(c => !c)}
        className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left transition-colors group"
      >
        <div
          className="w-0.5 h-3.5 rounded-full flex-shrink-0"
          style={{ background: accentVar }}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span
              className="text-[12px] font-semibold tracking-[-0.01em]"
              style={{ color: 'var(--text-primary)' }}
            >
              {title}
            </span>
            <span
              className="text-[11px] font-mono font-bold rounded px-1 py-0.5"
              style={{
                background: count > 0 ? `color-mix(in srgb, ${accentVar} 15%, transparent)` : 'var(--bg-tertiary)',
                color: count > 0 ? accentVar : 'var(--text-muted)',
              }}
            >
              {count}
            </span>
          </div>
        </div>
        <ChevronDown
          size={12}
          className="transition-transform duration-200 flex-shrink-0"
          style={{
            color: 'var(--text-muted)',
            transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
          }}
        />
      </button>

      {/* Section content */}
      <AnimatePresence initial={false}>
        {!collapsed && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.23, 1, 0.32, 1] }}
            className="overflow-hidden"
          >
            <div className="px-1.5 pb-1.5">
              {count === 0 ? (
                <div
                  className="rounded-lg px-3 py-3 text-center text-[12px]"
                  style={{ color: 'var(--text-muted)', background: 'var(--bg-tertiary)' }}
                >
                  {emptyMessage}
                </div>
              ) : (
                <div className="space-y-1">
                  {children}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
