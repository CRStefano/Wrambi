/**
 * Citazioni nel testo e bibliografia in uno stile autore-anno (sul modello
 * del Chicago author-date), per HTML, EPUB e testo semplice. Nel PDF, in
 * LaTeX e in Typst le citazioni restano native: lì lo stile lo applicano
 * Typst o biblatex.
 */
import type { Inline } from '../convert/ast';
import { nameText, type BibEntry, type Name } from './model';

export interface CiteItem {
  key: string;
  prefix?: string;
  locator?: string;
  /** `[-@chiave]`: solo l'anno. */
  suppressAuthor?: boolean;
}

interface Terms {
  and: string;
  etal: string;
  nd: string;
  in: string;
  edited: string;
  eds: string;
  ed: string;
  references: string;
  notes: string;
  /** Indice dell'EPUB. */
  toc: string;
  /** Al posto di un'immagine che non si può incorporare. */
  image: string;
}

const TERMS: Record<string, Terms> = {
  it: { and: 'e', etal: 'et al.', nd: 's.d.', in: 'In', edited: 'a cura di', eds: 'a cura di', ed: 'a cura di', references: 'Bibliografia', notes: 'Note', toc: 'Indice', image: 'immagine' },
  en: { and: 'and', etal: 'et al.', nd: 'n.d.', in: 'In', edited: 'edited by', eds: 'eds.', ed: 'ed.', references: 'References', notes: 'Notes', toc: 'Contents', image: 'image' },
  fr: { and: 'et', etal: 'et al.', nd: 's.d.', in: 'Dans', edited: 'sous la direction de', eds: 'dir.', ed: 'dir.', references: 'Bibliographie', notes: 'Notes', toc: 'Table des matières', image: 'image' },
  de: { and: 'und', etal: 'u. a.', nd: 'o. J.', in: 'In', edited: 'hrsg. von', eds: 'Hrsg.', ed: 'Hrsg.', references: 'Literatur', notes: 'Anmerkungen', toc: 'Inhalt', image: 'Bild' },
  es: { and: 'y', etal: 'et al.', nd: 's. f.', in: 'En', edited: 'editado por', eds: 'eds.', ed: 'ed.', references: 'Referencias', notes: 'Notas', toc: 'Índice', image: 'imagen' },
  pt: { and: 'e', etal: 'et al.', nd: 's.d.', in: 'In', edited: 'organizado por', eds: 'orgs.', ed: 'org.', references: 'Referências', notes: 'Notas', toc: 'Sumário', image: 'imagem' },
};

export function terms(lang: string): Terms {
  return TERMS[lang] ?? TERMS.en;
}

/** Indice della bibliografia, con le lettere per gli anni uguali (2020a, 2020b). */
export class BibIndex {
  readonly byKey = new Map<string, BibEntry>();
  /** Le chiavi, per riconoscere le citazioni nel testo. */
  readonly keys: Set<string>;
  private suffix = new Map<string, string>();

  constructor(entries: BibEntry[]) {
    for (const e of entries) if (!this.byKey.has(e.id)) this.byKey.set(e.id, e);
    this.keys = new Set(this.byKey.keys());
  }

  get size(): number {
    return this.byKey.size;
  }

  has(key: string): boolean {
    return this.byKey.has(key);
  }

  get(key: string): BibEntry | undefined {
    return this.byKey.get(key);
  }

  /** Assegna a, b, c… alle opere citate con stessi autori e stesso anno. */
  disambiguate(cited: string[], lang: string) {
    this.suffix.clear();
    const groups = new Map<string, BibEntry[]>();
    for (const k of cited) {
      const e = this.byKey.get(k);
      if (!e) continue;
      const g = `${authorsShort(e, lang)}|${e.year ?? ''}`;
      const list = groups.get(g) ?? [];
      if (!list.includes(e)) list.push(e);
      groups.set(g, list);
    }
    for (const list of groups.values()) {
      if (list.length < 2) continue;
      list.sort((a, b) => (a.title ?? '').localeCompare(b.title ?? ''));
      list.forEach((e, i) => this.suffix.set(e.id, String.fromCharCode(97 + i)));
    }
  }

  year(e: BibEntry, lang: string): string {
    return (e.year ?? terms(lang).nd) + (this.suffix.get(e.id) ?? '');
  }
}

function people(e: BibEntry): Name[] {
  return e.author?.length ? e.author : (e.editor ?? []);
}

/** Cognomi per la citazione nel testo: «Rossi», «Rossi e Bianchi», «Rossi et al.». */
export function authorsShort(e: BibEntry, lang: string): string {
  const p = people(e);
  const T = terms(lang);
  if (!p.length) return e.title ? shortTitle(e.title) : e.id;
  const fam = (n: Name) => n.literal ?? n.family;
  if (p.length === 1) return fam(p[0]);
  if (p.length === 2) return `${fam(p[0])} ${T.and} ${fam(p[1])}`;
  if (p.length === 3) return `${fam(p[0])}, ${fam(p[1])} ${T.and} ${fam(p[2])}`;
  return `${fam(p[0])} ${T.etal}`;
}

function shortTitle(t: string): string {
  const words = t.split(/\s+/);
  return words.length > 4 ? words.slice(0, 4).join(' ') + '…' : t;
}

/** Testo di una citazione: «(Rossi 2020, 33; Bianchi 2019)» o «Rossi (2020)». */
export function formatCitation(items: CiteItem[], bracket: boolean, idx: BibIndex, lang: string): string {
  const parts = items.map((it) => {
    const e = idx.get(it.key);
    if (!e) return `${it.prefix ? it.prefix + ' ' : ''}?${it.key}`;
    const year = idx.year(e, lang);
    const loc = it.locator ? `, ${it.locator}` : '';
    if (!bracket) return `${authorsShort(e, lang)} (${year}${loc})`;
    const who = it.suppressAuthor ? '' : authorsShort(e, lang) + ' ';
    return `${it.prefix ? it.prefix + ' ' : ''}${who}${year}${loc}`;
  });
  return bracket ? `(${parts.join('; ')})` : parts.join('; ');
}

function fullName(n: Name, inverted: boolean): string {
  if (n.literal) return n.literal;
  if (!n.given) return n.family;
  return inverted ? `${n.family}, ${n.given}` : `${n.given} ${n.family}`;
}

function nameList(list: Name[], lang: string, invertFirst: boolean): string {
  const T = terms(lang);
  const names = list.map((n, i) => fullName(n, invertFirst && i === 0));
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]}${invertFirst ? ',' : ''} ${T.and} ${names[1]}`;
  return `${names.slice(0, -1).join(', ')}, ${T.and} ${names[names.length - 1]}`;
}

const txt = (v: string): Inline => ({ t: 'text', v });
const em = (v: string): Inline => ({ t: 'em', c: [txt(v)] });

function endDot(s: string): string {
  return /[.?!…]$/.test(s) ? s : s + '.';
}

/** Una voce della bibliografia, con il titolo in corsivo dove serve. */
export function formatReference(e: BibEntry, idx: BibIndex, lang: string): Inline[] {
  const T = terms(lang);
  const out: Inline[] = [];
  const who = e.author?.length ? e.author : e.editor;
  const isEditors = !e.author?.length && !!e.editor?.length;
  if (who?.length) {
    let names = nameList(who, lang, true);
    if (isEditors) names += `, ${who.length > 1 ? T.eds : T.ed}`;
    out.push(txt(endDot(names) + ' '));
  }
  out.push(txt(endDot(idx.year(e, lang)) + ' '));
  const title = e.title ?? e.id;
  const quotedTitle = ['article-journal', 'chapter', 'paper-conference', 'webpage', 'thesis', 'report', 'misc'].includes(e.type) && !!e.container;
  if (e.type === 'book' || !quotedTitle) {
    out.push(em(title.replace(/\.$/, '')), txt('. '));
  } else {
    out.push(txt(`“${endDot(title)}” `));
  }
  switch (e.type) {
    case 'article-journal':
      if (e.container) out.push(em(e.container));
      if (e.volume) out.push(txt(` ${e.volume}`));
      if (e.issue) out.push(txt(` (${e.issue})`));
      if (e.pages) out.push(txt(`: ${e.pages}`));
      if (e.container || e.volume) out.push(txt('. '));
      break;
    case 'chapter':
    case 'paper-conference':
      if (e.container) {
        out.push(txt(`${T.in} `), em(e.container));
        if (e.author?.length && e.editor?.length) out.push(txt(`, ${T.edited} ${nameList(e.editor, lang, false)}`));
        if (e.pages) out.push(txt(`, ${e.pages}`));
        out.push(txt('. '));
      }
      break;
    case 'thesis':
    case 'report':
      if (e.genre) out.push(txt(endDot(e.genre) + ' '));
      break;
  }
  if (e.edition && !/^1$/.test(e.edition)) out.push(txt(`${endDot(e.edition)} `));
  const pub = [e.place, e.publisher].filter(Boolean).join(': ');
  if (pub && e.type !== 'article-journal') out.push(txt(endDot(pub) + ' '));
  if (e.doi) out.push(txt(`https://doi.org/${e.doi}.`));
  else if (e.url) out.push(txt(`${e.url}.`));
  // Spazio finale superfluo.
  const last = out[out.length - 1];
  if (last.t === 'text') last.v = last.v.trimEnd();
  return out;
}

/** Ordine della bibliografia: cognome del primo autore, anno, titolo. */
export function sortForReferences(entries: BibEntry[]): BibEntry[] {
  const coll = new Intl.Collator(undefined, { sensitivity: 'base' });
  const key = (e: BibEntry) => {
    const p = people(e)[0];
    return p ? (p.literal ?? p.family) + ' ' + (p.given ?? '') : (e.title ?? e.id);
  };
  return [...entries].sort((a, b) => coll.compare(key(a), key(b)) || (a.year ?? '').localeCompare(b.year ?? '') || coll.compare(a.title ?? '', b.title ?? ''));
}

/** Testo semplice di una voce (per i suggerimenti nell'editor e nell'elenco di ricerca). */
export function describe(e: BibEntry): { who: string; year: string; title: string } {
  const p = people(e);
  return {
    who: p.length ? (p.length > 2 ? `${nameText(p[0])} et al.` : p.map(nameText).join(', ')) : '',
    year: e.year ?? '',
    title: e.title ?? '',
  };
}
