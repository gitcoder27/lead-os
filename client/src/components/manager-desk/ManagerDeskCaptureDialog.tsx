import { useId, useMemo, useRef, useState } from 'react';
import {
  Briefcase,
  Bug,
  CalendarDays,
  FileText,
  UserRound,
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { useToast } from '@/context/ToastContext';
import { useCreateManagerDeskItem } from '@/hooks/useManagerDesk';
import { JiraIssueLink } from '@/components/JiraIssueLink';
import { getLocalIsoDate } from '@/lib/utils';
import type {
  ManagerDeskCategory,
  ManagerDeskCreateItemPayload,
  ManagerDeskItemKind,
} from '@/types/manager-desk';
import { CATEGORY_LABELS, KIND_LABELS } from '@/types/manager-desk';
import { useTasksPhase3 } from '@/hooks/useTasksPhase3';
import { Dialog, DialogActions } from '@/components/ui/Dialog';

type CaptureLink = NonNullable<ManagerDeskCreateItemPayload['links']>[number];

interface ContextChip {
  label: string;
  value: string;
  tone?: 'issue' | 'developer' | 'generic';
}

interface ManagerDeskCaptureDialogProps {
  onClose: () => void;
  onOpenManagerDesk?: () => void;
  heading?: string;
  description?: string;
  initialTitle?: string;
  initialKind?: ManagerDeskItemKind;
  initialCategory?: ManagerDeskCategory;
  initialContextNote?: string;
  initialLinks?: CaptureLink[];
  contextChips?: ContextChip[];
  date?: string;
}

const kindOptions: ManagerDeskItemKind[] = ['action', 'meeting', 'decision'];
const categoryOptions: ManagerDeskCategory[] = [
  'analysis',
  'design',
  'team_management',
  'cross_team',
  'follow_up',
  'escalation',
  'admin',
  'planning',
  'other',
];

function chipAccent(tone: ContextChip['tone']) {
  if (tone === 'issue') return { color: 'var(--accent)', Icon: Bug };
  if (tone === 'developer') return { color: 'var(--success)', Icon: UserRound };
  return { color: 'var(--text-secondary)', Icon: Briefcase };
}

export function ManagerDeskCaptureDialog({
  onClose,
  onOpenManagerDesk,
  heading = 'Capture For Desk',
  description = 'Save a follow-up for today without losing the screen context you are already in.',
  initialTitle = '',
  initialKind = 'action',
  initialCategory = 'other',
  initialContextNote = '',
  initialLinks = [],
  contextChips = [],
  date,
}: ManagerDeskCaptureDialogProps) {
  const captureDate = date ?? getLocalIsoDate();
  const createItem = useCreateManagerDeskItem(captureDate);
  const { addToast } = useToast();
  const titleRef = useRef<HTMLInputElement>(null);
  // Phase 3 (P3-D13): kind/category pickers retire; initial values still apply
  // semantically (e.g. follow_up → category:follow_up label).
  const phase3 = useTasksPhase3();
  const dialogDescriptionId = useId();
  const [title, setTitle] = useState(initialTitle);
  const [kind, setKind] = useState<ManagerDeskItemKind>(initialKind);
  const [category, setCategory] = useState<ManagerDeskCategory>(initialCategory);
  const [contextNote, setContextNote] = useState(initialContextNote);
  const [detailsOpen, setDetailsOpen] = useState(Boolean(initialContextNote));

  const formattedDate = useMemo(() => format(parseISO(captureDate), 'EEEE, MMM d'), [captureDate]);



  const handleSubmit = () => {
    const trimmedTitle = title.trim();
    if (!trimmedTitle || createItem.isPending) {
      return;
    }

    createItem.mutate(
      {
        date: captureDate,
        title: trimmedTitle,
        kind,
        category,
        contextNote: contextNote.trim() || undefined,
        links: initialLinks.length > 0 ? initialLinks : undefined,
      },
      {
        onSuccess: () => {
          addToast({
            type: 'success',
            title: `Saved to ${phase3 ? 'Tasks' : 'Desk'}`,
            message: `Scheduled for ${formattedDate}.`,
            action: onOpenManagerDesk
              ? {
                  label: 'Open Desk',
                  onClick: onOpenManagerDesk,
                }
              : undefined,
          });
          onClose();
        },
        onError: (error) => {
          addToast({
            type: 'error',
            title: `Could not save to ${phase3 ? 'Tasks' : 'Desk'}`,
            message: error.message,
          });
        },
      },
    );
  };

  // docs/54 V1/J2: the app's one dialog shell; under Phase 3 the capture
  // lands in Tasks and wears the Tasks accent, not the legacy Desk amber.
  const surface = phase3 ? 'Tasks' : 'Desk';
  const accent = phase3 ? 'var(--accent)' : 'var(--md-accent)';
  return (
    <Dialog
      title={heading}
      ariaLabel={typeof heading === 'string' ? heading : undefined}
      icon={<Briefcase size={14} />}
      closeLabel="Close manager desk capture"
      onClose={onClose}
      onSubmit={handleSubmit}
      subtitle={
        <span className="mt-1 flex flex-wrap items-center gap-1.5">
          <span className="ui-chip gap-1" style={{ ['--tone' as string]: accent }}>
            <CalendarDays size={10} />
            {formattedDate}
          </span>
          {contextChips.map((chip) => {
            const chipAccentStyle = chipAccent(chip.tone);
            const Icon = chipAccentStyle.Icon;
            const chipEl = (
              <>
                <Icon size={10} />
                <span>{chip.value}</span>
              </>
            );
            if (chip.tone === 'issue') {
              return (
                <JiraIssueLink key={`${chip.label}-${chip.value}`} issueKey={chip.value} className="ui-chip gap-1" style={{ ['--tone' as string]: chipAccentStyle.color }}>
                  {chipEl}
                </JiraIssueLink>
              );
            }
            return (
              <span key={`${chip.label}-${chip.value}`} className="ui-chip gap-1" style={{ ['--tone' as string]: chipAccentStyle.color }}>
                {chipEl}
              </span>
            );
          })}
        </span>
      }
      footer={
        <DialogActions
          saveLabel={`Add to ${surface}`}
          isSaving={createItem.isPending}
          canSave={Boolean(title.trim())}
          onCancel={onClose}
          onSave={handleSubmit}
          submitKey="enter"
        />
      }
    >
      <div className="space-y-3">
        <input
          id="manager-desk-capture-title"
          ref={titleRef}
          data-autofocus=""
          type="text"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              handleSubmit();
            }
          }}
          placeholder={`What needs to land on your ${surface === 'Tasks' ? 'list' : 'desk'}?`}
          aria-label="Title"
          className="ui-field"
          maxLength={200}
        />

        {/* Kind + Category — single compact row (hidden under Phase 3) */}
        {!phase3 && (
          <div className="flex flex-wrap items-center gap-2">
            <div className="ui-segment" role="group" aria-label="Kind">
              {kindOptions.map((option) => (
                <button key={option} type="button" aria-pressed={kind === option} onClick={() => setKind(option)}>
                  {KIND_LABELS[option]}
                </button>
              ))}
            </div>
            <div className="ml-auto">
              <select
                id="manager-desk-capture-category"
                value={category}
                onChange={(event) => setCategory(event.target.value as ManagerDeskCategory)}
                className="ui-field py-1 text-[12px]"
                aria-label="Category"
              >
                {categoryOptions.map((option) => (
                  <option key={option} value={option}>
                    {CATEGORY_LABELS[option]}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}

        {detailsOpen ? (
          <div>
            <label htmlFor="manager-desk-capture-note" className="ui-field-label">
              Context note <span style={{ color: 'var(--text-muted)' }}>(optional)</span>
            </label>
            <textarea
              id="manager-desk-capture-note"
              value={contextNote}
              onChange={(event) => setContextNote(event.target.value)}
              rows={2}
              placeholder="Quick context so future-you remembers why…"
              className="ui-field"
              style={{ minHeight: '52px' }}
              maxLength={1500}
            />
          </div>
        ) : (
          <button type="button" onClick={() => setDetailsOpen(true)} className="ui-btn-ghost -ml-2">
            <FileText size={12} /> Add a context note
          </button>
        )}
        <p id={dialogDescriptionId} className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
          {description}
        </p>
      </div>
    </Dialog>
  );
}
