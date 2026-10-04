import { describe, expect, it } from 'vitest';
import { buildWeeklyReport, toHtml, toMarkdown } from '@/lib/weekly-report';
import { reportReview, reportTask } from './fixtures/weekly-review';

describe('weekly report', () => {
  it('formats the docs/59 example with explicit person-risk inclusion and no private bodies or task keys', () => {
    const review = reportReview({
      sections: [
        {
          id: 'closed',
          status: 'ready',
          rows: [
            reportTask(1, 'Payments retry flow signed off with Product', { details: 'PRIVATE BODY' }),
            reportTask(2, 'SRE hiring loop closed, offer accepted'),
            reportTask(3, 'On-call runbook for alerting v2', { ownerType: 'developer', ownerId: 'priya' }),
          ],
        },
        {
          id: 'quiet',
          status: 'ready',
          rows: [
            reportTask(4, 'Vendor DPA', {
              status: 'open',
              waitingOn: { type: 'contact', ref: '1', label: 'Legal', since: '2026-09-23' },
              quiet: { checkByPassed: '2026-10-01', idleWorkingDays: 0 },
              signals: {
                overdue: false,
                overdueDays: null,
                overdueSource: null,
                stale: false,
                staleDays: null,
                drift: false,
                followUpDue: true,
                waitingDays: 9,
              },
            }),
          ],
        },
        {
          id: 'people',
          status: 'ready',
          rows: [
            {
              developerAccountId: 'priya',
              developerName: 'Priya',
              status: 'at_risk',
              note: 'capacity, needs a second pair of hands',
              statusUpdatedAt: '2026-10-01',
            },
          ],
        },
      ],
      nextWorkdayTop3: [
        { taskKey: 'T-5', title: 'Q4 roadmap draft to Product' },
        { taskKey: 'T-6', title: 'Migrate paging to the new on-call rotation' },
        { taskKey: 'T-7', title: 'Calibration prep for mid-year reviews' },
      ],
      jira: {
        status: 'ready',
        resolved: 7,
        opened: 3,
        topResolved: [],
        criticalOpen: [{ key: 'PAY-412', summary: 'checkout timeout', priority: 'critical', openDays: 4 }],
      },
    });
    const untouched = buildWeeklyReport(review, { personName: () => 'Priya' });
    const person = untouched.sections.flatMap((section) => section.lines).find((line) => line.namesPerson)!;
    expect(person.included).toBe(false);
    const model = buildWeeklyReport(review, { personName: () => 'Priya', excluded: [`+${person.id}`] });
    const markdown = toMarkdown(model);
    expect(markdown).toBe(
      '**Weekly update · 28 Sep – 2 Oct**\n\n**Shipped**\n- Payments retry flow signed off with Product\n- SRE hiring loop closed, offer accepted\n- On-call runbook for alerting v2 — Priya\n- Defects: 7 resolved, 3 opened · 1 critical open (PAY-412)\n\n**Next week**\n- Q4 roadmap draft to Product\n- Migrate paging to the new on-call rotation\n- Calibration prep for mid-year reviews\n\n**Blocked & risks**\n- Vendor DPA: waiting on Legal · 9 days\n- Priya at risk (capacity, needs a second pair of hands)\n- PAY-412 checkout timeout (critical) · open 4 days',
    );
    expect(markdown).not.toMatch(/PRIVATE BODY|T-\d/);
    expect(toMarkdown(untouched)).not.toContain('capacity');
    expect(toHtml(untouched)).not.toContain('capacity');
  });
  it('escapes HTML and Markdown, excludes dropped/meetings/1:1 pins and omits empty sections', () => {
    const model = buildWeeklyReport(
      reportReview({
        sections: [
          {
            id: 'closed',
            status: 'ready',
            rows: [
              reportTask(1, '<script> & *bold*_name'),
              reportTask(2, 'Dropped', { status: 'dropped' }),
              reportTask(3, 'Meeting', { kind: 'meeting' }),
            ],
          },
        ],
        nextWorkdayTop3: [{ taskKey: 'T-4', title: 'PRIVATE AGENDA', oneOnOne: true }],
      }),
    );
    expect(toHtml(model)).toContain('&lt;script&gt; &amp; *bold*_name');
    expect(toHtml(model)).not.toContain('<script>');
    expect(toMarkdown(model)).toContain('\\<script\\> & \\*bold\\*\\_name');
    expect(toMarkdown(model)).not.toMatch(/Dropped|Meeting|PRIVATE AGENDA|Next week|Blocked/);
    expect(toMarkdown(buildWeeklyReport(reportReview()))).toBe('');
  });
  it('step 1 Jira lines are body size, like the other review rows (UX-28)', async () => {
    const css = (await import('node:fs')).readFileSync(`${process.cwd()}/src/components/review/review.css`, 'utf8');
    expect(css).toMatch(/\.review-jira-lines label \{[^}]*font-size: 13\.5px;/);
  });

  it('Shipped lists only done work: a dropped task is not offered as a line at all (UX-28)', () => {
    const model = buildWeeklyReport(
      reportReview({
        sections: [{ id: 'closed', status: 'ready', rows: [reportTask(1, 'Shipped thing'), reportTask(2, 'Evaluate new standup bot', { status: 'dropped' })] }],
      }),
    );
    const shipped = model.sections.find((section) => section.id === 'shipped')!;
    expect(shipped.lines.map((line) => line.text)).toEqual(['Shipped thing']);
  });

  it('caps next-week lines at five and resolved highlights at three, deduplicates pins and reflects review decisions', () => {
    const done = reportTask(10, 'Finished in review', { status: 'open' });
    const planned = Array.from({ length: 9 }, (_, i) =>
      reportTask(i + 20, `Plan ${i}`, { status: 'open', priority: 'high', scheduledOn: '2026-10-05' }),
    );
    const review = reportReview({
      sections: [
        { id: 'quiet', status: 'ready', rows: [done] },
        { id: 'plannedNextWeek', status: 'ready', rows: planned },
      ],
      nextWorkdayTop3: [{ taskKey: 'T-20', title: 'Plan 0' }],
      jira: {
        status: 'ready',
        resolved: 8,
        opened: 0,
        criticalOpen: [],
        topResolved: Array.from({ length: 8 }, (_, i) => ({
          key: `JIRA-${i}`,
          summary: 'Resolved',
          priority: 'High',
          openDays: 3,
        })),
      },
    });
    const model = buildWeeklyReport(review, {
      decisions: new Map([
        [
          'T-10',
          {
            taskKey: 'T-10',
            row: done,
            choice: { action: 'done', changes: { status: 'done' }, label: 'Done', tone: 'success', announce: 'Done' },
          },
        ],
      ]),
    });
    expect(model.sections.find((section) => section.id === 'next')?.lines).toHaveLength(5);
    expect(toMarkdown(model)).toContain('Finished in review');
    expect(toMarkdown(model).match(/Plan 0/g)).toHaveLength(1);
    expect(model.sections[0]?.lines.filter((line) => line.id.startsWith('jira:resolved'))).toHaveLength(3);
  });
  it('does not claim zero resolved without resolution data', () => {
    const model = buildWeeklyReport(
      reportReview({ jira: { status: 'ready', resolved: null, opened: 3, criticalOpen: [], topResolved: [] } }),
    );
    expect(toMarkdown(model)).toContain('Defects: 3 opened · 0 critical open');
    expect(toMarkdown(model)).not.toContain('0 resolved');
  });
});
