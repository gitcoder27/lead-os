import { useEffect, useMemo, useRef, useState } from 'react';
import { useToast } from '@/context/ToastContext';
import { WEEKLY_REVIEW_LIMITS } from '@/types';
import type { ReviewStepContext } from '@/lib/weekly-review';
import { buildWeeklyReport, reportMarkdownToHtml, reviewReportTasks, toHtml, toMarkdown } from '@/lib/weekly-report';
import { copyReport } from '@/lib/report-clipboard';
import { csvFileName, downloadCsv, tasksCsv } from '@/lib/csv';
import { shouldIgnoreTriageEvent } from '@/lib/today-triage';
import { ReviewPastUpdates } from './ReviewPastUpdates';
import { ReviewSourceNote } from './ReviewSourceNote';

export function ReviewSendStep({ ctx }: { ctx: ReviewStepContext }) {
  const { addToast } = useToast();
  const [editing, setEditing] = useState(ctx.saved.reportMarkdown !== null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const state = useMemo(
    () => ({ excluded: ctx.saved.excluded, decisions: ctx.decisions, pins: ctx.pins, personName: ctx.personName }),
    [ctx.saved.excluded, ctx.decisions, ctx.pins, ctx.personName],
  );
  const model = useMemo(() => buildWeeklyReport(ctx.review, state), [ctx.review, state]);
  const lines = model.sections.flatMap((section) => section.lines);
  const markdown = ctx.saved.reportMarkdown ?? toMarkdown(model);
  const pending = [...ctx.decisions.values()].some((decision) => decision.pending);
  const toggle = (id: string) => {
    const line = lines.find((line) => line.id === id);
    if (!line || editing || busy) return;
    ctx.editReport?.(null);
    ctx.setIncluded(line.id, line.defaultIncluded, !line.included);
  };
  const run = async (action: 'teams' | 'markdown' | 'finish') => {
    if (busy || pending || !ctx.saveReport || (action !== 'finish' && !markdown.trim())) return;
    setBusy(true);
    setError(null);
    try {
      await ctx.saveReport(markdown, action === 'finish');
      if (action === 'finish') {
        addToast({
          type: 'success',
          title: ctx.pins.length
            ? `Review done · ${new Intl.DateTimeFormat('en', { weekday: 'long' }).format(new Date(`${ctx.review.nextWorkday}T12:00:00`))} is planned`
            : 'Review done',
        });
        ctx.finishReview?.();
      } else {
        const result = await copyReport(
          markdown,
          action === 'teams'
            ? ctx.saved.reportMarkdown !== null
              ? reportMarkdownToHtml(markdown)
              : toHtml(model)
            : undefined,
        );
        addToast({ type: 'success', title: result === 'formatted' ? 'Update copied' : 'Copied as text' });
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Try again.';
      setError(message);
      addToast({
        type: 'error',
        title: action === 'finish' ? "Couldn't finish review" : "Couldn't copy update",
        message,
      });
    } finally {
      setBusy(false);
    }
  };
  const handler = useRef<(event: KeyboardEvent) => void>(() => {});
  handler.current = (event) => {
    const checkbox =
      event.target instanceof HTMLInputElement &&
      event.target.type === 'checkbox' &&
      list.current?.contains(event.target);
    if (
      busy ||
      event.defaultPrevented ||
      event.metaKey ||
      event.ctrlKey ||
      event.altKey ||
      (!checkbox && shouldIgnoreTriageEvent(event))
    )
      return;
    if (event.key === 'y') {
      event.preventDefault();
      void run('teams');
      return;
    }
    if (editing || !lines.length) return;
    const activeLine = checkbox ? (event.target as HTMLInputElement).dataset.reportLine : focused;
    const index = lines.findIndex((line) => line.id === activeLine);
    if (event.key === 'j' || event.key === 'k') {
      event.preventDefault();
      const next = lines[event.key === 'j' ? Math.min(lines.length - 1, index + 1) : Math.max(0, index - 1)]!;
      setFocused(next.id);
      Array.from(list.current?.querySelectorAll<HTMLInputElement>('[data-report-line]') ?? [])
        .find((input) => input.dataset.reportLine === next.id)
        ?.focus();
    } else if (event.key === 'x' && activeLine) {
      event.preventDefault();
      toggle(activeLine);
    }
  };
  useEffect(() => {
    const key = (event: KeyboardEvent) => handler.current(event);
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, []);
  const closed = reviewReportTasks(ctx.review, state).filter(
    (row) => row.status === 'done' || row.status === 'dropped',
  );
  return (
    <div className="review-send">
      <p className="review-send-intro">Choose what goes into your update, then copy it for your weekly report.</p>
      {ctx.review.jira?.status === 'unavailable' && <ReviewSourceNote what="Jira totals" onRetry={ctx.retry} />}
      {pending && <p role="status">Waiting for task changes to save…</p>}
      <div className="review-report" ref={list}>
        {editing ? (
          <label className="review-report-editor">
            Update text
            <textarea
              aria-label="Update text"
              maxLength={WEEKLY_REVIEW_LIMITS.reportChars}
              value={markdown}
              disabled={busy}
              onChange={(event) => ctx.editReport?.(event.target.value)}
            />
          </label>
        ) : (
          <>
            <p className="review-report-title">{model.title}</p>
            {model.sections
              .filter((section) => section.lines.length)
              .map((section) => (
                <section key={section.id} aria-label={section.title}>
                  <h3>{section.title}</h3>
                  <ul>
                    {section.lines.map((line) => (
                      <li key={line.id} data-included={line.included}>
                        <label>
                          <input
                            type="checkbox"
                            data-report-line={line.id}
                            checked={line.included}
                            disabled={busy}
                            onFocus={() => setFocused(line.id)}
                            onChange={() => toggle(line.id)}
                            aria-describedby={line.namesPerson ? `hint-${line.id}` : undefined}
                          />
                          <span>{line.text}</span>
                        </label>
                        {line.namesPerson && (
                          <span className="review-person-hint" id={`hint-${line.id}`}>
                            Names a person
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            {!lines.length && <p>Nothing to report yet.</p>}
          </>
        )}
      </div>
      <div className="review-send-actions">
        <button
          type="button"
          className="ui-btn-secondary"
          disabled={busy}
          onClick={() => {
            if (editing) {
              ctx.editReport?.(null);
              setEditing(false);
            } else {
              ctx.editReport?.(markdown);
              setEditing(true);
            }
          }}
        >
          {editing ? 'Use selected lines' : 'Edit text'}
        </button>
        <button
          type="button"
          className="ui-btn-secondary"
          disabled={busy || !closed.length}
          onClick={() =>
            downloadCsv(
              tasksCsv(
                closed,
                (type, id) => (type === 'developer' ? ctx.personName(id) : id === ctx.selfAccountId ? 'Me' : 'Manager'),
                ctx.today,
              ),
              csvFileName('tasks', 'closed-this-week', ctx.today),
            )
          }
        >
          Download CSV
        </button>
        <button
          type="button"
          className="ui-btn-secondary"
          disabled={busy || pending || !markdown.trim()}
          onClick={() => void run('markdown')}
        >
          Copy Markdown
        </button>
        <button
          type="button"
          className="ui-btn-solid"
          disabled={busy || pending || !markdown.trim()}
          onClick={() => void run('teams')}
        >
          Copy for Teams
        </button>
        <button type="button" className="ui-btn-solid" disabled={busy || pending} onClick={() => void run('finish')}>
          {busy ? 'Saving…' : 'Finish review'}
        </button>
      </div>
      {error && (
        <p role="alert" className="review-source-note">
          {error} Your text is kept here. Try again.
        </p>
      )}
      <ReviewPastUpdates />
    </div>
  );
}
