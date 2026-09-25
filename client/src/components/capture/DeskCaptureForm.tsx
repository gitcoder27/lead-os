import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Briefcase, FileText } from 'lucide-react';
import { useToast } from '@/context/ToastContext';
import { useCreateManagerDeskItem } from '@/hooks/useManagerDesk';
import type { ManagerDeskCategory, ManagerDeskCreateItemPayload, ManagerDeskItemKind } from '@/types/manager-desk';
import { CATEGORY_LABELS, KIND_LABELS } from '@/types/manager-desk';
import type { GlobalCaptureContext } from './GlobalCaptureDialog';
import { useTasksPhase3 } from '@/hooks/useTasksPhase3';

const kindOptions: ManagerDeskItemKind[] = ['action', 'meeting', 'decision', 'waiting'];
const categoryOptions: ManagerDeskCategory[] = [
  'analysis',
  'design',
  'team_management',
  'cross_team',
  'follow_up',
  'escalation',
  'admin',
  'planning',
  'other',
];

interface DeskCaptureFormProps {
  date: string;
  formattedDate: string;
  onClose: () => void;
  onOpenManagerDesk?: () => void;
  context?: GlobalCaptureContext;
}

export function DeskCaptureForm({
  date,
  formattedDate,
  onClose,
  onOpenManagerDesk,
  context,
}: DeskCaptureFormProps) {
  const createItem = useCreateManagerDeskItem(date);
  const { addToast } = useToast();
  const titleRef = useRef<HTMLInputElement>(null);
  // Phase 3 (P3-D13): kind/category pickers retire; labels are the taxonomy.
  const phase3 = useTasksPhase3();

  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<ManagerDeskItemKind>('action');
  const [category, setCategory] = useState<ManagerDeskCategory>('planning');
  const [contextNote, setContextNote] = useState('');
  const [detailsOpen, setDetailsOpen] = useState(false);

  const contextLinks: ManagerDeskCreateItemPayload['links'] = [];
  if (context?.developer?.accountId) {
    contextLinks.push({ linkType: 'developer', developerAccountId: context.developer.accountId });
  }
  if (context?.issue?.jiraKey) {
    contextLinks.push({ linkType: 'issue', issueKey: context.issue.jiraKey });
  }

  useEffect(() => {
    const t = setTimeout(() => titleRef.current?.focus(), 140);
    return () => clearTimeout(t);
  }, []);

  const handleSubmit = () => {
    const trimmed = title.trim();
    if (!trimmed || createItem.isPending) return;

    createItem.mutate(
      {
        date,
        title: trimmed,
        kind,
        category,
        contextNote: contextNote.trim() || undefined,
        links: contextLinks.length > 0 ? contextLinks : undefined,
      },
      {
        onSuccess: () => {
          addToast({
            type: 'success',
            title: 'Saved to Manager Desk',
            message: `Scheduled for ${formattedDate}.`,
            action: onOpenManagerDesk
              ? { label: 'Open Desk', onClick: onOpenManagerDesk }
              : undefined,
          });
          onClose();
        },
        onError: (error) => {
          addToast({ type: 'error', title: 'Could not save', message: error.message });
        },
      },
    );
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.12 }}
    >
      {/* Form body */}
      <div className="px-5 py-3.5 space-y-3">
        <label htmlFor="desk-capture-title" className="sr-only">
          Desk item title
        </label>
        <input
          id="desk-capture-title"
          ref={titleRef}
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSubmit();
            }
          }}
          placeholder="What needs to land on your desk?"
          className="w-full rounded-xl px-3.5 py-2.5 text-[13px] outline-none"
          style={{
            background: 'var(--bg-tertiary)',
            color: 'var(--text-primary)',
            border: '1px solid var(--border)',
          }}
          maxLength={200}
        />

        {/* Kind + Category row — retired under Phase 3 (labels replace them) */}
        {!phase3 && (
        <div className="flex items-center gap-2 flex-wrap">
          {kindOptions.map((opt) => {
            const active = kind === opt;
            return (
              <button
                key={opt}
                type="button"
                onClick={() => setKind(opt)}
                aria-pressed={active}
                aria-label={`${KIND_LABELS[opt]} kind`}
                className="rounded-lg px-2.5 py-1 text-[12px] font-medium transition-all"
                style={{
                  background: active ? 'var(--md-accent-glow)' : 'var(--bg-tertiary)',
                  color: active ? 'var(--md-accent)' : 'var(--text-muted)',
                  border: `1px solid ${active ? 'rgba(217,169,78,0.28)' : 'var(--border)'}`,
                }}
              >
                {KIND_LABELS[opt]}
              </button>
            );
          })}
          <label htmlFor="desk-capture-category" className="sr-only">
            Desk item category
          </label>
          <select
            id="desk-capture-category"
            value={category}
            onChange={(e) => setCategory(e.target.value as ManagerDeskCategory)}
            className="ml-auto rounded-lg px-2 py-1 text-[12px] outline-none"
            style={{
              background: 'var(--bg-tertiary)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border)',
            }}
          >
            {categoryOptions.map((opt) => (
              <option key={opt} value={opt}>
                {CATEGORY_LABELS[opt]}
              </option>
            ))}
          </select>
        </div>
        )}

        {/* Context note — collapsible */}
        <div
          className="overflow-hidden rounded-xl border"
          style={{ borderColor: 'var(--border)' }}
        >
          <button
            type="button"
            onClick={() => setDetailsOpen((v) => !v)}
            className="flex w-full items-center justify-between px-3 py-2 text-left"
            style={{
              background: detailsOpen
                ? 'color-mix(in srgb, var(--bg-tertiary) 80%, transparent)'
                : 'transparent',
            }}
          >
            <span
              className="flex items-center gap-1.5 text-[12px] font-medium"
              style={{ color: 'var(--text-secondary)' }}
            >
              <FileText size={11} style={{ color: 'var(--text-muted)' }} />
              Context note
            </span>
            <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
              {detailsOpen ? 'Hide' : 'Optional'}
            </span>
          </button>
          {detailsOpen && (
            <div className="border-t px-3 py-2.5" style={{ borderColor: 'var(--border)' }}>
              <textarea
                aria-label="Context note"
                value={contextNote}
                onChange={(e) => setContextNote(e.target.value)}
                rows={2}
                placeholder="Quick context so future-you remembers why..."
                className="w-full rounded-lg px-2.5 py-2 text-[13px] outline-none resize-y"
                style={{
                  background: 'var(--bg-tertiary)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border)',
                  minHeight: '52px',
                }}
                maxLength={1500}
              />
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div
        className="flex items-center justify-between gap-2 px-5 py-3"
        style={{
          borderTop: '1px solid var(--border)',
          background: 'color-mix(in srgb, var(--bg-tertiary) 40%, transparent)',
        }}
      >
        <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
          Lands on desk for{' '}
          <span style={{ color: 'var(--text-secondary)' }}>{formattedDate}</span>
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-2.5 py-1.5 text-[12px] font-medium"
            style={{ color: 'var(--text-muted)' }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!title.trim() || createItem.isPending}
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-semibold transition-all disabled:opacity-40"
            style={{
              background: 'var(--md-accent)',
              color: '#111',
              boxShadow: '0 4px 12px rgba(217,169,78,0.2)',
            }}
          >
            <Briefcase size={11} />
            {createItem.isPending ? 'Saving…' : 'Add to Desk'}
          </button>
        </div>
      </div>
    </motion.div>
  );
}
