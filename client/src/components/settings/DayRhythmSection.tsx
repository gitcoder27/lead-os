import { useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useToast } from '@/context/ToastContext';
import { useTodayRhythmSettings, useUpdateTodayRhythmSettings } from '@/hooks/useTodayRhythmSettings';
import { DEFAULT_TODAY_RHYTHM_BOUNDARIES, type TodayRhythmBoundaries } from '@/types';

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
      await update.mutateAsync(draft);
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

  return (
    <form
      className="max-w-[560px] space-y-5"
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
  );
}
