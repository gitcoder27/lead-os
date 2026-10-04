import { useAuthScopeKey } from '@/context/AuthContext';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ArrowRight, CalendarClock, CalendarDays, Flag, Hash, Hourglass, Inbox, Link2, NotebookPen, Repeat, Tags, UserRound, Users, X, Zap } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import {
  parseCapture,
  resolveCapture,
  type CaptureDefaults,
  type CaptureDiagnostic,
  type CaptureTokenKind,
  type ResolvedCapture,
} from 'shared/capture-grammar';
import { taskLabelDisplayName } from '@/types';
import { Avatar } from '@/components/ui/Avatar';
import { useToast } from '@/context/ToastContext';
import { useCapture } from '@/hooks/useCapture';
import { useCreateContact } from '@/hooks/useContacts';
import { useCaptureTypeahead } from '@/hooks/useCaptureTypeahead';
import { getLocalIsoDate, getLocalTimeZone } from '@/lib/utils';
import { navigateToTaskPage } from '@/components/tasks/TaskDrawer';
import './capture-experience.css';
import { TokenSuggestionList } from './TokenSuggestionList';

/** Per-kind token highlight colors — the live preview paints these in-place. */
const TOKEN_COLORS: Record<CaptureTokenKind, string> = {
  command: 'var(--md-accent)',
  person: 'var(--accent)',
  jira: 'var(--info)',
  parent: 'var(--success)',
  taskref: 'var(--success)',
  date: 'var(--warning)',
  due: 'var(--danger)',
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
  due: 'color-mix(in srgb, var(--danger) 12%, transparent)',
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
   * capture). Shown as an assignee pill above the input and sent as the
   * structured `defaults.ownerAccountId`, never as `@id` text — so an account id
   * with a colon (a Jira id) never has to survive the grammar. A `@person` typed
   * in the box overrides it, and the pill can be cleared.
   */
  assignee?: { accountId: string; displayName?: string };
  onClose: () => void;
  /** Fires after a successful capture, before close (standup session log, docs/50). */
  onCaptured?: (result: { intent: string; taskKey?: string }) => void;
}

/** docs/57 §3 (P3-05): Cmd/Ctrl+Enter captures and keeps the box open for the next one. */
const KEEP_OPEN_HINT = '⌘/Ctrl+Enter captures and keeps this open';

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
  } else if (resolved.intent === 'create' && !resolved.owner && !omitOwner && !resolved.scheduledOn && !resolved.dueOn && !resolved.followUp && !resolved.waitingOn) {
    chips.push(<Chip key="inbox" icon={<Inbox size={10} />}>Inbox</Chip>);
  }
  if (resolved.priority === 'high') chips.push(<Chip key="prio" icon={<Flag size={10} />}>High priority</Chip>);
  if (resolved.scheduledOn) {
    chips.push(<Chip key="date" icon={<CalendarDays size={10} />}>{format(parseISO(resolved.scheduledOn), 'EEE, MMM d')}</Chip>);
  }
  if (resolved.dueOn) {
    chips.push(<Chip key="due" icon={<CalendarClock size={10} />}>Due {format(parseISO(resolved.dueOn), 'EEE, MMM d')}</Chip>);
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
  const hintId = useId();
  const { addToast } = useToast();
  const capture = useCapture();
  const scope = useAuthScopeKey();
  const attempt = useRef<{ fingerprint: string; requestId: string } | null>(null);
  const createContact = useCreateContact();
  const [text, setText] = useState(prefill);
  const [caret, setCaret] = useState(prefill.length);
  const [confirmArmed, setConfirmArmed] = useState(false);
  const [assigneeCleared, setAssigneeCleared] = useState(false);
  const [serverDiagnostics, setServerDiagnostics] = useState<CaptureDiagnostic[]>([]);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);
  // The local day, refreshed while the box stays open (keep-open sessions can cross midnight).
  const [today, setToday] = useState(getLocalIsoDate);
  useEffect(() => {
    const timer = window.setInterval(() => setToday(getLocalIsoDate()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  // `@person`, `#JIRA-KEY` and `+label` typeahead; also owns the roster the
  // preview resolves against (developers and this manager's contacts).
  const typeahead = useCaptureTypeahead(text, caret);
  const { people } = typeahead;
  const developerNames = useMemo(() => new Map(people.map((p) => [p.accountId, p.displayName])), [people]);

  const resolved = useMemo(() => {
    if (!text.trim()) return null;
    // Jira sync state and task existence are server-authoritative; the preview
    // leaves them unverified (null lookups emit no diagnostics).
    return resolveCapture(parseCapture(text, today), { people });
  }, [text, today, people]);

  // While the roster is loading, person tokens can't be resolved yet — hold
  // their diagnostics so users don't see a spurious "nobody matches" flash.
  const holdPeopleDiagnostics = typeahead.developersPending;
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

  /** Put a typeahead choice (or any programmatic edit) into the text and caret. */
  const applyEdit = (next: { text: string; caret: number }) => {
    setText(next.text);
    setCaret(next.caret);
    window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(next.caret, next.caret);
    });
  };

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
    setText(text.slice(0, token.start) + `@${typeahead.mentionFor(accountId)}` + text.slice(token.end));
  };

  // Assignee pill: shows the effective owner — the prop, or a `@person` the
  // user typed themselves. Irrelevant for update/note intents and forbidden
  // on /later, so it hides there (and nothing is sent for them). It rides as
  // `defaults.ownerAccountId`; clearing it sends no owner at all.
  const activeAssignee = assignee && !assigneeCleared ? assignee : undefined;
  const ownerPill = resolved?.owner ?? activeAssignee ?? null;
  const ownerPillName = ownerPill
    ? developerNames.get(ownerPill.accountId) ?? ('displayName' in ownerPill ? ownerPill.displayName : undefined) ?? ownerPill.accountId
    : '';
  const assigneeName = assignee ? developerNames.get(assignee.accountId) ?? assignee.displayName ?? assignee.accountId : '';
  const showOwnerPill = !!assignee && (!resolved || (resolved.intent === 'create' && !resolved.later));

  const submit = (confirm = false, keepOpen = false) => {
    if (!resolved || blocked || capture.isPending) return;
    const defaults: CaptureDefaults | undefined = activeAssignee && resolved.intent === 'create' && !resolved.owner && !resolved.later
      ? { ownerAccountId: activeAssignee.accountId }
      : undefined;
    const tz = getLocalTimeZone();
    const clientToday = getLocalIsoDate();
    // docs/56 UX-05: the box shows `@Marcus`; the server gets the picked person's id.
    const wire = typeahead.toWire(text);
    const fingerprint = JSON.stringify({ scope, text: wire, clientToday, tz, defaults });
    if (attempt.current?.fingerprint !== fingerprint) attempt.current = { fingerprint, requestId: crypto.randomUUID() };
    const requestId = attempt.current.requestId;
    capture.mutate(
      { text: wire, clientToday, ...(tz && { tz }), ...(defaults && { defaults }), ...(confirm && { confirm: true }), requestId },
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
          if (attempt.current?.requestId === requestId) attempt.current = null;
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
          if (keepOpen) {
            // Back to the starting text (a `#KEY` or `/note` prefill), ready for the next one.
            applyEdit({ text: prefill, caret: prefill.length });
            return;
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

  const summaryChips = resolved ? summarize(resolved, developerNames, !!activeAssignee) : [];

  return (
    <div className="px-4 py-3 space-y-2.5">
      {showOwnerPill && (
        <div className="flex items-center gap-1.5" data-testid="capture-assignee">
          <span className="text-[11px] font-semibold uppercase tracking-[0.09em]" style={{ color: 'var(--text-muted)' }}>
            Assignee
          </span>
          {ownerPill ? (
            <>
              <span
                className="inline-flex items-center gap-1.5 rounded-full py-0.5 pl-0.5 pr-2 text-[12.5px] font-medium"
                style={{ background: 'var(--accent-glow)', color: 'var(--accent)', border: '1px solid color-mix(in srgb, var(--accent) 26%, transparent)' }}
              >
                <Avatar name={ownerPillName} seed={ownerPill.accountId} size={16} />
                {ownerPillName}
                {/* A typed @person is edited in the text; only the supplied assignee can be cleared. */}
                {!resolved?.owner ? (
                  <button
                    type="button"
                    aria-label="Clear assignee"
                    title="Clear assignee"
                    onClick={() => setAssigneeCleared(true)}
                    className="ml-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full transition-colors hover:bg-[color-mix(in_srgb,var(--accent)_18%,transparent)]"
                  >
                    <X size={10} aria-hidden="true" />
                  </button>
                ) : null}
              </span>
              <span className="text-[11.5px]" style={{ color: 'var(--text-muted)' }}>
                type @name to change
              </span>
            </>
          ) : (
            <>
              <span className="text-[12.5px]" style={{ color: 'var(--text-secondary)' }}>Nobody — lands in Inbox</span>
              <button type="button" className="ui-btn-ghost" onClick={() => setAssigneeCleared(false)}>
                Assign to {assigneeName}
              </button>
            </>
          )}
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
            const nav = typeahead.handleKey(e);
            if (typeof nav === 'object') { applyEdit(nav); return; }
            if (nav) return;
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              // Cmd/Ctrl+Enter always captures (and keeps the box open); a plain
              // Enter first accepts an open suggestion.
              const keepOpen = e.metaKey || e.ctrlKey;
              if (typeahead.open && !keepOpen) {
                const chosen = typeahead.choose();
                if (chosen) { applyEdit(chosen); return; }
              }
              submit(confirmArmed, keepOpen);
            }
          }}
          rows={3}
          spellCheck={false}
          placeholder="What do you need to do?"
          aria-describedby={hintId}
          aria-label="Capture"
          className="capture-title-input relative w-full resize-none rounded-xl px-3 py-2 text-[13px] leading-relaxed outline-none"
          style={{
            background: 'transparent',
            color: 'transparent',
            caretColor: 'var(--text-primary)',
            border: '1px solid var(--border)',
          }}
        />
        {typeahead.open && typeahead.fragment ? (
          <TokenSuggestionList
            trigger={typeahead.fragment.trigger}
            suggestions={typeahead.suggestions}
            activeIndex={typeahead.activeIndex}
            onHover={typeahead.setActiveIndex}
            onChoose={(suggestion) => {
              const chosen = typeahead.choose(suggestion);
              if (chosen) applyEdit(chosen);
            }}
          />
        ) : null}
      </div>

      <div className="capture-guidance">
        <p id={hintId}>A title is enough. Extras are optional.</p>
        <details className="capture-examples"><summary>Examples</summary><ul>
          <li><strong>Just a task</strong><code>Prepare the release update</code></li>
          <li><strong>Plan for tomorrow</strong><code>Review the rollout checklist !tomorrow</code></li>
          <li><strong>Private daily note</strong><code>/note Decision: keep Friday for verification</code></li>
        </ul><p>Type @ to choose a person, # to link Jira or + to add a label.</p></details>
      </div>

      {/* Structured summary */}
      {summaryChips.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5" data-testid="capture-summary">
          {summaryChips}
        </div>
      )}

      {/* Diagnostics + ambiguity chooser */}
      {/* A live region that exists before its content does, so changes are announced; polite, because
          diagnostics update as you type and an assertive alert would interrupt on every keystroke. */}
      <div role="status" aria-live="polite" className="empty:hidden">
        {diagnostics.length > 0 && (
          <div className="space-y-1" data-testid="capture-diagnostics">
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
      </div>

      {confirmArmed && (
        <div className="text-[12px]" role="status" style={{ color: 'var(--warning-text)' }}>
          {confirmMessage(serverDiagnostics)}
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between gap-2 pt-0.5">
        <span className="min-w-0 text-[12px]" style={{ color: 'var(--text-muted)' }}>
          {resolved?.intent === 'update' ? 'Logs a shared update on the task' : resolved?.intent === 'note' ? 'Appends to today\u2019s daily note' : 'Creates a task'}
          <span className="hidden sm:inline" data-testid="capture-keep-open-hint"> · {KEEP_OPEN_HINT}</span>
        </span>
        <span className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={() => submit(confirmArmed, true)}
            disabled={!text.trim() || blocked || capture.isPending}
            className="ui-btn"
            aria-label="Add another"
            title={KEEP_OPEN_HINT}
          >
            + Another
          </button>
          <button
            type="button"
            onClick={() => submit(confirmArmed)}
            disabled={!text.trim() || blocked || capture.isPending}
            className="ui-btn-solid"
          >
            <Zap size={11} />
            {capture.isPending ? 'Capturing…' : confirmArmed ? 'Confirm' : 'Capture'}
          </button>
        </span>
      </div>
    </div>
  );
}

/** What pressing Capture a second time would accept: a past date, or a malformed @mention kept as typed. */
function confirmMessage(diagnostics: CaptureDiagnostic[]): string {
  const mention = diagnostics.find((entry) => entry.code === 'malformed-mention');
  if (mention) return `${mention.message}. Edit it, or press Enter or Capture again to keep it as text.`;
  return 'Past date — press Enter or Capture again to confirm.';
}
