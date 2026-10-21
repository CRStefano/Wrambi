import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
import { describe, expect, it } from 'vitest';
import { parse, plain } from '../src/lib/convert/ast';
import { convertText, analyze } from '../src/lib/convert';
import { escapeLatex, escapeTypst, safeHref } from '../src/lib/convert/emit';
import { buildEpubFromMarkdown, readEpub, readHtml, splitChapters } from '../src/lib/convert/epub';
import { unzipSync, strFromU8 } from 'fflate';

const sample = readFileSync(join(root, 'tests/fixtures/campione.md'), 'utf8');

describe('struttura del documento', () => {
  it('riconosce titoli, enfasi, sottolineato, barrato, collegamenti', () => {
    const doc = parse(sample);
    expect(doc.blocks[0]).toMatchObject({ t: 'heading', level: 1 });
    const para = doc.blocks[1];
    expect(para.t).toBe('para');
    const kinds = (para as { c: { t: string }[] }).c.map((n) => n.t);
    expect(kinds).toEqual(expect.arrayContaining(['strong', 'em', 'u', 's', 'code', 'link', 'soft']));
  });

  it('il sottolineato non bilanciato non rompe il testo', () => {
    const doc = parse('a <u>b c');
    expect(plain((doc.blocks[0] as unknown as { c: never[] }).c)).toBe('a b c');
  });

  it('elenchi ordinati con numero iniziale e annidati', () => {
    const doc = parse(sample);
    const lists = doc.blocks.filter((b) => b.t === 'list');
    expect(lists[0]).toMatchObject({ ordered: false, tight: true });
    expect(lists[1]).toMatchObject({ ordered: true, start: 3 });
    const nested = (lists[0] as { items: { t: string }[][] }).items[1];
    expect(nested.some((b) => b.t === 'list')).toBe(true);
  });

  it('tabelle con allineamento', () => {
    const table = parse(sample).blocks.find((b) => b.t === 'table');
    expect(table).toMatchObject({ align: ['left', 'center', 'right'] });
  });

  it('conta parole e trova il titolo', () => {
    const a = analyze('# Il mio titolo\n\nDue parole, l\'altra: tre.', 'X');
    expect(a.title).toBe('Il mio titolo');
    expect(a.words).toBe(7); // "l'altra" è una parola, come in Word
  });
});

describe('HTML', () => {
  const html = convertText(sample, 'html');

  it('produce un documento completo e ben strutturato', () => {
    expect(html).toMatch(/^<!DOCTYPE html>/);
    expect(html).toContain('<title>Saggio sul tempo</title>');
    expect(html).toContain('<h1>Saggio sul tempo</h1>');
    expect(html).toContain('<strong>grassetto</strong>');
    expect(html).toContain('<u>sottolineato</u>');
    expect(html).toContain('<s>barrato</s>');
    expect(html).toContain('<ol start="3">');
    expect(html).toContain('<th style="text-align:center">Anno</th>');
    expect(html).toContain('<pre><code class="language-python">');
  });

  it('non lascia passare HTML né collegamenti pericolosi', () => {
    const out = convertText('<script>alert(1)</script> [x](javascript:alert(1)) <b>no</b>', 'html-fragment');
    expect(out).not.toContain('<script>');
    expect(out).not.toContain('href="javascript');
    expect(out).toContain('&lt;b&gt;no&lt;/b&gt;');
    expect(safeHref('JavaScript:alert(1)')).toBe('#');
    expect(safeHref('https://a.b')).toBe('https://a.b');
    expect(safeHref('capitolo.md')).toBe('capitolo.md');
  });
});

describe('LaTeX', () => {
  const tex = convertText(sample, 'tex');

  it('genera un documento con preambolo e struttura', () => {
    expect(tex).toContain('\\documentclass[a4paper,11pt]{article}');
    expect(tex).toContain('\\section*{Saggio sul tempo}');
    expect(tex).toContain('\\subsection*{Elenchi}');
    expect(tex).toContain('\\textbf{grassetto}');
    expect(tex).toContain('\\emph{corsivo}');
    expect(tex).toContain('\\uline{sottolineato}');
    expect(tex).toContain('\\sout{barrato}');
    expect(tex).toContain('\\href{https://example.org}{collegamento}');
    expect(tex).toContain('\\setcounter{enumi}{2}');
    expect(tex).toContain('\\begin{tabular}{lcr}');
    expect(tex).toContain('\\begin{verbatim}');
  });

  it('protegge i caratteri speciali', () => {
    expect(escapeLatex('50% & $ # _ { } ~ ^ \\')).toBe(
      '50\\% \\& \\$ \\# \\_ \\{ \\} \\textasciitilde{} \\textasciicircum{} \\textbackslash{}',
    );
    // Nessun carattere speciale non protetto nel testo normale del campione.
    const body = tex.split('\\begin{document}')[1].replace(/\\begin\{verbatim\}[\s\S]*?\\end\{verbatim\}/g, '')
      .replace(/\\begin\{tabular\}[\s\S]*?\\end\{tabular\}/g, '');
    expect(body).not.toMatch(/(?<!\\)[%&#$](?![a-z{])/);
  });
});

describe('Typst', () => {
  const typ = convertText(sample, 'typ');

  it('genera markup con la struttura', () => {
    expect(typ).toContain('#set page(paper: "a4"');
    expect(typ).toContain('= Saggio sul tempo');
    expect(typ).toContain('== Elenchi');
    expect(typ).toContain('#strong[grassetto]');
    expect(typ).toContain('#emph[corsivo]');
    expect(typ).toContain('#underline[sottolineato]');
    expect(typ).toContain('#strike[barrato]');
    expect(typ).toContain('#link("https://example.org")[collegamento]');
    expect(typ).toContain('3. tre');
    expect(typ).toContain('#quote(block: true)[');
    expect(typ).toContain('```python');
    expect(typ).toContain('table.header(');
  });

  it('protegge i caratteri speciali e gli inizi di riga', () => {
    expect(escapeTypst('#a *b* _c_ $d$ @e // f')).toBe('\\#a \\*b\\* \\_c\\_ \\$d\\$ \\@e \\/\\/ f');
    expect(escapeTypst('= titolo', true)).toBe('\\= titolo');
    expect(escapeTypst('12. punto', true)).toBe('12\\. punto');
    expect(escapeTypst('- trattino', true)).toBe('\\- trattino');
  });

  it('chiude le chiamate seguite da punto o parentesi', () => {
    expect(typ).toContain('#strong[Nota];.Seguita');
    expect(typ).toContain('#emph[enfasi];(qui)');
  });

  it('salva il campione per il test di compilazione Rust', () => {
    mkdirSync(join(root, 'src-tauri/tests/fixtures'), { recursive: true });
    writeFileSync(join(root, 'src-tauri/tests/fixtures/campione.typ'), typ);
  });
});

describe('Testo semplice', () => {
  it('toglie la sintassi e conserva la forma', () => {
    const txt = convertText(sample, 'txt');
    expect(txt).toContain('Saggio sul tempo\n================');
    expect(txt).toContain('• primo punto');
    expect(txt).toContain('3. tre');
    expect(txt).toContain('collegamento (https://example.org)');
    expect(txt).not.toContain('**');
    expect(txt).not.toContain('<u>');
  });
});

describe('EPUB', () => {
  it('produce un EPUB 3 valido nella struttura e lo rilegge', () => {
    const bytes = buildEpubFromMarkdown(sample, { title: 'Saggio sul tempo', author: 'Stefano' });
    const files = unzipSync(bytes);
    const names = Object.keys(files);
    expect(names[0]).toBe('mimetype');
    expect(strFromU8(files['mimetype'])).toBe('application/epub+zip');
    // "mimetype" non compresso: il nome compare in chiaro all'offset 30.
    expect(strFromU8(bytes.slice(30, 38))).toBe('mimetype');
    expect(names).toEqual(expect.arrayContaining(['META-INF/container.xml', 'OEBPS/content.opf', 'OEBPS/nav.xhtml', 'OEBPS/toc.ncx']));
    const chapter = strFromU8(files['OEBPS/chap-001.xhtml']);
    expect(chapter).toContain('<br />');
    expect(new DOMParser().parseFromString(chapter, 'application/xhtml+xml').getElementsByTagName('parsererror').length).toBe(0);

    const back = readEpub(bytes);
    expect(back.title).toBe('Saggio sul tempo');
    expect(back.author).toBe('Stefano');
    expect(back.text).toContain('# Saggio sul tempo');
    expect(back.text).toContain('**grassetto**');
    expect(back.text).toContain('<u>sottolineato</u>');
    expect(back.text).toContain('- primo punto');
  });

  it('divide in capitoli ai titoli principali', () => {
    const chapters = splitChapters(parse('Prefazione\n\n# Uno\n\na\n\n# Due\n\nb'), 'Libro');
    expect(chapters.map((c) => c.title)).toEqual(['Libro', 'Uno', 'Due']);
  });

  it('segnala un file che non è un EPUB', () => {
    expect(() => readEpub(new Uint8Array([1, 2, 3]))).toThrow(/EPUB/);
  });
});

describe('Lettura HTML', () => {
  it('estrae testo strutturato e ignora script e stili', () => {
    const { title, text } = readHtml(
      '<html><head><title>Pagina</title><style>p{}</style></head><body><h2>Sezione</h2><p>Un <em>testo</em> e <a href="https://x.it">link</a>.</p><script>x()</script><ul><li>a</li><li>b</li></ul></body></html>',
    );
    expect(title).toBe('Pagina');
    expect(text).toBe('## Sezione\n\nUn *testo* e [link](https://x.it).\n\n- a\n- b\n');
  });
});
