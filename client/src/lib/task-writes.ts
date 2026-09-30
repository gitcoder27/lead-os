import type { QueryClient, QueryFilters, QueryKey } from '@tanstack/react-query';
import { taskGuardFields, type ManagerTask, type TaskExpectedState, type TaskGuardField, type UpdateTaskRequest } from '@/types';

/**
 * docs/61 TS-01 (D1): the shared lifecycle of task writes. Writes that touch the same
 * task run one after another (patch → request → settle) within a QueryClient and auth
 * scope; different tasks go in parallel. Optimistic patches remember which fields they
 * wrote so a failure gives back only those, and only where they still read as written.
 */

/** A write that finished after the signed-in scope changed: nothing to report or patch. */
export class WriteAbandoned extends Error {
  constructor() {
    super('The signed-in scope changed');
    this.name = 'WriteAbandoned';
  }
}

interface Acknowledged {
  task: ManagerTask;
  seq: number;
}

export class TaskWriteCoordinator {
  private readonly tails = new Map<string, Promise<void>>();
  private readonly acknowledged = new Map<string, Acknowledged>();
  private seq = 0;

  /** A marker for "the server state I was clicked on"; see {@link latest}. */
  mark(): number {
    return this.seq;
  }

  /** Runs `work` once every earlier write that shares a task key has settled. */
  run<T>(taskKeys: string[], work: () => Promise<T>): Promise<T> {
    const keys = [...new Set(taskKeys)];
    const earlier = keys.map((key) => this.tails.get(key)).filter((tail): tail is Promise<void> => Boolean(tail));
    const done = earlier.length ? Promise.all(earlier).then(work) : work();
    const settled = done.then(() => undefined, () => undefined);
    for (const key of keys) this.tails.set(key, settled);
    void settled.then(() => {
      for (const key of keys) if (this.tails.get(key) === settled) this.tails.delete(key);
    });
    return done;
  }

  /** Remember what the server said about these tasks, for writes still queued behind this one. */
  acknowledge(tasks: ManagerTask[]): void {
    this.seq += 1;
    for (const task of tasks) this.acknowledged.set(task.taskKey, { task, seq: this.seq });
  }

  /** The server's answer to a write that finished after `since`, if any; the caller's own copy is older than it. */
  latest(taskKey: string, since: number): ManagerTask | undefined {
    const entry = this.acknowledged.get(taskKey);
    return entry && entry.seq > since ? entry.task : undefined;
  }
}

const coordinators = new WeakMap<QueryClient, Map<string, TaskWriteCoordinator>>();

export function taskWrites(qc: QueryClient, scope: string): TaskWriteCoordinator {
  let byScope = coordinators.get(qc);
  if (!byScope) coordinators.set(qc, (byScope = new Map()));
  let coordinator = byScope.get(scope);
  if (!coordinator) byScope.set(scope, (coordinator = new TaskWriteCoordinator()));
  return coordinator;
}

// ── Guards ──────────────────────────────────────────────────────────────────

function guardValue(task: ManagerTask, field: TaskGuardField): unknown {
  switch (field) {
    case 'triaged': return !task.needsTriage;
    case 'waitingOn': return task.waitingOn ? { type: task.waitingOn.type, ref: task.waitingOn.ref, label: task.waitingOn.label } : null;
    default: return (task as unknown as Record<string, unknown>)[field] ?? null;
  }
}

/** The values `task` holds for every field `changes` would overwrite, coupled fields included. */
export function expectedFrom(task: ManagerTask, changes: UpdateTaskRequest): TaskExpectedState {
  const expected: Record<string, unknown> = {};
  for (const field of taskGuardFields(changes)) expected[field] = guardValue(task, field);
  return expected as TaskExpectedState;
}

// ── Field-scoped optimistic patches ─────────────────────────────────────────

export type CachedTaskRow = { taskKey: string } & Record<string, unknown>;
type Row = CachedTaskRow;

/** How a cached query holds tasks: a list response, or a single task's detail. */
export interface CacheShape<TData> {
  rows: (data: TData) => Row[];
  map: (data: TData, update: (row: Row) => Row) => TData;
}

interface FieldPatch {
  queryKey: QueryKey;
  taskKey: string;
  fields: Map<string, { previous: unknown; patched: unknown }>;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * Applies `patches` (task key → next row) to every matching cached query and returns
 * the rollback. Rollback puts back a field only where the cache still holds the value
 * this patch wrote, so newer edits and fresh server data are never overwritten.
 */
export function patchCachedTasks<TData>(
  qc: QueryClient,
  filters: QueryFilters,
  shape: CacheShape<TData>,
  patches: ReadonlyMap<string, (row: Row) => Row>,
): () => void {
  const records: FieldPatch[] = [];
  for (const query of qc.getQueryCache().findAll(filters)) {
    const data = query.state.data as TData | undefined;
    if (data === undefined) continue;
    for (const row of shape.rows(data)) {
      const patch = patches.get(row.taskKey);
      if (!patch) continue;
      const next = patch(row);
      const fields = new Map<string, { previous: unknown; patched: unknown }>();
      for (const field of new Set([...Object.keys(row), ...Object.keys(next)])) {
        if (!same(row[field], next[field])) fields.set(field, { previous: row[field], patched: next[field] });
      }
      if (fields.size) records.push({ queryKey: query.queryKey, taskKey: row.taskKey, fields });
    }
  }
  const write = (record: FieldPatch, pick: (row: Row) => Row) =>
    qc.setQueryData<TData>(record.queryKey, (old) => (old === undefined ? old : shape.map(old, (row) => (row.taskKey === record.taskKey ? pick(row) : row))));
  for (const record of records) {
    write(record, (row) => ({ ...row, ...Object.fromEntries([...record.fields].map(([field, { patched }]) => [field, patched])) }));
  }
  return () => {
    for (const record of records) {
      write(record, (row) => {
        const restored = { ...row };
        for (const [field, { previous, patched }] of record.fields) if (same(row[field], patched)) restored[field] = previous;
        return restored;
      });
    }
  };
}
