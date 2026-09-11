import type { ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import type { ManagerDeskItem, ManagerDeskStatus } from '@/types/manager-desk';
import { DeskItemCard } from './DeskItemCard';
import { getCardVariant } from './UnifiedDeskListPrimitives';

export interface DeskRhythmSection {
  key: string;
  title: string;
  subtitle: string;
  icon: ReactNode;
  items: ManagerDeskItem[];
  quiet?: boolean;
  defaultOpen?: boolean;
  tone?: 'active' | 'decision' | 'calm' | 'quiet';
}

export function DeskRhythmHeader({
  title,
  subtitle,
  count,
  continuedOpenCount,
  metrics,
  showCount = true,
  showSubtitle = false,
  onShowCarried,
}: {
  title: string;
  subtitle?: string;
  count?: number;
  continuedOpenCount?: number;
  metrics?: Array<{ label: string; value: number; tone?: 'active' | 'decision' | 'calm' }>;
  showCount?: boolean;
  showSubtitle?: boolean;
  onShowCarried?: () => void;
}) {
  return (
    <div className="px-3 py-2.5 md:px-4">
      <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-[15px] font-semibold leading-none tracking-[-0.01em]" style={{ color: 'var(--text-primary)' }}>
              {title}
            </h2>
            {showCount && typeof count === 'number' ? <CountPill value={count} /> : null}
            {continuedOpenCount ? (
              <ContinuedPill count={continuedOpenCount} onClick={onShowCarried} />
            ) : null}
          </div>
          {showSubtitle && subtitle ? (
            <p className="mt-1 text-[12px]" style={{ color: 'var(--text-muted)' }}>
              {subtitle}
            </p>
          ) : null}
        </div>
        {metrics && metrics.length > 0 ? (
          <div className="flex flex-wrap gap-1.5 lg:justify-end">
            {metrics.map((metric) => (
              <DeskMetric key={metric.label} {...metric} />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ContinuedPill({ count, onClick }: { count: number; onClick?: () => void }) {
  const label = `${count} open ${count === 1 ? 'item has' : 'items have'} continued from earlier days.`;
  const className = `inline-flex h-5 items-center rounded-md border px-1.5 text-[11px] font-medium${
    onClick ? ' transition-[background-color,border-color,color,transform] duration-150 hover:-translate-y-px active:scale-[0.98]' : ''
  }`;
  const style = {
    borderColor: 'rgba(217,169,78,0.18)',
    background: 'color-mix(in srgb, var(--md-accent-glow) 26%, transparent)',
    color: 'color-mix(in srgb, var(--md-accent) 82%, var(--text-secondary))',
  };

  if (!onClick) {
    return (
      <span className={className} title={label} style={style}>
        {count} from earlier
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className={className}
      title={`${label} Show them.`}
      style={style}
      aria-label={`Show the ${count} open ${count === 1 ? 'item' : 'items'} continued from earlier days`}
    >
      {count} from earlier
    </button>
  );
}

export function SectionTitle({
  section,
  open,
  onToggle,
  itemsId,
}: {
  section: DeskRhythmSection;
  open?: boolean;
  onToggle?: () => void;
  itemsId?: string;
}) {
  const isActive = section.tone === 'active';
  const isDecision = section.tone === 'decision';
  const iconBadge = (
    <span
      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md"
      style={{
        background: isActive
          ? 'rgba(6,182,212,0.12)'
          : isDecision
          ? 'color-mix(in srgb, var(--md-accent-glow) 58%, transparent)'
          : section.quiet
          ? 'transparent'
          : 'color-mix(in srgb, var(--bg-secondary) 82%, transparent)',
        color: isActive ? 'var(--accent)' : isDecision ? 'var(--md-accent)' : 'var(--text-secondary)',
        border: section.quiet ? '1px solid var(--border)' : '1px solid color-mix(in srgb, var(--border) 70%, transparent)',
      }}
    >
      {section.icon}
    </span>
  );

  if (onToggle) {
    return (
      <h3
        className="min-w-0 flex-1 text-[14px] font-semibold leading-none tracking-[-0.01em]"
        style={{ color: 'var(--text-primary)' }}
      >
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-controls={itemsId}
          className="flex w-full cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-left outline-none transition-[background-color,color] duration-150 hover:bg-[color-mix(in_srgb,var(--bg-tertiary)_72%,transparent)] focus-visible:ring-1 focus-visible:ring-[color:var(--md-accent)]"
          style={{ font: 'inherit', color: 'inherit' }}
        >
          {iconBadge}
          <span className="min-w-0 truncate">{section.title}</span>
          <span aria-hidden="true" className="inline-flex shrink-0">
            <CountPill value={section.items.length} subtle={section.quiet} />
          </span>
          <ChevronRight
            size={12}
            className="ml-auto shrink-0 transition-transform duration-150"
            style={{ color: 'var(--text-muted)', transform: open ? 'rotate(90deg)' : 'rotate(0deg)' }}
          />
        </button>
      </h3>
    );
  }

  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      {iconBadge}
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <h3 className="text-[14px] font-semibold leading-none tracking-[-0.01em]" style={{ color: 'var(--text-primary)' }}>
            {section.title}
          </h3>
          <CountPill value={section.items.length} subtle={section.quiet} />
        </div>
      </div>
    </div>
  );
}

export function DeskCardRow({
  item,
  selected,
  readOnly,
  viewDate,
  onSelect,
  onStatusChange,
}: {
  item: ManagerDeskItem;
  selected: boolean;
  readOnly: boolean;
  viewDate?: string;
  onSelect: (item: ManagerDeskItem) => void;
  onStatusChange?: (itemId: number, status: ManagerDeskStatus) => void;
}) {
  return (
    <DeskItemCard
      item={item}
      onSelect={() => onSelect(item)}
      onStatusChange={onStatusChange ? (status) => onStatusChange(item.id, status) : undefined}
      variant={getCardVariant(item)}
      selected={selected}
      readOnly={readOnly}
      viewDate={viewDate}
    />
  );
}

export function CountPill({ value, subtle = false }: { value: number; subtle?: boolean }) {
  return (
    <span
      className="inline-flex h-5 items-center rounded-md border px-1.5 font-mono text-[11px] font-semibold tabular-nums"
      style={{
        borderColor: 'var(--border)',
        background: subtle ? 'transparent' : 'color-mix(in srgb, var(--bg-secondary) 86%, transparent)',
        color: subtle ? 'var(--text-muted)' : 'var(--text-secondary)',
      }}
    >
      {value}
    </span>
  );
}

function DeskMetric({
  label,
  value,
  tone = 'calm',
}: {
  label: string;
  value: number;
  tone?: 'active' | 'decision' | 'calm';
}) {
  const color = tone === 'active' ? 'var(--accent)' : tone === 'decision' ? 'var(--md-accent)' : 'var(--text-secondary)';
  const background = tone === 'active'
    ? 'rgba(6,182,212,0.08)'
    : tone === 'decision'
    ? 'color-mix(in srgb, var(--md-accent-glow) 42%, transparent)'
    : 'color-mix(in srgb, var(--bg-secondary) 58%, transparent)';

  return (
    <span
      className="inline-flex h-7 items-center gap-1.5 rounded-lg border px-2 text-[11px] font-semibold uppercase tracking-[0.08em]"
      style={{ background, borderColor: 'color-mix(in srgb, var(--border) 78%, transparent)', color }}
    >
      <span>{label}</span>
      <span className="font-mono tabular-nums">{value}</span>
    </span>
  );
}
