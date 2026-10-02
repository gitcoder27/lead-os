import { useMemo } from 'react';
import { useDevelopers } from '@/hooks/useDevelopers';
import { useContacts } from '@/hooks/useContacts';
import { readableActionPreview } from '@/lib/action-preview';
import './action-confirm.css';
import { motion, useReducedMotion } from 'framer-motion';
import { ClipboardList, Edit3, MessageSquare, NotebookPen, RefreshCw, Sparkles, UserPlus, Zap } from 'lucide-react';
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
  const { data: developers } = useDevelopers();
  const { data: contacts } = useContacts();
  const names = useMemo(
    () =>
      new Map([
        ...(developers ?? []).flatMap((person) => [
          [person.accountId, person.displayName] as const,
          ...(person.jiraAccountId ? [[person.jiraAccountId, person.displayName] as const] : []),
        ]),
        ...(contacts ?? []).map((person) => [`contact:${person.id}`, person.displayName] as const),
      ]),
    [developers, contacts],
  );
  const readable = readableActionPreview(proposal.preview ?? {}, names);
  const reducedMotion = useReducedMotion();
  const Icon = TOOL_ICONS[proposal.tool] ?? Sparkles;
  const previewEntries = Object.entries(proposal.preview ?? {});

  return (
    <motion.div
      initial={reducedMotion ? false : { opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.18 }}
      className="action-confirm-card rounded-xl px-3 py-2.5"
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
                className="rounded-full px-1.5 py-px text-[11px] font-semibold"
                style={{ background: 'var(--warning)', color: 'var(--bg-primary)' }}
              >
                Changes Jira
              </span>
            ) : null}
          </div>
          {readable.target && <p className="action-confirm-target">{readable.target}</p>}
          {readable.rows.length > 0 && (
            <dl aria-label="Proposed changes" className="action-confirm-changes">
              {readable.rows.map((row, index) => (
                <div key={`${row.label}-${index}`}>
                  <dt>{row.label}</dt>
                  <dd>
                    {row.before !== undefined && (
                      <>
                        <span>{row.before}</span>
                        <span aria-label="changes to"> → </span>
                      </>
                    )}
                    {row.value}
                  </dd>
                </div>
              ))}
            </dl>
          )}
          {previewEntries.length > 0 && (
            <details className="action-confirm-technical">
              <summary>Technical details</summary>
              <pre>{JSON.stringify(proposal.preview, null, 2)}</pre>
            </details>
          )}
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              onClick={() => onDecision('confirm')}
              disabled={busy}
              aria-label="Confirm action"
              className="rounded-lg px-3 py-1 text-[12px] font-semibold transition-opacity disabled:opacity-50"
              style={{ background: 'var(--accent-solid)', color: 'var(--on-accent)' }}
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
