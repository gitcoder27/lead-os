import { useEffect, useRef, useState, type ReactNode } from 'react';
import { format, parseISO } from 'date-fns';
import { Check, Ellipsis, ExternalLink, Hourglass, CalendarClock, CalendarX, Moon, Trash2, UserX } from 'lucide-react';
import { CheckByMenu, ScheduleMenu, TaskStatusGlyph } from '@/components/tasks/TaskMenus';
import { MenuDivider, MenuItem, TaskPopover } from '@/components/ui/Popover';
import { shouldIgnoreTriageEvent } from '@/lib/today-triage';
import { localDateOf } from '@/lib/task-list';
import {
  checkByDate,
  checkNextWorkday,
  dropTask,
  keepUndated,
  markDone,
  moveToNextWorkday,
  schedulePreset,
  scheduleDate,
  stillWaiting,
  stopWaiting,
  type DecisionChoice,
} from '@/lib/weekly-review-decisions';
import type { ReviewStepContext } from '@/lib/weekly-review';
import type { WeeklyReviewTaskRow } from '@/types';

export interface DecisionGroup {
  key: string;
  label: string;
  rows: WeeklyReviewTaskRow[];
}

/** Which set of actions a list offers: chasing what is waiting, or planning what is loose. */
export type DecisionMode = 'waiting' | 'loose';

interface OpenMenu {
  kind: 'more' | 'schedule' | 'checkBy';
  taskKey: string;
  anchor: HTMLElement;
}

/**
 * docs/59 §5.2-5.3 (WR-04): the decision list behind steps 2 and 3. One row per task: title, a line
 * of context, one primary action, one quiet one and a menu. A decided row collapses to one line
 * ("→ Check Mon", Undo) and stays where it was, so focus never jumps and nothing shifts under the
 * pointer. Keys: `j`/`k` move, `m` the primary action, `e` done, `#` drop, `s` schedule (Loose
 * ends), `c` check-by (Waiting), `o`/Enter open, `z` undo (handled by the review).
 */
export function ReviewDecisionList({
  ctx,
  mode,
  groups,
  renderMeta,
}: {
  ctx: ReviewStepContext;
  mode: DecisionMode;
  groups: DecisionGroup[];
  renderMeta: (row: WeeklyReviewTaskRow, group: DecisionGroup) => ReactNode;
}) {
  const flat = groups.flatMap((group) => group.rows);
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  const [menu, setMenu] = useState<OpenMenu | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const today = ctx.review.today;
  const nextWorkday = ctx.review.nextWorkday;
  const nextDay = format(parseISO(nextWorkday), 'EEE');

  const rowElement = (key: string) => listRef.current?.querySelector<HTMLElement>(`[data-review-row="${key}"]`) ?? null;
  const focusRow = (key: string) => {
    setFocusedKey(key);
    rowElement(key)?.focus();
  };

  const primaryFor = (): { choice: DecisionChoice; label: string } =>
    mode === 'waiting'
      ? { choice: checkNextWorkday(nextWorkday), label: `Check ${nextDay}` }
      : { choice: moveToNextWorkday(nextWorkday), label: format(parseISO(nextWorkday), 'EEEE') };
  const secondaryFor = (): { choice: DecisionChoice; label: string } =>
    mode === 'waiting' ? { choice: markDone('Got it'), label: 'Got it' } : { choice: markDone(), label: 'Done' };

  // A decision keeps the pointer or keyboard where it was: the row (not the button that vanished) holds focus.
  const decide = (row: WeeklyReviewTaskRow, choice: DecisionChoice) => {
    ctx.decide(row, choice);
    setFocusedKey(row.taskKey);
    requestAnimationFrame(() => rowElement(row.taskKey)?.focus({ preventScroll: true }));
  };

  const keyHandler = useRef<(event: KeyboardEvent) => void>(() => {});
  keyHandler.current = (event) => {
    if (menu || shouldIgnoreTriageEvent(event) || flat.length === 0) return;
    const index = flat.findIndex((row) => row.taskKey === focusedKey);
    const current = index >= 0 ? flat[index] : undefined;
    const decided = current ? ctx.decisions.has(current.taskKey) : false;
    const anchor = current ? rowElement(current.taskKey) : null;
    switch (event.key) {
      case 'j': case 'ArrowDown': focusRow(flat[Math.min(flat.length - 1, index + 1)]!.taskKey); break;
      case 'k': case 'ArrowUp': focusRow(flat[Math.max(0, index < 0 ? 0 : index - 1)]!.taskKey); break;
      case 'o': case 'Enter':
        if (!current || (event.key === 'Enter' && (event.target as HTMLElement).tagName !== 'DIV')) return;
        ctx.openTask(current.taskKey);
        break;
      case 'm': if (current && !decided) decide(current, primaryFor().choice); else return; break;
      case 'e': if (current && !decided) decide(current, secondaryFor().choice); else return; break;
      case '#': if (current && !decided) decide(current, dropTask()); else return; break;
      case 's': if (current && !decided && mode === 'loose' && anchor) setMenu({ kind: 'schedule', taskKey: current.taskKey, anchor }); else return; break;
      case 'c': if (current && !decided && mode === 'waiting' && anchor) setMenu({ kind: 'checkBy', taskKey: current.taskKey, anchor }); else return; break;
      default: return;
    }
    event.preventDefault();
  };
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => keyHandler.current(event);
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  const menuRow = menu ? flat.find((row) => row.taskKey === menu.taskKey) : undefined;
  // Focus goes back to the row whichever way a menu closes (the row, not a control that went away).
  const closeMenu = (restoreFocus = true) => {
    const key = menu?.taskKey;
    setMenu(null);
    if (restoreFocus && key) requestAnimationFrame(() => rowElement(key)?.focus({ preventScroll: true }));
  };

  return (
    <div ref={listRef} className="review-groups">
      {groups.map((group) => (
        <section key={group.key} role="group" aria-labelledby={`review-group-${group.key}`} className="review-group">
          <div className="review-group-head">
            <h3 id={`review-group-${group.key}`} className="today-subhead review-subhead">
              {group.label} · {group.rows.length}
            </h3>
          </div>
          <div role="list">
            {group.rows.map((row) => {
              const decision = ctx.decisions.get(row.taskKey);
              const focused = row.taskKey === focusedKey;
              const primary = primaryFor();
              const secondary = secondaryFor();
              return (
                <div
                  key={row.taskKey}
                  role="listitem"
                  className="review-row review-decision-row"
                  data-review-row={row.taskKey}
                  data-decided={decision ? decision.choice.tone : undefined}
                  tabIndex={focused || (!focusedKey && row === flat[0]) ? 0 : -1}
                  aria-label={decision ? `${row.title}, ${decision.choice.label.replace('→', 'moved to')}` : undefined}
                  onFocus={(event) => { if (event.target === event.currentTarget) setFocusedKey(row.taskKey); }}
                >
                  {decision ? (
                    <>
                      <span className="review-decided-mark" aria-hidden="true"><Check size={12} strokeWidth={3} /></span>
                      <span className="review-row-body">
                        <span className="review-row-title">{row.title}</span>
                      </span>
                      <span className="review-row-end">
                        <span className="review-decided-label">{decision.choice.label}</span>
                        <button type="button" className="ui-btn-ghost review-undo" tabIndex={-1} onClick={() => { ctx.undoDecision(row.taskKey); setFocusedKey(row.taskKey); requestAnimationFrame(() => rowElement(row.taskKey)?.focus({ preventScroll: true })); }}>
                          Undo
                        </button>
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="review-row-glyph" aria-hidden="true">
                        {mode === 'waiting' ? <Hourglass size={14} /> : <TaskStatusGlyph status={row.status} />}
                      </span>
                      <span className="review-row-body">
                        <button type="button" className="review-row-title-btn" tabIndex={-1} onClick={() => ctx.openTask(row.taskKey)}>
                          <span className="review-row-title">{row.title}</span>
                        </button>
                        <span className="review-row-meta">{renderMeta(row, group)}</span>
                      </span>
                      <span className="review-row-actions">
                        <button type="button" className="ui-btn" tabIndex={-1} onClick={() => decide(row, primary.choice)}>{primary.label}</button>
                        <button type="button" className="ui-btn-ghost" tabIndex={-1} onClick={() => decide(row, secondary.choice)}>{secondary.label}</button>
                        <button
                          type="button"
                          className="ui-icon-btn"
                          tabIndex={-1}
                          aria-label={`More actions for ${row.title}`}
                          aria-haspopup="menu"
                          aria-expanded={menu?.taskKey === row.taskKey && menu.kind === 'more'}
                          onClick={(event) => setMenu({ kind: 'more', taskKey: row.taskKey, anchor: event.currentTarget })}
                        >
                          <Ellipsis size={15} />
                        </button>
                      </span>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      ))}

      {menu?.kind === 'more' && menuRow ? (
        <TaskPopover anchor={menu.anchor} label={`Actions for ${menuRow.title}`} width={230} onClose={() => closeMenu()}>
          {mode === 'waiting' ? (
            <>
              <MenuItem icon={<Hourglass size={13} />} label="Still waiting (check in a week)" onSelect={() => { closeMenu(); decide(menuRow, stillWaiting(today)); }} />
              <MenuItem icon={<CalendarClock size={13} />} label="Change check date…" hint="c" onSelect={() => { const anchor = menu.anchor; closeMenu(false); setMenu({ kind: 'checkBy', taskKey: menuRow.taskKey, anchor }); }} />
              <MenuItem icon={<UserX size={13} />} label="Stop waiting" onSelect={() => { closeMenu(); decide(menuRow, stopWaiting()); }} />
            </>
          ) : (
            <>
              <MenuItem icon={<CalendarClock size={13} />} label="Schedule…" hint="s" onSelect={() => { const anchor = menu.anchor; closeMenu(false); setMenu({ kind: 'schedule', taskKey: menuRow.taskKey, anchor }); }} />
              <MenuItem icon={<Moon size={13} />} label="Later" onSelect={() => { closeMenu(); decide(menuRow, schedulePreset('later', today)); }} />
              <MenuItem icon={<CalendarX size={13} />} label="Keep undated" onSelect={() => { closeMenu(); decide(menuRow, keepUndated()); }} />
            </>
          )}
          <MenuDivider />
          <MenuItem icon={<Trash2 size={13} />} label="Drop" hint="#" tone="danger" onSelect={() => { closeMenu(); decide(menuRow, dropTask()); }} />
          <MenuItem icon={<ExternalLink size={13} />} label="Open task" hint="o" onSelect={() => { closeMenu(); ctx.openTask(menuRow.taskKey); }} />
        </TaskPopover>
      ) : null}
      {menu?.kind === 'schedule' && menuRow ? (
        <ScheduleMenu
          anchor={menu.anchor}
          today={today}
          current={menuRow.scheduledOn}
          laterActive={false}
          onClose={() => closeMenu()}
          onSelect={(preset) => { closeMenu(); decide(menuRow, schedulePreset(preset, today)); }}
          onPickDate={(date) => { closeMenu(); decide(menuRow, scheduleDate(today, date)); }}
        />
      ) : null}
      {menu?.kind === 'checkBy' && menuRow ? (
        <CheckByMenu
          anchor={menu.anchor}
          today={today}
          current={localDateOf(menuRow.followUpAt)}
          onClose={() => closeMenu()}
          onPick={(date) => { closeMenu(); decide(menuRow, checkByDate(today, date)); }}
        />
      ) : null}
    </div>
  );
}
