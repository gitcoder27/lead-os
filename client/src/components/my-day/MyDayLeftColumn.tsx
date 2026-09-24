import { motion } from 'framer-motion';
import { Target, Zap, CheckCircle2, MessageSquare } from 'lucide-react';
import type { AuthUser, MyDayResponse, TrackerDeveloperStatus } from '@/types';
import { tasksFromItems } from '@/components/tasks/TaskPicker';
import { MyDayHeader } from './MyDayHeader';
import { StatusSelector } from './StatusSelector';
import { CurrentTask } from './CurrentTask';
import { CompletedWork } from './CompletedWork';
import { DroppedWork } from './DroppedWork';
import { QuickUpdates } from './QuickUpdates';
import { MyDayInactiveBanner } from './MyDayInactiveBanner';

interface MyDayLeftColumnProps {
  date: string;
  user: AuthUser | null;
  day: MyDayResponse | undefined;
  isFetching: boolean;
  theme: string;
  onRefresh: () => void;
  onToggleTheme: () => void;
  onLogout: () => void;
  handleStatusUpdate: (s: TrackerDeveloperStatus) => void;
  updateStatusPending: boolean;
  handleMarkDone: (id: number) => void;
  handleDrop: (id: number) => void;
  handleUpdateItemTitle: (id: number, title: string) => void;
  handleAddCheckIn: (summary: string, status?: TrackerDeveloperStatus, taskKeys?: string[]) => void;
  addCheckInPending: boolean;
  readOnly?: boolean;
}

const sectionVariants = {
  hidden: { opacity: 0, scale: 0.98 },
  visible: { opacity: 1, scale: 1, transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1] as const } },
};

export function MyDayLeftColumn({
  date,
  user,
  day,
  isFetching,
  theme,
  onRefresh,
  onToggleTheme,
  onLogout,
  handleStatusUpdate,
  updateStatusPending,
  handleMarkDone,
  handleDrop,
  handleUpdateItemTitle,
  handleAddCheckIn,
  addCheckInPending,
  readOnly,
}: MyDayLeftColumnProps) {
  return (
    <div className="flex flex-col gap-6 w-full pb-8">
      <MyDayHeader
        user={user}
        day={day}
        isFetching={isFetching}
        theme={theme}
        onRefresh={onRefresh}
        onToggleTheme={onToggleTheme}
        onLogout={onLogout}
      />

      {day && day.availability.state === 'inactive' && (
        <MyDayInactiveBanner availability={day.availability} />
      )}

      <motion.section variants={sectionVariants} className={readOnly ? 'opacity-60' : undefined} aria-disabled={readOnly}>
        <div className="flex items-center gap-2 mb-3 pl-2">
          <Zap size={14} className="text-[var(--text-muted)]" />
          <h2 className="text-[13px] font-bold uppercase tracking-[0.15em] text-[var(--text-muted)]">
            Status
          </h2>
        </div>
        <div className="bg-[var(--bg-canvas)] rounded-3xl p-3 shadow-inner border border-[var(--border)]">
          <StatusSelector
            current={day?.status ?? 'on_track'}
            onUpdate={handleStatusUpdate}
            isPending={updateStatusPending}
            disabled={readOnly}
          />
        </div>
      </motion.section>

      <motion.section variants={sectionVariants} className={readOnly ? 'opacity-60' : undefined} aria-disabled={readOnly}>
        <div className="flex items-center gap-2 mb-3 pl-2">
          <Target size={14} className="text-[var(--text-muted)]" />
          <h2 className="text-[13px] font-bold uppercase tracking-[0.15em] text-[var(--text-muted)]">
            Current Task
          </h2>
        </div>
        <CurrentTask
          viewDate={date}
          item={day?.currentItem}
          onMarkDone={handleMarkDone}
          onDrop={handleDrop}
          onUpdateTitle={handleUpdateItemTitle}
          hasPlannedItems={(day?.plannedItems.length ?? 0) > 0}
          readOnly={readOnly}
        />
      </motion.section>

      {(day?.completedItems.length ?? 0) > 0 && (
        <motion.section variants={sectionVariants}>
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between pl-2 pr-1">
              <div className="flex items-center gap-2">
                <CheckCircle2 size={14} className="text-[var(--success)]" />
                <h2 className="text-[13px] font-bold uppercase tracking-[0.15em] text-[var(--text-muted)]">
                  Completed Today
                </h2>
              </div>
              <span className="text-[11px] uppercase font-bold px-2 py-0.5 rounded-full bg-[rgba(16,185,129,0.1)] text-[var(--success)] border border-[rgba(16,185,129,0.2)]">
                {day!.completedItems.length} Finished
              </span>
            </div>
            <div className="bg-[var(--bg-canvas)] rounded-3xl p-4 shadow-inner border border-[var(--border)]">
              <CompletedWork items={day!.completedItems} />
            </div>
          </div>
        </motion.section>
      )}

      {(day?.droppedItems.length ?? 0) > 0 && (
        <motion.section variants={sectionVariants}>
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between pl-2 pr-1">
              <div className="flex items-center gap-2">
                <Target size={14} className="text-[var(--danger)]" />
                <h2 className="text-[13px] font-bold uppercase tracking-[0.15em] text-[var(--text-muted)]">
                  Dropped Today
                </h2>
              </div>
              <span className="text-[11px] uppercase font-bold px-2 py-0.5 rounded-full bg-[rgba(239,68,68,0.1)] text-[var(--danger)] border border-[rgba(239,68,68,0.2)]">
                {day!.droppedItems.length} Dropped
              </span>
            </div>
            <div className="bg-[var(--bg-canvas)] rounded-3xl p-4 shadow-inner border border-[var(--border)]">
              <DroppedWork items={day!.droppedItems} />
            </div>
          </div>
        </motion.section>
      )}

      <motion.section variants={sectionVariants} className={`mt-2 ${readOnly ? 'opacity-60' : ''}`} aria-disabled={readOnly}>
        <div className="flex items-center gap-2 mb-3 pl-2">
          <MessageSquare size={14} className="text-[var(--text-muted)]" />
          <h2 className="text-[13px] font-bold uppercase tracking-[0.15em] text-[var(--text-muted)]">
            Quick Updates
          </h2>
        </div>
        <QuickUpdates
          onAddCheckIn={handleAddCheckIn}
          tasks={tasksFromItems(day?.currentItem ? [day.currentItem] : undefined, day?.plannedItems)}
          isPending={addCheckInPending}
          disabled={readOnly}
        />
      </motion.section>
    </div>
  );
}
