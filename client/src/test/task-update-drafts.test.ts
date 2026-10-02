import { describe, expect, it } from 'vitest';
import { clearTaskUpdateDraftsForScope, clearTaskUpdateDraftsForTask, completeTaskUpdateDraft, newTaskUpdateDraft, readTaskUpdateDraft, taskDraftGeneration, taskUpdateDraftPrefix, taskUpdateDrafts, writeTaskUpdateDraft } from '@/lib/task-update-drafts';

describe('private in-memory update drafts', () => {
  it('isolates scopes and rejects late writes/completions after logout, including re-login to the same scope', () => {
    const scope = 'workspace:user:manager:';
    const prefix = taskUpdateDraftPrefix(scope, 'manager', 'task_drawer');
    const key = `${prefix}T-1`; const generation = taskDraftGeneration(scope, key);
    const value = { ...newTaskUpdateDraft(), body: 'Private', private: true };
    writeTaskUpdateDraft(scope, key, value, generation);
    expect(taskUpdateDrafts(prefix)).toHaveLength(1);
    expect(taskUpdateDrafts(taskUpdateDraftPrefix('other:user:manager:', 'manager', 'task_drawer'))).toHaveLength(0);
    clearTaskUpdateDraftsForScope(scope);
    writeTaskUpdateDraft(scope, key, value, generation);
    expect(completeTaskUpdateDraft(scope, key, value, generation)).toBe(false);
    expect(readTaskUpdateDraft(key).body).toBe('');
    const fresh = { ...newTaskUpdateDraft(), body: 'Fresh' };
    writeTaskUpdateDraft(scope, key, fresh, taskDraftGeneration(scope, key));
    completeTaskUpdateDraft(scope, key, value, generation);
    expect(readTaskUpdateDraft(key).body).toBe('Fresh');
    clearTaskUpdateDraftsForScope(scope);
  });

  it('clears all contexts for a task after confirmed deletion/access loss, refusing late recreation', () => {
    const scope = 'lost:user:manager:';
    const key = `${taskUpdateDraftPrefix(scope, 'manager', 'standup')}T-1`;
    const other = `${taskUpdateDraftPrefix(scope, 'manager', 'task_drawer')}T-1`;
    const value = { ...newTaskUpdateDraft(), body: 'Draft' };
    const generation = taskDraftGeneration(scope, key);
    writeTaskUpdateDraft(scope, key, value, generation);
    writeTaskUpdateDraft(scope, other, value, taskDraftGeneration(scope, other));
    clearTaskUpdateDraftsForTask(scope, 'T-1');
    writeTaskUpdateDraft(scope, key, value, generation);
    expect(readTaskUpdateDraft(key).body).toBe('');
    expect(readTaskUpdateDraft(other).body).toBe('');
    expect(completeTaskUpdateDraft(scope, key, value, generation)).toBe(false);
  });

  it('never persists anonymous drafts or writes browser storage', () => {
    const key = `${taskUpdateDraftPrefix('anonymous', 'manager')}T-1`;
    const beforeLocal = localStorage.length; const beforeSession = sessionStorage.length;
    writeTaskUpdateDraft('anonymous', key, { ...newTaskUpdateDraft(), body: 'Anonymous' }, taskDraftGeneration('anonymous', key));
    expect(readTaskUpdateDraft(key).body).toBe('');
    expect(localStorage.length).toBe(beforeLocal);
    expect(sessionStorage.length).toBe(beforeSession);
  });
});
