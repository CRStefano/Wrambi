/**
 * Scrittura di un file BibLaTeX pulito con le sole opere citate: lo usano
 * Typst (PDF e sorgenti .typ) e biblatex (sorgenti .tex).
 */
import type { BibEntry, EntryType, Name } from './model';

const TYPES: Record<EntryType, string> = {
  book: 'book',
  'article-journal': 'article',
  chapter: 'incollection',
  'paper-conference': 'inproceedings',
  thesis: 'thesis',
  report: 'report',
  webpage: 'online',
  misc: 'misc',
};

/** Protegge i caratteri speciali di LaTeX e le graffe sbilanciate. */
function esc(s: string): string {
  return s.replace(/[\\{}&%$#_]/g, (c) => (c === '\\' ? '\\textbackslash{}' : '\\' + c));
}

function names(list: Name[]): string {
  return list.map((n) => (n.literal ? `{${esc(n.literal)}}` : n.given ? `${esc(n.family)}, ${esc(n.given)}` : esc(n.family))).join(' and ');
}

export function toBiblatex(entries: BibEntry[]): string {
  return entries
    .map((e) => {
      const f: [string, string | undefined][] = [
        ['author', e.author?.length ? names(e.author) : undefined],
        ['editor', e.editor?.length ? names(e.editor) : undefined],
        ['title', e.title ? esc(e.title) : undefined],
        [e.type === 'article-journal' ? 'journaltitle' : 'booktitle', e.container ? esc(e.container) : undefined],
        ['date', e.year],
        ['publisher', e.publisher ? esc(e.publisher) : undefined],
        ['location', e.place ? esc(e.place) : undefined],
        ['volume', e.volume ? esc(e.volume) : undefined],
        ['number', e.issue ? esc(e.issue) : undefined],
        ['pages', e.pages ? esc(e.pages.replace(/–/g, '--')) : undefined],
        ['edition', e.edition ? esc(e.edition) : undefined],
        ['type', e.genre ? esc(e.genre) : undefined],
        ['doi', e.doi],
        ['url', e.url],
      ];
      const body = f
        .filter(([, v]) => v)
        .map(([k, v]) => `  ${k} = {${v}}`)
        .join(',\n');
      return `@${TYPES[e.type]}{${e.id},\n${body}\n}`;
    })
    .join('\n\n') + '\n';
}
