import { describe, expect, it } from 'vitest';
import { describeAgendaTask } from '@/components/team-tracker/one-on-one/oneOnOneFormat';
import type { OneOnOneAgendaTask } from '@/types';

const task = (dueAt: string | null): OneOnOneAgendaTask => ({
  taskId: 1, taskKey: 'T-1', title: 'Topic', status: 'open', scheduledOn: null, dueAt,
} as unknown as OneOnOneAgendaTask);

describe('describeAgendaTask deadline (docs/56 review)', () => {
  it('reads the deadline on its local day, whatever zone the browser is in', () => {
    // A deadline is stored as the end of a local day: a UTC slice reads it as the next day in zones ahead of UTC
    // and the same day elsewhere; the local date is right in all of them.
    const dueAt = new Date(2026, 2, 10, 23, 59, 59, 999).toISOString();
    expect(describeAgendaTask(task(dueAt), '2026-03-10').date?.label).toBe('Due today');
    expect(describeAgendaTask(task(dueAt), '2026-03-09').date?.label).toBe('Due tomorrow');
    expect(describeAgendaTask(task(dueAt), '2026-03-11').date?.tone).toBe('danger');
  });
});
