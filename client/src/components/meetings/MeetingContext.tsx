import { useState } from 'react';
import type { ManagerTask, MeetingWorkspaceResponse } from '@/types';
import { navigateToMeeting } from '@/lib/meeting-nav';

function ContextTasks({ title, rows, onOpen }: { title: string; rows: ManagerTask[]; onOpen: (key: string) => void }) {
  const [more, setMore] = useState(false);
  return <section className="meeting-context-group"><h3>{title} <span>{rows.length}</span></h3>
    {rows.length ? (more ? rows : rows.slice(0, 5)).map((row) => <button className="meeting-context-row" key={row.taskKey} onClick={() => onOpen(row.taskKey)}><span>{row.taskKey}</span>{row.title}</button>) : <p className="meeting-muted">None</p>}
    {rows.length > 5 && <button className="ui-btn-ghost" onClick={() => setMore(!more)}>{more ? 'Show less' : `Show more (${rows.length - 5})`}</button>}
  </section>;
}
export function MeetingContext({ data, retry, onOpen }: { data: MeetingWorkspaceResponse; retry: () => void; onOpen: (key: string) => void }) {
  const [moreIssues, setMoreIssues] = useState(false);
  const context = data.context;
  if (!context) return <div role="status"><p>{data.contextError}</p><button className="ui-btn-ghost" onClick={retry}>Retry context</button></div>;
  return <>
    <section className="meeting-context-group"><h3>Last meeting</h3>{context.previous ? <><p className="meeting-private-text">{context.previous.outcome || (context.previous.noDecisions ? 'No decisions to record' : 'No outcome recorded')}</p><button className="ui-btn-ghost" onClick={() => navigateToMeeting(context.previous!.taskKey)}>Open previous meeting</button></> : <p className="meeting-muted">No previous meeting linked</p>}</section>
    <ContextTasks title="Open actions" rows={context.openActions} onOpen={onOpen} />
    <ContextTasks title="People commitments" rows={context.commitments} onOpen={onOpen} />
    <ContextTasks title="Relevant blockers" rows={context.blockers} onOpen={onOpen} />
    {context.issues.length > 0 && <section className="meeting-context-group"><h3>Linked Jira work <span>{context.issues.length}</span></h3>{(moreIssues ? context.issues : context.issues.slice(0, 5)).map((issue) => <p key={issue.key}>{issue.key} · {issue.summary}<br /><span className="meeting-muted">{issue.status}</span></p>)}{context.issues.length > 5 && <button className="ui-btn-ghost" onClick={() => setMoreIssues(!moreIssues)}>{moreIssues ? 'Show less' : `Show more (${context.issues.length - 5})`}</button>}</section>}
  </>;
}
