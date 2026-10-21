import { docTitle, parse, stripNoteMarks } from './ast';
import { countWords, EmitContext, htmlBody, toHtmlDocument, toLatex, toText, toTypst, type EmitOptions, type TypstOptions } from './emit';
import { toBiblatex } from '../biblio/serialize';
import { markdownFootnotes } from './notes';
import { tk } from '../i18n/keys';

export type OutFormat = 'md' | 'txt' | 'html' | 'tex' | 'typ' | 'pdf' | 'epub';

export interface FormatInfo {
  id: OutFormat;
  label: string;
  ext: string;
  /** Cosa conserva e cosa no: mostrato all'utente prima di esportare. */
  fidelity: string;
}

export const FORMATS: FormatInfo[] = [
  {
    id: 'md',
    label: 'Markdown',
    ext: 'md',
    fidelity: tk('Il sorgente così com\'è: conserva tutta la struttura. Il sottolineato resta come <u>…</u>.'),
  },
  {
    id: 'txt',
    label: tk('Testo semplice'),
    ext: 'txt',
    fidelity: tk('Solo il testo: titoli, elenchi e citazioni diventano righe e rientri; enfasi e sottolineato si perdono.'),
  },
  {
    id: 'html',
    label: 'HTML',
    ext: 'html',
    fidelity: tk('Pagina web completa con stile incorporato: conserva tutta la struttura.'),
  },
  {
    id: 'pdf',
    label: 'PDF',
    ext: 'pdf',
    fidelity: tk(
      'Impaginato in A4 dal compilatore Typst integrato (font Libertinus Serif): struttura completa, impaginazione tipografica. Citazioni e bibliografia composte da Typst. Non è una copia dell\'aspetto dell\'editor.',
    ),
  },
  {
    id: 'epub',
    label: 'EPUB',
    ext: 'epub',
    fidelity: tk('EPUB 3 ridisponibile: conserva struttura e testo, con un capitolo per titolo principale. Nessuna impaginazione fissa.'),
  },
  {
    id: 'tex',
    label: 'LaTeX',
    ext: 'tex',
    fidelity: tk('Sorgente .tex completo (classe article, citazioni con biblatex). Da compilare con pdflatex, xelatex o lualatex: Wrambi non include LaTeX.'),
  },
  {
    id: 'typ',
    label: 'Typst',
    ext: 'typ',
    fidelity: tk('Sorgente .typ completo, compilabile con Typst (anche dentro Wrambi).'),
  },
];

export function formatInfo(id: OutFormat): FormatInfo {
  return FORMATS.find((f) => f.id === id)!;
}

export type TextualFormat = Exclude<OutFormat, 'pdf' | 'epub'>;

export interface ConvertOptions extends EmitOptions {
  title?: string;
  typst?: TypstOptions;
}

export interface Converted {
  text: string;
  /** BibLaTeX con le sole opere citate, da affiancare a .typ e .tex (e per il PDF). */
  bib: string | null;
}

/** Conversione testuale: tutti i formati tranne PDF ed EPUB (binari). */
export function convertDocument(src: string, format: TextualFormat | 'html-fragment', opts: ConvertOptions = {}): Converted {
  if (format === 'md') {
    // Il sorgente resta com'è; le note di Wrambi diventano note di Pandoc ([^1]).
    return { text: opts.notes?.length ? markdownFootnotes(src, opts.notes) : stripNoteMarks(src).text, bib: null };
  }
  const doc = parse(src, { citeKeys: opts.bib?.keys });
  const title = opts.title ?? docTitle(doc, 'Documento');
  const x = new EmitContext(doc, opts);
  let text: string;
  switch (format) {
    case 'txt':
      text = toText(doc, x);
      break;
    case 'html':
      text = toHtmlDocument(doc, title, x);
      break;
    case 'html-fragment':
      text = htmlBody(doc, { ctx: x });
      break;
    case 'tex':
      text = toLatex(doc, title, x);
      break;
    case 'typ':
      text = toTypst(doc, title, opts.typst, x);
      break;
  }
  const bib = (format === 'typ' || format === 'tex') && x.cited.length ? toBiblatex(x.cited.map((k) => opts.bib!.get(k)!)) : null;
  return { text, bib };
}

export function convertText(src: string, format: TextualFormat | 'html-fragment', opts: ConvertOptions = {}): string {
  return convertDocument(src, format, opts).text;
}

export interface Analysis {
  words: number;
  chars: number;
  title: string;
}

export function analyze(src: string, fallbackTitle: string): Analysis {
  const doc = parse(src);
  return { words: countWords(doc), chars: [...src].length, title: docTitle(doc, fallbackTitle) };
}

export { parse, docTitle };
