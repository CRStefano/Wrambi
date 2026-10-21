import { describe, expect, it } from 'vitest';
import { mdEscape, pageParagraphs, pageText, paragraphsToMarkdown } from '../src/lib/reader/pdftext';
import type { TextItem } from 'pdfjs-dist/types/src/display/api';

/** Frammento di testo come lo restituisce pdf.js (y cresce verso l'alto). */
function item(str: string, x: number, y: number, size = 11, eol = true): TextItem {
  return { str, dir: 'ltr', transform: [size, 0, 0, size, x, y], width: str.length * size * 0.5, height: size, fontName: 'f', hasEOL: eol };
}

describe('testo estratto dai PDF', () => {
  it('unisce le righe di un paragrafo e ricompone le parole spezzate', () => {
    const t = pageText([
      item('La riflessione sul tempo comincia con una domanda che', 72, 700),
      item('non ha risposta semplice: che cosa misura un orolo-', 72, 686),
      item('gio quando misura il tempo?', 72, 672),
    ]);
    expect(t).toBe('La riflessione sul tempo comincia con una domanda che non ha risposta semplice: che cosa misura un orologio quando misura il tempo?');
  });

  it('ricompone le parole spezzate con il trattino morbido (come nei PDF di Typst)', () => {
    const t = pageText([
      item('Una misura dice quanto un messag\u00ad', 72, 700),
      item('gio riduce l\u2019incertezza di chi lo riceve, ma non', 72, 686),
      item('dice di che cosa parli.', 72, 672),
    ]);
    expect(t).toBe('Una misura dice quanto un messaggio riduce l\u2019incertezza di chi lo riceve, ma non dice di che cosa parli.');
  });

  it('ricompone le parole il cui trattino è sparito, solo nel testo giustificato', () => {
    // Righe giustificate larghe 300 punti; la seconda finisce 2,5 punti prima: lì c'era un trattino.
    const line = (str: string, y: number, width: number): TextItem => ({ ...item(str, 72, y, 10), width });
    const justified = pageText([
      line('Una misura dell\u2019informazione dice quanto un', 700, 300),
      line('messaggio riduce l\u2019incertezza di chi lo riceve, ma non dice di che cosa parli. Due messag', 687, 297.5),
      line('gi ugualmente improbabili trasportano la stessa quantità', 674, 300),
      line('di informazione.', 661, 80),
    ]);
    expect(justified).toContain('Due messaggi ugualmente');
    // In un testo non giustificato una riga più corta è solo una riga più corta.
    const ragged = pageText([
      line('Una riga corta', 700, 120),
      line('che continua qui con altre parole', 687, 240),
      line('e finisce così', 674, 110),
    ]);
    expect(ragged).toBe('Una riga corta che continua qui con altre parole e finisce così');
  });

  it('separa titoli, elenchi e paragrafi', () => {
    const t = pageText([
      item('Tre presenti', 72, 720, 16),
      item('Il passato è memoria, il futuro è attesa e il presente è', 72, 696),
      item('attenzione.', 72, 682),
      item('• memoria del passato', 80, 664),
      item('• attesa del futuro', 80, 650),
      item('Un nuovo capoverso inizia con un rientro e prosegue fino', 90, 632),
      item('alla fine della riga.', 72, 618),
    ]);
    expect(t.split('\n\n')).toEqual([
      'Tre presenti',
      'Il passato è memoria, il futuro è attesa e il presente è attenzione.',
      '• memoria del passato',
      '• attesa del futuro',
      'Un nuovo capoverso inizia con un rientro e prosegue fino alla fine della riga.',
    ]);
  });

  it('inserisce gli spazi tra frammenti distanti sulla stessa riga', () => {
    const t = pageText([item('Kant', 72, 700, 11, false), item('1781', 200, 700)]);
    expect(t).toBe('Kant 1781');
  });
});

describe('testo dei PDF in Markdown', () => {
  it('riconosce titoli ed elenchi e protegge i caratteri speciali', () => {
    const page = pageParagraphs([
      item('Saggio sul tempo', 72, 760, 20),
      item('Tre presenti', 72, 720, 14),
      item('Il passato è memoria, il futuro attesa: 50% * 2 = `x` e a_b.', 72, 696),
      item('• memoria del passato', 80, 664),
      item('3. tre', 80, 650),
      item('# non è un titolo, è testo', 72, 630),
    ]);
    const md = paragraphsToMarkdown([page]);
    expect(md.split('\n\n')).toEqual([
      '# Saggio sul tempo',
      '## Tre presenti',
      'Il passato è memoria, il futuro attesa: 50% * 2 = \\`x\\` e a_b.',
      '- memoria del passato',
      '3. tre',
      '\\# non è un titolo, è testo',
    ]);
  });

  it('il Markdown prodotto rilegge esattamente lo stesso testo', () => {
    expect(mdEscape('_enfasi_ e *stella* e \\barra')).toBe('\\_enfasi\\_ e \\*stella\\* e \\\\barra');
    expect(mdEscape('* elenco? no')).toBe('\\* elenco? no');
    expect(mdEscape('x ** y')).toBe('x \\*\\* y');
    expect(mdEscape('<angoli> e 3 < 4')).toBe('\\<angoli> e 3 < 4');
  });
});
