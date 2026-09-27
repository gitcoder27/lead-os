import { navigateToTaskPage, TaskDetailBody } from './TaskDrawer';

/**
 * Phase 3 (P3-D2): the bookmarkable full-page task view at `/t/:key`. Renders
 * the shared task detail in its two-column page layout; the same endpoint
 * serves managers and developers with their respective DTOs.
 */
export function TaskPage({ taskKey, onBack }: { taskKey: string; onBack: () => void }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden" style={{ background: 'var(--bg-primary)' }}>
      <TaskDetailBody
        taskKey={taskKey}
        fullPage
        onBack={onBack}
        onNavigateTask={(key) => navigateToTaskPage(key)}
      />
    </div>
  );
}
