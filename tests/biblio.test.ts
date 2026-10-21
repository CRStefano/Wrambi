import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { latexToText, parseBibtex, parseNames } from '../src/lib/biblio/bibtex';
import { parseCslJson } from '../src/lib/biblio/csl';
import { BibIndex, formatCitation, formatReference } from '../src/lib/biblio/format';
import { toBiblatex } from '../src/lib/biblio/serialize';
import { parse, plain, type Inline } from '../src/lib/convert/ast';
import { convertDocument, convertText } from '../src/lib/convert';
import { buildEpubFromMarkdown } from '../src/lib/convert/epub';
import { bibFileFor } from '../src/lib/convert/emit';
import { insertNoteMarks, markdownFootnotes } from '../src/lib/convert/notes';

const root = process.cwd();

const BIB = String.raw`
@string{ein = "Einaudi"}
@comment{ Esportato da Zotero }

@book{rossi2020,
  author    = {Rossi, Mario},
  title     = {Il tempo e la {M}emoria},
  publisher = ein,
  location  = {Torino},
  year      = 2020,
}

@book{rossi2020b,
  author    = {Mario Rossi},
  title     = {Abitare il tempo},
  publisher = {Laterza},
  address   = {Roma -- Bari},
  date      = {2020-05},
}

@article{bianchi2019,
  author       = {Bianchi, Anna and Verdi, Luca},
  title        = {Sull'identit{\`a} personale},
  journaltitle = {Rivista di Filosofia},
  volume       = {110},
  number       = {2},
  pages        = {33--58},
  year         = {2019},
  doi          = {https://doi.org/10.1000/xyz123},
}

@incollection{neri2018,
  author    = {Neri, Paolo and Gialli, Sara and Blu, Ugo},
  title     = {Il metodo},
  booktitle = {Studi sul metodo},
  editor    = {Ludwig van Beethoven},
  publisher = {Il Mulino},
  location  = {Bologna},
  pages     = {1--20},
  year      = {2018},
}

@report{oms2021,
  author      = {{World Health Organization}},
  title       = {Rapporto annuale},
  institution = {WHO},
  year        = {2021},
  month       = jan,
}
`;

const entries = parseBibtex(BIB);
const idx = () => new BibIndex(entries);

describe('lettura del .bib', () => {
  it('legge voci, macro, mesi e commenti', () => {
    expect(entries.map((e) => e.id)).toEqual(['rossi2020', 'rossi2020b', 'bianchi2019', 'neri2018', 'oms2021']);
    const r = entries[0];
    expect(r).toMatchObject({ type: 'book', title: 'Il tempo e la Memoria', publisher: 'Einaudi', place: 'Torino', year: '2020' });
    expect(entries[1]).toMatchObject({ year: '2020', place: 'Roma – Bari', author: [{ family: 'Rossi', given: 'Mario' }] });
  });

  it('accenti LaTeX, pagine e DOI', () => {
    const b = entries[2];
    expect(b.title).toBe("Sull'identità personale");
    expect(b.pages).toBe('33–58');
    expect(b.doi).toBe('10.1000/xyz123');
    expect(b.container).toBe('Rivista di Filosofia');
    expect(latexToText(String.raw`Citt{\`a} di Ch\^{a}teau, \c{c}a, Erd\H{o}s, \ss{}e --- fine`)).toBe('Città di Château, ça, Erdős, ße — fine');
  });

  it('nomi: invertiti, con particella, enti', () => {
    expect(parseNames('Ludwig van Beethoven')).toEqual([{ family: 'van Beethoven', given: 'Ludwig' }]);
    expect(parseNames('{World Health Organization} and Eco, Umberto')).toEqual([
      { family: 'World Health Organization', literal: 'World Health Organization' },
      { family: 'Eco', given: 'Umberto' },
    ]);
  });

  it('una voce rotta non ferma la lettura', () => {
    const r = parseBibtex('@book{a, title={Uno}}\n@misc{, }\n@book{b, title={Due}}');
    expect(r.map((e) => e.id)).toEqual(['a', 'b']);
  });

  it('CSL JSON di Zotero', () => {
    const csl = parseCslJson(
      JSON.stringify([
        {
          id: 'http://zotero.org/1',
          'citation-key': 'eco1979',
          type: 'book',
          title: 'Lector in fabula',
          author: [{ family: 'Eco', given: 'Umberto' }],
          issued: { 'date-parts': [[1979]] },
          publisher: 'Bompiani',
          'publisher-place': 'Milano',
        },
        { id: 'x2', type: 'article-journal', title: 'Senza chiave', author: [{ literal: 'ISTAT' }], issued: { raw: 'marzo 2022' }, page: '1-9' },
      ]),
    );
    expect(csl[0]).toMatchObject({ id: 'eco1979', type: 'book', year: '1979', place: 'Milano' });
    expect(csl[1]).toMatchObject({ id: 'x2', year: '2022', pages: '1–9', author: [{ literal: 'ISTAT' }] });
  });

  it('BibLaTeX riscritto con le sole voci scelte', () => {
    const out = toBiblatex([entries[2], entries[4]]);
    expect(out).toContain('@article{bianchi2019,');
    expect(out).toContain('author = {Bianchi, Anna and Verdi, Luca}');
    expect(out).toContain('pages = {33--58}');
    expect(out).toContain('doi = {10.1000/xyz123}');
    expect(out).toContain('author = {{World Health Organization}}');
    expect(out).not.toContain('rossi2020');
    // Si rilegge identico.
    expect(parseBibtex(out).map((e) => e.title)).toEqual([entries[2].title, entries[4].title]);
  });
});

describe('citazioni autore-anno', () => {
  it('nel testo e tra parentesi', () => {
    const i = idx();
    i.disambiguate(['bianchi2019', 'neri2018', 'oms2021'], 'it');
    expect(formatCitation([{ key: 'bianchi2019', locator: 'p. 40' }], true, i, 'it')).toBe('(Bianchi e Verdi 2019, p. 40)');
    expect(formatCitation([{ key: 'neri2018', prefix: 'vedi' }, { key: 'oms2021' }], true, i, 'it')).toBe(
      '(vedi Neri, Gialli e Blu 2018; World Health Organization 2021)',
    );
    expect(formatCitation([{ key: 'bianchi2019' }], false, i, 'en')).toBe('Bianchi and Verdi (2019)');
    expect(formatCitation([{ key: 'bianchi2019', suppressAuthor: true }], true, i, 'fr')).toBe('(2019)');
  });

  it('stesso autore e stesso anno: 2020a, 2020b', () => {
    const i = idx();
    i.disambiguate(['rossi2020', 'rossi2020b'], 'it');
    expect(formatCitation([{ key: 'rossi2020' }, { key: 'rossi2020b' }], true, i, 'it')).toBe('(Rossi 2020b; Rossi 2020a)');
  });

  it('voce della bibliografia', () => {
    const i = idx();
    const text = (c: Inline[]) => plain(c);
    expect(text(formatReference(entries[0], i, 'it'))).toBe('Rossi, Mario. 2020. Il tempo e la Memoria. Torino: Einaudi.');
    expect(text(formatReference(entries[2], i, 'en'))).toBe(
      "Bianchi, Anna, and Luca Verdi. 2019. “Sull'identità personale.” Rivista di Filosofia 110 (2): 33–58. https://doi.org/10.1000/xyz123.",
    );
    const ch = formatReference(entries[3], i, 'it');
    expect(text(ch)).toContain('In Studi sul metodo, a cura di Ludwig van Beethoven, 1–20.');
    // Titoli di libri e riviste in corsivo.
    expect(ch.some((n) => n.t === 'em')).toBe(true);
  });
});

describe('citazioni nel testo Markdown', () => {
  const keys = new Set(entries.map((e) => e.id));
  const inl = (src: string) => (parse(src, { citeKeys: keys }).blocks[0] as { c: Inline[] }).c;

  it('riconosce [@chiave] e @chiave solo se la chiave esiste', () => {
    const c = inl('Come in [vedi @rossi2020, p. 3; -@bianchi2019] e @neri2018. Ma non @ignoto, [@ignoto] né a@rossi2020.');
    const cites = c.filter((n) => n.t === 'cite');
    expect(cites).toEqual([
      {
        t: 'cite',
        bracket: true,
        items: [
          { key: 'rossi2020', prefix: 'vedi', locator: 'p. 3' },
          { key: 'bianchi2019', suppressAuthor: true },
        ],
      },
      { t: 'cite', bracket: false, items: [{ key: 'neri2018' }] },
    ]);
    expect(plain(c)).toContain('Ma non @ignoto, [@ignoto] né a@rossi2020.');
  });

  it('i collegamenti restano collegamenti', () => {
    const c = inl('[testo @rossi2020](https://example.org) e [@rossi2020][rif]\n\n[rif]: https://example.org');
    expect(c.some((n) => n.t === 'link')).toBe(true);
    expect(c.filter((n) => n.t === 'cite')).toHaveLength(0);
  });

  it('senza bibliografia nessuna citazione', () => {
    const c = (parse('[@rossi2020]').blocks[0] as { c: Inline[] }).c;
    expect(c).toEqual([{ t: 'text', v: '[@rossi2020]' }]);
  });
});

describe('note di Wrambi nelle esportazioni', () => {
  const src = '# Titolo\n\nPrima frase annotata. Seconda frase con `codice` qui.\n\nUltima riga.\n';
  const at = (s: string) => src.indexOf(s);
  const ranges = [
    // Selezione che comprende l'a capo: il richiamo resta sulla riga.
    { from: at('Ultima'), to: at('Ultima') + 'Ultima riga.\n'.length, text: 'Nota finale.' },
    { from: at('Prima'), to: at('Prima') + 'Prima frase annotata.'.length, text: 'Una nota\nsu due righe.' },
    { from: at('codice'), to: at('codice') + 3, text: 'Dentro il codice.' },
    { from: 0, to: 3, text: '   ' },
  ];
  const marked = insertNoteMarks(src, ranges);

  it('segnaposto nell\'ordine del testo', () => {
    expect(marked.notes).toEqual(['Una nota\nsu due righe.', 'Dentro il codice.', 'Nota finale.']);
    expect(marked.src).toContain('annotata.⟦wn:1⟧ Seconda');
    expect(marked.src).toContain('Ultima riga.⟦wn:3⟧\n');
  });

  it('Markdown con note di Pandoc', () => {
    const md = markdownFootnotes(marked.src, marked.notes);
    expect(md).toContain('annotata.[^1] Seconda');
    expect(md).toMatch(/\[\^1\]: Una nota\n {4}su due righe\.\n\[\^2\]: Dentro il codice\.\n\[\^3\]: Nota finale\.\n$/);
  });

  it('HTML: richiami e note di chiusura (la nota nel codice va dopo il codice)', () => {
    const html = convertText(marked.src, 'html-fragment', { notes: marked.notes });
    expect(html).toContain('annotata.<sup class="fnref"><a id="fnref-1" href="#fn-1"');
    expect(html).toContain('<code>codice</code><sup class="fnref"><a id="fnref-2"');
    expect(html).toContain('<li id="fn-1" role="doc-endnote"><p>Una nota<br>su due righe.');
    expect(html).toContain('<h2>Note</h2>');
    expect(html).not.toContain('⟦');
  });

  it('LaTeX, Typst e testo', () => {
    const tex = convertText(marked.src, 'tex', { notes: marked.notes, lang: 'en' });
    expect(tex).toContain('annotata.\\footnote{Una nota su due righe.}');
    expect(tex).toContain('\\usepackage[english]{babel}');
    const typ = convertText(marked.src, 'typ', { notes: marked.notes, lang: 'fr' });
    expect(typ).toContain('annotata.#footnote[Una nota su due righe.] Seconda');
    expect(typ).toContain('#set text(lang: "fr"');
    const txt = convertText(marked.src, 'txt', { notes: marked.notes });
    expect(txt).toContain('annotata.[1] Seconda');
    expect(txt).toMatch(/Note\n-{4}\n\n\[1\] Una nota\n {4}su due righe\.\n\[2\] Dentro il codice\.\n\[3\] Nota finale\.\n$/);
  });

  it('senza note i segnaposto spariscono', () => {
    expect(convertText(marked.src, 'txt')).not.toContain('⟦');
    expect(convertDocument(marked.src, 'md').text).toBe(src);
  });
});

describe('documento con citazioni e bibliografia', () => {
  const src =
    '# Saggio\n\nSecondo @bianchi2019, il tempo [vedi @rossi2020, p. 12; @oms2021] è **misurabile** [-@rossi2020b].\n\nUna chiave ignota [@ignoto] resta testo.\n';
  const bib = idx();

  it('HTML: citazioni formattate e bibliografia delle sole opere citate', () => {
    const html = convertText(src, 'html', { bib, lang: 'it', title: 'Saggio' });
    expect(html).toContain('<html lang="it">');
    expect(html).toContain('Secondo <span class="cite">Bianchi e Verdi (2019)</span>');
    // Stesso autore e anno: le lettere seguono l'ordine dei titoli («Abitare…» prima di «Il tempo…»).
    expect(html).toContain('<span class="cite">(vedi Rossi 2020b, p. 12; World Health Organization 2021)</span>');
    expect(html).toContain('<span class="cite">(2020a)</span>');
    expect(html).toContain('[@ignoto]');
    expect(html).toContain('<h2>Bibliografia</h2>');
    const refs = html.slice(html.indexOf('<section class="references"'));
    // In ordine: Bianchi, Rossi 2020a, Rossi 2020b, World Health Organization; Neri non è citato.
    const order = ['Bianchi, Anna', 'Abitare il tempo', 'Il tempo e la Memoria', 'World Health Organization'].map((s) => refs.indexOf(s));
    expect(order.every((p, k) => p > 0 && (k === 0 || p > order[k - 1]))).toBe(true);
    expect(refs).not.toContain('Neri');
  });

  it('LaTeX: biblatex e .bib affiancato', () => {
    const r = convertDocument(src, 'tex', { bib, lang: 'it', bibFile: bibFileFor('Saggio.tex') });
    expect(r.text).toContain('\\addbibresource{Saggio.bib}');
    expect(r.text).toContain('Secondo \\textcite{bianchi2019}');
    expect(r.text).toContain('\\autocites[{vedi}][{p. 12}]{rossi2020}{oms2021}');
    expect(r.text).toContain('\\autocite*{rossi2020b}');
    expect(r.text).toContain('\\printbibliography');
    expect(r.text).toContain('ignota [@ignoto] resta');
    expect(r.bib).toContain('@book{rossi2020,');
    expect(r.bib).not.toContain('neri2018');
  });

  it('Typst: citazioni native e bibliografia', () => {
    const r = convertDocument(src, 'typ', { bib, lang: 'it', bibFile: 'wrambi-citazioni.bib' });
    expect(r.text).toContain('Secondo #cite(label("bianchi2019"), form: "prose"), il tempo');
    expect(r.text).toContain('vedi #cite(label("rossi2020"), supplement: [p. 12]) #cite(label("oms2021")) è');
    expect(r.text).toContain('(#cite(label("rossi2020b"), form: "year")).');
    expect(r.text).toContain('\\[\\@ignoto\\]');
    expect(r.text).toContain('#bibliography("wrambi-citazioni.bib", style: "chicago-author-date")');
    expect(r.bib).toContain('@article{bianchi2019,');
    // Per il test di compilazione Rust (Typst vero, con la bibliografia in memoria).
    mkdirSync(join(root, 'src-tauri/tests/fixtures'), { recursive: true });
    writeFileSync(join(root, 'src-tauri/tests/fixtures/citazioni.typ'), r.text);
    writeFileSync(join(root, 'src-tauri/tests/fixtures/citazioni.bib'), r.bib!);
  });

  it('testo semplice ed EPUB', () => {
    const txt = convertText(src, 'txt', { bib, lang: 'en' });
    expect(txt).toContain('Secondo Bianchi and Verdi (2019)');
    expect(txt).toMatch(/References\n-{10}\n\nBianchi, Anna, and Luca Verdi\. 2019\./);
    const files = unzipSync(buildEpubFromMarkdown(src + '\nNota.⟦wn:1⟧\n', { title: 'Saggio' }, { bib, lang: 'fr', notes: ['Une note.'] }));
    const names = Object.keys(files);
    expect(names).toContain('OEBPS/notes.xhtml');
    expect(names).toContain('OEBPS/references.xhtml');
    expect(strFromU8(files['OEBPS/references.xhtml'])).toContain('<h2>Bibliographie</h2>');
    expect(strFromU8(files['OEBPS/chap-001.xhtml'])).toContain('href="notes.xhtml#fn-1" epub:type="noteref"');
    expect(strFromU8(files['OEBPS/notes.xhtml'])).toContain('href="chap-001.xhtml#fnref-1"');
    expect(strFromU8(files['OEBPS/nav.xhtml'])).toContain('Table des matières');
    expect(strFromU8(files['OEBPS/content.opf'])).toContain('<dc:language>fr</dc:language>');
  });
});
