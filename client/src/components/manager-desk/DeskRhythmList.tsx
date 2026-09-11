import { Archive, CheckCircle2, Inbox, ListChecks, Play } from 'lucide-react';
import type { ManagerDeskItem, ManagerDeskStatus } from '@/types/manager-desk';
import { UnifiedEmptyState } from './UnifiedDeskListPrimitives';
import {
  DeskCardRow,
  DeskRhythmHeader,
  SectionTitle,
  type DeskRhythmSection,
} from './DeskRhythmListPrimitives';

interface Props {
  items: ManagerDeskItem[];
  continuedOpenCount: number;
  selectedItemId: number | null;
  readOnly: boolean;
  viewMode: 'live' | 'history' | 'planning';
  viewDate: string;
  onSelect: (item: ManagerDeskItem) => void;
  onStatusChange?: (itemId: number, status: ManagerDeskStatus) => void;
  onShowCarried?: () => void;
}

export function DeskRhythmList({
  items,
  continuedOpenCount,
  selectedItemId,
  readOnly,
  viewMode,
  viewDate,
  onSelect,
  onStatusChange,
  onShowCarried,
}: Props) {
  const sections = buildDeskRhythmSections(items);
  const activeSections = sections.filter((section) => !section.quiet && section.items.length > 0);
  const quietSections = sections.filter((section) => section.quiet);
  const title = viewMode === 'planning' ? 'Scheduled work' : viewMode === 'history' ? 'Desk snapshot' : 'Today';
  const metrics = buildDeskSignalMetrics(sections);

  return (
    <section
      className="flex min-h-full flex-col overflow-hidden rounded-xl border"
      style={{
        background: 'linear-gradient(180deg, color-mix(in srgb, var(--bg-primary) 92%, transparent), color-mix(in srgb, var(--bg-primary) 98%, transparent))',
        borderColor: 'color-mix(in srgb, var(--border) 82%, transparent)',
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.025)',
      }}
    >
      <DeskRhythmHeader
        title={title}
        count={items.length}
        continuedOpenCount={continuedOpenCount}
        showCount={false}
        onShowCarried={onShowCarried}
      />

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3 md:px-4">
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_224px] xl:items-start 2xl:grid-cols-[minmax(0,1fr)_240px]">
          <div className="min-w-0 space-y-4">
            {items.length === 0 ? (
              <UnifiedEmptyState quickFilter="all" message="No desk work matches this view." />
            ) : (
              <>
                {activeSections.map((section) => (
                  <DeskRhythmSectionView
                    key={section.key}
                    section={section}
                    selectedItemId={selectedItemId}
                    readOnly={readOnly}
                    viewDate={viewDate}
                    onSelect={onSelect}
                    onStatusChange={onStatusChange}
                  />
                ))}
                <QuietDeskStrip sections={quietSections} />
              </>
            )}
          </div>
          <DeskSignalRail
            metrics={metrics}
            sections={sections}
            continuedOpenCount={continuedOpenCount}
            viewMode={viewMode}
            onShowCarried={onShowCarried}
          />
        </div>
      </div>
    </section>
  );
}

function DeskRhythmSectionView({
  section,
  selectedItemId,
  readOnly,
  viewDate,
  onSelect,
  onStatusChange,
}: {
  section: DeskRhythmSection;
  selectedItemId: number | null;
  readOnly: boolean;
  viewDate: string;
  onSelect: (item: ManagerDeskItem) => void;
  onStatusChange?: (itemId: number, status: ManagerDeskStatus) => void;
}) {
  if (section.quiet) {
    return null;
  }

  return (
    <section>
      <div className="pb-2">
        <SectionTitle section={section} />
      </div>
      <SectionItems section={section} selectedItemId={selectedItemId} readOnly={readOnly} viewDate={viewDate} onSelect={onSelect} onStatusChange={onStatusChange} />
    </section>
  );
}

function SectionItems({
  section,
  selectedItemId,
  readOnly,
  viewDate,
  onSelect,
  onStatusChange,
}: {
  section: DeskRhythmSection;
  selectedItemId: number | null;
  readOnly: boolean;
  viewDate: string;
  onSelect: (item: ManagerDeskItem) => void;
  onStatusChange?: (itemId: number, status: ManagerDeskStatus) => void;
}) {
  return (
    <div className="space-y-2">
      {section.items.map((item) => (
        <DeskCardRow
          key={item.id}
          item={item}
          selected={item.id === selectedItemId}
          readOnly={readOnly}
          viewDate={viewDate}
          onSelect={onSelect}
          onStatusChange={onStatusChange}
        />
      ))}
    </div>
  );
}

function QuietDeskStrip({ sections }: { sections: DeskRhythmSection[] }) {
  return (
    <div
      className="flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2"
      style={{
        background: 'color-mix(in srgb, var(--bg-secondary) 42%, transparent)',
        borderColor: 'color-mix(in srgb, var(--border) 72%, transparent)',
        color: 'var(--text-muted)',
      }}
    >
      {sections.map((section) => (
        <span
          key={section.key}
          className="inline-flex h-7 items-center gap-1.5 rounded-lg px-2 text-[10px] font-semibold uppercase tracking-[0.08em]"
          style={{ color: section.items.length > 0 ? 'var(--text-secondary)' : 'var(--text-muted)' }}
        >
          {section.icon}
          <span>{section.title}</span>
          <span className="font-mono tabular-nums">{section.items.length}</span>
        </span>
      ))}
    </div>
  );
}

export function DeskSignalRail({
  metrics,
  sections,
  continuedOpenCount,
  viewMode,
  carriedActive = false,
  onShowCarried,
}: {
  metrics: Array<{ label: string; value: number; tone: 'active' | 'decision' | 'calm' }>;
  sections: DeskRhythmSection[];
  continuedOpenCount: number;
  viewMode: 'live' | 'history' | 'planning';
  carriedActive?: boolean;
  onShowCarried?: () => void;
}) {
  const nextPrompt = getNextDeskPrompt(sections, viewMode);

  return (
    <aside
      className="hidden min-w-0 border-l pl-4 xl:block"
      style={{ borderColor: 'color-mix(in srgb, var(--border) 60%, transparent)' }}
      aria-label="Desk pulse"
    >
      <div className="sticky top-2 space-y-3 py-1">
        <div>
          <div className="text-[9px] font-bold uppercase tracking-[0.16em]" style={{ color: 'var(--text-muted)' }}>
            Pulse
          </div>
          <div className="mt-2 space-y-1.5">
            {metrics.map((metric) => (
              <RailMetric key={metric.label} {...metric} />
            ))}
          </div>
        </div>

        <div className="border-t pt-3" style={{ borderColor: 'color-mix(in srgb, var(--border) 52%, transparent)' }}>
          <div className="text-[9px] font-bold uppercase tracking-[0.16em]" style={{ color: 'var(--text-muted)' }}>
            Next
          </div>
          <div className="mt-2 text-[12px] font-semibold leading-5" style={{ color: 'var(--text-primary)' }}>
            {nextPrompt.title}
          </div>
          <p className="mt-1 text-[12px] leading-5" style={{ color: 'var(--text-secondary)' }}>
            {nextPrompt.subtitle}
          </p>
        </div>

        {continuedOpenCount > 0 && (
          <div className="border-t pt-3" style={{ borderColor: 'color-mix(in srgb, var(--border) 52%, transparent)' }}>
            <div className="text-[9px] font-bold uppercase tracking-[0.16em]" style={{ color: 'var(--text-muted)' }}>
              Carried
            </div>
            <button
              type="button"
              onClick={onShowCarried}
              disabled={!onShowCarried}
              aria-pressed={carriedActive}
              title="Show open items continued from earlier days"
              className="mt-2 flex w-full items-baseline gap-2 rounded-md px-1 py-0.5 text-left transition-[background-color,color] duration-150 enabled:hover:-translate-y-px"
              style={{
                background: carriedActive ? 'color-mix(in srgb, var(--md-accent-glow) 45%, transparent)' : 'transparent',
              }}
            >
              <span className="font-mono text-[18px] font-semibold tabular-nums" style={{ color: 'var(--md-accent)' }}>
                {continuedOpenCount}
              </span>
              <span className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
                from earlier
              </span>
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}

function RailMetric({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: 'active' | 'decision' | 'calm';
}) {
  const color = tone === 'active' ? 'var(--accent)' : tone === 'decision' ? 'var(--md-accent)' : 'var(--text-secondary)';
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[11px] font-medium" style={{ color: 'var(--text-secondary)' }}>
        {label}
      </span>
      <span className="font-mono text-[11px] font-semibold tabular-nums" style={{ color }}>
        {value}
      </span>
    </div>
  );
}

function getNextDeskPrompt(sections: DeskRhythmSection[], viewMode: 'live' | 'history' | 'planning') {
  if (viewMode === 'history') {
    return { title: 'Review the record', subtitle: 'Historical desks are read-only snapshots.' };
  }

  const triage = sections.find((section) => section.key === 'triage')?.items[0];
  if (triage) {
    return { title: 'Plan triage item', subtitle: 'Clear triage first so the day has a clean plan.' };
  }

  const now = sections.find((section) => section.key === 'now')?.items[0];
  if (now) {
    return { title: 'Finish active work', subtitle: 'One active task should stay easy to close.' };
  }

  const planned = sections.find((section) => section.key === 'planned')?.items[0];
  if (planned) {
    return { title: 'Start planned work', subtitle: 'Pick the next planned item when you are ready.' };
  }

  return viewMode === 'planning'
    ? { title: 'Plan lightly', subtitle: 'Add only the work that should be visible on that day.' }
    : { title: 'Desk is clear', subtitle: 'Capture only what needs a manager decision or action.' };
}

export function buildDeskSignalMetrics(sections: DeskRhythmSection[]) {
  return [
    { label: 'Now', value: sections.find((section) => section.key === 'now')?.items.length ?? 0, tone: 'active' as const },
    { label: 'Triage', value: sections.find((section) => section.key === 'triage')?.items.length ?? 0, tone: 'decision' as const },
    { label: 'Planned', value: sections.find((section) => section.key === 'planned')?.items.length ?? 0, tone: 'calm' as const },
  ];
}

export function buildDeskRhythmSections(items: ManagerDeskItem[]): DeskRhythmSection[] {
  return [
    { key: 'now', title: 'Now', subtitle: 'The work already in motion.', icon: <Play size={12} />, items: items.filter((item) => item.status === 'in_progress'), tone: 'active' },
    { key: 'triage', title: 'Needs triage', subtitle: 'Fresh captures waiting for a decision.', icon: <Inbox size={12} />, items: items.filter((item) => item.status === 'inbox'), tone: 'decision' },
    { key: 'planned', title: 'Planned', subtitle: 'Committed work and follow-ups that have not started yet.', icon: <ListChecks size={12} />, items: items.filter((item) => item.status === 'planned' || item.status === 'waiting'), tone: 'calm' },
    { key: 'later', title: 'Later', subtitle: 'Parked work, kept out of the active plan.', icon: <Archive size={12} />, items: items.filter((item) => item.status === 'backlog'), tone: 'quiet', quiet: true },
    { key: 'done', title: 'Done', subtitle: 'Closed work for this date.', icon: <CheckCircle2 size={12} />, items: items.filter((item) => item.status === 'done' || item.status === 'cancelled'), tone: 'quiet', quiet: true },
  ];
}
