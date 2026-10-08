import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { CornerDownLeft, Flag, Hourglass, Pin, Users, Zap } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { parseCapture, resolveCapture, type ResolvedCapture } from 'shared/capture-grammar';
import { CAPTURE_TOKEN_BG, CAPTURE_TOKEN_COLORS, summarizeCapture } from '@/components/capture/capture-preview';
import { Kbd } from '@/components/ui/Kbd';
import { getLocalIsoDate } from '@/lib/utils';
import { CAPTURE_EXAMPLES, DEMO_NAMES, DEMO_PEOPLE, INTRO_EXAMPLE, firstName } from './demo-data';
import { FakeAction, ReplicaLabel, StatusDot, TaskKey } from './replica';

interface PlanRow {
  key: string;
  title: string;
  pinned?: boolean;
  meeting?: boolean;
  high?: boolean;
  fresh?: boolean;
}

interface WaitingRow {
  key: string;
  title: string;
  meta: string;
  fresh?: boolean;
}

type Outcome =
  | { list: 'plan'; row: PlanRow; message: string }
  | { list: 'waiting'; row: WaitingRow; message: string }
  | { list: null; message: string };

const INITIAL_PLAN: PlanRow[] = [
  { key: 'T-131', title: 'Finalize the Q4 hiring plan', pinned: true },
  { key: 'T-136', title: 'Review the caching design doc', pinned: true },
  { key: 'T-140', title: 'Draft release notes for 2.4', pinned: true },
];

const INITIAL_WAITING: WaitingRow[] = [
  { key: 'T-128', title: 'Security sign-off for the SSO rollout', meta: 'Dana · waiting 3d' },
];

const MAX_PLAN_ROWS = 5;
const MAX_WAITING_ROWS = 3;
const FIRST_DEMO_KEY = 143;

function dayLabel(iso: string): string {
  return format(parseISO(iso), 'EEE, MMM d');
}

/** Where a capture lands, in the same lanes the app files it into (docs/57 §1). */
export function demoOutcome(resolved: ResolvedCapture, key: string, today: string): Outcome {
  if (resolved.intent === 'note') return { list: null, message: 'Saved to today’s note. Notes are private to you.' };
  if (resolved.intent === 'update') return { list: null, message: `Added an update to ${resolved.updateTargetKey}.` };

  const title = resolved.title;
  const high = resolved.priority === 'high';
  if (resolved.waitingOn) {
    const who = resolved.waitingOn.displayName.split(' ')[0]!;
    const check = resolved.followUpAt;
    return {
      list: 'waiting',
      row: { key, title, meta: check ? `${who} · check ${format(parseISO(check), 'EEE')}` : `${who} · since today` },
      message: check
        ? `Captured ${key}. It waits on ${who} and comes back to Today on ${dayLabel(check)}.`
        : `Captured ${key}. It waits on ${who} until you mark it done.`,
    };
  }
  if (resolved.later) {
    return { list: null, message: `Captured ${key}. Parked in Later${resolved.hideUntil ? ` until ${dayLabel(resolved.hideUntil)}` : ''}.` };
  }
  if (resolved.owner) {
    const who = firstName(resolved.owner.accountId);
    return { list: null, message: `Captured ${key}. It’s on ${who}’s plan in Team, and comes back to you in Waiting if it goes quiet.` };
  }
  if (resolved.scheduledOn === today) {
    return {
      list: 'plan',
      row: { key, title, meeting: resolved.meeting, high },
      message: `Captured ${key}. It’s on today’s plan${resolved.meeting ? ' as a meeting' : ''}.`,
    };
  }
  if (resolved.meeting && resolved.scheduledOn) return { list: null, message: `Captured ${key}. It’s in Meetings for ${dayLabel(resolved.scheduledOn)}.` };
  if (resolved.scheduledOn) return { list: null, message: `Captured ${key}. Planned for ${dayLabel(resolved.scheduledOn)}${high ? ', high priority' : ''}.` };
  if (resolved.dueOn) return { list: null, message: `Captured ${key}. It’s in My tasks, due ${dayLabel(resolved.dueOn)}.` };
  return { list: null, message: `Captured ${key}. It’s in your Inbox to sort when you have a minute.` };
}

/**
 * The hero's live demo: the real capture grammar (`shared/capture-grammar`)
 * parsing whatever the visitor types against a fictional team, and a small
 * Today that the capture lands in. It runs entirely in the browser.
 */
export function CaptureDemo() {
  const reduceMotion = useReducedMotion();
  const today = useMemo(() => getLocalIsoDate(), []);
  const [text, setText] = useState('');
  const [plan, setPlan] = useState<PlanRow[]>(INITIAL_PLAN);
  const [waiting, setWaiting] = useState<WaitingRow[]>(INITIAL_WAITING);
  const [message, setMessage] = useState('');
  const nextKeyRef = useRef(FIRST_DEMO_KEY);
  const interactedRef = useRef(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const mirrorRef = useRef<HTMLDivElement>(null);
  const hintId = useId();

  const resolved = useMemo(() => {
    if (!text.trim()) return null;
    return resolveCapture(parseCapture(text, today), { people: DEMO_PEOPLE });
  }, [text, today]);

  const capture = useCallback((raw: string) => {
    if (!raw.trim()) return;
    const result = resolveCapture(parseCapture(raw, today), { people: DEMO_PEOPLE });
    if (result.blocked) return;
    const key = `T-${nextKeyRef.current}`;
    nextKeyRef.current += 1;
    const outcome = demoOutcome(result, key, today);
    if (outcome.list === 'plan') {
      setPlan((rows) => {
        const pinned = rows.filter((row) => row.pinned).map((row) => ({ ...row, fresh: false }));
        const rest = rows.filter((row) => !row.pinned).map((row) => ({ ...row, fresh: false }));
        return [...pinned, { ...outcome.row, fresh: true }, ...rest].slice(0, MAX_PLAN_ROWS);
      });
    } else if (outcome.list === 'waiting') {
      setWaiting((rows) => [{ ...outcome.row, fresh: true }, ...rows.map((row) => ({ ...row, fresh: false }))].slice(0, MAX_WAITING_ROWS));
    }
    setMessage(outcome.message);
    setText('');
  }, [today]);

  // The one orchestrated moment: the first example types itself, its tokens
  // resolve as they complete, and it lands in Waiting. Any interaction stops it.
  useEffect(() => {
    if (reduceMotion) {
      setText(INTRO_EXAMPLE.text);
      return undefined;
    }
    const full = INTRO_EXAMPLE.text;
    const timers: number[] = [];
    let typed = 0;
    const typeNext = () => {
      if (interactedRef.current) return;
      typed += 1;
      setText(full.slice(0, typed));
      if (typed < full.length) {
        timers.push(window.setTimeout(typeNext, full[typed - 1] === ' ' ? 70 : 34));
      } else {
        timers.push(window.setTimeout(() => {
          if (!interactedRef.current) capture(full);
        }, 1100));
      }
    };
    timers.push(window.setTimeout(typeNext, 900));
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [reduceMotion, capture]);

  const takeOver = () => {
    interactedRef.current = true;
  };

  const tryExample = (example: string) => {
    takeOver();
    setText(example);
    setMessage('');
    const input = inputRef.current;
    if (input) {
      input.focus();
      requestAnimationFrame(() => input.setSelectionRange(example.length, example.length));
    }
  };

  const spans = useMemo(() => {
    if (!resolved) return text;
    const out: ReactNode[] = [];
    let cursor = 0;
    for (const token of [...resolved.tokens].filter((entry) => !entry.dropped).sort((a, b) => a.start - b.start)) {
      if (token.start > cursor) out.push(<span key={`t-${cursor}`}>{text.slice(cursor, token.start)}</span>);
      out.push(
        <span key={token.start} className="lp-demo-token" style={{ color: CAPTURE_TOKEN_COLORS[token.kind], background: CAPTURE_TOKEN_BG[token.kind] }}>
          {token.raw}
        </span>,
      );
      cursor = token.end;
    }
    out.push(<span key="tail">{text.slice(cursor)}</span>);
    return out;
  }, [resolved, text]);

  const chips = resolved ? summarizeCapture(resolved, DEMO_NAMES) : [];
  const errors = resolved?.diagnostics.filter((entry) => entry.severity === 'error') ?? [];
  const unknownPerson = errors.some((entry) => entry.code === 'unknown-person' || entry.code === 'ambiguous-person');
  const canCapture = Boolean(resolved && !resolved.blocked);

  return (
    <div className="lp-demo">
      <div className="lp-demo-capture">
        <div className="lp-demo-head">
          <span className="lp-demo-head-title">
            <Zap size={13} aria-hidden="true" />
            Capture
          </span>
          <Kbd variant="subtle">⌘I</Kbd>
        </div>

        <div className="lp-demo-field">
          <div ref={mirrorRef} className="lp-demo-mirror" aria-hidden="true">
            {spans}
            {'\n'}
          </div>
          <textarea
            ref={inputRef}
            value={text}
            rows={2}
            spellCheck={false}
            autoCapitalize="none"
            aria-label="Try capture"
            aria-describedby={hintId}
            placeholder="What do you need to do?"
            className="lp-demo-input"
            onFocus={takeOver}
            onPointerDown={takeOver}
            onScroll={(event) => {
              if (mirrorRef.current) mirrorRef.current.scrollTop = event.currentTarget.scrollTop;
            }}
            onChange={(event) => {
              takeOver();
              setText(event.target.value.replace(/\n/g, ' '));
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                takeOver();
                capture(text);
              }
            }}
          />
        </div>

        <div className="lp-demo-summary">
          {chips.length > 0 ? chips : <span className="lp-demo-summary-empty">A title is enough. Extras are optional.</span>}
        </div>
        {errors.length > 0 ? (
          <p className="lp-demo-error">
            {errors[0]!.message}
            {unknownPerson ? '. This demo team is Priya, Marcus, Lena, Tom and Aiko.' : '.'}
          </p>
        ) : null}

        <div className="lp-demo-actions">
          <div className="lp-demo-examples" role="group" aria-label="Examples">
            <span className="lp-demo-examples-label" aria-hidden="true">Try</span>
            {CAPTURE_EXAMPLES.map((example) => (
              <button key={example.label} type="button" className="lp-demo-example" onClick={() => tryExample(example.text)}>
                {example.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="lp-demo-submit"
            disabled={!canCapture}
            onClick={() => {
              takeOver();
              capture(text);
            }}
          >
            Capture
            <CornerDownLeft size={13} aria-hidden="true" />
          </button>
        </div>
        <p id={hintId} className="lp-demo-note">
          A working demo of LeadOS capture. It runs in your browser and saves nothing.
        </p>
      </div>

      <TodayMini today={today} plan={plan} waiting={waiting} message={message} />
    </div>
  );
}

function TodayMini({ today, plan, waiting, message }: { today: string; plan: PlanRow[]; waiting: WaitingRow[]; message: string }) {
  return (
    <div className="lp-demo-today" role="group" aria-label="Today, with the demo team">
      <div className="lp-demo-today-head">
        <span className="lp-demo-today-title">Today</span>
        <span className="lp-demo-today-date">{format(parseISO(today), 'EEE d MMM')}</span>
        <span className="lp-r-stage"><StatusDot tone="accent" />Morning</span>
      </div>

      <p className="lp-demo-message" role="status" aria-live="polite">{message}</p>

      <div className="lp-demo-today-grid">
        <section>
          <ReplicaLabel count={plan.length}>My plan</ReplicaLabel>
          <ul className="lp-r-list">
            <AnimatePresence initial={false}>
              {plan.map((row) => (
                <motion.li
                  key={row.key}
                  layout="position"
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
                  className="lp-r-row"
                  data-fresh={row.fresh || undefined}
                >
                  <span className="lp-r-glyph" aria-hidden="true">
                    {row.pinned ? <Pin size={12} /> : row.meeting ? <Users size={12} /> : <span className="lp-r-ring" />}
                  </span>
                  <span className="lp-r-main">
                    <span className="lp-r-title">{row.title}</span>
                    <span className="lp-r-meta"><TaskKey>{row.key}</TaskKey>{row.pinned ? ' · pinned' : row.meeting ? ' · meeting' : ' · today'}</span>
                  </span>
                  {row.high ? <Flag size={12} className="lp-r-flag" aria-label="High priority" /> : null}
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        </section>

        <section>
          <ReplicaLabel count={waiting.length}>Waiting on others</ReplicaLabel>
          <ul className="lp-r-list">
            <AnimatePresence initial={false}>
              {waiting.map((row) => (
                <motion.li
                  key={row.key}
                  layout="position"
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
                  className="lp-r-row"
                  data-fresh={row.fresh || undefined}
                >
                  <span className="lp-r-glyph lp-r-glyph-wait" aria-hidden="true"><Hourglass size={12} /></span>
                  <span className="lp-r-main">
                    <span className="lp-r-title">{row.title}</span>
                    <span className="lp-r-meta"><TaskKey>{row.key}</TaskKey> · {row.meta}</span>
                  </span>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>

          <ReplicaLabel count={2}>Needs you</ReplicaLabel>
          <ul className="lp-r-list">
            <li className="lp-r-row">
              <span className="lp-r-glyph" aria-hidden="true"><StatusDot tone="danger" /></span>
              <span className="lp-r-main">
                <span className="lp-r-title">Marcus is blocked</span>
                <span className="lp-r-meta">Staging credentials expired</span>
              </span>
              <FakeAction>Follow up</FakeAction>
            </li>
            <li className="lp-r-row">
              <span className="lp-r-glyph" aria-hidden="true"><StatusDot tone="warning" /></span>
              <span className="lp-r-main">
                <span className="lp-r-title">1:1 with Lena</span>
                <span className="lp-r-meta">6 days overdue</span>
              </span>
              <FakeAction>Open 1:1</FakeAction>
            </li>
          </ul>
        </section>
      </div>
    </div>
  );
}
