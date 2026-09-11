import type { ManagerDeskItem, ManagerDeskStatus } from '@/types/manager-desk';
import {
  buildDeskRhythmSections,
  buildDeskSignalMetrics,
  DeskRhythmList,
  DeskSignalRail,
} from './DeskRhythmList';
import { DeskCardRow, DeskRhythmHeader } from './DeskRhythmListPrimitives';
import { lensCopy, UnifiedEmptyState } from './UnifiedDeskListPrimitives';
import type { ManagerDeskQuickFilter } from './workbench-utils';

interface Props {
  items: ManagerDeskItem[];
  pulseItems: ManagerDeskItem[];
  continuedOpenCount: number;
  quickFilter: ManagerDeskQuickFilter;
  selectedItemId: number | null;
  readOnly?: boolean;
  viewMode: 'live' | 'history' | 'planning';
  viewDate: string;
  onSelect: (item: ManagerDeskItem) => void;
  onStatusChange?: (itemId: number, status: ManagerDeskStatus) => void;
  onShowCarried?: () => void;
}

export function UnifiedDeskList({
  items,
  pulseItems,
  continuedOpenCount,
  quickFilter,
  selectedItemId,
  readOnly = false,
  viewMode,
  viewDate,
  onSelect,
  onStatusChange,
  onShowCarried,
}: Props) {
  if (quickFilter === 'all') {
    return (
      <DeskRhythmList
        items={items}
        continuedOpenCount={continuedOpenCount}
        selectedItemId={selectedItemId}
        readOnly={readOnly}
        viewMode={viewMode}
        viewDate={viewDate}
        onSelect={onSelect}
        onStatusChange={onStatusChange}
        onShowCarried={onShowCarried}
      />
    );
  }

  return (
    <SingleLensList
      items={items}
      pulseItems={pulseItems}
      continuedOpenCount={continuedOpenCount}
      quickFilter={quickFilter}
      selectedItemId={selectedItemId}
      readOnly={readOnly}
      viewMode={viewMode}
      viewDate={viewDate}
      onSelect={onSelect}
      onStatusChange={onStatusChange}
      onShowCarried={onShowCarried}
    />
  );
}

function SingleLensList({
  items,
  pulseItems,
  continuedOpenCount,
  quickFilter,
  selectedItemId,
  readOnly,
  viewMode,
  viewDate,
  onSelect,
  onStatusChange,
  onShowCarried,
}: Props) {
  const copy = lensCopy[quickFilter];
  const visibleTitle = viewMode === 'planning' && quickFilter === 'planned' ? 'Scheduled work' : copy.title;
  const pulseSections = buildDeskRhythmSections(pulseItems);
  const pulseMetrics = buildDeskSignalMetrics(pulseSections);

  return (
    <section
      className="flex min-h-full flex-col overflow-hidden rounded-xl border"
      style={{
        background: 'linear-gradient(180deg, color-mix(in srgb, var(--bg-primary) 92%, transparent), color-mix(in srgb, var(--bg-primary) 98%, transparent))',
        borderColor: 'color-mix(in srgb, var(--border) 82%, transparent)',
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.025)',
      }}
    >
      <DeskRhythmHeader title={visibleTitle} count={items.length} />
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3 md:px-4">
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_224px] xl:items-start 2xl:grid-cols-[minmax(0,1fr)_240px]">
          <div className="min-w-0">
            {items.length === 0 ? (
              <UnifiedEmptyState quickFilter={quickFilter} message={copy.empty} />
            ) : (
              <div className="space-y-2">
                {items.map((item) => (
                  <DeskCardRow
                    key={item.id}
                    item={item}
                    selected={item.id === selectedItemId}
                    readOnly={readOnly ?? false}
                    viewDate={viewDate}
                    onSelect={onSelect}
                    onStatusChange={onStatusChange}
                  />
                ))}
              </div>
            )}
          </div>
          <DeskSignalRail
            metrics={pulseMetrics}
            sections={pulseSections}
            continuedOpenCount={continuedOpenCount}
            viewMode={viewMode}
            carriedActive={quickFilter === 'carried'}
            onShowCarried={onShowCarried}
          />
        </div>
      </div>
    </section>
  );
}
