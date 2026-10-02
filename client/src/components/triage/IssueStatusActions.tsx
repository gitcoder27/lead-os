import { useState } from 'react';
import { TaskPopover, MenuItem } from '@/components/ui/Popover';
import { useIssueTransitions, useJiraExecution } from '@/hooks/useJiraExecution';
import { useToast } from '@/context/ToastContext';
import type { Issue } from '@/types';

export function IssueStatusActions({ issue }: { issue: Issue }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const query = useIssueTransitions(issue.jiraKey, Boolean(anchor));
  const { transition } = useJiraExecution();
  const { addToast } = useToast();
  const apply = async (transitionId: string) => {
    if (!query.data || transition.isPending) return;
    setError(null);
    try {
      const result = await transition.mutateAsync({
        key: issue.jiraKey,
        transitionId,
        expectedStatus: query.data.currentStatus,
      });
      const trigger = anchor;
      setAnchor(null);
      requestAnimationFrame(() => { if (trigger && document.contains(trigger)) trigger.focus(); });
      addToast({
        type: 'success',
        title: `${issue.jiraKey} → ${result.issue.statusName}`,
        ...(result.refreshPending && { message: 'Changed in Jira; status refresh is pending.' }),
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Refresh the issue and retry.');
    }
  };
  return (
    <div className="work-status-actions px-5 pb-3">
      <button
        type="button"
        className="ui-btn-secondary"
        aria-haspopup="menu"
        aria-expanded={Boolean(anchor)}
        onClick={(event) => setAnchor(anchor ? null : event.currentTarget)}
      >
        Change Jira status
      </button>
      {anchor && (
        <TaskPopover
          className="work-execution-menu"
          anchor={anchor}
          role="menu"
          label={`Status transitions for ${issue.jiraKey}`}
          width={320}
          onClose={() => setAnchor(null)}
        >
          {query.isPending ? (
            <p role="status" className="p-3">
              Loading allowed transitions…
            </p>
          ) : query.isError ? (
            <div className="p-3" role="alert">
              <p>Couldn't load Jira transitions.</p>
              <button type="button" className="ui-btn-ghost" onClick={() => void query.refetch()}>
                Retry
              </button>
            </div>
          ) : (
            <>
              <p className="px-3 py-2 text-[13px]">Current Jira status: {query.data?.currentStatus.name}</p>
              {query.data?.transitions.length ? (
                query.data.transitions.map((item) => (
                  <MenuItem
                    key={item.id}
                    label={`${item.name} → ${item.to.name}`}
                    disabled={!item.supported || transition.isPending}
                    onSelect={() => void apply(item.id)}
                  />
                ))
              ) : (
                <p className="p-3">No transitions available.</p>
              )}
              {query.data?.transitions.some((item) => !item.supported) && (
                <p className="p-3 text-[12px]">Transitions that need a form must be completed in Jira.</p>
              )}
              <button
                type="button"
                className="ui-btn-ghost mx-3 mb-2"
                disabled={transition.isPending}
                onClick={() => void query.refetch()}
              >
                Refresh transitions
              </button>
            </>
          )}
          {error && (
            <p role="alert" className="p-3 text-[13px]">
              {error}
            </p>
          )}
        </TaskPopover>
      )}
    </div>
  );
}
