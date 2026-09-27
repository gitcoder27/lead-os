import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Annotation, EditorSelection, EditorState, Transaction } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { CalendarClock, ListPlus, SquarePlus } from 'lucide-react';
import {
  NOTE_ACTION_SHORTCUTS,
  noteEditorExtensions,
  setEntityContext,
  setSearchHighlight,
  type NoteEditorHandlers,
  type NoteEntityContext,
  type NoteLineAction,
} from './note-editor-extensions';
import { appendProvenance } from '@/lib/note-markdown';

/** Where a line action came from: the text, and a position that follows edits. */
export interface NoteActionSource {
  text: string;
  anchorId: number;
  selection: { anchor: number; head: number };
}

export interface NoteLineEdit {
  /** 0-based line index at the time the edit was planned. */
  line: number;
  /** Line text at that time — used to re-find the line if the body shifted. */
  raw: string;
  next: string;
}

export interface NoteEditorHandle {
  focus: () => void;
  /** The selection when there is one, otherwise the caret line. */
  captureActionSource: () => NoteActionSource | null;
  /** F7: write `→ <key>` onto the source line (autosaves like any edit). */
  appendMarker: (source: NoteActionSource, key: string) => void;
  applyLineEdits: (edits: NoteLineEdit[]) => void;
  restoreSelection: (source: NoteActionSource | null) => void;
  /** Scroll to and briefly highlight search terms (F12). Returns false when nothing matched. */
  highlightTerms: (terms: string[]) => boolean;
  /** Move the caret to the first line matching `predicate` and scroll it into view. */
  revealLine: (predicate: (text: string) => boolean) => boolean;
}

interface NoteEditorProps {
  value: string;
  onChange: (next: string) => void;
  onBlur: () => void;
  handlers: NoteEditorHandlers;
  entityContext: NoteEntityContext;
  placeholder: string;
  ariaLabel: string;
  /** Hide the selection bubble's actions (e.g. while a conflict is unresolved). */
  actionsDisabled?: boolean;
  mobile?: boolean;
}

const External = Annotation.define<boolean>();

/** Minimal replacement between two strings so selections and anchors map cleanly. */
function diffRange(prev: string, next: string): { from: number; to: number; insert: string } | null {
  if (prev === next) return null;
  let start = 0;
  const max = Math.min(prev.length, next.length);
  while (start < max && prev.charCodeAt(start) === next.charCodeAt(start)) start += 1;
  let endPrev = prev.length;
  let endNext = next.length;
  while (endPrev > start && endNext > start && prev.charCodeAt(endPrev - 1) === next.charCodeAt(endNext - 1)) {
    endPrev -= 1;
    endNext -= 1;
  }
  return { from: start, to: endPrev, insert: next.slice(start, endNext) };
}

const BUBBLE_ACTIONS: Array<{ action: NoteLineAction; label: string; icon: typeof ListPlus }> = [
  { action: 'task', label: 'Task', icon: SquarePlus },
  { action: 'update', label: 'Update', icon: ListPlus },
  { action: 'follow-up', label: 'Follow-up', icon: CalendarClock },
];

export const NoteEditor = forwardRef<NoteEditorHandle, NoteEditorProps>(function NoteEditor(
  { value, onChange, onBlur, handlers, entityContext, placeholder, ariaLabel, actionsDisabled = false, mobile = false },
  ref,
) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onBlurRef = useRef(onBlur);
  onBlurRef.current = onBlur;
  const anchorsRef = useRef(new Map<number, number>());
  const nextAnchorRef = useRef(1);
  const pointerDownRef = useRef(false);
  // The last body this editor reported upward — echoes of it are not external.
  const emittedRef = useRef(value);
  const [bubble, setBubble] = useState<{ top: number; left: number } | null>(null);

  const updateBubble = (view: EditorView) => {
    const selection = view.state.selection.main;
    if (selection.empty || !view.hasFocus || pointerDownRef.current) {
      setBubble(null);
      return;
    }
    view.requestMeasure({
      read: () => {
        const start = view.coordsAtPos(selection.from);
        const end = view.coordsAtPos(selection.to);
        return start && end ? { start, end } : null;
      },
      write: (coords) => {
        if (!coords) {
          setBubble(null);
          return;
        }
        // Above the selection (clear of the OS text menu on touch devices,
        // docs/52 §4.4); below only when there's no room above.
        const top = coords.start.top - 42 >= 8 ? coords.start.top - 42 : coords.end.bottom + 8;
        const left = Math.max(8, Math.min(coords.start.left, window.innerWidth - 248));
        setBubble({ top, left });
      },
    });
  };

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: value,
        extensions: [
          noteEditorExtensions({ getHandlers: () => handlersRef.current, placeholder, ariaLabel }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              for (const [id, pos] of anchorsRef.current) {
                anchorsRef.current.set(id, update.changes.mapPos(pos, -1));
              }
              const external = update.transactions.some((tr) => tr.annotation(External));
              if (!external) {
                const next = update.state.doc.toString();
                emittedRef.current = next;
                onChangeRef.current(next);
              }
            }
            if (update.selectionSet || update.focusChanged || update.geometryChanged || update.docChanged) {
              updateBubble(update.view);
            }
          }),
          EditorView.domEventHandlers({
            blur: () => {
              onBlurRef.current();
              return false;
            },
            pointerdown: () => {
              pointerDownRef.current = true;
              setBubble(null);
              return false;
            },
          }),
        ],
      }),
    });
    viewRef.current = view;
    const release = () => {
      if (!pointerDownRef.current) return;
      pointerDownRef.current = false;
      updateBubble(view);
    };
    window.addEventListener('pointerup', release);
    view.dispatch({ effects: setEntityContext.of(entityContext) });
    return () => {
      window.removeEventListener('pointerup', release);
      view.destroy();
      viewRef.current = null;
    };
    // The view is created once per mount; value/context sync below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // External body changes (merge rebase, keep-both, saved version) patch the
  // doc in place so the caret survives.
  useLayoutEffect(() => {
    const view = viewRef.current;
    if (!view || value === emittedRef.current) return;
    emittedRef.current = value;
    const change = diffRange(view.state.doc.toString(), value);
    if (!change) return;
    view.dispatch({
      changes: change,
      annotations: [External.of(true), Transaction.addToHistory.of(false)],
    });
  }, [value]);

  useEffect(() => {
    viewRef.current?.dispatch({ effects: setEntityContext.of(entityContext) });
  }, [entityContext]);

  useImperativeHandle(
    ref,
    (): NoteEditorHandle => ({
      focus: () => viewRef.current?.focus(),
      captureActionSource: () => {
        const view = viewRef.current;
        if (!view) return null;
        const { state } = view;
        const selection = state.selection.main;
        const lastLine = state.doc.lineAt(selection.to);
        const text = selection.empty
          ? state.doc.lineAt(selection.head).text
          : state.sliceDoc(selection.from, selection.to);
        const anchorId = nextAnchorRef.current;
        nextAnchorRef.current += 1;
        anchorsRef.current.set(anchorId, lastLine.to);
        return { text, anchorId, selection: { anchor: selection.anchor, head: selection.head } };
      },
      appendMarker: (source, key) => {
        const view = viewRef.current;
        const pos = anchorsRef.current.get(source.anchorId);
        anchorsRef.current.delete(source.anchorId);
        if (!view || pos === undefined) return;
        const line = view.state.doc.lineAt(Math.min(pos, view.state.doc.length));
        const next = appendProvenance(line.text, key);
        if (next === line.text) return;
        view.dispatch({ changes: { from: line.from, to: line.to, insert: next }, userEvent: 'input.provenance' });
      },
      applyLineEdits: (edits) => {
        const view = viewRef.current;
        if (!view || edits.length === 0) return;
        const { doc } = view.state;
        const used = new Set<number>();
        const changes: Array<{ from: number; to: number; insert: string }> = [];
        for (const edit of edits) {
          let target: number | null = null;
          if (edit.line + 1 <= doc.lines && doc.line(edit.line + 1).text === edit.raw && !used.has(edit.line + 1)) {
            target = edit.line + 1;
          } else {
            for (let n = 1; n <= doc.lines; n += 1) {
              if (!used.has(n) && doc.line(n).text === edit.raw) {
                target = n;
                break;
              }
            }
          }
          if (target === null) continue;
          used.add(target);
          const line = doc.line(target);
          changes.push({ from: line.from, to: line.to, insert: edit.next });
        }
        if (changes.length > 0) view.dispatch({ changes, userEvent: 'input.wrapup' });
      },
      restoreSelection: (source) => {
        const view = viewRef.current;
        if (!view) return;
        requestAnimationFrame(() => {
          view.focus();
          if (source) {
            const length = view.state.doc.length;
            view.dispatch({
              selection: EditorSelection.single(
                Math.min(source.selection.anchor, length),
                Math.min(source.selection.head, length),
              ),
            });
          }
        });
      },
      highlightTerms: (terms) => {
        const view = viewRef.current;
        if (!view || terms.length === 0) return false;
        const text = view.state.doc.toString().toLowerCase();
        let first = -1;
        for (const term of terms) {
          const at = text.indexOf(term.toLowerCase());
          if (at >= 0 && (first < 0 || at < first)) first = at;
        }
        view.dispatch({
          effects: [
            setSearchHighlight.of(terms),
            ...(first >= 0 ? [EditorView.scrollIntoView(first, { y: 'center' })] : []),
          ],
          selection: first >= 0 ? { anchor: first } : undefined,
        });
        return first >= 0;
      },
      revealLine: (predicate) => {
        const view = viewRef.current;
        if (!view) return false;
        const { doc } = view.state;
        for (let n = 1; n <= doc.lines; n += 1) {
          const line = doc.line(n);
          if (predicate(line.text)) {
            view.focus();
            view.dispatch({ selection: { anchor: line.to }, effects: EditorView.scrollIntoView(line.from, { y: 'center' }) });
            return true;
          }
        }
        return false;
      },
    }),
    [],
  );

  return (
    <>
      <div
        ref={hostRef}
        className="notes-editor"
        data-mobile={mobile ? 'true' : undefined}
        // Review #6: the empty page below the text is part of the note — a
        // click there puts the caret at the end, like any notes app.
        onMouseDown={(event) => {
          const view = viewRef.current;
          const target = event.target as HTMLElement;
          if (!view || event.button !== 0 || target.closest('.cm-content, .cm-tooltip, .cm-panels')) return;
          event.preventDefault();
          view.focus();
          const end = view.state.doc.length;
          view.dispatch({ selection: { anchor: end }, effects: EditorView.scrollIntoView(end) });
        }}
      />
      {bubble && !actionsDisabled
        ? createPortal(
            <div
              className="notes-selection-bubble"
              role="toolbar"
              aria-label="Turn selection into"
              style={{ top: bubble.top, left: bubble.left }}
            >
              {BUBBLE_ACTIONS.map(({ action, label, icon: Icon }) => (
                <button
                  key={action}
                  type="button"
                  // Keep the editor focused and the selection intact.
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => handlersRef.current.onAction(action)}
                  title={`${label} (${NOTE_ACTION_SHORTCUTS[action].label})`}
                >
                  <Icon size={12} aria-hidden="true" />
                  {label}
                </button>
              ))}
            </div>,
            document.body,
          )
        : null}
    </>
  );
});
