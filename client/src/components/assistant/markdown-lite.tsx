import type { ReactNode } from 'react';

interface MarkdownLiteOptions {
  onOpenIssue?: (issueKey: string) => void;
}

const INLINE_PATTERN =
  /(\*\*[^*\n]+\*\*)|(`[^`\n]+`)|(\[[^\]\n]+\]\(https?:\/\/[^\s)]+\))|(\b[A-Z][A-Z0-9]+-\d+\b)/g;

function renderInline(text: string, opts: MarkdownLiteOptions, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  let index = 0;
  for (const match of text.matchAll(INLINE_PATTERN)) {
    const start = match.index ?? 0;
    if (start > last) {
      nodes.push(text.slice(last, start));
    }
    const token = match[0];
    const key = `${keyPrefix}-${index++}`;
    if (token.startsWith('**')) {
      nodes.push(
        <strong key={key} style={{ color: 'var(--text-primary)' }}>
          {token.slice(2, -2)}
        </strong>,
      );
    } else if (token.startsWith('`')) {
      nodes.push(
        <code
          key={key}
          className="rounded px-1 py-px font-mono text-[0.85em]"
          style={{ background: 'var(--bg-tertiary)', color: 'var(--accent)' }}
        >
          {token.slice(1, -1)}
        </code>,
      );
    } else if (token.startsWith('[')) {
      const splitAt = token.indexOf('](');
      nodes.push(
        <a
          key={key}
          href={token.slice(splitAt + 2, -1)}
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: 'var(--accent)', textDecoration: 'underline' }}
        >
          {token.slice(1, splitAt)}
        </a>,
      );
    } else {
      nodes.push(
        <button
          key={key}
          type="button"
          onClick={() => opts.onOpenIssue?.(token)}
          className="font-mono text-[0.85em] underline decoration-dotted underline-offset-2"
          style={{ color: 'var(--accent)' }}
        >
          {token}
        </button>,
      );
    }
    last = start + token.length;
  }
  if (last < text.length) {
    nodes.push(text.slice(last));
  }
  return nodes;
}

const isBulletLine = (line: string) => /^\s*[-*]\s+/.test(line);
const isNumberedLine = (line: string) => /^\s*\d+\.\s+/.test(line);
const headingMatch = (line: string) => /^#{1,6}\s+(.+)$/.exec(line);

function renderParagraph(lines: string[], opts: MarkdownLiteOptions, key: string): ReactNode {
  if (lines.every(isBulletLine)) {
    return (
      <ul key={key} className="list-disc space-y-0.5 pl-4 text-[13px] leading-5">
        {lines.map((line, i) => (
          <li key={i}>{renderInline(line.replace(/^\s*[-*]\s+/, ''), opts, `${key}-b${i}`)}</li>
        ))}
      </ul>
    );
  }
  if (lines.every(isNumberedLine)) {
    return (
      <ol key={key} className="list-decimal space-y-0.5 pl-4 text-[13px] leading-5">
        {lines.map((line, i) => (
          <li key={i}>{renderInline(line.replace(/^\s*\d+\.\s+/, ''), opts, `${key}-n${i}`)}</li>
        ))}
      </ol>
    );
  }
  const parts: ReactNode[] = [];
  lines.forEach((line, i) => {
    if (i > 0) {
      parts.push(<br key={`${key}-br${i}`} />);
    }
    const heading = headingMatch(line);
    if (heading?.[1]) {
      parts.push(
        <strong key={`${key}-h${i}`} style={{ color: 'var(--text-primary)' }}>
          {renderInline(heading[1], opts, `${key}-h${i}`)}
        </strong>,
      );
    } else {
      parts.push(...renderInline(line, opts, `${key}-l${i}`));
    }
  });
  return (
    <p key={key} className="text-[13px] leading-5">
      {parts}
    </p>
  );
}

/** Minimal, safe markdown subset for Copilot replies — React nodes only, no HTML injection. */
export function renderMarkdownLite(text: string, opts: MarkdownLiteOptions = {}): ReactNode {
  const blocks: ReactNode[] = [];
  const segments = text.split('```');
  let index = 0;
  segments.forEach((segment, segmentIndex) => {
    if (segmentIndex % 2 === 1) {
      const code = segment.replace(/^[^\n]*\n/, '').replace(/\n$/, '');
      blocks.push(
        <pre
          key={`code-${index++}`}
          className="my-1 overflow-x-auto rounded-lg px-3 py-2 font-mono text-[12px] leading-5"
          style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)' }}
        >
          {code}
        </pre>,
      );
      return;
    }
    for (const paragraph of segment.split(/\n\s*\n/)) {
      const lines = paragraph.split('\n').filter((line) => line.trim() !== '');
      if (lines.length > 0) {
        blocks.push(renderParagraph(lines, opts, `p-${index++}`));
      }
    }
  });
  return <div className="space-y-2">{blocks}</div>;
}
