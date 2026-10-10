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
      <div className="text-ui font-semibold uppercase" style={{ color: 'var(--text-muted)', letterSpacing: '0.06em' }}>
        Full title
      </div>
      <div className="mt-1 text-body leading-5 break-words" style={{ color: 'var(--text-primary)' }}>
        {title}
      </div>
      {note && (
        <>
          <div className="mt-2 text-ui font-semibold uppercase" style={{ color: 'var(--text-muted)', letterSpacing: '0.06em' }}>
            Notes
          </div>
          <div className="mt-1 whitespace-pre-wrap break-words text-body leading-5" style={{ color: 'var(--text-secondary)' }}>
            {note}
          </div>
        </>
      )}
    </div>
  );
}
