import { useCallback, useEffect, useMemo, useState } from 'react';
import { FileText, Check } from 'lucide-react';
import { getLocalIsoDate } from '@/lib/utils';
import { TriageNotesToday } from './TriageNotesToday';
import { TriageNotesHistory } from './TriageNotesHistory';
import { parseTriageNotes, serializeTriageNotes, formatTriageNotesHeading } from './triage-notes';

interface TriageNotesEditorProps {
  value: string;
  onChange: (value: string) => void;
  onBlurSave: () => void;
  isSaved: boolean;
  readOnly?: boolean;
}

export function TriageNotesEditor({ value, onChange, onBlurSave, isSaved, readOnly = false }: TriageNotesEditorProps) {
  const [todayIsoDate, setTodayIsoDate] = useState(() => getLocalIsoDate());
  const parsedNotes = useMemo(() => parseTriageNotes(value), [value]);
  const todaySectionIndex = parsedNotes.datedSections.findIndex((s) => s.date === todayIsoDate);
  const datedSections = todaySectionIndex === -1
    ? [...parsedNotes.datedSections, { date: todayIsoDate, body: '' }]
    : parsedNotes.datedSections;
  const todaySection = datedSections.find((s) => s.date === todayIsoDate);
  const todayLabel = formatTriageNotesHeading(todayIsoDate).replace(/:$/, '');

  useEffect(() => {
    const id = window.setInterval(() => {
      setTodayIsoDate((cur) => {
        const next = getLocalIsoDate();
        return cur === next ? cur : next;
      });
    }, 60000);
    return () => window.clearInterval(id);
  }, []);

  const emitChange = useCallback(
    (legacyBody: string, nextSections = parsedNotes.datedSections) => {
      onChange(serializeTriageNotes({ legacyBody, datedSections: nextSections }));
    },
    [onChange, parsedNotes.datedSections],
  );

  const handleLegacyChange = useCallback(
    (body: string) => emitChange(body),
    [emitChange],
  );

  const handleSectionChange = useCallback(
    (index: number, body: string) => {
      const next = parsedNotes.datedSections.map((s, i) => (i === index ? { ...s, body } : s));
      if (index >= parsedNotes.datedSections.length) {
        next.push({ date: todayIsoDate, body });
      }
      emitChange(parsedNotes.legacyBody, next);
    },
    [emitChange, parsedNotes.datedSections, parsedNotes.legacyBody, todayIsoDate],
  );

  const handleTodayChange = useCallback(
    (body: string) => {
      const idx = datedSections.findIndex((s) => s.date === todayIsoDate);
      handleSectionChange(idx, body);
    },
    [datedSections, handleSectionChange, todayIsoDate],
  );

  return (
    <div className="triage-section">
      <div className="flex items-center justify-between mb-2">
        <span className="triage-section-label">
          <FileText size={10} /> Notes
        </span>
        <span
          className="text-[11px] transition-opacity"
          style={{ color: !isSaved ? 'var(--warning)' : 'var(--success)', opacity: value ? 1 : 0 }}
        >
          {!isSaved ? 'Saving…' : (
            <span className="inline-flex items-center gap-0.5">
              <Check size={9} /> Saved
            </span>
          )}
        </span>
      </div>

      <TriageNotesToday
        value={todaySection?.body ?? ''}
        dateLabel={todayLabel}
        onChange={handleTodayChange}
        onBlur={onBlurSave}
        readOnly={readOnly}
      />

      <TriageNotesHistory
        sections={datedSections}
        legacyBody={parsedNotes.legacyBody}
        todayIsoDate={todayIsoDate}
        onSectionChange={handleSectionChange}
        onLegacyChange={handleLegacyChange}
        onBlur={onBlurSave}
        readOnly={readOnly}
      />
    </div>
  );
}
