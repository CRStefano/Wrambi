/**
 * Citazioni nell'editor: `[@chiave]` e `@chiave` evidenziate quando la chiave
 * è nella bibliografia, la voce completa al passaggio del mouse e i
 * suggerimenti mentre si scrive dopo `@`.
 */
import { autocompletion, type Completion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import { RangeSetBuilder, StateEffect, type Extension } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, hoverTooltip, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { bibIndex } from '../biblio/store.svelte';
import { describe, formatReference } from '../biblio/format';
import { plain } from '../convert/ast';
import { settings } from '../state.svelte';

const KEY = '[\\p{L}\\p{N}_][\\p{L}\\p{N}_:.#$%&+?<>~/-]*';
/** `[vedi @a, p. 3; @b]` (non seguito da `(` o `[`: quelli sono collegamenti) o `@chiave`. */
const CITE_RE = new RegExp(`\\[[^\\[\\]\\n]*?-?@${KEY}[^\\[\\]\\n]*\\](?![(\\[])|(?<![\\p{L}\\p{N}_@])@${KEY}`, 'gu');
const KEY_RE = new RegExp(`-?@(${KEY})`, 'gu');

/** Da inviare quando la bibliografia cambia, per ridisegnare le citazioni. */
export const refreshCites = StateEffect.define<null>();

const CITE = Decoration.mark({ class: 'cm-cite' });
const UNKNOWN = Decoration.mark({ class: 'cm-cite cm-cite-unknown' });

/** Le chiavi di una citazione, senza la punteggiatura finale ("@rossi." → "rossi"). */
function keysIn(s: string): string[] {
  return [...s.matchAll(KEY_RE)].map((m) => m[1].replace(/[.:,;?#$%&+<>~/-]+$/, ''));
}

function build(view: EditorView): DecorationSet {
  const idx = bibIndex();
  const b = new RangeSetBuilder<Decoration>();
  if (!idx) return b.finish();
  for (const { from, to } of view.visibleRanges) {
    const text = view.state.sliceDoc(from, to);
    for (const m of text.matchAll(CITE_RE)) {
      const keys = keysIn(m[0]);
      if (!keys.length) continue;
      const known = keys.filter((k) => idx.has(k)).length;
      // Un "@nome" qualsiasi (un indirizzo, una menzione) non è una citazione.
      if (!known && !m[0].startsWith('[')) continue;
      const start = from + m.index;
      // "@rossi2020." : il punto finale è punteggiatura, non parte della citazione.
      const len = m[0].startsWith('[') ? m[0].length : m[0].replace(/[.:,;?#$%&+<>~/-]+$/, '').length;
      b.add(start, start + len, known === keys.length ? CITE : UNKNOWN);
    }
  }
  return b.finish();
}

const citeMarks = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = build(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged || u.transactions.some((t) => t.effects.some((e) => e.is(refreshCites)))) {
        this.decorations = build(u.view);
      }
    }
  },
  { decorations: (v) => v.decorations },
);

const citeTooltip = hoverTooltip((view, pos) => {
  const idx = bibIndex();
  if (!idx) return null;
  const line = view.state.doc.lineAt(pos);
  for (const m of line.text.matchAll(CITE_RE)) {
    const from = line.from + m.index;
    const to = from + m[0].length;
    if (pos < from || pos > to) continue;
    const entries = keysIn(m[0]).map((k) => ({ k, e: idx.get(k) }));
    if (!entries.some((x) => x.e)) return null;
    return {
      pos: from,
      end: to,
      above: true,
      create() {
        const dom = document.createElement('div');
        dom.className = 'cm-cite-tip';
        for (const { k, e } of entries) {
          const p = document.createElement('p');
          if (!e) {
            p.className = 'missing';
            p.textContent = `@${k}: ?`;
          } else {
            for (const n of formatReference(e, idx, settings.docLanguage)) {
              if (n.t === 'em') {
                const i = document.createElement('i');
                i.textContent = plain(n.c);
                p.append(i);
              } else p.append(plain([n]));
            }
          }
          dom.append(p);
        }
        return { dom };
      },
    };
  }
  return null;
});

/** Suggerimenti dopo "@": autore, anno e titolo, filtrati mentre si scrive. */
function citeCompletions(ctx: CompletionContext): CompletionResult | null {
  const idx = bibIndex();
  if (!idx) return null;
  const word = ctx.matchBefore(new RegExp(`(?<![\\p{L}\\p{N}_])-?@(${KEY})?`, 'u'));
  if (!word) return null;
  const at = word.text.indexOf('@');
  const options: Completion[] = [];
  for (const e of idx.byKey.values()) {
    const d = describe(e);
    options.push({
      label: e.id,
      detail: [d.who, d.year].filter(Boolean).join(', '),
      info: d.title,
      type: 'text',
    });
  }
  return { from: word.from + at + 1, options, validFor: new RegExp(`^${KEY}$`, 'u') };
}

export const citations: Extension = [
  citeMarks,
  citeTooltip,
  autocompletion({ override: [citeCompletions], activateOnTyping: true, icons: false, closeOnBlur: true }),
  EditorView.baseTheme({
    '.cm-cite': { color: 'var(--link, #2450b2)', borderBottom: '1px dotted currentColor' },
    '.cm-cite-unknown': { color: 'var(--rubric, #c8102e)', borderBottomStyle: 'dashed' },
    '.cm-tooltip.cm-tooltip-hover': { border: '1px solid var(--rule)', borderRadius: '8px', background: 'var(--raised)', boxShadow: 'var(--shadow)' },
    '.cm-cite-tip': { maxWidth: '440px', padding: '8px 12px', fontFamily: 'var(--ui)', fontSize: '12.5px', lineHeight: '1.45', color: 'var(--ink)' },
    '.cm-cite-tip p': { margin: '0 0 4px', paddingLeft: '1.6em', textIndent: '-1.6em' },
    '.cm-cite-tip p:last-child': { marginBottom: '0' },
    '.cm-cite-tip p.missing': { color: 'var(--rubric)' },
    '.cm-tooltip.cm-tooltip-autocomplete': { border: '1px solid var(--rule)', borderRadius: '8px', background: 'var(--raised)', boxShadow: 'var(--shadow)', fontFamily: 'var(--ui)' },
    '.cm-tooltip-autocomplete > ul > li': { padding: '3px 10px !important' },
    '.cm-tooltip-autocomplete > ul > li[aria-selected]': { background: 'var(--chrome) !important', color: 'var(--ink) !important' },
    '.cm-completionDetail': { marginLeft: '10px', fontStyle: 'normal', color: 'var(--ink-3)' },
    '.cm-completionInfo': { padding: '6px 10px', maxWidth: '320px', fontFamily: 'var(--ui)', fontSize: '12.5px' },
  }),
];
