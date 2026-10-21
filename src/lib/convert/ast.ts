/**
 * Struttura del documento.
 *
 * Il testo scritto in Wrambi è Markdown (CommonMark + barrato, tabelle e
 * sottolineato con <u>…</u>). Viene analizzato una volta in questo albero, da
 * cui tutti i formati di uscita vengono generati: così HTML, LaTeX, Typst,
 * TXT ed EPUB rispettano la stessa struttura indicata con la barra.
 */
import MarkdownIt, { type MarkdownIt as MarkdownItInstance, type StateInline, type Token } from 'markdown-it';
import type { CiteItem } from '../biblio/format';

export type Inline =
  | { t: 'text'; v: string }
  | { t: 'strong'; c: Inline[] }
  | { t: 'em'; c: Inline[] }
  | { t: 'u'; c: Inline[] }
  | { t: 's'; c: Inline[] }
  | { t: 'code'; v: string }
  | { t: 'link'; href: string; title: string; c: Inline[] }
  | { t: 'image'; src: string; alt: string }
  | { t: 'br' }
  | { t: 'soft' }
  /** Citazione: `[@chiave, p. 3]` (tra parentesi) o `@chiave` (nel testo). */
  | { t: 'cite'; items: CiteItem[]; bracket: boolean }
  /** Nota di Wrambi esportata come nota a piè di pagina: indice in `notes`. */
  | { t: 'note'; n: number };

export type Align = 'left' | 'center' | 'right' | null;

export type Block =
  | { t: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6; c: Inline[] }
  | { t: 'para'; c: Inline[] }
  | { t: 'list'; ordered: boolean; start: number; tight: boolean; items: Block[][] }
  | { t: 'quote'; c: Block[] }
  | { t: 'code'; lang: string; v: string }
  | { t: 'hr' }
  | { t: 'table'; align: Align[]; head: Inline[][]; rows: Inline[][][] };

export interface Doc {
  blocks: Block[];
}

/** Sottolineato: `<u>` e `</u>` sono gli unici tag HTML riconosciuti. */
function underlinePlugin(md: MarkdownItInstance) {
  md.inline.ruler.before('emphasis', 'wrambi_u', (state: StateInline, silent: boolean) => {
    const src = state.src;
    const pos = state.pos;
    if (src.charCodeAt(pos) !== 0x3c /* < */) return false;
    let tag: 'u_open' | 'u_close' | null = null;
    let len = 0;
    if (src.startsWith('<u>', pos)) {
      tag = 'u_open';
      len = 3;
    } else if (src.startsWith('</u>', pos)) {
      tag = 'u_close';
      len = 4;
    }
    if (!tag) return false;
    if (!silent) state.push(tag, 'u', tag === 'u_open' ? 1 : -1);
    state.pos += len;
    return true;
  });
}

/** Contesto dell'analisi: le chiavi della bibliografia, per riconoscere le citazioni. */
export interface ParseEnv {
  citeKeys?: Set<string>;
  [k: string]: unknown;
}

const KEY = '[\\p{L}\\p{N}_][\\p{L}\\p{N}_:.#$%&+?<>~/-]*';
const CITE_PART = new RegExp(`^\\s*(.*?)\\s*(-?)@(${KEY})(.*)$`, 'u');

/** Una parte di `[vedi @rossi2020, p. 3; @bianchi]`. */
function citePart(part: string): CiteItem | null {
  const m = CITE_PART.exec(part);
  if (!m) return null;
  let key = m[3];
  let rest = m[4];
  // La punteggiatura finale non fa parte della chiave: "@rossi2020." → "rossi2020".
  const trail = /[.:,;?#$%&+<>~/-]+$/.exec(key);
  if (trail) {
    key = key.slice(0, -trail[0].length);
    rest = trail[0] + rest;
  }
  const locator = rest.replace(/^\s*,\s*/, '').trim();
  const item: CiteItem = { key };
  if (m[1]) item.prefix = m[1];
  if (m[2]) item.suppressAuthor = true;
  if (locator) item.locator = locator;
  return item;
}

/** Citazioni in stile Pandoc, riconosciute solo se la chiave è nella bibliografia. */
function citationPlugin(md: MarkdownItInstance) {
  md.inline.ruler.before('link', 'wrambi_cite', (state: StateInline, silent: boolean) => {
    const keys = (state.env as ParseEnv | undefined)?.citeKeys;
    if (!keys?.size) return false;
    const src = state.src;
    const pos = state.pos;
    const ch = src.charCodeAt(pos);
    if (ch === 0x5b /* [ */) {
      const end = src.indexOf(']', pos);
      if (end < 0) return false;
      const inner = src.slice(pos + 1, end);
      if (!inner.includes('@') || inner.includes('[')) return false;
      // [testo](link) e [testo][rif] restano collegamenti.
      const next = src.charCodeAt(end + 1);
      if (next === 0x28 || next === 0x5b) return false;
      const items = inner.split(';').map(citePart);
      if (items.some((i) => !i) || !items.some((i) => keys.has(i!.key))) return false;
      if (!silent) {
        const tok = state.push('wrambi_cite', '', 0);
        tok.meta = { items, bracket: true };
      }
      state.pos = end + 1;
      return true;
    }
    if (ch === 0x40 /* @ */) {
      const prev = pos > 0 ? src[pos - 1] : ' ';
      if (/[\p{L}\p{N}_]/u.test(prev)) return false; // indirizzi email
      const m = new RegExp(`^@(${KEY})`, 'u').exec(src.slice(pos));
      if (!m) return false;
      const item = citePart(m[0]);
      if (!item || !keys.has(item.key)) return false;
      let end = pos + 1 + item.key.length;
      const cite: CiteItem = { key: item.key };
      // "@rossi2020 [p. 33]": il luogo tra parentesi quadre subito dopo (come in Pandoc).
      const loc = /^ ?\[([^\[\]@\n]+)\](?![(\[])/.exec(src.slice(end));
      if (loc) {
        cite.locator = loc[1].trim();
        end += loc[0].length;
      }
      if (!silent) {
        const tok = state.push('wrambi_cite', '', 0);
        tok.meta = { items: [cite], bracket: false };
      }
      state.pos = end;
      return true;
    }
    return false;
  });
}

/** Segnaposto delle note di Wrambi: ⟦wn:3⟧ (caratteri che non compaiono nei testi). */
export const NOTE_MARK = (n: number) => `\u27e6wn:${n}\u27e7`;

const NOTE_RE = /\u27e6wn:(\d+)\u27e7/g;

/** Toglie i segnaposto da un testo che non può contenerli (codice, citazioni). */
export function stripNoteMarks(s: string): { text: string; notes: number[] } {
  const notes: number[] = [];
  const text = s.replace(NOTE_RE, (_, n: string) => {
    notes.push(Number(n));
    return '';
  });
  return { text, notes };
}

/** Divide i nodi di testo ai segnaposto delle note (anche dentro enfasi e collegamenti). */
function expandNoteMarks(list: Inline[]): Inline[] {
  const out: Inline[] = [];
  for (const n of list) {
    if (n.t === 'text' && n.v.includes('\u27e6')) {
      let last = 0;
      for (const m of n.v.matchAll(NOTE_RE)) {
        if (m.index > last) out.push({ t: 'text', v: n.v.slice(last, m.index) });
        out.push({ t: 'note', n: Number(m[1]) });
        last = m.index + m[0].length;
      }
      if (last < n.v.length) out.push({ t: 'text', v: n.v.slice(last) });
    } else {
      if ('c' in n) n.c = expandNoteMarks(n.c);
      out.push(n);
    }
  }
  return out;
}

let parser: MarkdownItInstance | null = null;

export function markdown(): MarkdownItInstance {
  if (!parser) {
    parser = new MarkdownIt('commonmark', { html: false, linkify: false, typographer: false })
      .enable(['strikethrough', 'table'])
      .use(underlinePlugin)
      .use(citationPlugin);
  }
  return parser;
}

const INLINE_PAIRS: Record<string, 'strong' | 'em' | 'u' | 's'> = {
  strong_open: 'strong',
  em_open: 'em',
  u_open: 'u',
  s_open: 's',
};

function inlines(tokens: Token[]): Inline[] {
  const root: Inline[] = [];
  const stack: { node: Inline & { c: Inline[] }; close: string }[] = [];
  const out = () => (stack.length ? stack[stack.length - 1].node.c : root);

  for (const tok of tokens) {
    const kind = INLINE_PAIRS[tok.type];
    if (kind) {
      const node = { t: kind, c: [] as Inline[] } as Inline & { c: Inline[] };
      out().push(node);
      stack.push({ node, close: tok.type.replace('_open', '_close') });
      continue;
    }
    if (tok.type === 'link_open') {
      const node = { t: 'link', href: String(tok.attrGet('href') ?? ''), title: String(tok.attrGet('title') ?? ''), c: [] } as Inline & {
        c: Inline[];
      };
      out().push(node);
      stack.push({ node, close: 'link_close' });
      continue;
    }
    if (tok.type.endsWith('_close')) {
      // Chiusura: risale fino all'apertura corrispondente (tollera <u> non bilanciati).
      const idx = findLast(stack, (s) => s.close === tok.type);
      if (idx >= 0) stack.length = idx;
      continue;
    }
    switch (tok.type) {
      case 'text':
        pushText(out(), tok.content);
        break;
      case 'code_inline': {
        const { text, notes } = stripNoteMarks(tok.content);
        out().push({ t: 'code', v: text });
        for (const n of notes) out().push({ t: 'note', n });
        break;
      }
      case 'softbreak':
        out().push({ t: 'soft' });
        break;
      case 'hardbreak':
        out().push({ t: 'br' });
        break;
      case 'image':
        out().push({ t: 'image', src: String(tok.attrGet('src') ?? ''), alt: tok.content || plain(inlines(tok.children ?? [])) });
        break;
      case 'wrambi_cite': {
        const meta = tok.meta as { items: CiteItem[]; bracket: boolean };
        // Una nota che finisce dentro le parentesi della citazione va subito dopo.
        const notes: number[] = [];
        const clean = (v?: string) => {
          if (!v) return v;
          const r = stripNoteMarks(v);
          notes.push(...r.notes);
          return r.text.trim() || undefined;
        };
        const items = meta.items.map((it) => {
          const c: CiteItem = { ...it, prefix: clean(it.prefix), locator: clean(it.locator) };
          if (!c.prefix) delete c.prefix;
          if (!c.locator) delete c.locator;
          return c;
        });
        out().push({ t: 'cite', items, bracket: meta.bracket });
        for (const n of notes) out().push({ t: 'note', n });
        break;
      }
      default:
        if (tok.content) pushText(out(), tok.content);
    }
  }
  return expandNoteMarks(root);
}

function findLast<T>(arr: T[], pred: (x: T) => boolean): number {
  for (let i = arr.length - 1; i >= 0; i--) if (pred(arr[i])) return i;
  return -1;
}

function pushText(target: Inline[], v: string) {
  const last = target[target.length - 1];
  if (last && last.t === 'text') last.v += v;
  else target.push({ t: 'text', v });
}

/** Testo semplice di una sequenza inline. */
export function plain(c: Inline[]): string {
  let s = '';
  for (const n of c) {
    switch (n.t) {
      case 'text':
      case 'code':
        s += n.v;
        break;
      case 'image':
        s += n.alt;
        break;
      case 'br':
      case 'soft':
        s += ' ';
        break;
      case 'cite':
        s += n.items.map((i) => '@' + i.key).join('; ');
        break;
      case 'note':
        break;
      default:
        s += plain(n.c);
    }
  }
  return s;
}

export function parse(src: string, env: ParseEnv = {}): Doc {
  const tokens = markdown().parse(src, env as Record<string, unknown> as never);
  let i = 0;

  function blocks(until: string | null): Block[] {
    const out: Block[] = [];
    while (i < tokens.length) {
      const tok = tokens[i];
      if (until && tok.type === until) {
        i++;
        return out;
      }
      switch (tok.type) {
        case 'heading_open': {
          const level = Number(tok.tag.slice(1)) as 1 | 2 | 3 | 4 | 5 | 6;
          const inline = tokens[i + 1];
          out.push({ t: 'heading', level, c: inlines(inline.children ?? []) });
          i += 3;
          break;
        }
        case 'paragraph_open': {
          const inline = tokens[i + 1];
          out.push({ t: 'para', c: inlines(inline.children ?? []) });
          i += 3;
          break;
        }
        case 'bullet_list_open':
        case 'ordered_list_open': {
          const ordered = tok.type === 'ordered_list_open';
          const start = ordered ? Number(tok.attrGet('start') ?? 1) : 1;
          const close = ordered ? 'ordered_list_close' : 'bullet_list_close';
          i++;
          const items: Block[][] = [];
          let tight = true;
          while (i < tokens.length && tokens[i].type !== close) {
            if (tokens[i].type === 'list_item_open') {
              i++;
              // markdown-it nasconde i paragrafi negli elenchi "stretti".
              for (let k = i; k < tokens.length && tokens[k].type !== 'list_item_close'; k++) {
                if (tokens[k].type === 'paragraph_open' && !tokens[k].hidden) tight = false;
              }
              items.push(blocks('list_item_close'));
            } else i++;
          }
          i++;
          out.push({ t: 'list', ordered, start: Number.isFinite(start) ? start : 1, tight, items });
          break;
        }
        case 'blockquote_open':
          i++;
          out.push({ t: 'quote', c: blocks('blockquote_close') });
          break;
        case 'fence':
        case 'code_block':
          // Un blocco di codice non può contenere note: i segnaposto si tolgono.
          out.push({ t: 'code', lang: (tok.info || '').trim().split(/\s+/)[0] ?? '', v: stripNoteMarks(tok.content).text.replace(/\n$/, '') });
          i++;
          break;
        case 'hr':
          out.push({ t: 'hr' });
          i++;
          break;
        case 'table_open': {
          i++;
          const align: Align[] = [];
          const head: Inline[][] = [];
          const rows: Inline[][][] = [];
          let inHead = false;
          let row: Inline[][] | null = null;
          while (i < tokens.length && tokens[i].type !== 'table_close') {
            const t = tokens[i];
            if (t.type === 'thead_open') inHead = true;
            else if (t.type === 'thead_close') inHead = false;
            else if (t.type === 'tr_open') row = [];
            else if (t.type === 'tr_close') {
              if (row && !inHead) rows.push(row);
              row = null;
            } else if (t.type === 'th_open' || t.type === 'td_open') {
              const style = String(t.attrGet('style') ?? '');
              const m = /text-align:(left|center|right)/.exec(style);
              if (inHead) align.push((m?.[1] as Align) ?? null);
              const cell = inlines(tokens[i + 1]?.children ?? []);
              if (inHead) head.push(cell);
              else row?.push(cell);
            }
            i++;
          }
          i++;
          out.push({ t: 'table', align, head, rows });
          break;
        }
        default:
          i++;
      }
    }
    return out;
  }

  return { blocks: blocks(null) };
}

/** Titolo del documento: il primo titolo, altrimenti la prima riga non vuota. */
export function docTitle(doc: Doc, fallback: string): string {
  for (const b of doc.blocks) {
    if (b.t === 'heading') {
      const s = plain(b.c).trim();
      if (s) return s;
    }
  }
  for (const b of doc.blocks) {
    if (b.t === 'para') {
      const s = plain(b.c).trim();
      if (s) return s.length > 80 ? s.slice(0, 77) + '…' : s;
    }
  }
  return fallback;
}
