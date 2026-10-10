import { useRef, useState } from 'react';
import { Keyboard, LogOut, Monitor, Moon, Settings, Sun } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useTheme, type ThemePreference } from '@/context/ThemeContext';
import { useQuickActions } from '@/context/QuickActionsContext';
import { useSignOut } from '@/hooks/useSignOut';
import { Avatar } from '@/components/ui/Avatar';
import { MenuDivider, MenuHeading, MenuItem, Popover } from '@/components/ui/Popover';

const THEMES: Array<{ value: ThemePreference; label: string; icon: typeof Sun }> = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
];

/**
 * docs/73 UXD-06: who is signed in, and the account-level controls that used to be
 * three header icons — theme, keyboard shortcuts and Settings — plus Sign out, which
 * previously lived only at the bottom of the Settings rail.
 */
export function HeaderUserMenu({ onOpenSettings, settingsActive = false }: { onOpenSettings?: () => void; settingsActive?: boolean }) {
  const { user } = useAuth();
  const { preference, setPreference } = useTheme();
  const { openKeyboardShortcuts, keyboardShortcutsOpen } = useQuickActions();
  const { signOut, pending } = useSignOut();
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  if (!user) return null;
  const isManager = user.role === 'manager';
  const close = () => setOpen(false);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="header-ghost header-icon-btn header-avatar-btn"
        // The "?" shortcut anchors the shortcut sheet here, where the menu entry lives.
        data-global-shortcuts-anchor=""
        aria-haspopup="menu"
        aria-expanded={open || Boolean(keyboardShortcutsOpen)}
        aria-label={`Account: ${user.displayName || user.username || 'you'}`}
        title={user.displayName}
        onClick={() => setOpen((value) => !value)}
      >
        <Avatar name={user.displayName || user.username || 'You'} seed={user.accountId} size={26} ring={settingsActive} />
      </button>
      {open && (
        <Popover anchor={buttonRef.current} onClose={close} label="Account" width={232}>
          <div className="px-2 pb-1.5 pt-1" aria-hidden="true">
            <p className="truncate text-body font-semibold" style={{ color: 'var(--text-primary)' }}>{user.displayName}</p>
            <p className="truncate text-ui" style={{ color: 'var(--text-muted)' }}>@{user.username}</p>
          </div>
          <MenuDivider />
          <MenuHeading>Theme</MenuHeading>
          {THEMES.map(({ value, label, icon: Icon }) => (
            <MenuItem
              key={value}
              role="menuitemradio"
              checked={preference === value}
              icon={<Icon size={13} aria-hidden="true" />}
              label={label}
              onSelect={() => { setPreference(value); close(); }}
            />
          ))}
          <MenuDivider />
          {isManager && (
            <MenuItem
              icon={<Keyboard size={13} aria-hidden="true" />}
              label="Keyboard shortcuts"
              hint="?"
              onSelect={() => { close(); openKeyboardShortcuts?.(buttonRef.current ?? undefined); }}
            />
          )}
          {isManager && onOpenSettings && (
            <MenuItem icon={<Settings size={13} aria-hidden="true" />} label="Settings" onSelect={() => { close(); onOpenSettings(); }} />
          )}
          {isManager && <MenuDivider />}
          <MenuItem icon={<LogOut size={13} aria-hidden="true" />} label={pending ? 'Signing out…' : 'Sign out'} disabled={pending} onSelect={() => void signOut()} />
        </Popover>
      )}
    </>
  );
}
