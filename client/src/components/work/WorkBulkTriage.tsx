import { useState } from 'react';
import { Dialog } from '@/components/ui/Dialog';
import { useDevelopers } from '@/hooks/useDevelopers';
import { useJiraExecution } from '@/hooks/useJiraExecution';
import { ISSUE_BULK_LIMIT, type Issue, type IssueBulkItem, type IssueBulkResult, type IssueOperation } from '@/types';
import { getLocalIsoDate, shiftLocalIsoDate } from '@/lib/utils';
import { PRIORITY_OPTIONS } from '@/lib/constants';

export function WorkBulkTriage({
  issues,
  onClose,
  onApplied,
  onOpen,
}: {
  issues: Issue[];
  onClose: () => void;
  onApplied: (keys: string[]) => void;
  onOpen: (key: string) => void;
}) {
  // This is the exact selection being reviewed; later query refreshes cannot change its targets.
  const [targets] = useState(issues);
  const [action, setAction] = useState('flag');
  const [value, setValue] = useState('High');
  const [date, setDate] = useState(shiftLocalIsoDate(getLocalIsoDate(), 1));
  const [submitted, setSubmitted] = useState<IssueBulkItem[] | null>(null);
  const [results, setResults] = useState<IssueBulkResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const { data: developers } = useDevelopers(undefined, { enabled: action === 'assign' });
  const { bulk } = useJiraExecution();
  const items = (): IssueBulkItem[] =>
    targets.map((issue) => {
      let operation: IssueOperation;
      switch (action) {
        case 'assign':
          operation = { kind: 'update', update: { assigneeId: value } };
          break;
        case 'unassign':
          operation = { kind: 'update', update: { assigneeId: null } };
          break;
        case 'priority':
          operation = { kind: 'update', update: { priorityName: value } };
          break;
        case 'date':
          operation = { kind: 'update', update: { developmentDueDate: date } };
          break;
        case 'clearDate':
          operation = { kind: 'update', update: { developmentDueDate: null } };
          break;
        case 'exclude':
          operation = { kind: 'exclude' };
          break;
        case 'restore':
          operation = { kind: 'restore' };
          break;
        case 'snooze':
          operation = { kind: 'snooze', until: new Date(`${date}T00:00:00`).toISOString() };
          break;
        case 'new':
        case 'indeterminate':
        case 'done':
          operation = {
            kind: 'transitionTo',
            category: action,
            expectedStatus: { name: issue.statusName, category: issue.statusCategory },
          };
          break;
        default:
          operation = { kind: 'update', update: { flagged: action === 'flag' } };
      }
      return { key: issue.jiraKey, operation };
    });
  const apply = async (batch: IssueBulkItem[]) => {
    if (bulk.isPending) return;
    setError(null);
    setSubmitted(batch);
    try {
      const response = await bulk.mutateAsync(batch);
      setResults((previous) => {
        const next = new Map(previous.map((row) => [row.key, row]));
        for (const row of response.results) next.set(row.key, row);
        return targets.flatMap((issue) => (next.has(issue.jiraKey) ? [next.get(issue.jiraKey)!] : []));
      });
      onApplied(response.results.filter((row) => row.ok).map((row) => row.key));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't read the results. Refresh before retrying.");
    }
  };
  const failed = results.filter((row) => !row.ok);
  const pending = bulk.isPending;
  const valid =
    targets.length > 0 &&
    targets.length <= ISSUE_BULK_LIMIT &&
    (action !== 'assign' || Boolean(value)) &&
    (!['date', 'snooze'].includes(action) || Boolean(date)) &&
    (action !== 'snooze' || date > getLocalIsoDate());
  return (
    <Dialog
      title={`Update ${targets.length} defect${targets.length === 1 ? '' : 's'}`}
      onClose={pending ? () => {} : onClose}
      size="md"
    >
      <p className="text-[13px] mb-4">
        Review these targets before applying. Jira writes are checked separately for each issue.
      </p>
      {!submitted && (
        <>
          <label className="block text-[13px] mb-3">
            Action
            <select
              data-autofocus
              className="ui-input w-full mt-1"
              value={action}
              onChange={(event) => {
                setAction(event.target.value);
                setValue(event.target.value === 'priority' ? 'High' : '');
              }}
            >
              <option value="flag">Mark blocked</option>
              <option value="unflag">Clear blocked flag</option>
              <option value="assign">Assign</option>
              <option value="unassign">Unassign</option>
              <option value="priority">Set priority</option>
              <option value="date">Set due date</option>
              <option value="clearDate">Clear due date</option>
              <option value="new">Move to To do</option>
              <option value="indeterminate">Move to In progress</option>
              <option value="done">Move to Done</option>
              <option value="snooze">Snooze until</option>
              <option value="exclude">Exclude</option>
              <option value="restore">Restore</option>
            </select>
          </label>
          {action === 'assign' && (
            <label className="block text-[13px] mb-3">
              Assignee
              <select className="ui-input w-full mt-1" value={value} onChange={(event) => setValue(event.target.value)}>
                <option value="">Choose a Jira-linked person</option>
                {developers
                  ?.filter((person) => person.jiraAccountId || person.source !== 'manual')
                  .map((person) => (
                    <option key={person.accountId} value={person.jiraAccountId ?? person.accountId}>
                      {person.displayName}
                    </option>
                  ))}
              </select>
            </label>
          )}
          {action === 'priority' && (
            <label className="block text-[13px] mb-3">
              Priority
              <select className="ui-input w-full mt-1" value={value} onChange={(event) => setValue(event.target.value)}>
                {PRIORITY_OPTIONS.map((priority) => (
                  <option key={priority}>{priority}</option>
                ))}
              </select>
            </label>
          )}
          {['date', 'snooze'].includes(action) && (
            <label className="block text-[13px] mb-3">
              {action === 'snooze' ? 'Return on' : 'Due date'}
              <input
                type="date"
                className="ui-input mt-1 block"
                value={date}
                min={action === 'snooze' ? shiftLocalIsoDate(getLocalIsoDate(), 1) : undefined}
                onChange={(event) => setDate(event.target.value)}
              />
            </label>
          )}
          {['new', 'indeterminate', 'done'].includes(action) && (
            <p className="text-[13px] mb-3">
              Only one available transition to that category can be applied. Issues needing a form or a choice of
              transitions will stay unchanged.
            </p>
          )}
        </>
      )}
      <ul className="work-bulk-targets">
        {targets.map((issue) => {
          const result = results.find((row) => row.key === issue.jiraKey);
          return (
            <li key={issue.jiraKey}>
              <strong>{issue.jiraKey}</strong>
              <span>{issue.summary}</span>
              {result && (
                <span role={result.ok ? 'status' : 'alert'}>
                  {result.ok ? (result.refreshPending ? 'Applied · status refresh pending' : 'Applied') : result.error}
                </span>
              )}
              <button
                type="button"
                className="ui-btn-ghost"
                disabled={pending}
                onClick={() => {
                  onClose();
                  onOpen(issue.jiraKey);
                }}
              >
                Open issue
              </button>
            </li>
          );
        })}
      </ul>
      {error && (
        <p role="alert" className="my-3 text-[13px]">
          {error}
        </p>
      )}
      <div className="work-bulk-actions flex flex-wrap justify-end gap-2 mt-4">
        <button type="button" className="ui-btn-secondary" disabled={pending} onClick={onClose}>
          {results.length ? 'Close' : 'Cancel'}
        </button>
        {!submitted && (
          <button
            type="button"
            className="ui-btn-primary"
            disabled={pending || !valid}
            onClick={() => void apply(items())}
          >
            Apply to {targets.length} defects
          </button>
        )}
        {failed.length > 0 && (
          <button
            type="button"
            className="ui-btn-primary"
            disabled={pending}
            onClick={() => void apply(submitted!.filter((item) => failed.some((row) => row.key === item.key)))}
          >
            Retry {failed.length} failed
          </button>
        )}
        {error && submitted && !results.length && (
          <button
            type="button"
            className="ui-btn-secondary"
            disabled={pending}
            onClick={() => {
              setSubmitted(null);
              setError(null);
            }}
          >
            Review targets again
          </button>
        )}
        {pending && <span role="status">Applying…</span>}
      </div>
    </Dialog>
  );
}
