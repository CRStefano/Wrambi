/**
 * Anteprime dei documenti per la Biblioteca: la prima pagina dei PDF, la
 * copertina degli EPUB, l'inizio del testo per tutti gli altri formati.
 *
 * Le immagini (PDF ed EPUB) si generano una volta sola e restano nei dati di
 * Wrambi; una modifica del file ne produce una nuova. I file non vengono mai
 * scritti né spostati.
 */
import { backend, extname } from './backend';

export interface ThumbLine {
  text: string;
  /** 0 testo, 1–3 titolo, 4 voce di elenco. */
  level: 0 | 1 | 2 | 3 | 4;
}

export type Thumb =
  | { kind: 'image'; url: string }
  | { kind: 'cover'; title: string; author: string }
  | { kind: 'text'; lines: ThumbLine[]; mono?: boolean }
  | { kind: 'none'; reason?: string };

const THUMB_WIDTH = 300; // px di immagine: nitida anche con lo schermo al 150%
const MAX_BINARY = 120 * 1024 * 1024;
const VERSION = 'v1';

/* ───────────── Testo: dall'inizio del file a poche righe leggibili ───────────── */

function stripInline(s: string): string {
  return s
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<\/?u>/g, '')
    .replace(/(\*\*|__|\*|_|~~|`)(?=\S)([^]*?\S)\1/g, '$2')
    .replace(/\\([\\`*_#>+=\-[\]()!])/g, '$1')
    .trim();
}

function paragraphs(text: string, map: (line: string) => ThumbLine | null, limit = 14): ThumbLine[] {
  const out: ThumbLine[] = [];
  let buf = '';
  const flush = () => {
    if (buf.trim()) out.push({ text: buf.trim(), level: 0 });
    buf = '';
  };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      flush();
      continue;
    }
    const special = map(line);
    if (special) {
      flush();
      if (special.text) out.push(special);
    } else buf += (buf ? ' ' : '') + line.trim();
    if (out.length >= limit) break;
  }
  flush();
  return out.slice(0, limit);
}

export function markdownLines(text: string): ThumbLine[] {
  let t = text;
  if (t.startsWith('---\n')) {
    const end = t.indexOf('\n---', 4);
    if (end > 0) t = t.slice(end + 4);
  }
  let fence = false;
  return paragraphs(t, (line) => {
    if (/^\s*(```|~~~)/.test(line)) {
      fence = !fence;
      return { text: '', level: 0 };
    }
    if (fence) return { text: line, level: 0 };
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) return { text: stripInline(h[2]), level: Math.min(3, h[1].length) as 1 | 2 | 3 };
    const li = /^\s*(?:[-*+]|\d+[.)])\s+(.*)$/.exec(line);
    if (li) return { text: stripInline(li[1]), level: 4 };
    if (/^\s*>\s?/.test(line)) return { text: stripInline(line.replace(/^\s*>\s?/, '')), level: 0 };
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) return { text: '', level: 0 };
    return null;
  }).map((l) => (l.level === 0 ? { ...l, text: stripInline(l.text) } : l));
}

export function latexLines(src: string): ThumbLine[] {
  const title = /\\title\{([^}]*)\}/.exec(src)?.[1];
  const begin = src.indexOf('\\begin{document}');
  let body = begin >= 0 ? src.slice(begin + 16) : src;
  body = body.replace(/(^|[^\\])%.*$/gm, '$1');
  const lines: ThumbLine[] = title ? [{ text: title.trim(), level: 1 }] : [];
  const rest = paragraphs(body, (line) => {
    const sec = /^\s*\\(chapter|section|subsection|subsubsection)\*?\{([^}]*)\}/.exec(line);
    if (sec) return { text: sec[2].trim(), level: sec[1] === 'chapter' ? 1 : sec[1] === 'section' ? 2 : 3 };
    const item = /^\s*\\item\s+(.*)$/.exec(line);
    if (item) return { text: cleanTex(item[1]), level: 4 };
    if (/^\s*\\(begin|end|maketitle|tableofcontents|documentclass|usepackage|label|newpage|clearpage)\b/.test(line)) return { text: '', level: 0 };
    return null;
  });
  return [...lines, ...rest.map((l) => (l.level === 0 ? { ...l, text: cleanTex(l.text) } : l))].filter((l) => l.text).slice(0, 14);
}

function cleanTex(s: string): string {
  return s
    .replace(/\\(textbf|textit|emph|underline|texttt|textsc)\{([^}]*)\}/g, '$2')
    .replace(/\\[a-zA-Z]+\*?(\[[^\]]*\])?(\{[^}]*\})?/g, '')
    .replace(/[{}~]/g, ' ')
    .replace(/\\([%&$#_])/g, '$1')
    .replace(/``|''/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

export function typstLines(src: string): ThumbLine[] {
  return paragraphs(src, (line) => {
    const h = /^\s*(=+)\s+(.*)$/.exec(line);
    if (h) return { text: cleanTypst(h[2]), level: Math.min(3, h[1].length) as 1 | 2 | 3 };
    const li = /^\s*[-+]\s+(.*)$/.exec(line);
    if (li) return { text: cleanTypst(li[1]), level: 4 };
    if (/^\s*#(set|show|import|let|include|pagebreak)\b/.test(line) || /^\s*\/\//.test(line)) return { text: '', level: 0 };
    return null;
  })
    .map((l) => (l.level === 0 ? { ...l, text: cleanTypst(l.text) } : l))
    .filter((l) => l.text);
}

function cleanTypst(s: string): string {
  return s
    .replace(/#[a-z][\w-]*(\([^)]*\))?\[([^\]]*)\]/g, '$2')
    .replace(/#[a-z][\w.-]*(\([^)]*\))?/g, '')
    .replace(/(\*|_)(\S[^]*?\S|\S)\1/g, '$2')
    .replace(/\\(.)/g, '$1')
    .trim();
}

export function htmlLines(src: string): ThumbLine[] {
  const dom = new DOMParser().parseFromString(src, 'text/html');
  dom.querySelectorAll('script,style,nav,header,footer,noscript,template,svg').forEach((n) => n.remove());
  const out: ThumbLine[] = [];
  const title = dom.querySelector('h1')?.textContent?.trim() || dom.title?.trim();
  if (title) out.push({ text: title, level: 1 });
  for (const el of Array.from(dom.body?.querySelectorAll('h1,h2,h3,p,li,blockquote') ?? [])) {
    const text = el.textContent?.replace(/\s+/g, ' ').trim();
    if (!text || text === title) continue;
    const tag = el.tagName.toLowerCase();
    out.push({ text, level: tag === 'h1' ? 1 : tag === 'h2' ? 2 : tag === 'h3' ? 3 : tag === 'li' ? 4 : 0 });
    if (out.length >= 14) break;
  }
  return out;
}

export function linesFor(ext: string, text: string): ThumbLine[] {
  switch (ext) {
    case 'md':
    case 'markdown':
      return markdownLines(text);
    case 'tex':
      return latexLines(text);
    case 'typ':
      return typstLines(text);
    case 'html':
    case 'htm':
      return htmlLines(text);
    default:
      return paragraphs(text, () => null);
  }
}

/* ───────────── Immagini: prima pagina del PDF, copertina dell'EPUB ───────────── */

async function canvasPng(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
  if (!blob) throw new Error('anteprima non disponibile');
  return new Uint8Array(await blob.arrayBuffer());
}

async function pdfThumb(bytes: Uint8Array): Promise<Uint8Array> {
  const { openPdf, closePdfDocument } = await import('./reader/pdf');
  const pdf = await openPdf(bytes);
  try {
    const page = await pdf.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const vp = page.getViewport({ scale: THUMB_WIDTH / base.width });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(vp.width);
    canvas.height = Math.round(vp.height);
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvas, viewport: vp }).promise;
    return await canvasPng(canvas);
  } finally {
    closePdfDocument(pdf);
  }
}

async function imageThumb(data: Uint8Array, type: string): Promise<Uint8Array> {
  const url = URL.createObjectURL(new Blob([data as BlobPart], { type }));
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    const w = Math.min(THUMB_WIDTH, img.naturalWidth || THUMB_WIDTH);
    const h = Math.round((w * (img.naturalHeight || 4)) / (img.naturalWidth || 3));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d')!.drawImage(img, 0, 0, w, h);
    return await canvasPng(canvas);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/* ───────────── Coda e memoria ───────────── */

const cache = new Map<string, Promise<Thumb>>();
const urls = new Map<string, string>();
const MAX_URLS = 400;

function remember(key: string, png: Uint8Array): Thumb {
  const url = URL.createObjectURL(new Blob([png as BlobPart], { type: 'image/png' }));
  urls.set(key, url);
  if (urls.size > MAX_URLS) {
    const [oldKey, oldUrl] = urls.entries().next().value!;
    urls.delete(oldKey);
    cache.delete(oldKey);
    URL.revokeObjectURL(oldUrl);
  }
  return { kind: 'image', url };
}

/** Coda: le immagini si generano una alla volta, il testo quattro alla volta. */
function queue(limit: number) {
  let active = 0;
  const waiting: (() => void)[] = [];
  return async <T>(job: () => Promise<T>): Promise<T> => {
    if (active >= limit) await new Promise<void>((r) => waiting.push(r));
    active++;
    try {
      return await job();
    } finally {
      active--;
      waiting.shift()?.();
    }
  };
}
const heavy = queue(1);
const light = queue(4);

export interface ThumbSource {
  /** Percorso del file, oppure null per le bozze. */
  path: string | null;
  draftId?: string;
  ext: string;
  modified: number | null;
}

export function thumbKey(src: ThumbSource): string {
  return src.path ? `${VERSION}|${src.path}|${src.modified ?? 0}` : `${VERSION}|bozza:${src.draftId}|${src.modified ?? 0}`;
}

/** Anteprima di un documento (dalla memoria, dai dati di Wrambi o generata ora). */
export function loadThumb(src: ThumbSource): Promise<Thumb> {
  const key = thumbKey(src);
  let p = cache.get(key);
  if (!p) {
    p = make(src, key).catch((e: Error) => ({ kind: 'none', reason: e.message }) as Thumb);
    cache.set(key, p);
  }
  return p;
}

/** Dimentica l'anteprima di un file (dopo un salvataggio o una rinomina). */
export function forgetThumb(path: string) {
  for (const k of [...cache.keys()]) if (k.startsWith(`${VERSION}|${path}|`)) cache.delete(k);
}

async function make(src: ThumbSource, key: string): Promise<Thumb> {
  const ext = (src.ext || (src.path ? extname(src.path) : 'md')).toLowerCase();
  if (!src.path) {
    const text = src.draftId ? await light(() => backend.draftLoad(src.draftId!)) : null;
    return { kind: 'text', lines: markdownLines((text ?? '').slice(0, 4000)) };
  }
  const path = src.path;
  if (ext === 'pdf' || ext === 'epub') {
    const stored = await light(() => backend.thumbLoad(key));
    if (stored) return remember(key, stored);
    return heavy(async () => {
      const info = await backend.fileInfo(path);
      if (info.size > MAX_BINARY) return { kind: 'none', reason: 'file molto grande' } as Thumb;
      const bytes = await backend.readBinary(path);
      if (ext === 'pdf') {
        const png = await pdfThumb(bytes);
        void backend.thumbSave(key, png);
        return remember(key, png);
      }
      const { epubCover } = await import('./convert/epub');
      const cover = epubCover(bytes);
      if (cover.image) {
        const png = await imageThumb(cover.image.data, cover.image.type);
        void backend.thumbSave(key, png);
        return remember(key, png);
      }
      return { kind: 'cover', title: cover.title, author: cover.author } as Thumb;
    });
  }
  const head = await light(() => backend.readTextHead(path, ext === 'html' || ext === 'htm' ? 24_000 : 4_000));
  return { kind: 'text', lines: linesFor(ext, head), mono: false };
}
