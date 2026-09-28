import type { ReactNode } from 'react';
import { ChevronLeft, ChevronRight, Briefcase, RefreshCw } from 'lucide-react';
import type { ManagerDeskViewMode } from '@/types/manager-desk';

interface Props {
  displayDate: string;
  isTodayDate: boolean;
  isFetching: boolean;
  viewMode: ManagerDeskViewMode;
  commandBar?: ReactNode;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  onRefresh: () => void;
}

export function ManagerDeskHeader({
  displayDate,
  isTodayDate,
  isFetching,
  viewMode,
  commandBar,
  onPrev,
  onNext,
  onToday,
  onRefresh,
}: Props) {
  const modeLabel =
    viewMode === 'history' ? 'History'
      : viewMode === 'planning' ? 'Planning'
      : 'Live';

  return (
    <div className="sticky top-0 z-20 mx-auto w-full max-w-[1600px] px-2 pt-1.5 md:px-3">
      <div className="md-header-panel rounded-xl px-3 py-1.5">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-1.5 2xl:grid-cols-[auto_minmax(0,1fr)_auto] 2xl:items-center">
          <div className="flex min-w-0 items-center gap-2">
            <div
              className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md"
              style={{ background: 'var(--md-accent-glow)', color: 'var(--md-accent)' }}
            >
              <Briefcase size={13} />
            </div>

            <h1 className="hidden truncate text-[13px] font-semibold tracking-[-0.01em] sm:block" style={{ color: 'var(--text-primary)' }}>
              Desk
            </h1>

            <div className="h-4 w-px flex-shrink-0 hidden sm:block" style={{ background: 'var(--border)' }} />

            <div
              className="flex items-center rounded-lg border px-0.5 py-0.5"
              style={{ background: 'var(--bg-tertiary)', borderColor: 'var(--border)' }}
            >
              <NavBtn label="Previous day" onClick={onPrev}>
                <ChevronLeft size={13} />
              </NavBtn>
              <button
                type="button"
                onClick={onToday}
                className="rounded-md px-2 py-1 text-[12px] font-bold uppercase tracking-[0.12em]"
                style={{
                  background: isTodayDate ? 'var(--md-accent-glow)' : 'transparent',
                  color: isTodayDate ? 'var(--md-accent)' : 'var(--text-secondary)',
                }}
              >
                Today
              </button>
              <NavBtn label="Next day" onClick={onNext}>
                <ChevronRight size={13} />
              </NavBtn>
            </div>

            <span className="text-[12px] font-medium tabular-nums" style={{ color: 'var(--text-secondary)' }}>
              {displayDate}
            </span>

            <span
              className="rounded-md px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.1em]"
              style={{
                background: viewMode === 'history' ? 'rgba(59,130,246,0.10)' : viewMode === 'planning' ? 'rgba(6,182,212,0.10)' : 'var(--md-accent-glow)',
                color: viewMode === 'history' ? 'var(--info)' : viewMode === 'planning' ? 'var(--accent)' : 'var(--md-accent)',
              }}
            >
              {modeLabel}
            </span>
          </div>

          {commandBar && (
            <div className="col-span-2 min-w-0 2xl:col-span-1 2xl:col-start-2 2xl:row-start-1">
              {commandBar}
            </div>
          )}

          <div className="col-start-2 row-start-1 flex items-center justify-end gap-1 2xl:col-start-3">
            <ActionBtn onClick={onRefresh} label="Refresh" disabled={isFetching}>
              <RefreshCw size={11} className={isFetching ? 'animate-spin' : ''} />
            </ActionBtn>
          </div>
        </div>
      </div>
    </div>
  );
}

function NavBtn({ children, label, onClick }: { children: ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-6 w-6 items-center justify-center rounded-md transition-colors hover:opacity-80"
      style={{ color: 'var(--text-secondary)' }}
      title={label}
      aria-label={label}
    >
      {children}
    </button>
  );
}

function ActionBtn({ children, label, disabled = false, onClick }: { children: ReactNode; label: string; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex h-6 items-center gap-1 rounded-md border px-2 text-[11px] font-semibold uppercase tracking-[0.1em] transition-colors disabled:opacity-50"
      style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
      aria-label={label}
      title={label}
    >
      {children}
    </button>
  );
}
