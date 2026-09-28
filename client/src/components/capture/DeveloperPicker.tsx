import { useEffect, useMemo, useRef, useState } from 'react';
import { Clock, Search } from 'lucide-react';
import { useManagerDeskDeveloperLookup } from '@/hooks/useManagerDesk';
import type { ManagerDeskDeveloperLookupItem } from '@/types/manager-desk';
import { initials } from '@/components/ui/Avatar';

const PALETTE = [
  '#06B6D4', '#8B5CF6', '#EC4899', '#F59E0B', '#10B981',
  '#3B82F6', '#EF4444', '#14B8A6', '#F97316', '#6366F1',
];

function avatarColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = ((h << 5) - h + name.charCodeAt(i)) | 0;
  return PALETTE[Math.abs(h) % PALETTE.length] ?? PALETTE[0]!;
}


interface DeveloperPickerProps {
  date: string;
  selected: ManagerDeskDeveloperLookupItem | null;
  onSelect: (dev: ManagerDeskDeveloperLookupItem) => void;
  onClear: () => void;
}

export function DeveloperPicker({ date, selected, onSelect, onClear }: DeveloperPickerProps) {
  const searchRef = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(true);

  const { data: roster, isLoading } = useManagerDeskDeveloperLookup('', date);

  const availableRoster = useMemo(
    () => roster?.filter((dev) => dev.availability?.state !== 'inactive') ?? [],
    [roster]
  );

  const filtered = useMemo(() => {
    if (!search.trim()) return availableRoster;
    const q = search.toLowerCase();
    return availableRoster.filter(
      (d) => d.displayName.toLowerCase().includes(q) || d.email?.toLowerCase().includes(q),
    );
  }, [availableRoster, search]);

  useEffect(() => {
    if (open) {
      const t = setTimeout(() => searchRef.current?.focus(), 80);
      return () => clearTimeout(t);
    }
  }, [open]);

  useEffect(() => {
    if (selected) setOpen(false);
  }, [selected]);

  // Compact selected chip
  if (selected && !open) {
    const c = avatarColor(selected.displayName);
    const unavail = selected.availability?.state === 'inactive';
    return (
      <div className="flex items-center gap-2">
        <div
          className="flex items-center gap-2 flex-1 rounded-xl px-3 py-2"
          style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}
        >
          <div
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-[11px] font-bold"
            style={{ background: `${c}20`, color: c, border: `1px solid ${c}30` }}
          >
            {initials(selected.displayName)}
          </div>
          <span
            className="text-[13px] font-medium truncate"
            style={{ color: 'var(--text-primary)' }}
          >
            {selected.displayName}
          </span>
          {unavail && (
            <span
              className="text-[11px] px-1.5 py-0.5 rounded-md font-medium"
              style={{ background: 'color-mix(in srgb, var(--danger) 10%, transparent)', color: 'var(--danger)' }}
            >
              {selected.availability?.note || 'Unavailable'}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => {
            setOpen(true);
            onClear();
          }}
          className="text-[12px] px-2 py-1.5 rounded-lg font-medium shrink-0"
          style={{
            color: 'var(--text-secondary)',
            background: 'var(--bg-tertiary)',
            border: '1px solid var(--border)',
          }}
        >
          Change
        </button>
      </div>
    );
  }

  // Expanded roster list
  return (
    <div className="space-y-1.5">
      <div className="relative">
        <Search
          size={13}
          className="absolute left-3 top-1/2 -translate-y-1/2"
          style={{ color: 'var(--text-muted)' }}
        />
        <input
          ref={searchRef}
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search developer…"
          className="w-full rounded-xl pl-9 pr-3 py-2 text-[13px] outline-none"
          style={{
            background: 'var(--bg-elevated)',
            color: 'var(--text-primary)',
            border: '1px solid var(--border-active)',
          }}
        />
      </div>

      <div
        className="rounded-xl overflow-hidden max-h-[176px] overflow-y-auto no-scrollbar"
        style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}
      >
        {isLoading ? (
          <div
            className="px-3 py-6 text-center text-[12px]"
            style={{ color: 'var(--text-muted)' }}
          >
            Loading team…
          </div>
        ) : filtered.length === 0 ? (
          <div
            className="px-3 py-6 text-center text-[12px]"
            style={{ color: 'var(--text-muted)' }}
          >
            {search ? 'No matching developers' : 'No developers found'}
          </div>
        ) : (
          filtered.map((dev) => {
            const c = avatarColor(dev.displayName);
            const unavail = dev.availability?.state === 'inactive';
            return (
              <button
                key={dev.accountId}
                type="button"
                onClick={() => {
                  onSelect(dev);
                  setOpen(false);
                  setSearch('');
                }}
                className="flex items-center gap-2.5 w-full px-3 py-2 text-left transition-colors hover:brightness-110"
                style={{
                  borderBottom: '1px solid var(--border)',
                  opacity: unavail ? 0.5 : 1,
                  background: 'transparent',
                }}
              >
                <div
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-[11px] font-bold"
                  style={{ background: `${c}15`, color: c, border: `1px solid ${c}20` }}
                >
                  {initials(dev.displayName)}
                </div>
                <span
                  className="text-[13px] font-medium truncate flex-1"
                  style={{ color: 'var(--text-primary)' }}
                >
                  {dev.displayName}
                </span>
                {unavail && (
                  <span
                    className="text-[11px] px-1.5 py-0.5 rounded-md font-medium shrink-0 flex items-center gap-0.5"
                    style={{ background: 'color-mix(in srgb, var(--danger) 8%, transparent)', color: 'var(--danger)' }}
                  >
                    <Clock size={8} />
                    {dev.availability?.note || 'Out'}
                  </span>
                )}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
