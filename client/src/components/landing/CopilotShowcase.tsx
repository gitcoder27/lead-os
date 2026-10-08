import { motion } from 'framer-motion';
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowUp, Check, ClipboardList, ListPlus } from 'lucide-react';
import { format, nextFriday, isFriday } from 'date-fns';
import { CopilotMark } from '@/components/brand/CopilotMark';
import { Kbd } from '@/components/ui/Kbd';

interface ConfirmProposal {
  icon: ReactNode;
  summary: string;
  target: string;
  rows: [string, string][];
}

interface Conversation {
  id: string;
  prompt: string;
  /** What Copilot read before answering, as the dock's tool chips say it. */
  reads: string[];
  answer: ReactNode;
  proposal?: ConfirmProposal;
  followups: string[];
}

function checkByFriday(): string {
  const today = new Date();
  return format(isFriday(today) ? today : nextFriday(today), 'EEE, MMM d');
}

/** Scripted exchanges over the same fictional team as the hero demo. */
function useConversations(): Conversation[] {
  return useMemo(() => [
    {
      id: 'brief',
      prompt: 'Brief me on today',
      reads: ['Read today snapshot', 'Read team board'],
      answer: (
        <>
          <p>Three things need you before standup:</p>
          <ul>
            <li><strong>Marcus is blocked.</strong> Staging credentials expired yesterday; nobody has picked it up.</li>
            <li><strong>Tom’s load test results</strong> were due back today.</li>
            <li><strong>Your 1:1 with Lena</strong> is 6 days overdue. She raised on-call ownership in your notes on Tue.</li>
          </ul>
          <p>Your plan has three pins, and the Q4 hiring plan is due today.</p>
        </>
      ),
      followups: ['Draft a nudge for Tom', 'Prep my 1:1 with Lena'],
    },
    {
      id: 'one-on-one',
      prompt: 'Prep my 1:1 with Lena',
      reads: ['Read 1:1 agenda', 'Read Lena’s day', 'Read daily notes'],
      answer: (
        <>
          <p>Worth covering today:</p>
          <ul>
            <li>Carried from Sep 24: the tech lead track and what good looks like.</li>
            <li>Since last time she shipped <span className="lp-r-key">T-149</span> and moved payment retries to review.</li>
            <li>Your note from Tue: she wants to own the on-call rota. It isn’t on the agenda yet.</li>
          </ul>
        </>
      ),
      proposal: {
        icon: <ListPlus size={14} />,
        summary: 'Add a topic to the 1:1 agenda',
        target: '1:1 with Lena Okafor',
        rows: [['Topic', 'Owning the on-call rota']],
      },
      followups: ['What did Lena ship this month?'],
    },
    {
      id: 'waiting',
      prompt: 'Remind me to chase Tom about the load test on Friday',
      reads: ['Read team board'],
      answer: <p>I’ll track it as waiting on Tom, so it comes back to Today on Friday if he hasn’t replied.</p>,
      proposal: {
        icon: <ClipboardList size={14} />,
        summary: 'Capture a task',
        target: 'Chase the load test results',
        rows: [['Waiting on', 'Tom Becker'], ['Check by', checkByFriday()]],
      },
      followups: ['What else is waiting on Tom?'],
    },
  ], []);
}

/**
 * The Copilot section's demo: pick a question, see the dock answer it from
 * the workspace and propose a change for confirmation. Scripted, never sent.
 */
export function CopilotShowcase() {
  const conversations = useConversations();
  const [activeId, setActiveId] = useState(conversations[0]!.id);
  const switched = useRef(false);
  const active = conversations.find((entry) => entry.id === activeId) ?? conversations[0]!;

  const pick = (id: string) => {
    switched.current = true;
    setActiveId(id);
  };

  // Each step of the answer lands in turn after a switch; the first view is already complete.
  const step = (index: number) => switched.current
    ? { initial: { opacity: 0, y: 6 }, animate: { opacity: 1, y: 0 }, transition: { delay: index * 0.22, duration: 0.3, ease: [0.16, 1, 0.3, 1] as const } }
    : { initial: false as const };

  return (
    <div className="lp-copilot-demo">
      <div className="lp-copilot-prompts" role="group" aria-label="Ask Copilot">
        <span className="lp-demo-examples-label" aria-hidden="true">Ask</span>
        {conversations.map((entry) => (
          <button
            key={entry.id}
            type="button"
            className="lp-demo-example"
            aria-pressed={entry.id === active.id}
            onClick={() => pick(entry.id)}
          >
            {entry.prompt}
          </button>
        ))}
      </div>

      <figure className="lp-replica lp-copilot-dock" aria-label={`Copilot answering “${active.prompt}”`}>
        <div className="lp-copilot-head">
          <span className="lp-copilot-tile" aria-hidden="true"><CopilotMark size={16} /></span>
          <span className="lp-copilot-head-text">
            <span className="lp-r-bar-title">Copilot</span>
            <span className="lp-r-bar-note">viewing: Today</span>
          </span>
          <Kbd variant="subtle">⌘J</Kbd>
        </div>

        <div className="lp-copilot-thread" key={active.id} aria-live="polite">
          <motion.p className="lp-copilot-user" {...step(0)}>{active.prompt}</motion.p>
          <motion.div className="lp-copilot-reads" {...step(1)}>
            {active.reads.map((read) => (
              <span key={read} className="lp-copilot-chip"><Check size={11} aria-hidden="true" />{read}</span>
            ))}
          </motion.div>
          <motion.div className="lp-copilot-answer" {...step(2)}>{active.answer}</motion.div>
          {active.proposal ? (
            <motion.div className="lp-copilot-confirm" {...step(3)}>
              <span className="lp-copilot-confirm-icon" aria-hidden="true">{active.proposal.icon}</span>
              <div className="min-w-0 flex-1">
                <p className="lp-copilot-confirm-summary">{active.proposal.summary}</p>
                <p className="lp-copilot-confirm-target">{active.proposal.target}</p>
                <dl className="lp-copilot-confirm-rows">
                  {active.proposal.rows.map(([label, value]) => (
                    <div key={label}><dt>{label}</dt><dd>{value}</dd></div>
                  ))}
                </dl>
                <span className="lp-copilot-confirm-actions" aria-hidden="true">
                  <span className="lp-copilot-confirm-yes">Confirm</span>
                  <span className="lp-copilot-confirm-no">Cancel</span>
                </span>
              </div>
            </motion.div>
          ) : null}
          <motion.div className="lp-copilot-followups" {...step(active.proposal ? 4 : 3)}>
            {active.followups.map((followup) => <span key={followup} className="lp-copilot-followup">{followup}</span>)}
          </motion.div>
        </div>

        <div className="lp-copilot-composer" aria-hidden="true">
          <span className="lp-copilot-input">Ask about your team, work, or desk…</span>
          <span className="lp-copilot-send"><ArrowUp size={14} /></span>
        </div>
      </figure>
    </div>
  );
}
