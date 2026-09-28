import { useEffect, useState, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import { useIssueDetail } from '@/hooks/useIssueDetail';
import { useUpdateIssue } from '@/hooks/useUpdateIssue';
import { useDevelopers } from '@/hooks/useDevelopers';
import { useAddTrackerItem } from '@/hooks/useTeamTrackerMutations';
import { useTrackerIssueAssignments } from '@/hooks/useTeamTracker';
import { useConfig } from '@/hooks/useConfig';
import { useIssueTagActions } from '@/hooks/useIssueTagActions';
import { useTriageNotes } from '@/hooks/useTriageNotes';
import { useToast } from '@/context/ToastContext';
import { TriagePanelHeader } from './TriagePanelHeader';
import { TriageQuickActions } from './TriageQuickActions';
import { TriageNotesEditor } from './TriageNotesEditor';
import { TriageTagBar } from './TriageTagBar';
import { TriageProperties } from './TriageProperties';
import { TriageTrackerSection } from './TriageTrackerSection';
import { TriageDeskSection } from './TriageDeskSection';
import { SuggestionBar } from './SuggestionBar';
import { CommentForm } from './CommentForm';
import { ManagerDeskCaptureDialog } from '@/components/manager-desk/ManagerDeskCaptureDialog';
import { formatIssueDescription } from '@/lib/issue-description';
import { getLocalIsoDate } from '@/lib/utils';

interface TriagePanelProps {
  issueKey?: string;
  onClose: () => void;
  onOpenManagerDesk?: () => void;
}

export function TriagePanel({ issueKey, onClose, onOpenManagerDesk }: TriagePanelProps) {
  const { data: issue, isLoading } = useIssueDetail(issueKey);
  const { data: config } = useConfig();
  const trackerDate = getLocalIsoDate();
  const { data: developers } = useDevelopers(trackerDate, { includeUnavailable: true });
  const addTrackerItem = useAddTrackerItem(trackerDate);
  const trackerAssignments = useTrackerIssueAssignments(issue?.jiraKey, trackerDate);
  const tagActions = useIssueTagActions({ issueKey: issue?.jiraKey, localTags: issue?.localTags ?? [] });
  const updateIssue = useUpdateIssue();
  const { addToast } = useToast();
  const notes = useTriageNotes(issue?.jiraKey, issue?.analysisNotes);
  const [editingField, setEditingField] = useState<string | null>(null);
  const [deskCaptureOpen, setDeskCaptureOpen] = useState(false);
  const description = useMemo(() => formatIssueDescription(issue?.description), [issue?.description]);
  const assignments = trackerAssignments.data ?? [];
  const availableDevelopers = useMemo(
    () => developers?.filter((developer) => developer.availability?.state !== 'inactive'),
    [developers]
  );

  useEffect(() => {
    if (!issueKey) return;
    const handler = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT') return;
      switch (e.key) {
        case 'Escape': onClose(); break;
        case 'a': e.preventDefault(); setEditingField('assignee'); break;
        case 'p': e.preventDefault(); setEditingField('priority'); break;
        case 'd': e.preventDefault(); setEditingField('dueDate'); break;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose, issueKey]);

  const handleUpdate = useCallback((key: string, update: Record<string, unknown>) => {
    updateIssue.mutate(
      { key, update },
      {
        onError: (err) => {
          addToast({
            type: 'error',
            title: `Failed to update ${key}`,
            message: err.message,
            action: { label: 'Retry', onClick: () => handleUpdate(key, update) },
          });
        },
      },
    );
  }, [updateIssue, addToast]);

  const handleAddToTracker = useCallback((accountId: string, title: string) => {
    if (!issue) return;
    addTrackerItem.mutate(
      { accountId, jiraKey: issue.jiraKey, title },
      {
        onSuccess: () => {
          const dev = developers?.find((d) => d.accountId === accountId);
          addToast({ type: 'success', title: `${issue.jiraKey} added to ${dev?.displayName ?? 'plan'}`, message: `Tracker updated for ${trackerDate}.` });
        },
        onError: (err) => addToast({ type: 'error', title: `Failed to add to Team Tracker`, message: err.message }),
      },
    );
  }, [addToast, addTrackerItem, developers, issue, trackerDate]);

  return (
    <AnimatePresence>
      {issueKey && (
        <motion.div
          key="triage-panel"
          initial={{ x: '100%', opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: '100%', opacity: 0 }}
          transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
          className="w-full sm:w-[680px] sm:min-w-[680px] lg:w-[780px] lg:min-w-[780px] max-w-full h-full flex flex-col"
          style={{
            background: 'var(--bg-secondary)',
            borderLeft: '1px solid var(--border)',
            boxShadow: '-8px 0 32px rgba(0,0,0,0.22), -2px 0 8px rgba(0,0,0,0.08)',
          }}
        >
          <TriagePanelHeader issue={issue} jiraBaseUrl={config?.jiraBaseUrl} onClose={onClose} />

          {isLoading ? (
            <PanelSkeleton />
          ) : issue ? (
            <div className="flex-1 overflow-y-auto">
              <div className="px-5 pt-4 pb-1 triage-reveal triage-reveal-1">
                <h2 className="text-[16px] font-semibold leading-snug" style={{ color: 'var(--text-primary)' }}>
                  {issue.summary}
                </h2>
              </div>

              <div className="triage-reveal triage-reveal-2">
                <TriageQuickActions issue={issue} developers={developers} editingField={editingField} onEditField={setEditingField} onUpdate={handleUpdate} />
              </div>

              <TriageNotesEditor value={notes.notesValue} onChange={notes.handleChange} onBlurSave={notes.handleBlurSave} isSaved={notes.notesSaved} />
              <TriageTagBar tags={issue.localTags} allTags={tagActions.allTags} assignedTagIds={tagActions.assignedTagIds} isPending={tagActions.isPending} onToggle={tagActions.toggleTag} onCreate={tagActions.createOrAssignTag} />
              {availableDevelopers && (
                <TriageTrackerSection
                  issueKey={issue.jiraKey} issueAssigneeId={issue.assigneeId} developers={availableDevelopers}
                  assignments={assignments} trackerDate={trackerDate}
                  firstLinkedAccountId={assignments[0]?.developer.accountId}
                  onAdd={handleAddToTracker} isAdding={addTrackerItem.isPending}
                />
              )}
              <TriageProperties issue={issue} jiraAspenSeverityField={config?.jiraAspenSeverityField} />
              <SuggestionBar issue={issue} />

              <TriageDeskSection issue={issue} onCapture={() => setDeskCaptureOpen(true)} />
              {description && <DescriptionSection content={description} />}

              <div className="triage-section">
                <span className="triage-section-label mb-2 block">Comment</span>
                <CommentForm issueKey={issue.jiraKey} />
              </div>
            </div>
          ) : null}
        </motion.div>
      )}
      {deskCaptureOpen && issue && (
        <ManagerDeskCaptureDialog
          onClose={() => setDeskCaptureOpen(false)}
          onOpenManagerDesk={onOpenManagerDesk}
          heading="Add Issue Follow-Up"
          description="Capture a manager task from the current Jira issue without leaving triage."
          initialTitle={issue.summary}
          initialCategory="analysis"
          initialContextNote={issue.analysisNotes?.trim() ? issue.analysisNotes : undefined}
          initialLinks={[{ linkType: 'issue', issueKey: issue.jiraKey }]}
          contextChips={[
            { label: 'Issue', value: issue.jiraKey, tone: 'issue' },
            ...(issue.assigneeName ? [{ label: 'Owner', value: issue.assigneeName, tone: 'developer' as const }] : []),
          ]}
        />
      )}
    </AnimatePresence>
  );
}

function PanelSkeleton() {
  return (
    <div className="p-5 flex flex-col gap-3">
      {[92, 78, 60, 45, 70].map((w, i) => (
        <div key={i} className="h-4 rounded-md animate-pulse" style={{ background: 'var(--bg-tertiary)', width: `${w}%` }} />
      ))}
    </div>
  );
}

function DescriptionSection({ content }: { content: string }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="triage-section">
      <button type="button" onClick={() => setExpanded((p) => !p)} className="triage-section-label flex items-center gap-1 mb-1.5">
        Description
        <span className="text-[11px] ml-0.5" style={{ color: 'var(--text-muted)' }}>{expanded ? '▾' : '▸'}</span>
      </button>
      <div
        className={`text-[13px] leading-relaxed prose prose-sm max-w-none ${expanded ? '' : 'line-clamp-2 cursor-pointer'}`}
        onClick={() => !expanded && setExpanded(true)}
        style={{ color: expanded ? 'var(--text-secondary)' : 'var(--text-muted)' }}
      >
        <ReactMarkdown>{content}</ReactMarkdown>
      </div>
    </div>
  );
}
