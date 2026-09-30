import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ArrowLeft, ArrowRight, CircleAlert } from 'lucide-react';
import { EmptyState } from '@/components/ui/EmptyState';
import { TaskPopover } from '@/components/ui/Popover';
import { ShortcutSheet, type ShortcutGroup } from '@/components/ui/ShortcutSheet';
import { useQuickActions } from '@/context/QuickActionsContext';
import { useDevelopers } from '@/hooks/useDevelopers';
import { useReviewProgress, useWeeklyReview } from '@/hooks/useWeeklyReview';
import { shouldIgnoreTriageEvent } from '@/lib/today-triage';
import {
  formatWeekRange,
  isLineIncluded,
  mondayOfLocal,
  withLineIncluded,
  type ReviewStepContext,
} from '@/lib/weekly-review';
import type { WeeklyReviewResponse } from '@/types';
import { ReviewHeader } from './ReviewHeader';
import { ReviewStepsRail } from './ReviewStepsRail';
import { REVIEW_STEPS, type ReviewStepEntry } from './review-steps';
import './review.css';

export interface WeeklyReviewModeProps {
  /** Any day in the week to review; without it the server picks (last week on a Monday or Tuesday). */
  week?: string;
  onWeekChange: (week: string | undefined) => void;
  onExit: () => void;
  /** The steps to offer; defaults to the shipped ones (tests inject their own). */
  steps?: ReviewStepEntry[];
}

const GENERAL_KEYS: ShortcutGroup['keys'] = [
  ['] / [', 'Next / previous step'],
  ['1…6', 'Jump to a step'],
  ['?', 'This sheet'],
  ['esc', 'Back to Today'],
];

/**
 * docs/59 §5 (WR-03): the weekly review, a mode of Today (`/?mode=review`). The header and the step
 * rail draw at once; the body loads. The read model is a snapshot, so rows never reshuffle while a
 * step is open.
 */
export function WeeklyReviewMode({ week, onWeekChange, onExit, steps = REVIEW_STEPS }: WeeklyReviewModeProps) {
  const query = useWeeklyReview(week);

  if (query.data) {
    return (
      <ReviewSession
        key={query.data.range.start}
        review={query.data}
        retry={() => void query.refetch()}
        steps={steps}
        onWeekChange={onWeekChange}
        onExit={onExit}
      />
    );
  }

  return (
    <div className="review-mode" data-testid="weekly-review">
      <ReviewHeader
        range={week ? formatWeekRange(mondayOfLocal(week)) : 'This week'}
        weekLabel={null}
        stepLabel={steps[0]?.label ?? 'Review'}
        stepIndex={0}
        stepTotal={steps.length}
        onExit={onExit}
        onShortcuts={() => {}}
        onPhoneSteps={() => {}}
      />
      <div className="review-frame">
        <ReviewStepsRail
          steps={steps.map((step) => ({ id: step.id, label: step.label, count: null }))}
          currentIndex={0}
          left={new Set()}
          onSelect={() => {}}
        />
        <main className="review-main">
          <div className="review-step-pane">
            {query.isError ? (
              <EmptyState
                icon={<CircleAlert size={20} />}
                title="Couldn't load your week"
                body="Your tasks are safe. Check your connection and try again."
                action={
                  <span className="inline-flex gap-2">
                    <button type="button" className="ui-btn" onClick={() => void query.refetch()}>Retry</button>
                    <button type="button" className="ui-btn-ghost" onClick={onExit}>Back to Today</button>
                  </span>
                }
              />
            ) : (
              <ReviewSkeleton />
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

/**
 * Focus follows the step: the heading takes it as the new step mounts, so a screen reader starts at
 * the top of the step and a keyboard user is never left on a control that just went away.
 */
function StepHeading({ id, children }: { id: string; children: string }) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
  }, []);
  return <h2 id={id} ref={ref} tabIndex={-1}>{children}</h2>;
}

function ReviewSkeleton() {
  const widths = ['46%', '58%', '38%'];
  return (
    <div className="review-skeleton" aria-busy="true" aria-label="Loading your week">
      {widths.map((width) => (
        <div key={width} className="review-skeleton-row">
          <span className="review-bone" style={{ width: 18, height: 18 }} />
          <span className="flex flex-col gap-1.5">
            <span className="review-bone" style={{ width, height: 12 }} />
            <span className="review-bone" style={{ width: '22%', height: 9 }} />
          </span>
          <span className="review-bone" style={{ width: 36, height: 10 }} />
        </div>
      ))}
    </div>
  );
}

function ReviewSession({
  review,
  retry,
  steps,
  onWeekChange,
  onExit,
}: {
  review: WeeklyReviewResponse;
  retry: () => void;
  steps: ReviewStepEntry[];
  onWeekChange: (week: string | undefined) => void;
  onExit: () => void;
}) {
  const reduceMotion = useReducedMotion();
  const { openTask: openTaskDrawer } = useQuickActions();
  const openTask = useCallback((taskKey: string) => openTaskDrawer?.(taskKey), [openTaskDrawer]);
  const developers = useDevelopers();
  const { saved, patch, flush } = useReviewProgress(review.range.start, review.saved);

  const visible = useMemo(() => steps.filter((step) => !step.visible || step.visible(review)), [steps, review]);
  const [index, setIndex] = useState(() => Math.max(0, visible.findIndex((step) => step.id === saved.step)));
  // Steps the manager has moved on from (a resumed review counts everything before its saved step).
  const [left, setLeft] = useState<Set<string>>(() => new Set(visible.slice(0, index).map((step) => step.id)));
  const [announcement, setAnnouncement] = useState({ text: '', n: 0 });
  const [sheet, setSheet] = useState<{ kind: 'keys' | 'steps'; anchor: HTMLElement } | null>(null);
  const excludedRef = useRef(saved.excluded);

  const step = visible[index] ?? visible[0]!;
  // A fresh node per message, so the same sentence twice in a row is announced twice.
  const announce = useCallback((message: string) => setAnnouncement((current) => ({ text: message, n: current.n + 1 })), []);

  const personName = useCallback(
    (accountId: string | null) => (accountId ? developers.data?.find((dev) => dev.accountId === accountId)?.displayName : undefined) ?? 'Someone',
    [developers.data],
  );

  const ctx = useMemo<ReviewStepContext>(() => ({
    review,
    saved,
    today: review.today,
    isIncluded: (lineId, defaultIncluded) => isLineIncluded(saved.excluded, lineId, defaultIncluded),
    setIncluded: (lineId, defaultIncluded, included) => {
      // Several ticks can land in one render (a whole group): always build on the latest list.
      excludedRef.current = withLineIncluded(excludedRef.current, lineId, defaultIncluded, included);
      patch({ excluded: excludedRef.current });
    },
    openTask,
    personName,
    retry,
    announce,
  }), [review, saved, patch, openTask, personName, retry, announce]);

  const goTo = useCallback((next: number) => {
    if (next < 0 || next >= visible.length || next === index) return;
    setLeft((current) => new Set(current).add(visible[index]!.id));
    setIndex(next);
    patch({ step: visible[next]!.id });
  }, [index, patch, visible]);

  const exit = useCallback(() => {
    flush();
    onExit();
  }, [flush, onExit]);

  const keyHandler = useRef<(event: KeyboardEvent) => void>(() => {});
  keyHandler.current = (event) => {
    if (shouldIgnoreTriageEvent(event)) return;
    if (sheet) return;
    switch (event.key) {
      case ']': goTo(index + 1); break;
      case '[': goTo(index - 1); break;
      case '?': setSheet({ kind: 'keys', anchor: document.querySelector<HTMLElement>('[aria-label="Keyboard shortcuts"]') ?? document.body }); break;
      case 'Escape': exit(); break;
      default:
        if (/^[1-9]$/.test(event.key) && Number(event.key) <= visible.length) goTo(Number(event.key) - 1);
        else return;
    }
    event.preventDefault();
  };
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => keyHandler.current(event);
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  const railSteps = visible.map((entry) => ({ id: entry.id, label: entry.label, count: entry.count(ctx) }));
  const heading = typeof step.heading === 'function' ? step.heading(review) : step.heading;
  const summary = step.summary(ctx);
  const previous = visible[index - 1];
  const next = visible[index + 1];
  const thisWeek = mondayOfLocal(review.today);
  const viewingCurrent = review.range.start === thisWeek;
  const range = formatWeekRange(review.range.start);
  const weekLabel = viewingCurrent ? null : review.range.start === mondayOfLocal(shiftLocal(review.today, -7)) ? 'Last week' : null;
  const sheetGroups: ShortcutGroup[] = [{ group: 'Review', keys: GENERAL_KEYS }, { group: step.label, keys: step.keys }];

  return (
    <div className="review-mode" data-testid="weekly-review">
      <div aria-live="polite" className="sr-only"><span key={announcement.n}>{announcement.text}</span></div>
      <ReviewHeader
        range={range}
        weekLabel={weekLabel}
        onSwitchWeek={viewingCurrent ? undefined : { label: 'Switch to this week', run: () => onWeekChange(thisWeek) }}
        stepLabel={step.label}
        stepIndex={index}
        stepTotal={visible.length}
        onExit={exit}
        onShortcuts={(anchor) => setSheet({ kind: 'keys', anchor })}
        onPhoneSteps={(anchor) => setSheet({ kind: 'steps', anchor })}
      />
      <div className="review-frame">
        <ReviewStepsRail steps={railSteps} currentIndex={index} left={left} onSelect={goTo} />
        <main className="review-main" aria-labelledby="review-step-heading">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={step.id}
              className="review-step-pane"
              initial={reduceMotion ? false : { opacity: 0, x: 8 }}
              animate={{ opacity: 1, x: 0 }}
              exit={reduceMotion ? undefined : { opacity: 0 }}
              transition={{ duration: reduceMotion ? 0 : 0.16, ease: [0.16, 1, 0.3, 1] }}
            >
              <div className="review-heading">
                <StepHeading id="review-step-heading">{heading}</StepHeading>
                {summary ? <span className="review-summary">{summary}</span> : null}
              </div>
              <step.Component ctx={ctx} />
            </motion.div>
          </AnimatePresence>
          {previous || next ? (
            <footer className="review-footer">
              <div className="review-footer-inner">
                {previous ? (
                  <button type="button" className="ui-btn-secondary" onClick={() => goTo(index - 1)}>
                    <ArrowLeft size={14} aria-hidden="true" />
                    {previous.label}
                  </button>
                ) : <span />}
                {next ? (
                  <button type="button" className="ui-btn-solid" onClick={() => goTo(index + 1)}>
                    {next.label}
                    <ArrowRight size={14} aria-hidden="true" />
                  </button>
                ) : null}
              </div>
            </footer>
          ) : null}
        </main>
      </div>
      {sheet?.kind === 'keys' ? <ShortcutSheet anchor={sheet.anchor} groups={sheetGroups} onClose={() => setSheet(null)} /> : null}
      {sheet?.kind === 'steps' ? (
        <TaskPopover anchor={sheet.anchor} role="dialog" label="Review steps" width={260} onClose={() => setSheet(null)}>
          <div data-autofocus="" tabIndex={-1} className="outline-none">
            <ReviewStepsRail
              variant="list"
              steps={railSteps}
              currentIndex={index}
              left={left}
              onSelect={(target) => { setSheet(null); goTo(target); }}
            />
          </div>
        </TaskPopover>
      ) : null}
    </div>
  );
}

function shiftLocal(isoDay: string, days: number): string {
  const [year, month, day] = isoDay.split('-').map(Number) as [number, number, number];
  const date = new Date(year, month - 1, day + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
