import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { AlignLeft, Link2, Plus, Search, X } from 'lucide-react';
import { useMyDayIssues } from '@/hooks/useIssues';
import { JiraIssueLink } from '@/components/JiraIssueLink';
import { FOCUS_RING } from '@/components/tasks/TaskDetailPrimitives';
import { formatDate } from '@/lib/utils';
import { HAIRLINE, Kbd } from './MyDayUI';

interface AddTaskFormProps {
  /** `details` becomes the task's shared description (not a timeline entry). */
  onAdd: (params: { title: string; jiraKey?: string; details?: string }) => void;
  isPending?: boolean;
  disabled?: boolean;
  /** Controlled open state (the page opens it from the N shortcut and empty states). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

const ghostButton = `inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[12px] font-medium transition-colors hover:bg-[var(--bg-tertiary)] ${FOCUS_RING}`;

export function AddTaskForm({ onAdd, isPending, disabled, open: openProp, onOpenChange }: AddTaskFormProps) {
  const [openState, setOpenState] = useState(false);
  const open = openProp ?? openState;
  const setOpen = (next: boolean) => {
    setOpenState(next);
    onOpenChange?.(next);
  };
  const [title, setTitle] = useState('');
  const [details, setDetails] = useState('');
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [jiraSearch, setJiraSearch] = useState('');
  const [jiraPickerOpen, setJiraPickerOpen] = useState(false);
  const [selectedIssue, setSelectedIssue] = useState<{ jiraKey: string; summary: string } | null>(null);

  const { data: issues } = useMyDayIssues(open && jiraPickerOpen);

  const filteredIssues = useMemo(
    () =>
      issues
        ?.filter(
          (issue) =>
            issue.jiraKey.toLowerCase().includes(jiraSearch.toLowerCase()) ||
            issue.summary.toLowerCase().includes(jiraSearch.toLowerCase())
        )
        .slice(0, 6) ?? [],
    [issues, jiraSearch]
  );

  const resetForm = () => {
    setOpen(false);
    setTitle('');
    setDetails('');
    setDetailsOpen(false);
    setJiraSearch('');
    setJiraPickerOpen(false);
    setSelectedIssue(null);
  };

  const selectIssue = (issue: { jiraKey: string; summary: string }) => {
    setSelectedIssue({ jiraKey: issue.jiraKey, summary: issue.summary });
    setJiraPickerOpen(false);
    setJiraSearch('');
    // A linked issue with no title yet reads fine as its own summary.
    if (!title.trim()) setTitle(issue.summary);
  };

  const handleSubmit = () => {
    const trimmedTitle = title.trim();
    if (!trimmedTitle || disabled) {
      return;
    }

    onAdd({
      title: trimmedTitle,
      jiraKey: selectedIssue?.jiraKey,
      details: details.trim() || undefined,
    });
    resetForm();
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={disabled}
        className={`group/add flex w-full items-center gap-3 px-3 py-2.5 text-left text-[13px] transition-colors hover:bg-[color-mix(in_srgb,var(--bg-tertiary)_35%,transparent)] disabled:opacity-50 sm:px-4 ${FOCUS_RING} focus-visible:ring-inset`}
        style={{ color: 'var(--text-muted)' }}
      >
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md transition-colors group-hover/add:text-[var(--accent)]">
          <Plus size={15} aria-hidden="true" />
        </span>
        <span className="flex-1 transition-colors group-hover/add:text-[var(--text-secondary)]">Add task</span>
        <span className="hidden sm:inline-flex" aria-hidden="true"><Kbd>N</Kbd></span>
      </button>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18 }}
      className="px-3 py-3 sm:px-4"
      style={{ background: 'color-mix(in srgb, var(--bg-tertiary) 22%, transparent)' }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          resetForm();
        }
      }}
    >
      <div className="flex items-start gap-3">
        <span className="mt-[3px] flex h-5 w-5 shrink-0 items-center justify-center" style={{ color: 'var(--accent)' }} aria-hidden="true">
          <Plus size={15} />
        </span>
        <div className="min-w-0 flex-1">
          <label htmlFor="my-day-task-title" className="sr-only">Task</label>
          <input
            id="my-day-task-title"
            type="text"
            autoFocus
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            disabled={disabled}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                handleSubmit();
              }
            }}
            placeholder="What’s next? One line is enough"
            className="w-full bg-transparent text-[14px] font-medium leading-6 outline-none placeholder:font-normal placeholder:text-[var(--text-placeholder)]"
            style={{ color: 'var(--text-primary)' }}
          />

          {selectedIssue && (
            <div
              className="mt-2 flex items-start justify-between gap-2 rounded-lg px-2.5 py-2"
              style={{ background: 'color-mix(in srgb, var(--accent) 7%, transparent)', border: '1px solid color-mix(in srgb, var(--accent) 22%, transparent)' }}
            >
              <div className="flex min-w-0 items-baseline gap-2">
                <JiraIssueLink
                  issueKey={selectedIssue.jiraKey}
                  className="shrink-0 font-mono text-[11.5px] font-semibold"
                  style={{ color: 'var(--accent)' }}
                >
                  {selectedIssue.jiraKey}
                </JiraIssueLink>
                <span className="truncate text-[12.5px]" style={{ color: 'var(--text-secondary)' }}>{selectedIssue.summary}</span>
              </div>
              <button
                type="button"
                onClick={() => {
                  setSelectedIssue(null);
                  setJiraSearch('');
                }}
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded ${FOCUS_RING}`}
                style={{ color: 'var(--text-muted)' }}
                aria-label="Remove linked Jira"
              >
                <X size={12} />
              </button>
            </div>
          )}

          {jiraPickerOpen && (
            <div className="mt-2">
              <div className="relative">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} aria-hidden="true" />
                <input
                  id="my-day-jira-search"
                  type="text"
                  autoFocus
                  value={jiraSearch}
                  onChange={(event) => setJiraSearch(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && filteredIssues[0]) {
                      event.preventDefault();
                      selectIssue(filteredIssues[0]);
                    }
                  }}
                  disabled={disabled}
                  placeholder="Search by key or summary..."
                  aria-label="Search Jira issues"
                  className="w-full rounded-lg py-1.5 pl-8 pr-3 text-[13px] outline-none focus:border-[var(--border-active)]"
                  style={{ background: 'var(--bg-primary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
                />
              </div>

              {jiraSearch && filteredIssues.length > 0 && (
                <div
                  className="mt-1.5 max-h-[200px] overflow-y-auto rounded-lg"
                  style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', boxShadow: 'var(--soft-shadow)' }}
                >
                  {filteredIssues.map((issue, position) => (
                    <div
                      key={issue.jiraKey}
                      className="px-3 py-2 transition-colors hover:bg-[var(--bg-tertiary)]"
                      style={{ borderTop: position > 0 ? `1px solid ${HAIRLINE}` : undefined }}
                    >
                      <div className="flex items-center gap-2">
                        <JiraIssueLink
                          issueKey={issue.jiraKey}
                          stopPropagation
                          className="shrink-0 font-mono text-[11px] font-semibold"
                          style={{ color: 'var(--accent)' }}
                        >
                          {issue.jiraKey}
                        </JiraIssueLink>
                        <button
                          type="button"
                          onClick={() => selectIssue(issue)}
                          className="min-w-0 flex-1 truncate text-left text-[13px] outline-none focus-visible:underline"
                          style={{ color: 'var(--text-secondary)' }}
                        >
                          {issue.summary}
                        </button>
                      </div>
                      {(issue.priorityName || issue.developmentDueDate || issue.dueDate) && (
                        <div className="mt-0.5 text-[11px]" style={{ color: 'var(--text-muted)' }}>
                          {[
                            issue.priorityName,
                            (issue.developmentDueDate ?? issue.dueDate)
                              ? `Due ${formatDate(issue.developmentDueDate ?? issue.dueDate)}`
                              : undefined,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {jiraSearch && issues && filteredIssues.length === 0 && (
                <p className="mt-1.5 px-1 text-[12px]" style={{ color: 'var(--text-muted)' }}>No matching issues assigned to you.</p>
              )}
            </div>
          )}

          {detailsOpen && (
            <div className="mt-2">
              <label htmlFor="my-day-task-details" className="sr-only">Details</label>
              <textarea
                id="my-day-task-details"
                autoFocus
                value={details}
                onChange={(event) => setDetails(event.target.value)}
                disabled={disabled}
                rows={3}
                placeholder="Context, links, what done looks like (optional)"
                className="w-full resize-none rounded-lg px-2.5 py-1.5 text-[13px] outline-none focus:border-[var(--border-active)]"
                style={{ background: 'var(--bg-primary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
              />
            </div>
          )}

          <div className="mt-2.5 flex flex-wrap items-center gap-1">
            <button
              type="button"
              onClick={() => setJiraPickerOpen((current) => !current)}
              disabled={disabled}
              aria-expanded={jiraPickerOpen}
              className={ghostButton}
              style={{ color: jiraPickerOpen ? 'var(--accent)' : 'var(--text-muted)' }}
            >
              <Link2 size={13} aria-hidden="true" />
              {selectedIssue ? 'Change Jira' : 'Attach Jira'}
            </button>
            {!detailsOpen && (
              <button type="button" onClick={() => setDetailsOpen(true)} disabled={disabled} className={ghostButton} style={{ color: 'var(--text-muted)' }}>
                <AlignLeft size={13} aria-hidden="true" />
                Add details
              </button>
            )}
            <div className="ml-auto flex items-center gap-1.5">
              <button type="button" onClick={resetForm} className={`${ghostButton} px-2.5`} style={{ color: 'var(--text-muted)' }}>
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={!title.trim() || isPending || disabled}
                className={`inline-flex h-7 items-center gap-1.5 rounded-md px-3 text-[12.5px] font-semibold transition-all disabled:cursor-not-allowed disabled:opacity-40 ${FOCUS_RING}`}
                style={{ background: 'var(--accent)', color: 'var(--bg-primary)' }}
              >
                Add task
                <span className="hidden text-[11px] font-medium opacity-70 sm:inline" aria-hidden="true">↵</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
