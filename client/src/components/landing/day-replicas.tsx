import { Check, ClipboardCopy, Download, Flag, Hourglass, Lock, Pin, Repeat } from 'lucide-react';
import { Avatar } from '@/components/ui/Avatar';
import { Kbd } from '@/components/ui/Kbd';
import { FakeAction, ReplicaFrame, ReplicaLabel, StatusDot, TaskKey } from './replica';

/** 08:45 — Today in the morning: my plan with pins, the queue, today's 1:1s. */
export function PlanReplica() {
  return (
    <ReplicaFrame label="Today in the morning: my plan, the queue and today’s 1:1s" className="lp-replica-split">
      <div className="lp-r-pane">
        <div className="lp-r-bar">
          <span className="lp-r-stage"><StatusDot tone="accent" />Morning</span>
          <span className="lp-r-bar-title">Thu 8 Oct</span>
          <span className="lp-r-bar-note">Standup at 09:30</span>
        </div>
        <ReplicaLabel count={5}>My plan</ReplicaLabel>
        <ul className="lp-r-list">
          <PlanRow pinned title="Finalize the Q4 hiring plan" meta="T-131" note="due today" />
          <PlanRow pinned title="Review the caching design doc" meta="T-136" />
          <PlanRow pinned title="Draft release notes for 2.4" meta="T-140" />
          <PlanRow title="Expense report for the offsite" meta="T-118" note="from Tue" />
          <PlanRow title="Prep skip-level talking points" meta="T-145" />
        </ul>
      </div>
      <div className="lp-r-pane lp-r-pane-side">
        <ReplicaLabel count={3}>Queue</ReplicaLabel>
        <ul className="lp-r-list">
          <QueueRow tone="danger" title="Marcus is blocked" meta="Staging credentials expired" action="Follow up" />
          <QueueRow tone="warning" title="Check-by today: load test results" meta="Waiting on Tom since Mon" action="Check in" />
          <QueueRow tone="warning" title="PAY-415 has no owner" meta="P1 defect, synced from Jira" action="Assign" />
        </ul>
        <ReplicaLabel count={1}>1:1s</ReplicaLabel>
        <ul className="lp-r-list">
          <QueueRow tone="muted" title="1:1 with Lena Okafor" meta="Today, 14:00" action="Open 1:1" />
        </ul>
      </div>
    </ReplicaFrame>
  );
}

function PlanRow({ title, meta, note, pinned = false }: { title: string; meta: string; note?: string; pinned?: boolean }) {
  return (
    <li className="lp-r-row">
      <span className="lp-r-glyph" aria-hidden="true">{pinned ? <Pin size={12} /> : <span className="lp-r-ring" />}</span>
      <span className="lp-r-main">
        <span className="lp-r-title">{title}</span>
        <span className="lp-r-meta"><TaskKey>{meta}</TaskKey>{note ? <span className="lp-r-warn"> · {note}</span> : null}</span>
      </span>
      <FakeAction tone="quiet">Done</FakeAction>
    </li>
  );
}

function QueueRow({ tone, title, meta, action }: { tone: 'danger' | 'warning' | 'muted'; title: string; meta: string; action: string }) {
  return (
    <li className="lp-r-row">
      <span className="lp-r-glyph" aria-hidden="true"><StatusDot tone={tone} /></span>
      <span className="lp-r-main">
        <span className="lp-r-title">{title}</span>
        <span className="lp-r-meta">{meta}</span>
      </span>
      <FakeAction>{action}</FakeAction>
    </li>
  );
}

const STANDUP_PEOPLE = [
  { id: 'priya', name: 'Priya Nair', visited: true },
  { id: 'marcus', name: 'Marcus Webb', visited: true },
  { id: 'lena', name: 'Lena Okafor', current: true },
  { id: 'tom', name: 'Tom Becker' },
  { id: 'aiko', name: 'Aiko Tanaka' },
];

/** 09:30 — Standup mode: the rail, one person's work, what changed, the key bar. */
export function StandupReplica() {
  return (
    <ReplicaFrame label="Standup mode: one person at a time, with what changed since the last round" className="lp-replica-standup">
      <div className="lp-r-standup-top">
        <span className="lp-r-bar-title">Standup</span>
        <span className="lp-r-progress" aria-hidden="true"><span style={{ width: '40%' }} /></span>
        <span className="lp-r-bar-note">2 of 5 visited</span>
      </div>
      <div className="lp-r-standup-body">
        <ol className="lp-r-rail">
          {STANDUP_PEOPLE.map((person) => (
            <li key={person.id} className="lp-r-rail-row" data-current={person.current || undefined}>
              <Avatar name={person.name} seed={person.id} size={20} ring={person.current} />
              <span className="lp-r-rail-name">{person.name}</span>
              {person.visited ? <Check size={12} className="lp-r-tick" aria-label="Visited" /> : null}
            </li>
          ))}
        </ol>
        <div className="lp-r-pane">
          <div className="lp-r-person">
            <span className="lp-r-person-name">Lena Okafor</span>
            <span className="lp-r-pill" data-tone="success">On track</span>
          </div>
          <ReplicaLabel count={3}>Work</ReplicaLabel>
          <ul className="lp-r-list">
            <li className="lp-r-row lp-r-row-current">
              <span className="lp-r-glyph" aria-hidden="true"><span className="lp-r-ring lp-r-ring-active" /></span>
              <span className="lp-r-main">
                <span className="lp-r-title">Payment retry backoff</span>
                <span className="lp-r-meta"><TaskKey>T-150</TaskKey> · PR up for review</span>
              </span>
              <span className="lp-r-tag">Current</span>
            </li>
            <li className="lp-r-row">
              <span className="lp-r-glyph" aria-hidden="true"><span className="lp-r-ring" /></span>
              <span className="lp-r-main">
                <span className="lp-r-title">On-call rota proposal</span>
                <span className="lp-r-meta"><TaskKey>T-152</TaskKey> · new since yesterday</span>
              </span>
            </li>
            <li className="lp-r-row">
              <span className="lp-r-glyph" aria-hidden="true"><span className="lp-r-ring" /></span>
              <span className="lp-r-main">
                <span className="lp-r-title">Flaky checkout test</span>
                <span className="lp-r-meta"><TaskKey>T-147</TaskKey></span>
              </span>
            </li>
          </ul>
        </div>
        <div className="lp-r-pane lp-r-pane-side lp-r-changes">
          <ReplicaLabel>Changes</ReplicaLabel>
          <ul className="lp-r-feed">
            <li><span className="lp-r-feed-what"><TaskKey>T-150</TaskKey> Open → Active</span><span className="lp-r-feed-when">1d</span></li>
            <li><span className="lp-r-feed-what">Update: “PR up, needs a second reviewer”</span><span className="lp-r-feed-when">18h</span></li>
            <li><span className="lp-r-feed-what"><TaskKey>T-149</TaskKey> Active → Done</span><span className="lp-r-feed-when">20h</span></li>
          </ul>
        </div>
      </div>
      <div className="lp-r-keys" aria-label="Standup keys">
        <span><Kbd>→</Kbd>Next</span>
        <span><Kbd>c</Kbd>Note</span>
        <span><Kbd>f</Kbd>Flag</span>
        <span><Kbd>e</Kbd>Done</span>
        <span><Kbd>b</Kbd>Blocked</span>
        <span><Kbd>w</Kbd>Wrap-up</span>
      </div>
    </ReplicaFrame>
  );
}

/** 14:00 — a 1:1: the agenda that carried over, private notes, actions as tasks. */
export function OneOnOneReplica() {
  return (
    <ReplicaFrame label="A 1:1 with an agenda that carries over, private notes and actions that become tasks" className="lp-replica-split">
      <div className="lp-r-pane">
        <div className="lp-r-person">
          <Avatar name="Lena Okafor" seed="lena" size={22} />
          <span className="lp-r-person-name">1:1 with Lena Okafor</span>
          <span className="lp-r-bar-note">Every other Thursday</span>
        </div>
        <ReplicaLabel count={3}>Agenda</ReplicaLabel>
        <ul className="lp-r-list">
          <li className="lp-r-row">
            <span className="lp-r-glyph" aria-hidden="true"><Repeat size={12} /></span>
            <span className="lp-r-main">
              <span className="lp-r-title">Tech lead track: what good looks like</span>
              <span className="lp-r-meta">Carried from Sep 24</span>
            </span>
          </li>
          <li className="lp-r-row">
            <span className="lp-r-glyph" aria-hidden="true"><span className="lp-r-ring" /></span>
            <span className="lp-r-main">
              <span className="lp-r-title">Owning the on-call rota</span>
              <span className="lp-r-meta">From your note on Tue</span>
            </span>
          </li>
          <li className="lp-r-row">
            <span className="lp-r-glyph" aria-hidden="true"><span className="lp-r-ring" /></span>
            <span className="lp-r-main">
              <span className="lp-r-title">Feedback on Monday’s design review</span>
            </span>
          </li>
        </ul>
        <ReplicaLabel count={2}>Actions</ReplicaLabel>
        <ul className="lp-r-list">
          <li className="lp-r-row">
            <span className="lp-r-glyph" aria-hidden="true"><span className="lp-r-ring" /></span>
            <span className="lp-r-main">
              <span className="lp-r-title">Share the TL expectations doc</span>
              <span className="lp-r-meta"><TaskKey>T-153</TaskKey> · You · Fri</span>
            </span>
          </li>
          <li className="lp-r-row">
            <span className="lp-r-glyph" aria-hidden="true"><span className="lp-r-ring" /></span>
            <span className="lp-r-main">
              <span className="lp-r-title">Draft the on-call proposal</span>
              <span className="lp-r-meta"><TaskKey>T-154</TaskKey> · Lena · visible to Lena in My Day</span>
            </span>
          </li>
        </ul>
      </div>
      <div className="lp-r-pane lp-r-pane-side">
        <ReplicaLabel>Notes</ReplicaLabel>
        <p className="lp-r-private"><Lock size={11} aria-hidden="true" />Private to you</p>
        <div className="lp-r-notes">
          <p>Wants more design ownership; pair her with Marcus on the caching work.</p>
          <p>Energy is good. Mentioned the release crunch twice; check workload next week.</p>
        </div>
      </div>
    </ReplicaFrame>
  );
}

/** 17:30 — wrap-up: what is still open, move the rest, done today, the EOD note. */
export function WrapUpReplica() {
  return (
    <ReplicaFrame label="Wrap-up: move what’s left to tomorrow and see what got done" className="lp-replica-split">
      <div className="lp-r-pane">
        <div className="lp-r-bar">
          <span className="lp-r-stage" data-tone="warning"><StatusDot tone="warning" />Wrap-up</span>
          <span className="lp-r-bar-title">Thu 8 Oct</span>
        </div>
        <div className="lp-r-wrap-actions">
          <FakeAction>Move the rest to tomorrow · 2</FakeAction>
          <FakeAction tone="quiet">Write EOD note</FakeAction>
        </div>
        <ReplicaLabel count={2}>Still open today</ReplicaLabel>
        <ul className="lp-r-list">
          <WrapRow title="Prep skip-level talking points" taskKey="T-145" />
          <WrapRow title="Expense report for the offsite" taskKey="T-118" note="from Tue" />
        </ul>
      </div>
      <div className="lp-r-pane lp-r-pane-side">
        <ReplicaLabel count={4}>Done today</ReplicaLabel>
        <ul className="lp-r-list">
          {['Finalize the Q4 hiring plan', 'Review the caching design doc', 'Draft release notes for 2.4', 'Unblock Marcus on staging'].map((title) => (
            <li key={title} className="lp-r-row lp-r-row-done">
              <span className="lp-r-glyph" aria-hidden="true"><Check size={12} /></span>
              <span className="lp-r-main"><span className="lp-r-title">{title}</span></span>
            </li>
          ))}
        </ul>
      </div>
    </ReplicaFrame>
  );
}

function WrapRow({ title, taskKey, note }: { title: string; taskKey: string; note?: string }) {
  return (
    <li className="lp-r-row">
      <span className="lp-r-glyph" aria-hidden="true"><span className="lp-r-ring" /></span>
      <span className="lp-r-main">
        <span className="lp-r-title">{title}</span>
        <span className="lp-r-meta"><TaskKey>{taskKey}</TaskKey>{note ? ` · ${note}` : null}</span>
      </span>
      <span className="lp-r-row-actions">
        <FakeAction>Done</FakeAction>
        <FakeAction tone="quiet">Tomorrow</FakeAction>
        <FakeAction tone="quiet">Drop</FakeAction>
      </span>
    </li>
  );
}

const REVIEW_STEPS = ['Look back', 'Waiting', 'Loose ends', 'People', 'Next week', 'Send update'];

/** Friday — the weekly review's last step: the update, ready to paste. */
export function WeeklyReviewReplica() {
  return (
    <ReplicaFrame label="The weekly review ends with an update for your manager, ready to paste" className="lp-replica-review">
      <ol className="lp-r-steps">
        {REVIEW_STEPS.map((step, index) => (
          <li key={step} data-state={index < 5 ? 'done' : 'current'}>
            {index < 5 ? <Check size={11} aria-hidden="true" /> : <span className="lp-r-step-dot" aria-hidden="true" />}
            {step}
          </li>
        ))}
      </ol>
      <div className="lp-r-pane">
        <div className="lp-r-bar">
          <span className="lp-r-bar-title">Your weekly update</span>
          <span className="lp-r-bar-note">Week of Oct 5</span>
        </div>
        <div className="lp-r-update">
          <p className="lp-r-update-h">Shipped</p>
          <ul>
            <li>Payment retry backoff is live for all regions <TaskKey>PAY-398</TaskKey></li>
            <li>SSO rollout reached 40% of tenants</li>
            <li>Q4 hiring plan approved: two backend roles</li>
          </ul>
          <p className="lp-r-update-h">Next week</p>
          <ul>
            <li>SSO rollout to 100%, pending security sign-off</li>
            <li>Lena starts the on-call rota proposal</li>
          </ul>
          <p className="lp-r-update-h">Blocked &amp; risks</p>
          <ul>
            <li><Hourglass size={11} aria-hidden="true" className="lp-r-inline-icon" />Load test environment down since Tue (Tom)</li>
            <li><Flag size={11} aria-hidden="true" className="lp-r-inline-icon" />2 P1 defects open past their due date</li>
          </ul>
        </div>
        <div className="lp-r-wrap-actions">
          <FakeAction><ClipboardCopy size={12} aria-hidden="true" />Copy for Teams</FakeAction>
          <FakeAction tone="quiet"><Download size={12} aria-hidden="true" />CSV</FakeAction>
        </div>
      </div>
    </ReplicaFrame>
  );
}
