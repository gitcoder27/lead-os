/**
 * docs/73 UXD-20: severity as words — "Sev 1" … "Sev 4" — instead of a glowing colour dot.
 * Sev 1 reads in the danger tone; the rest are quiet chips (no amber, §5.12).
 */
const SEVERITY: Record<string, { label: string; tone?: string }> = {
  '1 - Critical': { label: 'Sev 1', tone: 'var(--danger)' },
  '2 - Major': { label: 'Sev 2' },
  '3 - Minor': { label: 'Sev 3' },
  '4 - Low': { label: 'Sev 4' },
};

export function PriorityCell({ severity }: { severity?: string }) {
  const meta = severity ? SEVERITY[severity] : undefined;
  if (!meta) {
    return <span className="text-ui" style={{ color: 'var(--text-muted)' }} title={severity ?? 'Severity not set'}>—</span>;
  }
  return (
    <span
      className="ui-chip whitespace-nowrap tabular-nums"
      data-quiet={meta.tone ? undefined : 'true'}
      style={meta.tone ? ({ '--tone': meta.tone } as React.CSSProperties) : undefined}
      title={severity}
    >
      {meta.label}
    </span>
  );
}
