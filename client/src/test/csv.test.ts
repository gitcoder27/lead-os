import { describe, expect, it } from 'vitest';
import { csvFileName, tasksCsv, toCsv } from '@/lib/csv';
import { reportTask } from './fixtures/weekly-review';
describe('CSV', () => {
  it('uses BOM, CRLF and quoted escaped cells; prevents formulas including leading whitespace/control characters', () => {
    const csv = toCsv(['Title'], [['a,"b"\nnext'], ['=1+1'], ['+cmd'], ['-2'], ['@SUM(1)'], [' \t=2'], ['\u0001=3']]);
    expect(csv).toBe(
      '\uFEFF"Title"\r\n"a,""b""\nnext"\r\n"\'=1+1"\r\n"\'+cmd"\r\n"\'-2"\r\n"\'@SUM(1)"\r\n"\' \t=2"\r\n"\'\u0001=3"\r\n',
    );
  });
  it('exports the prescribed task columns and omits marked 1:1 tasks regardless of their ownership/status', () => {
    const csv = tasksCsv(
      [reportTask(1, 'Visible'), { ...reportTask(2, 'PRIVATE AGENDA'), oneOnOne: true }],
      () => 'Me',
      '2026-10-02',
    );
    expect(csv).toContain(
      '"Key","Title","Status","Lane","Owner","Waiting on","Plan date","Deadline","Check by","Priority","Labels","Jira","Created","Closed"',
    );
    expect(csv).toContain('Visible');
    expect(csv).not.toContain('PRIVATE AGENDA');
  });
  it('uses the supplied local calendar date and a safe filename', () => {
    expect(csvFileName('tasks', 'saved:7/my view', '2026-10-02')).toBe('leados-tasks-saved-7-my-view-2026-10-02.csv');
  });
});
