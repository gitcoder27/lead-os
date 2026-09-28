import { useState } from 'react';
import { TriageNotesHistoryEntry } from './TriageNotesHistoryEntry';
import { formatTriageNotesHeading } from './triage-notes';
import type { TriageDatedNoteSection } from './triage-notes';

interface TriageNotesHistoryProps {
  sections: TriageDatedNoteSection[];
  legacyBody: string;
  todayIsoDate: string;
  onSectionChange: (index: number, body: string) => void;
  onLegacyChange: (body: string) => void;
  onBlur: () => void;
  readOnly?: boolean;
}

export function TriageNotesHistory({
  sections,
  legacyBody,
  todayIsoDate,
  onSectionChange,
  onLegacyChange,
  onBlur,
  readOnly = false,
}: TriageNotesHistoryProps) {
  const pastSections = sections.filter((s) => s.date !== todayIsoDate);
  const hasHistory = pastSections.length > 0 || !!legacyBody;
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  if (!hasHistory) return null;

  const toggle = (key: string) => setExpandedKey((prev) => (prev === key ? null : key));

  return (
    <div className="mt-2">
      <div className="flex items-center gap-2.5 mb-1">
        <div className="flex-1 h-px" style={{ background: 'var(--border)' }} />
        <span
          className="text-[11px] font-semibold uppercase tracking-[0.08em] shrink-0"
          style={{ color: 'var(--text-muted)' }}
        >
          Past entries
        </span>
        <div className="flex-1 h-px" style={{ background: 'var(--border)' }} />
      </div>

      {[...pastSections].reverse().map((section) => {
        const realIndex = sections.indexOf(section);
        const key = `dated-${section.date}`;
        return (
          <TriageNotesHistoryEntry
            key={key}
            value={section.body}
            dateLabel={formatTriageNotesHeading(section.date).replace(/:$/, '')}
            ariaLabel={`Notes for ${formatTriageNotesHeading(section.date).replace(/:$/, '')}`}
            isExpanded={expandedKey === key}
            onToggle={() => toggle(key)}
            onChange={(body) => onSectionChange(realIndex, body)}
            onBlur={onBlur}
            readOnly={readOnly}
          />
        );
      })}

      {legacyBody && (
        <TriageNotesHistoryEntry
          value={legacyBody}
          dateLabel="Earlier Notes"
          ariaLabel="Earlier notes"
          isExpanded={expandedKey === 'legacy'}
          onToggle={() => toggle('legacy')}
          onChange={onLegacyChange}
          onBlur={onBlur}
          readOnly={readOnly}
        />
      )}
    </div>
  );
}
