import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Check, Plus, Tag, X } from 'lucide-react';
import { createPortal } from 'react-dom';
import * as Tooltip from '@radix-ui/react-tooltip';
import { useIssueTagActions } from '@/hooks/useIssueTagActions';
import { findTagByName, normalizeTagName } from '@/lib/tag-utils';
import type { LocalTag } from '@/types';
import { resolveTagPopoverPosition } from '@/components/table/tagPopoverPosition';

interface InlineEditTagsProps {
  issueKey: string;
  localTags: LocalTag[];
}

const TAG_POPOVER_WIDTH = 280;

export function InlineEditTags({ issueKey, localTags }: InlineEditTagsProps) {
  const { allTags, assignedTagIds, isPending, toggleTag, createOrAssignTag } = useIssueTagActions({
    issueKey,
    localTags,
  });
  const [isOpen, setIsOpen] = useState(false);
  const [tagInput, setTagInput] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [popoverPosition, setPopoverPosition] = useState<{ top: number; left: number } | null>(null);

  const normalizedInput = normalizeTagName(tagInput).toLowerCase();

  const filteredTags = useMemo(() => {
    if (!normalizedInput) {
      return allTags;
    }
    return allTags.filter((tag) => tag.name.toLowerCase().includes(normalizedInput));
  }, [allTags, normalizedInput]);

  const exactMatch = useMemo(() => findTagByName(allTags, normalizedInput), [allTags, normalizedInput]);
  const hiddenTags = useMemo(() => localTags.slice(2), [localTags]);

  const computePopoverPosition = useCallback((): { top: number; left: number } | null => {
    if (!triggerRef.current) {
      return null;
    }

    return resolveTagPopoverPosition({
      triggerRect: triggerRef.current.getBoundingClientRect(),
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      popoverWidth: TAG_POPOVER_WIDTH,
      popoverHeight: popoverRef.current?.offsetHeight,
    });
  }, []);

  const updatePopoverPosition = useCallback(() => {
    const nextPosition = computePopoverPosition();
    if (nextPosition) {
      setPopoverPosition((currentPosition) => {
        if (
          currentPosition &&
          currentPosition.top === nextPosition.top &&
          currentPosition.left === nextPosition.left
        ) {
          return currentPosition;
        }
        return nextPosition;
      });
    }
  }, [computePopoverPosition]);

  const setOpenState = useCallback((nextOpen: boolean) => {
    setIsOpen(nextOpen);
    if (!nextOpen) {
      setPopoverPosition(null);
    }
  }, []);

  const toggleOpen = useCallback(() => {
    if (isOpen) {
      setOpenState(false);
      return;
    }

    const nextPosition = computePopoverPosition();
    if (nextPosition) {
      setPopoverPosition(nextPosition);
    }
    setOpenState(true);
  }, [computePopoverPosition, isOpen, setOpenState]);

  useLayoutEffect(() => {
    if (!isOpen) {
      return;
    }

    updatePopoverPosition();
  }, [isOpen, updatePopoverPosition]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    inputRef.current?.focus();

    const onOutsideClick = (event: MouseEvent) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target) || popoverRef.current?.contains(target)) {
        return;
      }
      setOpenState(false);
    };

    const onReposition = () => {
      updatePopoverPosition();
    };

    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpenState(false);
      }
    };

    window.addEventListener('mousedown', onOutsideClick);
    window.addEventListener('scroll', onReposition, true);
    window.addEventListener('resize', onReposition);
    window.addEventListener('keydown', onEscape);
    return () => {
      window.removeEventListener('mousedown', onOutsideClick);
      window.removeEventListener('scroll', onReposition, true);
      window.removeEventListener('resize', onReposition);
      window.removeEventListener('keydown', onEscape);
    };
  }, [isOpen, setOpenState, updatePopoverPosition]);

  return (
    <div
      ref={rootRef}
      className="relative max-w-[260px]"
      data-tag-editor-root="true"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-1 flex-wrap">
        {localTags.length > 0 ? (
          <>
            {localTags.slice(0, 2).map((tag) => (
              <button
                key={tag.id}
                onClick={() => toggleTag(tag.id)}
                disabled={isPending}
                className="text-[12px] px-1.5 py-0.5 rounded-full font-medium leading-none whitespace-nowrap hover:opacity-80 transition-opacity disabled:cursor-wait disabled:opacity-60"
                style={{ background: `${tag.color}25`, color: tag.color, border: `1px solid ${tag.color}40` }}
                title={`Remove "${tag.name}"`}
              >
                {tag.name}
              </button>
            ))}
            {hiddenTags.length > 0 && (
              <Tooltip.Provider delayDuration={120}>
                <Tooltip.Root>
                  <Tooltip.Trigger asChild>
                    <button
                      type="button"
                      className="text-[12px] px-1 py-0.5 rounded-full cursor-help"
                      style={{ color: 'var(--text-muted)', border: '1px dashed var(--border)' }}
                      aria-label={`View ${hiddenTags.length} more tags`}
                    >
                      +{hiddenTags.length}
                    </button>
                  </Tooltip.Trigger>
                  <Tooltip.Portal>
                    <Tooltip.Content
                      side="top"
                      align="start"
                      sideOffset={6}
                      className="z-[140] max-w-[260px] rounded-md px-2 py-1.5"
                      style={{
                        background: 'var(--bg-secondary)',
                        border: '1px solid var(--border)',
                        boxShadow: '0 10px 28px rgba(0,0,0,0.35)',
                      }}
                    >
                      <div className="flex flex-wrap gap-1">
                        {hiddenTags.map((tag) => (
                          <span
                            key={tag.id}
                            className="text-[12px] px-1.5 py-0.5 rounded-full font-medium leading-none whitespace-nowrap"
                            style={{ background: `${tag.color}25`, color: tag.color, border: `1px solid ${tag.color}40` }}
                          >
                            {tag.name}
                          </span>
                        ))}
                      </div>
                    </Tooltip.Content>
                  </Tooltip.Portal>
                </Tooltip.Root>
              </Tooltip.Provider>
            )}
          </>
        ) : (
          <span className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
            No tags
          </span>
        )}

        <button
          ref={triggerRef}
          onClick={toggleOpen}
          className="p-0.5 rounded transition-colors hover:bg-[var(--bg-tertiary)]"
          title="Manage tags"
          aria-label={`Manage tags for ${issueKey}`}
        >
          <Plus size={12} style={{ color: 'var(--text-muted)' }} />
        </button>
      </div>

      {isOpen &&
        popoverPosition &&
        createPortal(
          <div
            ref={popoverRef}
            className="fixed z-[120] w-[280px] rounded-md p-2.5"
            data-tag-editor-popover="true"
            style={{
              top: `${popoverPosition.top}px`,
              left: `${popoverPosition.left}px`,
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border)',
              boxShadow: '0 8px 24px rgba(0,0,0,0.28)',
            }}
          >
            <div className="flex items-center gap-1.5 mb-2">
              <Tag size={12} style={{ color: 'var(--text-muted)' }} />
              <span className="text-[12px] font-semibold uppercase" style={{ letterSpacing: '0.06em', color: 'var(--text-muted)' }}>
                Tags
              </span>
            </div>

            <div className="flex gap-1.5 mb-2">
              <input
                ref={inputRef}
                type="text"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    createOrAssignTag(tagInput, { onSuccess: () => setTagInput('') });
                  }
                }}
                placeholder="Search or create tag…"
                className="flex-1 text-[13px] px-2 py-1 rounded focus:outline-none focus:ring-1"
                style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border)', outlineColor: 'var(--accent)' }}
              />
              <button
                onClick={() => createOrAssignTag(tagInput, { onSuccess: () => setTagInput('') })}
                disabled={!tagInput.trim() || isPending}
                className="text-[12px] px-2 py-1 rounded font-medium disabled:opacity-40 transition-colors"
                style={{ background: 'var(--accent-solid)', color: 'var(--on-accent)' }}
              >
                {exactMatch ? 'Use' : 'Add'}
              </button>
            </div>

            <div className="max-h-[140px] overflow-y-auto rounded-sm p-1" style={{ background: 'var(--bg-tertiary)' }}>
              {filteredTags.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {filteredTags.map((tag) => {
                    const isAssigned = assignedTagIds.has(tag.id);
                    return (
                      <button
                        key={tag.id}
                        onClick={() => toggleTag(tag.id)}
                        disabled={isPending}
                        className="text-[12px] px-2 py-0.5 rounded-full font-medium flex items-center gap-1 transition-opacity disabled:cursor-wait disabled:opacity-60"
                        style={{
                          background: isAssigned ? `${tag.color}40` : `${tag.color}15`,
                          color: tag.color,
                          border: `1px solid ${tag.color}${isAssigned ? '80' : '30'}`,
                          opacity: isAssigned ? 1 : 0.75,
                        }}
                        title={isAssigned ? `Remove "${tag.name}"` : `Add "${tag.name}"`}
                      >
                        {isAssigned ? <Check size={10} /> : <Plus size={10} />}
                        {tag.name}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="text-[12px] px-1 py-1.5" style={{ color: 'var(--text-muted)' }}>
                  No matching tags. Create one with the input above.
                </p>
              )}
            </div>

            <div className="mt-2 flex justify-end">
              <button
                onClick={() => setOpenState(false)}
                className="text-[12px] px-2 py-1 rounded transition-colors hover:bg-[var(--bg-tertiary)]"
                style={{ color: 'var(--text-secondary)' }}
              >
                <span className="inline-flex items-center gap-1">
                  <X size={11} />
                  Close
                </span>
              </button>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
