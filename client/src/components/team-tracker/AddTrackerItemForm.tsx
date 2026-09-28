import { useMemo, useState } from 'react';
import { Link, Plus, Search, X } from 'lucide-react';
import { JiraIssueLink } from '@/components/JiraIssueLink';
import { FOCUS_RING } from '@/components/ui/focus';
import { TrackerIssueAssignmentConflictPanel } from './TrackerIssueAssignmentConflictPanel';

interface AddTrackerItemFormProps {
  onAdd: (params: { title: string; jiraKey?: string; note?: string }) => void;
  date: string;
  targetAccountId: string;
  onOpenExistingAssignment: (itemId: number) => void;
  issues?: Array<{
    jiraKey: string;
    summary: string;
    priorityName?: string;
    dueDate?: string;
    developmentDueDate?: string;
  }>;
  isPending?: boolean;
}

export function AddTrackerItemForm({
  onAdd,
  date,
  targetAccountId,
  onOpenExistingAssignment,
  issues,
  isPending,
}: AddTrackerItemFormProps) {
  const [open, setOpen] = useState(false);
  const isOpen = open;
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [jiraSearch, setJiraSearch] = useState('');
  const [jiraPickerOpen, setJiraPickerOpen] = useState(false);
  const [selectedIssue, setSelectedIssue] = useState<{
    jiraKey: string;
    summary: string;
  } | null>(null);

  const filteredIssues = useMemo(
    () =>
      issues
        ?.filter(
          (issue) =>
            issue.jiraKey.toLowerCase().includes(jiraSearch.toLowerCase()) ||
            issue.summary.toLowerCase().includes(jiraSearch.toLowerCase())
        )
        .slice(0, 8) ?? [],
    [issues, jiraSearch]
  );

  const resetForm = () => {
    setOpen(false);
    setTitle('');
    setNote('');
    setJiraSearch('');
    setJiraPickerOpen(false);
    setSelectedIssue(null);
  };

  const handleSubmit = () => {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      return;
    }

    onAdd({
      title: trimmedTitle,
      jiraKey: selectedIssue?.jiraKey,
      note: note.trim() || undefined,
    });
    resetForm();
  };

  const handleOpenExistingAssignment = (itemId: number) => {
    resetForm();
    onOpenExistingAssignment(itemId);
  };

  if (!isOpen) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-task-shortcut="n"
        title="Add a planned task (A)"
        className={`flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-[13px] transition-colors hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-secondary)] ${FOCUS_RING}`}
        style={{ color: 'var(--text-muted)' }}
      >
        <span className="flex h-5 w-5 shrink-0 items-center justify-center">
          <Plus size={14} />
        </span>
        Add task
      </button>
    );
  }

  return (
    <div
      className="space-y-3 rounded-xl p-3"
      style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', boxShadow: 'var(--soft-shadow)' }}
    >
      <div>
        <label htmlFor={`tracker-add-title-${targetAccountId}`} className="mb-1 block text-[12px] font-medium" style={{ color: 'var(--text-muted)' }}>
          Task
        </label>
        <input
          id={`tracker-add-title-${targetAccountId}`}
          type="text"
          autoFocus
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              handleSubmit();
            }
            if (event.key === 'Escape') {
              event.stopPropagation();
              resetForm();
            }
          }}
          placeholder="Describe the work in one line"
          className={`w-full rounded-lg px-2.5 py-2 text-[13px] ${FOCUS_RING}`}
          style={{
            background: 'var(--bg-primary)',
            color: 'var(--text-primary)',
            border: '1px solid var(--border)',
          }}
        />
      </div>

      <div>
        <div className="flex items-center justify-between gap-2">
          <div className="text-[12px] font-medium" style={{ color: 'var(--text-muted)' }}>
            Linked Jira
          </div>
          <button
            type="button"
            onClick={() => setJiraPickerOpen((current) => !current)}
            className={`rounded-md px-2 py-0.5 text-[12px] font-medium transition-colors hover:bg-[var(--accent-glow)] ${FOCUS_RING}`}
            style={{ color: 'var(--accent)' }}
            aria-expanded={jiraPickerOpen}
          >
            {selectedIssue ? 'Change Jira' : 'Attach Jira'}
          </button>
        </div>

        {selectedIssue && (
          <div className="mt-1.5 space-y-1.5">
            <div
              className="flex items-start justify-between gap-2 rounded-lg px-2.5 py-2"
              style={{ background: 'var(--bg-primary)', border: '1px solid var(--border)' }}
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Link size={10} style={{ color: 'var(--accent)' }} />
                  <JiraIssueLink issueKey={selectedIssue.jiraKey} className="font-mono text-[12px] font-semibold" style={{ color: 'var(--accent)' }}>
                    {selectedIssue.jiraKey}
                  </JiraIssueLink>
                </div>
                <div className="text-[12px] mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                  {selectedIssue.summary}
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setSelectedIssue(null);
                  setJiraSearch('');
                }}
                className="h-6 w-6 rounded-md flex items-center justify-center"
                style={{ color: 'var(--text-muted)', background: 'var(--bg-elevated)' }}
                aria-label="Remove linked Jira"
              >
                <X size={10} />
              </button>
            </div>
            <TrackerIssueAssignmentConflictPanel
              jiraKey={selectedIssue.jiraKey}
              date={date}
              targetAccountId={targetAccountId}
              onOpenAssignment={handleOpenExistingAssignment}
            />
          </div>
        )}

        {jiraPickerOpen && (
          <div className="mt-1.5 space-y-1.5">
            <div className="relative">
              <Search
                size={12}
                className="absolute left-2.5 top-1/2 -translate-y-1/2"
                style={{ color: 'var(--text-muted)' }}
              />
              <input
                type="text"
                value={jiraSearch}
                onChange={(event) => setJiraSearch(event.target.value)}
                placeholder="Search Jira issues"
                className={`w-full rounded-lg py-2 pl-8 pr-3 text-[13px] ${FOCUS_RING}`}
                style={{
                  background: 'var(--bg-primary)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border)',
                }}
              />
            </div>

            {jiraSearch && filteredIssues.length > 0 && (
              <div
                className="rounded-lg overflow-hidden max-h-[160px] overflow-y-auto"
                style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}
              >
                {filteredIssues.map((issue) => (
                  <div
                    key={issue.jiraKey}
                    className="px-2.5 py-2 transition-colors hover:bg-[var(--bg-tertiary)]"
                    style={{ borderBottom: '1px solid var(--border)' }}
                  >
                    <div className="flex items-center gap-2">
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
                        }}
                        className="min-w-0 flex-1 truncate text-left text-[12px]"
                        style={{ color: 'var(--text-secondary)' }}
                      >
                        {issue.summary}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div>
        <label htmlFor={`tracker-add-note-${targetAccountId}`} className="mb-1 block text-[12px] font-medium" style={{ color: 'var(--text-muted)' }}>
          Note
        </label>
        <textarea
          id={`tracker-add-note-${targetAccountId}`}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          rows={2}
          placeholder="Optional context or handoff detail"
          className={`w-full resize-none rounded-lg px-2.5 py-2 text-[12.5px] ${FOCUS_RING}`}
          style={{
            background: 'var(--bg-primary)',
            color: 'var(--text-primary)',
            border: '1px solid var(--border)',
          }}
        />
      </div>

      <div className="flex items-center justify-end gap-1.5">
        <button
          type="button"
          onClick={resetForm}
          className={`h-7 rounded-lg px-2.5 text-[12px] font-medium transition-colors hover:bg-[var(--bg-tertiary)] ${FOCUS_RING}`}
          style={{ color: 'var(--text-secondary)' }}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!title.trim() || isPending}
          className={`flex h-7 items-center gap-1 rounded-lg px-2.5 text-[12px] font-semibold transition-opacity disabled:opacity-40 ${FOCUS_RING}`}
          style={{ background: 'var(--accent-glow)', color: 'var(--accent)' }}
        >
          <Plus size={12} />
          Add task
        </button>
      </div>
    </div>
  );
}
