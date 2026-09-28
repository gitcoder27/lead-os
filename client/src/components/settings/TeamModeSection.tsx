import type { ReactNode } from 'react';
import { Check, Loader2, User, Users } from 'lucide-react';
import { useToast } from '@/context/ToastContext';
import { useSetTeamMode, useTeamMode } from '@/hooks/useTeamMode';
import type { TeamMode } from '@/types';

const TEAM_MODE_OPTIONS: Array<{ id: TeamMode; icon: ReactNode; label: string; description: string }> = [
  {
    id: 'solo',
    icon: <User size={14} />,
    label: 'Solo',
    description: 'You track the team yourself. Developers do not log in, so missing check-ins are not treated as a problem.',
  },
  {
    id: 'collab',
    icon: <Users size={14} />,
    label: 'Collaborative',
    description: 'Developers with a login use My Day and check in. Check-in signals apply to them.',
  },
];

/** docs/56 P1-01: manager-only `team_mode` control (Settings → Team Members). */
export function TeamModeSection() {
  const teamMode = useTeamMode();
  const setTeamMode = useSetTeamMode();
  const { addToast } = useToast();

  const handleSelect = async (next: TeamMode) => {
    if (next === teamMode || setTeamMode.isPending) {
      return;
    }
    try {
      await setTeamMode.mutateAsync(next);
      addToast({
        type: 'success',
        title: next === 'solo' ? 'Solo mode on' : 'Collaborative mode on',
        message: next === 'solo' ? 'LeadOS no longer expects developers to check in.' : 'Developers with a login are expected to check in.',
      });
    } catch (error) {
      addToast({
        type: 'error',
        title: 'Could not change team mode',
        message: error instanceof Error ? error.message : 'Please try again.',
      });
    }
  };

  return (
    <div className="min-w-0">
      <div className="flex items-center gap-2">
        <h3 className="text-[12px] font-semibold uppercase tracking-[0.18em]" style={{ color: 'var(--text-muted)' }}>
          Team Mode
        </h3>
        {setTeamMode.isPending ? <Loader2 size={12} className="animate-spin" style={{ color: 'var(--text-muted)' }} /> : null}
      </div>
      <p className="mt-1 mb-3 text-[12px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
        Choose whether developers take part in LeadOS or you track the team on your own.
      </p>
      <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Team mode">
        {TEAM_MODE_OPTIONS.map((option) => {
          const selected = teamMode === option.id;
          return (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={setTeamMode.isPending}
              onClick={() => void handleSelect(option.id)}
              className="rounded-xl px-3.5 py-3 text-left transition-all active:scale-[0.99] disabled:opacity-70"
              style={{
                border: selected ? '1px solid color-mix(in srgb, var(--accent) 48%, transparent)' : 'var(--settings-inset-border)',
                background: selected ? 'var(--settings-accent-soft-bg)' : 'var(--settings-input-bg)',
                color: 'var(--text-primary)',
              }}
            >
              <span className="flex items-center gap-2">
                <span
                  className="flex h-7 w-7 items-center justify-center rounded-lg"
                  style={{
                    background: selected ? 'var(--accent)' : 'var(--bg-tertiary)',
                    color: selected ? '#fff' : 'var(--text-secondary)',
                  }}
                >
                  {option.icon}
                </span>
                <span className="min-w-0 flex-1 text-[13px] font-semibold leading-5">{option.label}</span>
                {selected ? <Check size={14} style={{ color: 'var(--accent)' }} /> : null}
              </span>
              <span className="mt-2 block text-[12px] leading-5" style={{ color: 'var(--text-secondary)' }}>
                {option.description}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
