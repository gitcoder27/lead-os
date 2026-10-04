import type { WeeklyReviewPin, WeeklyReviewResponse, WeeklyReviewTaskRow } from '@/types';
import { defaultInUpdate, findSection, formatWeekRange, isLineIncluded, type ReviewDecision } from './weekly-review';

export interface WeeklyReportLine {
  id: string;
  text: string;
  defaultIncluded: boolean;
  included: boolean;
  namesPerson?: true;
}
export interface WeeklyReportModel {
  title: string;
  sections: Array<{ id: 'shipped' | 'next' | 'risks'; title: string; lines: WeeklyReportLine[] }>;
}
export interface WeeklyReportState {
  excluded?: readonly string[];
  decisions?: ReadonlyMap<string, ReviewDecision>;
  pins?: readonly WeeklyReviewPin[];
  personName?: (id: string | null) => string;
}

/** The snapshot plus this session's acknowledged decisions, deduplicated and privacy filtered. */
export function reviewReportTasks(review: WeeklyReviewResponse, state: WeeklyReportState = {}): WeeklyReviewTaskRow[] {
  const rows = new Map<string, WeeklyReviewTaskRow>();
  for (const section of review.sections) {
    if (section.status !== 'ready') continue;
    for (const row of section.rows) if ('taskKey' in row && !row.oneOnOne) rows.set(row.taskKey, row);
  }
  for (const [key, decision] of state.decisions ?? []) {
    // Pending task writes must not become claims in an exported update.
    if (decision.pending || decision.row.oneOnOne) continue;
    const { waitingOn: _waitingOn, ...changes } = decision.choice.changes;
    rows.set(key, { ...decision.row, ...changes, ...decision.acknowledged });
  }
  return [...rows.values()];
}

export function buildWeeklyReport(review: WeeklyReviewResponse, state: WeeklyReportState = {}): WeeklyReportModel {
  const excluded = state.excluded ?? review.saved?.excluded ?? [];
  const personName = state.personName ?? (() => 'Someone');
  const line = (id: string, text: string, defaultIncluded = true, namesPerson = false): WeeklyReportLine => ({
    id,
    text,
    defaultIncluded,
    included: isLineIncluded(excluded, id, defaultIncluded),
    ...(namesPerson && { namesPerson: true as const }),
  });
  const rows = reviewReportTasks(review, state);
  // docs/56 UX-28: dropped work did not ship, so it is not offered under Shipped at all.
  const shipped = rows
    .filter((row) => row.status === 'done')
    .map((row) =>
      line(
        row.taskKey,
        `${row.title}${row.ownerType === 'developer' ? ` — ${personName(row.ownerId)}` : ''}`,
        defaultInUpdate(row),
      ),
    );
  const jira = review.jira?.status === 'ready' ? review.jira : undefined;
  if (jira) {
    const counts = [jira.resolved === null ? null : `${jira.resolved} resolved`, `${jira.opened} opened`]
      .filter(Boolean)
      .join(', ');
    shipped.push(
      line(
        'jira:summary',
        `Defects: ${counts} · ${jira.criticalOpen.length} critical open${jira.criticalOpen.length ? ` (${jira.criticalOpen.map((issue) => issue.key).join(', ')})` : ''}`,
      ),
    );
    shipped.push(
      ...jira.topResolved
        .slice(0, 3)
        .map((issue) => line(`jira:resolved:${issue.key}`, `${issue.key} ${issue.summary}`)),
    );
  }
  const pins = state.pins ?? review.nextWorkdayTop3;
  const seen = new Set<string>();
  const next: WeeklyReportLine[] = [];
  for (const pin of pins) {
    if (pin.oneOnOne || seen.has(pin.taskKey)) continue;
    const row = rows.find((candidate) => candidate.taskKey === pin.taskKey);
    if (row && (row.status === 'done' || row.status === 'dropped')) continue;
    seen.add(pin.taskKey);
    next.push(line(`next:${pin.taskKey}`, pin.title));
    if (next.length >= 5) break;
  }
  for (const row of rows.filter(
    (row) =>
      row.priority === 'high' &&
      row.status !== 'done' &&
      row.status !== 'dropped' &&
      row.scheduledOn &&
      row.scheduledOn >= review.range.nextStart &&
      row.scheduledOn <= review.range.nextEnd,
  )) {
    if (seen.has(row.taskKey) || next.length >= 5) continue;
    seen.add(row.taskKey);
    next.push(line(`next:${row.taskKey}`, row.title));
  }
  const risks: WeeklyReportLine[] = [];
  for (const row of rows) {
    if (row.status === 'done' || row.status === 'dropped') continue;
    if (row.status === 'blocked') {
      const named = row.ownerType === 'developer';
      risks.push(
        line(
          `risk:${row.taskKey}`,
          `${row.title}: blocked${named ? ` — ${personName(row.ownerId)}` : ''}`,
          !named,
          named,
        ),
      );
    } else if (row.quiet?.checkByPassed) {
      const party = row.waitingOn?.label ?? (row.ownerType === 'developer' ? personName(row.ownerId) : 'a response');
      const named = row.waitingOn?.type === 'developer' || (!row.waitingOn && row.ownerType === 'developer');
      const days = row.signals.waitingDays;
      risks.push(
        line(
          `risk:${row.taskKey}`,
          `${row.title}: waiting on ${party}${days != null ? ` · ${days} day${days === 1 ? '' : 's'}` : ''}`,
          !named,
          named,
        ),
      );
    }
  }
  for (const person of findSection(review, 'people')?.rows ?? []) {
    risks.push(
      line(
        `person:${person.developerAccountId}`,
        `${person.developerName} ${person.status === 'at_risk' ? 'at risk' : 'blocked'}${person.note ? ` (${person.note})` : ''}`,
        false,
        true,
      ),
    );
  }
  risks.push(
    ...(jira?.criticalOpen ?? []).map((issue) =>
      line(
        `jira:critical:${issue.key}`,
        `${issue.key} ${issue.summary} (${issue.priority}) · open ${issue.openDays} day${issue.openDays === 1 ? '' : 's'}`,
      ),
    ),
  );
  return {
    title: `Weekly update · ${formatWeekRange(review.range.start)}`,
    sections: [
      { id: 'shipped', title: 'Shipped', lines: shipped },
      { id: 'next', title: 'Next week', lines: next },
      { id: 'risks', title: 'Blocked & risks', lines: risks },
    ],
  };
}

export function escapeMarkdown(value: string): string {
  return value.replace(/[\\`*_{}[\]<>#|]/g, '\\$&').replace(/\r?\n/g, ' ');
}
export function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!,
  );
}
export function toMarkdown(model: WeeklyReportModel): string {
  const sections = model.sections.flatMap((section) => {
    const lines = section.lines.filter((line) => line.included);
    return lines.length
      ? [`**${escapeMarkdown(section.title)}**\n${lines.map((line) => `- ${escapeMarkdown(line.text)}`).join('\n')}`]
      : [];
  });
  return sections.length ? `**${escapeMarkdown(model.title)}**\n\n${sections.join('\n\n')}` : '';
}
export function toHtml(model: WeeklyReportModel): string {
  const sections = model.sections.flatMap((section) => {
    const lines = section.lines.filter((line) => line.included);
    return lines.length
      ? [
          `<p><strong>${escapeHtml(section.title)}</strong></p><ul>${lines.map((line) => `<li>${escapeHtml(line.text)}</li>`).join('')}</ul>`,
        ]
      : [];
  });
  return sections.length ? `<p><strong>${escapeHtml(model.title)}</strong></p>${sections.join('')}` : '';
}
/** Edited text supports headings and bullets; literal HTML is always escaped. */
export function reportMarkdownToHtml(markdown: string): string {
  return markdown
    .split(/\n\s*\n/)
    .filter(Boolean)
    .map((block) => {
      const lines = block.split('\n');
      const plain = (text: string) => escapeHtml(text.replace(/\\([\\`*_{}[\]<>#|])/g, '$1'));
      if (lines.every((text) => text.startsWith('- ')))
        return `<ul>${lines.map((text) => `<li>${plain(text.slice(2))}</li>`).join('')}</ul>`;
      if (/^\*\*[^\n]+\*\*$/.test(block)) return `<p><strong>${plain(block.slice(2, -2))}</strong></p>`;
      return `<p>${lines.map(plain).join('<br>')}</p>`;
    })
    .join('');
}
