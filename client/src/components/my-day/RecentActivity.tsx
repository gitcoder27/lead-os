import { AnimatePresence, motion } from 'framer-motion';
import { format } from 'date-fns';
import type { TrackerCheckIn } from '@/types';
import { formatAbsoluteDateTime } from '@/lib/utils';
import { getStatusInfo } from './status-config';
import { HAIRLINE } from './MyDayUI';

interface RecentActivityProps {
  checkIns: TrackerCheckIn[];
  isToday?: boolean;
}

/**
 * The day's check-in log — what you told your lead, and anything your lead
 * wrote back. A thin rail with time on the left keeps it scannable.
 */
export function RecentActivity({ checkIns, isToday = true }: RecentActivityProps) {
  if (checkIns.length === 0) {
    return (
      <div className="px-4 py-5">
        <p className="text-[13px] font-medium" style={{ color: 'var(--text-secondary)' }}>
          {isToday ? 'Nothing logged yet' : 'No check-ins this day'}
        </p>
        {isToday && (
          <p className="mt-1 text-[12.5px] leading-[18px]" style={{ color: 'var(--text-muted)' }}>
            Updates you send show up here — and on your lead’s team board.
          </p>
        )}
      </div>
    );
  }

  return (
    <ol className="relative px-4 py-3" aria-label="Check-ins">
      <AnimatePresence initial={false}>
        {checkIns.map((ci, idx) => {
          const fromLead = ci.authorType === 'manager';
          const status = ci.status ? getStatusInfo(ci.status) : null;
          const isLast = idx === checkIns.length - 1;
          return (
            <motion.li
              key={ci.id}
              layout="position"
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25 }}
              className="relative grid grid-cols-[58px_12px_minmax(0,1fr)] gap-x-2"
            >
              <time
                dateTime={ci.createdAt}
                title={formatAbsoluteDateTime(ci.createdAt)}
                className="pt-[1px] text-right text-[11.5px] tabular-nums leading-5"
                style={{ color: 'var(--text-muted)' }}
              >
                {format(new Date(ci.createdAt), 'h:mm a')}
              </time>

              <span className="relative flex justify-center" aria-hidden="true">
                <span
                  className="relative z-[1] mt-[7px] h-[7px] w-[7px] rounded-full"
                  style={{
                    background: fromLead ? 'var(--md-accent)' : idx === 0 ? 'var(--accent)' : 'var(--border-strong)',
                    boxShadow: idx === 0 ? `0 0 0 3px color-mix(in srgb, ${fromLead ? 'var(--md-accent)' : 'var(--accent)'} 18%, transparent)` : undefined,
                  }}
                />
                {!isLast && <span className="absolute bottom-0 top-[18px] w-px" style={{ background: HAIRLINE }} />}
              </span>

              <div className={`min-w-0 ${isLast ? '' : 'pb-4'}`}>
                {(fromLead || status) && (
                  <div className="mb-0.5 flex flex-wrap items-center gap-x-2 text-[11.5px] font-medium leading-5">
                    {fromLead && <span style={{ color: 'var(--md-accent)' }}>From your lead</span>}
                    {status && (
                      <span className="inline-flex items-center gap-1" style={{ color: status.color }}>
                        <span className="h-1.5 w-1.5 rounded-full" style={{ background: status.color }} aria-hidden="true" />
                        {status.label}
                      </span>
                    )}
                  </div>
                )}
                <p
                  className={`whitespace-pre-line break-words text-[13px] leading-5 ${fromLead ? 'rounded-lg px-2.5 py-1.5' : ''}`}
                  style={{
                    color: 'var(--text-primary)',
                    background: fromLead ? 'var(--md-accent-dim)' : undefined,
                    border: fromLead ? '1px solid color-mix(in srgb, var(--md-accent) 20%, transparent)' : undefined,
                  }}
                >
                  {ci.summary}
                </p>
                {(ci.taskKeys ?? []).length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {(ci.taskKeys ?? []).map((key) => (
                      <span
                        key={key}
                        className="rounded-md px-1.5 py-[1px] font-mono text-[10.5px] font-bold"
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
