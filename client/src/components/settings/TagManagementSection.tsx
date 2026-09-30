import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { createPortal } from 'react-dom';
import { TriangleAlert, Link2, Loader2, Search, Trash2, X } from 'lucide-react';
import { useToast } from '@/context/ToastContext';
import { useTagCounts } from '@/hooks/useTagCounts';
import { useDeleteTag, useTags, useTagUsage } from '@/hooks/useTags';
import { ApiRequestError } from '@/lib/api';
import type { LocalTag, TagUsageResponse } from '@/types';

export function TagManagementSection() {
  const { data: tags = [] } = useTags();
  const { data: tagCounts } = useTagCounts();
  const [search, setSearch] = useState('');
  const [unusedOnly, setUnusedOnly] = useState(false);
  const [selectedTag, setSelectedTag] = useState<LocalTag | null>(null);

  const usageCountById = useMemo(
    () => new Map(tagCounts?.counts.map((count) => [count.tagId, count.count]) ?? []),
    [tagCounts]
  );

  const filteredTags = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    return [...tags]
      .filter((tag) => {
        const usageCount = usageCountById.get(tag.id) ?? 0;
        if (unusedOnly && usageCount > 0) {
          return false;
        }
        if (!normalizedSearch) {
          return true;
        }
        return tag.name.toLowerCase().includes(normalizedSearch);
      })
      .sort((left, right) => {
        const countDiff = (usageCountById.get(right.id) ?? 0) - (usageCountById.get(left.id) ?? 0);
        if (countDiff !== 0) {
          return countDiff;
        }
        return left.name.localeCompare(right.name);
      });
  }, [search, tags, unusedOnly, usageCountById]);

  const unusedCount = useMemo(
    () => tags.filter((t) => (usageCountById.get(t.id) ?? 0) === 0).length,
    [tags, usageCountById]
  );

  return (
    <>
      <div className="max-w-[680px]">
        {/* Toolbar */}
        <div className="mb-3 flex items-center gap-2">
          <div className="relative flex-1">
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
            <input
              type="text"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search tags…"
              aria-label="Search tags"
              className="w-full rounded-lg py-1.5 pl-8 pr-3 text-[12.5px] outline-none"
              style={{ background: 'var(--settings-input-bg)', color: 'var(--text-primary)', border: 'var(--settings-input-border)' }}
            />
          </div>
          <button
            type="button"
            onClick={() => setUnusedOnly((v) => !v)}
            className="flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] font-medium transition-colors"
            style={{
              background: unusedOnly ? 'var(--settings-accent-soft-bg)' : 'var(--settings-neutral-chip-bg)',
              color: unusedOnly ? 'var(--accent)' : 'var(--text-secondary)',
              border: unusedOnly ? 'var(--settings-accent-soft-border)' : '1px solid var(--border-strong)',
            }}
          >
            Unused only
            {unusedCount > 0 ? (
              <span
                className="rounded-full px-1.5 py-0.5 text-[11px] font-semibold"
                style={{ background: unusedOnly ? 'var(--accent)' : 'var(--settings-neutral-chip-bg)', color: unusedOnly ? 'var(--on-accent)' : 'var(--text-muted)', border: unusedOnly ? 'none' : '1px solid var(--border-strong)' }}
              >
                {unusedCount}
              </span>
            ) : null}
          </button>
          <span
            className="shrink-0 rounded-lg px-2.5 py-1.5 text-[12px] font-semibold"
            style={{ background: 'var(--settings-neutral-chip-bg)', color: 'var(--text-muted)', border: '1px solid var(--border-strong)' }}
          >
            {tags.length} total
          </span>
        </div>

        {/* Tag list */}
        <div className="overflow-hidden rounded-xl" style={{ border: 'var(--settings-inset-border)' }}>
          {filteredTags.length === 0 ? (
            <div className="px-4 py-5 text-[13px]" style={{ color: 'var(--text-muted)' }}>
              {tags.length === 0
                ? 'No tags yet — create them from the defect table or triage panel.'
                : 'No tags match this filter.'}
            </div>
          ) : (
            filteredTags.map((tag, index) => {
              const usageCount = usageCountById.get(tag.id) ?? 0;
              const isUnused = usageCount === 0;
              return (
                <div
                  key={tag.id}
                  className="flex items-center gap-3 px-3 py-2"
                  style={{
                    background: index % 2 === 0 ? 'var(--settings-row-even-bg)' : 'var(--settings-row-odd-bg)',
                    borderTop: index > 0 ? 'var(--settings-row-divider)' : 'none',
                  }}
                >
                  {/* Color swatch */}
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ background: tag.color, boxShadow: `0 0 0 3px ${tag.color}28` }}
                    aria-hidden="true"
                  />

                  {/* Name */}
                  <p className="min-w-0 flex-1 truncate text-[13px] font-medium" style={{ color: 'var(--text-primary)' }}>
                    {tag.name}
                  </p>

                  {/* Usage badge */}
                  <span
                    className="shrink-0 rounded-full px-2 py-0.5 text-[12px] font-semibold"
                    style={{
                      background: isUnused ? 'var(--settings-success-soft-bg)' : 'var(--settings-warning-soft-bg)',
                      color: isUnused ? 'var(--success)' : 'var(--warning)',
                      border: isUnused ? 'var(--settings-success-soft-border)' : 'var(--settings-warning-soft-border)',
                    }}
                  >
                    {isUnused ? 'Unused' : `${usageCount} defect${usageCount === 1 ? '' : 's'}`}
                  </span>

                  {/* Delete */}
                  <button
                    type="button"
                    onClick={() => setSelectedTag(tag)}
                    className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[12px] font-semibold transition-colors"
                    style={{
                      background: 'var(--settings-danger-soft-bg)',
                      color: 'var(--danger-muted)',
                      border: 'var(--settings-danger-soft-border)',
                    }}
                    aria-label={`Delete tag ${tag.name}`}
                  >
                    <Trash2 size={11} />
                    Delete
                  </button>
                </div>
              );
            })
          )}
        </div>

        {filteredTags.length > 0 && (
          <p className="mt-2 text-[12px]" style={{ color: 'var(--text-muted)' }}>
            Deleting a tag removes it from every linked defect. The impact review shows exactly which issues will be affected before anything is removed.
          </p>
        )}
      </div>

      <DeleteTagDialog
        tag={selectedTag}
        onClose={() => setSelectedTag(null)}
      />
    </>
  );
}

function DeleteTagDialog({
  tag,
  onClose,
}: {
  tag: LocalTag | null;
  onClose: () => void;
}) {
  const { addToast } = useToast();
  const deleteTag = useDeleteTag();
  const { data: usage, isLoading, refetch } = useTagUsage(tag?.id, Boolean(tag));

  useEffect(() => {
    if (!tag) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [tag, onClose]);

  if (!tag || typeof document === 'undefined') {
    return null;
  }

  const resolvedUsage = usage ?? emptyUsage(tag);
  const hasLinkedDefects = resolvedUsage.issueCount > 0;
  const hiddenLinkedDefectCount = Math.max(0, resolvedUsage.issueCount - resolvedUsage.issues.length);

  const handleConfirmDelete = () => {
    if (isLoading || deleteTag.isPending) {
      return;
    }

    deleteTag.mutate(
      { id: tag.id, force: hasLinkedDefects },
      {
        onSuccess: (result) => {
          addToast({
            type: 'success',
            title: `Deleted tag "${tag.name}"`,
            message:
              result.removedIssueCount > 0
                ? `Removed it from ${result.removedIssueCount} defect${result.removedIssueCount === 1 ? '' : 's'}.`
                : 'The tag was removed with no linked defects.',
          });
          onClose();
        },
        onError: async (error) => {
          if (error instanceof ApiRequestError && error.status === 409) {
            await refetch();
            addToast({
              type: 'warning',
              title: 'Tag usage changed',
              message: 'This tag is now linked to defects. Review the impact and confirm again.',
            });
            return;
          }

          addToast({
            type: 'error',
            title: `Failed to delete "${tag.name}"`,
            message: error instanceof Error ? error.message : 'Request failed',
          });
        },
      }
    );
  };

  return createPortal(
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-3 sm:p-4 md:p-6">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="absolute inset-0"
        style={{ background: 'rgba(6, 10, 15, 0.62)', backdropFilter: 'blur(8px)' }}
        onClick={onClose}
      />

      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
        className="relative z-10 flex max-h-[min(88vh,760px)] w-full max-w-[720px] flex-col overflow-hidden rounded-[28px]"
        style={{
          background:
            'linear-gradient(180deg, color-mix(in srgb, var(--bg-primary) 95%, rgba(239,68,68,0.05)) 0%, var(--bg-secondary) 100%)',
          border: '1px solid color-mix(in srgb, var(--danger) 18%, var(--border-strong) 82%)',
          boxShadow: '0 32px 88px rgba(0,0,0,0.42)',
        }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-tag-dialog-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div
          className="shrink-0 border-b px-4 py-3.5 sm:px-5"
          style={{
            borderColor: 'color-mix(in srgb, var(--danger) 14%, var(--border) 86%)',
            background:
              'linear-gradient(135deg, color-mix(in srgb, var(--danger) 10%, transparent) 0%, transparent 72%)',
          }}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-3">
                <div
                  className="flex h-10 w-10 items-center justify-center rounded-2xl"
                  style={{
                    background: 'var(--settings-danger-soft-bg)',
                    color: 'var(--danger-muted)',
                    border: 'var(--settings-danger-soft-border)',
                  }}
                >
                  {hasLinkedDefects ? <TriangleAlert size={18} /> : <Trash2 size={18} />}
                </div>
                <div>
                  <div id="delete-tag-dialog-title" className="text-[16px] font-semibold" style={{ color: 'var(--text-primary)' }}>
                    Delete tag "{tag.name}"
                  </div>
                  <div className="text-[13px]" style={{ color: 'var(--text-secondary)' }}>
                    {isLoading
                      ? 'Checking where this tag is used before deleting it.'
                      : hasLinkedDefects
                        ? hiddenLinkedDefectCount > 0
                          ? 'This tag is still assigned. Some linked defects do not have synced details yet.'
                          : 'This tag is still assigned. Review the impact before deleting it everywhere.'
                        : 'This tag is unused and can be removed immediately.'}
                  </div>
                </div>
              </div>
              {!isLoading ? (
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <div
                    className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-medium"
                    style={{
                      background: hasLinkedDefects ? 'var(--settings-warning-soft-bg)' : 'var(--settings-success-soft-bg)',
                      color: hasLinkedDefects ? 'var(--warning)' : 'var(--success)',
                      border: hasLinkedDefects ? 'var(--settings-warning-soft-border)' : 'var(--settings-success-soft-border)',
                    }}
                  >
                    <Link2 size={12} />
                    {resolvedUsage.issueCount} linked defect{resolvedUsage.issueCount === 1 ? '' : 's'}
                  </div>
                  <div
                    className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-medium"
                    style={{
                      background: 'var(--settings-neutral-chip-bg)',
                      color: 'var(--text-secondary)',
                      border: '1px solid var(--border)',
                    }}
                  >
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: tag.color }} aria-hidden="true" />
                    Local tag
                  </div>
                </div>
              ) : null}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="flex h-9 w-9 items-center justify-center rounded-xl transition-colors"
              style={{ background: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}
              aria-label="Close delete tag dialog"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3.5 sm:px-5">
          {isLoading ? (
            <div
              className="flex items-center gap-2 rounded-[18px] border px-4 py-4 text-[13px]"
              style={{
                borderColor: 'color-mix(in srgb, var(--border-strong) 82%, transparent)',
                color: 'var(--text-secondary)',
                background: 'var(--settings-inset-bg)',
              }}
            >
              <Loader2 size={14} className="animate-spin" style={{ color: 'var(--accent)' }} />
              Loading linked defects…
            </div>
          ) : hasLinkedDefects ? (
            <div className="space-y-4">
              <div
                className="rounded-[18px] px-4 py-3.5 text-[13px] leading-relaxed"
                style={{
                  background: 'var(--settings-warning-soft-bg)',
                  color: 'var(--text-secondary)',
                  border: 'var(--settings-warning-soft-border)',
                }}
              >
                Deleting this tag will remove it from {resolvedUsage.issueCount} defect{resolvedUsage.issueCount === 1 ? '' : 's'}
                {' '}and then delete the tag itself.
                {hiddenLinkedDefectCount > 0
                  ? ` ${hiddenLinkedDefectCount} linked defect${hiddenLinkedDefectCount === 1 ? '' : 's'} ${hiddenLinkedDefectCount === 1 ? 'does' : 'do'} not have synced details yet.`
                  : ''}
              </div>

              <div>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <label
                    className="text-[12px] font-semibold uppercase"
                    style={{ color: 'var(--text-muted)', letterSpacing: '0.08em' }}
                  >
                    Linked defects
                  </label>
                  <span className="text-[12px]" style={{ color: 'var(--text-secondary)' }}>
                    {hiddenLinkedDefectCount > 0
                      ? `${hiddenLinkedDefectCount} linked defect${hiddenLinkedDefectCount === 1 ? '' : 's'} ${hiddenLinkedDefectCount === 1 ? 'is' : 'are'} not available in the preview list yet.`
                      : 'Review exactly what will lose this tag.'}
                  </span>
                </div>

                {resolvedUsage.issues.length > 0 ? (
                  <div className="max-h-[320px] overflow-y-auto rounded-[18px]" style={{ border: 'var(--settings-inset-border)' }}>
                    {resolvedUsage.issues.map((issue, index) => (
                      <div
                        key={issue.jiraKey}
                        className="flex flex-col gap-2 px-4 py-3"
                        style={{
                          background: index % 2 === 0 ? 'var(--settings-row-even-bg)' : 'var(--settings-row-odd-bg)',
                          borderTop: index > 0 ? 'var(--settings-row-divider)' : 'none',
                        }}
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[13px] font-semibold" style={{ color: 'var(--accent)' }}>
                            {issue.jiraKey}
                          </span>
                          <span
                            className="rounded-full px-2 py-1 text-[12px] font-semibold uppercase tracking-[0.12em]"
                            style={{
                              background: 'var(--settings-neutral-chip-bg)',
                              color: 'var(--text-muted)',
                              border: '1px solid var(--border-strong)',
                            }}
                          >
                            {issue.statusName}
                          </span>
                        </div>
                        <p className="text-[13px] font-medium leading-relaxed" style={{ color: 'var(--text-primary)' }}>
                          {issue.summary}
                        </p>
                        <p className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
                          {issue.assigneeName ? `Assigned to ${issue.assigneeName}` : 'Unassigned'}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : hiddenLinkedDefectCount > 0 ? (
                  <div
                    className="rounded-[18px] px-4 py-3.5 text-[13px] leading-relaxed"
                    style={{
                      background: 'var(--settings-inset-bg)',
                      color: 'var(--text-secondary)',
                      border: 'var(--settings-inset-border)',
                    }}
                  >
                    No synced defect details are available yet for the linked assignment{hiddenLinkedDefectCount === 1 ? '' : 's'}.
                  </div>
                ) : null}
              </div>
            </div>
          ) : (
            <div
              className="rounded-[18px] px-4 py-3.5 text-[13px] leading-relaxed"
              style={{
                background: 'var(--settings-success-soft-bg)',
                color: 'var(--text-secondary)',
                border: 'var(--settings-success-soft-border)',
              }}
            >
              No defects currently use this tag. Delete it if you no longer want it available in the tag library.
            </div>
          )}
        </div>

        <div
          className="shrink-0 border-t px-4 py-3.5 sm:px-5"
          style={{
            borderColor: 'color-mix(in srgb, var(--border-strong) 84%, transparent)',
            background: 'color-mix(in srgb, var(--bg-secondary) 88%, transparent)',
          }}
        >
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-end">
            <button
              type="button"
              onClick={onClose}
              disabled={deleteTag.isPending}
              className="rounded-2xl px-4 py-2.5 text-[13px] font-medium transition-colors disabled:opacity-50"
              style={{
                background: 'var(--settings-neutral-chip-bg)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border-strong)',
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleConfirmDelete}
              disabled={isLoading || deleteTag.isPending}
              className="flex items-center justify-center gap-2 rounded-2xl px-4 py-2.5 text-[13px] font-semibold transition-colors disabled:opacity-50"
              style={{
                background: 'linear-gradient(135deg, color-mix(in srgb, var(--danger) 18%, var(--bg-primary)), color-mix(in srgb, var(--warning) 12%, var(--bg-primary)))',
                color: 'var(--danger-muted)',
                border: 'var(--settings-danger-soft-border)',
              }}
            >
              {deleteTag.isPending ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
              {deleteTag.isPending
                ? 'Deleting…'
                : hasLinkedDefects
                  ? `Delete from ${resolvedUsage.issueCount} defect${resolvedUsage.issueCount === 1 ? '' : 's'}`
                  : 'Delete tag'}
            </button>
          </div>
        </div>
      </motion.div>
    </div>,
    document.body
  );
}

function emptyUsage(tag: LocalTag): TagUsageResponse {
  return {
    tag,
    issueCount: 0,
    issues: [],
  };
}
