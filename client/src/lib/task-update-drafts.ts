/** Private unsent updates live only in this tab's JS memory (docs/61 D3). */
export interface TaskUpdateDraft {
  date?: string;
  person?: { accountId: string; name: string };
  body: string;
  type: 'update' | 'instruction' | 'decision' | 'blocker';
  blockerAction: 'raised' | 'cleared';
  private: boolean;
  requestId: string;
  submitted: boolean;
  revision: number;
}

const drafts = new Map<string, TaskUpdateDraft>();
const generations = new Map<string, number>();
const taskGenerations = new Map<string, number>();
export const taskDraftGeneration = (scope: string, key: string) => {
  if (!taskGenerations.has(key)) taskGenerations.set(key, 0);
  return `${generations.get(scope) ?? 0}:${taskGenerations.get(key)}`;
};
export const newTaskUpdateDraft = (): TaskUpdateDraft => ({ body: '', type: 'update', blockerAction: 'raised', private: false, requestId: crypto.randomUUID(), submitted: false, revision: 0 });
export const taskUpdateDraftPrefix = (scope: string, mode: 'manager' | 'developer', via?: string, date?: string) => `${encodeURIComponent(scope)}|${mode}|${via ?? 'default'}|${mode === 'developer' ? date ?? '' : ''}|`;
export const readTaskUpdateDraft = (key: string) => drafts.get(key) ?? newTaskUpdateDraft();
const notify = () => window.dispatchEvent(new Event('task-update-drafts-changed'));

export function writeTaskUpdateDraft(scope: string, key: string, value: TaskUpdateDraft, generation: string) {
  if (scope === 'anonymous' || generation !== taskDraftGeneration(scope, key)) return;
  if (value.body.trim()) drafts.set(key, value);
  else drafts.delete(key);
  notify();
}

/** Completion never erases a newer revision, even after the submitting composer unmounts. */
export function completeTaskUpdateDraft(scope: string, key: string, submitted: TaskUpdateDraft, generation: string) {
  if (generation !== taskDraftGeneration(scope, key)) return false;
  const current = drafts.get(key);
  if (current?.revision === submitted.revision && current.requestId === submitted.requestId) drafts.delete(key);
  window.dispatchEvent(new CustomEvent('task-update-saved', { detail: key }));
  notify();
  return true;
}

export function taskUpdateDrafts(prefix: string) {
  return [...drafts].filter(([key]) => key.startsWith(prefix)).map(([key, value]) => ({ taskKey: key.slice(prefix.length), person: value.person }));
}

export function clearTaskUpdateDraftsForScope(scope: string) {
  generations.set(scope, (generations.get(scope) ?? 0) + 1);
  for (const key of drafts.keys()) if (key.startsWith(`${encodeURIComponent(scope)}|`)) drafts.delete(key);
  for (const key of taskGenerations.keys()) if (key.startsWith(`${encodeURIComponent(scope)}|`)) taskGenerations.delete(key);
  notify();
}

export function clearTaskUpdateDraftsForTask(scope: string, taskKey: string) {
  for (const [key, epoch] of taskGenerations) if (key.startsWith(`${encodeURIComponent(scope)}|`) && key.endsWith(`|${taskKey}`)) taskGenerations.set(key, epoch + 1);
  for (const key of drafts.keys()) if (key.startsWith(`${encodeURIComponent(scope)}|`) && key.endsWith(`|${taskKey}`)) drafts.delete(key);
  notify();
}
