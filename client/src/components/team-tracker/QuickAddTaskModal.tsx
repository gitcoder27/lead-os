import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Link, Plus, Search, X, Zap } from 'lucide-react';
import { JiraIssueLink } from '@/components/JiraIssueLink';
import { TrackerIssueAssignmentConflictPanel } from './TrackerIssueAssignmentConflictPanel';
import type { Issue } from '@/types';
import { useModalFocus } from '@/hooks/useModalFocus';
import { Kbd } from '@/components/ui/Kbd';

interface QuickAddTaskModalProps {
  open: boolean;
  date: string;
  developerName: string;
  developerAccountId: string;
  issues?: Issue[];
  isPending?: boolean;
  onAdd: (params: { accountId: string; title: string; jiraKey?: string; note?: string }) => void;
  onOpenExistingAssignment: (itemId: number) => void;
  onClose: () => void;
}

export function QuickAddTaskModal({
  open,
  date,
  developerName,
  developerAccountId,
  issues,
  isPending,
  onAdd,
  onOpenExistingAssignment,
  onClose,
}: QuickAddTaskModalProps) {
  // docs/54 V1: Tab stays inside the layer; focus returns to the opener on close.
  const modalRef = useModalFocus<HTMLDivElement>(open);
  const titleRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [jiraSearch, setJiraSearch] = useState('');
  const [jiraPickerOpen, setJiraPickerOpen] = useState(false);
  const [selectedIssue, setSelectedIssue] = useState<{ jiraKey: string; summary: string } | null>(null);

  const initials = developerName
    .split(' ')
    .map((n) => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  const filteredIssues = useMemo(
    () =>
      issues
        ?.filter(
          (issue) =>
            issue.jiraKey.toLowerCase().includes(jiraSearch.toLowerCase()) ||
            issue.summary.toLowerCase().includes(jiraSearch.toLowerCase()),
        )
        .slice(0, 8) ?? [],
    [issues, jiraSearch],
  );

  // Focus title on open
  useEffect(() => {
    if (open) {
      const timer = window.setTimeout(() => titleRef.current?.focus(), 120);
      return () => window.clearTimeout(timer);
    }
  }, [open]);

  // Reset form when closed
  useEffect(() => {
    if (!open) {
      setTitle('');
      setNote('');
      setJiraSearch('');
      setJiraPickerOpen(false);
      setSelectedIssue(null);
    }
  }, [open]);

  // Keyboard: Escape to close
  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [open, onClose]);

  const handleSubmit = () => {
    const trimmed = title.trim();
    if (!trimmed || isPending) return;

    onAdd({
      accountId: developerAccountId,
      title: trimmed,
      jiraKey: selectedIssue?.jiraKey,
      note: note.trim() || undefined,
    });
  };

  const handleOpenExistingAssignment = (itemId: number) => {
    onClose();
    onOpenExistingAssignment(itemId);
  };

  if (typeof document === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="fixed inset-0 z-dialog"
            style={{ background: 'var(--scrim)', backdropFilter: 'var(--scrim-blur)' }}
            onClick={onClose}
          />

          {/* Modal */}
          <motion.div
            key="modal"
            initial={{ opacity: 0, y: 24, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.96 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className="fixed z-dialog inset-x-4 mx-auto w-full max-w-[480px] overflow-hidden rounded-2xl"
            style={{
              top: '14vh',
              background:
                'linear-gradient(180deg, color-mix(in srgb, var(--bg-primary) 94%, color-mix(in srgb, var(--accent) 8%, transparent)) 0%, var(--bg-secondary) 100%)',
              border: '1px solid color-mix(in srgb, var(--accent) 22%, var(--border-strong) 78%)',
              boxShadow:
                'var(--overlay-shadow)',
            }}
            ref={modalRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="quick-add-modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div
              className="px-5 py-4"
              style={{
                borderBottom: '1px solid color-mix(in srgb, var(--accent) 14%, var(--border) 86%)',
                background:
                  'linear-gradient(135deg, color-mix(in srgb, var(--accent-glow) 60%, transparent) 0%, transparent 64%)',
              }}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  {/* Zap icon */}
                  <div
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl"
                    style={{
                      background: 'var(--accent-glow)',
                      color: 'var(--accent)',
                      border: '1px solid color-mix(in srgb, var(--accent) 28%, transparent)',
                    }}
                  >
                    <Zap size={15} strokeWidth={2.2} />
                  </div>
                  <div className="min-w-0">
                    <div id="quick-add-modal-title" className="text-[15px] font-semibold leading-tight" style={{ color: 'var(--text-primary)' }}>
                      Quick Add Task
                    </div>
                    {/* Developer chip */}
                    <div className="mt-1 flex items-center gap-1.5">
                      <div
                        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-[11px] font-bold"
                        style={{
                          background: 'linear-gradient(135deg, var(--accent-glow), var(--bg-tertiary))',
                          color: 'var(--accent)',
                          border: '1px solid var(--border)',
                        }}
                      >
                        {initials}
                      </div>
                      <span className="text-[13px] font-medium truncate" style={{ color: 'var(--text-secondary)' }}>
                        {developerName}
                      </span>
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl transition-colors hover:brightness-125"
                  style={{ background: 'var(--bg-elevated)', color: 'var(--text-muted)' }}
                  aria-label="Close quick add"
                >
                  <X size={14} />
                </button>
              </div>
            </div>

            {/* Form body */}
            <div className="px-5 py-4 space-y-4">
              {/* Task title */}
              <div>
                <label
                  className="block text-[12px] font-semibold uppercase mb-1.5 tracking-widest"
                  style={{ color: 'var(--text-muted)' }}
                  htmlFor="quick-add-title"
                >
                  Task
                </label>
                <input
                  id="quick-add-title"
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
                  placeholder="Describe the work in one line…"
                  className="w-full rounded-xl px-3.5 py-2.5 text-[13px] outline-none transition-all"
                  style={{
                    background: 'var(--bg-elevated)',
                    color: 'var(--text-primary)',
                    border: '1px solid var(--border-active)',
                    caretColor: 'var(--accent)',
                  }}
                  onFocus={(e) => {
                    e.currentTarget.style.borderColor = 'color-mix(in srgb, var(--accent) 50%, var(--border-active))';
                    e.currentTarget.style.boxShadow = '0 0 0 3px color-mix(in srgb, var(--accent) 12%, transparent)';
                  }}
                  onBlur={(e) => {
                    e.currentTarget.style.borderColor = 'var(--border-active)';
                    e.currentTarget.style.boxShadow = 'none';
                  }}
                />
              </div>

              {/* Jira link */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label
                    className="text-[12px] font-semibold uppercase tracking-widest"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    Linked Jira
                  </label>
                  {issues && issues.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setJiraPickerOpen((v) => !v)}
                      className="text-[12px] px-2.5 py-1 rounded-lg font-medium transition-colors"
                      style={{
                        color: 'var(--accent)',
                        background: 'var(--accent-glow)',
                        border: '1px solid color-mix(in srgb, var(--accent) 22%, transparent)',
                      }}
                    >
                      {selectedIssue ? 'Change' : '+ Attach Jira'}
                    </button>
                  )}
                </div>

                {selectedIssue ? (
                  <div className="space-y-2">
                    <div
                      className="flex items-start justify-between gap-2 rounded-xl px-3 py-2.5"
                      style={{
                        background: 'var(--accent-glow)',
                        border: '1px solid color-mix(in srgb, var(--accent) 25%, transparent)',
                      }}
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <Link size={11} style={{ color: 'var(--accent)' }} />
                          <JiraIssueLink issueKey={selectedIssue.jiraKey} className="font-mono text-[12px] font-semibold" style={{ color: 'var(--accent)' }}>
                            {selectedIssue.jiraKey}
                          </JiraIssueLink>
                        </div>
                        <div className="text-[13px] mt-0.5 truncate" style={{ color: 'var(--text-secondary)' }}>
                          {selectedIssue.summary}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedIssue(null);
                          setJiraSearch('');
                        }}
                        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg"
                        style={{ color: 'var(--text-muted)', background: 'var(--bg-elevated)' }}
                        aria-label="Remove linked Jira"
                      >
                        <X size={10} />
                      </button>
                    </div>
                    <TrackerIssueAssignmentConflictPanel
                      jiraKey={selectedIssue.jiraKey}
                      date={date}
                      targetAccountId={developerAccountId}
                      onOpenAssignment={handleOpenExistingAssignment}
                    />
                  </div>
                ) : !jiraPickerOpen ? (
                  <div
                    className="rounded-xl px-3 py-2.5 text-[13px]"
                    style={{
                      background: 'var(--bg-elevated)',
                      border: '1px solid var(--border)',
                      color: 'var(--text-muted)',
                    }}
                  >
                    None — use "+ Attach Jira" to link an issue
                  </div>
                ) : null}

                {jiraPickerOpen && (
                  <div className="space-y-1.5">
                    <div className="relative">
                      <Search
                        size={13}
                        className="absolute left-3 top-1/2 -translate-y-1/2"
                        style={{ color: 'var(--text-muted)' }}
                      />
                      <input
                        type="text"
                        autoFocus
                        value={jiraSearch}
                        onChange={(e) => setJiraSearch(e.target.value)}
                        placeholder="Search by key or summary…"
                        className="w-full rounded-xl pl-9 pr-3.5 py-2.5 text-[13px] outline-none"
                        style={{
                          background: 'var(--bg-elevated)',
                          color: 'var(--text-primary)',
                          border: '1px solid var(--border-active)',
                        }}
                      />
                    </div>

                    {jiraSearch && filteredIssues.length > 0 && (
                      <div
                        className="rounded-xl overflow-hidden max-h-[144px] overflow-y-auto"
                        style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}
                      >
                        {filteredIssues.map((issue) => (
                          <div
                            key={issue.jiraKey}
                            className="flex items-center gap-2.5 px-3 py-2 transition-colors hover:bg-white/5"
                            style={{ borderBottom: '1px solid var(--border)' }}
                          >
                            <JiraIssueLink
                              issueKey={issue.jiraKey}
                              stopPropagation
                              className="font-mono text-[12px] font-semibold shrink-0"
                              style={{ color: 'var(--accent)' }}
                            >
                              {issue.jiraKey}
                            </JiraIssueLink>
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedIssue({ jiraKey: issue.jiraKey, summary: issue.summary });
                                setJiraPickerOpen(false);
                                setJiraSearch('');
                              }}
                              className="min-w-0 flex-1 truncate text-left text-[13px]"
                              style={{ color: 'var(--text-secondary)' }}
                            >
                              {issue.summary}
                            </button>
                          </div>
                        ))}
                      </div>
                    )}

                    {jiraSearch && filteredIssues.length === 0 && (
                      <div
                        className="rounded-xl px-3 py-2.5 text-[13px] text-center"
                        style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}
                      >
                        No matching issues
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Note */}
              <div>
                <label
                  className="block text-[12px] font-semibold uppercase mb-1.5 tracking-widest"
                  style={{ color: 'var(--text-muted)' }}
                  htmlFor="quick-add-note"
                >
                  Note <span style={{ color: 'var(--text-muted)', fontWeight: 400, textTransform: 'none', letterSpacing: 'normal' }}>(optional)</span>
                </label>
                <textarea
                  id="quick-add-note"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={2}
                  placeholder="Context, handoff detail, or priority reason…"
                  className="w-full rounded-xl px-3.5 py-2.5 text-[13px] outline-none resize-none transition-all"
                  style={{
                    background: 'var(--bg-elevated)',
                    color: 'var(--text-primary)',
                    border: '1px solid var(--border)',
                  }}
                />
              </div>
            </div>

            {/* Footer */}
            <div
              className="px-5 py-3.5 flex items-center justify-between gap-3"
              style={{
                borderTop: '1px solid var(--border)',
                background: 'color-mix(in srgb, var(--bg-primary) 60%, var(--bg-secondary) 40%)',
              }}
            >
              <p className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
                Press <Kbd>Enter</Kbd> to add
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-xl px-3.5 py-2 text-[13px] font-medium transition-colors"
                  style={{ color: 'var(--text-secondary)', background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={!title.trim() || isPending}
                  className="flex items-center gap-1.5 rounded-xl px-4 py-2 text-[13px] font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                  style={{
                    background: 'linear-gradient(135deg, color-mix(in srgb, var(--accent) 90%, transparent), color-mix(in srgb, var(--accent) 70%, transparent))',
                    color: 'var(--bg-primary)',
                    boxShadow: title.trim() ? '0 2px 12px color-mix(in srgb, var(--accent) 30%, transparent)' : 'none',
                  }}
                >
                  <Plus size={13} strokeWidth={2.5} />
                  Add Task
                </button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    document.body,
  );
}
