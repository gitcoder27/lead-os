import { describe, expect, it } from 'vitest';
import { buildManagerAttentionSnapshot } from '@/lib/manager-attention';
import type { Issue, ManagerDeskDayResponse, OverviewCounts, TeamTrackerBoardResponse } from '@/types';

const overview: OverviewCounts = {
  new: 1,
  recentlyAssigned: 0,
  unassigned: 2,
  dueToday: 1,
  dueThisWeek: 3,
  noDueDate: 0,
  overdue: 1,
  blocked: 1,
  stale: 1,
  highPriority: 2,
  inProgress: 4,
  reopened: 0,
  total: 8,
};

const issues: Issue[] = [
  {
    jiraKey: 'AM-1',
    summary: 'Checkout outage',
    priorityName: 'Highest',
    priorityId: '1',
    statusName: 'Blocked',
    statusCategory: 'In Progress',
    labels: [],
    dueDate: '2020-01-01',
    flagged: true,
    createdAt: '2020-01-01T00:00:00Z',
    updatedAt: '2020-01-01T00:00:00Z',
    localTags: [],
  },
  {
    jiraKey: 'AM-2',
    summary: 'Needs owner',
    priorityName: 'Medium',
    priorityId: '3',
    statusName: 'To Do',
    statusCategory: 'To Do',
    labels: [],
    flagged: false,
    createdAt: '2020-01-01T00:00:00Z',
    updatedAt: '2020-01-01T00:00:00Z',
    localTags: [],
  },
];

const teamBoard = {
  date: '2026-04-28',
  summary: {
    total: 2,
    stale: 1,
    blocked: 1,
    atRisk: 1,
    waiting: 0,
    noCurrent: 1,
    overdueLinkedWork: 0,
    statusFollowUp: 0,
    doneForToday: 0,
  },
  developers: [
    {
      developer: { accountId: 'dev-1', displayName: 'Taylor Dev', isActive: true },
      plannedItems: [{ id: 10, title: 'Manual rollout note', state: 'planned', position: 0 }],
      completedItems: [],
      droppedItems: [],
    },
  ],
  attentionQueue: [
    {
      developer: { accountId: 'dev-1', displayName: 'Taylor Dev', isActive: true },
      status: 'blocked',
      reasons: [{ code: 'blocked', label: 'Blocked', priority: 1 }],
      isStale: true,
      hasCurrentItem: false,
      plannedCount: 1,
      availableQuickActions: [],
      setCurrentCandidates: [],
    },
  ],
} as unknown as TeamTrackerBoardResponse;

const deskDay = {
  date: '2026-04-28',
  viewMode: 'live',
  summary: {
    totalOpen: 3,
    inbox: 1,
    planned: 1,
    inProgress: 0,
    waiting: 1,
    overdueFollowUps: 1,
    meetings: 1,
    completed: 0,
  },
  items: [
    {
      id: 1,
      dayId: 1,
      originDate: '2026-04-28',
      title: 'Follow up with QA',
      kind: 'action',
      category: 'follow_up',
      status: 'planned',
      priority: 'medium',
      createdAt: '2026-04-28T09:00:00Z',
      updatedAt: '2026-04-28T09:00:00Z',
      links: [],
    },
    {
      id: 2,
      dayId: 1,
      originDate: '2026-04-28',
      title: 'Review design note',
      kind: 'decision',
      category: 'design',
      status: 'inbox',
      priority: 'medium',
      createdAt: '2026-04-28T09:00:00Z',
      updatedAt: '2026-04-28T09:00:00Z',
      links: [],
    },
    {
      id: 3,
      dayId: 1,
      originDate: '2026-04-28',
      title: 'Linked Jira action',
      kind: 'action',
      category: 'analysis',
      status: 'planned',
      priority: 'medium',
      createdAt: '2026-04-28T09:00:00Z',
      updatedAt: '2026-04-28T09:00:00Z',
      links: [{ id: 1, itemId: 3, linkType: 'issue', issueKey: 'AM-1', displayLabel: 'AM-1', createdAt: '2026-04-28T09:00:00Z' }],
    },
  ],
} as ManagerDeskDayResponse;

describe('manager attention aggregation', () => {
  it('builds the manager loop signals from work, team, and desk data', () => {
    const snapshot = buildManagerAttentionSnapshot({
      date: '2026-04-28',
      overview,
      issues,
      teamBoard,
      deskDay,
    });

    expect(snapshot.attentionItems.map((item) => item.id)).toContain('overdue-work');
    expect(snapshot.attentionItems.map((item) => item.id)).toContain('team-attention');
    expect(snapshot.followUpsDue.map((item) => item.title)).toEqual(['Follow up with QA']);
    expect(snapshot.manualWork).toMatchObject({
      deskOpen: 2,
      trackerOpen: 1,
      total: 3,
    });
    expect(snapshot.workMetrics.find((metric) => metric.id === 'manual-work')?.value).toBe(3);
    expect(snapshot.teamMetrics.find((metric) => metric.id === 'blocked')?.value).toBe(1);
    expect(snapshot.standupPrompts.length).toBeGreaterThan(0);
  });
});
