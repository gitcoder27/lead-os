import { useMemo } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { ArrowLeft, CheckCheck, ClipboardCopy, LogOut, RotateCcw } from 'lucide-react';
import type { TrackerDeveloperDay } from '@/types';
import {
  describeLogEntry,
  followUpReasons,
  needsFollowUp,
  sessionTotals,
  type StandupSession,
} from '@/lib/standup';
import { TrackerStatusPill } from '../TrackerStatusPill';
import { Avatar, Kbd, SectionLabel, ToneChip } from './StandupPrimitives';

/** docs/50 §5: end-of-session review — coverage, follow-ups, and what was logged. */
export function StandupWrapUp({
  date,
  days,
  session,
  sealing = false,
  onJump,
  onBack,
  onEnd,
  onCopy,
  onReset,
}: {
  date: string;
  days: TrackerDeveloperDay[];
  session: StandupSession;
  /** True while the End request is in flight. */
  sealing?: boolean;
  onJump: (accountId: string) => void;
  onBack: () => void;
  onEnd: () => void;
  onCopy: () => void;
  onReset: () => void;
}) {
  const reduceMotion = useReducedMotion();
  const reviewed = useMemo(() => new Set(session.reviewed), [session.reviewed]);
  const flagged = useMemo(() => new Set(session.flagged), [session.flagged]);
  const totals = sessionTotals(session);
  const reviewedCount = days.filter((day) => reviewed.has(day.developer.accountId)).length;
  const complete = reviewedCount === days.length;

  const followUps = days
    .map((day) => ({ day, reasons: followUpReasons(day, date, flagged.has(day.developer.accountId)) }))
    .filter(({ reasons }) => needsFollowUp(reasons));
  const unreviewed = days.filter((day) => !reviewed.has(day.developer.accountId));
  const logged = days
    .map((day) => ({ day, entries: session.log.filter((entry) => entry.accountId === day.developer.accountId) }))
    .filter(({ entries }) => entries.length > 0);

  const tiles: Array<[string, number | string, string?]> = [
    ['Reviewed', `${reviewedCount}/${days.length}`, complete ? 'var(--success)' : undefined],
    ['Updates', totals.updates],
    ['Check-ins', totals.checkins],
    ['Closed', totals.closed, totals.closed ? 'var(--success)' : undefined],
    ['Status changes', totals.statusChanges],
  ];

  return (
    <motion.div
      initial={reduceMotion ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
      className="mx-auto w-full max-w-[920px] px-5 py-6"
      data-testid="standup-wrapup"
    >
      <div className="flex flex-wrap items-start gap-3">
        <div
          className="flex h-10 w-10 items-center justify-center rounded-xl"
          style={{ background: complete ? 'color-mix(in srgb, var(--success) 14%, transparent)' : 'var(--accent-glow)', color: complete ? 'var(--success)' : 'var(--accent)' }}
        >
          <CheckCheck size={18} />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-[19px] font-semibold tracking-[-0.01em]" style={{ color: 'var(--text-primary)' }}>
            {complete ? 'Standup complete' : `${unreviewed.length} not reviewed yet`}
          </h2>
          <p className="mt-0.5 text-[12.5px]" style={{ color: 'var(--text-muted)' }}>
            {complete ? 'Everyone was covered.' : 'You can still jump back to anyone below, or wrap up now.'}
            {' '}Ending seals this session, saves the summary to today&rsquo;s note
            {flagged.size > 0 ? `, and creates ${flagged.size} follow-up task${flagged.size === 1 ? '' : 's'}` : ''}.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <WrapButton onClick={onCopy} icon={<ClipboardCopy size={13} />} disabled={sealing}>Copy summary</WrapButton>
          <WrapButton onClick={onBack} icon={<ArrowLeft size={13} />} kbd="←" disabled={sealing}>Back</WrapButton>
          <WrapButton onClick={onEnd} icon={<LogOut size={13} />} kbd="↵" primary disabled={sealing}>{sealing ? 'Ending…' : 'End standup'}</WrapButton>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-5">
        {tiles.map(([label, value, color]) => (
          <div key={label} className="rounded-xl px-3.5 py-3" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)' }}>
            <div className="text-[10px] font-semibold uppercase tracking-[0.09em]" style={{ color: 'var(--text-muted)' }}>{label}</div>
            <div className="mt-1 text-[22px] font-semibold leading-none tabular-nums" style={{ color: color ?? 'var(--text-primary)' }}>{value}</div>
          </div>
        ))}
      </div>

      <div className="mt-6 grid gap-6 md:grid-cols-2">
        <section>
          <SectionLabel>Needs follow-up · {followUps.length}</SectionLabel>
          {followUps.length === 0 ? (
            <EmptyLine>Nobody flagged or at risk.</EmptyLine>
          ) : (
            <ul className="overflow-hidden rounded-xl" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)' }}>
              {followUps.map(({ day, reasons }) => (
                <PersonRow key={day.developer.accountId} day={day} onClick={() => onJump(day.developer.accountId)}>
                  <span className="flex flex-wrap gap-1">
                    {reasons.map((reason) => <ToneChip key={reason.code} tone={reason.tone}>{reason.label}</ToneChip>)}
                  </span>
                </PersonRow>
              ))}
            </ul>
          )}
        </section>

        <section>
          <SectionLabel>Not reviewed · {unreviewed.length}</SectionLabel>
          {unreviewed.length === 0 ? (
            <EmptyLine tone="success">Everyone reviewed.</EmptyLine>
          ) : (
            <ul className="overflow-hidden rounded-xl" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)' }}>
              {unreviewed.map((day) => (
                <PersonRow key={day.developer.accountId} day={day} onClick={() => onJump(day.developer.accountId)}>
                  <TrackerStatusPill status={day.status} />
                </PersonRow>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="mt-6">
        <SectionLabel>Logged this session · {session.log.length}</SectionLabel>
        {logged.length === 0 ? (
          <EmptyLine>No updates, check-ins, or task changes logged yet.</EmptyLine>
        ) : (
          <div className="space-y-2">
            {logged.map(({ day, entries }) => (
              <div key={day.developer.accountId} className="flex gap-3 rounded-xl px-3.5 py-2.5" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)' }}>
                <Avatar name={day.developer.displayName} size={26} />
                <div className="min-w-0 flex-1">
                  <div className="text-[12.5px] font-semibold" style={{ color: 'var(--text-primary)' }}>{day.developer.displayName}</div>
                  <ul className="mt-0.5 space-y-0.5">
                    {entries.map((entry, index) => (
                      <li key={`${entry.at}-${index}`} className="text-[12px]" style={{ color: 'var(--text-secondary)' }}>
                        {describeLogEntry(entry)}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="mt-6 flex justify-end">
        <button
          type="button"
          onClick={onReset}
          className="inline-flex items-center gap-1 text-[11.5px] font-medium hover:underline"
          style={{ color: 'var(--text-muted)' }}
        >
          <RotateCcw size={11} /> Reset session
        </button>
      </div>
    </motion.div>
  );
}

function PersonRow({ day, onClick, children }: { day: TrackerDeveloperDay; onClick: () => void; children: React.ReactNode }) {
  return (
    <li className="[&:not(:first-child)]:border-t" style={{ borderColor: 'var(--border)' }}>
      <button
        type="button"
        onClick={onClick}
        className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-[var(--bg-tertiary)]"
        aria-label={`Go to ${day.developer.displayName}`}
      >
        <Avatar name={day.developer.displayName} size={24} />
        <span className="w-[130px] shrink-0 truncate text-[12.5px] font-semibold" style={{ color: 'var(--text-primary)' }}>
          {day.developer.displayName}
        </span>
        <span className="min-w-0 flex-1">{children}</span>
      </button>
    </li>
  );
}

function EmptyLine({ children, tone }: { children: React.ReactNode; tone?: 'success' }) {
  return (
    <div
      className="rounded-xl px-3.5 py-3 text-[12.5px]"
      style={{ color: tone === 'success' ? 'var(--success)' : 'var(--text-muted)', border: '1px dashed var(--border-strong)' }}
    >
      {children}
    </div>
  );
}

function WrapButton({
  onClick,
  icon,
  kbd,
  primary,
  disabled,
  children,
}: {
  onClick: () => void;
  icon: React.ReactNode;
  kbd?: string;
  primary?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[12px] font-semibold transition-colors disabled:opacity-50"
      style={
        primary
          ? { background: 'var(--accent)', color: '#fff' }
          : { color: 'var(--text-secondary)', border: '1px solid var(--border)', background: 'var(--bg-secondary)' }
      }
    >
      {icon}
      {children}
      {kbd && <Kbd subtle>{kbd}</Kbd>}
    </button>
  );
}
