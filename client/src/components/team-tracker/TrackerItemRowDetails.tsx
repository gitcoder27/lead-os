interface TrackerItemRowDetailsProps {
  regionId: string;
  title: string;
  note?: string;
}

export function TrackerItemRowDetails({ regionId, title, note }: TrackerItemRowDetailsProps) {
  return (
    <div
      id={regionId}
      role="region"
      aria-label={`Task details for ${title}`}
      className="mt-2 rounded-lg px-2.5 py-2"
      style={{
        background: 'color-mix(in srgb, var(--bg-tertiary) 88%, transparent)',
        border: '1px solid var(--border)',
      }}
    >
      <div className="ui-label">
        Full title
      </div>
      <div className="mt-1 text-body leading-5 wrap-break-word" style={{ color: 'var(--text-primary)' }}>
        {title}
      </div>
      {note && (
        <>
          <div className="ui-label mt-2">
            Notes
          </div>
          <div className="mt-1 whitespace-pre-wrap wrap-break-word text-body leading-5" style={{ color: 'var(--text-secondary)' }}>
            {note}
          </div>
        </>
      )}
    </div>
  );
}
