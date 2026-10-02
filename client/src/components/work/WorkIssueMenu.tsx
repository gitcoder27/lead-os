import { useRef, useState } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { MenuItem, TaskPopover } from '@/components/ui/Popover';
import { Dialog } from '@/components/ui/Dialog';
import { useJiraExecution } from '@/hooks/useJiraExecution';
import { useExcludeIssue } from '@/hooks/useExcludeIssue';
import { useToast } from '@/context/ToastContext';
import { getLocalIsoDate, shiftLocalIsoDate } from '@/lib/utils';
import type { Issue } from '@/types';
function nextWeek(): string {
  const day = getLocalIsoDate();
  const weekday = new Date(`${day}T12:00:00`).getDay();
  return shiftLocalIsoDate(day, weekday === 0 ? 1 : 8 - weekday);
}
export function WorkIssueMenu({ issue }: { issue: Issue }) {
  const trigger = useRef<HTMLButtonElement>(null);
  const closeCustom = () => {
    setCustom(false);
    requestAnimationFrame(() => trigger.current?.focus());
  };
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [custom, setCustom] = useState(false);
  const [date, setDate] = useState(shiftLocalIsoDate(getLocalIsoDate(), 1));
  const { snooze } = useJiraExecution();
  const { exclude, restore } = useExcludeIssue();
  const { addToast } = useToast();
  const hidden = issue.excluded || Boolean(issue.snoozedUntil && Date.parse(issue.snoozedUntil) > Date.now());
  const snoozeUntil = async (day: string) => {
    try {
      await snooze.mutateAsync({ key: issue.jiraKey, until: new Date(`${day}T00:00:00`).toISOString() });
      closeCustom();
      setAnchor(null);
      addToast({ type: 'success', title: `${issue.jiraKey} snoozed until ${day}` });
    } catch (error) {
      addToast({
        type: 'error',
        title: "Couldn't snooze issue",
        message: error instanceof Error ? error.message : 'Try again.',
      });
    }
  };
  const setHidden = (value: boolean) => {
    (value ? exclude : restore).mutate(issue.jiraKey, {
      onSuccess: () => {
        setAnchor(null);
        addToast({
          type: 'success',
          title: `${issue.jiraKey} ${value ? 'excluded' : 'restored'}`,
          ...(value && { message: 'Find it in Excluded / snoozed.' }),
        });
      },
      onError: (error) =>
        addToast({ type: 'error', title: "Couldn't update issue visibility", message: error.message }),
    });
  };
  return (
    <span onClick={(event) => event.stopPropagation()}>
      <button
        ref={trigger}
        type="button"
        className="ui-btn-ghost work-issue-more"
        aria-label={`More actions for ${issue.jiraKey}`}
        aria-haspopup="menu"
        aria-expanded={Boolean(anchor)}
        onClick={(event) => setAnchor(anchor ? null : event.currentTarget)}
      >
        <MoreHorizontal size={16} />
      </button>
      {anchor && (
        <TaskPopover
          className="work-execution-menu"
          anchor={anchor}
          label={`Actions for ${issue.jiraKey}`}
          role="menu"
          width={240}
          onClose={() => setAnchor(null)}
        >
          {hidden ? (
            <MenuItem label="Restore to Work" onSelect={() => setHidden(false)} />
          ) : (
            <>
              <MenuItem
                label="Snooze until tomorrow"
                onSelect={() => void snoozeUntil(shiftLocalIsoDate(getLocalIsoDate(), 1))}
              />
              <MenuItem label="Snooze until next week" onSelect={() => void snoozeUntil(nextWeek())} />
              <MenuItem
                label="Choose snooze date…"
                onSelect={() => {
                  setAnchor(null);
                  setCustom(true);
                }}
              />
              <MenuItem label="Exclude from Work" onSelect={() => setHidden(true)} />
            </>
          )}
          {issue.snoozedUntil && hidden && (
            <p className="p-3 text-[12px]">Snoozed until {new Date(issue.snoozedUntil).toLocaleString()}</p>
          )}
        </TaskPopover>
      )}
      {custom && (
        <Dialog title={`Snooze ${issue.jiraKey}`} onClose={closeCustom} size="sm">
          <label className="block text-[13px]">
            Return on
            <input
              data-autofocus
              className="ui-input block mt-2"
              type="date"
              min={shiftLocalIsoDate(getLocalIsoDate(), 1)}
              value={date}
              onChange={(event) => setDate(event.target.value)}
            />
          </label>
          <p className="text-[13px] my-3">You can restore it earlier from Excluded / snoozed.</p>
          <div className="flex justify-end gap-2">
            <button type="button" className="ui-btn-secondary" onClick={closeCustom}>
              Cancel
            </button>
            <button
              type="button"
              className="ui-btn-primary"
              disabled={snooze.isPending || date <= getLocalIsoDate()}
              onClick={() => void snoozeUntil(date)}
            >
              Snooze
            </button>
          </div>
        </Dialog>
      )}
    </span>
  );
}
