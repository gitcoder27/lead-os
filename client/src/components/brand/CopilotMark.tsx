interface CopilotMarkProps {
  size?: number;
  className?: string;
  monochrome?: boolean;
}

/** Copilot identity mark — a two-tone spark pair, visually distinct from the LeadOS mark. */
export function CopilotMark({ size = 24, className, monochrome = false }: CopilotMarkProps) {
  const accent = monochrome ? 'currentColor' : 'var(--accent)';
  const secondary = monochrome ? 'currentColor' : 'var(--warning)';

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M9.5 1.5c.4 4.4 4.1 8.1 8.5 8.5-4.4.4-8.1 4.1-8.5 8.5-.4-4.4-4.1-8.1-8.5-8.5 4.4-.4 8.1-4.1 8.5-8.5Z"
        fill={accent}
      />
      <path
        d="M17.5 13.5c.17 2.03 1.63 3.49 3.66 3.66-2.03.17-3.49 1.63-3.66 3.66-.17-2.03-1.63-3.49-3.66-3.66 2.03-.17 3.49-1.63 3.66-3.66Z"
        fill={secondary}
      />
    </svg>
  );
}
