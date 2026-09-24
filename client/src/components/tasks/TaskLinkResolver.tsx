import { useEffect, type ReactNode } from 'react';
import { ApiRequestError } from '@/lib/api';
import { useTaskResolution } from '@/hooks/useTasks';
import type { TaskResolution, UserRole } from '@/types';

function deletedResolutionFrom(error: unknown): TaskResolution | undefined {
  if (!(error instanceof ApiRequestError) || error.status !== 410) {
    return undefined;
  }
  const body = error.body as Partial<TaskResolution> | undefined;
  return body && typeof body.taskKey === 'string' && body.deleted ? (body as TaskResolution) : undefined;
}

function DeletedTaskState({ task, onGoToday }: { task: TaskResolution; onGoToday: () => void }) {
  return (
    <main className="flex min-h-0 flex-1 items-center justify-center px-4" style={{ background: 'var(--bg-canvas)' }}>
      <section
        className="w-full max-w-xl rounded-[18px] border px-6 py-8 text-center"
        style={{
          borderColor: 'var(--border-strong)',
          background: 'color-mix(in srgb, var(--bg-primary) 94%, transparent)',
        }}
      >
        <p className="text-[12px] font-semibold uppercase" style={{ color: 'var(--text-muted)' }}>
          Deleted task
        </p>
        <h1 className="mt-2 text-[24px] font-semibold" style={{ color: 'var(--text-primary)' }}>
          {task.taskKey} was deleted
        </h1>
        <p className="mt-3 text-[14px] leading-6" style={{ color: 'var(--text-secondary)' }}>
          {task.title}
        </p>
        <button
          type="button"
          onClick={onGoToday}
          className="mt-6 rounded-lg px-4 py-2.5 text-[13px] font-semibold"
          style={{ background: 'var(--accent)', color: '#fff' }}
        >
          Go to Today
        </button>
      </section>
    </main>
  );
}

interface TaskLinkResolverProps {
  taskKey: string;
  role: UserRole;
  onResolved: (task: TaskResolution) => void;
  onGoToday: () => void;
  notFound: ReactNode;
}

export function TaskLinkResolver({ taskKey, role, onResolved, onGoToday, notFound }: TaskLinkResolverProps) {
  const query = useTaskResolution(taskKey, { role: role === 'developer' ? 'developer' : 'manager' });
  const resolution = query.data;

  useEffect(() => {
    if (resolution && !resolution.deleted) {
      onResolved(resolution);
    }
  }, [resolution, onResolved]);

  const deleted = resolution?.deleted ? resolution : deletedResolutionFrom(query.error);
  if (deleted) {
    return <DeletedTaskState task={deleted} onGoToday={onGoToday} />;
  }

  if (query.isError) {
    return <>{notFound}</>;
  }

  return (
    <div className="h-full flex items-center justify-center" style={{ background: 'var(--bg-primary)' }}>
      <div className="flex flex-col items-center gap-3">
        <div
          className="w-8 h-8 border-2 border-t-transparent rounded-full animate-spin"
          style={{ borderColor: 'var(--accent)', borderTopColor: 'transparent' }}
        />
        <span className="text-[13px]" style={{ color: 'var(--text-secondary)' }}>
          Opening {taskKey.toUpperCase()}…
        </span>
      </div>
    </div>
  );
}
