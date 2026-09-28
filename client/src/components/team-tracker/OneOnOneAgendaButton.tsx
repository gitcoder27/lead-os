import { ListPlus } from 'lucide-react';
import { useQuickAttachOneOnOneAgenda } from '@/hooks/useOneOnOne';
import { useToast } from '@/context/ToastContext';
import { ToolbarButton } from './TrackerItemRowActions';

/**
 * Developer-drawer row action: put this task on the developer's 1:1 agenda.
 * The server starts a weekly series when the developer has none, so the
 * manager never has to set one up first. Manager-only; callers gate it on the
 * `one_on_one_enabled` flag and on the row having a canonical task key.
 */
export function OneOnOneAgendaButton({
  developerAccountId,
  taskKey,
  title,
  onOpenOneOnOne,
}: {
  developerAccountId: string;
  taskKey: string;
  title: string;
  onOpenOneOnOne?: (accountId: string) => void;
}) {
  const { addToast } = useToast();
  const attach = useQuickAttachOneOnOneAgenda();
  return (
    <ToolbarButton
      label={`Add ${title} to 1:1 agenda`}
      title="Add to 1:1 agenda"
      disabled={attach.isPending}
      onClick={() =>
        attach.mutate(
          { developerAccountId, taskKey },
          {
            onSuccess: (result) =>
              addToast({
                type: 'success',
                title: `Added to ${result.developerName.split(' ')[0]}'s 1:1 agenda`,
                message: result.seriesCreated ? 'Started a weekly 1:1 series — change the cadence in the workspace.' : undefined,
                action: onOpenOneOnOne ? { label: 'Open 1:1', onClick: () => onOpenOneOnOne(developerAccountId) } : undefined,
              }),
            onError: (error) =>
              addToast(
                error instanceof Error && /already on the agenda/i.test(error.message)
                  ? 'Already on the 1:1 agenda'
                  : error instanceof Error
                    ? error.message
                    : 'Could not add to the 1:1 agenda',
                error instanceof Error && /already on the agenda/i.test(error.message) ? 'info' : 'error',
              ),
          },
        )
      }
    >
      <ListPlus size={14} style={{ color: 'var(--text-secondary)' }} />
    </ToolbarButton>
  );
}
