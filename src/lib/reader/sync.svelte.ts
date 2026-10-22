/**
 * Testo e pagine di un PDF che vanno di pari passo: stesso punto passando da
 * una vista all'altra, scorrimento insieme nella vista affiancata, note ed
 * evidenziazioni scritte sulle pagine.
 */
import { tick } from 'svelte';
import { editor } from '../editor/controller';
import { createNote, reader } from '../docs.svelte';
import { popoverPlacement } from '../actions';
import { t } from '../i18n';
import { doc, notesStore, notify, ui } from '../state.svelte';
import {
  lowerBound,
  normalize,
  normalizeEditorText,
  pageToText,
  passageOnPages,
  selectionToText,
  textToPage,
  type PagePoint,
  type PdfIndex,
} from './textmap';

export type PdfView = 'text' | 'pages' | 'split';

/** Cresce (con un attimo di ritardo) quando il testo cambia: ricalcola i segni sulle pagine. */
export const textState = $state({ version: 0 });

let bumpTimer: ReturnType<typeof setTimeout> | undefined;
editor.onChange(() => {
  clearTimeout(bumpTimer);
  bumpTimer = setTimeout(() => textState.version++, 350);
});
editor.onLoad(() => {
  clearTimeout(bumpTimer);
  textState.version++;
});

/* ───────────────────────────── Testo ridotto dell'editor ───────────────────────────── */

let cache: { version: number; norm: ReturnType<typeof normalizeEditorText> } | null = null;

export function editorNorm() {
  if (!cache || cache.version !== editor.version) cache = { version: editor.version, norm: normalizeEditorText(editor.getText()) };
  return cache.norm;
}

/** Con gli indicatori «[p. N]» la pagina di un punto del testo si conosce già: serve da guida. */
function nearFromText(idx: PdfIndex) {
  const ed = editorNorm();
  return (k: number): number | null => {
    if (!ed.markers.length) return null;
    let m = -1;
    for (let i = 0; i < ed.markers.length && ed.markers[i].norm <= k; i++) m = i;
    if (m < 0) return null;
    const page = ed.markers[m].page - 1;
    if (page >= idx.pages.length) return null;
    return idx.starts[page] + (k - ed.markers[m].norm);
  };
}

function nearFromPages(idx: PdfIndex) {
  const ed = editorNorm();
  return (g: number): number | null => {
    if (!ed.markers.length) return null;
    let page = 0;
    while (page + 1 < idx.starts.length && idx.starts[page + 1] <= g) page++;
    const m = ed.markers.find((x) => x.page === page + 1);
    return m ? m.norm + (g - idx.starts[page]) : null;
  };
}

/** Punto delle pagine che corrisponde a una posizione del testo. */
export function textPointToPage(pos: number): PagePoint | null {
  const idx = reader.index;
  if (!idx) return null;
  return textToPage(editorNorm(), pos, idx, nearFromText(idx));
}

/** Posizione del testo che corrisponde a un punto delle pagine. */
export function pagePointToText(pt: PagePoint): number | null {
  const idx = reader.index;
  if (!idx) return null;
  return pageToText(idx, pt, editorNorm(), nearFromPages(idx));
}

/* ───────────────────────────── Vista del PDF ───────────────────────────── */

export interface PagesApi {
  currentPoint(): PagePoint | null;
  scrollToPoint(pt: PagePoint, opts?: { smooth?: boolean }): void;
  flash(id: string): void;
}

let pagesApi: PagesApi | null = null;

/** La vista a pagine (di EditorPane) si registra qui mentre è visibile. */
export function registerPages(api: PagesApi | null) {
  pagesApi = api;
}

/** Punto da cui la vista a pagine deve partire quando compare. */
export const pagesStart = $state<{ point: PagePoint | null }>({ point: null });

/** Le pagine si possono mostrare: PDF aperto (in lettura o mentre se ne modifica il testo). */
export function pagesAvailable(): boolean {
  return doc.readKind === 'pdf' && !!reader.pdf;
}

/** Cambia vista restando nello stesso punto del documento. */
export async function setPdfView(next: PdfView) {
  const cur = doc.pdfView;
  if (cur === next) return;
  let pt: PagePoint | null = null;
  let pos: number | null = null;
  if (cur === 'pages') {
    pt = pagesApi?.currentPoint() ?? null;
    pos = pt ? pagePointToText(pt) : null;
  } else {
    pos = editor.topPosition();
    pt = textPointToPage(pos);
  }
  pagesStart.point = pt;
  doc.pdfView = next;
  await tick();
  if (next !== 'pages' && pos != null) {
    const p = pos;
    requestAnimationFrame(() => {
      lead('pages');
      editor.scrollToPosition(p);
    });
  }
  if (next !== 'text' && pt && pagesApi) {
    lead('text');
    pagesApi.scrollToPoint(pt);
  }
}

/* Vista affiancata: chi scorre guida, l'altro segue. */

let leader: 'text' | 'pages' | null = null;
let leaderUntil = 0;
let frame = 0;

function lead(who: 'text' | 'pages') {
  leader = who;
  leaderUntil = performance.now() + 260;
}

function following(who: 'text' | 'pages'): boolean {
  return leader !== null && leader !== who && performance.now() < leaderUntil;
}

editor.onScroll(() => {
  if (doc.pdfView !== 'split' || !pagesApi || following('text')) return;
  lead('text');
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(() => {
    const pt = textPointToPage(editor.topPosition());
    if (pt) pagesApi?.scrollToPoint(pt);
  });
});

/** Chiamato dalla vista a pagine quando chi legge la fa scorrere. */
export function pagesScrolled(pt: PagePoint) {
  if (doc.pdfView !== 'split' || following('pages')) return;
  lead('pages');
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(() => {
    const pos = pagePointToText(pt);
    if (pos != null) editor.scrollToPosition(pos);
  });
}

/* ───────────────────────────── Note sulle pagine ───────────────────────────── */

export interface PageMark {
  id: string;
  kind: 'note' | 'highlight';
  page: number;
  from: number;
  to: number;
  /** Testo ridotto del tratto (per verificare il posto sulla pagina). */
  quote: string;
  /** Numero della nota (solo sull'ultimo tratto). */
  n?: number;
}

/** Note ed evidenziazioni del documento aperto, collocate sulle pagine. */
export function pageMarks(): PageMark[] {
  void textState.version;
  const idx = reader.index;
  if (!idx || !doc.key) return [];
  const notes = notesStore.list.filter((n) => n.docKey === doc.key && !n.orphan);
  if (!notes.length) return [];
  const text = editor.getText();
  const ed = editorNorm();
  const live = new Map(editor.noteRanges().map((r) => [r.id, r]));
  const near = nearFromText(idx);
  const numbered = editor
    .noteRanges()
    .filter((r) => r.to > r.from && r.kind !== 'highlight')
    .sort((a, b) => a.from - b.from);
  const out: PageMark[] = [];
  for (const n of notes) {
    const r = live.get(n.id);
    const from = r?.from ?? n.from;
    const to = r?.to ?? n.to;
    if (to <= from) continue;
    const quote = normalize(text.slice(from, to)).text;
    if (!quote) continue;
    const prefix = normalizeEditorText(text.slice(Math.max(0, from - 60), from)).text.slice(-30);
    const suffix = normalizeEditorText(text.slice(to, to + 60)).text.slice(0, 30);
    const k = lowerBound(ed.map, from);
    const guess = near(k) ?? (k / Math.max(1, ed.text.length)) * idx.all.length;
    let spans = passageOnPages(idx, quote, prefix, suffix, guess);
    // Passaggio riscritto nel testo modificato: sulle pagine originali c'è ancora quello di prima.
    if (!spans.length && n.src) spans = passageOnPages(idx, normalize(n.src.quote).text, normalize(n.src.prefix).text.slice(-30), normalize(n.src.suffix).text.slice(0, 30), guess);
    const number = n.kind === 'highlight' ? undefined : numbered.findIndex((x) => x.id === n.id) + 1 || undefined;
    spans.forEach((s, i) =>
      out.push({
        id: n.id,
        kind: n.kind === 'highlight' ? 'highlight' : 'note',
        page: s.page,
        from: s.from,
        to: s.to,
        quote: idx.pages[s.page].norm.slice(s.from, s.to),
        n: i === spans.length - 1 ? number : undefined,
      }),
    );
  }
  return out;
}

/** Selezione sulle pagine: inizio e fine (pagina da 0, carattere ridotto della pagina). */
export interface PageSelection {
  startPage: number;
  startAt: number;
  endPage: number;
  endAt: number;
  /** Rettangolo della selezione sullo schermo. */
  rect: DOMRect;
}

export const pageSelection = $state<{ sel: PageSelection | null }>({ sel: null });

/** Dalla selezione sulle pagine all'intervallo del testo nell'editor. */
function selectionRange(sel: PageSelection): { from: number; to: number } | null {
  const idx = reader.index;
  if (!idx) return null;
  const g0 = idx.starts[sel.startPage] + sel.startAt;
  const g1 = idx.starts[sel.endPage] + sel.endAt;
  if (g1 <= g0) return null;
  const ed = editorNorm();
  const near = nearFromPages(idx)(g0) ?? undefined;
  return selectionToText(ed, idx, idx.all.slice(g0, g1), g0, near);
}

/** Nota (con il riquadro per scriverla) o evidenziazione sul testo selezionato nelle pagine. */
export function annotateSelection(kind: 'note' | 'highlight', sel = pageSelection.sel): boolean {
  if (!sel) return false;
  const r = selectionRange(sel);
  window.getSelection()?.removeAllRanges();
  pageSelection.sel = null;
  if (!r) {
    notify(t('Questo passaggio non si trova nel testo del documento (forse è stato modificato): non si può annotare qui.'), 'info');
    return true;
  }
  if (kind === 'highlight') {
    createNote(r, '', 'highlight');
    return true;
  }
  const quote = editor.getText().slice(r.from, r.to);
  ui.popover = { noteId: null, draft: { from: r.from, to: r.to, quote }, ...popoverPlacement(sel.rect) };
  return true;
}

/** Porta in vista sulle pagine una nota del documento aperto. */
export function revealNoteOnPages(id: string): boolean {
  if (!pagesApi || !reader.index) return false;
  const mark = pageMarks().find((m) => m.id === id);
  if (!mark) return false;
  const p = reader.index.pages[mark.page];
  const top = mark.from < p.item.length ? p.top[p.item[mark.from]] : 0;
  pagesApi.scrollToPoint({ page: mark.page, top: Math.max(0, top - 0.04) }, { smooth: true });
  pagesApi.flash(id);
  return true;
}
