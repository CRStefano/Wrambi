/**
 * Lettura di bibliografie in CSL JSON (Zotero: «Esporta libreria» → CSL JSON).
 */
import type { BibEntry, EntryType, Name } from './model';

interface CslName {
  family?: string;
  given?: string;
  literal?: string;
  'non-dropping-particle'?: string;
  'dropping-particle'?: string;
}

interface CslItem {
  id?: string | number;
  'citation-key'?: string;
  type?: string;
  title?: string;
  author?: CslName[];
  editor?: CslName[];
  issued?: { 'date-parts'?: (string | number)[][]; raw?: string; literal?: string };
  'container-title'?: string;
  publisher?: string;
  'publisher-place'?: string;
  volume?: string | number;
  issue?: string | number;
  page?: string;
  edition?: string | number;
  DOI?: string;
  URL?: string;
  genre?: string;
}

const TYPES: Record<string, EntryType> = {
  book: 'book',
  'article-journal': 'article-journal',
  'article-magazine': 'article-journal',
  'article-newspaper': 'article-journal',
  article: 'article-journal',
  chapter: 'chapter',
  'paper-conference': 'paper-conference',
  thesis: 'thesis',
  report: 'report',
  webpage: 'webpage',
  'post-weblog': 'webpage',
  post: 'webpage',
};

function name(n: CslName): Name {
  if (n.literal) return { family: n.literal, literal: n.literal };
  const family = [n['non-dropping-particle'], n.family].filter(Boolean).join(' ');
  const given = [n.given, n['dropping-particle']].filter(Boolean).join(' ');
  return given ? { family, given } : { family };
}

export function parseCslJson(src: string): BibEntry[] {
  const data = JSON.parse(src) as CslItem[] | { items?: CslItem[] };
  const items = Array.isArray(data) ? data : (data.items ?? []);
  return items
    .filter((it) => it && (it['citation-key'] || it.id != null))
    .map((it): BibEntry => {
      const year =
        it.issued?.['date-parts']?.[0]?.[0]?.toString() ?? (it.issued?.raw ?? it.issued?.literal ?? '').match(/\d{4}/)?.[0];
      const e: BibEntry = {
        id: String(it['citation-key'] ?? it.id),
        type: TYPES[it.type ?? ''] ?? 'misc',
        title: it.title,
        author: it.author?.map(name),
        editor: it.editor?.map(name),
        year,
        container: it['container-title'],
        publisher: it.publisher,
        place: it['publisher-place'],
        volume: it.volume?.toString(),
        issue: it.issue?.toString(),
        pages: it.page?.replace(/-/g, '–'),
        edition: it.edition?.toString(),
        doi: it.DOI,
        url: it.URL,
        genre: it.genre,
      };
      for (const k of Object.keys(e) as (keyof BibEntry)[]) if (e[k] === undefined || e[k] === '') delete e[k];
      return e;
    });
}
