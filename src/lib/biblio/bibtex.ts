/**
 * Lettura di file BibTeX e BibLaTeX (.bib), come quelli esportati da Zotero
 * (anche con Better BibTeX), JabRef o Mendeley.
 */
import type { BibEntry, EntryType, Name } from './model';

const MONTHS: Record<string, string> = {
  jan: 'January', feb: 'February', mar: 'March', apr: 'April', may: 'May', jun: 'June',
  jul: 'July', aug: 'August', sep: 'September', oct: 'October', nov: 'November', dec: 'December',
};

const ACCENTS: Record<string, Record<string, string>> = {
  "'": { a: 'á', e: 'é', i: 'í', o: 'ó', u: 'ú', y: 'ý', A: 'Á', E: 'É', I: 'Í', O: 'Ó', U: 'Ú', Y: 'Ý', c: 'ć', C: 'Ć', n: 'ń', N: 'Ń', s: 'ś', S: 'Ś', z: 'ź', Z: 'Ź' },
  '`': { a: 'à', e: 'è', i: 'ì', o: 'ò', u: 'ù', A: 'À', E: 'È', I: 'Ì', O: 'Ò', U: 'Ù' },
  '^': { a: 'â', e: 'ê', i: 'î', o: 'ô', u: 'û', A: 'Â', E: 'Ê', I: 'Î', O: 'Ô', U: 'Û' },
  '"': { a: 'ä', e: 'ë', i: 'ï', o: 'ö', u: 'ü', y: 'ÿ', A: 'Ä', E: 'Ë', I: 'Ï', O: 'Ö', U: 'Ü' },
  '~': { a: 'ã', n: 'ñ', o: 'õ', A: 'Ã', N: 'Ñ', O: 'Õ' },
  c: { c: 'ç', C: 'Ç', s: 'ş', S: 'Ş' },
  v: { c: 'č', C: 'Č', s: 'š', S: 'Š', z: 'ž', Z: 'Ž', r: 'ř', R: 'Ř', e: 'ě', E: 'Ě' },
  '=': { a: 'ā', e: 'ē', i: 'ī', o: 'ō', u: 'ū' },
  '.': { z: 'ż', Z: 'Ż' },
  H: { o: 'ő', u: 'ű', O: 'Ő', U: 'Ű' },
  r: { a: 'å', A: 'Å' },
  k: { a: 'ą', e: 'ę' },
};

const SYMBOLS: Record<string, string> = {
  ss: 'ß', o: 'ø', O: 'Ø', aa: 'å', AA: 'Å', ae: 'æ', AE: 'Æ', oe: 'œ', OE: 'Œ', l: 'ł', L: 'Ł', i: 'ı',
  '&': '&', '%': '%', $: '$', _: '_', '#': '#', '{': '{', '}': '}', textendash: '–', textemdash: '—',
  textquoteleft: '‘', textquoteright: '’', textquotedblleft: '“', textquotedblright: '”', ldots: '…', dots: '…',
};

/** Da LaTeX a testo: accenti, simboli, graffe di protezione, trattini e virgolette. */
export function latexToText(s: string): string {
  let t = s;
  // Accenti: {\'e}, \'{e}, \'e, \c{c}, \v{s}
  t = t.replace(/\\([`'^"~=.]|[cvHrk](?=[{\s]))\s*\{?\s*\\?([A-Za-z])\s*\}?/g, (m, acc: string, ch: string) => ACCENTS[acc]?.[ch] ?? ch);
  t = t.replace(/\\(ss|aa|AA|ae|AE|oe|OE|o|O|l|L|i)(?![A-Za-z])\s?/g, (m, k: string) => SYMBOLS[k] ?? m);
  t = t.replace(/\\(textendash|textemdash|textquoteleft|textquoteright|textquotedblleft|textquotedblright|ldots|dots)(?![A-Za-z])(\{\})?\s?/g, (m, k: string) => SYMBOLS[k]);
  t = t.replace(/\\([&%$_#{}])/g, '$1');
  // Comandi di formattazione: si tiene il contenuto.
  t = t.replace(/\\(?:emph|textit|textbf|textsc|textrm|textsf|texttt|mkbibquote|mkbibemph|enquote|url|href\{[^}]*\})\s*\{/g, '{');
  t = t.replace(/\\[A-Za-z]+\s*/g, '');
  t = t.replace(/---/g, '—').replace(/--/g, '–').replace(/``/g, '“').replace(/''/g, '”');
  t = t.replace(/(?<!\\)~/g, ' ');
  t = t.replace(/[{}]/g, '');
  return t.replace(/\s+/g, ' ').trim();
}

/** Divide un campo di nomi ("Rossi, Mario and Anna Bianchi and {OMS}"). */
export function parseNames(raw: string): Name[] {
  const parts = splitTopLevel(raw, /\s+and\s+/i);
  return parts
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p): Name => {
      if (/^\{.*\}$/.test(p) && balanced(p.slice(1, -1))) return { family: latexToText(p), literal: latexToText(p) };
      const commas = splitTopLevel(p, /\s*,\s*/);
      if (commas.length >= 2) {
        // "von Last, Jr, First" o "Last, First"
        const family = latexToText(commas[0]);
        const given = latexToText(commas.length === 3 ? commas[2] : commas[1]);
        return given ? { family, given } : { family };
      }
      const words = splitTopLevel(p, /\s+/).filter(Boolean);
      if (words.length === 1) return { family: latexToText(words[0]) };
      // "Ludwig van Beethoven": la particella minuscola apre il cognome.
      let i = words.findIndex((w, k) => k > 0 && k < words.length - 1 && /^[a-z]/.test(w));
      if (i < 0) i = words.length - 1;
      return { family: latexToText(words.slice(i).join(' ')), given: latexToText(words.slice(0, i).join(' ')) };
    });
}

function balanced(s: string): boolean {
  let d = 0;
  for (const c of s) {
    if (c === '{') d++;
    else if (c === '}' && --d < 0) return false;
  }
  return d === 0;
}

/** Divide sul separatore solo fuori dalle graffe. */
function splitTopLevel(s: string, sep: RegExp): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  const re = new RegExp(sep.source, sep.flags.includes('g') ? sep.flags : sep.flags + 'g');
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (depth === 0) {
      re.lastIndex = i;
      const m = re.exec(s);
      if (m && m.index === i && m[0].length > 0) {
        out.push(s.slice(start, i));
        i += m[0].length;
        start = i;
        continue;
      }
    }
    i++;
  }
  out.push(s.slice(start));
  return out;
}

const TYPES: Record<string, EntryType> = {
  article: 'article-journal',
  book: 'book',
  mvbook: 'book',
  booklet: 'book',
  collection: 'book',
  incollection: 'chapter',
  inbook: 'chapter',
  inproceedings: 'paper-conference',
  conference: 'paper-conference',
  proceedings: 'book',
  phdthesis: 'thesis',
  mastersthesis: 'thesis',
  thesis: 'thesis',
  techreport: 'report',
  report: 'report',
  online: 'webpage',
  www: 'webpage',
  electronic: 'webpage',
};

/** Legge un file .bib. Le voci illeggibili vengono saltate, non fermano la lettura. */
export function parseBibtex(src: string): BibEntry[] {
  const strings: Record<string, string> = { ...MONTHS };
  const entries: BibEntry[] = [];
  let i = 0;
  while (true) {
    const at = src.indexOf('@', i);
    if (at < 0) break;
    const head = /^@\s*([A-Za-z]+)\s*([{(])/.exec(src.slice(at, at + 64));
    if (!head) {
      i = at + 1;
      continue;
    }
    const type = head[1].toLowerCase();
    const open = at + head[0].length - 1;
    const close = matching(src, open);
    if (close < 0) break;
    const body = src.slice(open + 1, close);
    i = close + 1;
    if (type === 'comment' || type === 'preamble') continue;
    if (type === 'string') {
      const m = /^\s*([A-Za-z][\w-]*)\s*=\s*([\s\S]*)$/.exec(body);
      if (m) strings[m[1].toLowerCase()] = value(m[2], strings);
      continue;
    }
    const comma = topLevelIndex(body, ',');
    const key = (comma < 0 ? body : body.slice(0, comma)).trim();
    if (!key) continue;
    const fields = parseFields(comma < 0 ? '' : body.slice(comma + 1), strings);
    entries.push(toEntry(key, type, fields));
  }
  return entries;
}

function matching(s: string, open: number): number {
  const closeCh = s[open] === '(' ? ')' : '}';
  const openCh = s[open];
  let depth = 0;
  let inQuote = false;
  for (let k = open; k < s.length; k++) {
    const c = s[k];
    if (c === '\\') {
      k++;
      continue;
    }
    if (c === '"' && openCh === '(' && depth === 1) inQuote = !inQuote;
    if (inQuote) continue;
    if (c === openCh || (openCh === '(' && c === '{')) depth++;
    else if (c === closeCh || (openCh === '(' && c === '}')) {
      depth--;
      if (depth === 0) return k;
    }
  }
  return -1;
}

function topLevelIndex(s: string, ch: string): number {
  let depth = 0;
  let q = false;
  for (let k = 0; k < s.length; k++) {
    const c = s[k];
    if (c === '\\') {
      k++;
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (c === '"' && depth === 0) q = !q;
    else if (c === ch && depth === 0 && !q) return k;
  }
  return -1;
}

function parseFields(s: string, strings: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  let rest = s;
  while (rest.trim()) {
    const eq = rest.indexOf('=');
    if (eq < 0) break;
    const name = rest.slice(0, eq).replace(/[,\s]/g, '').toLowerCase();
    let after = rest.slice(eq + 1);
    const end = topLevelIndex(after, ',');
    const raw = end < 0 ? after : after.slice(0, end);
    after = end < 0 ? '' : after.slice(end + 1);
    if (name) out[name] = value(raw, strings);
    rest = after;
  }
  return out;
}

/** Valore di un campo: {…}, "…", numero o macro, concatenati con #. */
function value(raw: string, strings: Record<string, string>): string {
  return splitTopLevel(raw.trim(), /\s*#\s*/)
    .map((part) => {
      const p = part.trim();
      if (p.startsWith('{') && p.endsWith('}')) return p.slice(1, -1);
      if (p.startsWith('"') && p.endsWith('"')) return p.slice(1, -1);
      if (/^\d+$/.test(p)) return p;
      return strings[p.toLowerCase()] ?? p;
    })
    .join('');
}

function toEntry(id: string, type: string, f: Record<string, string>): BibEntry {
  const text = (k: string) => (f[k] != null && f[k].trim() ? latexToText(f[k]) : undefined);
  const year = (f.date ?? f.year ?? '').match(/\d{4}/)?.[0];
  let t: EntryType = TYPES[type] ?? 'misc';
  if (t === 'misc' && (f.url || f.urldate) && !f.publisher) t = 'webpage';
  const e: BibEntry = {
    id,
    type: t,
    title: text('title'),
    author: f.author ? parseNames(f.author) : undefined,
    editor: f.editor ? parseNames(f.editor) : undefined,
    year,
    container: text('journaltitle') ?? text('journal') ?? text('booktitle') ?? text('maintitle'),
    publisher: text('publisher') ?? text('school') ?? text('institution') ?? text('organization'),
    place: text('location') ?? text('address'),
    volume: text('volume'),
    issue: text('number') ?? text('issue'),
    pages: f.pages ? latexToText(f.pages.replace(/-{1,3}/g, '–')) : undefined,
    edition: text('edition'),
    doi: f.doi?.trim().replace(/^https?:\/\/(dx\.)?doi\.org\//, ''),
    url: f.url ? f.url.trim().replace(/^\\url\{(.*)\}$/, '$1') : undefined,
    genre: text('type') ?? (type === 'phdthesis' ? 'PhD thesis' : type === 'mastersthesis' ? "Master's thesis" : undefined),
  };
  for (const k of Object.keys(e) as (keyof BibEntry)[]) if (e[k] === undefined) delete e[k];
  return e;
}
