import { useEffect, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Home, Loader2, RotateCcw, Save } from 'lucide-react';
import { useNavPreferences, useSaveNavPreferences } from '@/hooks/useNavPreferences';
import { useToast } from '@/context/ToastContext';
import { NAV_PAGE_META } from '@/lib/nav-pages';
import { DEFAULT_NAV_PREFERENCES, type NavPageId, type NavPreferences } from '@/types';

type NavZone = 'topNav' | 'moreNav';

function samePreferences(a: NavPreferences, b: NavPreferences): boolean {
  return a.topNav.join('\n') === b.topNav.join('\n') && a.moreNav.join('\n') === b.moreNav.join('\n');
}

export function NavigationSection() {
  const { preferences } = useNavPreferences();
  const saveMutation = useSaveNavPreferences();
  const { addToast } = useToast();
  const [draft, setDraft] = useState<NavPreferences>(preferences);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!touched) {
      setDraft(preferences);
    }
  }, [preferences, touched]);

  const dirty = touched && !samePreferences(draft, preferences);
  const saving = saveMutation.isPending;

  const moveWithinZone = (zone: NavZone, index: number, delta: -1 | 1) => {
    setTouched(true);
    setDraft((current) => {
      const list = [...current[zone]];
      const target = index + delta;
      if (target < 0 || target >= list.length) {
        return current;
      }
      const moved = list[index]!;
      list[index] = list[target]!;
      list[target] = moved;
      return { ...current, [zone]: list };
    });
  };

  const moveToZone = (from: NavZone, id: NavPageId) => {
    setTouched(true);
    setDraft((current) => {
      if (!current[from].includes(id)) {
        return current;
      }
      return from === 'topNav'
        ? { topNav: current.topNav.filter((page) => page !== id), moreNav: [...current.moreNav, id] }
        : { topNav: [...current.topNav, id], moreNav: current.moreNav.filter((page) => page !== id) };
    });
  };

  const handleSave = async () => {
    try {
      await saveMutation.mutateAsync(draft);
      setTouched(false);
      addToast({
        type: 'success',
        title: 'Navigation saved',
        message: 'The header now uses this layout on every device where you sign in.',
      });
    } catch (error) {
      addToast({
        type: 'error',
        title: 'Could not save navigation',
        message: error instanceof Error ? error.message : 'Please try again.',
      });
    }
  };

  const handleReset = () => {
    setTouched(true);
    setDraft({
      topNav: [...DEFAULT_NAV_PREFERENCES.topNav],
      moreNav: [...DEFAULT_NAV_PREFERENCES.moreNav],
    });
  };

  return (
    <div className="max-w-[720px] space-y-7">
      <div>
        <SettingsGroupLabel>Top navigation</SettingsGroupLabel>
        <p className="mt-1.5 text-[12px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
          Pages here stay visible in the header. Today is always first.
        </p>
        <div
          className="mt-2.5 overflow-hidden rounded-xl"
          style={{ border: 'var(--settings-pane-border)' }}
          role="list"
          aria-label="Top navigation"
        >
          <div className="flex items-center gap-2.5 px-3.5 py-2" role="listitem" style={{ background: 'var(--settings-row-even-bg)' }}>
            <span
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md"
              style={{ background: 'var(--settings-accent-soft-bg)', color: 'var(--accent)', border: 'var(--settings-accent-soft-border)' }}
            >
              <Home size={11} />
            </span>
            <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium" style={{ color: 'var(--text-primary)' }}>
              Today
            </span>
            <span
              className="shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-medium"
              style={{ background: 'var(--settings-neutral-chip-bg)', color: 'var(--text-muted)', border: 'var(--settings-inset-border)' }}
            >
              Always first
            </span>
          </div>
          {draft.topNav.map((id, index) => (
            <NavPreferenceRow
              key={id}
              id={id}
              zone="topNav"
              index={index}
              count={draft.topNav.length}
              disabled={saving}
              onMove={moveWithinZone}
              onMoveToZone={moveToZone}
            />
          ))}
        </div>
      </div>

      <div>
        <SettingsGroupLabel>More menu</SettingsGroupLabel>
        <p className="mt-1.5 text-[12px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
          Pages here sit behind the More menu in the header.
        </p>
        <div
          className="mt-2.5 overflow-hidden rounded-xl"
          style={{ border: 'var(--settings-pane-border)' }}
          role="list"
          aria-label="More menu"
        >
          {draft.moreNav.length === 0 ? (
            <p className="px-3.5 py-2.5 text-[12px]" style={{ color: 'var(--text-muted)' }}>
              Every page is in the top navigation — the More menu stays hidden.
            </p>
          ) : (
            draft.moreNav.map((id, index) => (
              <NavPreferenceRow
                key={id}
                id={id}
                zone="moreNav"
                index={index}
                count={draft.moreNav.length}
                disabled={saving}
                onMove={moveWithinZone}
                onMoveToZone={moveToZone}
              />
            ))
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2.5">
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={!dirty || saving}
          className="flex h-8 items-center gap-1.5 rounded-lg px-3.5 text-[12.5px] font-semibold transition-opacity disabled:opacity-40"
          style={{ background: 'var(--settings-cta-primary-bg)', color: 'var(--settings-cta-primary-text)' }}
        >
          {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
          Save layout
        </button>
        <button
          type="button"
          onClick={handleReset}
          disabled={saving}
          className="flex h-8 items-center gap-1.5 rounded-lg px-3 text-[12.5px] font-medium transition-opacity disabled:opacity-40"
          style={{ background: 'var(--settings-neutral-chip-bg)', color: 'var(--text-secondary)', border: 'var(--settings-inset-border)' }}
        >
          <RotateCcw size={12} />
          Restore default
        </button>
        <span className="text-[11.5px]" style={{ color: 'var(--text-muted)' }}>
          {dirty ? 'Unsaved changes' : 'Applies to your account on every device.'}
        </span>
      </div>
    </div>
  );
}

interface NavPreferenceRowProps {
  id: NavPageId;
  zone: NavZone;
  index: number;
  count: number;
  disabled: boolean;
  onMove: (zone: NavZone, index: number, delta: -1 | 1) => void;
  onMoveToZone: (from: NavZone, id: NavPageId) => void;
}

function NavPreferenceRow({ id, zone, index, count, disabled, onMove, onMoveToZone }: NavPreferenceRowProps) {
  const meta = NAV_PAGE_META[id];
  const Icon = meta.icon;
  const isTop = zone === 'topNav';
  const zoneTarget = isTop ? 'More menu' : 'top navigation';

  return (
    <div
      role="listitem"
      className="flex items-center gap-2.5 px-3.5 py-2"
      style={{
        borderTop: isTop || index > 0 ? 'var(--settings-row-divider)' : 'none',
        background: index % 2 === 0 ? 'var(--settings-row-even-bg)' : 'var(--settings-row-odd-bg)',
      }}
    >
      <span
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md"
        style={{ background: 'var(--settings-neutral-chip-bg)', color: 'var(--text-secondary)', border: 'var(--settings-inset-border)' }}
      >
        <Icon size={11} />
      </span>
      <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium" style={{ color: 'var(--text-primary)' }}>
        {meta.label}
      </span>
      <div className="flex shrink-0 items-center gap-1">
        <RowButton
          label={`Move ${meta.label} up`}
          disabled={disabled || index === 0}
          onClick={() => onMove(zone, index, -1)}
        >
          <ArrowUp size={11} />
        </RowButton>
        <RowButton
          label={`Move ${meta.label} down`}
          disabled={disabled || index === count - 1}
          onClick={() => onMove(zone, index, 1)}
        >
          <ArrowDown size={11} />
        </RowButton>
        <RowButton
          label={`Move ${meta.label} to ${zoneTarget}`}
          disabled={disabled}
          onClick={() => onMoveToZone(zone, id)}
        >
          {isTop ? <ArrowRight size={11} /> : <ArrowLeft size={11} />}
        </RowButton>
      </div>
    </div>
  );
}

function RowButton({ label, disabled, onClick, children }: { label: string; disabled: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="flex h-6 w-6 items-center justify-center rounded-md transition-opacity disabled:opacity-30"
      style={{ background: 'var(--settings-neutral-chip-bg)', color: 'var(--text-secondary)', border: 'var(--settings-inset-border)' }}
    >
      {children}
    </button>
  );
}

function SettingsGroupLabel({ children }: { children: ReactNode }) {
  return (
    <h3 className="text-[11px] font-semibold uppercase tracking-[0.18em]" style={{ color: 'var(--text-muted)' }}>
      {children}
    </h3>
  );
}
