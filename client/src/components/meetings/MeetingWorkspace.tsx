import { useRef, useState } from 'react';
import { useAuthScopeKey } from '@/context/AuthContext';
import { useMeetingDocument } from '@/hooks/useMeetingDocument';
import { useDevelopers } from '@/hooks/useDevelopers';
import { NoteEditor, type NoteEditorHandle } from '@/components/notes/editor/NoteEditor';
import type { NoteEditorHandlers } from '@/components/notes/editor/note-editor-extensions';
import { TaskDrawer } from '@/components/tasks/TaskDrawer';
import { backFromMeeting } from '@/lib/meeting-nav';
import { oneOnOneHref, oneOnOnePerson } from '@/lib/one-on-one-link';
import { MeetingContext } from './MeetingContext';
import '../notes/notes.css';
import './meetings.css';

export function MeetingWorkspace({ taskKey }: { taskKey: string }) {
  const scope = useAuthScopeKey();
  return <MeetingWorkspaceDocument key={`${scope}:${taskKey}`} taskKey={taskKey} />;
}
function MeetingWorkspaceDocument({ taskKey }: { taskKey: string }) {
  const editor = useMeetingDocument(taskKey);
  const noteRef = useRef<NoteEditorHandle>(null);
  const developers = useDevelopers();
  const [drawer, setDrawer] = useState<string | null>(null);
  const data = editor.query.data;
  const addAction = () => {
    const text = noteRef.current?.captureActionSource()?.text.trim();
    if (text) editor.change({ ...editor.body, actions: [...editor.body.actions, { id: crypto.randomUUID(), text }] });
  };
  const handlers: NoteEditorHandlers = {
    openTask: setDrawer, openIssue: () => {}, openDeveloper: () => {}, openNoteDate: () => {},
    previewTask: async () => null, previewIssue: async () => null, searchTasks: async () => [], searchIssues: async () => [],
    onAction: addAction, onWrapUp: () => {}, onSave: () => { void editor.flush(); },
  };
  if (!data) return <main className="meeting-page"><button className="ui-btn-ghost" onClick={backFromMeeting}>Back</button>{editor.query.isError ? <div role="alert"><p>Could not load this meeting.</p><button className="ui-btn-ghost" onClick={() => void editor.query.refetch()}>Retry</button></div> : <p role="status">Loading meeting…</p>}</main>;
  const bridge = oneOnOnePerson(data.task, developers.data ?? []);
  return <main className="meeting-page" id="main">
    <div className="meeting-heading"><button className="ui-btn-ghost" onClick={backFromMeeting}>← Back</button><div><p className="meeting-eyebrow">Meeting · {taskKey}</p><h1>{data.task.title}</h1><p className="meeting-muted">{data.task.scheduledOn ?? 'Unscheduled'}{data.task.startsAt ? ` · ${new Date(data.task.startsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}{data.task.endsAt ? `–${new Date(data.task.endsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}</p><p className="meeting-muted">{data.task.participants}{data.task.placement ? ` · ${data.task.placement.projectName}` : ''}</p></div><button className="ui-btn-ghost" onClick={() => setDrawer(taskKey)}>Meeting properties</button></div>
    {bridge && <a className="meeting-bridge" href={oneOnOneHref(bridge.accountId)}>Open the 1:1 workspace with {bridge.displayName}</a>}
    <details className="meeting-mobile-context"><summary>Preparation context</summary><MeetingContext data={data} retry={() => void editor.query.refetch()} onOpen={setDrawer} /></details>
    {editor.conflict !== undefined && <section className="meeting-conflict" role="alert"><h2>Reconcile saved changes</h2><p>Your draft stays on this device. Compare it with the saved version before choosing.</p><details><summary>Saved version</summary><pre>{JSON.stringify(editor.conflict, null, 2)}</pre></details><button className="ui-btn-ghost" onClick={editor.useSaved}>Use saved version</button><button className="ui-btn-ghost" onClick={editor.keepDraft}>Replace saved version with my draft</button></section>}
    <div className="meeting-columns"><div className="meeting-main">
      <section><label className="meeting-section-title" htmlFor="meeting-agenda">Agenda</label><textarea id="meeting-agenda" rows={4} maxLength={50000} placeholder="Talking points and questions" value={editor.body.agenda} onChange={(e) => editor.change({ ...editor.body, agenda: e.target.value })} onBlur={() => void editor.flush()} /></section>
      <section><h2>Notes <span className="meeting-muted">Private to you</span></h2><NoteEditor ref={noteRef} value={editor.body.notes} onChange={(notes) => editor.change({ ...editor.body, notes })} onBlur={() => void editor.flush()} handlers={handlers} entityContext={{ developers: developers.data ?? [], refs: new Map() }} placeholder="Record what happened…" ariaLabel="Private meeting notes" omit={['update', 'follow-up', 'wrap-up']} actionsDisabled={editor.conflict !== undefined} /><button className="ui-btn-ghost" onMouseDown={(e) => e.preventDefault()} onClick={addAction}>Add selection as action draft</button></section>
      <section><label className="meeting-section-title" htmlFor="meeting-outcome">Outcome</label>{data.task.outcome && !editor.body.outcome && <p className="meeting-muted">Existing outcome: {data.task.outcome}</p>}<textarea id="meeting-outcome" rows={2} maxLength={4000} placeholder="Decisions and next steps" value={editor.body.outcome} onChange={(e) => editor.change({ ...editor.body, outcome: e.target.value })} /><label className="meeting-check"><input type="checkbox" checked={editor.body.noDecisions} onChange={(e) => editor.change({ ...editor.body, noDecisions: e.target.checked })} />No decisions to record</label></section>
      <section><h2>Actions <span className="meeting-muted">Private drafts until submitted</span></h2>{editor.body.actions.map((action, index) => <div className="meeting-action" key={action.id}><label>Action {index + 1}<input aria-label={`Action ${index + 1}`} value={action.text} onChange={(e) => editor.change({ ...editor.body, actions: editor.body.actions.map((row) => row.id === action.id ? { ...row, text: e.target.value } : row) })} /></label><button className="ui-btn-ghost" onClick={() => editor.change({ ...editor.body, actions: editor.body.actions.filter((row) => row.id !== action.id) })}>Remove action {index + 1}</button></div>)}<button className="ui-btn-ghost" onClick={() => editor.change({ ...editor.body, actions: [...editor.body.actions, { id: crypto.randomUUID(), text: 'New action' }] })}>Add action</button></section>
      <footer className="meeting-footer"><div><span role="status" aria-live="polite">{editor.status}</span>{editor.error && <p role="alert">{editor.error} <button className="ui-btn-ghost" onClick={() => void editor.retry()}>Retry save</button></p>}{!editor.recoveryAvailable && <p role="alert">Draft recovery is unavailable on this device.</p>}</div></footer>
    </div><aside className="meeting-desktop-context" aria-label="Preparation context"><MeetingContext data={data} retry={() => void editor.query.refetch()} onOpen={setDrawer} /></aside></div>
    <TaskDrawer taskKey={drawer} onClose={() => setDrawer(null)} onNavigateTask={setDrawer} />
  </main>;
}
