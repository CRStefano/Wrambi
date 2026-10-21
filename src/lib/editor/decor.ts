/**
 * Resa "viva" del Markdown nell'editor: titoli più grandi, segni di sintassi
 * attenuati, citazioni e codice riconoscibili, sottolineato visibile.
 * La sintassi resta nel testo: si vede, ma non disturba.
 */
import { HighlightStyle, StreamLanguage, syntaxHighlighting, syntaxTree } from '@codemirror/language';
import { RangeSetBuilder, type Extension } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { tags as t } from '@lezer/highlight';

export const markdownHighlight = syntaxHighlighting(
  HighlightStyle.define([
    { tag: t.heading1, fontSize: '1.6em', fontWeight: '650', letterSpacing: '-0.01em' },
    { tag: t.heading2, fontSize: '1.32em', fontWeight: '650' },
    { tag: t.heading3, fontSize: '1.13em', fontWeight: '650' },
    { tag: [t.heading4, t.heading5, t.heading6], fontWeight: '650' },
    { tag: t.strong, fontWeight: '700' },
    { tag: t.emphasis, fontStyle: 'italic' },
    { tag: t.strikethrough, textDecoration: 'line-through', textDecorationColor: 'var(--ink-3)' },
    { tag: t.link, color: 'var(--link)' },
    { tag: t.url, color: 'var(--ink-3)', fontSize: '0.9em' },
    { tag: t.monospace, fontFamily: 'var(--mono)', fontSize: '0.84em' },
    { tag: t.quote, color: 'var(--ink-2)' },
    { tag: t.processingInstruction, color: 'var(--ink-4)', fontWeight: '400', fontStyle: 'normal' },
    { tag: t.contentSeparator, color: 'var(--ink-3)' },
    { tag: t.labelName, color: 'var(--ink-3)' },
    { tag: t.escape, color: 'var(--ink-3)' },
    { tag: t.comment, color: 'var(--ink-3)', fontStyle: 'italic' },
    // LaTeX e Typst (sorgenti)
    { tag: [t.keyword, t.tagName], color: 'var(--link)' },
    { tag: [t.string, t.special(t.string)], color: 'var(--ok)' },
    { tag: [t.number, t.atom, t.bool], color: 'var(--warn)' },
    { tag: [t.bracket, t.meta], color: 'var(--ink-3)' },
    { tag: t.variableName, color: 'var(--ink)' },
  ]),
);

const lineClass = (cls: string) => Decoration.line({ class: cls });
const H_CLASSES = ['cm-h1', 'cm-h2', 'cm-h3', 'cm-h4', 'cm-h4', 'cm-h4'].map(lineClass);
const QUOTE = lineClass('cm-quote');
const CODE = lineClass('cm-codeblock');
const CODE_FIRST = lineClass('cm-codeblock cm-codeblock-first');
const CODE_LAST = lineClass('cm-codeblock cm-codeblock-last');
const PAGEMARK = lineClass('cm-pagemark');
const BLANK = lineClass('cm-blank');
const U_TAG = Decoration.mark({ class: 'cm-md-tag' });
const U_TEXT = Decoration.mark({ class: 'cm-u' });

function buildBlockDecos(view: EditorView): DecorationSet {
  const lines = new Map<number, Decoration>();
  const marks: { from: number; to: number; deco: Decoration }[] = [];
  const doc = view.state.doc;
  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from,
      to,
      enter(node) {
        const name = node.name;
        const m = /^ATXHeading(\d)$/.exec(name) ?? /^SetextHeading(\d)$/.exec(name);
        if (m) {
          lines.set(doc.lineAt(node.from).from, H_CLASSES[Number(m[1]) - 1]);
          return false;
        }
        if (name === 'Blockquote') {
          for (let p = node.from; p <= node.to; ) {
            const l = doc.lineAt(p);
            if (!lines.has(l.from)) lines.set(l.from, QUOTE);
            p = l.to + 1;
          }
        }
        if (name === 'FencedCode' || name === 'CodeBlock') {
          const first = doc.lineAt(node.from).number;
          const last = doc.lineAt(node.to).number;
          for (let n = first; n <= last; n++) {
            const l = doc.line(n);
            lines.set(l.from, n === first ? CODE_FIRST : n === last ? CODE_LAST : CODE);
          }
          return false;
        }
        return undefined;
      },
    });
    // Sottolineato <u>…</u> e indicatori di pagina dei PDF.
    let pos = from;
    while (pos <= to) {
      const line = doc.lineAt(pos);
      const text = line.text;
      if (/^\[p\. \d+\]$/.test(text)) lines.set(line.from, PAGEMARK);
      // Le righe vuote tra i paragrafi occupano meno spazio, come in una pagina composta.
      else if (text.trim() === '' && !lines.has(line.from) && line.number > 1) lines.set(line.from, BLANK);
      if (text.includes('<u>')) {
        const re = /<u>(.*?)<\/u>/g;
        let mm: RegExpExecArray | null;
        while ((mm = re.exec(text))) {
          const a = line.from + mm.index;
          const b = a + mm[0].length;
          marks.push({ from: a, to: a + 3, deco: U_TAG });
          if (mm[1].length) marks.push({ from: a + 3, to: b - 4, deco: U_TEXT });
          marks.push({ from: b - 4, to: b, deco: U_TAG });
        }
      }
      pos = line.to + 1;
    }
  }
  const all: { from: number; to: number; deco: Decoration; line: boolean }[] = [
    ...[...lines.entries()].map(([from, deco]) => ({ from, to: from, deco, line: true })),
    ...marks.map((m) => ({ ...m, line: false })),
  ].sort((a, b) => a.from - b.from || Number(b.line) - Number(a.line) || a.to - b.to);
  const builder = new RangeSetBuilder<Decoration>();
  for (const d of all) builder.add(d.from, d.to, d.deco);
  return builder.finish();
}

export const blockDecorations = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildBlockDecos(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged || syntaxTree(u.startState) !== syntaxTree(u.state)) {
        this.decorations = buildBlockDecos(u.view);
      }
    }
  },
  { decorations: (v) => v.decorations },
);

/* ─────────── Focus: attenua tutto tranne il paragrafo in cui si scrive ─────────── */

const DIM = Decoration.line({ class: 'cm-dim' });

function buildDim(view: EditorView): DecorationSet {
  const { state } = view;
  const doc = state.doc;
  const head = state.selection.main.head;
  let first = doc.lineAt(head).number;
  let last = first;
  if (doc.line(first).text.trim() !== '') {
    while (first > 1 && doc.line(first - 1).text.trim() !== '') first--;
    while (last < doc.lines && doc.line(last + 1).text.trim() !== '') last++;
  }
  const builder = new RangeSetBuilder<Decoration>();
  for (const { from, to } of view.visibleRanges) {
    for (let p = from; p <= to; ) {
      const line = doc.lineAt(p);
      if (line.number < first || line.number > last) builder.add(line.from, line.from, DIM);
      p = line.to + 1;
    }
  }
  return builder.finish();
}

export const focusDim: Extension = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildDim(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.selectionSet || u.viewportChanged) this.decorations = buildDim(u.view);
    }
  },
  { decorations: (v) => v.decorations },
);

/* ─────────── Macchina da scrivere: la riga corrente resta al centro ─────────── */

export const typewriter: Extension = EditorView.updateListener.of((u) => {
  if (!u.docChanged && !u.selectionSet) return;
  const pointer = u.transactions.some((tr) => tr.isUserEvent('select.pointer'));
  if (pointer || !u.view.hasFocus) return;
  const head = u.state.selection.main.head;
  requestAnimationFrame(() => {
    u.view.dispatch({ effects: EditorView.scrollIntoView(head, { y: 'center' }) });
  });
});

/* ─────────── Evidenziazione minima per i sorgenti Typst ─────────── */

interface TypstState {
  inRaw: boolean;
  inMath: boolean;
  inComment: boolean;
}

export const typstLanguage = StreamLanguage.define<TypstState>({
  name: 'typst',
  startState: () => ({ inRaw: false, inMath: false, inComment: false }),
  token(stream, st) {
    if (st.inComment) {
      if (stream.skipTo('*/')) {
        stream.match('*/');
        st.inComment = false;
      } else stream.skipToEnd();
      return 'comment';
    }
    if (st.inRaw) {
      if (stream.match('```')) st.inRaw = false;
      else stream.next();
      return 'string';
    }
    if (stream.sol() && stream.match(/^=+\s.*$/)) return 'heading';
    if (stream.match('//')) {
      stream.skipToEnd();
      return 'comment';
    }
    if (stream.match('/*')) {
      st.inComment = true;
      return 'comment';
    }
    if (stream.match('```')) {
      st.inRaw = true;
      return 'string';
    }
    if (stream.match(/^\\./)) return 'escape';
    if (stream.match('$')) {
      st.inMath = !st.inMath;
      return 'keyword';
    }
    if (st.inMath) {
      stream.next();
      return 'atom';
    }
    if (stream.match(/^#[A-Za-z_][\w-]*(\.[A-Za-z_][\w-]*)*/)) return 'keyword';
    if (stream.match(/^"(?:[^"\\]|\\.)*"/)) return 'string';
    if (stream.match(/^\d+(\.\d+)?(pt|em|cm|mm|in|%|fr)?/)) return 'number';
    if (stream.match(/^[[\](){}]/)) return 'bracket';
    if (stream.match(/^[*_]/)) return 'strong';
    stream.next();
    return null;
  },
});
