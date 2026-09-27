import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Link, Plus, Search, X } from 'lucide-react';
import { useToast } from '@/context/ToastContext';
import { useAddTrackerItem } from '@/hooks/useTeamTrackerMutations';
import { useManagerDeskIssueLookup } from '@/hooks/useManagerDesk';
import { JiraIssueLink } from '@/components/JiraIssueLink';
import { DeveloperPicker } from './DeveloperPicker';
import type { ManagerDeskDeveloperLookupItem } from '@/types/manager-desk';
import type { GlobalCaptureContext } from './GlobalCaptureDialog';

interface TrackerCaptureFormProps {
  date: string;
  formattedDate: string;
  onClose: () => void;
  onOpenTeamTracker?: () => void;
  context?: GlobalCaptureContext;
}

export function TrackerCaptureForm({
  date,
  formattedDate,
  onClose,
  onOpenTeamTracker,
  context,
}: TrackerCaptureFormProps) {
  const addItem = useAddTrackerItem(date);
  const { addToast } = useToast();
  const titleRef = useRef<HTMLInputElement>(null);

  const [developer, setDeveloper] = useState<ManagerDeskDeveloperLookupItem | null>(null);
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [noteOpen, setNoteOpen] = useState(false);
  const [jiraSearch, setJiraSearch] = useState('');
  const [jiraPickerOpen, setJiraPickerOpen] = useState(false);
  const [selectedIssue, setSelectedIssue] = useState<{
    jiraKey: string;
    summary: string;
  } | null>(null);

  const { data: issueResults } = useManagerDeskIssueLookup(jiraSearch);

  // Focus title when developer is selected
  useEffect(() => {
    if (developer) {
      const t = setTimeout(() => titleRef.current?.focus(), 100);
      return () => clearTimeout(t);
    }
  }, [developer]);

  useEffect(() => {
    if (!context?.issue?.jiraKey) {
      return;
    }

    setSelectedIssue({
      jiraKey: context.issue.jiraKey,
      summary: context.issue.summary ?? '',
    });
    setJiraPickerOpen(false);
    setJiraSearch('');
  }, [context?.issue?.jiraKey, context?.issue?.summary]);

  const handleSubmit = () => {
    const trimmed = title.trim();
    if (!trimmed || !developer || addItem.isPending) return;

    addItem.mutate(
      {
        accountId: developer.accountId,
        title: trimmed,
        jiraKey: selectedIssue?.jiraKey,
        details: note.trim() || undefined,
      },
      {
        onSuccess: () => {
          addToast({
            type: 'success',
            title: 'Task added to tracker',
            message: `Assigned to ${developer.displayName} for ${formattedDate}.`,
            action: onOpenTeamTracker
              ? { label: 'Open Tracker', onClick: onOpenTeamTracker }
              : undefined,
          });
          onClose();
        },
        onError: (error) => {
          addToast({ type: 'error', title: 'Could not add task', message: error.message });
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
      <div className="px-5 py-3.5 space-y-3">
        {/* Developer picker */}
        <div>
          <label
            className="block text-[11px] font-semibold uppercase mb-1.5 tracking-widest"
            style={{ color: 'var(--text-muted)' }}
          >
            Assign to
          </label>
          <DeveloperPicker
            date={date}
            selected={developer}
            onSelect={setDeveloper}
            onClear={() => setDeveloper(null)}
          />
        </div>

        {/* Task title */}
        <div>
          <label
            className="block text-[11px] font-semibold uppercase mb-1.5 tracking-widest"
            style={{ color: 'var(--text-muted)' }}
            htmlFor="tracker-capture-title"
          >
            Task
          </label>
          <input
            id="tracker-capture-title"
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
            placeholder={
              developer
                ? `What should ${developer.displayName.split(' ')[0]} work on?`
                : 'Select a developer first…'
            }
            disabled={!developer}
            className="w-full rounded-xl px-3.5 py-2.5 text-[13px] outline-none transition-all disabled:opacity-40"
            style={{
              background: 'var(--bg-elevated)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border)',
              caretColor: 'var(--accent)',
            }}
            onFocus={(e) => {
              e.currentTarget.style.borderColor =
                'color-mix(in srgb, var(--accent) 50%, var(--border-active))';
              e.currentTarget.style.boxShadow =
                '0 0 0 3px color-mix(in srgb, var(--accent) 12%, transparent)';
            }}
            onBlur={(e) => {
              e.currentTarget.style.borderColor = 'var(--border)';
              e.currentTarget.style.boxShadow = 'none';
            }}
          />
        </div>

        {/* Optional additions — inline buttons when collapsed */}
        {!selectedIssue && !jiraPickerOpen && !noteOpen && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setJiraPickerOpen(true)}
              className="text-[11px] px-2.5 py-1 rounded-lg font-medium transition-colors"
              style={{
                color: 'var(--accent)',
                background: 'var(--accent-glow)',
                border: '1px solid color-mix(in srgb, var(--accent) 22%, transparent)',
              }}
            >
              + Attach Jira
            </button>
            <button
              type="button"
              onClick={() => setNoteOpen(true)}
              className="text-[11px] px-2.5 py-1 rounded-lg font-medium transition-colors"
              style={{
                color: 'var(--text-secondary)',
                background: 'var(--bg-tertiary)',
                border: '1px solid var(--border)',
              }}
            >
              + Add details
            </button>
          </div>
        )}

        {/* Jira linked chip */}
        {selectedIssue && (
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label
                className="text-[11px] font-semibold uppercase tracking-widest"
                style={{ color: 'var(--text-muted)' }}
              >
                Linked Jira
              </label>
              <button
                type="button"
                onClick={() => {
                  setSelectedIssue(null);
                  setJiraSearch('');
                  setJiraPickerOpen(true);
                }}
                className="text-[11px] px-2 py-0.5 rounded-lg font-medium"
                style={{ color: 'var(--accent)' }}
              >
                Change
              </button>
            </div>
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
                  <JiraIssueLink
                    issueKey={selectedIssue.jiraKey}
                    className="font-mono text-[12px] font-semibold"
                    style={{ color: 'var(--accent)' }}
                  >
                    {selectedIssue.jiraKey}
                  </JiraIssueLink>
                </div>
                {selectedIssue.summary && (
                  <div
                    className="text-[13px] mt-0.5 truncate"
                    style={{ color: 'var(--text-secondary)' }}
                  >
                    {selectedIssue.summary}
                  </div>
                )}
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
          </div>
        )}

        {/* Jira search picker */}
        {jiraPickerOpen && !selectedIssue && (
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label
                className="text-[11px] font-semibold uppercase tracking-widest"
                style={{ color: 'var(--text-muted)' }}
              >
                Link a Jira issue
              </label>
              <button
                type="button"
                onClick={() => {
                  setJiraPickerOpen(false);
                  setJiraSearch('');
                }}
                className="text-[11px] px-2 py-0.5 rounded-lg font-medium"
                style={{ color: 'var(--text-muted)' }}
              >
                Cancel
              </button>
            </div>
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
                  className="w-full rounded-xl pl-9 pr-3 py-2.5 text-[13px] outline-none"
                  style={{
                    background: 'var(--bg-elevated)',
                    color: 'var(--text-primary)',
                    border: '1px solid var(--border-active)',
                  }}
                />
              </div>

              {issueResults && issueResults.length > 0 && (
                <div
                  className="rounded-xl overflow-hidden max-h-[120px] overflow-y-auto"
                  style={{
                    background: 'var(--bg-elevated)',
                    border: '1px solid var(--border)',
                  }}
                >
                  {issueResults.slice(0, 6).map((issue) => (
                    <button
                      key={issue.jiraKey}
                      type="button"
                      onClick={() => {
                        setSelectedIssue({
                          jiraKey: issue.jiraKey,
                          summary: issue.summary,
                        });
                        setJiraPickerOpen(false);
                        setJiraSearch('');
                      }}
                      className="flex items-center gap-2.5 w-full px-3 py-2 text-left transition-colors hover:brightness-110"
                      style={{
                        borderBottom: '1px solid var(--border)',
                        background: 'transparent',
                      }}
                    >
                      <span
                        className="font-mono text-[11px] font-semibold shrink-0"
                        style={{ color: 'var(--accent)' }}
                      >
                        {issue.jiraKey}
                      </span>
                      <span
                        className="min-w-0 flex-1 truncate text-[13px]"
                        style={{ color: 'var(--text-secondary)' }}
                      >
                        {issue.summary}
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {jiraSearch.length >= 2 && issueResults && issueResults.length === 0 && (
                <div
                  className="rounded-xl px-3 py-2.5 text-[13px] text-center"
                  style={{
                    background: 'var(--bg-elevated)',
                    border: '1px solid var(--border)',
                    color: 'var(--text-muted)',
                  }}
                >
                  No matching issues
                </div>
              )}
            </div>
          </div>
        )}

        {/* Note — expandable */}
        {noteOpen && (
          <div>
            <label
              className="block text-[11px] font-semibold uppercase mb-1.5 tracking-widest"
              style={{ color: 'var(--text-muted)' }}
              htmlFor="tracker-capture-note"
            >
              Details{' '}
              <span
                style={{
                  fontWeight: 400,
                  textTransform: 'none',
                  letterSpacing: 'normal',
                }}
              >
                (optional)
              </span>
            </label>
            <textarea
              id="tracker-capture-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              placeholder="Context, links, what done looks like — shared with the developer"
              className="w-full rounded-xl px-3.5 py-2.5 text-[13px] outline-none resize-none"
              style={{
                background: 'var(--bg-elevated)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border)',
              }}
            />
          </div>
        )}
      </div>

      {/* Footer */}
      <div
        className="px-5 py-3 flex items-center justify-between gap-3"
        style={{
          borderTop: '1px solid var(--border)',
          background:
            'color-mix(in srgb, var(--bg-primary) 60%, var(--bg-secondary) 40%)',
        }}
      >
        <p className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
          Creates task for{' '}
          <span style={{ color: 'var(--text-secondary)' }}>today</span>
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl px-3 py-1.5 text-[12px] font-medium"
            style={{
              color: 'var(--text-secondary)',
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border)',
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!title.trim() || !developer || addItem.isPending}
            className="flex items-center gap-1.5 rounded-xl px-3.5 py-1.5 text-[12px] font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            style={{
              background:
                'linear-gradient(135deg, color-mix(in srgb, var(--accent) 90%, transparent), color-mix(in srgb, var(--accent) 70%, transparent))',
              color: 'var(--bg-primary)',
              boxShadow:
                title.trim() && developer
                  ? '0 2px 12px color-mix(in srgb, var(--accent) 30%, transparent)'
                  : 'none',
            }}
          >
            <Plus size={12} strokeWidth={2.5} />
            {addItem.isPending ? 'Adding…' : 'Add Task'}
          </button>
        </div>
      </div>
    </motion.div>
  );
}
