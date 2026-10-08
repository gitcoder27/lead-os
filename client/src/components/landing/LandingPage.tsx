import { MotionConfig } from 'framer-motion';
import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { DatabaseBackup, Lock, Moon, Sun, UserRound } from 'lucide-react';
import { LeadOSMark } from '@/components/brand/LeadOSMark';
import { CopilotMark } from '@/components/brand/CopilotMark';
import { SignInForm, type SignInMode } from '@/components/auth/SignInForm';
import { Avatar } from '@/components/ui/Avatar';
import { Dialog } from '@/components/ui/Dialog';
import { Kbd } from '@/components/ui/Kbd';
import { useTheme } from '@/context/ThemeContext';
import { ACCESS_REQUEST_URL } from '@/lib/landing-config';
import { CaptureDemo } from './CaptureDemo';
import { CopilotShowcase } from './CopilotShowcase';
import { DayTour } from './DayTour';
import { StatusDot, TaskKey } from './replica';
import './landing.css';

const PAGE_TITLE = 'LeadOS: the daily workspace for engineering managers';

interface LandingPageProps {
  /** `/login` opens the page with the sign-in dialog already up. */
  initialSignInOpen?: boolean;
}

/**
 * The public front door at `/` for anyone without a session: what LeadOS is,
 * who it's for and why, with sign-in one click away in the top right. It reads
 * no workspace data; the only network call it can make is the sign-in itself.
 */
export function LandingPage({ initialSignInOpen = false }: LandingPageProps) {
  const [signInOpen, setSignInOpen] = useState(initialSignInOpen);
  const scrollRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const previous = document.title;
    document.title = PAGE_TITLE;
    return () => { document.title = previous; };
  }, []);

  const openSignIn = () => setSignInOpen(true);
  const closeSignIn = () => {
    setSignInOpen(false);
    // `/login` opened the dialog; once it is dismissed the page is just `/`.
    if (window.location.pathname.startsWith('/login')) window.history.replaceState(null, '', '/');
  };

  const onScroll = () => {
    const header = headerRef.current;
    const scroller = scrollRef.current;
    if (header && scroller) header.dataset.scrolled = scroller.scrollTop > 8 ? 'true' : 'false';
  };

  return (
    <MotionConfig reducedMotion="user">
      <div ref={scrollRef} className="lp" data-landing-scroll onScroll={onScroll}>
        <a className="lp-skip" href="#lp-main" onClick={(event) => jumpTo(event, 'lp-main')}>Skip to content</a>
        <LandingHeader headerRef={headerRef} onSignIn={openSignIn} />

        <main id="lp-main" tabIndex={-1}>
          <Hero onSignIn={openSignIn} />
          <FiveQuestions />
          <CopilotSection />
          <DaySection />
          <TeamSection />
          <PrivacySection />
          <ClosingSection onSignIn={openSignIn} />
        </main>

        <LandingFooter onSignIn={openSignIn} />
      </div>

      {signInOpen ? <SignInDialog onClose={closeSignIn} /> : null}
    </MotionConfig>
  );
}

/** In-page links scroll the landing container (the app shell locks the body). */
function jumpTo(event: MouseEvent<HTMLAnchorElement>, id: string) {
  const target = document.getElementById(id);
  if (!target) return;
  event.preventDefault();
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  target.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  const focusTarget = target.matches('[tabindex]') ? target : target.querySelector<HTMLElement>('[tabindex="-1"]');
  focusTarget?.focus({ preventScroll: true });
}

function SectionLink({ to, children }: { to: string; children: ReactNode }) {
  return <a href={`#${to}`} onClick={(event) => jumpTo(event, to)}>{children}</a>;
}

function LandingHeader({ headerRef, onSignIn }: { headerRef: React.RefObject<HTMLElement>; onSignIn: () => void }) {
  const { theme, toggleTheme } = useTheme();
  const nextTheme = theme === 'dark' ? 'light' : 'dark';
  return (
    <header ref={headerRef} className="lp-header" data-scrolled="false">
      <div className="lp-wrap lp-header-row">
        <a href="/" className="lp-brand" aria-label="LeadOS home" onClick={(event) => jumpTo(event, 'lp-top')}>
          <span className="lp-brand-mark"><LeadOSMark size={22} /></span>
          <span className="lp-brand-name">LeadOS</span>
        </a>
        <nav className="lp-nav" aria-label="Sections">
          <SectionLink to="copilot">Copilot</SectionLink>
          <SectionLink to="day">A day in LeadOS</SectionLink>
          <SectionLink to="team">Your team</SectionLink>
          <SectionLink to="privacy">Privacy</SectionLink>
        </nav>
        <div className="lp-header-actions">
          <button type="button" className="lp-icon-btn" onClick={toggleTheme} aria-label={`Switch to ${nextTheme} theme`} title={`Switch to ${nextTheme} theme`}>
            {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
          </button>
          <button type="button" className="lp-btn lp-btn-primary lp-btn-sm" onClick={onSignIn}>
            Sign in
          </button>
        </div>
      </div>
    </header>
  );
}

function PrimaryCtas({ onSignIn, secondary }: { onSignIn: () => void; secondary: ReactNode }) {
  return (
    <div className="lp-ctas">
      {ACCESS_REQUEST_URL ? (
        <a className="lp-btn lp-btn-primary" href={ACCESS_REQUEST_URL} target={ACCESS_REQUEST_URL.startsWith('https:') ? '_blank' : undefined} rel="noreferrer">
          Request access
        </a>
      ) : (
        <button type="button" className="lp-btn lp-btn-primary" onClick={onSignIn}>Sign in</button>
      )}
      {secondary}
    </div>
  );
}

function Hero({ onSignIn }: { onSignIn: () => void }) {
  return (
    <section id="lp-top" className="lp-hero" aria-labelledby="lp-hero-title">
      <div className="lp-hero-glow" aria-hidden="true" />
      <div className="lp-wrap lp-hero-grid">
        <div className="lp-hero-copy">
          <h1 id="lp-hero-title" className="lp-display">Lead your team without losing the thread.</h1>
          <p className="lp-lede">
            LeadOS is the daily workspace for engineering managers. Your plan, your people, the promises you made and your
            team’s Jira work live in one place, from the morning plan to the Friday update. Copilot is one keystroke
            away when you’d rather ask than click.
          </p>
          <PrimaryCtas
            onSignIn={onSignIn}
            secondary={<a className="lp-btn lp-btn-secondary" href="#day" onClick={(event) => jumpTo(event, 'day')}>See a day in LeadOS</a>}
          />
          {ACCESS_REQUEST_URL ? (
            <p className="lp-returning">
              Already have a workspace? <button type="button" className="lp-text-btn" onClick={onSignIn}>Sign in</button>
            </p>
          ) : null}
        </div>
        <div className="lp-hero-demo">
          <CaptureDemo />
        </div>
      </div>
    </section>
  );
}

const QUESTIONS: { question: string; answer: string; where: string }[] = [
  {
    question: 'Who needs me?',
    answer: 'Today’s queue holds only the exceptions: someone blocked, a 1:1 that slipped, a check-by date that arrived. When nothing needs you, it says so.',
    where: 'Today',
  },
  {
    question: 'What’s stuck?',
    answer: 'Blocked and at-risk work carries its reason, and the first action offered is a follow-up with that reason attached.',
    where: 'Today and Team',
  },
  {
    question: 'What changed?',
    answer: 'Standup shows each person’s changes since the last round, grouped by task, so you hear the news instead of the recap.',
    where: 'Standup',
  },
  {
    question: 'What did I promise?',
    answer: 'Every “I’ll get back to you” becomes a task in one line. Waiting items know who they wait on and when to check.',
    where: 'Tasks',
  },
  {
    question: 'What’s next?',
    answer: 'Your plan opens with up to three pins. Whatever you don’t finish moves to tomorrow in one step.',
    where: 'Today',
  },
];

function SectionHead({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <div className="lp-section-head">
      <h2 id={`${id}-title`} className="lp-h2" tabIndex={-1}>{title}</h2>
      <p className="lp-lede">{children}</p>
    </div>
  );
}

function FiveQuestions() {
  return (
    <section id="questions" className="lp-section" aria-labelledby="questions-title">
      <div className="lp-wrap">
        <SectionHead id="questions" title="Every morning starts with the same five questions.">
          Most managers answer them from memory, chat scrollback and a row of Jira tabs. LeadOS answers them on one
          screen, before standup.
        </SectionHead>
        <dl className="lp-questions">
          {QUESTIONS.map((entry) => (
            <div key={entry.question} className="lp-question">
              <dt className="lp-question-q">{entry.question}</dt>
              <dd className="lp-question-a">{entry.answer}</dd>
              <dd className="lp-question-where">{entry.where}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

const COPILOT_POINTS: { title: string; body: string }[] = [
  {
    title: 'Answers from your data',
    body: 'It reads Today, the team board, your tasks, notes, 1:1 agendas and Jira before it answers, and shows you what it looked at.',
  },
  {
    title: 'Acts when you say so',
    body: 'Capture a task, add a 1:1 topic, update a note, carry work forward or change a Jira field. Each change arrives as a card, and nothing happens until you confirm.',
  },
  {
    title: 'Knows where you are',
    body: 'Open it on Team and it starts from your team; on Tasks, from your follow-ups. It suggests the next question when it’s done.',
  },
  {
    title: 'Remembers how you work',
    body: 'Tell it once that Priya prefers async updates or that deploys are on Fridays, and it keeps that in mind next time.',
  },
];

function CopilotSection() {
  return (
    <section id="copilot" className="lp-section lp-copilot" aria-labelledby="copilot-title">
      <div className="lp-copilot-glow" aria-hidden="true" />
      <div className="lp-wrap lp-copilot-grid">
        <div className="lp-copilot-copy">
          <p className="lp-copilot-badge">
            <CopilotMark size={14} />
            Copilot
          </p>
          <h2 id="copilot-title" className="lp-h2" tabIndex={-1}>Or just ask. Copilot already knows your day.</h2>
          <p className="lp-lede">
            Ask the way you’d ask a chief of staff: who needs you, what slipped, what to cover in a 1:1. Copilot answers
            from your own workspace, and does the follow-through when you confirm it.
          </p>
          <p className="lp-copilot-powered">Powered by Claude Sonnet 5.5</p>
        </div>
        <CopilotShowcase />
      </div>
      <div className="lp-wrap">
        <ul className="lp-copilot-points">
          {COPILOT_POINTS.map((point) => (
            <li key={point.title}>
              <h3 className="lp-h4">{point.title}</h3>
              <p className="lp-body">{point.body}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function DaySection() {
  return (
    <section id="day" className="lp-section lp-section-tinted" aria-labelledby="day-title">
      <div className="lp-wrap">
        <SectionHead id="day" title="One day, start to finish.">
          LeadOS follows the rhythm you already keep. Here is where it shows up.
        </SectionHead>
        <DayTour />
        <div className="lp-keys">
          <p className="lp-keys-title">Everything has a key.</p>
          <ul className="lp-keys-list">
            <li><Kbd>⌘K</Kbd>Jump to anything</li>
            <li><Kbd>⌘I</Kbd>Capture</li>
            <li><Kbd>⌘J</Kbd>Ask Copilot</li>
            <li><Kbd>?</Kbd>See every shortcut</li>
          </ul>
        </div>
      </div>
    </section>
  );
}

function TeamSection() {
  return (
    <section id="team" className="lp-section" aria-labelledby="team-title">
      <div className="lp-wrap">
        <SectionHead id="team" title="Works with the team you have.">
          Nobody else has to sign up for LeadOS to make it useful on day one.
        </SectionHead>

        <div className="lp-modes">
          <div className="lp-mode">
            <h3 className="lp-h3">Just me</h3>
            <p className="lp-body">
              You keep the board yourself. Freshness counts from the last time you touched someone’s work, so nobody
              looks stale for skipping a tool they never signed into.
            </p>
            <TeamRow name="Priya Nair" seed="priya" work="Payment retry backoff" signal="Last touched 2d ago" />
          </div>
          <div className="lp-mode">
            <h3 className="lp-h3">Me and my team</h3>
            <p className="lp-body">
              Engineers get My Day: their current task, their plan and a quick check-in. What they update lands on your
              Team board and in standup.
            </p>
            <TeamRow name="Priya Nair" seed="priya" work="Payment retry backoff" signal="Checked in 09:12" />
          </div>
        </div>

        <div className="lp-jira">
          <div className="lp-jira-copy">
            <h3 className="lp-h3">Jira, when you want it.</h3>
            <p className="lp-body">
              Connect Jira and your defects sync into Work, with triage, tags, workload and alerts. Leave it unconnected
              and Work stays out of your navigation. Everything else works the same.
            </p>
          </div>
          <figure className="lp-replica lp-jira-table" aria-label="Jira defects in Work">
            <JiraRow issue="PAY-415" title="Checkout fails on saved cards" priority="P1" owner="No owner" tone="danger" />
            <JiraRow issue="PAY-412" title="Login times out behind SSO" priority="P2" owner="Marcus · due Mon" tone="warning" />
            <JiraRow issue="PAY-398" title="Retry storms during failover" priority="P2" owner="Resolved" tone="success" />
          </figure>
        </div>
      </div>
    </section>
  );
}

function TeamRow({ name, seed, work, signal }: { name: string; seed: string; work: string; signal: string }) {
  return (
    <div className="lp-replica lp-team-row" aria-label={`Team board row for ${name}`} role="group">
      <Avatar name={name} seed={seed} size={28} />
      <span className="lp-team-row-person">
        <span className="lp-r-title">{name}</span>
        <span className="lp-r-meta"><StatusDot tone="success" /> On track</span>
      </span>
      <span className="lp-team-row-work">
        <span className="lp-r-title">{work}</span>
        <span className="lp-r-meta"><TaskKey>T-150</TaskKey></span>
      </span>
      <span className="lp-team-row-signal">{signal}</span>
    </div>
  );
}

function JiraRow({ issue, title, priority, owner, tone }: { issue: string; title: string; priority: string; owner: string; tone: 'danger' | 'warning' | 'success' }) {
  return (
    <div className="lp-jira-row">
      <TaskKey>{issue}</TaskKey>
      <span className="lp-r-title">{title}</span>
      <span className="lp-jira-priority" data-tone={tone}>{priority}</span>
      <span className="lp-r-meta">{owner}</span>
    </div>
  );
}

const PRIVACY: { icon: ReactNode; title: string; body: string }[] = [
  {
    icon: <Lock size={18} />,
    title: 'Your notes are yours.',
    body: 'Daily notes, 1:1 records and the notes you keep on each person are visible to you alone.',
  },
  {
    icon: <UserRound size={18} />,
    title: 'Engineers see their own work.',
    body: 'My Day shows what is assigned to them. Your plans for the rest of the team stay with you.',
  },
  {
    icon: <CopilotMark size={18} />,
    title: 'Copilot asks first.',
    body: 'Every change Copilot proposes shows exactly what will change, and nothing happens until you confirm it.',
  },
  {
    icon: <DatabaseBackup size={18} />,
    title: 'Backups you can take with you.',
    body: 'Scheduled snapshots, a Back up now button and a download for every snapshot, all in Settings.',
  },
];

function PrivacySection() {
  return (
    <section id="privacy" className="lp-section" aria-labelledby="privacy-title">
      <div className="lp-wrap">
        <SectionHead id="privacy" title="Private where it matters.">
          What a lead writes about people is not team data. LeadOS keeps it that way.
        </SectionHead>
        <ul className="lp-privacy">
          {PRIVACY.map((entry) => (
            <li key={entry.title} className="lp-privacy-item">
              <span className="lp-privacy-icon" aria-hidden="true">{entry.icon}</span>
              <h3 className="lp-h4">{entry.title}</h3>
              <p className="lp-body">{entry.body}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function ClosingSection({ onSignIn }: { onSignIn: () => void }) {
  return (
    <section id="start" className="lp-section lp-closing" aria-labelledby="start-title">
      <div className="lp-wrap">
        <div className="lp-closing-grid">
          <div>
            <h2 id="start-title" className="lp-h2">Start tomorrow with a plan.</h2>
            <p className="lp-lede">
              {ACCESS_REQUEST_URL
                ? 'LeadOS workspaces are set up by invitation. Request one, or sign in if you already have a workspace.'
                : 'LeadOS workspaces are set up by invitation. If you have one, sign in and pick up where you left off.'}
            </p>
            <PrimaryCtas
              onSignIn={onSignIn}
              secondary={ACCESS_REQUEST_URL ? <button type="button" className="lp-btn lp-btn-secondary" onClick={onSignIn}>Sign in</button> : null}
            />
          </div>
          <div className="lp-closing-mark" aria-hidden="true">
            <LeadOSMark size={144} />
          </div>
        </div>
      </div>
    </section>
  );
}

function LandingFooter({ onSignIn }: { onSignIn: () => void }) {
  return (
    <footer className="lp-footer">
      <div className="lp-wrap lp-footer-row">
        <span className="lp-footer-brand">
          <LeadOSMark size={18} />
          <span>LeadOS</span>
          <span className="lp-footer-tagline">The daily workspace for engineering managers.</span>
        </span>
        <nav className="lp-footer-links" aria-label="Sign in">
          <button type="button" className="lp-footer-link" onClick={onSignIn}>Sign in</button>
          <a className="lp-footer-link" href="/my-day">Engineers: open My Day</a>
        </nav>
        <span className="lp-footer-copy">© {new Date().getFullYear()} LeadOS</span>
      </div>
    </footer>
  );
}

function SignInDialog({ onClose }: { onClose: () => void }) {
  const [mode, setMode] = useState<SignInMode>('sign-in');
  return (
    <Dialog
      title={mode === 'sign-in' ? 'Sign in to LeadOS' : 'Change your password'}
      icon={<LeadOSMark size={18} />}
      size="sm"
      onClose={onClose}
    >
      <SignInForm onModeChange={setMode} footnote="Managers and engineers both sign in here." />
    </Dialog>
  );
}
