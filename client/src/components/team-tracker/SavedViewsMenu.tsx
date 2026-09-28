import { useState, useRef, useEffect, useCallback } from 'react';
import { Bookmark, Check, ChevronDown, Plus, X, Loader2 } from 'lucide-react';
import { SavedViewItem } from './SavedViewItem';

export interface SavedViewOption {
  id: number;
  name: string;
  description?: string;
}

export interface SavedViewsMenuProps<TView extends SavedViewOption = SavedViewOption> {
  views: TView[];
  describe?: (view: TView) => string | undefined;
  activeViewId: number | undefined;
  isDirty: boolean;
  isViewsLoading: boolean;
  onApplyView: (view: TView) => void;
  onClearView: () => void;
  onSaveNew: (name: string) => void;
  onUpdateView: (viewId: number, name: string) => void;
  onDeleteView: (viewId: number) => void;
  isSaving: boolean;
}

export function SavedViewsMenu<TView extends SavedViewOption>({
  views,
  describe,
  activeViewId,
  isDirty,
  isViewsLoading,
  onApplyView,
  onClearView,
  onSaveNew,
  onUpdateView,
  onDeleteView,
  isSaving,
}: SavedViewsMenuProps<TView>) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'list' | 'create' | 'rename'>('list');
  const [editName, setEditName] = useState('');
  const [editViewId, setEditViewId] = useState<number | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        resetMode();
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  useEffect(() => {
    if ((mode === 'create' || mode === 'rename') && inputRef.current) {
      inputRef.current.focus();
    }
  }, [mode]);

  const resetMode = useCallback(() => {
    setMode('list');
    setEditName('');
    setEditViewId(null);
    setConfirmDeleteId(null);
  }, []);

  const handleSave = useCallback(() => {
    const trimmed = editName.trim();
    if (!trimmed) return;
    if (mode === 'create') {
      onSaveNew(trimmed);
    } else if (mode === 'rename' && editViewId != null) {
      onUpdateView(editViewId, trimmed);
    }
    resetMode();
  }, [editName, editViewId, mode, onSaveNew, onUpdateView, resetMode]);

  const activeView = views.find((v) => v.id === activeViewId);
  const hasActiveView = !!activeViewId;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => { setOpen(!open); if (!open) resetMode(); }}
        className="flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-[12px] font-medium transition-all shrink-0"
        style={{
          background: hasActiveView ? 'color-mix(in srgb, var(--accent) 10%, transparent)' : 'var(--bg-tertiary)',
          border: `1px solid ${hasActiveView ? 'color-mix(in srgb, var(--accent) 30%, transparent)' : 'var(--border)'}`,
          color: hasActiveView ? 'var(--accent)' : 'var(--text-secondary)',
        }}
      >
        <Bookmark size={12} />
        {activeView ? (
          <>
            <span className="max-w-[100px] truncate">{activeView.name}</span>
            {isDirty && (
              <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: 'var(--warning)' }} title="View has unsaved changes" />
            )}
          </>
        ) : 'Views'}
        <ChevronDown size={10} />
      </button>

      {open && (
        <div
          // docs/54 V4: the shared popover surface.
          className="absolute right-0 top-full mt-1 z-popover w-[260px] overflow-hidden rounded-xl"
          style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', boxShadow: 'var(--panel-shadow)' }}
        >
          <MenuHeader mode={mode} onStartCreate={() => { setMode('create'); setEditName(''); }} onCancel={resetMode} />

          {(mode === 'create' || mode === 'rename') && (
            <NameInput
              ref={inputRef}
              value={editName}
              placeholder={mode === 'create' ? 'View name…' : 'Rename view…'}
              onChange={setEditName}
              onSubmit={handleSave}
              onCancel={resetMode}
              isSaving={isSaving}
            />
          )}

          <div className="max-h-[240px] overflow-y-auto">
            {isViewsLoading ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 size={14} className="animate-spin" style={{ color: 'var(--text-muted)' }} />
              </div>
            ) : views.length === 0 ? (
              <div className="px-3 py-4 text-center">
                <div className="text-[13px]" style={{ color: 'var(--text-muted)' }}>No saved views yet</div>
                <div className="text-[12px] mt-0.5" style={{ color: 'var(--text-muted)' }}>Configure the board and save your setup</div>
              </div>
            ) : (
              views.map((view) => (
                <SavedViewItem
                  key={view.id}
                  view={{ id: view.id, name: view.name, description: describe?.(view) }}
                  isActive={view.id === activeViewId}
                  isDeleting={confirmDeleteId === view.id}
                  onApply={() => { onApplyView(view); setOpen(false); resetMode(); }}
                  onStartRename={() => { setMode('rename'); setEditViewId(view.id); setEditName(view.name); }}
                  onStartDelete={() => setConfirmDeleteId(view.id)}
                  onConfirmDelete={() => { onDeleteView(view.id); setConfirmDeleteId(null); }}
                  onCancelDelete={() => setConfirmDeleteId(null)}
                />
              ))
            )}
          </div>

          {hasActiveView && (
            <MenuFooter
              isDirty={isDirty}
              isSaving={isSaving}
              activeViewName={activeView?.name}
              onUpdate={() => { if (activeView) { onUpdateView(activeView.id, activeView.name); } setOpen(false); resetMode(); }}
              onClear={() => { onClearView(); setOpen(false); resetMode(); }}
            />
          )}
        </div>
      )}
    </div>
  );
}

function MenuHeader({ mode, onStartCreate, onCancel }: { mode: string; onStartCreate: () => void; onCancel: () => void }) {
  return (
    <div className="flex items-center justify-between px-3 py-2" style={{ borderBottom: '1px solid var(--border)' }}>
      <span className="text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>Saved Views</span>
      {mode === 'list' ? (
        <button onClick={onStartCreate} className="flex items-center gap-1 text-[12px] font-medium rounded-lg px-1.5 py-0.5" style={{ color: 'var(--accent)' }}>
          <Plus size={11} /> Save current
        </button>
      ) : (
        <button onClick={onCancel} className="rounded-md p-0.5" style={{ color: 'var(--text-muted)' }}>
          <X size={12} />
        </button>
      )}
    </div>
  );
}

import { forwardRef } from 'react';

const NameInput = forwardRef<HTMLInputElement, {
  value: string;
  placeholder: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  isSaving: boolean;
}>(({ value, placeholder, onChange, onSubmit, onCancel, isSaving }, inputRef) => (
  <div className="flex items-center gap-1.5 px-3 py-2" style={{ borderBottom: '1px solid var(--border)' }}>
    <input
      ref={inputRef}
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => { if (e.key === 'Enter') onSubmit(); if (e.key === 'Escape') onCancel(); }}
      placeholder={placeholder}
      maxLength={120}
      className="flex-1 bg-transparent text-[13px] outline-none placeholder:text-placeholder"
      style={{ color: 'var(--text-primary)' }}
    />
    <button
      onClick={onSubmit}
      disabled={!value.trim() || isSaving}
      className="shrink-0 rounded-lg p-1 transition-colors disabled:opacity-40"
      style={{ background: 'color-mix(in srgb, var(--accent) 15%, transparent)', color: 'var(--accent)' }}
    >
      {isSaving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
    </button>
  </div>
));
NameInput.displayName = 'NameInput';

function MenuFooter({ isDirty, isSaving, activeViewName, onUpdate, onClear }: {
  isDirty: boolean; isSaving: boolean; activeViewName?: string; onUpdate: () => void; onClear: () => void;
}) {
  return (
    <div className="flex items-center gap-1.5 px-3 py-2" style={{ borderTop: '1px solid var(--border)' }}>
      {isDirty && (
        <button
          onClick={onUpdate}
          disabled={isSaving}
          className="flex-1 flex items-center justify-center gap-1 text-[12px] font-medium rounded-lg px-2 py-1.5"
          style={{
            background: 'color-mix(in srgb, var(--accent) 12%, transparent)',
            color: 'var(--accent)',
            border: '1px solid color-mix(in srgb, var(--accent) 25%, transparent)',
          }}
        >
          {isSaving ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
          Update &ldquo;{activeViewName}&rdquo;
        </button>
      )}
      <button
        onClick={onClear}
        className="flex items-center justify-center gap-1 text-[12px] font-medium rounded-lg px-2 py-1.5"
        style={{ color: 'var(--text-secondary)', border: '1px solid var(--border)' }}
      >
        <X size={11} /> Clear view
      </button>
    </div>
  );
}
