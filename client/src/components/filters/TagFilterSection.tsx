import { ChevronRight, X } from 'lucide-react';
import type { LocalTag, TagCountsResponse } from '@/types';

interface TagFilterSectionProps {
  tags: LocalTag[];
  tagCounts: TagCountsResponse | undefined;
  selectedTagId?: number;
  noTagsFilter: boolean;
  onTagToggle: (tagId: number) => void;
  onNoTagsToggle: () => void;
  onClear: () => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
}

export function TagFilterSection({
  tags,
  tagCounts,
  selectedTagId,
  noTagsFilter,
  onTagToggle,
  onNoTagsToggle,
  onClear,
  collapsed,
  onToggleCollapse,
}: TagFilterSectionProps) {
  const hasActiveFilters = selectedTagId !== undefined || noTagsFilter;

  const tagCountById = new Map(tagCounts?.counts.map((count) => [count.tagId, count.count]) ?? []);

  function getTagCount(tagId: number): number {
    return tagCountById.get(tagId) ?? 0;
  }

  const sortedTags = [...tags].sort((a, b) => {
    const countDifference = getTagCount(b.id) - getTagCount(a.id);
    if (countDifference !== 0) {
      return countDifference;
    }

    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });

  return (
    <section
      className="rounded-[20px] border p-1.5"
      style={{
        borderColor: 'var(--border)',
        background: 'color-mix(in srgb, var(--bg-secondary) 72%, transparent)',
      }}
    >
      <div className="flex items-center justify-between px-1.5 py-1">
        <button
          onClick={onToggleCollapse}
          className="flex flex-1 items-center gap-2 cursor-pointer group min-w-0 text-left"
          aria-expanded={!collapsed}
        >
          <ChevronRight
            size={14}
            className="transition-transform duration-200"
            style={{
              color: 'var(--text-muted)',
              transform: collapsed ? 'rotate(0deg)' : 'rotate(90deg)',
            }}
          />
          <div className="min-w-0 text-left">
            <div className="text-ui font-semibold uppercase" style={{ letterSpacing: '0.08em', color: 'var(--text-muted)' }}>
              Tags
            </div>
          </div>
        </button>
        {hasActiveFilters ? (
          <button
            onClick={onClear}
            className="h-7 w-7 rounded-lg transition-colors flex items-center justify-center flex-shrink-0"
            title="Clear tag filters"
            aria-label="Clear tag filters"
            style={{ background: 'var(--bg-tertiary)' }}
          >
            <X size={10} style={{ color: 'var(--text-muted)' }} />
          </button>
        ) : (
          <div
            aria-hidden="true"
            className="h-7 w-7 flex-shrink-0"
          />
        )}
      </div>

      {!collapsed && (
        <div className="flex flex-col gap-1 pt-1.5">
          {sortedTags.length === 0 && !noTagsFilter && (
            <span
              className="text-body px-2.5 py-1.5 italic"
              style={{ color: 'var(--text-muted)' }}
            >
              Assign tags in the table to start grouping related defects.
            </span>
          )}

          {sortedTags.map((tag) => {
            const isActive = selectedTagId === tag.id;
            const count = getTagCount(tag.id);
            return (
              <button
                key={tag.id}
                onClick={() => onTagToggle(tag.id)}
                className="w-full flex items-center justify-between gap-2.5 px-3 py-2.5 rounded-[18px] text-body font-medium transition-all duration-200 cursor-pointer border"
                style={{
                  background: isActive ? 'var(--bg-glow)' : 'transparent',
                  color: isActive ? tag.color : 'var(--text-secondary)',
                  borderColor: isActive ? `${tag.color}66` : 'transparent',
                  boxShadow: isActive ? `inset 0 0 0 1px ${tag.color}44` : 'none',
                }}
              >
                <span className="flex items-center gap-3 min-w-0">
                  <span
                    className="w-7 h-7 rounded-xl flex items-center justify-center flex-shrink-0"
                    style={{ background: `${tag.color}22` }}
                  >
                    <span
                      className="w-2.5 h-2.5 rounded-full"
                      style={{ background: tag.color }}
                    />
                  </span>
                  <span className="truncate">{tag.name}</span>
                </span>
                <span
                  className="text-ui font-mono tabular-nums min-w-[24px] text-center rounded-full px-2 py-1"
                  style={{
                    background: isActive ? `${tag.color}22` : 'var(--bg-tertiary)',
                    color: isActive ? tag.color : 'var(--text-muted)',
                  }}
                >
                  {count}
                </span>
              </button>
            );
          })}

          <button
            onClick={onNoTagsToggle}
            className="w-full flex items-center justify-between gap-2.5 px-3 py-2.5 rounded-[18px] text-body font-medium transition-all duration-200 cursor-pointer border"
            style={{
              background: noTagsFilter ? 'var(--bg-glow)' : 'transparent',
              color: noTagsFilter ? 'var(--accent)' : 'var(--text-secondary)',
              borderColor: noTagsFilter ? 'var(--border-active)' : 'transparent',
              boxShadow: noTagsFilter ? 'inset 0 0 0 1px var(--border-active)' : 'none',
            }}
          >
            <span className="flex items-center gap-3 min-w-0">
              <span
                className="w-7 h-7 rounded-xl flex items-center justify-center flex-shrink-0"
                style={{ background: 'var(--bg-tertiary)' }}
              >
                <span
                  className="w-3 h-3 rounded-full border"
                  style={{ borderColor: 'var(--text-muted)' }}
                />
              </span>
              <span className="truncate italic">No tags</span>
            </span>
            <span
              className="text-ui font-mono tabular-nums min-w-[24px] text-center rounded-full px-2 py-1"
              style={{
                background: noTagsFilter ? 'var(--accent-glow)' : 'var(--bg-tertiary)',
                color: noTagsFilter ? 'var(--accent)' : 'var(--text-muted)',
              }}
            >
              {tagCounts?.untaggedCount ?? 0}
            </span>
          </button>
        </div>
      )}
    </section>
  );
}
