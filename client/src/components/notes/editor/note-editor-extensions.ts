/**
 * CodeMirror 6 setup for the daily note (docs/52 F1/F7/F8).
 *
 * The document is plain markdown text. Everything "alive" here — rendered
 * headings, checkboxes, entity chips, provenance markers — is a decoration
 * over that text; nothing is serialized differently, so revisions, appends,
 * merges, and FTS search keep working on the exact same string.
 */
import {
  autocompletion,
  completionKeymap,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap, indentLess, indentMore } from '@codemirror/commands';
import { markdownKeymap, markdownLanguage } from '@codemirror/lang-markdown';
import { LanguageSupport, syntaxTree } from '@codemirror/language';
import { search, searchKeymap } from '@codemirror/search';
import { Prec, StateEffect, StateField, type EditorState, type Extension, type Range } from '@codemirror/state';
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  hoverTooltip,
  keymap,
  placeholder as placeholderExt,
  type DecorationSet,
  type KeyBinding,
  type Tooltip,
  type ViewUpdate,
} from '@codemirror/view';
import {
  CARRIED_PATTERN,
  JIRA_KEY_PATTERN,
  PROVENANCE_PATTERN,
  TASK_KEY_PATTERN,
  mentionPattern,
  prettyNoteDate,
  resolveMention,
  toggleCheckbox,
  type NoteDeveloper,
} from '@/lib/note-markdown';
import type { ManagerDeskStatus } from '@/types';

export type NoteLineAction = 'task' | 'update' | 'follow-up';
/** Commands a host surface can leave out (the 1:1 notes have no day wrap-up). */
export type NoteEditorCommand = NoteLineAction | 'wrap-up';

export interface NoteRefStatus {
  status: ManagerDeskStatus;
  title: string;
}

export interface NoteEntityContext {
  developers: NoteDeveloper[];
  /** Live status of tasks this note produced/updated/mentioned, keyed by upper-case task key. */
  refs: Map<string, NoteRefStatus>;
}

export interface NoteEntityPreview {
  title: string;
  meta?: string;
}

/** Everything the editor asks of the surrounding page. Read through a getter so it never reconfigures. */
export interface NoteEditorHandlers {
  openTask: (taskKey: string) => void;
  openIssue: (issueKey: string) => void;
  openDeveloper: (accountId: string) => void;
  openNoteDate: (date: string) => void;
  previewTask: (taskKey: string) => Promise<NoteEntityPreview | null>;
  previewIssue: (issueKey: string) => Promise<NoteEntityPreview | null>;
  searchTasks: (query: string) => Promise<Array<{ taskKey: string; title: string }>>;
  searchIssues: (query: string) => Promise<Array<{ key: string; summary: string }>>;
  onAction: (action: NoteLineAction) => void;
  onWrapUp: () => void;
  onSave: () => void;
}

export const NOTE_ACTION_SHORTCUTS: Record<NoteLineAction, { key: string; label: string }> = {
  // ⌘⇧T is reserved by Chrome/Firefox (reopen closed tab) and never reaches
  // the page, so Create task lives on ⌘⇧E; ⌘⇧T is still bound for browsers
  // that pass it through.
  task: { key: 'Mod-Shift-e', label: '⌘⇧E' },
  update: { key: 'Mod-Shift-u', label: '⌘⇧U' },
  // ⌘⇧F is the page-wide note search (docs/52 F14), so follow-up takes ⌘⇧L.
  'follow-up': { key: 'Mod-Shift-l', label: '⌘⇧L' },
};

// ── Entity context + search highlight state ──────────────────────────

export const setEntityContext = StateEffect.define<NoteEntityContext>();
export const setSearchHighlight = StateEffect.define<string[]>();

const EMPTY_CONTEXT: NoteEntityContext = { developers: [], refs: new Map() };

const entityContextField = StateField.define<NoteEntityContext>({
  create: () => EMPTY_CONTEXT,
  update(value, tr) {
    for (const effect of tr.effects) if (effect.is(setEntityContext)) return effect.value;
    return value;
  },
});

/** Terms from a search result the user opened; cleared on the first edit. */
const searchHighlightField = StateField.define<string[]>({
  create: () => [],
  update(value, tr) {
    for (const effect of tr.effects) if (effect.is(setSearchHighlight)) return effect.value;
    return tr.docChanged ? [] : value;
  },
});

// ── Widgets ───────────────────────────────────────────────────────────

const STATUS_LABELS: Partial<Record<ManagerDeskStatus, string>> = {
  inbox: 'Inbox',
  planned: 'Planned',
  in_progress: 'In progress',
  waiting: 'Waiting',
  backlog: 'Backlog',
  done: 'Done',
  cancelled: 'Dropped',
};

export function statusLabel(status: ManagerDeskStatus): string {
  return STATUS_LABELS[status] ?? status.replace(/_/g, ' ');
}

/**
 * The rendered list marker. It replaces the whole prefix (indent, bullet or
 * number, checkbox, trailing space) and sits in a fixed-width gutter, so
 * bullets, numbers and checkboxes all start their text at the same x and
 * wrapped lines hang under the text (docs/52 review #4).
 */
class ListMarkerWidget extends WidgetType {
  constructor(readonly kind: 'bullet' | 'ordered' | 'task', readonly label: string, readonly checked: boolean) {
    super();
  }
  eq(other: ListMarkerWidget) {
    return other.kind === this.kind && other.label === this.label && other.checked === this.checked;
  }
  toDOM() {
    const marker = document.createElement('span');
    marker.className = `cm-note-marker ${this.kind}`;
    if (this.kind === 'task') {
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = this.checked;
      box.className = 'cm-note-checkbox';
      box.setAttribute('aria-label', this.checked ? 'Mark not done' : 'Mark done');
      marker.append(box);
    } else {
      marker.textContent = this.kind === 'bullet' ? '•' : this.label;
      marker.setAttribute('aria-hidden', 'true');
    }
    return marker;
  }
  ignoreEvent() {
    return false;
  }
}

/** Faint teaching hint on the focused empty line (docs/52 review #8). */
class EmptyLineHintWidget extends WidgetType {
  eq() {
    return true;
  }
  toDOM() {
    const hint = document.createElement('span');
    hint.className = 'cm-note-line-hint';
    hint.setAttribute('aria-hidden', 'true');
    hint.textContent = 'Type / for commands · @ to mention · [] for a checkbox';
    return hint;
  }
  ignoreEvent() {
    return true;
  }
}

const emptyLineHint = Decoration.widget({ widget: new EmptyLineHintWidget(), side: 1 });

/** Marker gutter width and per-column nesting step, in em (see notes.css). */
const MARKER_EM = 1.6;
const INDENT_EM_PER_COLUMN = 0.8;

class ProvenanceWidget extends WidgetType {
  constructor(readonly target: string, readonly ref: NoteRefStatus | null) {
    super();
  }
  eq(other: ProvenanceWidget) {
    return other.target === this.target && other.ref?.status === this.ref?.status && other.ref?.title === this.ref?.title;
  }
  toDOM() {
    const chip = document.createElement('span');
    const isTask = /^T-\d+$/i.test(this.target);
    const key = isTask ? this.target.toUpperCase() : this.target;
    chip.className = `cm-note-provenance${this.ref ? ` status-${this.ref.status}` : ''}${isTask ? '' : ' carried-to'}`;
    chip.dataset.provenance = key;
    chip.setAttribute('role', 'link');
    const arrow = document.createElement('span');
    arrow.className = 'cm-note-provenance-arrow';
    arrow.textContent = '→';
    arrow.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span');
    label.className = 'cm-note-provenance-key';
    label.textContent = isTask ? key : prettyNoteDate(key);
    chip.append(arrow, label);
    if (isTask && this.ref) {
      const dot = document.createElement('span');
      dot.className = 'cm-note-status-dot';
      dot.setAttribute('aria-hidden', 'true');
      const status = document.createElement('span');
      status.className = 'cm-note-provenance-status';
      status.textContent = statusLabel(this.ref.status);
      chip.append(dot, status);
    }
    const description = isTask
      ? `Converted to ${key}${this.ref ? ` · ${this.ref.title} · ${statusLabel(this.ref.status)}` : ''}`
      : `Carried to ${prettyNoteDate(key, 'EEE, MMM d')}`;
    chip.title = description;
    chip.setAttribute('aria-label', description);
    return chip;
  }
  ignoreEvent() {
    return false;
  }
}

class CarriedWidget extends WidgetType {
  constructor(readonly date: string) {
    super();
  }
  eq(other: CarriedWidget) {
    return other.date === this.date;
  }
  toDOM() {
    const chip = document.createElement('span');
    chip.className = 'cm-note-carried';
    chip.dataset.carried = this.date;
    chip.setAttribute('role', 'link');
    chip.setAttribute('aria-label', `Carried from ${prettyNoteDate(this.date, 'EEEE, MMM d')}`);
    chip.title = `Carried from ${prettyNoteDate(this.date, 'EEE, MMM d')} — open that note`;
    chip.textContent = `↩ ${prettyNoteDate(this.date)}`;
    return chip;
  }
  ignoreEvent() {
    return false;
  }
}

const hidden = Decoration.replace({});

// ── Decorations ───────────────────────────────────────────────────────

function activeLines(state: EditorState): Set<number> {
  const lines = new Set<number>();
  for (const range of state.selection.ranges) {
    const first = state.doc.lineAt(range.from).number;
    const last = state.doc.lineAt(range.to).number;
    for (let n = first; n <= last; n += 1) lines.add(n);
  }
  return lines;
}

const HEADING_CLASS: Record<string, string> = {
  ATXHeading1: 'cm-note-h1',
  ATXHeading2: 'cm-note-h2',
  ATXHeading3: 'cm-note-h3',
  ATXHeading4: 'cm-note-h4',
  ATXHeading5: 'cm-note-h4',
  ATXHeading6: 'cm-note-h4',
};

const INLINE_CLASS: Record<string, string> = {
  StrongEmphasis: 'cm-note-strong',
  Emphasis: 'cm-note-em',
  Strikethrough: 'cm-note-strike',
  InlineCode: 'cm-note-code',
};

function buildDecorations(view: EditorView, focused: boolean): DecorationSet {
  const { state } = view;
  const ranges: Range<Decoration>[] = [];
  const active = focused ? activeLines(state) : new Set<number>();
  const context = state.field(entityContextField);
  const terms = state.field(searchHighlightField);
  const mentions = mentionPattern(context.developers);
  const lineOf = (pos: number) => state.doc.lineAt(pos).number;

  for (const { from, to } of view.visibleRanges) {
    // Markdown structure from the syntax tree.
    syntaxTree(state).iterate({
      from,
      to,
      enter(node) {
        const name = node.name;
        const headingClass = HEADING_CLASS[name];
        if (headingClass) {
          ranges.push(Decoration.line({ class: `cm-note-heading ${headingClass}` }).range(state.doc.lineAt(node.from).from));
          return;
        }
        if (name === 'HeaderMark') {
          const line = state.doc.lineAt(node.from);
          if (!active.has(line.number) && node.from === line.from + (line.text.length - line.text.trimStart().length)) {
            const end = Math.min(line.to, node.to + (state.doc.sliceString(node.to, node.to + 1) === ' ' ? 1 : 0));
            ranges.push(hidden.range(node.from, end));
          } else {
            ranges.push(Decoration.mark({ class: 'cm-note-syntax' }).range(node.from, node.to));
          }
          return;
        }
        const inlineClass = INLINE_CLASS[name];
        if (inlineClass) {
          ranges.push(Decoration.mark({ class: inlineClass }).range(node.from, node.to));
          return;
        }
        if (name === 'EmphasisMark' || name === 'StrikethroughMark' || name === 'CodeMark') {
          if (node.to > node.from) {
            ranges.push(
              active.has(lineOf(node.from))
                ? Decoration.mark({ class: 'cm-note-syntax' }).range(node.from, node.to)
                : hidden.range(node.from, node.to),
            );
          }
          return;
        }
        if (name === 'ListMark') {
          const line = state.doc.lineAt(node.from);
          const lead = line.text.length - line.text.trimStart().length;
          // Only markers that open the line (not `>`-quoted lists etc.).
          if (node.from !== line.from + lead) return;
          const markText = state.doc.sliceString(node.from, node.to);
          const after = state.doc.sliceString(node.to, line.to);
          const task = /^[-*+]$/.test(markText) ? /^(\s+)\[([ xX])\](\s+|$)/.exec(after) : null;
          const gap = task ? task[0].length : (/^\s*/.exec(after)?.[0].length ?? 0);
          const textStart = node.to + gap;
          // Raw syntax only while the caret is inside the marker itself, so
          // typing in the item never shifts the text.
          const editingMarker =
            focused && state.selection.ranges.some((range) => range.head >= line.from && range.head < textStart);
          if (editingMarker) {
            ranges.push(Decoration.mark({ class: 'cm-note-syntax' }).range(node.from, node.to));
            return;
          }
          const columns = line.text.slice(0, lead).replace(/\t/g, '    ').length;
          const indent = columns * INDENT_EM_PER_COLUMN;
          ranges.push(
            Decoration.line({
              class: 'cm-note-li',
              attributes: { style: `padding-left: ${indent + MARKER_EM}em; text-indent: -${MARKER_EM}em` },
            }).range(line.from),
          );
          const kind = task ? 'task' : /\d/.test(markText) ? 'ordered' : 'bullet';
          const checked = Boolean(task && /x/i.test(task[2] ?? ''));
          ranges.push(Decoration.replace({ widget: new ListMarkerWidget(kind, markText, checked) }).range(line.from, textStart));
          if (checked && textStart < line.to) {
            ranges.push(Decoration.mark({ class: 'cm-note-done' }).range(textStart, line.to));
          }
        }
      },
    });

    // Entities, markers, and search hits line by line.
    let pos = from;
    while (pos <= to) {
      const line = state.doc.lineAt(pos);
      const text = line.text;
      const claimed: Array<[number, number]> = [];
      const overlaps = (start: number, end: number) => claimed.some(([a, b]) => start < b && end > a);

      for (const match of text.matchAll(PROVENANCE_PATTERN)) {
        const start = line.from + (match.index ?? 0);
        const end = start + match[0].length;
        const target = match[0].replace(/^→\s*/, '');
        claimed.push([start, end]);
        ranges.push(
          Decoration.replace({ widget: new ProvenanceWidget(target, context.refs.get(target.toUpperCase()) ?? null) }).range(start, end),
        );
      }
      for (const match of text.matchAll(CARRIED_PATTERN)) {
        const start = line.from + (match.index ?? 0);
        const end = start + match[0].length;
        claimed.push([start, end]);
        ranges.push(Decoration.replace({ widget: new CarriedWidget(match[1] ?? '') }).range(start, end));
      }
      for (const match of text.matchAll(TASK_KEY_PATTERN)) {
        const start = line.from + (match.index ?? 0);
        const end = start + match[0].length;
        if (overlaps(start, end)) continue;
        const key = match[0].toUpperCase();
        const ref = context.refs.get(key);
        ranges.push(
          Decoration.mark({
            class: `cm-note-chip cm-note-chip-task${ref ? ` status-${ref.status}` : ''}`,
            attributes: { 'data-entity': 'task', 'data-key': key },
          }).range(start, end),
        );
      }
      for (const match of text.matchAll(JIRA_KEY_PATTERN)) {
        const start = line.from + (match.index ?? 0);
        const end = start + match[0].length;
        if (overlaps(start, end)) continue;
        ranges.push(
          Decoration.mark({
            class: 'cm-note-chip cm-note-chip-jira',
            attributes: { 'data-entity': 'issue', 'data-key': match[0] },
          }).range(start, end),
        );
      }
      if (mentions) {
        for (const match of text.matchAll(mentions)) {
          const start = line.from + (match.index ?? 0);
          const end = start + match[0].length;
          const dev = resolveMention(match[1] ?? '', context.developers);
          if (!dev || overlaps(start, end)) continue;
          ranges.push(
            Decoration.mark({
              class: 'cm-note-chip cm-note-chip-person',
              attributes: { 'data-entity': 'person', 'data-key': dev.accountId },
            }).range(start, end),
          );
        }
      }
      if (terms.length > 0) {
        const lower = text.toLowerCase();
        for (const term of terms) {
          const needle = term.toLowerCase();
          let at = lower.indexOf(needle);
          while (at >= 0) {
            ranges.push(Decoration.mark({ class: 'cm-note-hit' }).range(line.from + at, line.from + at + needle.length));
            at = lower.indexOf(needle, at + needle.length);
          }
        }
      }
      pos = line.to + 1;
    }
  }

  // The whole-document placeholder covers an empty note; this covers the
  // blank line you're on in a note that already has text.
  const head = state.selection.main;
  if (focused && head.empty && state.doc.length > 0) {
    const line = state.doc.lineAt(head.head);
    if (line.length === 0) ranges.push(emptyLineHint.range(line.from));
  }

  return Decoration.set(ranges, true);
}

/** `[] ` or `[ ] ` typed at the start of a line (or after a bullet) becomes `- [ ] `. */
const checkboxShorthand = EditorView.inputHandler.of((view, from, to, text) => {
  if (text !== ' ' || from !== to) return false;
  const line = view.state.doc.lineAt(from);
  const match = /^(\s*)(?:[-*+] )?\[ ?\]$/.exec(line.text.slice(0, from - line.from));
  if (!match) return false;
  const insert = `${match[1] ?? ''}- [ ] `;
  view.dispatch({
    changes: { from: line.from, to, insert },
    selection: { anchor: line.from + insert.length },
    userEvent: 'input.type',
  });
  return true;
});

function liveMarkdown(getHandlers: () => NoteEditorHandlers): Extension {
  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = buildDecorations(view, view.hasFocus);
      }
      update(update: ViewUpdate) {
        const contextChanged = update.transactions.some((tr) =>
          tr.effects.some((effect) => effect.is(setEntityContext) || effect.is(setSearchHighlight)),
        );
        if (
          update.docChanged ||
          update.viewportChanged ||
          update.selectionSet ||
          update.focusChanged ||
          contextChanged ||
          syntaxTree(update.startState) !== syntaxTree(update.state)
        ) {
          this.decorations = buildDecorations(update.view, update.view.hasFocus);
        }
      }
    },
    {
      decorations: (value) => value.decorations,
      eventHandlers: {
        mousedown(event, view) {
          const target = event.target as HTMLElement;
          if (target instanceof HTMLInputElement && target.classList.contains('cm-note-checkbox')) {
            const pos = view.posAtDOM(target);
            const line = view.state.doc.lineAt(pos);
            const next = toggleCheckbox(line.text);
            if (next !== null) {
              view.dispatch({ changes: { from: line.from, to: line.to, insert: next }, userEvent: 'input.toggle' });
            }
            event.preventDefault();
            return true;
          }
          const provenance = target.closest<HTMLElement>('[data-provenance]')?.dataset.provenance;
          if (provenance) {
            event.preventDefault();
            if (/^T-\d+$/.test(provenance)) getHandlers().openTask(provenance);
            else getHandlers().openNoteDate(provenance);
            return true;
          }
          const carried = target.closest<HTMLElement>('[data-carried]');
          if (carried?.dataset.carried) {
            event.preventDefault();
            getHandlers().openNoteDate(carried.dataset.carried);
            return true;
          }
          // Mod-click on an entity chip opens it; a plain click edits text.
          if (event.metaKey || event.ctrlKey) {
            const chip = target.closest<HTMLElement>('[data-entity]');
            if (chip?.dataset.key) {
              event.preventDefault();
              openEntity(getHandlers(), chip.dataset.entity ?? '', chip.dataset.key);
              return true;
            }
          }
          return false;
        },
      },
    },
  );
  return plugin;
}

function openEntity(handlers: NoteEditorHandlers, kind: string, key: string) {
  if (kind === 'task') handlers.openTask(key);
  else if (kind === 'issue') handlers.openIssue(key);
  else if (kind === 'person') handlers.openDeveloper(key);
}

// ── Hover previews ────────────────────────────────────────────────────

interface EntityAt {
  kind: 'task' | 'issue' | 'person';
  key: string;
  label: string;
  from: number;
  to: number;
}

export function entityAt(state: EditorState, pos: number): EntityAt | null {
  const line = state.doc.lineAt(pos);
  const offset = pos - line.from;
  const within = (match: RegExpMatchArray) => {
    const at = match.index ?? 0;
    return offset >= at && offset <= at + match[0].length;
  };
  for (const match of line.text.matchAll(TASK_KEY_PATTERN)) {
    if (within(match)) {
      const at = line.from + (match.index ?? 0);
      return { kind: 'task', key: match[0].toUpperCase(), label: match[0].toUpperCase(), from: at, to: at + match[0].length };
    }
  }
  for (const match of line.text.matchAll(JIRA_KEY_PATTERN)) {
    if (within(match)) {
      const at = line.from + (match.index ?? 0);
      return { kind: 'issue', key: match[0], label: match[0], from: at, to: at + match[0].length };
    }
  }
  const context = state.field(entityContextField, false) ?? EMPTY_CONTEXT;
  const mentions = mentionPattern(context.developers);
  if (mentions) {
    for (const match of line.text.matchAll(mentions)) {
      if (!within(match)) continue;
      const dev = resolveMention(match[1] ?? '', context.developers);
      if (!dev) continue;
      const at = line.from + (match.index ?? 0);
      return { kind: 'person', key: dev.accountId, label: dev.displayName, from: at, to: at + match[0].length };
    }
  }
  return null;
}

function previewDom(entity: EntityAt, preview: NoteEntityPreview | null, handlers: NoteEditorHandlers): HTMLElement {
  const root = document.createElement('div');
  root.className = 'cm-note-preview';
  const head = document.createElement('div');
  head.className = 'cm-note-preview-head';
  const key = document.createElement('span');
  key.className = 'cm-note-preview-key';
  key.textContent = entity.kind === 'person' ? 'Person' : entity.label;
  head.append(key);
  if (preview?.meta) {
    const meta = document.createElement('span');
    meta.className = 'cm-note-preview-meta';
    meta.textContent = preview.meta;
    head.append(meta);
  }
  const title = document.createElement('p');
  title.className = 'cm-note-preview-title';
  title.textContent = preview?.title ?? (entity.kind === 'person' ? entity.label : 'Not found');
  const open = document.createElement('button');
  open.type = 'button';
  open.className = 'cm-note-preview-open';
  open.textContent = entity.kind === 'task' ? 'Open task' : entity.kind === 'issue' ? 'Open in Work' : 'Open in Team';
  open.addEventListener('mousedown', (event) => {
    event.preventDefault();
    openEntity(handlers, entity.kind, entity.key);
  });
  const hint = document.createElement('span');
  hint.className = 'cm-note-preview-hint';
  hint.textContent = '⌘-click to open';
  const foot = document.createElement('div');
  foot.className = 'cm-note-preview-foot';
  foot.append(open, hint);
  root.append(head, title, foot);
  return root;
}

function entityHover(getHandlers: () => NoteEditorHandlers): Extension {
  return hoverTooltip(
    async (view, pos): Promise<Tooltip | null> => {
      const entity = entityAt(view.state, pos);
      if (!entity) return null;
      const handlers = getHandlers();
      let preview: NoteEntityPreview | null = null;
      try {
        if (entity.kind === 'task') {
          const ref = view.state.field(entityContextField).refs.get(entity.key);
          preview = ref ? { title: ref.title, meta: statusLabel(ref.status) } : await handlers.previewTask(entity.key);
        } else if (entity.kind === 'issue') {
          preview = await handlers.previewIssue(entity.key);
        }
      } catch {
        preview = null;
      }
      return {
        pos: entity.from,
        end: entity.to,
        above: true,
        create: () => ({ dom: previewDom(entity, preview, handlers) }),
      };
    },
    { hoverTime: 350 },
  );
}

// ── Autocomplete ──────────────────────────────────────────────────────

const SLASH_PATTERN = /^\s*(?:[-*+]\s+(?:\[[ xX]\]\s+)?)?\/[\w-]*$/;

interface SlashCommand {
  label: string;
  detail: string;
  run: (view: EditorView, from: number, handlers: NoteEditorHandlers) => void;
}

function insertAtLineStart(view: EditorView, from: number, prefix: string) {
  const line = view.state.doc.lineAt(from);
  const existing = /^\s*(?:[-*+]\s+(?:\[[ xX]\]\s+)?|#{1,6}\s+)?/.exec(line.text)?.[0] ?? '';
  view.dispatch({
    changes: { from: line.from, to: line.from + existing.length, insert: prefix },
    selection: { anchor: line.from + prefix.length + (line.text.length - existing.length) },
  });
}

const SLASH_COMMANDS: (SlashCommand & { command?: NoteEditorCommand })[] = [
  { label: 'Task', command: 'task', detail: NOTE_ACTION_SHORTCUTS.task.label, run: (_v, _f, h) => h.onAction('task') },
  { label: 'Update', command: 'update', detail: NOTE_ACTION_SHORTCUTS.update.label, run: (_v, _f, h) => h.onAction('update') },
  { label: 'Follow-up', command: 'follow-up', detail: NOTE_ACTION_SHORTCUTS['follow-up'].label, run: (_v, _f, h) => h.onAction('follow-up') },
  { label: 'Checkbox', detail: '- [ ]', run: (v, f) => insertAtLineStart(v, f, '- [ ] ') },
  { label: 'Heading', detail: '##', run: (v, f) => insertAtLineStart(v, f, '## ') },
  {
    label: 'Time',
    detail: 'Now',
    run: (v, f) => {
      const stamp = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      v.dispatch(v.state.replaceSelection(`${stamp} — `));
      void f;
    },
  },
  { label: 'Wrap up day', command: 'wrap-up', detail: '⌘⏎', run: (_v, _f, h) => h.onWrapUp() },
];

function slashSource(getHandlers: () => NoteEditorHandlers, omit: ReadonlySet<NoteEditorCommand>) {
  const commands = SLASH_COMMANDS.filter((command) => !command.command || !omit.has(command.command));
  return (context: CompletionContext): CompletionResult | null => {
    const line = context.state.doc.lineAt(context.pos);
    const before = line.text.slice(0, context.pos - line.from);
    if (!SLASH_PATTERN.test(before)) return null;
    const slashAt = line.from + before.lastIndexOf('/');
    return {
      from: slashAt,
      filter: true,
      options: commands.map<Completion>((command, index) => ({
        label: `/${command.label}`,
        displayLabel: command.label,
        detail: command.detail,
        type: 'text',
        boost: -index,
        apply: (view, _completion, from, to) => {
          view.dispatch({ changes: { from, to, insert: '' }, selection: { anchor: from } });
          command.run(view, from, getHandlers());
        },
      })),
      validFor: /^\/[\w-]*$/,
    };
  };
}

function mentionSource(context: CompletionContext): CompletionResult | null {
  const match = context.matchBefore(/(?:^|[\s(])@[\p{L}\p{N}_'-]*(?: [\p{L}\p{N}_'-]*)?$/u);
  if (!match) return null;
  const at = match.text.indexOf('@');
  const developers = context.state.field(entityContextField).developers;
  if (developers.length === 0) return null;
  return {
    from: match.from + at,
    filter: true,
    options: developers.map((dev) => ({
      label: `@${dev.displayName}`,
      type: 'variable',
      apply: `@${dev.displayName} `,
    })),
  };
}

function taskSource(getHandlers: () => NoteEditorHandlers) {
  return async (context: CompletionContext): Promise<CompletionResult | null> => {
    const match = context.matchBefore(/\b[Tt]-[\p{L}\p{N}_]*$/u);
    if (!match || (match.text.length < 2 && !context.explicit)) return null;
    const query = match.text.slice(2);
    const search = /^\d*$/.test(query) ? `T-${query}` : query;
    if (search.replace(/^T-/, '').length === 0 && !context.explicit) return null;
    const tasks = await getHandlers().searchTasks(search).catch(() => []);
    if (context.aborted || tasks.length === 0) return null;
    return {
      from: match.from,
      filter: false,
      options: tasks.slice(0, 8).map((task) => ({
        label: task.taskKey,
        detail: task.title,
        type: 'constant',
        apply: task.taskKey,
      })),
    };
  };
}

function jiraSource(getHandlers: () => NoteEditorHandlers) {
  return async (context: CompletionContext): Promise<CompletionResult | null> => {
    const match = context.matchBefore(/(?:^|[\s(])#[\w-]*$/);
    if (!match) return null;
    const hashAt = match.from + match.text.indexOf('#');
    const query = context.state.sliceDoc(hashAt + 1, context.pos);
    // `# ` at a line start is a heading — only complete once something is typed.
    if (query.length < 2) return null;
    const issues = await getHandlers().searchIssues(query).catch(() => []);
    if (context.aborted || issues.length === 0) return null;
    return {
      from: hashAt,
      filter: false,
      options: issues.slice(0, 8).map((issue) => ({
        label: `#${issue.key}`,
        displayLabel: issue.key,
        detail: issue.summary,
        type: 'constant',
        apply: issue.key,
      })),
    };
  };
}

// ── Keymap ────────────────────────────────────────────────────────────

/**
 * Keys the editor must never swallow: global ⌘K/⌘J/⌘I (App.tsx), the page's
 * ⌥↑/⌥↓ day navigation, and ⌘⏎ wrap-up. CodeMirror's default keymap binds
 * some of these (selectParentSyntax, moveLineUp/Down, insertBlankLine).
 */
const RESERVED_KEYS = new Set([
  'Mod-i',
  'Mod-k',
  'Mod-j',
  'Alt-ArrowUp',
  'Alt-ArrowDown',
  'Mod-Enter',
  'Shift-Mod-k',
  'Mod-Shift-l',
  'Mod-Shift-f',
]);

function withoutReserved(bindings: readonly KeyBinding[]): KeyBinding[] {
  return bindings.filter((binding) => !binding.key || !RESERVED_KEYS.has(binding.key));
}

function onListLine(state: EditorState): boolean {
  return state.selection.ranges.some((range) => {
    const first = state.doc.lineAt(range.from);
    const last = state.doc.lineAt(range.to);
    return first.number !== last.number || /^\s*(?:[-*+]|\d{1,9}[.)])\s/.test(first.text);
  });
}

function noteKeymap(getHandlers: () => NoteEditorHandlers, omit: ReadonlySet<NoteEditorCommand>): Extension {
  // An omitted command's shortcut falls through to the default keymap.
  const action = (name: NoteLineAction) => () => {
    if (omit.has(name)) return false;
    getHandlers().onAction(name);
    return true;
  };
  return Prec.high(
    keymap.of([
      { key: NOTE_ACTION_SHORTCUTS.task.key, run: action('task') },
      { key: 'Mod-Shift-t', run: action('task') },
      { key: NOTE_ACTION_SHORTCUTS.update.key, run: action('update') },
      { key: NOTE_ACTION_SHORTCUTS['follow-up'].key, run: action('follow-up') },
      {
        key: 'Mod-Enter',
        run: () => {
          if (omit.has('wrap-up')) return false;
          getHandlers().onWrapUp();
          return true;
        },
      },
      {
        key: 'Mod-s',
        run: () => {
          getHandlers().onSave();
          return true;
        },
      },
      // Tab indents list items (and multi-line selections); elsewhere it moves
      // focus as usual so keyboard users are never trapped in the editor.
      { key: 'Tab', run: (view) => (onListLine(view.state) ? indentMore(view) : false) },
      { key: 'Shift-Tab', run: (view) => (onListLine(view.state) ? indentLess(view) : false) },
    ]),
  );
}

// ── Assembly ──────────────────────────────────────────────────────────

export interface NoteEditorConfig {
  getHandlers: () => NoteEditorHandlers;
  placeholder: string;
  ariaLabel: string;
  omit?: readonly NoteEditorCommand[];
}

export function noteEditorExtensions({ getHandlers, placeholder, ariaLabel, omit = [] }: NoteEditorConfig): Extension[] {
  const omitted = new Set(omit);
  return [
    entityContextField,
    searchHighlightField,
    history(),
    // The language directly, not `markdown()`: that wrapper pulls in the
    // HTML/CSS/JS language packs for embedded-HTML completion (~400 kB) that a
    // daily note never needs. Same parser (GFM), same list-continuation keys.
    new LanguageSupport(markdownLanguage),
    Prec.high(keymap.of(markdownKeymap)),
    EditorView.lineWrapping,
    placeholderExt(placeholder),
    EditorView.contentAttributes.of({ 'aria-label': ariaLabel, 'aria-multiline': 'true', spellcheck: 'true' }),
    search({ top: true }),
    autocompletion({
      override: [slashSource(getHandlers, omitted), mentionSource, taskSource(getHandlers), jiraSource(getHandlers)],
      icons: false,
      activateOnTypingDelay: 120,
    }),
    noteKeymap(getHandlers, omitted),
    checkboxShorthand,
    keymap.of([
      ...withoutReserved(completionKeymap),
      ...withoutReserved(searchKeymap),
      ...withoutReserved(historyKeymap),
      ...withoutReserved(defaultKeymap),
    ]),
    liveMarkdown(getHandlers),
    entityHover(getHandlers),
  ];
}
