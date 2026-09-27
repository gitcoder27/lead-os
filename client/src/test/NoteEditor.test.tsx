import { createRef } from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { acceptCompletion, currentCompletions, startCompletion } from '@codemirror/autocomplete';
import { EditorView } from '@codemirror/view';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NoteEditor, type NoteEditorHandle } from '@/components/notes/editor/NoteEditor';
import type { NoteEditorHandlers, NoteEntityContext } from '@/components/notes/editor/note-editor-extensions';

// jsdom has no layout; CodeMirror only needs these to exist.
const rangeProto = Range.prototype as unknown as Record<string, unknown>;
const originals = { getClientRects: rangeProto.getClientRects, getBoundingClientRect: rangeProto.getBoundingClientRect };

beforeAll(() => {
  rangeProto.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] });
  rangeProto.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) });
});

afterAll(() => {
  rangeProto.getClientRects = originals.getClientRects;
  rangeProto.getBoundingClientRect = originals.getBoundingClientRect;
});

/** CodeMirror ignores accepts for 75ms after the list opens (mis-click guard). */
const pastInteractionDelay = () => new Promise((resolve) => setTimeout(resolve, 90));

function makeHandlers(): NoteEditorHandlers {
  return {
    openTask: vi.fn(),
    openIssue: vi.fn(),
    openDeveloper: vi.fn(),
    openNoteDate: vi.fn(),
    previewTask: vi.fn(async () => null),
    previewIssue: vi.fn(async () => null),
    searchTasks: vi.fn(async () => []),
    searchIssues: vi.fn(async () => []),
    onAction: vi.fn(),
    onWrapUp: vi.fn(),
    onSave: vi.fn(),
  };
}

const context: NoteEntityContext = {
  developers: [{ accountId: 'dev-1', displayName: 'Deepak Singh' }],
  refs: new Map([['T-84', { status: 'in_progress', title: 'Ship the API review' }]]),
};

function renderEditor(value: string, overrides: Partial<NoteEditorHandlers> = {}) {
  const handlers = { ...makeHandlers(), ...overrides };
  const onChange = vi.fn();
  const ref = createRef<NoteEditorHandle>();
  const utils = render(
    <NoteEditor
      ref={ref}
      value={value}
      onChange={onChange}
      onBlur={vi.fn()}
      handlers={handlers}
      entityContext={context}
      placeholder="Write"
      ariaLabel="Notes for today"
    />,
  );
  const content = utils.container.querySelector('.cm-content') as HTMLElement;
  const view = EditorView.findFromDOM(content)!;
  return { ...utils, handlers, onChange, ref, view, content };
}

describe('NoteEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the markdown body as the document and labels the editor', () => {
    const { view, content } = renderEditor('# Plan\n- [ ] call vendor');
    expect(view.state.doc.toString()).toBe('# Plan\n- [ ] call vendor');
    expect(content).toHaveAttribute('aria-label', 'Notes for today');
    expect(content.querySelector('input.cm-note-checkbox')).not.toBeNull();
  });

  it('reports user edits upward but not external value syncs', () => {
    const { view, onChange, rerender, handlers } = renderEditor('hello');
    act(() => view.dispatch({ changes: { from: 5, insert: ' world' } }));
    expect(onChange).toHaveBeenLastCalledWith('hello world');

    onChange.mockClear();
    rerender(
      <NoteEditor
        value={'hello world\nappended by capture'}
        onChange={onChange}
        onBlur={vi.fn()}
        handlers={handlers}
        entityContext={context}
        placeholder="Write"
        ariaLabel="Notes for today"
      />,
    );
    expect(view.state.doc.toString()).toBe('hello world\nappended by capture');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('renders provenance markers as status chips and task keys as entity chips', () => {
    const { content } = renderEditor('- call vendor → T-84\n- ask about T-12 and AM-7 with @Deepak Singh');
    const chip = content.querySelector('[data-provenance="T-84"]');
    expect(chip).not.toBeNull();
    expect(chip).toHaveTextContent('T-84');
    expect(chip).toHaveTextContent('In progress');
    expect(content.querySelector('[data-entity="task"][data-key="T-12"]')).not.toBeNull();
    expect(content.querySelector('[data-entity="issue"][data-key="AM-7"]')).not.toBeNull();
    expect(content.querySelector('[data-entity="person"][data-key="dev-1"]')).not.toBeNull();
  });

  it('opens the task from a provenance chip and a note from a carried marker', () => {
    const { content, handlers } = renderEditor('- a → T-84\n- [ ] b ↩ from 2026-09-26');
    fireEvent.mouseDown(content.querySelector('[data-provenance="T-84"]')!);
    expect(handlers.openTask).toHaveBeenCalledWith('T-84');
    fireEvent.mouseDown(content.querySelector('[data-carried="2026-09-26"]')!);
    expect(handlers.openNoteDate).toHaveBeenCalledWith('2026-09-26');
  });

  it('toggles a checkbox in the markdown text', () => {
    const { content, onChange } = renderEditor('- [ ] call vendor');
    fireEvent.mouseDown(content.querySelector('input.cm-note-checkbox')!);
    expect(onChange).toHaveBeenLastCalledWith('- [x] call vendor');
  });

  it('captures the caret line and appends a provenance marker that follows edits', () => {
    const { view, ref, onChange } = renderEditor('first line\nsecond line');
    act(() => view.dispatch({ selection: { anchor: 3 } }));
    const source = ref.current!.captureActionSource()!;
    expect(source.text).toBe('first line');

    // Typing above the source line shifts it; the marker still lands on it.
    act(() => view.dispatch({ changes: { from: 0, insert: 'new top\n' } }));
    act(() => ref.current!.appendMarker(source, 'T-90'));
    expect(onChange).toHaveBeenLastCalledWith('new top\nfirst line → T-90\nsecond line');
  });

  it('captures a multi-line selection and marks its last line', () => {
    const { view, ref, onChange } = renderEditor('one\ntwo\nthree');
    act(() => view.dispatch({ selection: { anchor: 0, head: 7 } }));
    const source = ref.current!.captureActionSource()!;
    expect(source.text).toBe('one\ntwo');
    act(() => ref.current!.appendMarker(source, 'T-5'));
    expect(onChange).toHaveBeenLastCalledWith('one\ntwo → T-5\nthree');
  });

  it('applies wrap-up line edits, re-finding lines that moved', () => {
    const { view, ref, onChange } = renderEditor('- [ ] a\n- [ ] b');
    act(() => view.dispatch({ changes: { from: 0, insert: 'inserted\n' } }));
    act(() =>
      ref.current!.applyLineEdits([
        { line: 0, raw: '- [ ] a', next: '- [ ] a → 2026-09-28' },
        { line: 1, raw: '- [ ] b', next: '- ~~[ ] b~~' },
      ]),
    );
    expect(onChange).toHaveBeenLastCalledWith('inserted\n- [ ] a → 2026-09-28\n- ~~[ ] b~~');
  });

  it('routes line-action shortcuts and wrap-up without leaking global keys', () => {
    const { content, handlers } = renderEditor('- ship it');
    // jsdom isn't a Mac, so CodeMirror's `Mod` is Ctrl here; keyCode gives it the base key under Shift.
    fireEvent.keyDown(content, { key: 'E', code: 'KeyE', keyCode: 69, ctrlKey: true, shiftKey: true });
    fireEvent.keyDown(content, { key: 'U', code: 'KeyU', keyCode: 85, ctrlKey: true, shiftKey: true });
    fireEvent.keyDown(content, { key: 'L', code: 'KeyL', keyCode: 76, ctrlKey: true, shiftKey: true });
    fireEvent.keyDown(content, { key: 'Enter', code: 'Enter', keyCode: 13, ctrlKey: true });
    expect(handlers.onAction).toHaveBeenNthCalledWith(1, 'task');
    expect(handlers.onAction).toHaveBeenNthCalledWith(2, 'update');
    expect(handlers.onAction).toHaveBeenNthCalledWith(3, 'follow-up');
    expect(handlers.onWrapUp).toHaveBeenCalledTimes(1);

    // ⌘K / ⌘J / ⌘I belong to the app shell — the editor must not consume them.
    for (const key of ['k', 'j', 'i']) {
      const event = new KeyboardEvent('keydown', { key, code: `Key${key.toUpperCase()}`, ctrlKey: true, bubbles: true, cancelable: true });
      content.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    }
    // ⌥↑ is day navigation, not move-line.
    const alt = new KeyboardEvent('keydown', { key: 'ArrowUp', code: 'ArrowUp', altKey: true, bubbles: true, cancelable: true });
    content.dispatchEvent(alt);
    expect(alt.defaultPrevented).toBe(false);
  });

  it('highlights search terms and moves the caret to the first match', () => {
    const { view, ref, content } = renderEditor('intro\nthe vendor contract is late');
    let found = false;
    act(() => {
      found = ref.current!.highlightTerms(['vendor']);
    });
    expect(found).toBe(true);
    expect(view.state.selection.main.head).toBe('intro\nthe '.length);
    expect(content.querySelector('.cm-note-hit')).toHaveTextContent('vendor');
  });

  it('offers slash commands at line start and runs the picked action on that line', async () => {
    const { view, handlers } = renderEditor('- ship it\n/ta');
    act(() => {
      view.focus();
      view.dispatch({ selection: { anchor: view.state.doc.length } });
      startCompletion(view);
    });
    await waitFor(() => expect(currentCompletions(view.state).map((option) => option.label)).toContain('/Task'));
    await pastInteractionDelay();
    act(() => {
      acceptCompletion(view);
    });
    expect(view.state.doc.toString()).toBe('- ship it\n');
    expect(handlers.onAction).toHaveBeenCalledWith('task');
  });

  it('completes @mentions from the team roster', async () => {
    const { view } = renderEditor('ask @Dee');
    act(() => {
      view.focus();
      view.dispatch({ selection: { anchor: view.state.doc.length } });
      startCompletion(view);
    });
    await waitFor(() => expect(currentCompletions(view.state).map((option) => option.label)).toEqual(['@Deepak Singh']));
    await pastInteractionDelay();
    act(() => {
      acceptCompletion(view);
    });
    expect(view.state.doc.toString()).toBe('ask @Deepak Singh ');
  });

  it('completes T- keys from task search', async () => {
    const searchTasks = vi.fn(async () => [{ taskKey: 'T-84', title: 'Ship the API review' }]);
    const { view } = renderEditor('see T-8', { searchTasks });
    act(() => {
      view.focus();
      view.dispatch({ selection: { anchor: view.state.doc.length } });
      startCompletion(view);
    });
    await waitFor(() => expect(currentCompletions(view.state).map((option) => option.label)).toEqual(['T-84']));
    expect(searchTasks).toHaveBeenCalledWith('T-8');
    await pastInteractionDelay();
    act(() => {
      acceptCompletion(view);
    });
    expect(view.state.doc.toString()).toBe('see T-84');
  });

  it('renders list markers in one gutter with a hanging indent', () => {
    const { content } = renderEditor('- bullet\n1. ordered\n- [ ] task\n  - nested');
    const lines = [...content.querySelectorAll<HTMLElement>('.cm-line')];
    expect(lines.map((line) => line.querySelector('.cm-note-marker')?.className)).toEqual([
      'cm-note-marker bullet',
      'cm-note-marker ordered',
      'cm-note-marker task',
      'cm-note-marker bullet',
    ]);
    expect(lines[0]!.style.paddingLeft).toBe('1.6em');
    expect(lines[0]!.style.textIndent).toBe('-1.6em');
    // Two columns of indentation nest one level deeper.
    expect(lines[3]!.style.paddingLeft).toBe('3.2em');
    expect(lines[1]!.querySelector('.cm-note-marker')).toHaveTextContent('1.');
  });

  it('turns "[] " at the start of a line into a checkbox', () => {
    const { view, onChange } = renderEditor('');
    act(() => {
      view.dispatch({ changes: { from: 0, insert: '[]' }, selection: { anchor: 2 } });
    });
    const handled = view.state.facet(EditorView.inputHandler).some((handler) => handler(view, 2, 2, ' ', () => view.state.update({})));
    expect(handled).toBe(true);
    expect(onChange).toHaveBeenLastCalledWith('- [ ] ');
  });

  it('hints at commands on the focused empty line of a non-empty note', () => {
    const { view, content } = renderEditor('first\n');
    act(() => {
      view.focus();
      view.dispatch({ selection: { anchor: view.state.doc.length } });
    });
    expect(content.querySelector('.cm-note-line-hint')).toHaveTextContent('Type / for commands');
  });

  it('puts the caret at the end when the empty page below the text is clicked', () => {
    const { view, container } = renderEditor('one\ntwo');
    fireEvent.mouseDown(container.querySelector('.notes-editor')!, { button: 0 });
    expect(view.hasFocus).toBe(true);
    expect(view.state.selection.main.head).toBe('one\ntwo'.length);
  });
});

