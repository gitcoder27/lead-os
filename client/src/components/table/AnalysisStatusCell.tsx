import { CircleCheck, Circle } from 'lucide-react';

interface AnalysisStatusCellProps {
  hasNotes: boolean;
}

export function AnalysisStatusCell({ hasNotes }: AnalysisStatusCellProps) {
  if (hasNotes) {
    return (
      <span
        role="img"
        className="inline-flex items-center justify-center"
        title="Analysis complete"
        aria-label="Analysis complete"
      >
        <CircleCheck size={14} style={{ color: 'var(--success)', opacity: 0.9 }} />
      </span>
    );
  }

  return (
    <span
      role="img"
      className="inline-flex items-center justify-center"
      title="Analysis pending"
      aria-label="Analysis pending"
    >
      <Circle size={12} style={{ color: 'var(--text-muted)', opacity: 0.65 }} />
    </span>
  );
}
