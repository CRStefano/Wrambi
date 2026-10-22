/**
 * Corrispondenza tra il testo nell'editor e le pagine di un PDF.
 *
 * Il testo estratto (o modificato) e le pagine non hanno le stesse posizioni:
 * cambiano spazi, a capo, trattini di sillabazione, segni del Markdown. Per
 * ritrovare lo stesso punto si confrontano solo lettere e cifre, in minuscolo
 * e senza accenti, e si tiene la strada per tornare alle posizioni originali.
 * Serve a tenere allineate le viste Testo e Pagine, a seguire l'anteprima PDF
 * e a collegare le note scritte sulle pagine al testo.
 */

/** Testo ridotto a lettere e cifre, con la posizione di partenza di ogni carattere. */
export interface Norm {
  text: string;
  /** Per ogni carattere di `text`, la sua posizione nel testo di partenza. */
  map: Uint32Array;
}

const ALNUM = /[\p{L}\p{N}]/u;
const MARKS = /\p{M}/gu;

/** Appende la forma ridotta di un carattere (code point). */
function pushChar(c: string, at: number, out: string[], map: number[]) {
  const code = c.charCodeAt(0);
  if (code < 128) {
    if ((code >= 48 && code <= 57) || (code >= 97 && code <= 122)) {
      out.push(c);
      map.push(at);
    } else if (code >= 65 && code <= 90) {
      out.push(String.fromCharCode(code + 32));
      map.push(at);
    }
    return;
  }
  if (code === 0xad) return; // trattino morbido
  // Legature («ﬁ»), lettere accentate, lettere composte: si scompongono.
  const plain = c.normalize('NFKD').replace(MARKS, '').toLowerCase();
  for (const ch of plain) {
    if (ALNUM.test(ch)) {
      out.push(ch);
      map.push(at);
    }
  }
}

/** Riduce un testo; `skip` indica intervalli da ignorare (per esempio gli indicatori di pagina). */
export function normalize(src: string, skip: [number, number][] = []): Norm {
  const out: string[] = [];
  const map: number[] = [];
  let k = 0;
  let i = 0;
  while (i < src.length) {
    if (k < skip.length && i >= skip[k][0]) {
      if (i < skip[k][1]) i = skip[k][1];
      k++;
      continue;
    }
    const cp = src.codePointAt(i)!;
    const c = String.fromCodePoint(cp);
    pushChar(c, i, out, map);
    i += c.length;
  }
  return { text: out.join(''), map: Uint32Array.from(map) };
}

const MARKER = /^\[p\. (\d+)\]$/gm;

/** Indicatori «[p. N]» del testo estratto: posizione e numero di pagina. */
export function pageMarkers(text: string): { at: number; end: number; page: number }[] {
  const out: { at: number; end: number; page: number }[] = [];
  MARKER.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = MARKER.exec(text))) out.push({ at: m.index, end: m.index + m[0].length, page: Number(m[1]) });
  return out;
}

/** Testo dell'editor ridotto, senza gli indicatori di pagina. */
export function normalizeEditorText(text: string): Norm & { markers: { at: number; page: number; norm: number }[] } {
  const marks = pageMarkers(text);
  const norm = normalize(
    text,
    marks.map((m) => [m.at, m.end]),
  );
  return { ...norm, markers: marks.map((m) => ({ at: m.at, page: m.page, norm: lowerBound(norm.map, m.end) })) };
}

/** Primo indice di `arr` (crescente) con valore ≥ x. */
export function lowerBound(arr: ArrayLike<number>, x: number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/* ───────────────────────────── Indice delle pagine ───────────────────────────── */

/** Frammento di testo di una pagina, come lo dà pdf.js. */
export interface PageItem {
  str: string;
  /** Distanza dal bordo superiore della pagina (0–1) della cima del frammento. */
  top: number;
}

export interface PageText {
  norm: string;
  /** Per ogni carattere ridotto: frammento e posizione nel frammento. */
  item: Uint32Array;
  ch: Uint32Array;
  /** Primo carattere ridotto di ogni frammento (o quello successivo, se il frammento non ne ha). */
  itemStart: Uint32Array;
  top: Float32Array;
}

/** Testo ridotto di tutte le pagine (una classe: lo stato reattivo non la trasforma). */
export class PdfIndex {
  constructor(
    readonly pages: PageText[],
    /** Tutte le pagine di seguito. */
    readonly all: string,
    /** Dove comincia ogni pagina in `all`. */
    readonly starts: number[],
  ) {}
}

export function pageText(items: PageItem[]): PageText {
  const out: string[] = [];
  const item: number[] = [];
  const ch: number[] = [];
  const itemStart = new Uint32Array(items.length);
  items.forEach((it, idx) => {
    itemStart[idx] = out.length;
    const map: number[] = [];
    const before = out.length;
    const s = it.str;
    let i = 0;
    while (i < s.length) {
      const c = String.fromCodePoint(s.codePointAt(i)!);
      pushChar(c, i, out, map);
      i += c.length;
    }
    for (let j = before; j < out.length; j++) {
      item.push(idx);
      ch.push(map[j - before]);
    }
  });
  return {
    norm: out.join(''),
    item: Uint32Array.from(item),
    ch: Uint32Array.from(ch),
    itemStart,
    top: Float32Array.from(items.map((i) => i.top)),
  };
}

export function buildIndex(pages: PageText[]): PdfIndex {
  const starts: number[] = [];
  let n = 0;
  for (const p of pages) {
    starts.push(n);
    n += p.norm.length;
  }
  return new PdfIndex(pages, pages.map((p) => p.norm).join(''), starts);
}

/** Pagina (da 0) che contiene la posizione `g` di `all`. */
export function pageAt(idx: PdfIndex, g: number): number {
  let lo = 0;
  let hi = idx.starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (idx.starts[mid] <= g) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/* ───────────────────────────── Ricerca ───────────────────────────── */

/** Occorrenza di `needle` in `hay` più vicina a `near` (−1 se non c'è). */
export function findNear(hay: string, needle: string, near: number, limit = 400): number {
  if (!needle) return -1;
  let best = -1;
  let bestDist = Infinity;
  let i = hay.indexOf(needle);
  let n = 0;
  while (i !== -1 && n < limit) {
    const d = Math.abs(i - near);
    if (d < bestDist) {
      best = i;
      bestDist = d;
    } else if (i > near) break; // le occorrenze successive sono più lontane
    i = hay.indexOf(needle, i + 1);
    n++;
  }
  return best;
}

/**
 * Cerca in `hay` il punto che corrisponde a `src` a partire da `start`:
 * prova pezzi di lunghezza decrescente, spostandosi un po' più avanti se il
 * pezzo non si trova (testo cambiato, nota a piè di pagina, citazione).
 * Restituisce la posizione in `hay` che corrisponde a `start`.
 */
export function matchAt(src: string, start: number, hay: string, near: number): number | null {
  for (let shift = 0; shift <= 240; shift += 30) {
    const at = start + shift;
    if (at >= src.length) break;
    for (const len of [40, 24, 14]) {
      const needle = src.slice(at, at + len);
      if (needle.length < Math.min(len, 10)) continue;
      const found = findNear(hay, needle, near + shift);
      if (found >= 0) return Math.max(0, found - shift);
    }
  }
  return null;
}

/** Punto delle pagine (pagina da 0, distanza dal bordo superiore 0–1). */
export interface PagePoint {
  page: number;
  top: number;
}

/** Dal punto del testo (posizione nell'editor) al punto delle pagine. */
export function textToPage(ed: Norm, pos: number, idx: PdfIndex, nearHint?: (k: number) => number | null): PagePoint | null {
  if (!idx.all.length || !ed.text.length) return null;
  const k = Math.min(lowerBound(ed.map, pos), ed.text.length - 1);
  const near = nearHint?.(k) ?? (k / ed.text.length) * idx.all.length;
  const g = matchAt(ed.text, k, idx.all, near);
  if (g == null) {
    // Nessuna corrispondenza: si va in proporzione.
    const r = k / ed.text.length;
    const page = Math.min(idx.pages.length - 1, Math.floor(r * idx.pages.length));
    return { page, top: r * idx.pages.length - page };
  }
  const page = pageAt(idx, g);
  const p = idx.pages[page];
  const local = Math.min(g - idx.starts[page], p.norm.length - 1);
  return { page, top: local >= 0 ? p.top[p.item[local]] : 0 };
}

/** Primo frammento visibile dall'altezza `top` in giù. */
function itemFrom(p: PageText, top: number): number {
  let best = -1;
  let bestTop = Infinity;
  for (let i = 0; i < p.top.length; i++) {
    const t = p.top[i];
    if (t >= top - 0.004 && t < bestTop && p.itemStart[i] < p.norm.length && (i + 1 >= p.itemStart.length || p.itemStart[i + 1] > p.itemStart[i])) {
      bestTop = t;
      best = i;
    }
  }
  return best;
}

/** Dal punto delle pagine alla posizione nell'editor. */
export function pageToText(idx: PdfIndex, at: PagePoint, ed: Norm, nearHint?: (g: number) => number | null): number | null {
  const p = idx.pages[at.page];
  if (!p || !ed.text.length) return null;
  let local: number;
  if (!p.norm.length) local = 0;
  else {
    const it = itemFrom(p, at.top);
    local = it >= 0 ? p.itemStart[it] : at.top > 0.5 ? p.norm.length - 1 : 0;
  }
  let g = idx.starts[at.page] + local;
  // Pagina senza testo: si cerca dall'inizio della pagina successiva che ne ha.
  if (!p.norm.length) {
    let q = at.page + 1;
    while (q < idx.pages.length && !idx.pages[q].norm.length) q++;
    g = q < idx.pages.length ? idx.starts[q] : idx.all.length - 1;
  }
  const near = nearHint?.(g) ?? (g / Math.max(1, idx.all.length)) * ed.text.length;
  const k = matchAt(idx.all, g, ed.text, near);
  if (k == null) return ed.map[Math.min(ed.map.length - 1, Math.round(near))] ?? 0;
  return ed.map[Math.min(k, ed.map.length - 1)];
}

/* ───────────────────────────── Passaggi annotati ───────────────────────────── */

function commonSuffix(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
  return n;
}

function commonPrefix(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
}

/**
 * Trova un passaggio (già ridotto) in un testo ridotto, scegliendo
 * l'occorrenza con il contesto più simile e, a parità, la più vicina a `near`.
 */
export function findPassage(hay: string, quote: string, prefix: string, suffix: string, near: number): number {
  if (!quote) return -1;
  let best = -1;
  let bestScore = -Infinity;
  let i = hay.indexOf(quote);
  let n = 0;
  while (i !== -1 && n < 500) {
    const ctx = commonSuffix(hay.slice(Math.max(0, i - prefix.length), i), prefix) + commonPrefix(hay.slice(i + quote.length, i + quote.length + suffix.length), suffix);
    const score = ctx * 1e6 - Math.abs(i - near);
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
    i = hay.indexOf(quote, i + 1);
    n++;
  }
  return best;
}

/** Tratti di un passaggio sulle pagine: pagina e intervallo di caratteri ridotti. */
export interface Span {
  page: number;
  from: number;
  to: number;
}

/** Dove si trova sulle pagine un passaggio del testo (forma ridotta, con contesto). */
export function passageOnPages(idx: PdfIndex, quote: string, prefix: string, suffix: string, near: number): Span[] {
  const g = findPassage(idx.all, quote, prefix, suffix, near);
  if (g < 0) return [];
  const out: Span[] = [];
  let from = g;
  const end = g + quote.length;
  while (from < end) {
    const page = pageAt(idx, from);
    const pageEnd = idx.starts[page] + idx.pages[page].norm.length;
    const to = Math.min(end, pageEnd);
    if (to > from) out.push({ page, from: from - idx.starts[page], to: to - idx.starts[page] });
    from = Math.max(to, from + 1);
  }
  return out;
}

/**
 * Dal testo selezionato sulle pagine all'intervallo nel testo dell'editor.
 * `sel` è il testo ridotto della selezione, `g` la sua posizione in `idx.all`.
 */
export function selectionToText(ed: Norm, idx: PdfIndex, sel: string, g: number, nearText?: number): { from: number; to: number } | null {
  if (!sel || !ed.text.length) return null;
  const near = nearText ?? (g / Math.max(1, idx.all.length)) * ed.text.length;
  let start: number;
  let end: number;
  if (sel.length <= 60) {
    start = findNear(ed.text, sel, near);
    if (start < 0) return null;
    end = start + sel.length;
  } else {
    start = findNear(ed.text, sel.slice(0, 40), near);
    if (start < 0) return null;
    const tail = sel.slice(-40);
    end = findNear(ed.text, tail, start + sel.length - 40);
    if (end < start) return null;
    end += tail.length;
    // Una selezione molto più lunga nel testo che sulla pagina è un abbinamento sbagliato.
    if (end - start > sel.length * 1.5 + 40) return null;
  }
  return { from: ed.map[start], to: ed.map[end - 1] + 1 };
}
