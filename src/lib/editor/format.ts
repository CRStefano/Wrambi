/**
 * Comandi della barra di formattazione. Ogni comando scrive la sintassi
 * Markdown corrispondente, così la struttura resta nel file e arriva intatta
 * a ogni conversione.
 */
import { EditorSelection, type EditorState, type Text } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import type { EditorView } from '@codemirror/view';

export type InlineKind = 'strong' | 'em' | 'u' | 's' | 'code';
export type BlockKind = 'p' | 'h1' | 'h2' | 'h3' | 'h4' | 'quote' | 'ul' | 'ol' | 'code';

const MARKERS: Record<InlineKind, [string, string]> = {
  strong: ['**', '**'],
  em: ['*', '*'],
  u: ['<u>', '</u>'],
  s: ['~~', '~~'],
  code: ['`', '`'],
};

/** Applica o toglie un'enfasi alla selezione (o inserisce i segni al cursore). */
export function toggleInline(view: EditorView, kind: InlineKind): boolean {
  if (view.state.readOnly) return false;
  const [open, close] = MARKERS[kind];
  const changes = view.state.changeByRange((range) => {
    const { from, to } = range;
    const doc = view.state.doc;
    const before = doc.sliceString(Math.max(0, from - open.length), from);
    const after = doc.sliceString(to, Math.min(doc.length, to + close.length));
    // Già racchiuso subito fuori dalla selezione: si toglie.
    if (before === open && after === close && !(kind === 'em' && isDoubled(doc, from, to))) {
      return {
        changes: [
          { from: from - open.length, to: from },
          { from: to, to: to + close.length },
        ],
        range: EditorSelection.range(from - open.length, to - open.length),
      };
    }
    const inner = doc.sliceString(from, to);
    // La selezione comprende i segni: si tolgono.
    if (inner.length >= open.length + close.length && inner.startsWith(open) && inner.endsWith(close)) {
      const stripped = inner.slice(open.length, inner.length - close.length);
      if (!(kind === 'em' && stripped.startsWith('*') && stripped.endsWith('*'))) {
        return {
          changes: { from, to, insert: stripped },
          range: EditorSelection.range(from, from + stripped.length),
        };
      }
    }
    // Gli spazi ai bordi della selezione restano fuori dai segni.
    const lead = inner.length - inner.trimStart().length;
    const trail = inner.length - inner.trimEnd().length;
    const a = from + lead;
    const b = Math.max(a, to - trail);
    return {
      changes: [
        { from: a, insert: open },
        { from: b, insert: close },
      ],
      range: a === b ? EditorSelection.cursor(a + open.length) : EditorSelection.range(a + open.length, b + open.length),
    };
  });
  view.dispatch(view.state.update(changes, { scrollIntoView: true, userEvent: 'input.format' }));
  view.focus();
  return true;
}

function isDoubled(doc: Text, from: number, to: number): boolean {
  return doc.sliceString(Math.max(0, from - 2), from) === '**' && doc.sliceString(to, to + 2) === '**';
}

const BLOCK_PREFIX = /^(\s{0,3})(#{1,6}\s+|>\s?|[-*+]\s+(\[[ xX]\]\s+)?|\d{1,9}[.)]\s+)/;

function prefixFor(kind: BlockKind, index: number): string {
  switch (kind) {
    case 'h1':
      return '# ';
    case 'h2':
      return '## ';
    case 'h3':
      return '### ';
    case 'h4':
      return '#### ';
    case 'quote':
      return '> ';
    case 'ul':
      return '- ';
    case 'ol':
      return `${index + 1}. `;
    default:
      return '';
  }
}

/** Tipo di blocco della riga, letto dalla sintassi scritta. */
export function lineKind(text: string): BlockKind {
  const m = /^\s{0,3}(#{1,6})\s/.exec(text);
  if (m) return (['h1', 'h2', 'h3', 'h4', 'h4', 'h4'] as BlockKind[])[m[1].length - 1];
  if (/^\s{0,3}>/.test(text)) return 'quote';
  if (/^\s*[-*+]\s/.test(text)) return 'ul';
  if (/^\s*\d{1,9}[.)]\s/.test(text)) return 'ol';
  return 'p';
}

function insideFence(state: EditorState, pos: number): { from: number; to: number } | null {
  let node = syntaxTree(state).resolveInner(pos, 1);
  for (let n: typeof node | null = node; n; n = n.parent) {
    if (n.name === 'FencedCode') return { from: n.from, to: n.to };
  }
  return null;
}

export function setBlock(view: EditorView, kind: BlockKind): boolean {
  const state = view.state;
  if (state.readOnly) return false;
  const sel = state.selection.main;
  const firstLine = state.doc.lineAt(sel.from);
  const lastLine = state.doc.lineAt(sel.to);

  if (kind === 'code') {
    const fence = insideFence(state, sel.from);
    if (fence) {
      // Toglie le recinzioni ``` del blocco.
      const open = state.doc.lineAt(fence.from);
      const close = state.doc.lineAt(fence.to);
      const changes = [{ from: open.from, to: Math.min(open.to + 1, state.doc.length) }];
      if (close.number !== open.number && /^\s*(`{3,}|~{3,})\s*$/.test(close.text)) {
        changes.push({ from: Math.max(close.from - 1, 0), to: close.to });
      }
      view.dispatch({ changes, userEvent: 'input.format' });
    } else {
      const insertBefore = '```\n';
      const insertAfter = '\n```';
      view.dispatch({
        changes: [
          { from: firstLine.from, insert: insertBefore },
          { from: lastLine.to, insert: insertAfter },
        ],
        selection: EditorSelection.cursor(lastLine.to + insertBefore.length),
        userEvent: 'input.format',
      });
    }
    view.focus();
    return true;
  }

  const lines = [];
  for (let n = firstLine.number; n <= lastLine.number; n++) lines.push(state.doc.line(n));
  const nonEmpty = lines.filter((l) => l.text.trim() !== '');
  const target = nonEmpty.length ? nonEmpty : lines;
  // Se tutte le righe hanno già quel tipo, il comando lo toglie (torna paragrafo).
  const allSame = kind !== 'p' && target.every((l) => lineKind(l.text) === kind);
  const effective: BlockKind = allSame ? 'p' : kind;

  let idx = 0;
  const changes = target.map((line) => {
    const m = BLOCK_PREFIX.exec(line.text);
    const oldLen = m ? m[0].length : 0;
    const insert = prefixFor(effective, idx++);
    return { from: line.from, to: line.from + oldLen, insert };
  });
  view.dispatch({ changes, userEvent: 'input.format', scrollIntoView: true });
  view.focus();
  return true;
}

/** Testo e intervallo del collegamento sotto il cursore, se c'è. */
export function linkAt(state: EditorState): { from: number; to: number; text: string; href: string } | null {
  const pos = state.selection.main.head;
  for (let n: ReturnType<typeof syntaxTree>['topNode'] | null = syntaxTree(state).resolveInner(pos, -1); n; n = n.parent) {
    if (n.name === 'Link') {
      const raw = state.doc.sliceString(n.from, n.to);
      const m = /^\[([\s\S]*)\]\(([^)\s]*)(?:\s+"[^"]*")?\)$/.exec(raw);
      if (m) return { from: n.from, to: n.to, text: m[1], href: m[2] };
    }
  }
  return null;
}

export function applyLink(view: EditorView, from: number, to: number, text: string, href: string) {
  const label = text.trim() || href;
  const url = href.trim().replace(/\s/g, '%20');
  const insert = url ? `[${label.replace(/[[\]]/g, '\\$&')}](${url})` : label;
  view.dispatch({
    changes: { from, to, insert },
    selection: EditorSelection.cursor(from + insert.length),
    userEvent: 'input.format',
  });
  view.focus();
}

export interface ActiveFormat {
  block: BlockKind;
  strong: boolean;
  em: boolean;
  s: boolean;
  code: boolean;
  u: boolean;
  link: boolean;
}

/** Formattazione attiva al cursore, per lo stato dei pulsanti. */
export function activeFormat(state: EditorState): ActiveFormat {
  const pos = state.selection.main.head;
  const line = state.doc.lineAt(pos);
  const out: ActiveFormat = { block: lineKind(line.text), strong: false, em: false, s: false, code: false, u: false, link: false };
  if (insideFence(state, pos)) out.block = 'code';
  for (let n: ReturnType<typeof syntaxTree>['topNode'] | null = syntaxTree(state).resolveInner(pos, -1); n; n = n.parent) {
    if (n.name === 'StrongEmphasis') out.strong = true;
    else if (n.name === 'Emphasis') out.em = true;
    else if (n.name === 'Strikethrough') out.s = true;
    else if (n.name === 'InlineCode') out.code = true;
    else if (n.name === 'Link') out.link = true;
  }
  const col = pos - line.from;
  const before = line.text.slice(0, col);
  out.u = before.lastIndexOf('<u>') > before.lastIndexOf('</u>');
  return out;
}
