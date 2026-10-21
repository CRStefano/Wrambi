/**
 * Note nell'editor: intervalli che seguono il testo mentre si scrive,
 * evidenziati in rosso e numerati come note a piè di pagina.
 */
import { t } from '../i18n';
import { StateEffect, StateField, type Range } from '@codemirror/state';
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view';

export interface NoteRange {
  id: string;
  from: number;
  to: number;
}

export const setNotes = StateEffect.define<NoteRange[]>();
export const addNote = StateEffect.define<NoteRange>();
export const removeNote = StateEffect.define<string>();
export const flashNote = StateEffect.define<string | null>();

/** Chiamato quando si fa clic su una nota (impostato dal controller). */
export const noteClick: { handler: ((id: string, rect: DOMRect) => void) | null } = { handler: null };

/** Chiamato con il tasto destro su una nota: apre il menu (impostato dal controller). */
export const noteContext: { handler: ((id: string, x: number, y: number) => void) | null } = { handler: null };

class NoteRefWidget extends WidgetType {
  constructor(
    readonly n: number,
    readonly id: string,
  ) {
    super();
  }
  eq(other: NoteRefWidget) {
    return other.n === this.n && other.id === this.id;
  }
  toDOM() {
    const el = document.createElement('sup');
    el.className = 'cm-note-ref';
    el.textContent = String(this.n);
    el.dataset.noteId = this.id;
    el.title = t('Apri la nota');
    el.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.button === 2) return;
      noteClick.handler?.(this.id, el.getBoundingClientRect());
    });
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      noteContext.handler?.(this.id, e.clientX, e.clientY);
    });
    return el;
  }
  ignoreEvent() {
    return true;
  }
}

export const notesField = StateField.define<NoteRange[]>({
  create: () => [],
  update(value, tr) {
    let v = value;
    if (tr.docChanged) {
      v = v.map((n) => {
        // Il testo inserito ai bordi non entra nella nota.
        const from = tr.changes.mapPos(n.from, 1);
        const to = Math.max(from, tr.changes.mapPos(n.to, -1));
        return { id: n.id, from, to };
      });
    }
    for (const e of tr.effects) {
      if (e.is(setNotes)) v = e.value;
      else if (e.is(addNote)) v = [...v, e.value];
      else if (e.is(removeNote)) v = v.filter((n) => n.id !== e.value);
    }
    return v;
  },
});

const flashField = StateField.define<string | null>({
  create: () => null,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(flashNote)) return e.value;
    return value;
  },
});

const noteDecorations = EditorView.decorations.compute([notesField, flashField], (state) => {
  const ranges = [...state.field(notesField)].filter((n) => n.to > n.from).sort((a, b) => a.from - b.from || a.to - b.to);
  const flashing = state.field(flashField);
  const decos: Range<Decoration>[] = [];
  ranges.forEach((n, i) => {
    decos.push(
      Decoration.mark({
        class: n.id === flashing ? 'cm-note cm-note-flash' : 'cm-note',
        attributes: { 'data-note-id': n.id },
        inclusive: false,
      }).range(n.from, n.to),
    );
    decos.push(Decoration.widget({ widget: new NoteRefWidget(i + 1, n.id), side: 1 }).range(n.to));
  });
  return Decoration.set(decos, true) as DecorationSet;
});

const clickHandler = EditorView.domEventHandlers({
  click(event) {
    const target = (event.target as HTMLElement | null)?.closest('[data-note-id]') as HTMLElement | null;
    if (!target || !noteClick.handler) return false;
    // Una selezione in corso (trascinamento) non apre la nota.
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) return false;
    noteClick.handler(target.dataset.noteId!, target.getBoundingClientRect());
    return false;
  },
  contextmenu(event) {
    const target = (event.target as HTMLElement | null)?.closest('[data-note-id]') as HTMLElement | null;
    if (!target || !noteContext.handler) return false;
    event.preventDefault();
    noteContext.handler(target.dataset.noteId!, event.clientX, event.clientY);
    return true;
  },
});

export function notesExtension(initial: NoteRange[]) {
  return [notesField.init(() => initial), flashField, noteDecorations, clickHandler];
}
