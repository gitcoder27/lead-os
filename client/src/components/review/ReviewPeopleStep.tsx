import { useEffect, useRef, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { CircleCheck, Ellipsis, ExternalLink, SkipForward, UserRound } from 'lucide-react';
import { EmptyState } from '@/components/ui/EmptyState';
import { MenuItem, TaskPopover } from '@/components/ui/Popover';
import { Avatar } from '@/components/ui/Avatar';
import { shouldIgnoreTriageEvent } from '@/lib/today-triage';
import { findSection, type ReviewStepContext } from '@/lib/weekly-review';
import type { TodayActionTarget, WeeklyReviewOneOnOneRow, WeeklyReviewPersonRow } from '@/types';
import { ReviewChips } from './ReviewChips';
import { ReviewSourceNote } from './ReviewSourceNote';

/** What needs the manager in step 4 (docs/59 §5.3): 1:1s missed or due, and people marked blocked or at risk. */
export function peopleNeedingYou(ctx: ReviewStepContext): number {
  const oneOnOnes = findSection(ctx.review, 'oneOnOnes')?.rows ?? [];
  const people = findSection(ctx.review, 'people')?.rows ?? [];
  return oneOnOnes.filter((row) => !ctx.skippedSessions.has(row.sessionId) && row.status === 'scheduled').length + people.length;
}

type Entry =
  | { kind: 'oneOnOne'; key: string; row: WeeklyReviewOneOnOneRow }
  | { kind: 'status'; key: string; row: WeeklyReviewPersonRow }
  | { kind: 'checkIn'; key: string; name: string; id: string; detail: string; quiet: boolean };

interface Group {
  key: string;
  label: string;
  entries: Entry[];
}

function dayLabel(date: string): string {
  return format(parseISO(date), 'EEE d MMM');
}

const STATUS_LABEL: Record<WeeklyReviewPersonRow['status'], string> = { blocked: 'Blocked', at_risk: 'At risk' };

/**
 * docs/59 §5.3 step 4: who needs the manager: 1:1s missed this week or due next week, people marked
 * blocked or at risk, and (collab only) how often participating developers checked in. Read and
 * jump: nothing here is a chore, and skipping a session is only in the menu.
 */
export function ReviewPeopleStep({ ctx }: { ctx: ReviewStepContext }) {
  const oneOnOnes = findSection(ctx.review, 'oneOnOnes');
  const people = findSection(ctx.review, 'people');
  const checkIns = findSection(ctx.review, 'checkIns');
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ key: string; anchor: HTMLElement } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const oneOnOneRows = ctx.review.oneOnOneEnabled ? (oneOnOnes?.rows ?? []) : [];
  const groups: Group[] = [
    { key: 'missed', label: 'Missed this week', entries: oneOnOneRows.filter((row) => row.kind === 'missed').map((row) => ({ kind: 'oneOnOne' as const, key: `oo-${row.sessionId}`, row })) },
    { key: 'due', label: 'Due next week', entries: oneOnOneRows.filter((row) => row.kind === 'due_next_week').map((row) => ({ kind: 'oneOnOne' as const, key: `oo-${row.sessionId}`, row })) },
    { key: 'status', label: 'Status', entries: (people?.rows ?? []).map((row) => ({ kind: 'status' as const, key: `st-${row.developerAccountId}`, row })) },
    {
      key: 'checkins',
      label: 'Check-ins this week',
      entries: (checkIns?.rows ?? []).map((row) => ({
        kind: 'checkIn' as const,
        key: `ci-${row.developerAccountId}`,
        id: row.developerAccountId,
        name: row.developerName,
        detail: `${row.daysWithCheckIn} of ${row.workingDays} days`,
        quiet: row.daysWithCheckIn === 0,
      })),
    },
  ].filter((group) => group.entries.length > 0);
  const flat = groups.flatMap((group) => group.entries);

  const personTarget = (id: string): TodayActionTarget => ({ type: 'view', view: 'team', developerAccountId: id });
  const oneOnOneTarget = (id: string): TodayActionTarget => ({ type: 'view', view: 'team', developerAccountId: id, panel: 'one-on-one' });
  const primaryOf = (entry: Entry): { label: string; run: () => void } | null => {
    if (entry.kind === 'oneOnOne') return { label: 'Open 1:1', run: () => ctx.openTarget(oneOnOneTarget(entry.row.developerAccountId)) };
    if (entry.kind === 'status') return { label: 'Open', run: () => ctx.openTarget(personTarget(entry.row.developerAccountId)) };
    return { label: 'Open', run: () => ctx.openTarget(personTarget(entry.id)) };
  };

  const rowElement = (key: string) => listRef.current?.querySelector<HTMLElement>(`[data-review-row="${key}"]`) ?? null;
  const focusRow = (key: string) => {
    setFocusedKey(key);
    rowElement(key)?.focus();
  };

  const keyHandler = useRef<(event: KeyboardEvent) => void>(() => {});
  keyHandler.current = (event) => {
    if (menu || shouldIgnoreTriageEvent(event) || flat.length === 0) return;
    const index = flat.findIndex((entry) => entry.key === focusedKey);
    const current = index >= 0 ? flat[index] : undefined;
    switch (event.key) {
      case 'j': case 'ArrowDown': focusRow(flat[Math.min(flat.length - 1, index + 1)]!.key); break;
      case 'k': case 'ArrowUp': focusRow(flat[Math.max(0, index < 0 ? 0 : index - 1)]!.key); break;
      case 'o': case 'Enter':
        if (!current || (event.key === 'Enter' && (event.target as HTMLElement).tagName !== 'DIV')) return;
        primaryOf(current)?.run();
        break;
      default: return;
    }
    event.preventDefault();
  };
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => keyHandler.current(event);
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  const failed = [
    oneOnOnes?.status === 'unavailable' && ctx.review.oneOnOneEnabled ? "1:1s" : null,
    people?.status === 'unavailable' ? 'people status' : null,
    checkIns?.status === 'unavailable' ? 'check-ins' : null,
  ].filter((what): what is string => what !== null);

  const nothing = groups.every((group) => group.key === 'checkins');

  return (
    <div ref={listRef} className="review-groups">
      {failed.map((what) => <ReviewSourceNote key={what} what={what} onRetry={ctx.retry} />)}
      {nothing && failed.length === 0 ? (
        <EmptyState compact tone="success" icon={<CircleCheck size={20} />} title="Nothing needs you here" body="No 1:1s to catch up on and nobody is blocked." />
      ) : null}
      {groups.map((group) => (
        <section key={group.key} role="group" aria-labelledby={`review-group-${group.key}`} className="review-group">
          <div className="review-group-head">
            <h3 id={`review-group-${group.key}`} className="today-subhead review-subhead">{group.label} · {group.entries.length}</h3>
          </div>
          <div role="list">
            {group.entries.map((entry) => {
              const focused = entry.key === focusedKey;
              const primary = primaryOf(entry);
              const name = entry.kind === 'oneOnOne' ? entry.row.developerName : entry.kind === 'status' ? entry.row.developerName : entry.name;
              const id = entry.kind === 'oneOnOne' ? entry.row.developerAccountId : entry.kind === 'status' ? entry.row.developerAccountId : entry.id;
              const skipped = entry.kind === 'oneOnOne' && ctx.skippedSessions.has(entry.row.sessionId);
              return (
                <div
                  key={entry.key}
                  role="listitem"
                  className="review-row review-people-row"
                  data-review-row={entry.key}
                  tabIndex={focused || (!focusedKey && entry === flat[0]) ? 0 : -1}
                  onFocus={(event) => { if (event.target === event.currentTarget) setFocusedKey(entry.key); }}
                >
                  <span className="review-row-glyph review-row-avatar"><Avatar name={name} seed={id} size={22} /></span>
                  <span className="review-row-body">
                    <button type="button" className="review-row-title-btn" tabIndex={-1} onClick={() => primary?.run()}>
                      <span className="review-row-title">{name}</span>
                    </button>
                    <span className="review-row-meta">
                      {entry.kind === 'oneOnOne' ? (
                        <>
                          {entry.row.kind === 'due_next_week' ? `1:1 ${dayLabel(entry.row.scheduledFor)}` : `Was ${dayLabel(entry.row.scheduledFor)}`}
                          {entry.row.kind === 'missed' ? (
                            <ReviewChips chips={[skipped || entry.row.status === 'skipped' ? { label: 'Skipped', tone: 'muted' } : { label: 'Missed', tone: 'warning' }]} />
                          ) : null}
                        </>
                      ) : entry.kind === 'status' ? (
                        <>
                          <ReviewChips chips={[{ label: STATUS_LABEL[entry.row.status], tone: entry.row.status === 'blocked' ? 'danger' : 'warning' }]} />
                          {entry.row.note ? <span>{entry.row.note}</span> : null}
                        </>
                      ) : (
                        <>
                          <span>{entry.detail}</span>
                          {entry.quiet ? <ReviewChips chips={[{ label: 'No check-ins', tone: 'warning' }]} /> : null}
                        </>
                      )}
                    </span>
                  </span>
                  <span className="review-row-actions">
                    {primary ? <button type="button" className="ui-btn" tabIndex={-1} onClick={primary.run}>{primary.label}</button> : null}
                    {entry.kind !== 'checkIn' ? (
                      <button
                        type="button"
                        className="ui-icon-btn"
                        tabIndex={-1}
                        aria-label={`More actions for ${name}`}
                        aria-haspopup="menu"
                        aria-expanded={menu?.key === entry.key}
                        onClick={(event) => setMenu({ key: entry.key, anchor: event.currentTarget })}
                      >
                        <Ellipsis size={15} />
                      </button>
                    ) : null}
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      ))}
      {menu ? (() => {
        const entry = flat.find((candidate) => candidate.key === menu.key);
        if (!entry || entry.kind === 'checkIn') return null;
        const id = entry.row.developerAccountId;
        const canSkip = entry.kind === 'oneOnOne' && entry.row.status === 'scheduled' && !ctx.skippedSessions.has(entry.row.sessionId);
        const close = () => setMenu(null);
        return (
          <TaskPopover anchor={menu.anchor} label={`Actions for ${entry.row.developerName}`} width={220} onClose={close}>
            {entry.kind === 'oneOnOne' ? <MenuItem icon={<ExternalLink size={13} />} label="Open 1:1" hint="o" onSelect={() => { close(); ctx.openTarget(oneOnOneTarget(id)); }} /> : null}
            <MenuItem icon={<UserRound size={13} />} label="Open person" onSelect={() => { close(); ctx.openTarget(personTarget(id)); }} />
            {canSkip && entry.kind === 'oneOnOne' ? <MenuItem icon={<SkipForward size={13} />} label="Skip this session" onSelect={() => { close(); ctx.skipSession(entry.row); }} /> : null}
          </TaskPopover>
        );
      })() : null}
    </div>
  );
}
