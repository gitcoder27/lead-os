import { taskLabelDisplayName } from '@/types';

type Names = Map<string, string>;
export interface ActionPreviewRow {
  label: string;
  value: string;
  before?: string;
}
const labels: Record<string, string> = {
  ownerId: 'Owner',
  ownerType: 'Owner role',
  toAccountId: 'New owner',
  accountId: 'Person',
  developerAccountId: 'Person',
  assigneeId: 'Assignee',
  priorityName: 'Priority',
  scheduledOn: 'Plan date',
  dueAt: 'Deadline',
  dueDate: 'Due date',
  developmentDueDate: 'Development due date',
  followUpAt: 'Check again',
  hideUntil: 'Return on',
  nextAction: 'Next action',
  parentId: 'Parent task',
  startsAt: 'Starts',
  endsAt: 'Ends',
  flagged: 'Blocked',
  analysisNotes: 'Analysis notes',
  body: 'Message',
  text: 'Text',
  toDate: 'Move to',
  fromDate: 'From',
  replyTo: 'Reply to update',
  tagIds: 'Tags',
  alertIds: 'Alerts',
  jiraKey: 'Jira issue',
  taskKey: 'Task',
  itemId: 'Item',
  trackerItemId: 'Team item',
  managerDeskItemId: 'Desk item',
};
const words: Record<string, string> = {
  indeterminate: 'In progress',
  new: 'To do',
  done: 'Done',
  active: 'In progress',
  dropped: 'Dropped',
  normal: 'Normal',
  high: 'High',
  manager: 'Manager',
  developer: 'Developer',
  private: 'Only you',
  shared: 'Shared with the task owner',
  on_track: 'On track',
  at_risk: 'At risk',
  done_for_today: 'Done for today',
};
const personFields = new Set(['ownerId', 'toAccountId', 'accountId', 'developerAccountId', 'assigneeId']);
function label(key: string) {
  return (
    labels[key] ??
    key
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replaceAll('_', ' ')
      .replace(/^./, (c) => c.toUpperCase())
  );
}
function valueText(value: unknown, key: string, names: Names): string {
  if (value === null || value === '') return personFields.has(key) ? 'Unassigned' : 'Clear';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value))
    return value.length ? value.map((v) => valueText(v, key === 'labels' ? 'label' : key, names)).join(' · ') : 'Clear';
  if (typeof value === 'object' && value) {
    const v = value as Record<string, unknown>;
    if (v.type === 'contact' && v.ref != null)
      return names.get(`contact:${String(v.ref)}`) ?? `Contact ${String(v.ref)}`;
    if (v.type === 'developer' && v.ref != null) return names.get(String(v.ref)) ?? `Person ${String(v.ref)}`;
    if (typeof v.label === 'string') return v.label;
    if (typeof v.displayName === 'string') return v.displayName;
    return Object.entries(v)
      .map(([k, item]) => `${label(k)}: ${valueText(item, k, names)}`)
      .join(' · ');
  }
  const text = String(value);
  if (key === 'participants' && text.startsWith('[')) {
    try {
      const people: unknown = JSON.parse(text);
      if (Array.isArray(people)) return valueText(people, key, names);
    } catch {
      /* literal names remain readable */
    }
  }
  if (personFields.has(key) || key === 'participants') return names.get(text) ?? text;
  if (key === 'label') return taskLabelDisplayName(text);
  if (
    ['status', 'statusCategory', 'priority', 'ownerType', 'visibility', 'kind', 'action', 'view', 'preset'].includes(
      key,
    )
  )
    return words[text] ?? text.replaceAll('_', ' ');
  if (
    /^(scheduledOn|dueAt|dueDate|developmentDueDate|followUpAt|hideUntil|startsAt|endsAt|date|toDate|fromDate)$/.test(
      key,
    ) &&
    /^\d{4}-\d{2}-\d{2}/.test(text)
  ) {
    const date = new Date(text.length === 10 ? `${text}T12:00:00` : text);
    if (Number.isFinite(date.getTime()))
      return date.toLocaleString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        ...(text.length > 10 && { hour: 'numeric', minute: '2-digit' }),
      });
  }
  return text;
}

/** Shows the proposed payload, never invents previous values or changes the confirmed arguments. */
export function readableActionPreview(
  args: Record<string, unknown>,
  names: Names = new Map(),
): { target: string | null; rows: ActionPreviewRow[] } {
  const targetArgs =
    args.target && typeof args.target === 'object' && !Array.isArray(args.target)
      ? (args.target as Record<string, unknown>)
      : args;
  const targets = [
    'taskKey',
    'jiraKey',
    'issueKey',
    'developerAccountId',
    'accountId',
    'itemId',
    'trackerItemId',
    'managerDeskItemId',
  ];
  const targetKey = targets.find((key) => targetArgs[key] !== undefined);
  const target = targetKey ? `${label(targetKey)} · ${valueText(targetArgs[targetKey], targetKey, names)}` : null;
  const rows: ActionPreviewRow[] = [];
  const visit = (input: Record<string, unknown>, prefix = '') => {
    for (const [key, value] of Object.entries(input)) {
      if (key === 'target' || (input === args && key === targetKey) || value === undefined) continue;
      if (
        ['update', 'fields', 'patch', 'payload', 'command'].includes(key) &&
        value &&
        typeof value === 'object' &&
        !Array.isArray(value)
      ) {
        visit(value as Record<string, unknown>, prefix);
        continue;
      }
      if (value && typeof value === 'object' && !Array.isArray(value) && 'from' in value && 'to' in value) {
        const change = value as { from: unknown; to: unknown };
        rows.push({
          label: prefix + label(key),
          before: valueText(change.from, key, names),
          value: valueText(change.to, key, names),
        });
      } else rows.push({ label: prefix + label(key), value: valueText(value, key, names) });
    }
  };
  visit(args);
  if (targetArgs !== args)
    for (const [key, value] of Object.entries(targetArgs))
      if (key !== targetKey && !['type', 'view', 'context'].includes(key))
        rows.push({ label: label(key), value: valueText(value, key, names) });
  return { target, rows };
}
