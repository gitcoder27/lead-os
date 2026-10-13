import { format, parseISO } from 'date-fns';
import { Disclosure } from '@/components/ui/Disclosure';
import { RepeatMeetingDialog } from './RepeatMeetingDialog';
import { navigateToMeeting, backFromMeeting } from '@/lib/meeting-nav';
import { useMeetingCapture } from '@/hooks/useMeetingCapture';
import { MeetingActions } from './MeetingActions';
import { MeetingSavedActions } from './MeetingSavedActions';
import { useEffect, useRef, useState } from 'react';
import { useAuth, useAuthScopeKey } from '@/context/AuthContext';
import { useMeetingDocument } from '@/hooks/useMeetingDocument';
import { useDevelopers } from '@/hooks/useDevelopers';
import { NoteEditor, type NoteEditorHandle } from '@/components/notes/editor/NoteEditor';
import type { NoteEditorHandlers } from '@/components/notes/editor/note-editor-extensions';
import { TaskDrawer } from '@/components/tasks/TaskDrawer';
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
  const capture = useMeetingCapture(taskKey, editor);
  const locked = capture.isPending || Boolean(capture.pending);
  const noteRef = useRef<NoteEditorHandle>(null);
  const developers = useDevelopers(undefined, { includeUnavailable: true });
  const { features } = useAuth();
  const [drawer, setDrawer] = useState<string | null>(null);
  const [repeatOpen, setRepeatOpen] = useState(false);
  const submit = async (options: Parameters<typeof capture.submit>[0]) => {
    const result = await capture.submit(options);
    if (result?.operation === 'meeting-repeat' && result.task) { setRepeatOpen(false); navigateToMeeting(result.task.taskKey); }
  };
  const data = editor.query.data;
  const bridge = data ? oneOnOnePerson(data.task, developers.data ?? []) : null;
  const bridgeAccountId = bridge?.accountId;
  useEffect(() => {
    if (!bridgeAccountId || !features?.oneOnOne) return;
    window.history.replaceState(window.history.state, '', oneOnOneHref(bridgeAccountId));
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, [bridgeAccountId, features?.oneOnOne]);
  const addAction = () => {
    if (locked) return;
    const text = noteRef.current?.captureActionSource()?.text.trim();
    if (text && text.length <= 4000 && editor.body.actions.length < 30) editor.change({ ...editor.body, actions: [...editor.body.actions, { id: crypto.randomUUID(), text }] });
  };
  const handlers: NoteEditorHandlers = {
    openTask: setDrawer, openIssue: () => {}, openDeveloper: () => {}, openNoteDate: () => {},
    previewTask: async () => null, previewIssue: async () => null, searchTasks: async () => [], searchIssues: async () => [],
    onAction: addAction, onWrapUp: () => {}, onSave: () => { void editor.flush(); },
  };
  if (!data) return <div className="meeting-page"><button className="ui-btn-ghost" onClick={backFromMeeting}>Back</button>{editor.query.isError ? <div role="alert"><p>Could not load this meeting.</p><button className="ui-btn-ghost" onClick={() => void editor.query.refetch()}>Retry</button></div> : <p role="status">Loading meeting…</p>}</div>;
  return <div className="meeting-page">
    <div className="meeting-heading"><button className="ui-btn-ghost" onClick={backFromMeeting}>← Back</button><div><p className="meeting-eyebrow">Meeting · {taskKey}</p><h1>{data.task.title}</h1><p className="meeting-muted">{data.task.scheduledOn ? format(parseISO(data.task.scheduledOn), 'EEE · MMM d') : 'Unscheduled'}{data.task.startsAt ? ` · ${new Date(data.task.startsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}{data.task.endsAt ? `–${new Date(data.task.endsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}</p><p className="meeting-muted">{data.task.participants}{data.task.placement ? ` · ${data.task.placement.projectName}` : ''}</p></div><div className="meeting-heading-actions">{data.task.status === 'done' && <button className="ui-btn-ghost" disabled={locked} onClick={() => setRepeatOpen(true)}>Meet again</button>}<button className="ui-btn-ghost" onClick={() => setDrawer(taskKey)}>Meeting properties</button></div></div>
    {bridge && <a className="meeting-bridge" href={oneOnOneHref(bridge.accountId)}>Open the 1:1 workspace with {bridge.displayName}</a>}
    <Disclosure className="meeting-mobile-context" summary="Preparation context"><MeetingContext data={data} retry={() => void editor.query.refetch()} onOpen={setDrawer} /></Disclosure>
    {editor.conflict !== undefined && <section className="meeting-conflict" role="alert"><h2>Reconcile saved changes</h2><p>Your draft stays on this device. Compare it with the saved version before choosing.</p><Disclosure summary="Saved version">{editor.conflict ? <><h3>Agenda</h3><p className="meeting-private-text">{editor.conflict.agenda}</p><h3>Notes</h3><p className="meeting-private-text">{editor.conflict.notes}</p><h3>Outcome</h3><p className="meeting-private-text">{editor.conflict.outcome || (editor.conflict.noDecisions ? 'No decisions to record' : 'None')}</p><h3>Action drafts</h3>{editor.conflict.actions.map((action) => <p key={action.id}>{action.text}</p>)}</> : <p>The saved document was removed.</p>}</Disclosure><button className="ui-btn-ghost" onClick={editor.useSaved}>Use saved version</button><button className="ui-btn-ghost" onClick={editor.keepBoth}>Keep both versions</button><button className="ui-btn-ghost" onClick={editor.keepDraft}>Replace saved version with my draft</button></section>}
    <div className="meeting-columns"><div className="meeting-main"><div ref={(node) => node?.toggleAttribute('inert', locked)}>
      <section><label className="meeting-section-title" htmlFor="meeting-agenda">Agenda</label><textarea id="meeting-agenda" rows={4} maxLength={50000} placeholder="Talking points and questions" value={editor.body.agenda} onChange={(e) => editor.change({ ...editor.body, agenda: e.target.value })} onBlur={() => void editor.flush()} /></section>
      <section><h2>Notes <span className="meeting-muted">Private to you</span></h2><NoteEditor ref={noteRef} value={editor.body.notes} onChange={(notes) => editor.change({ ...editor.body, notes })} onBlur={() => void editor.flush()} handlers={handlers} entityContext={{ developers: developers.data ?? [], refs: new Map() }} placeholder="Record what happened…" ariaLabel="Private meeting notes" selectionClassName="meeting-selection-bubble" omit={['update', 'follow-up', 'wrap-up']} actionsDisabled={locked || editor.conflict !== undefined || editor.body.actions.length >= 30} /><button className="ui-btn-ghost" onMouseDown={(e) => e.preventDefault()} onClick={addAction}>Add selection as action draft</button></section>
      <section><label className="meeting-section-title" htmlFor="meeting-outcome">Outcome</label>{data.task.outcome && !editor.body.outcome && <p className="meeting-muted">Existing outcome: {data.task.outcome}</p>}<textarea id="meeting-outcome" rows={2} maxLength={4000} placeholder="Decisions and next steps" value={editor.body.outcome} onChange={(e) => editor.change({ ...editor.body, outcome: e.target.value })} /><label className="meeting-check"><input type="checkbox" checked={editor.body.noDecisions} onChange={(e) => editor.change({ ...editor.body, noDecisions: e.target.checked })} />No decisions to record</label></section>
      <MeetingSavedActions actions={data.actions} people={developers.data ?? []} onOpen={setDrawer} />
      <MeetingActions actions={editor.body.actions} people={developers.data ?? []} onChange={(actions) => editor.change({ ...editor.body, actions })} />
      </div>
      {capture.problem && <p role="alert">{capture.problem}</p>}
      {capture.diagnostics && <div role="alert">{capture.diagnostics.diagnostics.map((d, i) => <p key={i}>{d.message}</p>)}{capture.diagnostics.confirmRequired && <><button className="ui-btn-ghost" onClick={() => void submit({ confirm: true })}>Confirm and submit actions</button><button className="ui-btn-ghost" onClick={capture.cancelConfirmation}>Edit drafts</button></>}</div>}
      <footer className="meeting-footer"><div><span role="status" aria-live="polite">{editor.status}</span>{editor.error && <p role="alert">{editor.error} <button className="ui-btn-ghost" onClick={() => void editor.retry()}>Retry save</button></p>}{!editor.recoveryAvailable && <p role="alert">Draft recovery is unavailable on this device.</p>}</div><button className="ui-btn-solid" disabled={capture.isPending || editor.conflict !== undefined || Boolean(capture.diagnostics?.confirmRequired)} onClick={() => void submit({})}>{capture.isPending ? 'Saving meeting…' : capture.pending ? 'Retry submission' : data.task.status === 'done' ? editor.body.actions.length ? `Save outcome and create ${editor.body.actions.length} ${editor.body.actions.length === 1 ? 'action' : 'actions'}` : 'Save outcome' : 'Finish meeting'}</button></footer>
    </div><aside className="meeting-desktop-context" aria-label="Preparation context"><MeetingContext data={data} retry={() => void editor.query.refetch()} onOpen={setDrawer} /></aside></div>
    {repeatOpen && <RepeatMeetingDialog busy={capture.isPending} onClose={() => setRepeatOpen(false)} onRepeat={(options) => void submit({ operation: 'meeting-repeat', ...options })} />}
    <TaskDrawer taskKey={drawer} onClose={() => setDrawer(null)} onNavigateTask={setDrawer} />
  </div>;
}
