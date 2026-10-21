/**
 * Il controller possiede l'unica istanza di CodeMirror e la espone al resto
 * dell'app con poche funzioni. Le reazioni costose (salvataggio, conteggio
 * parole, conversioni) vengono notificate e rimandate altrove: l'editor si
 * limita a mostrare ciò che si digita.
 */
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { StreamLanguage, bracketMatching, indentOnInput } from '@codemirror/language';
import { stex } from '@codemirror/legacy-modes/mode/stex';
import { Compartment, EditorSelection, EditorState, Prec, type Extension } from '@codemirror/state';
import { EditorView, drawSelection, keymap, highlightSpecialChars, dropCursor, type KeyBinding } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { search, searchKeymap, openSearchPanel } from '@codemirror/search';
import { blockDecorations, focusDim, markdownHighlight, typewriter, typstLanguage } from './decor';
import { activeFormat, applyLink, linkAt, setBlock, toggleInline, type ActiveFormat, type BlockKind, type InlineKind } from './format';
import { addNote, flashNote, noteClick, noteContext, notesExtension, notesField, removeNote, setNotes, type NoteRange } from './notes';
import { editorTheme } from './theme';
import { citations, refreshCites } from './cite';
import { settings } from '../state.svelte';

export type EditorLanguage = 'md' | 'txt' | 'tex' | 'typ' | 'html';

const language = new Compartment();
const readOnly = new Compartment();
const spell = new Compartment();
const typing = new Compartment();
const dim = new Compartment();
const caret = new Compartment();
const phrasesC = new Compartment();

/** Testi della barra di ricerca di CodeMirror (in inglese di serie). */
const PHRASES: Record<string, Record<string, string>> = {
  it: {
    Find: 'Trova',
    Replace: 'Sostituisci',
    next: 'successivo',
    previous: 'precedente',
    all: 'tutti',
    'match case': 'maiuscole/minuscole',
    regexp: 'espressione regolare',
    'by word': 'parola intera',
    replace: 'sostituisci',
    'replace all': 'sostituisci tutti',
    close: 'chiudi',
    'current match': 'corrispondenza attuale',
    'replaced $ matches': '$ sostituzioni',
    'replaced match on line $': 'sostituita la corrispondenza alla riga $',
    'on line': 'alla riga',
    'Go to line': 'Vai alla riga',
    go: 'vai',
  },
  fr: {
    Find: 'Rechercher',
    Replace: 'Remplacer',
    next: 'suivant',
    previous: 'précédent',
    all: 'tout',
    'match case': 'respecter la casse',
    regexp: 'expression régulière',
    'by word': 'mot entier',
    replace: 'remplacer',
    'replace all': 'tout remplacer',
    close: 'fermer',
    'current match': 'occurrence actuelle',
    'replaced $ matches': '$ occurrences remplacées',
    'replaced match on line $': 'occurrence remplacée à la ligne $',
    'on line': 'à la ligne',
    'Go to line': 'Aller à la ligne',
    go: 'aller',
  },
};

function phrasesExt(): Extension {
  return EditorState.phrases.of(PHRASES[settings.language] ?? {});
}

export type CaretStyle = 'system' | 'thick';

/**
 * "system": il cursore nativo di Windows (lampeggio e spessore di sistema).
 * "thick": cursore disegnato, più spesso, con lampeggio regolare e senza animazioni.
 */
function caretExt(style: CaretStyle): Extension {
  return style === 'thick' ? [drawSelection({ cursorBlinkRate: 1060 }), EditorView.editorAttributes.of({ class: 'thick-caret' })] : [];
}

type Listener<T> = (v: T) => void;

class Controller {
  view: EditorView | null = null;
  private changeListeners: Listener<void>[] = [];
  private selectionListeners: Listener<ActiveFormat & { empty: boolean }>[] = [];
  private scrollListeners: Listener<number>[] = [];
  private lang: EditorLanguage = 'md';
  private caretStyle: CaretStyle = 'system';
  onLinkRequest: ((link: { text: string; href: string; from: number; to: number }) => void) | null = null;
  onNoteRequest: (() => void) | null = null;
  /** Richiesta di inserire una citazione (Ctrl+Shift+C o «Cita»). */
  onCiteRequest: (() => void) | null = null;
  private spellOn = true;

  mount(parent: HTMLElement) {
    if (this.view) {
      parent.appendChild(this.view.dom);
      return;
    }
    this.view = new EditorView({
      parent,
      state: this.makeState('', 'md', false),
    });
    this.view.scrollDOM.addEventListener(
      'scroll',
      () => {
        const v = this.view!;
        const max = v.scrollDOM.scrollHeight - v.scrollDOM.clientHeight;
        const ratio = max > 0 ? v.scrollDOM.scrollTop / max : 0;
        for (const l of this.scrollListeners) l(ratio);
      },
      { passive: true },
    );
  }

  private formatKeys(): KeyBinding[] {
    const run = (fn: (v: EditorView) => boolean) => (v: EditorView) => (this.lang === 'md' ? fn(v) : false);
    const block = (k: BlockKind) => run((v) => setBlock(v, k));
    const inline = (k: InlineKind) => run((v) => toggleInline(v, k));
    return [
      { key: 'Mod-b', run: inline('strong') },
      { key: 'Mod-i', run: inline('em') },
      { key: 'Mod-u', run: inline('u') },
      { key: 'Mod-Shift-x', run: inline('s') },
      { key: 'Mod-e', run: inline('code') },
      { key: 'Mod-0', run: block('p') },
      { key: 'Mod-1', run: block('h1') },
      { key: 'Mod-2', run: block('h2') },
      { key: 'Mod-3', run: block('h3') },
      { key: 'Mod-4', run: block('h4') },
      { key: 'Mod-Shift-8', run: block('ul') },
      { key: 'Mod-Shift-7', run: block('ol') },
      { key: 'Mod-Shift-q', run: block('quote') },
      { key: 'Mod-Alt-c', run: block('code') },
      {
        key: 'Mod-k',
        run: run(() => {
          this.requestLink();
          return true;
        }),
      },
      {
        key: 'Mod-m',
        run: () => {
          this.onNoteRequest?.();
          return true;
        },
      },
      {
        key: 'Mod-Shift-c',
        run: run(() => {
          this.onCiteRequest?.();
          return true;
        }),
      },
      {
        key: 'Mod-f',
        run: (v) => {
          openSearchPanel(v);
          return true;
        },
      },
    ];
  }

  private languageExt(lang: EditorLanguage): Extension {
    switch (lang) {
      case 'md':
        return [markdown({ base: markdownLanguage, codeLanguages: [], addKeymap: true }), blockDecorations, citations];
      case 'tex':
        return [StreamLanguage.define(stex), bracketMatching()];
      case 'typ':
        return [typstLanguage, bracketMatching()];
      case 'txt':
        return blockDecorations;
      default:
        return [];
    }
  }

  private makeState(text: string, lang: EditorLanguage, ro: boolean, notes: NoteRange[] = []): EditorState {
    this.lang = lang;
    return EditorState.create({
      doc: text,
      extensions: [
        history(),
        dropCursor(),
        highlightSpecialChars(),
        indentOnInput(),
        EditorView.lineWrapping,
        search({ top: true }),
        Prec.high(keymap.of(this.formatKeys())),
        keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
        language.of(this.languageExt(lang)),
        // Anche in sola lettura l'editor resta attivo: si seleziona e si annota da tastiera.
        readOnly.of([EditorState.readOnly.of(ro), EditorView.editable.of(true)]),
        spell.of(this.spellExt(true)),
        typing.of([]),
        dim.of([]),
        caret.of(caretExt(this.caretStyle)),
        phrasesC.of(phrasesExt()),
        markdownHighlight,
        notesExtension(notes),
        editorTheme,
        EditorState.allowMultipleSelections.of(false),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) for (const l of this.changeListeners) l();
          if (u.selectionSet || u.docChanged) {
            const info = { ...activeFormat(u.state), empty: u.state.selection.main.empty };
            for (const l of this.selectionListeners) l(info);
          }
        }),
      ],
    });
  }

  /** Controllo ortografico nella lingua dei documenti scelta nelle impostazioni. */
  private spellExt(on: boolean): Extension {
    this.spellOn = on;
    return EditorView.contentAttributes.of({
      spellcheck: on ? 'true' : 'false',
      lang: settings.docLanguage || 'it',
      autocorrect: 'off',
      autocapitalize: 'off',
    });
  }

  /** Carica un documento: testo, lingua, sola lettura, note. */
  load(text: string, lang: EditorLanguage, ro: boolean, notes: NoteRange[], opts: { spellcheck: boolean; typewriter: boolean; caret: CaretStyle }) {
    if (!this.view) return;
    this.caretStyle = opts.caret;
    this.view.setState(this.makeState(text, lang, ro, notes));
    this.view.dispatch({
      effects: [spell.reconfigure(this.spellExt(opts.spellcheck && !ro)), typing.reconfigure(opts.typewriter && !ro ? typewriter : [])],
    });
  }

  /**
   * Passa dalla sola lettura alla modifica (o viceversa) senza ricaricare il
   * testo: le note restano dove sono.
   */
  setEditable(editable: boolean, lang: EditorLanguage, opts: { spellcheck: boolean; typewriter: boolean }) {
    if (!this.view) return;
    this.lang = lang;
    this.view.dispatch({
      effects: [
        readOnly.reconfigure([EditorState.readOnly.of(!editable), EditorView.editable.of(true)]),
        language.reconfigure(this.languageExt(lang)),
        spell.reconfigure(this.spellExt(opts.spellcheck && editable)),
        typing.reconfigure(opts.typewriter && editable ? typewriter : []),
      ],
    });
    this.view.focus();
  }

  get language() {
    return this.lang;
  }

  getText(): string {
    return this.view?.state.doc.toString() ?? '';
  }

  /**
   * Toglie le righe che corrispondono all'espressione (con la riga vuota che
   * le segue). Passa per una transazione: le note si spostano con il testo.
   */
  deleteLinesMatching(re: RegExp) {
    const v = this.view;
    if (!v) return;
    const doc = v.state.doc;
    const changes: { from: number; to: number }[] = [];
    for (let n = 1; n <= doc.lines; n++) {
      const line = doc.line(n);
      if (!re.test(line.text)) continue;
      let to = line.to < doc.length ? line.to + 1 : line.to;
      if (n + 1 <= doc.lines && doc.line(n + 1).text.trim() === '') to = doc.line(n + 1).to < doc.length ? doc.line(n + 1).to + 1 : doc.line(n + 1).to;
      changes.push({ from: line.from, to });
    }
    if (changes.length) v.dispatch({ changes, userEvent: 'delete.pagemarks' });
  }

  /** Sostituisce tutto il testo (es. ricarica dopo una modifica esterna). */
  replaceAll(text: string) {
    if (!this.view) return;
    this.view.dispatch({ changes: { from: 0, to: this.view.state.doc.length, insert: text } });
  }

  onChange(l: Listener<void>): () => void {
    this.changeListeners.push(l);
    return () => (this.changeListeners = this.changeListeners.filter((x) => x !== l));
  }
  onSelection(l: Listener<ActiveFormat & { empty: boolean }>): () => void {
    this.selectionListeners.push(l);
    return () => (this.selectionListeners = this.selectionListeners.filter((x) => x !== l));
  }
  onScroll(l: Listener<number>): () => void {
    this.scrollListeners.push(l);
    return () => (this.scrollListeners = this.scrollListeners.filter((x) => x !== l));
  }

  focus() {
    this.view?.focus();
  }

  configure(opts: { spellcheck?: boolean; typewriter?: boolean; focusDim?: boolean; caret?: CaretStyle; lang?: string; uiLang?: string }) {
    if (!this.view) return;
    const ro = this.view.state.readOnly;
    const effects = [];
    if (opts.spellcheck != null) effects.push(spell.reconfigure(this.spellExt(opts.spellcheck && !ro)));
    else if (opts.lang != null) effects.push(spell.reconfigure(this.spellExt(this.spellOn)));
    if (opts.uiLang != null) effects.push(phrasesC.reconfigure(phrasesExt()));
    if (opts.typewriter != null) effects.push(typing.reconfigure(opts.typewriter && !ro ? typewriter : []));
    if (opts.focusDim != null) effects.push(dim.reconfigure(opts.focusDim ? focusDim : []));
    if (opts.caret != null) {
      this.caretStyle = opts.caret;
      effects.push(caret.reconfigure(caretExt(opts.caret)));
    }
    this.view.dispatch({ effects });
  }

  /** La bibliografia è cambiata: ridisegna le citazioni. */
  refreshCitations() {
    this.view?.dispatch({ effects: refreshCites.of(null) });
  }

  /** Inserisce una citazione al cursore (o al posto della selezione). */
  insertCitation(text: string) {
    const v = this.view;
    if (!v || v.state.readOnly) return;
    const sel = v.state.selection.main;
    // Uno spazio prima, se la citazione si attacca a una parola.
    const before = sel.from > 0 ? v.state.sliceDoc(sel.from - 1, sel.from) : ' ';
    const insert = (/[\p{L}\p{N}.,;:!?)]/u.test(before) ? ' ' : '') + text;
    v.dispatch({ changes: { from: sel.from, to: sel.to, insert }, selection: { anchor: sel.from + insert.length }, userEvent: 'input.cite', scrollIntoView: true });
    v.focus();
  }

  /** Coordinate del cursore, per aprire un riquadro accanto. */
  caretRect(): DOMRect | null {
    const v = this.view;
    if (!v) return null;
    const c = v.coordsAtPos(v.state.selection.main.head);
    return c ? new DOMRect(c.left, c.top, 1, c.bottom - c.top) : null;
  }

  /* Formattazione */

  inline(kind: InlineKind) {
    if (this.view && this.lang === 'md') toggleInline(this.view, kind);
  }
  block(kind: BlockKind) {
    if (this.view && this.lang === 'md') setBlock(this.view, kind);
  }
  requestLink() {
    if (!this.view) return;
    const st = this.view.state;
    const existing = linkAt(st);
    const sel = st.selection.main;
    const link = existing ?? { from: sel.from, to: sel.to, text: st.sliceDoc(sel.from, sel.to), href: '' };
    this.onLinkRequest?.(link);
  }
  applyLink(from: number, to: number, text: string, href: string) {
    if (this.view) applyLink(this.view, from, to, text, href);
  }

  /* Note */

  selectionForNote(): { from: number; to: number; quote: string } | null {
    if (!this.view) return null;
    const sel = this.view.state.selection.main;
    if (sel.empty) return null;
    // Esclude spazi e a capo ai bordi della selezione.
    const raw = this.view.state.sliceDoc(sel.from, sel.to);
    const lead = raw.length - raw.trimStart().length;
    const trail = raw.length - raw.trimEnd().length;
    const from = sel.from + lead;
    const to = sel.to - trail;
    if (to <= from) return null;
    return { from, to, quote: this.view.state.sliceDoc(from, to) };
  }

  addNoteRange(n: NoteRange) {
    this.view?.dispatch({ effects: addNote.of(n), selection: EditorSelection.cursor(n.to) });
  }
  removeNoteRange(id: string) {
    this.view?.dispatch({ effects: removeNote.of(id) });
  }
  setNoteRanges(list: NoteRange[]) {
    this.view?.dispatch({ effects: setNotes.of(list) });
  }
  noteRanges(): NoteRange[] {
    return this.view?.state.field(notesField) ?? [];
  }
  setNoteClickHandler(h: (id: string, rect: DOMRect) => void) {
    noteClick.handler = h;
  }
  setNoteContextHandler(h: (id: string, x: number, y: number) => void) {
    noteContext.handler = h;
  }

  /** Porta in vista una nota e la fa lampeggiare. */
  revealNote(id: string): DOMRect | null {
    const v = this.view;
    if (!v) return null;
    const n = v.state.field(notesField).find((r) => r.id === id);
    if (!n) return null;
    v.dispatch({
      selection: EditorSelection.cursor(n.to),
      effects: [EditorView.scrollIntoView(n.from, { y: 'center' }), flashNote.of(id)],
    });
    setTimeout(() => v.dispatch({ effects: flashNote.of(null) }), 1600);
    const coords = v.coordsAtPos(n.from);
    return coords ? new DOMRect(coords.left, coords.top, 0, coords.bottom - coords.top) : null;
  }

  /* Posizione di lettura */

  topPosition(): number {
    const v = this.view;
    if (!v) return 0;
    const rect = v.scrollDOM.getBoundingClientRect();
    return v.posAtCoords({ x: rect.left + rect.width / 2, y: rect.top + 40 }) ?? 0;
  }

  scrollToPosition(pos: number) {
    const v = this.view;
    if (!v) return;
    const p = Math.min(Math.max(0, pos), v.state.doc.length);
    v.dispatch({ effects: EditorView.scrollIntoView(p, { y: 'start', yMargin: 40 }) });
  }

  scrollToRatio(r: number) {
    const s = this.view?.scrollDOM;
    if (s) s.scrollTop = r * (s.scrollHeight - s.clientHeight);
  }

  goToLine(line: number) {
    const v = this.view;
    if (!v) return;
    const l = v.state.doc.line(Math.min(Math.max(1, line), v.state.doc.lines));
    v.dispatch({ selection: EditorSelection.cursor(l.from), effects: EditorView.scrollIntoView(l.from, { y: 'center' }) });
    v.focus();
  }

  openSearch() {
    if (this.view) openSearchPanel(this.view);
  }
}

export const editor = new Controller();
