import { useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useToast } from '@/context/ToastContext';
import { useTodayRhythmSettings, useUpdateTodayRhythmSettings } from '@/hooks/useTodayRhythmSettings';
import { DEFAULT_TODAY_RHYTHM_BOUNDARIES, DEFAULT_WEEKLY_REVIEW_DAY, type TodayRhythmBoundaries } from '@/types';

/** docs/59 §5.1: the review is a workday habit; a saved Saturday or Sunday still shows as chosen. */
const REVIEW_DAYS: Array<{ value: number; label: string }> = [
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
];
const OTHER_DAYS: Record<number, string> = { 0: 'Sunday', 6: 'Saturday' };

const FIELDS: Array<{ key: keyof TodayRhythmBoundaries; label: string; hint: string }> = [
  { key: 'standupStart', label: 'Standup window starts', hint: 'Before this it is your morning plan.' },
  { key: 'middayStart', label: 'Midday check starts', hint: 'After standup: what is due soon, and who has gone quiet.' },
  { key: 'wrapUpStart', label: 'Wrap-up starts', hint: 'Close loops, carry work forward, write the end-of-day note.' },
];

const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Mirrors the server rule (`validateRhythmBoundaries`); the server stays the authority. */
export function validateRhythm(values: TodayRhythmBoundaries): string | undefined {
  if (![values.standupStart, values.middayStart, values.wrapUpStart].every((time) => CLOCK.test(time))) {
    return 'Enter each time as HH:MM.';
  }
  if (!(values.standupStart < values.middayStart && values.middayStart < values.wrapUpStart)) {
    return 'Times must run in order: standup, then midday, then wrap-up.';
  }
  return undefined;
}

const same = (a: TodayRhythmBoundaries, b: TodayRhythmBoundaries) =>
  a.standupStart === b.standupStart && a.middayStart === b.middayStart && a.wrapUpStart === b.wrapUpStart;

/** docs/56 P2-05: Settings → Day Rhythm. Stage times for Today, saved through `PUT /api/today/settings`. */
export function DayRhythmSection() {
  const settings = useTodayRhythmSettings();
  const update = useUpdateTodayRhythmSettings();
  const { addToast } = useToast();
  const saved = settings.data?.boundaries;
  const [draft, setDraft] = useState<TodayRhythmBoundaries>(DEFAULT_TODAY_RHYTHM_BOUNDARIES);

  useEffect(() => {
    if (saved) setDraft(saved);
  }, [saved]);

  const error = useMemo(() => validateRhythm(draft), [draft]);
  const dirty = saved ? !same(draft, saved) : false;
  const isDefault = same(draft, DEFAULT_TODAY_RHYTHM_BOUNDARIES);

  const save = async () => {
    if (error || update.isPending) return;
    try {
      await update.mutateAsync({ boundaries: draft });
      addToast({ type: 'success', title: 'Day rhythm saved', message: 'Today follows these times from now on.' });
    } catch (mutationError) {
      addToast({
        type: 'error',
        title: 'Could not save day rhythm',
        message: mutationError instanceof Error ? mutationError.message : 'Please try again.',
      });
    }
  };

  if (settings.isError) {
    return (
      <p role="alert" className="text-[13px]" style={{ color: 'var(--danger)' }}>
        Could not load your day rhythm.{' '}
        <button type="button" className="underline" onClick={() => void settings.refetch()}>Retry</button>
      </p>
    );
  }

  const reviewDay = settings.data?.weeklyReviewDay ?? DEFAULT_WEEKLY_REVIEW_DAY;
  const inWrapUp = settings.data?.weeklyReviewInWrapUp ?? true;
  const saveReview = async (change: { weeklyReviewDay?: number; weeklyReviewInWrapUp?: boolean }) => {
    try {
      await update.mutateAsync(change);
      addToast({ type: 'success', title: 'Weekly review saved' });
    } catch (mutationError) {
      addToast({
        type: 'error',
        title: 'Could not save the weekly review',
        message: mutationError instanceof Error ? mutationError.message : 'Please try again.',
      });
    }
  };

  return (
    <div className="max-w-[560px] space-y-8">
      <form
        className="space-y-5"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <p className="text-[12px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
          Today changes with the time of day: morning plan, standup window, midday check, then wrap-up.
          Set when each one starts, in your own time zone.
        </p>

        <div className="space-y-4">
          {FIELDS.map((field) => (
            <label key={field.key} className="block">
              <span className="text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>{field.label}</span>
              <span className="mt-0.5 block text-[12px]" style={{ color: 'var(--text-muted)' }}>{field.hint}</span>
              <input
                type="time"
                value={draft[field.key]}
                disabled={settings.isLoading}
                onChange={(event) => setDraft((current) => ({ ...current, [field.key]: event.target.value }))}
                className="ui-field mt-1.5 w-[140px]"
                aria-invalid={Boolean(error)}
              />
            </label>
          ))}
        </div>

        {error ? (
          <p role="alert" className="text-[12.5px]" style={{ color: 'var(--danger)' }}>{error}</p>
        ) : null}

        <div className="flex items-center gap-2">
          <button type="submit" className="ui-btn-solid" disabled={!dirty || Boolean(error) || update.isPending}>
            {update.isPending ? <Loader2 size={13} className="animate-spin" aria-hidden="true" /> : null}
            Save times
          </button>
          <button
            type="button"
            className="ui-btn-ghost"
            disabled={isDefault || update.isPending}
            onClick={() => setDraft(DEFAULT_TODAY_RHYTHM_BOUNDARIES)}
          >
            Reset to defaults
          </button>
        </div>
      </form>

    <section className="space-y-4" aria-labelledby="weekly-review-settings">
      <div>
        <h3 id="weekly-review-settings" className="text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>Weekly review</h3>
        <p className="mt-0.5 text-[12px]" style={{ color: 'var(--text-muted)' }}>
          A ten-minute close to the week, offered in Today on the day you pick.
        </p>
      </div>
      <label className="block">
        <span className="text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>Weekly review day</span>
        <select
          className="ui-field mt-1.5 w-[180px]"
          value={reviewDay}
          disabled={settings.isLoading || update.isPending}
          onChange={(event) => void saveReview({ weeklyReviewDay: Number(event.target.value) })}
        >
          {REVIEW_DAYS.map((day) => <option key={day.value} value={day.value}>{day.label}</option>)}
          {OTHER_DAYS[reviewDay] ? <option value={reviewDay}>{OTHER_DAYS[reviewDay]}</option> : null}
        </select>
      </label>
      <label className="flex items-start gap-2.5">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={inWrapUp}
          disabled={settings.isLoading || update.isPending}
          onChange={(event) => void saveReview({ weeklyReviewInWrapUp: event.target.checked })}
        />
        <span>
          <span className="block text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>Show it in wrap-up</span>
          <span className="mt-0.5 block text-[12px]" style={{ color: 'var(--text-muted)' }}>
            Today offers the review that afternoon, and the catch-up on Monday and Tuesday if you skipped it.
          </span>
        </span>
      </label>
    </section>
    </div>
  );
}
