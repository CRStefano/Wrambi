import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PDFDocument, StandardFonts, degrees } from 'pdf-lib';
import { View, buildPdf, corners, groupLines, lineBox, lineRoom, matchFont, type Op, type PageRef } from '../src/lib/pdfedit/model';

const root = process.cwd();

async function samplePdf(pages = 3, classic = false): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle('Campione');
  const font = await doc.embedFont(StandardFonts.TimesRoman);
  for (let i = 1; i <= pages; i++) {
    const p = doc.addPage([595, 842]);
    p.drawText(`Pagina ${i}: il testo originale.`, { x: 72, y: 760, size: 12, font });
  }
  return doc.save({ useObjectStreams: !classic });
}

const fallbackFonts = async () => {
  const dir = join(root, 'node_modules/pdfjs-dist/standard_fonts');
  const f = (n: string) => new Uint8Array(readFileSync(join(dir, `LiberationSans-${n}.ttf`)));
  return [f('Regular'), f('Bold'), f('Italic'), f('BoldItalic')] as [Uint8Array, Uint8Array, Uint8Array, Uint8Array];
};

describe('geometria delle pagine', () => {
  it('come pdf.js: pagina dritta e ruotata', () => {
    const v = new View([0, 0, 600, 800], 2, 0);
    expect([v.width, v.height]).toEqual([1200, 1600]);
    expect(v.toView(0, 800)).toEqual([0, 0]);
    expect(v.toView(600, 0)).toEqual([1200, 1600]);
    const r = new View([0, 0, 600, 800], 1, 90);
    expect([r.width, r.height]).toEqual([800, 600]);
    // In una pagina ruotata di 90° l'angolo (0,0) va in alto a sinistra.
    expect(r.toView(0, 0)).toEqual([0, 0]);
    const [x, y] = r.toPdf(...r.toView(123, 456));
    expect([Math.round(x), Math.round(y)]).toEqual([123, 456]);
    // Il testo che appare orizzontale su una pagina ruotata di 90° ha angolo 90 nello spazio PDF.
    expect(r.uprightAngle()).toBe(90);
    expect(new View([0, 0, 10, 10], 1, 270).uprightAngle()).toBe(-90);
  });

  it('riquadri ruotati e matrice CSS', () => {
    const b = { x: 10, y: 20, w: 100, h: 10, angle: 90 };
    const c = corners(b).map(([x, y]) => [Math.round(x), Math.round(y)]);
    expect(c).toEqual([
      [10, 20],
      [10, 120],
      [0, 120],
      [0, 20],
    ]);
    const css = new View([0, 0, 200, 200], 1, 0).css({ x: 10, y: 20, w: 100, h: 10, angle: 0 });
    expect(css.width).toBeCloseTo(100);
    expect(css.height).toBeCloseTo(10);
    expect(css.transform).toBe('matrix(1,0,0,1,10,170)');
  });
});

describe('righe di testo', () => {
  const it_ = (str: string, x: number, y: number, size = 10, fontName = 'g_d0_f1', hasEOL = false) => ({
    str,
    transform: [size, 0, 0, size, x, y],
    width: str.length * size * 0.5,
    height: size,
    fontName,
    hasEOL,
  });

  it('unisce i frammenti della stessa riga e separa le colonne', () => {
    const lines = groupLines(
      [it_('Una', 72, 700), it_('riga', 92, 700), it_('spezzata.', 115, 700, 10, 'f', true), it_('Seconda riga', 72, 686), it_('Colonna destra', 320, 686)],
      'p1',
    );
    expect(lines.map((l) => l.text)).toEqual(['Una riga spezzata.', 'Seconda riga', 'Colonna destra']);
    expect(lines[0].width).toBeCloseTo(115 - 72 + 45);
    expect(lines[0].box.y).toBeCloseTo(700 - 2.4);
  });

  it('una riga riscritta può arrivare al margine della sua colonna, non oltre', () => {
    const lines = groupLines(
      [
        it_('Testo lungo della colonna sinistra.', 72, 700, 10, 'f', true),
        it_('breve', 72, 686, 10, 'f', true),
        it_('Colonna destra molto più lunga di tutte', 320, 686, 10, 'f', true),
        it_('Piè di pagina', 50, 100, 10, 'f', true),
      ],
      'p1',
    );
    const [long, short, right] = lines;
    expect(lineRoom(short, lines)).toBeCloseTo(long.width);
    expect(lineRoom(long, lines)).toBeCloseTo(long.width);
    expect(lineRoom(right, lines)).toBeCloseTo(right.width);
  });

  it('riconosce famiglia, grassetto e corsivo', () => {
    expect(matchFont('ABCDEF+TimesNewRomanPS-BoldItalicMT')).toEqual({ family: 'serif', bold: true, italic: true });
    expect(matchFont('Arial-BoldMT')).toEqual({ family: 'sans', bold: true, italic: false });
    expect(matchFont('CourierNewPSMT')).toMatchObject({ family: 'mono' });
    expect(matchFont('g_d0_f3', 'serif')).toMatchObject({ family: 'serif' });
    expect(matchFont('LMRoman10-Regular')).toMatchObject({ family: 'serif', bold: false });
  });

  it('riquadro sotto la linea di base', () => {
    const b = lineBox(100, 500, 50, 10, 0, 1);
    expect(b).toMatchObject({ x: 99, w: 52, angle: 0 });
    expect(b.y).toBeCloseTo(500 - 2.4 - 1);
  });
});

describe('salvataggio delle modifiche', () => {
  it('modifiche sul posto: testo sostituito, aggiunto, evidenziato, coperto, rotazione', async () => {
    const original = await samplePdf(2);
    const pages: PageRef[] = [
      { id: 'a', src: 0, index: 0, rotate: 0 },
      { id: 'b', src: 0, index: 1, rotate: 90 },
    ];
    const font = { family: 'serif' as const, bold: false, italic: false };
    const ops: Op[] = [
      {
        kind: 'replace',
        id: '1',
        page: 'a',
        lineId: 'a:0',
        original: 'Pagina 1: il testo originale.',
        cover: lineBox(72, 760, 160, 12, 0, 1),
        bg: [1, 1, 1],
        x: 72,
        y: 760,
        angle: 0,
        size: 12,
        text: 'Pagina 1: il testo è cambiato — perché sì.',
        font,
        color: [0, 0, 0],
      },
      { kind: 'text', id: '2', page: 'b', x: 72, y: 700, angle: 0, size: 14, text: 'Aggiunto: Łódź', font: { family: 'sans', bold: true, italic: false }, color: [0.8, 0, 0] },
      { kind: 'highlight', id: '3', page: 'b', boxes: [lineBox(72, 760, 160, 12, 0)], color: [1, 0.85, 0.1] },
      { kind: 'cover', id: '4', page: 'b', box: { x: 300, y: 300, w: 100, h: 50, angle: 0 }, color: [1, 1, 1] },
    ];
    const out = await buildPdf({ original, extra: [], pages, ops, images: new Map(), fallbackFonts });
    const doc = await PDFDocument.load(out);
    expect(doc.getPageCount()).toBe(2);
    expect(doc.getPage(1).getRotation().angle).toBe(90);
    expect(doc.getTitle()).toBe('Campione');
    mkdirSync(join(root, 'tests/out'), { recursive: true });
    writeFileSync(join(root, 'tests/out/modificato.pdf'), out);
  });

  it('pagine riordinate, eliminate, vuote e da un altro PDF', async () => {
    const original = await samplePdf(3);
    const other = await samplePdf(1);
    const pages: PageRef[] = [
      { id: 'c', src: 0, index: 2, rotate: 0 },
      { id: 'n', src: -1, index: 0, rotate: 0, size: [400, 300] },
      { id: 'a', src: 0, index: 0, rotate: 180 },
      { id: 'x', src: 1, index: 0, rotate: 0 },
    ];
    const out = await buildPdf({ original, extra: [other], pages, ops: [], images: new Map() });
    const doc = await PDFDocument.load(out);
    expect(doc.getPageCount()).toBe(4);
    expect(doc.getPage(1).getSize()).toEqual({ width: 400, height: 300 });
    expect(doc.getPage(2).getRotation().angle).toBe(180);
    expect(doc.getTitle()).toBe('Campione');
    writeFileSync(join(root, 'tests/out/riordinato.pdf'), out);
  });

  it('senza caratteri di riserva, i caratteri fuori codifica sono un errore chiaro', async () => {
    const original = await samplePdf(1);
    const ops: Op[] = [{ kind: 'text', id: '1', page: 'a', x: 72, y: 700, angle: 0, size: 12, text: 'Ελληνικά', font: { family: 'serif', bold: false, italic: false }, color: [0, 0, 0] }];
    await expect(buildPdf({ original, extra: [], pages: [{ id: 'a', src: 0, index: 0, rotate: 0 }], ops, images: new Map() })).rejects.toThrow('charset');
  });

  it('PDF cifrati: errore riconoscibile', async () => {
    // Un dizionario /Encrypt nel trailer basta perché pdf-lib lo consideri cifrato.
    const original = await samplePdf(1, true);
    const text = new TextDecoder('latin1').decode(original).replace(/trailer\s*<</, 'trailer\n<<\n/Encrypt << /Filter /Standard >>');
    expect(text).toContain('/Encrypt');
    const bytes = new Uint8Array([...text].map((c) => c.charCodeAt(0)));
    await expect(buildPdf({ original: bytes, extra: [], pages: [{ id: 'a', src: 0, index: 0, rotate: 0 }], ops: [], images: new Map() })).rejects.toThrow();
  });

  it('rotazione aggiunta a una pagina già ruotata', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([200, 100]).setRotation(degrees(270));
    const out = await buildPdf({ original: await doc.save(), extra: [], pages: [{ id: 'a', src: 0, index: 0, rotate: 180 }], ops: [], images: new Map() });
    expect((await PDFDocument.load(out)).getPage(0).getRotation().angle).toBe(90);
  });
});
