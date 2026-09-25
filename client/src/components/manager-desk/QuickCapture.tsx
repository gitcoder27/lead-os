import { useState, useCallback, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { Plus, Zap, Tag } from 'lucide-react';
import type { ManagerDeskItemKind, ManagerDeskCategory } from '@/types/manager-desk';
import { KIND_LABELS, CATEGORY_LABELS } from '@/types/manager-desk';
import { useTasksPhase3 } from '@/hooks/useTasksPhase3';

interface Props {
  onCapture: (title: string, kind?: ManagerDeskItemKind, category?: ManagerDeskCategory) => void;
  isPending: boolean;
  disabled?: boolean;
  disabledLabel?: string;
}

const kindOptions: ManagerDeskItemKind[] = ['action', 'meeting', 'decision'];
const categoryOptions: ManagerDeskCategory[] = [
  'analysis', 'design', 'team_management', 'cross_team',
  'follow_up', 'escalation', 'admin', 'planning', 'other',
];

export function QuickCapture({ onCapture, isPending, disabled = false, disabledLabel = 'Capture is unavailable for this view.' }: Props) {
  // Phase 3 (P3-D13): kind/category pickers retire; labels are the taxonomy.
  const phase3 = useTasksPhase3();
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<ManagerDeskItemKind | ''>('');
  const [category, setCategory] = useState<ManagerDeskCategory | ''>('');
  const [expanded, setExpanded] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const shouldRestoreFocusRef = useRef(false);

  useEffect(() => {
    if (!shouldRestoreFocusRef.current || title) return;
    inputRef.current?.focus();
    shouldRestoreFocusRef.current = false;
  }, [title]);

  const handleSubmit = useCallback(() => {
    if (isPending || disabled) return;
    const trimmed = title.trim();
    if (!trimmed) return;
    shouldRestoreFocusRef.current = true;
    onCapture(trimmed, phase3 ? undefined : kind || undefined, phase3 ? undefined : category || undefined);
    setTitle('');
    setKind('');
    setCategory('');
    setExpanded(false);
  }, [title, kind, category, onCapture, isPending, disabled, phase3]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
      if (e.key === 'Escape') {
        setExpanded(false);
        setTitle('');
      }
    },
    [handleSubmit],
  );

  return (
    <div
      className="overflow-hidden rounded-lg border transition-all"
      style={{
        background: 'color-mix(in srgb, var(--bg-secondary) 54%, transparent)',
        borderColor: expanded || isFocused ? 'color-mix(in srgb, var(--md-accent) 42%, transparent)' : 'color-mix(in srgb, var(--border) 72%, transparent)',
        boxShadow: expanded || isFocused
          ? 'inset 0 1px 0 rgba(255,255,255,0.035), 0 8px 22px rgba(0,0,0,0.10)'
          : undefined,
      }}
    >
      <div className="flex items-center gap-1.5 px-2 py-1">
        <div
          className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded"
          style={{ background: 'var(--md-accent-glow)', color: 'var(--md-accent)' }}
        >
          <Plus size={11} />
        </div>

        <input
          id="manager-desk-quick-capture-title"
          ref={inputRef}
          type="text"
          value={title}
          onChange={e => {
            setTitle(e.target.value);
            if (e.target.value && !expanded) setExpanded(true);
          }}
          onFocus={() => {
            if (disabled) return;
            setIsFocused(true);
            if (title) setExpanded(true);
          }}
          onBlur={() => setIsFocused(false)}
          onKeyDown={handleKeyDown}
          placeholder="Quick capture..."
          aria-label="Quick capture title"
          className="flex-1 bg-transparent outline-none text-[12px] font-medium placeholder:font-normal"
          style={{
            color: 'var(--text-primary)',
            caretColor: 'var(--md-accent)',
          }}
          aria-busy={isPending}
          disabled={disabled}
          maxLength={200}
        />

        <button
          onClick={handleSubmit}
          disabled={!title.trim() || isPending || disabled}
          className="h-5 rounded px-2 text-[10px] font-bold uppercase tracking-wide transition-all disabled:opacity-30"
          style={{
            background: 'var(--md-accent)',
            color: '#000',
          }}
        >
          {isPending ? '…' : 'Add'}
        </button>
      </div>

      {/* Expanded options row — kind/category pickers retire under Phase 3 */}
      {expanded && !disabled && !phase3 && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          className="border-t px-2 py-1 flex items-center gap-2"
          style={{ borderColor: 'var(--border)' }}
        >
          <div className="flex items-center gap-1">
            <Zap size={9} style={{ color: 'var(--text-muted)' }} />
            <select
              aria-label="Quick capture kind"
              value={kind}
              onChange={e => setKind(e.target.value as ManagerDeskItemKind | '')}
              className="bg-transparent text-[11px] font-medium outline-none cursor-pointer"
              style={{ color: kind ? 'var(--text-primary)' : 'var(--text-muted)' }}
            >
              <option value="">Kind…</option>
              {kindOptions.map(k => (
                <option key={k} value={k}>{KIND_LABELS[k]}</option>
              ))}
            </select>
          </div>

          <div className="w-px h-3" style={{ background: 'var(--border)' }} />

          <div className="flex items-center gap-1">
            <Tag size={9} style={{ color: 'var(--text-muted)' }} />
            <select
              aria-label="Quick capture category"
              value={category}
              onChange={e => setCategory(e.target.value as ManagerDeskCategory | '')}
              className="bg-transparent text-[11px] font-medium outline-none cursor-pointer"
              style={{ color: category ? 'var(--text-primary)' : 'var(--text-muted)' }}
            >
              <option value="">Category…</option>
              {categoryOptions.map(c => (
                <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
              ))}
            </select>
          </div>

          <span className="ml-auto" aria-hidden="true" />
        </motion.div>
      )}

      {disabled && (
        <div
          className="border-t px-2 py-1 text-[11px]"
          style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}
        >
          {disabledLabel}
        </div>
      )}
    </div>
  );
}
