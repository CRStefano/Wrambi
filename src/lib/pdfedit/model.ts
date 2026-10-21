/**
 * Modifica dei PDF conservando l'impaginazione: le pagine restano quelle
 * originali e le modifiche si disegnano sopra (testo nuovo, testo
 * sostituito, evidenziazioni, coperture, immagini), oppure riordinano le
 * pagine (ruota, sposta, elimina, inserisci, unisci un altro PDF).
 *
 * Tutte le coordinate sono nello spazio della pagina PDF: punti tipografici,
 * origine in basso a sinistra, come le usano sia pdf.js sia pdf-lib.
 *
 * Un limite onesto: un PDF non ha "paragrafi" da reimpaginare. Il testo
 * sostituito viene coperto e riscritto sopra; quello originale resta nel
 * file sotto la copertura (non si vede, ma un programma lo può estrarre).
 */
import { BlendMode, PDFDocument, StandardFonts, degrees, rgb, type PDFFont, type PDFImage, type PDFPage } from 'pdf-lib';

export type RGB = [number, number, number];

export interface FontSpec {
  family: 'serif' | 'sans' | 'mono';
  bold: boolean;
  italic: boolean;
}

/** Rettangolo, eventualmente ruotato di `angle` gradi attorno al vertice (x, y) in basso a sinistra. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
  angle: number;
}

interface Base {
  id: string;
  /** Pagina (id di `PageRef`). */
  page: string;
}

export interface TextOp extends Base {
  kind: 'text';
  /** Origine della linea di base. */
  x: number;
  y: number;
  angle: number;
  size: number;
  text: string;
  font: FontSpec;
  color: RGB;
}

export interface ReplaceOp extends Omit<TextOp, 'kind'> {
  kind: 'replace';
  /** Riga originale coperta. */
  lineId: string;
  original: string;
  cover: Box;
  bg: RGB;
}

export interface HighlightOp extends Base {
  kind: 'highlight';
  boxes: Box[];
  color: RGB;
}

export interface CoverOp extends Base {
  kind: 'cover';
  box: Box;
  color: RGB;
}

export interface ImageOp extends Base {
  kind: 'image';
  box: Box;
  /** Chiave nella mappa delle immagini. */
  image: string;
}

export type Op = TextOp | ReplaceOp | HighlightOp | CoverOp | ImageOp;

export interface PageRef {
  id: string;
  /** 0: il PDF aperto; 1, 2…: PDF aggiunti. -1: pagina vuota. */
  src: number;
  /** Indice della pagina nel PDF di origine (da 0). */
  index: number;
  /** Rotazione aggiunta, in gradi (multipli di 90). */
  rotate: number;
  /** Pagine vuote: larghezza e altezza. */
  size?: [number, number];
}

export interface ImageData {
  bytes: Uint8Array;
  type: 'png' | 'jpg';
  width: number;
  height: number;
}

/* ───────────────────────────── Geometria ───────────────────────────── */

const RAD = Math.PI / 180;

/** I quattro vertici di un riquadro: in basso a sinistra, in basso a destra, in alto a destra, in alto a sinistra. */
export function corners(b: Box): [number, number][] {
  const c = Math.cos(b.angle * RAD);
  const s = Math.sin(b.angle * RAD);
  const at = (u: number, v: number): [number, number] => [b.x + u * c - v * s, b.y + u * s + v * c];
  return [at(0, 0), at(b.w, 0), at(b.w, b.h), at(0, b.h)];
}

/** Riquadro di una riga di testo dalla sua linea di base. */
export function lineBox(x: number, y: number, width: number, size: number, angle: number, pad = 0): Box {
  const c = Math.cos(angle * RAD);
  const s = Math.sin(angle * RAD);
  const down = 0.24 * size + pad;
  const left = pad;
  return { x: x - left * c + down * s, y: y - left * s - down * c, w: width + 2 * pad, h: 1.2 * size + 2 * pad, angle };
}

/**
 * Trasformazione pagina → schermo, identica a quella di pdf.js (PageViewport):
 * serve anche per le pagine vuote, che pdf.js non conosce.
 */
export class View {
  readonly width: number;
  readonly height: number;
  readonly t: [number, number, number, number, number, number];

  constructor(
    readonly viewBox: [number, number, number, number],
    readonly scale: number,
    rotation: number,
  ) {
    const [x0, y0, x1, y1] = viewBox;
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    const r = ((rotation % 360) + 360) % 360;
    let a: number, b: number, c: number, d: number;
    if (r === 90) [a, b, c, d] = [0, 1, 1, 0];
    else if (r === 180) [a, b, c, d] = [-1, 0, 0, 1];
    else if (r === 270) [a, b, c, d] = [0, -1, -1, 0];
    else [a, b, c, d] = [1, 0, 0, -1];
    let ox: number, oy: number;
    if (a === 0) {
      ox = Math.abs(cy - y0) * scale;
      oy = Math.abs(cx - x0) * scale;
      this.width = Math.abs(y1 - y0) * scale;
      this.height = Math.abs(x1 - x0) * scale;
    } else {
      ox = Math.abs(cx - x0) * scale;
      oy = Math.abs(cy - y0) * scale;
      this.width = Math.abs(x1 - x0) * scale;
      this.height = Math.abs(y1 - y0) * scale;
    }
    this.t = [a * scale, b * scale, c * scale, d * scale, ox - a * scale * cx - c * scale * cy, oy - b * scale * cx - d * scale * cy];
  }

  toView(x: number, y: number): [number, number] {
    const t = this.t;
    return [t[0] * x + t[2] * y + t[4], t[1] * x + t[3] * y + t[5]];
  }

  toPdf(x: number, y: number): [number, number] {
    const [a, b, c, d, e, f] = this.t;
    const det = a * d - b * c;
    return [(d * (x - e) - c * (y - f)) / det, (a * (y - f) - b * (x - e)) / det];
  }

  /** Angolo (gradi, nello spazio della pagina) che sullo schermo appare orizzontale. */
  uprightAngle(): number {
    const [x0, y0] = this.toPdf(0, 0);
    const [x1, y1] = this.toPdf(1, 0);
    return Math.round(Math.atan2(y1 - y0, x1 - x0) / RAD);
  }

  /** Matrice CSS per disegnare un riquadro della pagina come elemento HTML (origine in alto a sinistra). */
  css(b: Box): { width: number; height: number; transform: string } {
    const c = Math.cos(b.angle * RAD);
    const s = Math.sin(b.angle * RAD);
    // Vertice in alto a sinistra e direzioni dei lati (anche per riquadri larghi zero).
    const top: [number, number] = [b.x - b.h * s, b.y + b.h * c];
    const o = this.toView(...top);
    const ux = this.toView(top[0] + c, top[1] + s);
    const vy = this.toView(top[0] + s, top[1] - c);
    const u = [ux[0] - o[0], ux[1] - o[1]];
    const v = [vy[0] - o[0], vy[1] - o[1]];
    const lu = Math.hypot(u[0], u[1]) || 1;
    const lv = Math.hypot(v[0], v[1]) || 1;
    const m = [u[0] / lu, u[1] / lu, v[0] / lv, v[1] / lv, o[0], o[1]];
    return { width: b.w * lu, height: b.h * lv, transform: `matrix(${m.map((x) => +x.toFixed(4)).join(',')})` };
  }
}

/* ───────────────────────────── Righe di testo ───────────────────────────── */

export interface RawItem {
  str: string;
  transform: number[];
  width: number;
  height: number;
  fontName: string;
  hasEOL?: boolean;
}

export interface TextLine {
  id: string;
  text: string;
  x: number;
  y: number;
  angle: number;
  size: number;
  width: number;
  fontName: string;
  box: Box;
}

/** Riunisce i frammenti di testo di pdf.js in righe modificabili. */
export function groupLines(items: RawItem[], pageId: string): TextLine[] {
  const lines: (TextLine & { end: number })[] = [];
  let cur: (TextLine & { end: number }) | null = null;
  for (const it of items) {
    if (!it.str) continue;
    const [a, b, c, d, e, f] = it.transform;
    const angle = Math.round((Math.atan2(b, a) / RAD) * 10) / 10;
    const size = Math.hypot(c, d) || it.height || Math.hypot(a, b);
    if (!size) continue;
    const cos = Math.cos(angle * RAD);
    const sin = Math.sin(angle * RAD);
    if (cur && Math.abs(cur.angle - angle) < 1 && Math.abs(cur.size - size) < cur.size * 0.35) {
      // Posizione dell'inizio del frammento nel sistema della riga.
      const dx = e - cur.x;
      const dy = f - cur.y;
      const along = dx * cos + dy * sin;
      const across = -dx * sin + dy * cos;
      const gap = along - cur.end;
      if (Math.abs(across) < cur.size * 0.35 && gap > -cur.size * 0.6 && gap < cur.size * 1.1) {
        if (gap > cur.size * 0.12 && !/\s$/.test(cur.text) && !/^\s/.test(it.str)) cur.text += ' ';
        cur.text += it.str;
        cur.end = Math.max(cur.end, along + it.width);
        cur.width = cur.end;
        if (it.hasEOL) cur = null;
        continue;
      }
    }
    cur = { id: `${pageId}:${lines.length}`, text: it.str, x: e, y: f, angle, size, width: it.width, fontName: it.fontName, box: lineBox(e, f, it.width, size, angle), end: it.width };
    lines.push(cur);
    if (it.hasEOL) cur = null;
  }
  return lines
    .map(({ end: _end, ...l }) => ({ ...l, text: l.text.replace(/\s+$/, ''), box: lineBox(l.x, l.y, l.width, l.size, l.angle) }))
    .filter((l) => l.text.trim());
}

/**
 * Spazio disponibile per riscrivere una riga: fino al margine destro della colonna,
 * cioè la fine più lontana tra le righe con lo stesso orientamento che le stanno sopra o sotto.
 * In un testo a due colonne le righe dell'altra colonna non si sovrappongono e non contano.
 */
export function lineRoom(line: TextLine, lines: TextLine[]): number {
  const cos = Math.cos(line.angle * RAD);
  const sin = Math.sin(line.angle * RAD);
  let room = line.width;
  for (const l of lines) {
    if (Math.abs(l.angle - line.angle) >= 1) continue;
    const start = (l.x - line.x) * cos + (l.y - line.y) * sin;
    const end = start + l.width;
    if (start < line.width && end > 0) room = Math.max(room, end);
  }
  return room;
}

/** Carattere più vicino tra quelli standard del PDF, dal nome del font originale. */
export function matchFont(name: string, fallback?: string, flags: { bold?: boolean; italic?: boolean } = {}): FontSpec {
  const n = name.replace(/^[A-Z]{6}\+/, '');
  const bold = flags.bold || /bold|black|heavy|semibold|demi|[-,]bd$|w[6-9]$/i.test(n);
  const italic = flags.italic || /italic|oblique|[-,]it$|ital/i.test(n);
  let family: FontSpec['family'] = 'sans';
  if (/mono|courier|consol|code|typewriter|menlo|cmtt|lmmono/i.test(n) || fallback === 'monospace') family = 'mono';
  else if (
    !/sans|grotesk|gothic|arial|helvet|verdana|calibri|segoe|roboto|inter\b/i.test(n) &&
    (/serif|times|roman|georgia|garamond|minion|palatino|book|cambria|caslon|baskerville|libertin|cmr|lmroman|charter|utopia|bodoni|didot|merriweather|crimson|literata|constantia|sabon|janson/i.test(
      n,
    ) ||
      fallback === 'serif')
  )
    family = 'serif';
  return { family, bold, italic };
}

/* ───────────────────────────── Colori ───────────────────────────── */

/** Colore di sfondo (attorno) e del testo (dentro) di un'area della pagina disegnata. */
export function sampleColors(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): { bg: RGB; fg: RGB } {
  const cw = ctx.canvas.width;
  const ch = ctx.canvas.height;
  const clamp = (v: number, max: number) => Math.max(0, Math.min(max, Math.round(v)));
  const pad = 3;
  const x0 = clamp(x - pad, cw - 1);
  const y0 = clamp(y - pad, ch - 1);
  const x1 = clamp(x + w + pad, cw);
  const y1 = clamp(y + h + pad, ch);
  if (x1 - x0 < 2 || y1 - y0 < 2) return { bg: [1, 1, 1], fg: [0, 0, 0] };
  const data = ctx.getImageData(x0, y0, x1 - x0, y1 - y0).data;
  const W = x1 - x0;
  const H = y1 - y0;
  const ring = new Map<number, number>();
  const inner = new Map<number, number>();
  const key = (i: number) => ((data[i] >> 3) << 10) | ((data[i + 1] >> 3) << 5) | (data[i + 2] >> 3);
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const edge = i < 2 || j < 2 || i >= W - 2 || j >= H - 2;
      const k = key((j * W + i) * 4);
      const m = edge ? ring : inner;
      m.set(k, (m.get(k) ?? 0) + 1);
    }
  }
  const unpack = (k: number): RGB => [(((k >> 10) & 31) * 8 + 4) / 255, (((k >> 5) & 31) * 8 + 4) / 255, ((k & 31) * 8 + 4) / 255];
  const top = (m: Map<number, number>, skip?: (k: number) => boolean) => {
    let best = -1;
    let n = -1;
    for (const [k, c] of m) if (c > n && !skip?.(k)) [best, n] = [k, c];
    return best;
  };
  const bgKey = top(ring);
  let bg: RGB = bgKey < 0 ? [1, 1, 1] : unpack(bgKey);
  // Quasi bianco: bianco pieno.
  if (bg.every((v) => v > 0.94)) bg = [1, 1, 1];
  const dist = (k: number) => {
    const c = unpack(k);
    return Math.hypot(c[0] - bg[0], c[1] - bg[1], c[2] - bg[2]);
  };
  const fgKey = top(inner, (k) => dist(k) < 0.35);
  let fg: RGB = fgKey < 0 ? [0, 0, 0] : unpack(fgKey);
  if (fg.every((v) => v < 0.12)) fg = [0, 0, 0];
  return { bg, fg };
}

export function cssColor(c: RGB, alpha = 1): string {
  const [r, g, b] = c.map((v) => Math.round(v * 255));
  return alpha < 1 ? `rgba(${r},${g},${b},${alpha})` : `rgb(${r},${g},${b})`;
}

export function hexToRgb(hex: string): RGB {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  return m ? [parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255] : [0, 0, 0];
}

export function rgbToHex(c: RGB): string {
  return '#' + c.map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
}

export const CSS_FAMILY: Record<FontSpec['family'], string> = {
  serif: "'Times New Roman', Times, 'Liberation Serif', serif",
  sans: "Helvetica, Arial, 'Liberation Sans', sans-serif",
  mono: "'Courier New', Courier, 'Liberation Mono', monospace",
};

/* ───────────────────────────── Salvataggio ───────────────────────────── */

const STANDARD: Record<FontSpec['family'], [StandardFonts, StandardFonts, StandardFonts, StandardFonts]> = {
  serif: [StandardFonts.TimesRoman, StandardFonts.TimesRomanBold, StandardFonts.TimesRomanItalic, StandardFonts.TimesRomanBoldItalic],
  sans: [StandardFonts.Helvetica, StandardFonts.HelveticaBold, StandardFonts.HelveticaOblique, StandardFonts.HelveticaBoldOblique],
  mono: [StandardFonts.Courier, StandardFonts.CourierBold, StandardFonts.CourierOblique, StandardFonts.CourierBoldOblique],
};

/** Caratteri di riserva per il testo fuori dalla codifica dei font standard (ł, ő, greco, cirillico…). */
export type FallbackFonts = () => Promise<[Uint8Array, Uint8Array, Uint8Array, Uint8Array]>;

export interface BuildInput {
  original: Uint8Array;
  /** PDF aggiunti (src 1, 2…). */
  extra: Uint8Array[];
  pages: PageRef[];
  ops: Op[];
  images: Map<string, ImageData>;
  fallbackFonts?: FallbackFonts;
}

export class PdfEditError extends Error {}

/** La struttura delle pagine è quella originale? Allora si modifica il file sul posto, senza perdere nulla. */
function sameStructure(pages: PageRef[], count: number): boolean {
  return pages.length === count && pages.every((p, i) => p.src === 0 && p.index === i && !p.size);
}

export async function buildPdf(input: BuildInput): Promise<Uint8Array> {
  let src: PDFDocument;
  try {
    src = await PDFDocument.load(input.original, { updateMetadata: false });
  } catch (e) {
    const msg = (e as Error).message ?? '';
    if (/encrypt/i.test(msg)) throw new PdfEditError('encrypted');
    throw e;
  }
  if (src.isEncrypted) throw new PdfEditError('encrypted');

  let out: PDFDocument;
  let target: PDFPage[];
  if (sameStructure(input.pages, src.getPageCount())) {
    out = src;
    target = src.getPages();
  } else {
    // Pagine riordinate, tolte o aggiunte: un documento nuovo con le sole pagine scelte,
    // così le pagine eliminate non restano nascoste nel file.
    out = await PDFDocument.create({ updateMetadata: false });
    const title = src.getTitle();
    const author = src.getAuthor();
    if (title) out.setTitle(title);
    if (author) out.setAuthor(author);
    const extras = await Promise.all(input.extra.map((b) => PDFDocument.load(b, { updateMetadata: false })));
    const docs = [src, ...extras];
    target = [];
    for (const p of input.pages) {
      if (p.src < 0) {
        target.push(out.addPage(p.size ?? [595.28, 841.89]));
        continue;
      }
      const [copy] = await out.copyPages(docs[p.src], [p.index]);
      target.push(out.addPage(copy));
    }
  }
  out.setProducer('Wrambi (pdf-lib)');
  out.setModificationDate(new Date());

  const byId = new Map(input.pages.map((p, i) => [p.id, target[i]]));
  input.pages.forEach((p, i) => {
    if (p.rotate % 360) {
      const page = target[i];
      page.setRotation(degrees((((page.getRotation().angle + p.rotate) % 360) + 360) % 360));
    }
  });

  const fonts = new Map<string, PDFFont>();
  let fallback: [Uint8Array, Uint8Array, Uint8Array, Uint8Array] | null = null;
  const fontFor = async (spec: FontSpec, text: string): Promise<PDFFont> => {
    const v = (spec.bold ? 1 : 0) + (spec.italic ? 2 : 0);
    const key = `${spec.family}-${v}`;
    let f = fonts.get(key);
    if (!f) {
      f = await out.embedFont(STANDARD[spec.family][v]);
      fonts.set(key, f);
    }
    try {
      f.encodeText(text);
      return f;
    } catch {
      if (!input.fallbackFonts) throw new PdfEditError('charset');
      const fk = 'fallback-' + v;
      let u = fonts.get(fk);
      if (!u) {
        fallback ??= await input.fallbackFonts();
        const { default: fontkit } = await import('@pdf-lib/fontkit');
        out.registerFontkit(fontkit);
        u = await out.embedFont(fallback[v], { subset: true });
        fonts.set(fk, u);
      }
      return u;
    }
  };

  const images = new Map<string, PDFImage>();
  const color = (c: RGB) => rgb(c[0], c[1], c[2]);

  for (const op of input.ops) {
    const page = byId.get(op.page);
    if (!page) continue;
    switch (op.kind) {
      case 'cover':
        page.drawRectangle({ ...rectArgs(op.box), color: color(op.color), borderWidth: 0 });
        break;
      case 'highlight':
        for (const b of op.boxes) {
          page.drawRectangle({ ...rectArgs(b), color: color(op.color), opacity: 0.4, borderWidth: 0, blendMode: BlendMode.Multiply });
        }
        break;
      case 'image': {
        let img = images.get(op.image);
        if (!img) {
          const data = input.images.get(op.image);
          if (!data) continue;
          img = data.type === 'png' ? await out.embedPng(data.bytes) : await out.embedJpg(data.bytes);
          images.set(op.image, img);
        }
        page.drawImage(img, { x: op.box.x, y: op.box.y, width: op.box.w, height: op.box.h, rotate: degrees(op.box.angle) });
        break;
      }
      case 'replace':
        page.drawRectangle({ ...rectArgs(op.cover), color: color(op.bg), borderWidth: 0 });
      // falls through: il testo nuovo si scrive sopra la copertura
      case 'text': {
        if (!op.text.trim()) break;
        const font = await fontFor(op.font, op.text);
        page.drawText(op.text, { x: op.x, y: op.y, size: op.size, font, color: color(op.color), rotate: degrees(op.angle) });
        break;
      }
    }
  }
  return out.save({ useObjectStreams: true });
}

function rectArgs(b: Box) {
  return { x: b.x, y: b.y, width: b.w, height: b.h, rotate: degrees(b.angle) };
}

/** Larghezza del testo con il carattere standard più vicino (per adattare la sostituzione alla riga). */
let measureDoc: Promise<PDFDocument> | null = null;
const measureFonts = new Map<string, Promise<PDFFont>>();
export async function textWidth(text: string, spec: FontSpec, size: number): Promise<number> {
  measureDoc ??= PDFDocument.create();
  const doc = await measureDoc;
  const v = (spec.bold ? 1 : 0) + (spec.italic ? 2 : 0);
  const key = `${spec.family}-${v}`;
  let p = measureFonts.get(key);
  if (!p) {
    p = doc.embedFont(STANDARD[spec.family][v]);
    measureFonts.set(key, p);
  }
  const f = await p;
  try {
    return f.widthOfTextAtSize(text, size);
  } catch {
    // Caratteri fuori codifica: stima.
    return text.length * size * 0.5;
  }
}
