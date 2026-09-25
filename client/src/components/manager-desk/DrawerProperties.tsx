import { useEffect, useId, useState } from 'react';
import type { ManagerDeskItem, ManagerDeskItemKind, ManagerDeskStatus, ManagerDeskUpdateItemPayload } from '@/types/manager-desk';
import { KIND_LABELS, STATUS_LABELS, CATEGORY_LABELS, PRIORITY_LABELS } from '@/types/manager-desk';
import { useTasksPhase3 } from '@/hooks/useTasksPhase3';

interface DrawerPropertiesProps {
  item: ManagerDeskItem;
  readOnly?: boolean;
  onFieldChange: (field: keyof ManagerDeskUpdateItemPayload, value: string | null) => void;
}

const primaryKindValues = ['action', 'meeting', 'decision'] as const;
const primaryStatusValues = ['inbox', 'planned', 'in_progress', 'backlog', 'done', 'cancelled'] as const;
const kindOpts = primaryKindValues.map((v) => ({ value: v, label: KIND_LABELS[v] }));
const statusOpts = primaryStatusValues.map((v) => ({ value: v, label: STATUS_LABELS[v] }));
const categoryOpts = (['analysis', 'design', 'team_management', 'cross_team', 'follow_up', 'escalation', 'admin', 'planning', 'other'] as const).map((v) => ({ value: v, label: CATEGORY_LABELS[v] }));
const priorityOpts = (['low', 'medium', 'high', 'critical'] as const).map((v) => ({ value: v, label: PRIORITY_LABELS[v] }));

export function DrawerProperties({ item, readOnly = false, onFieldChange }: DrawerPropertiesProps) {
  // Phase 3 (P3-D13): kind/category fields retire; labels are the taxonomy.
  const phase3 = useTasksPhase3();
  const hasLinkedWork = !!item.delegatedExecution;

  const filteredStatusOpts = hasLinkedWork
    ? statusOpts.filter((o) => o.value !== 'cancelled' && o.value !== 'backlog')
    : statusOpts;
  const visibleKindOpts = includeCurrentOption(kindOpts, item.kind, KIND_LABELS);
  const visibleStatusOpts = includeCurrentOption(filteredStatusOpts, item.status, STATUS_LABELS);

  return (
    <details className="px-5 py-4" style={{ borderBottom: '1px solid var(--border)' }}>
      <summary className="cursor-pointer select-none text-[10px] font-bold uppercase tracking-[0.16em]" style={{ color: 'var(--text-muted)' }}>
        Details
      </summary>
      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2.5">
        {!phase3 && <InlineSelect label="Kind" value={item.kind} options={visibleKindOpts} onChange={(v) => onFieldChange('kind', v)} disabled={readOnly} />}
        <InlineSelect label={hasLinkedWork ? 'My follow-through' : 'Status'} value={item.status} options={visibleStatusOpts} onChange={(v) => onFieldChange('status', v)} disabled={readOnly} />
        {!phase3 && <InlineSelect label="Category" value={item.category} options={categoryOpts} onChange={(v) => onFieldChange('category', v)} disabled={readOnly} />}
        <InlineSelect label="Priority" value={item.priority} options={priorityOpts} onChange={(v) => onFieldChange('priority', v)} disabled={readOnly} />
        <InlineText label="Participants" value={item.participants ?? ''} placeholder="e.g. Design Team, Rahul" onChange={(v) => onFieldChange('participants', v.trim() ? v : null)} className="col-span-2" disabled={readOnly} />
        <InlineDatetime label="Start" value={item.plannedStartAt ?? ''} onChange={(v) => onFieldChange('plannedStartAt', v)} disabled={readOnly} />
        <InlineDatetime label="End" value={item.plannedEndAt ?? ''} onChange={(v) => onFieldChange('plannedEndAt', v)} disabled={readOnly} />
        <InlineDatetime label="Follow-Up" value={item.followUpAt ?? ''} onChange={(v) => onFieldChange('followUpAt', v)} className="col-span-2" disabled={readOnly} />
        <InlineText label="Outcome" value={item.outcome ?? ''} placeholder="What was the result or decision?" onChange={(v) => onFieldChange('outcome', v.trim() ? v : null)} className="col-span-2" disabled={readOnly} />
      </div>
    </details>
  );
}

function includeCurrentOption<T extends ManagerDeskItemKind | ManagerDeskStatus>(
  options: Array<{ value: T; label: string }>,
  currentValue: T,
  labels: Record<T, string>,
) {
  if (options.some((option) => option.value === currentValue)) {
    return options;
  }
  return [...options, { value: currentValue, label: `${labels[currentValue]} (legacy)` }];
}

function InlineSelect<T extends string>({ label, value, options, onChange, emptyLabel, disabled = false }: {
  label: string; value: T | ''; options: Array<{ value: T; label: string }>; onChange: (value: string) => void; emptyLabel?: string; disabled?: boolean;
}) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="mb-0.5 block text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: 'var(--text-muted)' }}>{label}</label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} className="w-full cursor-pointer rounded-lg px-2 py-1.5 text-[12px] font-medium outline-none disabled:cursor-not-allowed disabled:opacity-70" style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}>
        {emptyLabel && <option value="">{emptyLabel}</option>}
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

function InlineText({ label, value, placeholder, onChange, className, disabled = false }: {
  label: string; value: string; placeholder: string; onChange: (value: string) => void; className?: string; disabled?: boolean;
}) {
  const id = useId();
  const [local, setLocal] = useState(value);
  useEffect(() => { setLocal(value); }, [value]);
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-0.5 block text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: 'var(--text-muted)' }}>{label}</label>
      <input id={id} type="text" value={local} onChange={(e) => setLocal(e.target.value)} onBlur={() => { if (local !== value) onChange(local); }} placeholder={placeholder} disabled={disabled} className="w-full rounded-lg px-2 py-1.5 text-[12px] outline-none disabled:cursor-not-allowed disabled:opacity-70" style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }} />
    </div>
  );
}

function toLocalDateTimeInputValue(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function fromLocalDateTimeInputValue(value: string): string | null {
  return value ? new Date(value).toISOString() : null;
}

function InlineDatetime({ label, value, onChange, className, disabled = false }: {
  label: string; value: string; onChange: (value: string | null) => void; className?: string; disabled?: boolean;
}) {
  const id = useId();
  const localValue = value ? toLocalDateTimeInputValue(value) : '';
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-0.5 block text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: 'var(--text-muted)' }}>{label}</label>
      <input id={id} type="datetime-local" value={localValue} onChange={(e) => onChange(fromLocalDateTimeInputValue(e.target.value))} disabled={disabled} className="w-full rounded-lg px-2 py-1.5 text-[12px] outline-none disabled:cursor-not-allowed disabled:opacity-70" style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }} />
    </div>
  );
}
