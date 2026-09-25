import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, CalendarDays, Flag, Hash, Link2, NotebookPen, Repeat, Tags, UserRound, Users, Zap } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import {
  parseCapture,
  resolveCapture,
  type CaptureDiagnostic,
  type CaptureTokenKind,
  type ResolvedCapture,
} from 'shared/capture-grammar';
import { taskLabelDisplayName } from '@/types';
import { useToast } from '@/context/ToastContext';
import { useCapture } from '@/hooks/useCapture';
import { useDevelopers } from '@/hooks/useDevelopers';
import { getLocalIsoDate } from '@/lib/utils';
import { navigateToTaskPage } from '@/components/tasks/TaskDrawer';

/** Per-kind token highlight colors — the live preview paints these in-place. */
const TOKEN_COLORS: Record<CaptureTokenKind, string> = {
  command: 'var(--md-accent)',
  person: 'var(--accent)',
  jira: 'var(--info)',
  parent: 'var(--success)',
  taskref: 'var(--success)',
  date: 'var(--warning)',
  priority: 'var(--danger)',
  later: 'var(--text-muted)',
  meeting: 'var(--md-accent)',
  followup: 'var(--warning)',
  label: 'var(--accent)',
};

const TOKEN_BG: Record<CaptureTokenKind, string> = {
  command: 'rgba(184,134,11,0.12)',
  person: 'var(--accent-glow)',
  jira: 'color-mix(in srgb, var(--info) 14%, transparent)',
  parent: 'color-mix(in srgb, var(--success) 12%, transparent)',
  taskref: 'color-mix(in srgb, var(--success) 12%, transparent)',
  date: 'color-mix(in srgb, var(--warning) 14%, transparent)',
  priority: 'color-mix(in srgb, var(--danger) 12%, transparent)',
  later: 'var(--bg-tertiary)',
  meeting: 'rgba(184,134,11,0.12)',
  followup: 'color-mix(in srgb, var(--warning) 12%, transparent)',
  label: 'var(--accent-glow)',
};

interface CaptureBoxProps {
  /** Initial text, e.g. "@dev-1 " from a developer context or "/note ". */
  prefill?: string;
  onClose: () => void;
}

function Chip({ icon, children, tone }: { icon?: React.ReactNode; children: React.ReactNode; tone?: 'error' | 'warning' }) {
  const color = tone === 'error' ? 'var(--danger)' : tone === 'warning' ? 'var(--warning)' : 'var(--text-secondary)';
  return (
    <span
      className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium"
      style={{ background: 'var(--bg-tertiary)', color, border: '1px solid var(--border)' }}
    >
      {icon}
      {children}
    </span>
  );
}

function DiagnosticRow({ diagnostic }: { diagnostic: CaptureDiagnostic }) {
  return (
    <div
      className="flex items-start gap-1.5 text-[12px] leading-snug"
      style={{ color: diagnostic.severity === 'error' ? 'var(--danger)' : 'var(--warning)' }}
    >
      <span className="mt-px shrink-0">{diagnostic.severity === 'error' ? '●' : '◐'}</span>
      <span>{diagnostic.message}</span>
    </div>
  );
}

function summarize(resolved: ResolvedCapture, developerNames: Map<string, string>) {
  const chips: React.ReactNode[] = [];
  if (resolved.intent === 'update') {
    chips.push(<Chip key="intent" icon={<ArrowRight size={10} />}>Update {resolved.updateTargetKey}</Chip>);
  } else if (resolved.intent === 'note') {
    chips.push(<Chip key="intent" icon={<NotebookPen size={10} />}>Today's note</Chip>);
  }
  if (resolved.owner) {
    chips.push(<Chip key="owner" icon={<UserRound size={10} />}>{developerNames.get(resolved.owner.accountId) ?? resolved.owner.accountId}</Chip>);
  }
  if (resolved.meeting) chips.push(<Chip key="meeting" icon={<Users size={10} />}>Meeting</Chip>);
  if (resolved.later) chips.push(<Chip key="later" icon={<Repeat size={10} />}>Later</Chip>);
  if (resolved.priority === 'high') chips.push(<Chip key="prio" icon={<Flag size={10} />}>High priority</Chip>);
  if (resolved.scheduledOn) {
    chips.push(<Chip key="date" icon={<CalendarDays size={10} />}>{format(parseISO(resolved.scheduledOn), 'EEE, MMM d')}</Chip>);
  }
  if (resolved.followUp) {
    chips.push(<Chip key="fu" icon={<CalendarDays size={10} />}>Follow-up{resolved.followUpAt ? ` ${format(parseISO(resolved.followUpAt), 'MMM d')}` : ''}</Chip>);
  }
  for (const label of resolved.labels.filter((l) => l !== 'category:follow_up')) {
    chips.push(<Chip key={`label-${label}`} icon={<Tags size={10} />}>+{taskLabelDisplayName(label)}</Chip>);
  }
  for (const link of resolved.jiraLinks) {
    chips.push(<Chip key={`jira-${link.key}`} icon={<Hash size={10} />}>{link.key}{link.primary ? ' ●' : ''}</Chip>);
  }
  for (const key of resolved.taskLinks) {
    chips.push(<Chip key={`task-${key}`} icon={<Link2 size={10} />}>{key}</Chip>);
  }
  if (resolved.parentKey) chips.push(<Chip key="parent" icon={<Link2 size={10} />}>child of {resolved.parentKey}</Chip>);
  for (const person of resolved.peopleLinks) {
    chips.push(<Chip key={`pl-${person.accountId}`} icon={<UserRound size={10} />}>↔ {developerNames.get(person.accountId) ?? person.accountId}</Chip>);
  }
  return chips;
}

/**
 * Phase 3 (P3-D8, §4.3): the single capture input. Live token-highlight
 * preview + structured summary; the server re-parses authoritatively on
 * submit. Errors block the submit; warnings may need a confirm press.
 */
export function CaptureBox({ prefill = '', onClose }: CaptureBoxProps) {
  const { addToast } = useToast();
  const capture = useCapture();
  const developers = useDevelopers();
  const [text, setText] = useState(prefill);
  const [confirmArmed, setConfirmArmed] = useState(false);
  const [serverDiagnostics, setServerDiagnostics] = useState<CaptureDiagnostic[]>([]);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);
  const today = useMemo(() => getLocalIsoDate(), []);

  const people = useMemo(
    () => (developers.data ?? []).map((dev) => ({ accountId: dev.accountId, displayName: dev.displayName })),
    [developers.data],
  );
  const developerNames = useMemo(() => new Map(people.map((p) => [p.accountId, p.displayName])), [people]);

  const resolved = useMemo(() => {
    if (!text.trim()) return null;
    // Jira sync state and task existence are server-authoritative; the preview
    // leaves them unverified (null lookups emit no diagnostics).
    return resolveCapture(parseCapture(text, today), { people });
  }, [text, today, people]);

  // While the roster is loading, person tokens can't be resolved yet — hold
  // their diagnostics so users don't see a spurious "nobody matches" flash.
  const holdPeopleDiagnostics = developers.isPending;
  const allDiagnostics = serverDiagnostics.length ? serverDiagnostics : resolved?.diagnostics ?? [];
  const diagnostics = holdPeopleDiagnostics
    ? allDiagnostics.filter((d) => d.code !== 'unknown-person' && d.code !== 'ambiguous-person')
    : allDiagnostics;
  const blocked = diagnostics.some((d) => d.severity === 'error');

  useEffect(() => {
    const timer = window.setTimeout(() => inputRef.current?.focus(), 120);
    return () => window.clearTimeout(timer);
  }, []);

  // New edits clear server diagnostics and the armed confirm.
  useEffect(() => {
    setServerDiagnostics([]);
    setConfirmArmed(false);
  }, [text]);

  const syncScroll = () => {
    if (highlightRef.current && inputRef.current) {
      highlightRef.current.scrollTop = inputRef.current.scrollTop;
      highlightRef.current.scrollLeft = inputRef.current.scrollLeft;
    }
  };

  const chooseCandidate = (tokenIndex: number | undefined, accountId: string) => {
    if (tokenIndex === undefined || !resolved) return;
    const token = resolved.tokens[tokenIndex];
    if (!token) return;
    setText(text.slice(0, token.start) + `@${accountId}` + text.slice(token.end));
  };

  const submit = (confirm = false) => {
    if (!resolved || blocked || capture.isPending) return;
    capture.mutate(
      { text, clientToday: today, ...(confirm && { confirm: true }), requestId: crypto.randomUUID() },
      {
        onSuccess: (res) => {
          if (res.blocked) {
            setServerDiagnostics(res.diagnostics);
            return;
          }
          if (res.confirmRequired) {
            setConfirmArmed(true);
            setServerDiagnostics(res.diagnostics);
            return;
          }
          const key = res.task?.taskKey ?? res.event?.taskKey;
          addToast({
            type: 'success',
            title: res.intent === 'note' ? 'Saved to today\u2019s note' : res.intent === 'update' ? `Logged update on ${key}` : `Captured ${key}`,
            message: res.task?.title,
            action: key ? { label: 'Open task', onClick: () => navigateToTaskPage(key) } : undefined,
          });
          onClose();
        },
        onError: (error) => {
          addToast({ type: 'error', title: 'Capture failed', message: error.message });
        },
      },
    );
  };

  const highlightSpans = () => {
    if (!resolved) return null;
    const spans: React.ReactNode[] = [];
    let cursor = 0;
    for (const token of [...resolved.tokens].filter((t) => !t.dropped).sort((a, b) => a.start - b.start)) {
      if (token.start > cursor) spans.push(<span key={cursor}>{text.slice(cursor, token.start)}</span>);
      spans.push(
        <span
          key={token.start}
          style={{
            color: TOKEN_COLORS[token.kind],
            background: TOKEN_BG[token.kind],
            borderRadius: 4,
            padding: '0 1px',
          }}
        >
          {token.raw}
        </span>,
      );
      cursor = token.end;
    }
    spans.push(<span key="tail">{text.slice(cursor)}</span>);
    return spans;
  };

  const summaryChips = resolved ? summarize(resolved, developerNames) : [];

  return (
    <div className="px-4 py-3 space-y-2.5">
      {/* Highlight-backed input: the textarea's text is transparent over a
          colored mirror, the caret stays visible. */}
      <div className="relative">
        <div
          ref={highlightRef}
          aria-hidden
          className="pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words rounded-xl px-3 py-2 text-[13px] leading-relaxed"
          style={{ color: 'var(--text-primary)', border: '1px solid transparent' }}
        >
          {highlightSpans()}
          {/* trailing newline keeps the mirror's height in sync */}
          {'\n'}
        </div>
        <textarea
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onScroll={syncScroll}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit(confirmArmed);
            }
          }}
          rows={3}
          spellCheck={false}
          placeholder='Capture… @person !date #JIRA-1 ^T-9 +label /f /later /meeting — "T-5: text" updates, "/note" journals'
          aria-label="Capture"
          className="relative w-full resize-none rounded-xl px-3 py-2 text-[13px] leading-relaxed outline-none"
          style={{
            background: 'transparent',
            color: 'transparent',
            caretColor: 'var(--text-primary)',
            border: '1px solid var(--border)',
          }}
        />
      </div>

      {/* Structured summary */}
      {summaryChips.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5" data-testid="capture-summary">
          {summaryChips}
        </div>
      )}

      {/* Diagnostics + ambiguity chooser */}
      {diagnostics.length > 0 && (
        <div className="space-y-1" role="alert" data-testid="capture-diagnostics">
          {diagnostics.map((d, i) => (
            <div key={`${d.code}-${i}`}>
              <DiagnosticRow diagnostic={d} />
              {d.code === 'ambiguous-person' && d.candidates?.length ? (
                <div className="mt-1 flex flex-wrap gap-1.5 pl-4">
                  {d.candidates.map((candidate) => (
                    <button
                      key={candidate.accountId}
                      type="button"
                      onClick={() => chooseCandidate(d.tokenIndex, candidate.accountId)}
                      className="rounded-md px-2 py-0.5 text-[11px] font-medium"
                      style={{ background: 'var(--accent-glow)', color: 'var(--accent)', border: '1px solid color-mix(in srgb, var(--accent) 24%, transparent)' }}
                    >
                      {candidate.displayName}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}

      {confirmArmed && (
        <div className="text-[12px]" style={{ color: 'var(--warning)' }}>
          Past date — press Enter or Capture again to confirm.
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between gap-2 pt-0.5">
        <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
          {resolved?.intent === 'update' ? 'Logs a shared update on the task' : resolved?.intent === 'note' ? 'Appends to today\u2019s daily note' : 'Creates a task'}
        </span>
        <button
          type="button"
          onClick={() => submit(confirmArmed)}
          disabled={!text.trim() || blocked || capture.isPending}
          className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-semibold transition-all disabled:opacity-40"
          style={{ background: 'var(--accent)', color: '#fff', boxShadow: '0 4px 12px color-mix(in srgb, var(--accent) 25%, transparent)' }}
        >
          <Zap size={11} />
          {capture.isPending ? 'Capturing…' : confirmArmed ? 'Confirm' : 'Capture'}
        </button>
      </div>
    </div>
  );
}
