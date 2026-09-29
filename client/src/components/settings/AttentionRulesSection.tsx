import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useToast } from '@/context/ToastContext';
import { useAttentionRules, useUpdateAttentionRules } from '@/hooks/useAttentionRules';
import { useTeamMode } from '@/hooks/useTeamMode';
import {
  ATTENTION_RULE_LIMITS,
  validateAttentionRules,
  type AttentionRuleNumberKey,
  type AttentionRules,
} from '@/types';

type Draft = Record<AttentionRuleNumberKey, string> & Pick<AttentionRules, 'dayStart' | 'dayEnd' | 'timeZone'>;

const NUMBER_FIELDS: Array<{ key: AttentionRuleNumberKey; label: string; unit: string; hint: string; collabOnly?: boolean }> = [
  {
    key: 'managerTouchDays',
    label: 'Untouched after',
    unit: 'working days',
    hint: 'People you track yourself show as untouched when you have not reviewed, noted or updated them for this long.',
  },
  {
    key: 'staleHours',
    label: 'Stale check-in after',
    unit: 'working hours',
    hint: 'Developers who log in and check in read as stale after this long without a check-in of their own.',
    collabOnly: true,
  },
  {
    key: 'noCurrentHours',
    label: 'No current work after',
    unit: 'working hours',
    hint: 'How long someone can go without a current task before it is flagged.',
  },
  {
    key: 'statusFollowUpHours',
    label: 'Status follow-up after',
    unit: 'working hours',
    hint: 'A blocked, at-risk or waiting change with no follow-up is flagged after this long.',
  },
  {
    key: 'jiraStaleHours',
    label: 'Jira issue stale after',
    unit: 'weekday hours',
    hint: 'Hours since the last Jira update. Weekends do not count.',
  },
];

function toDraft(rules: AttentionRules): Draft {
  return {
    staleHours: String(rules.staleHours),
    noCurrentHours: String(rules.noCurrentHours),
    statusFollowUpHours: String(rules.statusFollowUpHours),
    managerTouchDays: String(rules.managerTouchDays),
    jiraStaleHours: String(rules.jiraStaleHours),
    dayStart: rules.dayStart,
    dayEnd: rules.dayEnd,
    timeZone: rules.timeZone,
  };
}

function fromDraft(draft: Draft): AttentionRules {
  const toNumber = (value: string) => (value.trim() === '' ? Number.NaN : Number(value));
  return {
    staleHours: toNumber(draft.staleHours),
    noCurrentHours: toNumber(draft.noCurrentHours),
    statusFollowUpHours: toNumber(draft.statusFollowUpHours),
    managerTouchDays: toNumber(draft.managerTouchDays),
    jiraStaleHours: toNumber(draft.jiraStaleHours),
    dayStart: draft.dayStart,
    dayEnd: draft.dayEnd,
    timeZone: draft.timeZone.trim(),
  };
}

function isTimeZone(value: string): boolean {
  if (!value) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

const FIELD_LABELS: Record<AttentionRuleNumberKey, string> = Object.fromEntries(
  NUMBER_FIELDS.map((field) => [field.key, field.label]),
) as Record<AttentionRuleNumberKey, string>;

/** Uses the shared rule (`validateAttentionRules`) with friendlier wording; the server stays the authority. */
export function validateAttentionDraft(rules: AttentionRules): string | undefined {
  const problem = validateAttentionRules(rules);
  if (problem) {
    const key = (Object.keys(ATTENTION_RULE_LIMITS) as AttentionRuleNumberKey[]).find((field) => problem.startsWith(field));
    if (key) {
      const { min, max } = ATTENTION_RULE_LIMITS[key];
      return `${FIELD_LABELS[key]}: enter a whole number from ${min} to ${max}.`;
    }
    return problem.endsWith('.') ? problem : `${problem}.`;
  }
  if (!isTimeZone(rules.timeZone)) return 'Time zone: enter a zone like Europe/London.';
  return undefined;
}

const sameRules = (a: AttentionRules, b: AttentionRules) =>
  (Object.keys(a) as Array<keyof AttentionRules>).every((key) => a[key] === b[key]);

function browserTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

/**
 * docs/56 P1-05: Settings → Attention rules. One place for every threshold
 * behind stale, untouched, no-current and follow-up signals, plus the working
 * day they are measured in. Saved through `PUT /api/config/attention-rules`.
 */
export function AttentionRulesSection() {
  const query = useAttentionRules();
  const update = useUpdateAttentionRules();
  const teamMode = useTeamMode();
  const { addToast } = useToast();
  const saved = query.data?.rules;
  const defaults = query.data?.defaults;
  const [draft, setDraft] = useState<Draft | undefined>(undefined);

  useEffect(() => {
    if (saved) setDraft(toDraft(saved));
  }, [saved]);

  const rules = draft ? fromDraft(draft) : undefined;
  const error = rules ? validateAttentionDraft(rules) : undefined;
  const dirty = Boolean(rules && saved && !sameRules(rules, saved));
  const isDefault = Boolean(rules && defaults && sameRules(rules, defaults));
  const localZone = browserTimeZone();

  const save = async () => {
    if (!rules || error || update.isPending) return;
    try {
      await update.mutateAsync(rules);
      addToast({ type: 'success', title: 'Attention rules saved', message: 'Signals across Today and Team use these rules now.' });
    } catch (mutationError) {
      addToast({
        type: 'error',
        title: 'Could not save attention rules',
        message: mutationError instanceof Error ? mutationError.message : 'Please try again.',
      });
    }
  };

  if (query.isError) {
    return (
      <p role="alert" className="text-[13px]" style={{ color: 'var(--danger)' }}>
        Could not load your attention rules.{' '}
        <button type="button" className="underline" onClick={() => void query.refetch()}>Retry</button>
      </p>
    );
  }

  if (!draft) {
    return (
      <p className="flex items-center gap-2 text-[13px]" style={{ color: 'var(--text-muted)' }}>
        <Loader2 size={13} className="animate-spin" aria-hidden="true" /> Loading attention rules…
      </p>
    );
  }

  const set = (key: keyof Draft, value: string) => setDraft((current) => (current ? { ...current, [key]: value } : current));

  return (
    <form
      className="max-w-[600px] space-y-6"
      aria-label="Attention rules"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <p className="text-[12px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
        These rules decide when someone or something needs your attention. Hours count working time only:
        weekdays between the start and end of your day, so nobody reads as stale first thing in the morning or after a weekend.
      </p>

      <fieldset className="space-y-4">
        <legend className="text-[12px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Working day</legend>
        <div className="flex flex-wrap gap-4">
          <label className="block">
            <span className="text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>Day starts</span>
            <input type="time" value={draft.dayStart} onChange={(event) => set('dayStart', event.target.value)} className="ui-field mt-1.5 block w-[140px]" />
          </label>
          <label className="block">
            <span className="text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>Day ends</span>
            <input type="time" value={draft.dayEnd} onChange={(event) => set('dayEnd', event.target.value)} className="ui-field mt-1.5 block w-[140px]" />
          </label>
        </div>
        <label className="block">
          <span className="text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>Time zone</span>
          <span className="mt-0.5 block text-[12px]" style={{ color: 'var(--text-muted)' }}>The working day is measured here, whoever is looking.</span>
          <span className="mt-1.5 flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={draft.timeZone}
              onChange={(event) => set('timeZone', event.target.value)}
              className="ui-field w-[240px]"
              spellCheck={false}
              aria-label="Time zone"
            />
            {localZone && localZone !== draft.timeZone ? (
              <button type="button" className="ui-btn-ghost" onClick={() => set('timeZone', localZone)}>
                Use {localZone}
              </button>
            ) : null}
          </span>
        </label>
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="text-[12px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Thresholds</legend>
        {NUMBER_FIELDS.map((field) => (
          <label key={field.key} className="block">
            <span className="text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>
              {field.label}
              {field.collabOnly && teamMode === 'solo' ? (
                <span className="ml-2 text-[11px] font-normal" style={{ color: 'var(--text-muted)' }}>Collaborative mode only</span>
              ) : null}
            </span>
            <span className="mt-0.5 block text-[12px]" style={{ color: 'var(--text-muted)' }}>{field.hint}</span>
            <span className="mt-1.5 flex items-center gap-2">
              <input
                type="number"
                inputMode="numeric"
                min={ATTENTION_RULE_LIMITS[field.key].min}
                max={ATTENTION_RULE_LIMITS[field.key].max}
                step={1}
                value={draft[field.key]}
                onChange={(event) => set(field.key, event.target.value)}
                className="ui-field w-[100px]"
                aria-label={field.label}
              />
              <span className="text-[12px]" style={{ color: 'var(--text-muted)' }}>{field.unit}</span>
            </span>
          </label>
        ))}
      </fieldset>

      {error ? (
        <p role="alert" className="text-[12.5px]" style={{ color: 'var(--danger)' }}>{error}</p>
      ) : null}

      <div className="flex items-center gap-2">
        <button type="submit" className="ui-btn-solid" disabled={!dirty || Boolean(error) || update.isPending}>
          {update.isPending ? <Loader2 size={13} className="animate-spin" aria-hidden="true" /> : null}
          Save rules
        </button>
        <button
          type="button"
          className="ui-btn-ghost"
          disabled={!defaults || isDefault || update.isPending}
          onClick={() => defaults && setDraft(toDraft(defaults))}
        >
          Reset to defaults
        </button>
      </div>
    </form>
  );
}
