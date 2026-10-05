import { motion } from 'framer-motion';
import { toneText } from '@/lib/tone-text';
import type { LucideIcon } from 'lucide-react';
import type { MouseEvent, ReactNode } from 'react';

interface WorkspaceNavLinkProps {
  label: string;
  icon: LucideIcon;
  active: boolean;
  accentColor: string;
  onClick: () => void;
  href: string;
  /** Quiet trailing count (Today's queue); sits inside the link so there is one Today, not two. */
  badge?: ReactNode;
}

/** Native links retain Ctrl/Cmd-click, middle click and the browser context menu. */
export function interceptWorkspaceLink(event: MouseEvent<HTMLAnchorElement>, onNavigate: () => void) {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  onNavigate();
}

export function WorkspaceNavLink({ label, icon: Icon, active, accentColor, onClick, href, badge }: WorkspaceNavLinkProps) {
  return (
    <a href={href} onClick={(event) => interceptWorkspaceLink(event, onClick)} aria-current={active ? 'page' : undefined}
      className="workspace-nav-chip header-ghost relative flex min-h-8 min-w-0 items-center justify-center gap-1.5 rounded-lg px-2 text-[12.5px] font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--focus-ring)] lg:px-3"
      style={active ? { color: toneText(accentColor), fontWeight: 600 } : undefined}>
      {active && (
        <motion.span
          layoutId="header-nav-active"
          aria-hidden="true"
          className="absolute inset-0 rounded-lg"
          style={{ background: `color-mix(in srgb, ${accentColor} 13%, transparent)`, boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${accentColor} 22%, transparent)` }}
          transition={{ type: 'spring', stiffness: 520, damping: 40 }}
        />
      )}
      <Icon size={14} className="relative hidden shrink-0 sm:block" /><span className="relative">{label}</span>
      {badge}
    </a>
  );
}
