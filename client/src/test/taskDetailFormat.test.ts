import { describe, expect, it } from 'vitest';
import { describeOwnPlanDate, describePlanDate } from '@/components/tasks/task-detail-format';
import { taskMetaEntries } from '@/components/tasks/TaskDetailFields';
import type { TaskDetailResponse } from '@/types';

describe('plan dates in the drawer (docs/56 MDA-04)', () => {
  const today = '2026-10-11';

  it('shows an owner their carried work as on today, with where it came from', () => {
    expect(describeOwnPlanDate('2026-09-28', 'active', today)).toEqual({ label: 'Today', hint: 'carried from Mon, Sep 28', tone: 'accent', hintTone: 'muted' });
    expect(describeOwnPlanDate('2026-10-11', 'open', today)).toEqual({ label: 'Today', tone: 'accent' });
    expect(describeOwnPlanDate('2026-10-12', 'open', today)).toEqual({ label: 'Tomorrow', tone: 'default' });
    expect(describeOwnPlanDate('2026-09-28', 'done', today)?.tone).toBe('muted');
  });

  it('keeps the manager view of a slipped plan date', () => {
    expect(describePlanDate('2026-09-28', 'active', today)).toEqual({ label: 'Mon, Sep 28', hint: '13d ago', tone: 'warning' });
  });
});

describe('drawer footer creator (docs/56 MDA-04)', () => {
  const people = (viewer: 'manager' | 'developer') => ({ developers: [], nameFor: () => undefined, userId: 'dev-1', userName: 'Priya', viewer });
  const task = { createdById: 'maya', createdByType: 'manager', createdAt: '2026-10-10T11:37:00.000Z', updatedAt: '2026-10-10T11:37:00.000Z', kind: 'task' } as unknown as TaskDetailResponse;
  it('names the lead for a developer instead of a bare role', () => {
    expect(taskMetaEntries(task, people('developer'))[0]).toEqual(['Created by', 'Your lead']);
    expect(taskMetaEntries(task, people('manager'))[0]).toEqual(['Created by', 'Manager']);
  });
});
