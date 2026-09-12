import { useMemo, useState } from 'react';
import { format } from 'date-fns';
import { Bell, CalendarDays, Search } from 'lucide-react';
import type { AppView } from '@/App';
import { useToast } from '@/context/ToastContext';
import {
  useCreateManagerDeskItem,
  useManagerDesk,
  useUpdateManagerDeskItem,
} from '@/hooks/useManagerDesk';
import { useDailyNoteSources } from '@/hooks/useDailyNotes';
import {
  buildMemoryStats,
  filterMemoryItems,
  searchMemoryItems,
  type ManagerMemoryMode,
} from '@/lib/manager-memory';
import { getLocalIsoDate } from '@/lib/utils';
import type { DailyNoteSource, TodayActionTarget } from '@/types';
import type { ManagerDeskCreateItemPayload, ManagerDeskStatus } from '@/types/manager-desk';
import { MemoryComposer } from './MemoryComposer';
import { MemoryList } from './MemoryList';
import { MemoryError, MemorySkeleton } from './MemoryStates';

interface ManagerMemoryPageProps {
  mode: ManagerMemoryMode;
  onViewChange: (view: AppView) => void;
  onOpenTarget?: (target: TodayActionTarget) => void;
}

const pageCopy = {
  'follow-ups': {
    title: 'Follow-ups',
    detail: 'Promises, check-ins, and action items that should not disappear.',
    Icon: Bell,
    emptyAction: 'Add follow-up',
    accent: 'var(--warning)',
    buttonText: '#111',
  },
  meetings: {
    title: 'Meetings',
    detail: 'Lightweight meeting memory for notes, decisions, and next actions.',
    Icon: CalendarDays,
    emptyAction: 'Add meeting',
    accent: 'var(--accent)',
    buttonText: '#fff',
  },
} as const;

export function ManagerMemoryPage({ mode, onViewChange, onOpenTarget }: ManagerMemoryPageProps) {
  const today = getLocalIsoDate();
  const { addToast } = useToast();
  const [searchQuery, setSearchQuery] = useState('');
  const day = useManagerDesk(today);
  const createItem = useCreateManagerDeskItem(today);
  const updateItem = useUpdateManagerDeskItem(today);
  const copy = pageCopy[mode];
  const Icon = copy.Icon;

  const allItems = useMemo(() => filterMemoryItems(mode, day.data?.items ?? []), [day.data?.items, mode]);
  const visibleItems = useMemo(() => searchMemoryItems(allItems, searchQuery), [allItems, searchQuery]);
  const stats = useMemo(() => buildMemoryStats(mode, allItems), [allItems, mode]);
  const itemIds = useMemo(() => allItems.map((item) => item.id), [allItems]);
  const noteSourcesQuery = useDailyNoteSources(itemIds);
  const noteSources = useMemo(() => {
    const map = new Map<number, DailyNoteSource>();
    for (const source of noteSourcesQuery.data ?? []) {
      map.set(source.itemId, source);
    }
    return map;
  }, [noteSourcesQuery.data]);

  const handleOpenDesk = (item: (typeof allItems)[number]) => {
    if (onOpenTarget) {
      onOpenTarget({
        type: 'manager_desk_item',
        view: 'desk',
        managerDeskItemId: item.id,
        date: item.originDate,
      });
      return;
    }
    onViewChange('desk');
  };

  const handleCreate = (payload: ManagerDeskCreateItemPayload) => {
    createItem.mutate(payload, {
      onSuccess: () => {
        addToast(mode === 'follow-ups' ? 'Follow-up added' : 'Meeting captured', 'success');
      },
      onError: (error) => addToast(error.message, 'error'),
    });
  };

  const handleStatusChange = (itemId: number, status: ManagerDeskStatus) => {
    updateItem.mutate(
      { itemId, status },
      {
        onSuccess: () => {
          addToast(status === 'done' ? 'Marked done' : 'Updated', 'success');
        },
        onError: (error) => addToast(error.message, 'error'),
      },
    );
  };

  return (
    <main
      className="flex min-h-0 flex-1 flex-col overflow-hidden"
      style={{
        background: 'linear-gradient(180deg, color-mix(in srgb, var(--bg-canvas) 94%, var(--bg-primary) 6%), var(--bg-canvas))',
        ['--memory-line' as string]: 'color-mix(in srgb, var(--border) 36%, transparent)',
        ['--memory-hover' as string]: 'color-mix(in srgb, var(--bg-tertiary) 32%, transparent)',
        ['--memory-accent' as string]: copy.accent,
        ['--memory-accent-bg' as string]: `color-mix(in srgb, ${copy.accent} 13%, transparent)`,
        ['--memory-button-text' as string]: copy.buttonText,
      }}
    >
      <section className="shrink-0 border-b px-5 py-4 xl:px-8" style={{ borderColor: 'var(--memory-line)' }}>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-md" style={{ background: 'var(--memory-accent-bg)', color: 'var(--memory-accent)' }}>
                <Icon size={16} />
              </span>
              <div>
                <h1 className="text-[18px] font-semibold" style={{ color: 'var(--text-primary)' }}>{copy.title}</h1>
                <p className="mt-0.5 text-[13px]" style={{ color: 'var(--text-muted)' }}>{copy.detail}</p>
              </div>
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-4 lg:min-w-[520px]">
            {stats.map((stat) => (
              <div key={stat.id} className="border-l px-3" style={{ borderColor: 'var(--memory-line)' }}>
                <div className="text-[19px] font-semibold tabular-nums" style={{ color: statColor(stat.tone) }}>{stat.value}</div>
                <div className="text-[12px]" style={{ color: 'var(--text-muted)' }}>{stat.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-h-0 overflow-auto px-5 py-5 xl:px-8">
          <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>
                {format(new Date(), 'MMM d, yyyy')}
              </p>
              <p className="mt-0.5 text-[12px]" style={{ color: 'var(--text-muted)' }}>
                {day.isFetching ? 'Refreshing memory' : `${allItems.length} item${allItems.length === 1 ? '' : 's'} in this workflow`}
              </p>
            </div>

            <label className="relative block w-full md:w-[300px]">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
              <input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder={mode === 'follow-ups' ? 'Search follow-ups' : 'Search meetings'}
                className="memory-input pl-8"
                aria-label={mode === 'follow-ups' ? 'Search follow-ups' : 'Search meetings'}
              />
            </label>
          </div>

          {day.isLoading ? (
            <MemorySkeleton />
          ) : day.error ? (
            <MemoryError message={(day.error as Error).message} onRetry={() => void day.refetch()} />
          ) : (
            <MemoryList
              mode={mode}
              items={visibleItems}
              onStatusChange={handleStatusChange}
              onOpenDesk={handleOpenDesk}
              noteSources={noteSources}
            />
          )}
        </div>

        <MemoryComposer
          mode={mode}
          date={today}
          isSaving={createItem.isPending}
          onCreate={handleCreate}
        />
      </section>
    </main>
  );
}

function statColor(tone: 'critical' | 'warning' | 'info' | 'neutral' | 'success') {
  if (tone === 'critical') return 'var(--danger)';
  if (tone === 'warning') return 'var(--warning)';
  if (tone === 'info') return 'var(--accent)';
  if (tone === 'success') return 'var(--success)';
  return 'var(--text-secondary)';
}
