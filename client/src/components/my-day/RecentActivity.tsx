import { AnimatePresence, motion } from 'framer-motion';
import { format } from 'date-fns';
import type { MyDayTaskUpdate, TrackerCheckIn } from '@/types';
import { formatAbsoluteDateTime } from '@/lib/utils';
import { getStatusInfo } from './status-config';
import { HAIRLINE } from './MyDayUI';
import { useAuth } from '@/context/AuthContext';

interface RecentActivityProps {
  checkIns: TrackerCheckIn[];
  /** Your own task updates and blockers for the day, merged into the log by time. */
  taskUpdates?: MyDayTaskUpdate[];
  isToday?: boolean;
}

type LogEntry =
  | { kind: 'check-in'; key: string; at: string; checkIn: TrackerCheckIn }
  | { kind: 'task-update'; key: string; at: string; update: MyDayTaskUpdate };

/** Newest first, so the highlighted lead entry is the latest thing logged. */
function mergeLog(checkIns: TrackerCheckIn[], taskUpdates: MyDayTaskUpdate[]): LogEntry[] {
  const entries: LogEntry[] = [
    ...checkIns.map((checkIn): LogEntry => ({ kind: 'check-in', key: `c-${checkIn.id}`, at: checkIn.createdAt, checkIn })),
    ...taskUpdates.map((update): LogEntry => ({ kind: 'task-update', key: `t-${update.id}`, at: update.occurredAt, update })),
  ];
  return entries.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
}

/**
 * The day's log — your check-ins, your task updates, and anything your
 * manager wrote back. A thin rail with time on the left keeps it scannable.
 */
export function RecentActivity({ checkIns, taskUpdates = [], isToday = true }: RecentActivityProps) {
  const { workspaceManager } = useAuth();
  const entries = mergeLog(checkIns, taskUpdates);
  if (entries.length === 0) {
    return (
      <div className="px-4 py-5">
        <p className="text-body font-medium" style={{ color: 'var(--text-secondary)' }}>
          {isToday ? 'Nothing logged yet' : 'Nothing logged this day'}
        </p>
        {isToday && (
          <p className="mt-1 text-body leading-[18px]" style={{ color: 'var(--text-muted)' }}>
            {workspaceManager ? `Updates you send show up here — and on the team board for ${workspaceManager.displayName}.` : 'Updates you send show up here — and on the team board.'}
          </p>
        )}
      </div>
    );
  }

  return (
    <ol className="relative px-4 py-3" aria-label="Check-ins">
      <AnimatePresence initial={false}>
        {entries.map((entry, idx) => {
          const ci = entry.kind === 'check-in' ? entry.checkIn : undefined;
          const update = entry.kind === 'task-update' ? entry.update : undefined;
          const fromManager = ci?.authorType === 'manager';
          const authorName = ci?.authorDisplayName || (ci?.authorAccountId === workspaceManager?.accountId ? workspaceManager?.displayName : undefined);
          const status = ci?.status ? getStatusInfo(ci.status) : null;
          const blocker = update?.type === 'blocker' ? (update.blockerAction === 'cleared' ? 'Blocker cleared' : 'Blocker raised') : null;
          const summary = ci?.summary ?? update?.body ?? '';
          const taskKeys = ci ? ci.taskKeys ?? [] : update ? [update.taskKey] : [];
          const isLast = idx === entries.length - 1;
          return (
            <motion.li
              key={entry.key}
              layout="position"
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25 }}
              className="relative grid grid-cols-[58px_12px_minmax(0,1fr)] gap-x-2"
            >
              <time
                dateTime={entry.at}
                title={formatAbsoluteDateTime(entry.at)}
                className="pt-px text-right text-ui tabular-nums leading-5"
                style={{ color: 'var(--text-muted)' }}
              >
                {format(new Date(entry.at), 'h:mm a')}
              </time>

              <span className="relative flex justify-center" aria-hidden="true">
                <span
                  className="relative z-1 mt-[7px] h-[7px] w-[7px] rounded-full"
                  style={{
                    background: fromManager || idx === 0 ? 'var(--accent)' : 'var(--border-strong)',
                    boxShadow: idx === 0 ? '0 0 0 3px color-mix(in srgb, var(--accent) 18%, transparent)' : undefined,
                  }}
                />
                {!isLast && <span className="absolute bottom-0 top-[18px] w-px" style={{ background: HAIRLINE }} />}
              </span>

              <div className={`min-w-0 ${isLast ? '' : 'pb-4'}`}>
                {(fromManager || status || blocker) && (
                  <div className="mb-0.5 flex flex-wrap items-center gap-x-2 text-ui font-medium leading-5">
                    {fromManager && <span style={{ color: 'var(--accent-text)' }}>{authorName ? `From ${authorName}` : 'Shared update'}</span>}
                    {blocker && (
                      <span className="inline-flex items-center gap-1" style={{ color: update?.blockerAction === 'cleared' ? 'var(--text-secondary)' : 'var(--danger)' }}>
                        {blocker}
                      </span>
                    )}
                    {status && (
                      <span className="inline-flex items-center gap-1" style={{ color: status.color }}>
                        <span className="h-1.5 w-1.5 rounded-full" style={{ background: status.color }} aria-hidden="true" />
                        {status.label}
                      </span>
                    )}
                  </div>
                )}
                <p
                  className={`whitespace-pre-line wrap-break-word text-body leading-5 ${fromManager ? 'rounded-lg px-2.5 py-1.5' : ''}`}
                  style={{
                    color: 'var(--text-primary)',
                    background: fromManager ? 'color-mix(in srgb, var(--accent) 5%, transparent)' : undefined,
                    border: fromManager ? '1px solid color-mix(in srgb, var(--accent) 18%, transparent)' : undefined,
                  }}
                >
                  {summary}
                </p>
                {taskKeys.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {taskKeys.map((key) => (
                      <span
                        key={key}
                        className="rounded-md px-1.5 py-px font-mono text-meta font-semibold"
                        style={{ color: 'var(--text-muted)', background: 'color-mix(in srgb, var(--bg-tertiary) 60%, transparent)', border: `1px solid ${HAIRLINE}` }}
                      >
                        {key}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </motion.li>
          );
        })}
      </AnimatePresence>
    </ol>
  );
}
