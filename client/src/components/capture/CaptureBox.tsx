import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, CalendarDays, Flag, Hash, Hourglass, Inbox, Link2, NotebookPen, Repeat, Tags, UserRound, Users, Zap } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import {
  parseCapture,
  resolveCapture,
  type CaptureDiagnostic,
  type CapturePersonCandidate,
  type CaptureTokenKind,
  type ResolvedCapture,
} from 'shared/capture-grammar';
import { taskLabelDisplayName } from '@/types';
import { Avatar } from '@/components/ui/Avatar';
import { useToast } from '@/context/ToastContext';
import { useCapture } from '@/hooks/useCapture';
import { useDevelopers } from '@/hooks/useDevelopers';
import { useContacts, useCreateContact } from '@/hooks/useContacts';
import { useTaskLabels } from '@/hooks/useTaskLabels';
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
  waiting: 'var(--warning)',
  label: 'var(--accent)',
};

const TOKEN_BG: Record<CaptureTokenKind, string> = {
  command: 'color-mix(in srgb, var(--md-accent) 12%, transparent)',
  person: 'var(--accent-glow)',
  jira: 'color-mix(in srgb, var(--info) 14%, transparent)',
  parent: 'color-mix(in srgb, var(--success) 12%, transparent)',
  taskref: 'color-mix(in srgb, var(--success) 12%, transparent)',
  date: 'color-mix(in srgb, var(--warning) 14%, transparent)',
  priority: 'color-mix(in srgb, var(--danger) 12%, transparent)',
  later: 'var(--bg-tertiary)',
  meeting: 'color-mix(in srgb, var(--md-accent) 12%, transparent)',
  followup: 'color-mix(in srgb, var(--warning) 12%, transparent)',
  waiting: 'color-mix(in srgb, var(--warning) 12%, transparent)',
  label: 'var(--accent-glow)',
};

interface CaptureBoxProps {
  /** Initial text, e.g. "@dev-1 " from a developer context or "/note ". */
  prefill?: string;
  /**
   * The developer this capture is for (standup "New task", dev-scoped quick
   * capture). Shown as an assignee pill above the input; the `@accountId`
   * token is injected at submit so a raw account id never appears in the
   * text. A `@person` typed in the box overrides it.
   */
  assignee?: { accountId: string; displayName?: string };
  onClose: () => void;
  /** Fires after a successful capture, before close (standup session log, docs/50). */
  onCaptured?: (result: { intent: string; taskKey?: string }) => void;
}

function Chip({ icon, children, tone }: { icon?: React.ReactNode; children: React.ReactNode; tone?: 'error' | 'warning' }) {
  const color = tone === 'error' ? 'var(--danger)' : tone === 'warning' ? 'var(--warning)' : 'var(--text-secondary)';
  return (
    <span
      className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[12px] font-medium"
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

function summarize(resolved: ResolvedCapture, developerNames: Map<string, string>, omitOwner = false) {
  const chips: React.ReactNode[] = [];
  if (resolved.intent === 'update') {
    chips.push(<Chip key="intent" icon={<ArrowRight size={10} />}>Update {resolved.updateTargetKey}</Chip>);
  } else if (resolved.intent === 'note') {
    chips.push(<Chip key="intent" icon={<NotebookPen size={10} />}>Today's note</Chip>);
  }
  if (resolved.owner && !omitOwner) {
    chips.push(<Chip key="owner" icon={<UserRound size={10} />}>{developerNames.get(resolved.owner.accountId) ?? resolved.owner.accountId}</Chip>);
  }
  if (resolved.waitingOn) {
    const check = resolved.followUpAt ? ` · check ${format(parseISO(resolved.followUpAt), 'EEE, MMM d')}` : '';
    chips.push(<Chip key="waiting" icon={<Hourglass size={10} />}>Waiting on {resolved.waitingOn.displayName}{check}</Chip>);
  }
  if (resolved.meeting) chips.push(<Chip key="meeting" icon={<Users size={10} />}>Meeting</Chip>);
  if (resolved.later) {
    chips.push(<Chip key="later" icon={<Repeat size={10} />}>Later{resolved.hideUntil ? ` · back ${format(parseISO(resolved.hideUntil), 'EEE, MMM d')}` : ''}</Chip>);
  } else if (resolved.intent === 'create' && !resolved.owner && !omitOwner && !resolved.scheduledOn && !resolved.followUp && !resolved.waitingOn) {
    chips.push(<Chip key="inbox" icon={<Inbox size={10} />}>Inbox</Chip>);
  }
  if (resolved.priority === 'high') chips.push(<Chip key="prio" icon={<Flag size={10} />}>High priority</Chip>);
  if (resolved.scheduledOn) {
    chips.push(<Chip key="date" icon={<CalendarDays size={10} />}>{format(parseISO(resolved.scheduledOn), 'EEE, MMM d')}</Chip>);
  }
  if (resolved.followUp && !resolved.waitingOn) {
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
    chips.push(<Chip key={`pl-${person.kind ?? 'developer'}-${person.accountId}`} icon={<UserRound size={10} />}>↔ {person.displayName || (developerNames.get(person.accountId) ?? person.accountId)}</Chip>);
  }
  return chips;
}

/**
 * Phase 3 (P3-D8, §4.3): the single capture input. Live token-highlight
 * preview + structured summary; the server re-parses authoritatively on
 * submit. Errors block the submit; warnings may need a confirm press.
 */
export function CaptureBox({ prefill = '', assignee, onClose, onCaptured }: CaptureBoxProps) {
  const { addToast } = useToast();
  const capture = useCapture();
  const developers = useDevelopers();
  const contacts = useContacts();
  const createContact = useCreateContact();
  const labelRegistry = useTaskLabels();
  const [text, setText] = useState(prefill);
  const [caret, setCaret] = useState(prefill.length);
  const [suggestDismissed, setSuggestDismissed] = useState(false);
  const [activeLabelIndex, setActiveLabelIndex] = useState(0);
  const [confirmArmed, setConfirmArmed] = useState(false);
  const [serverDiagnostics, setServerDiagnostics] = useState<CaptureDiagnostic[]>([]);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);
  const today = useMemo(() => getLocalIsoDate(), []);

  // docs/57 §2: `@handle` also resolves the manager's contacts (external people).
  const people = useMemo<CapturePersonCandidate[]>(
    () => [
      ...(developers.data ?? []).map((dev) => ({ accountId: dev.accountId, displayName: dev.displayName, kind: 'developer' as const })),
      ...(contacts.data ?? []).map((contact) => ({ accountId: contact.handle, displayName: contact.displayName, kind: 'contact' as const, contactId: contact.id })),
    ],
    [developers.data, contacts.data],
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
  const heldDiagnostics = holdPeopleDiagnostics
    ? allDiagnostics.filter((d) => d.code !== 'unknown-person' && d.code !== 'ambiguous-person')
    : allDiagnostics;
  // Cosmetic: "/note "/"/T-5: " prefills fire empty-* errors before a body is
  // typed. Hide those while the body is blank — the server still enforces.
  const diagnostics = heldDiagnostics.filter((d) => {
    if (resolved?.title.trim()) return true;
    return d.code !== 'empty-note' && d.code !== 'empty-update' && d.code !== 'empty-title';
  });
  const blocked = diagnostics.some((d) => d.severity === 'error');

  // §3.3: `+label` typeahead — the fragment under the caret suggests
  // registered label names, mirroring the @person ambiguity chooser.
  const labelFragment = useMemo(() => {
    const before = text.slice(0, caret);
    const match = /(?:^|\s)\+([a-zA-Z0-9:_-]*)$/.exec(before);
    return match ? { start: caret - match[1]!.length - 1, fragment: match[1]! } : null;
  }, [text, caret]);

  const labelSuggestions = useMemo(() => {
    if (!labelFragment || suggestDismissed) return [];
    const fragment = labelFragment.fragment.toLowerCase();
    const names = (labelRegistry.data?.labels ?? []).map((label) => label.name);
    const prefix = names.filter((name) => name.startsWith(fragment) && name !== fragment);
    const contains = names.filter((name) => !prefix.includes(name) && name.includes(fragment));
    return [...prefix, ...contains].slice(0, 6);
  }, [labelFragment, labelRegistry.data, suggestDismissed]);

  const applyLabel = (name: string) => {
    if (!labelFragment) return;
    const next = `${text.slice(0, labelFragment.start)}+${name} ${text.slice(caret)}`;
    const nextCaret = labelFragment.start + name.length + 2;
    setText(next);
    setCaret(nextCaret);
    setActiveLabelIndex(0);
    window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(nextCaret, nextCaret);
    });
  };

  useEffect(() => {
    const timer = window.setTimeout(() => inputRef.current?.focus(), 120);
    return () => window.clearTimeout(timer);
  }, []);

  // New edits clear server diagnostics, the armed confirm, and dismissed
  // label suggestions.
  useEffect(() => {
    setServerDiagnostics([]);
    setConfirmArmed(false);
    setSuggestDismissed(false);
    setActiveLabelIndex(0);
  }, [text]);

  const syncScroll = () => {
    if (highlightRef.current && inputRef.current) {
      highlightRef.current.scrollTop = inputRef.current.scrollTop;
      highlightRef.current.scrollLeft = inputRef.current.scrollLeft;
    }
  };

  // docs/57 §3: an unknown @name can become an external contact in place; the
  // refetched contact list then resolves the same text.
  const addContact = (alias: string) => {
    createContact.mutate(
      { displayName: alias, handle: alias.toLowerCase() },
      {
        onSuccess: (contact) => {
          setServerDiagnostics([]);
          addToast({ type: 'success', title: `Added contact @${contact.handle}` });
        },
        onError: (error) => addToast({ type: 'error', title: 'Could not add contact', message: error.message }),
      },
    );
  };

  const chooseCandidate = (tokenIndex: number | undefined, accountId: string) => {
    if (tokenIndex === undefined || !resolved) return;
    const token = resolved.tokens[tokenIndex];
    if (!token) return;
    setText(text.slice(0, token.start) + `@${accountId}` + text.slice(token.end));
  };

  // Assignee pill: shows the effective owner — the prop, or a `@person` the
  // user typed themselves. Irrelevant for update/note intents and forbidden
  // on /later, so it hides there (and no token is injected for them).
  const ownerPill = resolved?.owner ?? assignee ?? null;
  const ownerPillName = ownerPill
    ? developerNames.get(ownerPill.accountId) ?? ownerPill.displayName ?? ownerPill.accountId
    : '';
  const showOwnerPill = !!assignee && (!resolved || (resolved.intent === 'create' && !resolved.later));

  const submit = (confirm = false) => {
    if (!resolved || blocked || capture.isPending) return;
    const injectOwner = assignee && resolved.intent === 'create' && !resolved.owner && !resolved.later;
    capture.mutate(
      { text: injectOwner ? `@${assignee.accountId} ${text}` : text, clientToday: today, ...(confirm && { confirm: true }), requestId: crypto.randomUUID() },
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
          onCaptured?.({ intent: res.intent, taskKey: key });
          addToast({
            type: 'success',
            title: res.intent === 'note' ? 'Saved to today\u2019s note' : res.intent === 'update' ? `Logged update on ${key}` : `Captured ${key}`,
            message: res.task?.title,
            action: key ? { label: 'Open task', onClick: () => navigateToTaskPage(key) } : undefined,
          });
          // Non-blocking warnings (e.g. an unsynced #KEY demoted to text)
          // still surface — the dialog closes on success, so toast them.
          const warnings = res.diagnostics.filter((d) => d.severity !== 'error');
          if (warnings.length) {
            addToast({
              type: 'warning',
              title: 'Captured with warnings',
              message: warnings.map((d) => d.message).join(' '),
            });
          }
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

  const summaryChips = resolved ? summarize(resolved, developerNames, !!assignee) : [];

  return (
    <div className="px-4 py-3 space-y-2.5">
      {showOwnerPill && ownerPill && (
        <div className="flex items-center gap-1.5" data-testid="capture-assignee">
          <span className="text-[11px] font-semibold uppercase tracking-[0.09em]" style={{ color: 'var(--text-muted)' }}>
            Assignee
          </span>
          <span
            className="inline-flex items-center gap-1.5 rounded-full py-0.5 pl-0.5 pr-2 text-[12.5px] font-medium"
            style={{ background: 'var(--accent-glow)', color: 'var(--accent)', border: '1px solid color-mix(in srgb, var(--accent) 26%, transparent)' }}
          >
            <Avatar name={ownerPillName} seed={ownerPill.accountId} size={16} />
            {ownerPillName}
          </span>
          <span className="text-[11.5px]" style={{ color: 'var(--text-muted)' }}>
            type @name to change
          </span>
        </div>
      )}

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
          onChange={(e) => {
            setText(e.target.value);
            setCaret(e.target.selectionStart);
          }}
          onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
          onScroll={syncScroll}
          onKeyDown={(e) => {
            if (labelSuggestions.length) {
              if (e.key === 'ArrowDown') { e.preventDefault(); setActiveLabelIndex((i) => (i + 1) % labelSuggestions.length); return; }
              if (e.key === 'ArrowUp') { e.preventDefault(); setActiveLabelIndex((i) => (i - 1 + labelSuggestions.length) % labelSuggestions.length); return; }
              if (e.key === 'Tab') { e.preventDefault(); applyLabel(labelSuggestions[activeLabelIndex]!); return; }
              if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setSuggestDismissed(true); return; }
            }
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              if (labelSuggestions.length) {
                applyLabel(labelSuggestions[activeLabelIndex]!);
                return;
              }
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
        {labelSuggestions.length > 0 && (
          <div
            className="absolute left-0 right-0 top-full z-20 mt-1 overflow-hidden rounded-xl"
            role="listbox"
            aria-label="Label suggestions"
            style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', boxShadow: '0 12px 32px rgba(0,0,0,0.28)' }}
          >
            {labelSuggestions.map((name, index) => (
              <button
                key={name}
                type="button"
                role="option"
                aria-selected={index === activeLabelIndex}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => applyLabel(name)}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] transition-colors"
                style={{
                  background: index === activeLabelIndex ? 'var(--accent-glow)' : 'transparent',
                  color: 'var(--text-primary)',
                }}
              >
                <Tags size={10} style={{ color: 'var(--accent)' }} />
                <span className="font-mono font-semibold">+{name}</span>
                <span className="text-[12px]" style={{ color: 'var(--text-muted)' }}>{taskLabelDisplayName(name)}</span>
              </button>
            ))}
          </div>
        )}
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
                      className="rounded-md px-2 py-0.5 text-[12px] font-medium"
                      style={{ background: 'var(--accent-glow)', color: 'var(--accent)', border: '1px solid color-mix(in srgb, var(--accent) 24%, transparent)' }}
                    >
                      {candidate.displayName}
                    </button>
                  ))}
                </div>
              ) : null}
              {d.code === 'unknown-person' && d.suggestContact ? (
                <div className="mt-1 pl-4">
                  <button
                    type="button"
                    disabled={createContact.isPending}
                    onClick={() => addContact(d.suggestContact!)}
                    className="rounded-md px-2 py-0.5 text-[12px] font-medium"
                    style={{ background: 'var(--accent-glow)', color: 'var(--accent)', border: '1px solid color-mix(in srgb, var(--accent) 24%, transparent)' }}
                  >
                    Create contact @{d.suggestContact}
                  </button>
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
        <span className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
          {resolved?.intent === 'update' ? 'Logs a shared update on the task' : resolved?.intent === 'note' ? 'Appends to today\u2019s daily note' : 'Creates a task'}
        </span>
        <button
          type="button"
          onClick={() => submit(confirmArmed)}
          disabled={!text.trim() || blocked || capture.isPending}
          className="ui-btn-solid"
        >
          <Zap size={11} />
          {capture.isPending ? 'Capturing…' : confirmArmed ? 'Confirm' : 'Capture'}
        </button>
      </div>
    </div>
  );
}
