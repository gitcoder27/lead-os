import { ArrowLeft } from 'lucide-react';
import { navigateToTaskPage, TaskDetailBody } from './TaskDrawer';

/**
 * Phase 3 (P3-D2): the bookmarkable full-page task view at `/t/:key`. Renders
 * the shared drawer body in page layout; the same endpoint serves managers
 * and developers with their respective DTOs.
 */
export function TaskPage({ taskKey, onBack }: { taskKey: string; onBack: () => void }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden" style={{ background: 'var(--bg-primary)' }}>
      <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col overflow-hidden">
        <div className="shrink-0 px-4 pt-3">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[12px] font-semibold transition-opacity hover:opacity-70"
            style={{ color: 'var(--text-secondary)', background: 'var(--bg-tertiary)', border: '1px solid var(--border)' }}
          >
            <ArrowLeft size={12} />
            Back
          </button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col">
          <TaskDetailBody
            taskKey={taskKey}
            fullPage
            onNavigateTask={(key) => navigateToTaskPage(key)}
          />
        </div>
      </div>
    </div>
  );
}
