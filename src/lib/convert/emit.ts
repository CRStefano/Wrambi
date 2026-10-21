/**
 * Generatori dei formati di uscita a partire dalla struttura del documento.
 * Ogni funzione è pura e sincrona: gira nel worker di conversione, così la
 * digitazione nell'editor non viene mai rallentata.
 */
import { plain, type Align, type Block, type Doc, type Inline } from './ast';
import { BibIndex, formatCitation, formatReference, sortForReferences, terms } from '../biblio/format';
import type { BibEntry } from '../biblio/model';

/* ───────────────────────────── Contesto ───────────────────────────── */

export interface EmitOptions {
  /** Lingua del documento (it, en, fr, de, es, pt): sillabazione, termini, virgolette. */
  lang?: string;
  /** Bibliografia per le citazioni `[@chiave]`. */
  bib?: BibIndex | null;
  /** Testi delle note di Wrambi esportate: `notes[n - 1]` per il segnaposto n. */
  notes?: string[];
  /** File .bib a cui rimandano Typst e biblatex. */
  bibFile?: string;
}

/** Visita ogni nodo inline del documento. */
export function walkInlines(blocks: Block[], fn: (n: Inline) => void) {
  const inl = (c: Inline[]) => {
    for (const n of c) {
      fn(n);
      if ('c' in n) inl(n.c);
    }
  };
  for (const b of blocks) {
    switch (b.t) {
      case 'heading':
      case 'para':
        inl(b.c);
        break;
      case 'list':
        for (const it of b.items) walkInlines(it, fn);
        break;
      case 'quote':
        walkInlines(b.c, fn);
        break;
      case 'table':
        for (const r of [b.head, ...b.rows]) for (const c of r) inl(c);
        break;
    }
  }
}

/** Stato di una conversione: opere citate e numerazione delle note. */
export class EmitContext {
  readonly lang: string;
  readonly bib: BibIndex | null;
  readonly bibFile: string;
  /** Chiavi citate e presenti in bibliografia, nell'ordine della prima citazione. */
  readonly cited: string[] = [];
  /** Note incontrate, nell'ordine in cui compaiono. */
  readonly footnotes: { num: number; text: string; back: string }[] = [];
  private readonly notes: string[];
  private readonly numbers = new Map<number, number>();

  constructor(doc: Doc | null, o: EmitOptions = {}) {
    this.lang = o.lang ?? 'it';
    this.bib = o.bib ?? null;
    this.notes = o.notes ?? [];
    this.bibFile = o.bibFile ?? 'bibliografia.bib';
    if (doc && this.bib) {
      const seen = new Set<string>();
      walkInlines(doc.blocks, (n) => {
        if (n.t !== 'cite') return;
        for (const it of n.items) {
          if (this.bib!.has(it.key) && !seen.has(it.key)) {
            seen.add(it.key);
            this.cited.push(it.key);
          }
        }
      });
      this.bib.disambiguate(this.cited, this.lang);
    }
  }

  get terms() {
    return terms(this.lang);
  }

  /** Numero (in ordine di comparsa) e testo della nota n; `back` è il file del richiamo (EPUB). */
  note(n: number, back = ''): { num: number; text: string } | null {
    const text = this.notes[n - 1];
    if (text === undefined) return null;
    let num = this.numbers.get(n);
    if (num === undefined) {
      num = this.numbers.size + 1;
      this.numbers.set(n, num);
      this.footnotes.push({ num, text, back });
    }
    return { num, text };
  }

  /** Le opere citate, nell'ordine della bibliografia. */
  citedEntries(): BibEntry[] {
    if (!this.bib) return [];
    return sortForReferences(this.cited.map((k) => this.bib!.get(k)!));
  }

  /** Testo di una citazione nello stile autore-anno di Wrambi. */
  citeText(n: Extract<Inline, { t: 'cite' }>): string {
    if (this.bib) return formatCitation(n.items, n.bracket, this.bib, this.lang);
    return citeSource(n);
  }
}

/** La citazione come era scritta: `[vedi @rossi2020, p. 3]`. */
export function citeSource(n: Extract<Inline, { t: 'cite' }>): string {
  if (!n.bracket) return '@' + n.items[0].key;
  const parts = n.items.map(
    (it) => `${it.prefix ? it.prefix + ' ' : ''}${it.suppressAuthor ? '-' : ''}@${it.key}${it.locator ? ', ' + it.locator : ''}`,
  );
  return `[${parts.join('; ')}]`;
}

/** Il nome del file .bib accanto a un'esportazione: «Saggio.typ» → «Saggio.bib». */
export function bibFileFor(fileName: string): string {
  return fileName.replace(/\.[^./\\]+$/, '') + '.bib';
}

/* ───────────────────────────── HTML ───────────────────────────── */

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** Solo indirizzi sicuri nei collegamenti: niente javascript: o simili. */
export function safeHref(href: string): string {
  const h = href.trim();
  if (/^(https?:|mailto:|tel:|#|\/|\.\.?\/)/i.test(h) || !/^[a-z][a-z0-9+.-]*:/i.test(h)) return h;
  return '#';
}

export interface HtmlOpts {
  /** XHTML per EPUB: tag vuoti chiusi (`<br/>`). */
  xhtml?: boolean;
  ctx?: EmitContext;
  /** EPUB: file del capitolo corrente e file delle note, per i collegamenti. */
  file?: string;
  notesFile?: string;
}

const defaultCtx = () => new EmitContext(null);

function htmlInline(c: Inline[], o: HtmlOpts): string {
  const x = (o.ctx ??= defaultCtx());
  let s = '';
  for (const n of c) {
    switch (n.t) {
      case 'text':
        s += escapeHtml(n.v);
        break;
      case 'strong':
        s += `<strong>${htmlInline(n.c, o)}</strong>`;
        break;
      case 'em':
        s += `<em>${htmlInline(n.c, o)}</em>`;
        break;
      case 'u':
        s += `<u>${htmlInline(n.c, o)}</u>`;
        break;
      case 's':
        s += `<s>${htmlInline(n.c, o)}</s>`;
        break;
      case 'code':
        s += `<code>${escapeHtml(n.v)}</code>`;
        break;
      case 'link': {
        const title = n.title ? ` title="${escapeHtml(n.title)}"` : '';
        s += `<a href="${escapeHtml(safeHref(n.href))}"${title}>${htmlInline(n.c, o)}</a>`;
        break;
      }
      case 'image':
        // Le immagini locali non vengono incorporate: si mostra il testo alternativo.
        if (/^(https?:|data:image\/)/i.test(n.src)) {
          s += `<img src="${escapeHtml(n.src)}" alt="${escapeHtml(n.alt)}"${o.xhtml ? ' /' : ''}>`;
        } else {
          s += `<span class="img-missing">[${escapeHtml(n.alt || x.terms.image)}]</span>`;
        }
        break;
      case 'br':
        s += o.xhtml ? '<br />\n' : '<br>\n';
        break;
      case 'soft':
        s += '\n';
        break;
      case 'cite':
        s += `<span class="cite">${escapeHtml(x.citeText(n))}</span>`;
        break;
      case 'note': {
        const f = x.note(n.n, o.file ?? '');
        if (!f) break;
        const epub = o.xhtml ? ' epub:type="noteref"' : '';
        s += `<sup class="fnref"><a id="fnref-${f.num}" href="${o.notesFile ?? ''}#fn-${f.num}"${epub} role="doc-noteref">${f.num}</a></sup>`;
        break;
      }
    }
  }
  return s;
}

function htmlText(t: string, o: HtmlOpts): string {
  return escapeHtml(t).replace(/\n/g, o.xhtml ? '<br />' : '<br>');
}

/** Le note di Wrambi raccolte durante la conversione, come note di chiusura. */
export function htmlNotes(o: HtmlOpts): string {
  const x = o.ctx;
  if (!x?.footnotes.length) return '';
  const epub = o.xhtml;
  const items = x.footnotes
    .map(
      (f) =>
        `<li id="fn-${f.num}"${epub ? ' epub:type="endnote"' : ''} role="doc-endnote"><p>${htmlText(f.text, o)} <a href="${f.back}#fnref-${f.num}" class="fnback" role="doc-backlink">\u21a9\ufe0e</a></p></li>`,
    )
    .join('\n');
  return `<section class="footnotes"${epub ? ' epub:type="endnotes"' : ''} role="doc-endnotes">\n<h2>${escapeHtml(x.terms.notes)}</h2>\n<ol>\n${items}\n</ol>\n</section>`;
}

/** La bibliografia con le sole opere citate. */
export function htmlReferences(o: HtmlOpts): string {
  const x = o.ctx;
  if (!x?.bib || !x.cited.length) return '';
  const refs = x
    .citedEntries()
    .map((e) => `<p class="ref">${htmlInline(formatReference(e, x.bib!, x.lang), o)}</p>`)
    .join('\n');
  return `<section class="references" role="doc-bibliography">\n<h2>${escapeHtml(x.terms.references)}</h2>\n${refs}\n</section>`;
}

function alignAttr(a: Align): string {
  return a ? ` style="text-align:${a}"` : '';
}

export function htmlBlocks(blocks: Block[], o: HtmlOpts = {}, tight = false): string {
  o.ctx ??= defaultCtx();
  const out: string[] = [];
  for (const b of blocks) {
    switch (b.t) {
      case 'heading':
        out.push(`<h${b.level}>${htmlInline(b.c, o)}</h${b.level}>`);
        break;
      case 'para':
        out.push(tight ? htmlInline(b.c, o) : `<p>${htmlInline(b.c, o)}</p>`);
        break;
      case 'list': {
        const tag = b.ordered ? 'ol' : 'ul';
        const start = b.ordered && b.start !== 1 ? ` start="${b.start}"` : '';
        const items = b.items.map((it) => `<li>${htmlBlocks(it, o, b.tight)}</li>`).join('\n');
        out.push(`<${tag}${start}>\n${items}\n</${tag}>`);
        break;
      }
      case 'quote':
        out.push(`<blockquote>\n${htmlBlocks(b.c, o)}\n</blockquote>`);
        break;
      case 'code': {
        const cls = b.lang ? ` class="language-${escapeHtml(b.lang)}"` : '';
        out.push(`<pre><code${cls}>${escapeHtml(b.v)}</code></pre>`);
        break;
      }
      case 'hr':
        out.push(o.xhtml ? '<hr />' : '<hr>');
        break;
      case 'table': {
        const head = b.head.map((c, i) => `<th${alignAttr(b.align[i])}>${htmlInline(c, o)}</th>`).join('');
        const rows = b.rows
          .map((r) => `<tr>${r.map((c, i) => `<td${alignAttr(b.align[i])}>${htmlInline(c, o)}</td>`).join('')}</tr>`)
          .join('\n');
        out.push(`<table>\n<thead><tr>${head}</tr></thead>\n<tbody>\n${rows}\n</tbody>\n</table>`);
        break;
      }
    }
  }
  return out.join('\n');
}

/** Foglio di stile condiviso da anteprima, HTML esportato ed EPUB. */
export const DOCUMENT_CSS = `
body { font-family: "Literata", "Iowan Old Style", Georgia, "Times New Roman", serif; line-height: 1.6; color: #1e2430; max-width: 42em; margin: 3em auto; padding: 0 1.5em; font-size: 1.05rem; }
h1, h2, h3, h4, h5, h6 { line-height: 1.25; margin: 1.6em 0 .5em; font-weight: 650; }
h1 { font-size: 1.9em; margin-top: .4em; } h2 { font-size: 1.45em; } h3 { font-size: 1.2em; } h4, h5, h6 { font-size: 1em; }
p { margin: 0 0 .9em; }
a { color: #2450b2; }
blockquote { margin: 1.2em 0; padding: .1em 0 .1em 1.1em; border-left: 3px solid #c8cdd5; color: #4a5260; }
code { font-family: "JetBrains Mono", Consolas, monospace; font-size: .88em; background: #f1f3f5; padding: .1em .3em; border-radius: 3px; }
pre { background: #f1f3f5; padding: .9em 1em; border-radius: 6px; overflow-x: auto; line-height: 1.45; }
pre code { background: none; padding: 0; }
hr { border: 0; border-top: 1px solid #d5d9df; margin: 2em 0; }
table { border-collapse: collapse; margin: 1.2em 0; }
th, td { border: 1px solid #d5d9df; padding: .35em .7em; }
th { background: #f4f5f7; }
img { max-width: 100%; }
.img-missing { color: #7a8290; font-style: italic; }
sup.fnref { line-height: 0; font-size: .75em; } sup.fnref a { text-decoration: none; padding: 0 .1em; }
.footnotes, .references { margin-top: 2.5em; border-top: 1px solid #d5d9df; }
.footnotes h2, .references h2 { font-size: 1.15em; }
.footnotes ol { padding-left: 1.6em; font-size: .92em; } .footnotes li p { margin: 0 0 .4em; }
.fnback { text-decoration: none; }
.references .ref { padding-left: 2em; text-indent: -2em; margin: 0 0 .55em; }
`.trim();

/** Corpo HTML completo: testo, note e bibliografia. */
export function htmlBody(doc: Doc, o: HtmlOpts = {}): string {
  o.ctx ??= defaultCtx();
  return [htmlBlocks(doc.blocks, o), htmlNotes(o), htmlReferences(o)].filter(Boolean).join('\n');
}

export function toHtmlDocument(doc: Doc, title: string, ctx: EmitContext = new EmitContext(doc)): string {
  const lang = ctx.lang;
  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="Wrambi">
<title>${escapeHtml(title)}</title>
<style>
${DOCUMENT_CSS}
</style>
</head>
<body>
${htmlBody(doc, { ctx })}
</body>
</html>
`;
}

/* ───────────────────────────── LaTeX ───────────────────────────── */

const LATEX_ESC: Record<string, string> = {
  '\\': '\\textbackslash{}',
  '{': '\\{',
  '}': '\\}',
  $: '\\$',
  '&': '\\&',
  '#': '\\#',
  '^': '\\textasciicircum{}',
  _: '\\_',
  '%': '\\%',
  '~': '\\textasciitilde{}',
  '<': '\\textless{}',
  '>': '\\textgreater{}',
  '|': '\\textbar{}',
  '"': '\\textquotedbl{}',
};

export function escapeLatex(s: string): string {
  return s.replace(/[\\{}$&#^_%~<>|"]/g, (c) => LATEX_ESC[c]);
}

function latexUrl(s: string): string {
  return s.replace(/[\\{}%#]/g, (c) => '\\' + c);
}

/** Argomento opzionale protetto: le graffe ammettono anche "]" nel testo. */
const opt = (v: string) => `[{${v}}]`;

function latexCite(n: Extract<Inline, { t: 'cite' }>, x: EmitContext): string {
  const items = n.items.filter((it) => x.bib?.has(it.key));
  if (!items.length) return escapeLatex(citeSource(n));
  if (!n.bracket) return `\\textcite{${items[0].key}}`;
  const args = (it: (typeof items)[number]) => {
    const pre = it.prefix ? escapeLatex(it.prefix) : '';
    const post = it.locator ? escapeLatex(it.locator) : '';
    return pre ? opt(pre) + opt(post) : post ? opt(post) : '';
  };
  if (items.length === 1) {
    const it = items[0];
    return `\\autocite${it.suppressAuthor ? '*' : ''}${args(it)}{${it.key}}`;
  }
  return '\\autocites' + items.map((it) => `${args(it)}{${it.key}}`).join('');
}

function latexInline(c: Inline[], x: EmitContext): string {
  let s = '';
  for (const n of c) {
    switch (n.t) {
      case 'text':
        s += escapeLatex(n.v);
        break;
      case 'strong':
        s += `\\textbf{${latexInline(n.c, x)}}`;
        break;
      case 'em':
        s += `\\emph{${latexInline(n.c, x)}}`;
        break;
      case 'u':
        s += `\\uline{${latexInline(n.c, x)}}`;
        break;
      case 's':
        s += `\\sout{${latexInline(n.c, x)}}`;
        break;
      case 'code':
        s += `\\texttt{${escapeLatex(n.v)}}`;
        break;
      case 'link':
        s += `\\href{${latexUrl(safeHref(n.href))}}{${latexInline(n.c, x)}}`;
        break;
      case 'image':
        s += `[${escapeLatex(n.alt || x.terms.image)}]`;
        break;
      case 'br':
        s += '\\\\\n';
        break;
      case 'soft':
        s += '\n';
        break;
      case 'cite':
        s += latexCite(n, x);
        break;
      case 'note': {
        const f = x.note(n.n);
        if (f) s += `\\footnote{${escapeLatex(f.text.trim()).replace(/\s*\n\s*/g, ' ')}}`;
        break;
      }
    }
  }
  return s;
}

const LATEX_HEADINGS = ['section', 'subsection', 'subsubsection', 'paragraph', 'subparagraph', 'subparagraph'];

function latexBlocks(blocks: Block[], x: EmitContext): string {
  const out: string[] = [];
  for (const b of blocks) {
    switch (b.t) {
      case 'heading':
        out.push(`\\${LATEX_HEADINGS[b.level - 1]}*{${latexInline(b.c, x)}}`);
        break;
      case 'para':
        out.push(latexInline(b.c, x));
        break;
      case 'list': {
        const env = b.ordered ? 'enumerate' : 'itemize';
        const opts = b.ordered && b.start !== 1 ? `\n\\setcounter{enumi}{${b.start - 1}}` : '';
        const items = b.items.map((it) => `  \\item ${latexBlocks(it, x).replace(/\n/g, '\n  ')}`).join('\n');
        out.push(`\\begin{${env}}${opts}\n${items}\n\\end{${env}}`);
        break;
      }
      case 'quote':
        out.push(`\\begin{quote}\n${latexBlocks(b.c, x)}\n\\end{quote}`);
        break;
      case 'code':
        // verbatim non può contenere la propria chiusura.
        out.push(`\\begin{verbatim}\n${b.v.replace(/\\end\{verbatim\}/g, '\\end {verbatim}')}\n\\end{verbatim}`);
        break;
      case 'hr':
        out.push('\\par\\noindent\\rule{\\linewidth}{0.4pt}');
        break;
      case 'table': {
        const cols = b.head.map((_, i) => (b.align[i] === 'center' ? 'c' : b.align[i] === 'right' ? 'r' : 'l')).join('');
        const row = (cells: Inline[][]) => cells.map((c) => latexInline(c, x)).join(' & ') + ' \\\\';
        out.push(
          `\\begin{center}\n\\begin{tabular}{${cols}}\n\\toprule\n${row(b.head)}\n\\midrule\n${b.rows.map(row).join('\n')}\n\\bottomrule\n\\end{tabular}\n\\end{center}`,
        );
        break;
      }
    }
  }
  return out.join('\n\n');
}

const BABEL: Record<string, string> = {
  it: 'italian',
  en: 'english',
  fr: 'french',
  de: 'ngerman',
  es: 'spanish',
  pt: 'portuguese',
};

export function toLatex(doc: Doc, title: string, x: EmitContext = new EmitContext(doc)): string {
  const body = latexBlocks(doc.blocks, x);
  const cites = x.cited.length > 0;
  const biblatex = cites
    ? `\\usepackage{csquotes}
% Bibliografia: compila con pdflatex → biber → pdflatex (o con latexmk).
\\usepackage[style=authoryear,backend=biber]{biblatex}
\\addbibresource{${latexUrl(x.bibFile)}}
`
    : '';
  return `% Generato da Wrambi. Compilabile con pdflatex, xelatex o lualatex.
\\documentclass[a4paper,11pt]{article}
\\usepackage{iftex}
\\ifPDFTeX
  \\usepackage[T1]{fontenc}
  \\usepackage[utf8]{inputenc}
  \\usepackage{lmodern}
\\fi
\\usepackage[${BABEL[x.lang] ?? 'english'}]{babel}
\\usepackage[normalem]{ulem}
\\usepackage{booktabs}
${biblatex}\\usepackage[hidelinks]{hyperref}
\\usepackage[a4paper,margin=2.5cm]{geometry}
\\setlength{\\parskip}{0.5em}
\\setlength{\\parindent}{0pt}
\\hypersetup{pdftitle={${escapeLatex(title)}}}

\\begin{document}

${body}
${cites ? '\n\\printbibliography\n' : ''}
\\end{document}
`;
}

/* ───────────────────────────── Typst ───────────────────────────── */

/** Caratteri che in Typst hanno un significato e vanno preceduti da `\`. */
const TYPST_ALWAYS = /[\\*_`$#[\]<>@~/'"]/g;

export function escapeTypst(s: string, lineStart = false): string {
  let r = s.replace(TYPST_ALWAYS, (c) => '\\' + c);
  if (lineStart) {
    // A inizio riga: titoli (=), elenchi (- + /), numerazioni (1.) e termini.
    r = r.replace(/^(\s*)([=+-])/, '$1\\$2').replace(/^(\s*)(\d+)\./, '$1$2\\.');
  }
  return r;
}

function typstString(s: string): string {
  return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

/** Sorgente Typst della citazione e se termina con una chiamata `#cite(…)`. */
function typstCite(n: Extract<Inline, { t: 'cite' }>, x: EmitContext): [string, boolean] {
  // Typst si ferma su una chiave inesistente: si citano solo quelle in bibliografia.
  const items = n.items.filter((it) => x.bib?.has(it.key));
  if (!items.length) return [escapeTypst(citeSource(n)), false];
  const call = (it: (typeof items)[number], form?: string) => {
    const args = [`label(${typstString(it.key)})`];
    if (it.locator) args.push(`supplement: [${escapeTypst(it.locator)}]`);
    if (form) args.push(`form: "${form}"`);
    return `#cite(${args.join(', ')})`;
  };
  if (!n.bracket) return [call(items[0], 'prose'), true];
  if (items.length === 1 && items[0].suppressAuthor) return [`(${call(items[0], 'year')})`, false];
  // Le citazioni separate solo da spazi diventano un unico gruppo: (Rossi 2020; Bianchi 2019).
  const prefix = items[0].prefix ? escapeTypst(items[0].prefix) + ' ' : '';
  return [prefix + items.map((it) => call(it)).join(' '), true];
}

function typstInline(c: Inline[], x: EmitContext, atLineStart = true): string {
  let s = '';
  let lineStart = atLineStart;
  let afterCall = false;
  for (const n of c) {
    const wasCall = afterCall;
    afterCall = !['text', 'br', 'soft', 'image'].includes(n.t);
    switch (n.t) {
      case 'text': {
        let t = n.v
          .split('\n')
          .map((part, i) => escapeTypst(part, i > 0 || lineStart))
          .join('\n');
        // Dopo #f[...] un "." o "(" continuerebbe l'espressione: ";" la chiude.
        if (wasCall && /^[.(]/.test(t)) t = ';' + t;
        s += t;
        break;
      }
      case 'strong':
        s += `#strong[${typstInline(n.c, x, false)}]`;
        break;
      case 'em':
        s += `#emph[${typstInline(n.c, x, false)}]`;
        break;
      case 'u':
        s += `#underline[${typstInline(n.c, x, false)}]`;
        break;
      case 's':
        s += `#strike[${typstInline(n.c, x, false)}]`;
        break;
      case 'code':
        s += `#raw(${typstString(n.v)})`;
        break;
      case 'link':
        s += `#link(${typstString(safeHref(n.href))})[${typstInline(n.c, x, false)}]`;
        break;
      case 'image':
        s += `\\[${escapeTypst(n.alt || x.terms.image)}\\]`;
        break;
      case 'cite': {
        const [t, call] = typstCite(n, x);
        afterCall = call;
        s += t;
        break;
      }
      case 'note': {
        const f = x.note(n.n);
        if (f) s += `#footnote[${escapeTypst(f.text.trim().replace(/\s*\n\s*/g, ' '), true)}]`;
        else afterCall = false;
        break;
      }
      case 'br':
        s += ' \\\n';
        lineStart = true;
        continue;
      case 'soft':
        s += '\n';
        lineStart = true;
        continue;
    }
    lineStart = false;
  }
  return s;
}

function typstFence(code: string): string {
  let fence = '```';
  while (code.includes(fence)) fence += '`';
  return fence;
}

function indent(s: string, pad: string): string {
  return s
    .split('\n')
    .map((l) => (l ? pad + l : l))
    .join('\n');
}

function typstBlocks(blocks: Block[], x: EmitContext): string {
  const out: string[] = [];
  for (const b of blocks) {
    switch (b.t) {
      case 'heading':
        out.push(`${'='.repeat(b.level)} ${typstInline(b.c, x, false)}`);
        break;
      case 'para':
        out.push(typstInline(b.c, x));
        break;
      case 'list': {
        const items = b.items.map((it, k) => {
          const marker = b.ordered ? `${b.start + k}.` : '-';
          const body = typstBlocks(it, x);
          const [first, ...rest] = body.split('\n');
          const cont = rest.length ? '\n' + indent(rest.join('\n'), '  ') : '';
          return `${marker} ${first ?? ''}${cont}`;
        });
        out.push(items.join(b.tight ? '\n' : '\n\n'));
        break;
      }
      case 'quote':
        out.push(`#quote(block: true)[\n${typstBlocks(b.c, x)}\n]`);
        break;
      case 'code': {
        const fence = typstFence(b.v);
        out.push(`${fence}${b.lang}\n${b.v}\n${fence}`);
        break;
      }
      case 'hr':
        out.push('#line(length: 100%, stroke: 0.5pt + luma(180))');
        break;
      case 'table': {
        const align = b.align.map((a) => a ?? 'left').join(', ');
        const cell = (c: Inline[]) => `[${typstInline(c, x, false)}]`;
        const head = b.head.map(cell).join(', ');
        const rows = b.rows.map((r) => '  ' + r.map(cell).join(', ') + ',').join('\n');
        out.push(
          `#table(\n  columns: ${b.head.length},\n  align: (${align}${b.head.length === 1 ? ',' : ''}),\n  table.header(${head}),\n${rows}\n)`,
        );
        break;
      }
    }
  }
  return out.join('\n\n');
}

export interface TypstOptions {
  font?: string;
  size?: number;
}

export function toTypst(doc: Doc, title: string, opts: TypstOptions = {}, x: EmitContext = new EmitContext(doc)): string {
  const font = opts.font ?? 'Libertinus Serif';
  const size = opts.size ?? 11;
  const body = typstBlocks(doc.blocks, x);
  const bibliography = x.cited.length ? `\n\n#bibliography(${typstString(x.bibFile)}, style: "chicago-author-date")` : '';
  return `// Generato da Wrambi. Compilabile con Typst (anche dentro Wrambi).
#set document(title: ${typstString(title)})
#set page(paper: "a4", margin: 2.5cm)
#set text(lang: ${typstString(x.lang)}, font: ${typstString(font)}, size: ${size}pt)
#set par(justify: true, leading: 0.7em)
#set heading(numbering: none)
#show heading: set block(above: 1.4em, below: 0.8em)
#show link: underline

${body}${bibliography}
`;
}

/* ───────────────────────────── Testo semplice ───────────────────────────── */

function textInline(c: Inline[], x: EmitContext): string {
  let s = '';
  for (const n of c) {
    switch (n.t) {
      case 'text':
      case 'code':
        s += n.v;
        break;
      case 'link': {
        const label = textInline(n.c, x);
        s += label && label !== n.href ? `${label} (${n.href})` : n.href;
        break;
      }
      case 'image':
        s += `[${n.alt || x.terms.image}]`;
        break;
      case 'br':
      case 'soft':
        s += '\n';
        break;
      case 'cite':
        s += x.citeText(n);
        break;
      case 'note': {
        const f = x.note(n.n);
        if (f) s += `[${f.num}]`;
        break;
      }
      default:
        s += textInline(n.c, x);
    }
  }
  return s;
}

function textHeading(t: string, level: number): string {
  return level <= 2 ? `${t}\n${(level === 1 ? '=' : '-').repeat(Math.max(3, [...t].length))}` : t;
}

function textBlocks(blocks: Block[], x: EmitContext): string {
  const out: string[] = [];
  for (const b of blocks) {
    switch (b.t) {
      case 'heading':
        out.push(textHeading(textInline(b.c, x), b.level));
        break;
      case 'para':
        out.push(textInline(b.c, x));
        break;
      case 'list':
        out.push(
          b.items
            .map((it, k) => {
              const marker = b.ordered ? `${b.start + k}. ` : '• ';
              const body = textBlocks(it, x);
              return marker + indent(body, ' '.repeat(marker.length)).slice(marker.length);
            })
            .join(b.tight ? '\n' : '\n\n'),
        );
        break;
      case 'quote':
        out.push(indent(textBlocks(b.c, x), '    '));
        break;
      case 'code':
        out.push(indent(b.v, '    '));
        break;
      case 'hr':
        out.push('* * *');
        break;
      case 'table':
        out.push([b.head, ...b.rows].map((r) => r.map((c) => textInline(c, x)).join('\t')).join('\n'));
        break;
    }
  }
  return out.join('\n\n');
}

export function toText(doc: Doc, x: EmitContext = new EmitContext(doc)): string {
  const parts = [textBlocks(doc.blocks, x)];
  if (x.footnotes.length) {
    const T = x.terms;
    const width = String(x.footnotes.length).length + 3;
    const list = x.footnotes.map((f) => {
      const mark = `[${f.num}]`.padEnd(width);
      return mark + indent(f.text.trim(), ' '.repeat(width)).slice(width);
    });
    parts.push(textHeading(T.notes, 2) + '\n\n' + list.join('\n'));
  }
  if (x.bib && x.cited.length) {
    const refs = x.citedEntries().map((e) => textInline(formatReference(e, x.bib!, x.lang), x));
    parts.push(textHeading(x.terms.references, 2) + '\n\n' + refs.join('\n\n'));
  }
  return parts.join('\n\n') + '\n';
}

/** Conta le parole del testo visibile (senza la sintassi Markdown). */
export function countWords(doc: Doc): number {
  const t = textBlocks(doc.blocks, new EmitContext(null));
  const m = t.match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu);
  return m ? m.length : 0;
}

export { plain };
