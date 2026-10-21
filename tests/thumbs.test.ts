import { describe, expect, it } from 'vitest';
import { latexLines, markdownLines, typstLines } from '../src/lib/thumbs';
import { buildEpubFromMarkdown, epubCover } from '../src/lib/convert/epub';
import { strToU8, zipSync } from 'fflate';

describe('anteprime della Biblioteca', () => {
  it('Markdown: titoli, elenchi e testo senza segni di formattazione', () => {
    const lines = markdownLines('---\ntitle: x\n---\n# Il tempo\n\nUn **testo** con *enfasi* e [un link](http://x).\n\n- primo\n- secondo\n\n```\ncodice\n```\n');
    expect(lines).toEqual([
      { text: 'Il tempo', level: 1 },
      { text: 'Un testo con enfasi e un link.', level: 0 },
      { text: 'primo', level: 4 },
      { text: 'secondo', level: 4 },
      { text: 'codice', level: 0 },
    ]);
  });

  it('LaTeX: titolo, sezioni e testo senza comandi', () => {
    const src = '\\documentclass{article}\n\\title{Saggio}\n\\begin{document}\n\\maketitle\n\\section{Inizio}\nTesto \\textbf{forte} % commento\n\\begin{itemize}\n\\item uno\n\\end{itemize}\n\\end{document}\n';
    expect(latexLines(src)).toEqual([
      { text: 'Saggio', level: 1 },
      { text: 'Inizio', level: 2 },
      { text: 'Testo forte', level: 0 },
      { text: 'uno', level: 4 },
    ]);
  });

  it('Typst: titoli e testo senza istruzioni', () => {
    expect(typstLines('#set page(paper: "a4")\n= Capitolo\n\nTesto *forte* e #emph[corsivo].\n\n- voce\n')).toEqual([
      { text: 'Capitolo', level: 1 },
      { text: 'Testo forte e corsivo.', level: 0 },
      { text: 'voce', level: 4 },
    ]);
  });

  it('EPUB: titolo e autore anche senza immagine di copertina', () => {
    const bytes = buildEpubFromMarkdown('# Saggio sul tempo\n\nUn paragrafo.\n', { title: 'Saggio sul tempo', author: 'Stefano' });
    const c = epubCover(bytes);
    expect(c.title).toBe('Saggio sul tempo');
    expect(c.image).toBeNull();
  });

  it('EPUB: trova l\'immagine di copertina indicata nel file OPF', () => {
    const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
    const bytes = zipSync({
      mimetype: strToU8('application/epub+zip'),
      'META-INF/container.xml': strToU8('<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'),
      'OEBPS/content.opf': strToU8('<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/"><metadata><dc:title>Libro</dc:title><dc:creator>Autrice</dc:creator><meta name="cover" content="img"/></metadata><manifest><item id="img" href="images/c.png" media-type="image/png"/></manifest><spine/></package>'),
      'OEBPS/images/c.png': png,
    });
    const c = epubCover(bytes);
    expect(c.title).toBe('Libro');
    expect(c.author).toBe('Autrice');
    expect(c.image?.type).toBe('image/png');
    expect([...c.image!.data]).toEqual([...png]);
  });
});
