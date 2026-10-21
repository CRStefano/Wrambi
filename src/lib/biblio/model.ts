/**
 * Bibliografia: le voci lette da un file BibTeX/BibLaTeX o CSL JSON (per
 * esempio esportato da Zotero), in una forma comune.
 */

export interface Name {
  family: string;
  given?: string;
  /** Nome di un ente, da non dividere ("World Health Organization"). */
  literal?: string;
}

export type EntryType =
  | 'book'
  | 'article-journal'
  | 'chapter'
  | 'paper-conference'
  | 'thesis'
  | 'report'
  | 'webpage'
  | 'misc';

export interface BibEntry {
  /** Chiave di citazione: `[@chiave]`. */
  id: string;
  type: EntryType;
  title?: string;
  author?: Name[];
  editor?: Name[];
  year?: string;
  /** Rivista, libro che contiene il capitolo, atti del convegno. */
  container?: string;
  publisher?: string;
  place?: string;
  volume?: string;
  issue?: string;
  pages?: string;
  edition?: string;
  doi?: string;
  url?: string;
  /** Tipo di tesi o di rapporto ("PhD thesis"). */
  genre?: string;
}

/** Caratteri ammessi in una chiave di citazione (come in Pandoc). */
export const KEY_CHARS = /[\p{L}\p{N}_:.#$%&+?<>~/-]/u;

export function nameText(n: Name): string {
  if (n.literal) return n.literal;
  return n.given ? `${n.given} ${n.family}` : n.family;
}
