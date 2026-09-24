import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { XCircle, LogOut } from 'lucide-react';
import { format } from 'date-fns';
import { useAuth } from '@/context/AuthContext';
import { useTheme } from '@/context/ThemeContext';
import { useToast } from '@/context/ToastContext';
import { useMyDay } from '@/hooks/useMyDay';
import { useTaskResolution } from '@/hooks/useTasks';
import { taskKeyFromParams, writeTaskParam } from '@/lib/view-params';
import { useMyDayHandlers } from './useMyDayHandlers';

import { MyDayLeftColumn } from './MyDayLeftColumn';
import { MyDayRightColumn } from './MyDayRightColumn';

export function MyDayPage() {
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { addToast } = useToast();
  const [date, setDate] = useState(() => format(new Date(), 'yyyy-MM-dd'));
  const [deepLinkTaskKey] = useState(() => taskKeyFromParams(new URLSearchParams(window.location.search)));

  const { data: day, isLoading, isFetching, error, refetch } = useMyDay(date);
  const isReadOnly = Boolean(
    day && (day.viewMode !== 'live' || day.readOnlyReason || day.isReadOnly)
  );

  const {
    handleStatusUpdate,
    handleMarkDone,
    handleDrop,
    handleSetCurrent,
    handleReorder,
    handleUpdateItemTitle,
    handleAddItem,
    handleAddCheckIn,
    updateStatusPending,
    addItemPending,
    addCheckInPending,
  } = useMyDayHandlers(date, isReadOnly);

  // /my-day?task=T-n deep link: resolve ownership, move to the task's date,
  // then scroll to and highlight its row. Unknown/non-owned keys 404.
  const taskResolution = useTaskResolution(deepLinkTaskKey, { role: 'developer' });
  const deepLinkHandledRef = useRef(false);
  useEffect(() => {
    if (deepLinkHandledRef.current) {
      return;
    }
    if (taskResolution.isError) {
      deepLinkHandledRef.current = true;
      writeTaskParam(undefined);
      addToast('That task is not available here', 'error');
      return;
    }
    const resolution = taskResolution.data;
    if (!resolution) {
      return;
    }
    if (resolution.date && resolution.date !== date) {
      setDate(resolution.date);
      return;
    }
    if (!day) {
      return;
    }
    const row = document.querySelector(`[data-task-key="${resolution.taskKey}"]`);
    if (!row) {
      return;
    }
    deepLinkHandledRef.current = true;
    row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    row.classList.add('task-row-deep-link');
    window.setTimeout(() => row.classList.remove('task-row-deep-link'), 2400);
  }, [taskResolution.data, taskResolution.isError, day, date, addToast]);

  const handleRefresh = async () => {
    try {
      await refetch();
      addToast('My Day refreshed', 'success');
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Refresh failed', 'error');
    }
  };

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center" style={{ background: 'var(--bg-canvas)' }}>
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: 'var(--accent)', borderTopColor: 'transparent' }} />
          <span className="text-[14px] font-medium tracking-wide shadow-sm" style={{ color: 'var(--text-secondary)' }}>
            Loading your day…
          </span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-full flex items-center justify-center p-4" style={{ background: 'var(--bg-canvas)' }}>
        <div className="text-center max-w-sm bg-[var(--bg-primary)] p-8 rounded-3xl border border-[var(--border)] shadow-sm">
          <div className="h-14 w-14 rounded-2xl flex items-center justify-center mx-auto mb-5 bg-[rgba(239,68,68,0.12)] text-[var(--danger)]">
            <XCircle size={26} />
          </div>
          <h2 className="text-[18px] font-bold mb-2 text-[var(--text-primary)] tracking-tight">Failed to load</h2>
          <p className="text-[13px] mb-6 text-[var(--text-secondary)]">{error.message}</p>
          <div className="flex flex-col gap-3">
            <button onClick={() => refetch()} className="rounded-xl px-4 py-2.5 text-[13px] font-bold bg-[var(--accent-glow)] text-[var(--accent)] border border-[color-mix(in_srgb,var(--accent)_30%,transparent)]">
              Retry
            </button>
            <div className="flex gap-3">
              <button onClick={() => { window.history.pushState(null, '', '/'); window.location.reload(); }} className="flex-1 rounded-xl px-4 py-2.5 text-[13px] font-bold bg-[var(--bg-tertiary)] text-[var(--text-secondary)] border border-[var(--border)]">
                Today
              </button>
              <button onClick={async () => { await logout(); window.location.reload(); }} className="flex-1 rounded-xl px-4 py-2.5 text-[13px] font-bold flex justify-center items-center gap-1.5 bg-[rgba(239,68,68,0.08)] text-[var(--danger)] border border-[rgba(239,68,68,0.2)]">
                <LogOut size={14} /> Logout
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const completedCount = day?.completedItems.length ?? 0;
  const plannedCount = day?.plannedItems.length ?? 0;
  const totalTasks = completedCount + plannedCount + (day?.currentItem ? 1 : 0);
  return (
    <div className="h-full overflow-y-auto" style={{ background: 'var(--bg-canvas)' }}>
      <div className="max-w-[1280px] mx-auto px-4 py-6 md:px-8 md:py-8 lg:py-10">
        <motion.div initial="hidden" animate="visible" className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 pl-1 pr-1">
          {/* Left Column */}
          <div className="lg:col-span-7 xl:col-span-8 flex flex-col h-full">
            <MyDayLeftColumn
              date={date}
              user={user}
              day={day}
              isFetching={isFetching}
              theme={theme}
              onRefresh={handleRefresh}
              onToggleTheme={toggleTheme}
              onLogout={logout}
              handleStatusUpdate={handleStatusUpdate}
              updateStatusPending={updateStatusPending}
              handleMarkDone={handleMarkDone}
              handleDrop={handleDrop}
              handleUpdateItemTitle={handleUpdateItemTitle}
              handleAddCheckIn={handleAddCheckIn}
              addCheckInPending={addCheckInPending}
              readOnly={isReadOnly}
            />
          </div>

          {/* Right Column */}
          <div className="lg:col-span-5 xl:col-span-4 flex flex-col h-full pl-2">
            <MyDayRightColumn
              date={date}
              setDate={setDate}
              day={day}
              handleSetCurrent={handleSetCurrent}
              handleMarkDone={handleMarkDone}
              handleDrop={handleDrop}
              handleReorder={handleReorder}
              handleUpdateItemTitle={handleUpdateItemTitle}
              handleAddItem={handleAddItem}
              addItemPending={addItemPending}
              completedCount={completedCount}
              totalTasks={totalTasks}
              readOnly={isReadOnly}
            />
          </div>
        </motion.div>
      </div>
    </div>
  );
}
