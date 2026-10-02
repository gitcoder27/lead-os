import type { LucideIcon } from 'lucide-react';
import type { MouseEvent } from 'react';

interface WorkspaceNavLinkProps {
  label: string;
  icon: LucideIcon;
  active: boolean;
  accentColor: string;
  onClick: () => void;
  href: string;
}

/** Native links retain Ctrl/Cmd-click, middle click and the browser context menu. */
export function interceptWorkspaceLink(event: MouseEvent<HTMLAnchorElement>, onNavigate: () => void) {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  onNavigate();
}

export function WorkspaceNavLink({ label, icon: Icon, active, accentColor, onClick, href }: WorkspaceNavLinkProps) {
  return (
    <a href={href} onClick={(event) => interceptWorkspaceLink(event, onClick)} aria-current={active ? 'page' : undefined}
      className="workspace-nav-chip flex min-h-8 min-w-0 items-center justify-center gap-1.5 rounded-lg px-2 text-[12px] font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--focus-ring)] lg:px-3"
      style={{ background: active ? 'var(--bg-elevated)' : 'transparent', color: active ? accentColor : 'var(--text-muted)', boxShadow: active ? 'var(--soft-shadow)' : 'none' }}>
      <Icon size={13} className="hidden shrink-0 sm:block" /><span>{label}</span>
    </a>
  );
}
