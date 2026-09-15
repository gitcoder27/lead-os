import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  ClipboardList,
  Edit3,
  MessageSquare,
  NotebookPen,
  RefreshCw,
  Sparkles,
  UserPlus,
  Zap,
  ChevronDown,
} from 'lucide-react';
import type { AssistantActionDecision, AssistantActionProposal } from '@/types';

interface ActionConfirmCardProps {
  proposal: AssistantActionProposal;
  busy: boolean;
  onDecision: (decision: AssistantActionDecision) => void;
}

const TOOL_ICONS: Record<string, typeof Sparkles> = {
  manager_action: Zap,
  create_desk_item: ClipboardList,
  update_desk_item: ClipboardList,
  assign_tracker_task: UserPlus,
  add_issue_comment: MessageSquare,
  update_issue_fields: Edit3,
  append_daily_note: NotebookPen,
  trigger_jira_sync: RefreshCw,
};

export function ActionConfirmCard({ proposal, busy, onDecision }: ActionConfirmCardProps) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const Icon = TOOL_ICONS[proposal.tool] ?? Sparkles;
  const previewEntries = Object.entries(proposal.preview ?? {});

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.18 }}
      className="rounded-xl px-3 py-2.5"
      style={{
        background: 'var(--bg-secondary)',
        border: '1px solid color-mix(in srgb, var(--accent) 30%, var(--border-strong))',
      }}
    >
      <div className="flex items-start gap-2.5">
        <span
          className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
          style={{ background: 'var(--accent-glow)', color: 'var(--accent)' }}
        >
          <Icon size={14} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <p className="text-[12.5px] font-semibold" style={{ color: 'var(--text-primary)' }}>
              {proposal.summary}
            </p>
            {proposal.jiraMutating ? (
              <span
                className="rounded-full px-1.5 py-px text-[10px] font-semibold"
                style={{ background: 'var(--warning)', color: 'var(--bg-primary)' }}
              >
                Changes Jira
              </span>
            ) : null}
          </div>
          {previewEntries.length > 0 ? (
            <button
              type="button"
              onClick={() => setDetailsOpen((open) => !open)}
              className="mt-1 inline-flex items-center gap-1 text-[11px]"
              style={{ color: 'var(--text-muted)' }}
              aria-expanded={detailsOpen}
            >
              <ChevronDown
                size={11}
                style={{ transform: detailsOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}
              />
              Details
            </button>
          ) : null}
          {detailsOpen ? (
            <dl className="mt-1.5 space-y-0.5">
              {previewEntries.map(([key, value]) => (
                <div key={key} className="flex gap-2 text-[11px] leading-4">
                  <dt className="shrink-0 font-mono" style={{ color: 'var(--text-muted)' }}>
                    {key}
                  </dt>
                  <dd className="min-w-0 break-words" style={{ color: 'var(--text-secondary)' }}>
                    {typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value)}
                  </dd>
                </div>
              ))}
            </dl>
          ) : null}
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              onClick={() => onDecision('confirm')}
              disabled={busy}
              aria-label="Confirm action"
              className="rounded-lg px-3 py-1 text-[12px] font-semibold transition-opacity disabled:opacity-50"
              style={{ background: 'var(--accent)', color: 'var(--bg-primary)' }}
            >
              Confirm
            </button>
            <button
              type="button"
              onClick={() => onDecision('cancel')}
              disabled={busy}
              aria-label="Cancel action"
              className="rounded-lg px-3 py-1 text-[12px] font-medium transition-opacity disabled:opacity-50"
              style={{
                background: 'transparent',
                color: 'var(--text-secondary)',
                border: '1px solid var(--border)',
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
