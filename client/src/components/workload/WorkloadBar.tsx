import { useState, type MouseEvent as ReactMouseEvent } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronUp, ChevronDown, Users, Zap } from 'lucide-react';
import { useWorkload } from '@/hooks/useWorkload';
import { DeveloperCard } from './DeveloperCard';
import { workloadAccent, workloadAssignedLabel, workloadChipText, workloadChipTitle } from '@/lib/utils';

interface WorkloadBarProps {
  activeDeveloper?: string;
  onDeveloperClick: (accountId?: string) => void;
}

export function WorkloadBar({ activeDeveloper, onDeveloperClick }: WorkloadBarProps) {
  const { data: workload, isLoading } = useWorkload();
  const [expanded, setExpanded] = useState(false);

  if (isLoading || !workload?.length) return null;

  function handleDeveloperSelect(accountId: string) {
    onDeveloperClick(activeDeveloper === accountId ? undefined : accountId);
  }

  function handleCollapsedHeaderClick(event: ReactMouseEvent<HTMLDivElement>) {
    if (expanded) return;
    if ((event.target as HTMLElement).closest('button')) return;
    setExpanded(true);
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: 0.6 }}
      className="flex flex-col shrink-0 border-t"
      style={{ borderColor: 'var(--border)' }}
    >
        <div className="overflow-hidden">
        <div className={`shrink-0 ${expanded ? 'px-2 py-1.5' : 'px-1.5 py-1'}`}>
          <div
            className={`flex items-center ${expanded ? 'gap-2.5' : 'gap-1.5 cursor-pointer rounded-2xl'}`}
            data-testid="workload-bar-header"
            onClick={handleCollapsedHeaderClick}
          >
            <button
              type="button"
              onClick={() => setExpanded((prev) => !prev)}
              className={`flex items-center text-left shrink-0 ${expanded ? 'min-w-0 flex-1 gap-2.5' : 'gap-2 rounded-full border pl-1.5 pr-2.5 py-1'}`}
              aria-expanded={expanded}
              aria-label={expanded ? 'Collapse workload panel' : 'Expand workload panel'}
              style={expanded ? undefined : {
                borderColor: 'var(--border)',
                background: 'color-mix(in srgb, var(--bg-secondary) 82%, transparent)',
              }}
            >
              <span className="h-7 w-7 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'var(--accent-glow)', color: 'var(--accent)' }}>
                <Users size={16} />
              </span>
              <span className="min-w-0 text-left">
                {expanded ? (
                  <>
                    <span
                      className="text-[12px] font-semibold uppercase block"
                      style={{ letterSpacing: '0.08em', color: 'var(--text-muted)' }}
                    >
                      Workload
                    </span>
                    <span className="text-[15px] font-medium block" style={{ color: 'var(--text-primary)' }}>
                      Team capacity radar
                    </span>
                  </>
                ) : (
                  <span className="flex items-center gap-2">
                    <span className="text-[13px] font-semibold uppercase" style={{ letterSpacing: '0.08em', color: 'var(--text-muted)' }}>
                      Workload
                    </span>
                    <span
                      className="rounded-full px-2 py-0.5 text-[12px] font-mono"
                      style={{ color: 'var(--text-secondary)', background: 'var(--bg-tertiary)' }}
                    >
                      {workload.length}
                    </span>
                  </span>
                )}
              </span>
            </button>

            {!expanded && (
              <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto no-scrollbar">
                {workload.map((dev) => {
                  const color = workloadAccent(dev);
                  const isActive = activeDeveloper === dev.developer.accountId;
                  const loadLabel = workloadAssignedLabel(dev);
                  const isIdle = dev.signals?.idle ?? false;
                  const hasMismatch = dev.signals?.backlogTrackerMismatch ?? false;
                  return (
                    <button
                      key={dev.developer.accountId}
                      type="button"
                      onClick={() => handleDeveloperSelect(dev.developer.accountId)}
                      aria-label={`Filter by ${dev.developer.displayName}`}
                      aria-description={workloadChipText(dev)}
                      title={workloadChipTitle(dev)}
                      aria-pressed={isActive}
                      className="flex items-center gap-1.5 shrink-0 rounded-full border px-2 py-1 transition-colors"
                      style={{
                        borderColor: isActive ? 'var(--accent)' : hasMismatch ? 'rgba(245,158,11,0.4)' : 'var(--border)',
                        background: isActive
                          ? 'color-mix(in srgb, var(--accent-glow) 78%, var(--bg-secondary) 22%)'
                          : 'color-mix(in srgb, var(--bg-tertiary) 84%, transparent)',
                      }}
                    >
                      <span
                        className="flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-semibold"
                        style={{
                          color: isActive ? 'var(--accent)' : color,
                          background: isActive ? 'rgba(255,255,255,0.55)' : `${color}18`,
                        }}
                      >
                        {dev.developer.displayName
                          .split(' ')
                          .filter(Boolean)
                          .slice(0, 1)
                          .map((part) => part[0]?.toUpperCase() ?? '')
                          .join('')}
                      </span>
                      <span
                        className="text-[12px] truncate"
                        style={{ color: isActive ? 'var(--accent)' : isIdle ? 'var(--text-muted)' : 'var(--text-secondary)', maxWidth: 76 }}
                      >
                        {dev.developer.displayName.split(' ')[0]}
                      </span>
                      <span className="text-[12px] font-semibold tabular-nums" style={{ color: isActive ? 'var(--accent)' : color }}>
                        {loadLabel} {dev.assignedTodayCount !== undefined ? 'today' : 'open'}
                      </span>
                      <span className="text-[12px] tabular-nums" style={{ color: isActive ? 'var(--accent)' : 'var(--text-muted)' }}>
                        {` · load ${dev.score}`}
                      </span>
                      {hasMismatch && !isActive && (
                        <Zap size={10} style={{ color: 'var(--warning)' }} />
                      )}
                    </button>
                  );
                })}
              </div>
            )}

            <button
              type="button"
              onClick={() => setExpanded((prev) => !prev)}
              className="shrink-0 h-7 w-7 rounded-xl flex items-center justify-center"
              style={{ background: 'var(--bg-tertiary)' }}
              aria-label={expanded ? 'Collapse workload panel' : 'Expand workload panel'}
            >
              {expanded ? (
                <ChevronDown size={14} style={{ color: 'var(--text-muted)' }} />
              ) : (
                <ChevronUp size={14} style={{ color: 'var(--text-muted)' }} />
              )}
            </button>
          </div>
        </div>

        <AnimatePresence>
          {expanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
              className="overflow-hidden"
            >
              <div
                className="px-3 pb-3 pt-1 overflow-y-auto"
                style={{ maxHeight: 240 }}
              >
                <div className="grid gap-2 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
                  {workload.map((dev) => (
                    <DeveloperCard
                      key={dev.developer.accountId}
                      dev={dev}
                      expanded={true}
                      active={activeDeveloper === dev.developer.accountId}
                      onClick={() => handleDeveloperSelect(dev.developer.accountId)}
                    />
                  ))}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
