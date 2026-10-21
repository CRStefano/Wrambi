/**
 * Ricostruzione del testo di una pagina PDF dalle posizioni dei frammenti.
 */
import type { TextItem } from 'pdfjs-dist/types/src/display/api';

const LIST_START = /^([•◦▪‣·∙–—-]|\d{1,3}[.)]|[a-z][.)])\s/;
const PARA_END = /[.?!:;»”"')\]]$/;

/** Un paragrafo ricostruito, con il corpo (altezza) del testo. */
export interface Para {
  text: string;
  size: number;
}

/** Ricostruisce il testo di una pagina come paragrafi separati da una riga vuota. */
export function pageText(items: TextItem[]): string {
  return pageParagraphs(items)
    .map((p) => p.text)
    .join('\n\n');
}

/** Ricostruisce righe e paragrafi di una pagina dalle posizioni del testo. */
export function pageParagraphs(items: TextItem[]): Para[] {
  interface Line {
    y: number;
    h: number;
    x: number;
    end: number;
    parts: string[];
  }
  const lines: Line[] = [];
  let current: Line | null = null;
  let lastEnd = 0;
  for (const it of items) {
    const x = it.transform[4];
    const y = it.transform[5];
    const h = Math.abs(it.height) || Math.abs(it.transform[3]) || 10;
    if (!current || Math.abs(current.y - y) > h * 0.45) {
      current = { y, h, x, end: x, parts: [] };
      lines.push(current);
      lastEnd = x;
    }
    // Spazio implicito tra frammenti distanti sulla stessa riga.
    const gap = x - lastEnd;
    const prev = current.parts[current.parts.length - 1] ?? '';
    if (prev && gap > h * 0.18 && !/\s$/.test(prev) && !/^\s/.test(it.str)) current.parts.push(' ');
    current.parts.push(it.str);
    lastEnd = x + it.width;
    current.end = Math.max(current.end, lastEnd);
    current.h = Math.max(current.h, h);
    if (it.hasEOL) current = null;
  }
  const rightEdge = Math.max(0, ...lines.map((l) => l.end));
  const leftEdge = Math.min(...lines.map((l) => l.x));

  /*
   * Trattini spariti. Alcuni PDF (per esempio quelli di Typst, quindi anche
   * quelli salvati da Wrambi) scrivono il trattino di sillabazione come
   * «trattino morbido», che pdf.js toglie dal testo. In un testo giustificato
   * la riga resta allora più corta del margine di circa la larghezza di un
   * trattino: è il segno che la parola continua nella riga dopo.
   */
  const written = lines.filter((l) => l.parts.join('').trim());
  const colRight = (l: Line) => Math.max(l.end, ...written.filter((o) => Math.abs(o.x - l.x) < l.h * 3).map((o) => o.end));
  const full = written.filter((l) => colRight(l) - l.end < l.h * 0.08).length;
  const justified = written.length >= 3 && full / written.length >= 0.4;
  const lostHyphen = (l: Line, text: string) => {
    if (!justified || !/\p{L}$/u.test(text)) return false;
    const gap = colRight(l) - l.end;
    return gap > l.h * 0.12 && gap < l.h * 0.55;
  };

  const paras: Para[] = [];
  let buf = '';
  let bufSize = 0;
  let prevLine: Line | null = null;
  let prevText = '';
  for (const l of lines) {
    const text = l.parts.join('').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    if (prevLine) {
      const gap = prevLine.y - l.y;
      const bigger = Math.max(prevLine.h, l.h);
      const prevShort = prevLine.end < leftEdge + (rightEdge - leftEdge) * 0.8;
      const newPara =
        gap > bigger * 1.75 ||
        gap < 0 ||
        Math.abs(prevLine.h - l.h) / bigger > 0.12 || // cambio di corpo: titolo
        LIST_START.test(text) ||
        (prevShort && PARA_END.test(buf)) ||
        (prevShort && l.x > leftEdge + bigger * 0.8); // rientro di capoverso
      if (newPara) {
        paras.push({ text: buf, size: bufSize });
        buf = text;
        bufSize = l.h;
      } else if (/[-\u00ad\u2010\u2011]$/.test(buf) && /^[a-zà-ÿ]/.test(text)) {
        // Parola spezzata a fine riga: "riflessio- ne" → "riflessione" (anche con il trattino morbido).
        buf = buf.slice(0, -1) + text;
      } else if (lostHyphen(prevLine, prevText) && /^\p{Ll}/u.test(text)) {
        buf += text;
      } else {
        buf += ' ' + text;
      }
    } else {
      buf = text;
      bufSize = l.h;
    }
    prevLine = l;
    prevText = text;
  }
  if (buf) paras.push({ text: buf, size: bufSize });
  // I trattini morbidi rimasti in mezzo alle parole non si vedono: si tolgono.
  for (const p of paras) p.text = p.text.replace(/\u00ad/g, '');
  return paras;
}

/* ─────────────── Dal testo del PDF al Markdown (per leggere e modificare) ─────────────── */

const BULLET = /^[•◦▪‣·∙–—]\s+/;

const isSpace = (c: string) => c === '' || /\s/.test(c);
const isWordChar = (c: string) => /[\p{L}\p{N}]/u.test(c);

/**
 * Protegge i caratteri che in Markdown cambierebbero il testo. «*» e «_»
 * si proteggono solo dove potrebbero aprire o chiudere un'enfasi: «2 * 3»
 * e «a_b» restano come sono.
 */
export function mdEscape(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '\\' || c === '`') {
      out += '\\' + c;
      continue;
    }
    // «<parola>» verrebbe letto come un tag HTML o un indirizzo.
    if (c === '<' && /[A-Za-z/!?]/.test(text[i + 1] ?? '')) {
      out += '\\<';
      continue;
    }
    if (c === '*' || c === '_') {
      const prev = i > 0 ? text[i - 1] : '';
      const next = text[i + 1] ?? '';
      const loose = i > 0 && isSpace(prev) && isSpace(next);
      const inWord = c === '_' && isWordChar(prev) && isWordChar(next);
      out += loose || inWord ? c : '\\' + c;
      continue;
    }
    out += c;
  }
  return out.replace(/^(#|>|\+\s|=+$)/, '\\$1');
}

/** Corpo del testo: l'altezza più frequente, pesata sul numero di caratteri. */
export function bodySize(pages: Para[][]): number {
  const weight = new Map<number, number>();
  for (const page of pages)
    for (const p of page) {
      const k = Math.round(p.size * 2) / 2;
      weight.set(k, (weight.get(k) ?? 0) + p.text.length);
    }
  let body = 10;
  let best = -1;
  for (const [k, w] of weight)
    if (w > best) {
      best = w;
      body = k;
    }
  return body;
}

/**
 * Converte i paragrafi di una pagina in Markdown: quelli con un corpo
 * nettamente più grande del testo diventano titoli, i punti elenco elenchi.
 */
export function pageToMarkdown(page: Para[], body: number): string {
  return page
    .map((p) => {
      const ratio = p.size / body;
      if (ratio >= 1.18 && p.text.length <= 140) {
        const level = ratio >= 1.55 ? '#' : ratio >= 1.25 ? '##' : '###';
        return `${level} ${mdEscape(p.text).replace(/^\\#/, '#')}`;
      }
      if (BULLET.test(p.text)) return '- ' + mdEscape(p.text.replace(BULLET, ''));
      const num = /^(\d{1,3})[.)]\s+(.*)$/.exec(p.text);
      if (num) return `${num[1]}. ${mdEscape(num[2])}`;
      if (/^-\s/.test(p.text)) return '- ' + mdEscape(p.text.slice(2));
      return mdEscape(p.text);
    })
    .join('\n\n');
}

export function paragraphsToMarkdown(pages: Para[][]): string {
  const body = bodySize(pages);
  return pages.map((p) => pageToMarkdown(p, body)).join('\n\n');
}
